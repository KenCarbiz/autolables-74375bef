// ──────────────────────────────────────────────────────────────────────
// oem-document-store — keep a franchised dealer's own copy of a manufacturer
// owner's manual or brochure, so their customer keeps it for the life of the
// car instead of following a link that will not resolve in eight years.
//
// This is the ONLY place in the system that fetches manufacturer document
// bytes. Everything else links.
//
// The order is the whole point: CLAIM FIRST, FETCH SECOND. claim_oem_document_
// hosting asks the gate, writes the evidence row, and returns the event id the
// stored copy has to cite. A refusal returns no event id, and oem_hosted_
// documents.authorised_by is NOT NULL against that event, so a copy stored
// without a decision cannot be recorded even if this function were wrong. The
// refusal is enforced by the schema rather than by remembering to check.
//
// A Honda store selling a used Toyota gets 'link' here, and gets it even when
// a Toyota store's copy of the same PDF is already in the bucket. Storage is
// tenant-scoped for exactly that reason.
//
// TWO ENTRY POINTS:
//
//   default   store one document for one vehicle. Called by ingest
//             (intake-autoprovision → ensureOemDocCopies) for every vehicle,
//             with no human in the loop.
//   sweep     reconcile a whole fleet: find the franchised (brand, model,
//             year) combinations with no copy on file, and take the ones the
//             ledger says are worth attempting. This exists because the ingest
//             call reads the manufacturer LINK cache, and on the first car of
//             a model that link is still being harvested — so the copy is
//             skipped, and for a car that arrived by CSV, DMS webhook or
//             manual add there was no second pass to take it.
//
// Both paths write oem_document_copy_attempts. Before that ledger a copy that
// could not be taken returned a status code to a detached caller and left no
// trace at all: the dealer saw a link (the correct fallback) and nobody could
// answer why there was no copy.
// ──────────────────────────────────────────────────────────────────────
import { json, preflight } from "../_shared/http.ts";
import { adminClient, isServiceOrCron } from "../_shared/supabase.ts";
import { clampInt, interleaveByTenant, CATALOG_FETCH_LIMIT } from "../_shared/packetBackfill.ts";
import {
  buildCopyTargets, pickCopySourceUrl,
  OEM_COPY_KINDS, OEM_COPY_LOCK_KEY, OEM_COPY_LOCK_TTL_SECONDS, OEM_COPY_SWEEP_BUDGET_MS,
  DEFAULT_COPY_STORE_LIMIT, MAX_COPY_STORE_LIMIT,
  type OemCopyKind, type OemCopyOutcome, type OemCopyTarget,
  type OemCopyListingRow, type OemHostedRow, type OemCopyAttemptRow, type OemLinkCatalogRow,
} from "../_shared/oemDocCopy.ts";

// deno-lint-ignore no-explicit-any
type Admin = any;

const BUCKET = "oem-documents";
// Owner's manuals for current models genuinely run 30-50 MB. Above this we
// keep the link rather than the file: a document too big to hold is still a
// document the customer can open.
const MAX_BYTES = 60 * 1024 * 1024;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const LINK_TABLE: Record<OemCopyKind, string> = {
  brochure: "oem_brochure_links",
  owners_manual: "oem_owners_manual_links",
};

const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

interface StoreRequest {
  tenantId: string;
  vin: string;
  brand: string;
  model: string;
  modelYear: number | null;
  kind: OemCopyKind;
  sourceUrl: string;
  storeId: string | null;
  listingId: string | null;
}

interface StoreResult {
  status: number;
  body: Record<string, unknown>;
  outcome: OemCopyOutcome;
  detail: string | null;
}

/**
 * File what happened, whatever happened.
 *
 * Never throws and never changes the answer: the ledger is how a missing
 * document stays visible and gets retried, but a dealer's copy must not fail
 * because we could not write a note about it.
 */
async function recordCopyAttempt(
  admin: Admin, req: StoreRequest, outcome: OemCopyOutcome, detail: string | null,
): Promise<void> {
  try {
    await admin.rpc("record_oem_document_copy_attempt", {
      _tenant_id: req.tenantId,
      _brand: req.brand,
      _model: req.model,
      _model_year: req.modelYear,
      _document_kind: req.kind,
      _outcome: outcome,
      _detail: detail ? detail.slice(0, 500) : null,
      _source_url: req.sourceUrl || null,
    });
  } catch { /* the trace is an aid; losing one costs one retry */ }
}

/**
 * Claim, fetch, store, record — in that order, for one document.
 *
 * Returns the outcome rather than a Response so the sweep can run it in
 * process without an HTTP hop, and so both callers land the same ledger row
 * for the same event.
 */
async function storeDocument(admin: Admin, req: StoreRequest): Promise<StoreResult> {
  // 1. Claim. This decides, records the evidence, and tells us whether a copy
  //    already exists for this tenant and model-year.
  const { data: claimRows, error: claimErr } = await admin.rpc("claim_oem_document_hosting", {
    _tenant_id: req.tenantId, _vin: req.vin, _brand: req.brand, _document_kind: req.kind,
    _source_url: req.sourceUrl, _model: req.model, _model_year: req.modelYear,
    _store_id: req.storeId, _vehicle_listing_id: req.listingId,
  });
  if (claimErr) {
    return {
      status: 500, outcome: "store_failed", detail: claimErr.message,
      body: { error: "claim_failed", detail: claimErr.message },
    };
  }

  const claim = (Array.isArray(claimRows) ? claimRows[0] : claimRows) as
    { decision?: string; event_id?: string | null; already_stored_path?: string | null } | null;
  const decision = claim?.decision ?? "link";

  if (decision !== "host") {
    // Not this dealer's brand. The decision is already recorded; nothing is
    // fetched, and specifically nothing is fetched even though we may hold
    // this exact document for a dealer who is franchised for it.
    return {
      status: 200, outcome: "not_franchised", detail: null,
      body: { ok: true, decision: "link", stored: false, reason: "not_franchised_for_brand" },
    };
  }
  if (!claim?.event_id) {
    // A host decision with no event to cite is a contradiction; refuse rather
    // than store something we cannot account for.
    return {
      status: 500, outcome: "store_failed", detail: "claim returned host with no event id",
      body: { error: "claim_missing_event" },
    };
  }
  if (claim.already_stored_path) {
    return {
      status: 200, outcome: "already_stored", detail: null,
      body: { ok: true, decision: "host", stored: false, reason: "already_stored", path: claim.already_stored_path },
    };
  }

  // 2. Fetch, now that we are allowed to.
  let bytes: Uint8Array;
  try {
    const res = await fetch(req.sourceUrl, {
      headers: { "User-Agent": UA, Accept: "application/pdf,*/*" },
      redirect: "follow", signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      return {
        status: 502, outcome: "source_unreachable", detail: `source returned ${res.status}`,
        body: { error: "source_fetch_failed", status: res.status },
      };
    }

    const declared = Number.parseInt(res.headers.get("content-length") || "", 10);
    if (Number.isFinite(declared) && declared > MAX_BYTES) {
      return {
        status: 413, outcome: "too_large", detail: `${declared} bytes declared`,
        body: { error: "document_too_large", bytes: declared },
      };
    }
    // Stream with a running cap: arrayBuffer() on a 400 MB manual would OOM
    // the worker before any size check could fire.
    const reader = res.body?.getReader();
    if (!reader) {
      return {
        status: 502, outcome: "source_unreachable", detail: "source returned no body",
        body: { error: "source_no_body" },
      };
    }
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        return {
          status: 413, outcome: "too_large", detail: `${total} bytes streamed`,
          body: { error: "document_too_large", bytes: total },
        };
      }
      chunks.push(value);
    }
    bytes = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { bytes.set(c, off); off += c.byteLength; }
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    return {
      status: 504, outcome: "source_unreachable", detail,
      body: { error: "source_fetch_timeout", detail },
    };
  }

  // A manufacturer bot-wall returns HTML with a 200. Storing that as "the
  // owner's manual" would be worse than storing nothing.
  const isPdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
  if (!isPdf) {
    return {
      status: 415, outcome: "not_a_pdf", detail: "source did not return a PDF",
      body: { error: "source_not_a_pdf" },
    };
  }

  // 3. Store, under this tenant's own folder. Never a shared path.
  const path = `${req.tenantId}/${slug(req.brand)}/${req.kind}/${slug(req.model) || "model"}-${req.modelYear ?? "any"}.pdf`;
  const up = await admin.storage.from(BUCKET).upload(path, bytes, {
    upsert: true, contentType: "application/pdf",
  });
  if (up.error) {
    return {
      status: 500, outcome: "store_failed", detail: up.error.message,
      body: { error: "store_failed", detail: up.error.message },
    };
  }

  // 4. Record the copy, citing the decision that authorised it.
  //
  // INSERT, not upsert. The only uniqueness on oem_hosted_documents is an
  // EXPRESSION index — (tenant_id, lower(brand), lower(model),
  // COALESCE(model_year, 0), document_kind) — and PostgREST's on_conflict
  // takes a plain column list, which Postgres cannot match to an expression
  // index. It answered 42P10 for every first-time copy, so the document was
  // fetched, uploaded, un-recorded and then deleted again, and the caller
  // discarded the 500. Hosting looked implemented and stored nothing.
  const { error: insErr } = await admin.from("oem_hosted_documents").insert({
    tenant_id: req.tenantId, brand: req.brand, model: req.model || "unknown", model_year: req.modelYear,
    document_kind: req.kind, storage_path: path, source_url: req.sourceUrl,
    byte_size: bytes.byteLength, content_type: "application/pdf",
    authorised_by: claim.event_id,
  });
  if (insErr) {
    // A duplicate is another run that stored this same document first. The
    // path is deterministic, so the object we just uploaded IS that row's
    // object — deleting it here would break the copy that won the race.
    if (String((insErr as { code?: string }).code || "") === "23505") {
      return {
        status: 200, outcome: "already_stored", detail: null,
        body: { ok: true, decision: "host", stored: false, reason: "already_stored", path },
      };
    }
    // An unaccountable file is worse than no file: if we cannot record why
    // this copy exists, we do not keep it.
    await admin.storage.from(BUCKET).remove([path]).catch(() => undefined);
    return {
      status: 500, outcome: "store_failed", detail: insErr.message,
      body: { error: "record_failed", detail: insErr.message },
    };
  }

  return {
    status: 200, outcome: "stored", detail: null,
    body: { ok: true, decision: "host", stored: true, path, bytes: bytes.byteLength },
  };
}

// ── Sweep ─────────────────────────────────────────────────────────────

interface CatalogLinkRow extends OemLinkCatalogRow { make: string; model: string }

async function loadLinkCatalog(admin: Admin, table: string): Promise<CatalogLinkRow[]> {
  const { data, error } = await admin.from(table)
    .select("make, model, year, url")
    .order("year", { ascending: false, nullsFirst: false })
    .limit(CATALOG_FETCH_LIMIT);
  if (error) throw new Error(`${table}_query_failed: ${error.message}`);
  return (data || []) as CatalogLinkRow[];
}

/**
 * The brands each tenant in this batch is franchised for.
 *
 * derive_oem_franchise_brands is the same derivation the gate itself uses, so
 * the worklist cannot become more permissive than the claim that follows it —
 * at worst it wastes a claim, which is a cheap RPC and no download. A tenant
 * whose derivation cannot be read is left OUT: "we could not check" is not
 * "we are allowed", and every one of its cars simply keeps linking.
 */
async function loadFranchiseBrands(admin: Admin, tenantIds: string[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  for (const tenantId of tenantIds) {
    try {
      const { data, error } = await admin.rpc("derive_oem_franchise_brands", { _tenant_id: tenantId });
      if (error || !Array.isArray(data)) continue;
      const brands = new Set<string>();
      for (const row of data as { brand?: string }[]) {
        const brand = String(row?.brand || "").trim().toLowerCase();
        if (brand) brands.add(brand);
      }
      if (brands.size) out.set(tenantId, brands);
    } catch { /* an unreadable derivation denies, like everywhere else here */ }
  }
  return out;
}

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  // Storing a byte is a privileged act; there is no user-facing path to it.
  if (!isServiceOrCron(req)) return json(403, { error: "service_role_required" });

  const admin = adminClient();
  const body = await req.json().catch(() => ({} as Record<string, unknown>)) as Record<string, unknown>;

  if (String(body.mode || "") === "sweep") return await runSweep(admin, body);

  const tenantId = String(body.tenant_id || "").trim();
  const vin = String(body.vin || "").trim().toUpperCase();
  const brand = String(body.brand || "").trim().toLowerCase();
  const model = String(body.model || "").trim();
  const modelYear = Number.parseInt(String(body.model_year ?? ""), 10) || null;
  const kind = String(body.document_kind || "").trim();
  const sourceUrl = String(body.source_url || "").trim();
  const storeId = body.store_id ? String(body.store_id) : null;
  const listingId = body.vehicle_listing_id ? String(body.vehicle_listing_id) : null;

  if (!tenantId || !vin || !brand || !sourceUrl) return json(400, { error: "tenant_id, vin, brand and source_url required" });
  if (kind !== "owners_manual" && kind !== "brochure") return json(400, { error: "unknown_document_kind" });
  if (!/^https:\/\//i.test(sourceUrl)) return json(400, { error: "source_url_must_be_https" });

  const request: StoreRequest = {
    tenantId, vin, brand, model, modelYear, kind, sourceUrl, storeId, listingId,
  };
  const result = await storeDocument(admin, request);
  await recordCopyAttempt(admin, request, result.outcome, result.detail);
  return json(result.status, result.body);
});

/**
 * Reconcile the copies a fleet should already hold.
 *
 * Cache-first and ledger-first, in that order: a combination already stored is
 * never re-downloaded, and one that failed is re-opened only when its cooldown
 * has passed and it is under the attempt ceiling. Both rules live in
 * _shared/oemDocCopy.ts, where they are unit tested, rather than in this
 * handler where they would only be exercised in production.
 */
async function runSweep(admin: Admin, body: Record<string, unknown>): Promise<Response> {
  const tenantId = body.tenant_id ? String(body.tenant_id) : null;
  const limit = clampInt(body.limit, 500, 1, 2000);
  const storeLimit = clampInt(body.store_limit, DEFAULT_COPY_STORE_LIMIT, 0, MAX_COPY_STORE_LIMIT);
  const force = body.force === true;
  const kinds = Array.isArray(body.kinds)
    ? OEM_COPY_KINDS.filter((k) => (body.kinds as unknown[]).map(String).includes(k))
    : OEM_COPY_KINDS;

  let listings: OemCopyListingRow[];
  let brochureCatalog: CatalogLinkRow[];
  let manualCatalog: CatalogLinkRow[];
  let hosted: OemHostedRow[];
  let attempts: OemCopyAttemptRow[];
  let tenantIds: string[];
  try {
    let q = admin.from("vehicle_listings")
      .select("id, tenant_id, vin, ymm")
      .eq("status", "published")
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (tenantId) q = q.eq("tenant_id", tenantId);
    const { data: rows, error } = await q;
    if (error) throw new Error(`listing_query_failed: ${error.message}`);
    listings = (rows || []) as OemCopyListingRow[];

    tenantIds = [...new Set(listings.map((l) => l.tenant_id).filter(Boolean))];
    if (!tenantIds.length) {
      return json(200, { success: true, scope: tenantId || "all_tenants", vehicles_examined: 0, targets: 0, note: "No published inventory." });
    }

    const [b, m, h, a] = await Promise.all([
      loadLinkCatalog(admin, LINK_TABLE.brochure),
      loadLinkCatalog(admin, LINK_TABLE.owners_manual),
      admin.from("oem_hosted_documents")
        .select("tenant_id, brand, model, model_year, document_kind")
        .in("tenant_id", tenantIds).limit(CATALOG_FETCH_LIMIT),
      admin.from("oem_document_copy_attempts")
        .select("tenant_id, brand_key, model_key, year_key, document_kind, outcome, attempts, last_attempt_at")
        .in("tenant_id", tenantIds).limit(CATALOG_FETCH_LIMIT),
    ]);
    brochureCatalog = b;
    manualCatalog = m;
    // An unreadable hosted table would make every copy look missing and
    // re-download the fleet, so it is fatal here rather than empty.
    if (h.error) throw new Error(`hosted_query_failed: ${h.error.message}`);
    hosted = (h.data || []) as OemHostedRow[];
    // An unreadable ledger only means nothing is remembered yet; the store
    // limit and the hosted check still bound the run.
    attempts = (a.error ? [] : (a.data || [])) as OemCopyAttemptRow[];
  } catch (e) {
    return json(500, { error: String((e as Error)?.message || e).slice(0, 300) });
  }

  const franchiseBrands = await loadFranchiseBrands(admin, tenantIds);

  const now = Date.now();
  const targets = interleaveByTenant(
    buildCopyTargets(listings, { franchiseBrands, hosted, attempts, kinds, now, force }),
    (t) => t.tenantId,
  );
  const planned = targets.slice(0, storeLimit);

  // No franchised dealer in this batch means nothing to store and nothing to
  // entitle: every one of these cars links, which is the correct answer and
  // needs no work at all. An empty PLAN is different — the entitlement pass
  // below still has to run, because the steady state of a swept fleet is
  // "every copy already held" and that is exactly when new arrivals of an
  // already-copied model need their decision minted.
  if (!franchiseBrands.size) {
    return json(200, {
      success: true, scope: tenantId || "all_tenants",
      vehicles_examined: listings.length, franchised_tenants: 0,
      targets: 0, processed: 0,
      note: "No dealer in this batch holds a derived new-vehicle franchise; every vehicle links.",
    });
  }

  // Single-runner, expiry-based: a pooled edge connection cannot hold a
  // session-scoped advisory lock, and two overlapping sweeps would download
  // the same manuals twice.
  const { data: acquired } = await admin.rpc("try_acquire_service_lock", {
    _key: OEM_COPY_LOCK_KEY, _ttl_seconds: OEM_COPY_LOCK_TTL_SECONDS, _holder: tenantId || "all_tenants",
  });
  if (acquired === false) {
    return json(200, { success: true, skipped: "already_running", targets: targets.length });
  }

  const catalogFor = (kind: OemCopyKind) => (kind === "brochure" ? brochureCatalog : manualCatalog);
  const sourceFor = (t: OemCopyTarget): string | null => {
    const rows = catalogFor(t.kind).filter((r) =>
      String(r.make || "").trim().toLowerCase() === t.brand.trim().toLowerCase()
      && String(r.model || "").trim().toLowerCase() === t.model.trim().toLowerCase());
    return pickCopySourceUrl(rows, t.year);
  };

  const worker = async () => {
    const deadline = Date.now() + OEM_COPY_SWEEP_BUDGET_MS;
    const outcomes: Record<string, number> = {};
    let processed = 0;
    let entitled = 0;
    try {
      // Every car of a model we already hold, not just the one vehicle whose
      // ingest happened to claim it. A stored copy is keyed per model but
      // entitlement is per VIN, so without this the dealer's own manual sits
      // in the bucket while their other three QX60s serve the manufacturer
      // link. Cheap, SQL-side and bounded; it writes nothing when there is
      // nothing missing.
      for (const tenant of franchiseBrands.keys()) {
        if (Date.now() > deadline) break;
        try {
          const { data } = await admin.rpc("backfill_oem_distribution_entitlements", {
            _tenant_id: tenant, _limit: 200,
          });
          entitled += Number(data) || 0;
        } catch { /* an entitlement we could not mint is retried next run */ }
      }
      for (const t of planned) {
        if (Date.now() > deadline) break;
        const request: StoreRequest = {
          tenantId: t.tenantId, vin: t.vin, brand: t.brand, model: t.model,
          modelYear: t.year, kind: t.kind, sourceUrl: sourceFor(t) || "",
          storeId: null, listingId: t.listingId,
        };
        // No link, no copy, and no invented URL: a dead link on a customer
        // packet is worse than an absent one. The row this writes is what
        // makes the absence queryable and re-opens it in two days.
        if (!request.sourceUrl) {
          await recordCopyAttempt(admin, request, "link_missing", "no harvested manufacturer link for this model");
          outcomes.link_missing = (outcomes.link_missing || 0) + 1;
          continue;
        }
        try {
          const result = await storeDocument(admin, request);
          await recordCopyAttempt(admin, request, result.outcome, result.detail);
          outcomes[result.outcome] = (outcomes[result.outcome] || 0) + 1;
          processed++;
        } catch (e) {
          await recordCopyAttempt(admin, request, "store_failed", e instanceof Error ? e.message : String(e));
          outcomes.exception = (outcomes.exception || 0) + 1;
        }
      }
    } finally {
      try { await admin.rpc("release_service_lock", { _key: OEM_COPY_LOCK_KEY }); }
      catch { /* the TTL still applies */ }
    }
    return { processed, entitlements_minted: entitled, outcomes };
  };

  if (body.sync === true) {
    const tally = await worker();
    return json(200, {
      success: true, scope: tenantId || "all_tenants",
      vehicles_examined: listings.length, franchised_tenants: franchiseBrands.size,
      targets: targets.length, planned: planned.length, ...tally,
    });
  }

  // deno-lint-ignore no-explicit-any
  const er = (globalThis as any).EdgeRuntime;
  if (er && typeof er.waitUntil === "function") er.waitUntil(worker());
  else void worker();
  return json(202, {
    success: true, accepted: true, scope: tenantId || "all_tenants",
    vehicles_examined: listings.length, franchised_tenants: franchiseBrands.size,
    targets: targets.length, planned: planned.length,
  });
});
