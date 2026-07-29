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
// ──────────────────────────────────────────────────────────────────────
import { json, preflight } from "../_shared/http.ts";
import { adminClient, isServiceOrCron } from "../_shared/supabase.ts";

const BUCKET = "oem-documents";
// Owner's manuals for current models genuinely run 30-50 MB. Above this we
// keep the link rather than the file: a document too big to hold is still a
// document the customer can open.
const MAX_BYTES = 60 * 1024 * 1024;
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });
  // Storing a byte is a privileged act; there is no user-facing path to it.
  if (!isServiceOrCron(req)) return json(403, { error: "service_role_required" });

  const admin = adminClient();
  const body = await req.json().catch(() => ({}));
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

  // 1. Claim. This decides, records the evidence, and tells us whether a copy
  //    already exists for this tenant and model-year.
  const { data: claimRows, error: claimErr } = await admin.rpc("claim_oem_document_hosting", {
    _tenant_id: tenantId, _vin: vin, _brand: brand, _document_kind: kind,
    _source_url: sourceUrl, _model: model, _model_year: modelYear,
    _store_id: storeId, _vehicle_listing_id: listingId,
  });
  if (claimErr) return json(500, { error: "claim_failed", detail: claimErr.message });

  const claim = (Array.isArray(claimRows) ? claimRows[0] : claimRows) as
    { decision?: string; event_id?: string | null; already_stored_path?: string | null } | null;
  const decision = claim?.decision ?? "link";

  if (decision !== "host") {
    // Not this dealer's brand. The decision is already recorded; nothing is
    // fetched, and specifically nothing is fetched even though we may hold
    // this exact document for a dealer who is franchised for it.
    return json(200, { ok: true, decision: "link", stored: false, reason: "not_franchised_for_brand" });
  }
  if (!claim?.event_id) {
    // A host decision with no event to cite is a contradiction; refuse rather
    // than store something we cannot account for.
    return json(500, { error: "claim_missing_event" });
  }
  if (claim.already_stored_path) {
    return json(200, { ok: true, decision: "host", stored: false, reason: "already_stored", path: claim.already_stored_path });
  }

  // 2. Fetch, now that we are allowed to.
  let bytes: Uint8Array;
  try {
    const res = await fetch(sourceUrl, {
      headers: { "User-Agent": UA, Accept: "application/pdf,*/*" },
      redirect: "follow", signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return json(502, { error: "source_fetch_failed", status: res.status });

    const declared = Number.parseInt(res.headers.get("content-length") || "", 10);
    if (Number.isFinite(declared) && declared > MAX_BYTES) {
      return json(413, { error: "document_too_large", bytes: declared });
    }
    // Stream with a running cap: arrayBuffer() on a 400 MB manual would OOM
    // the worker before any size check could fire.
    const reader = res.body?.getReader();
    if (!reader) return json(502, { error: "source_no_body" });
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        return json(413, { error: "document_too_large", bytes: total });
      }
      chunks.push(value);
    }
    bytes = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) { bytes.set(c, off); off += c.byteLength; }
  } catch (e) {
    return json(504, { error: "source_fetch_timeout", detail: e instanceof Error ? e.message : String(e) });
  }

  // A manufacturer bot-wall returns HTML with a 200. Storing that as "the
  // owner's manual" would be worse than storing nothing.
  const isPdf = bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
  if (!isPdf) return json(415, { error: "source_not_a_pdf" });

  // 3. Store, under this tenant's own folder. Never a shared path.
  const path = `${tenantId}/${slug(brand)}/${kind}/${slug(model) || "model"}-${modelYear ?? "any"}.pdf`;
  const up = await admin.storage.from(BUCKET).upload(path, bytes, {
    upsert: true, contentType: "application/pdf",
  });
  if (up.error) return json(500, { error: "store_failed", detail: up.error.message });

  // 4. Record the copy, citing the decision that authorised it.
  const { error: insErr } = await admin.from("oem_hosted_documents").upsert({
    tenant_id: tenantId, brand, model: model || "unknown", model_year: modelYear,
    document_kind: kind, storage_path: path, source_url: sourceUrl,
    byte_size: bytes.byteLength, content_type: "application/pdf",
    authorised_by: claim.event_id,
  }, { onConflict: "tenant_id,brand,model,model_year,document_kind" });
  if (insErr) {
    // An unaccountable file is worse than no file: if we cannot record why
    // this copy exists, we do not keep it.
    await admin.storage.from(BUCKET).remove([path]).catch(() => undefined);
    return json(500, { error: "record_failed", detail: insErr.message });
  }

  return json(200, { ok: true, decision: "host", stored: true, path, bytes: bytes.byteLength });
});
