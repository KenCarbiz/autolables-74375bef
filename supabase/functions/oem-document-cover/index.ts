// ──────────────────────────────────────────────────────────────────────
// oem-document-cover — derive and store a page-1 cover for a harvested OEM
// brochure or owner's-manual link, so the customer Documents page can picture
// the real document instead of drawing a placeholder for it.
//
// WHAT THE ARTIFACT IS. There is no usable PDF rasterizer in the Supabase edge
// runtime, so this does not produce a thumbnail image in the general case. It
// copies PAGE 1 ONLY into a new single-page PDF (pdf-lib, already a project
// dependency) and stores that — `cover_mime = application/pdf`. An <img src>
// pointed at that URL renders NOTHING; the consumer needs <object>/<embed> or
// a client-side pdf.js render. The one exception is a page 1 that is a single
// full-bleed JPEG, which is lifted out as image/jpeg. Read `cover_is_image`
// (or `cover_mime`) — never assume. See ../_shared/oemCoverPdf.ts for the
// alternatives that were considered and why they were rejected.
//
// Body:
//   { kind: "brochure" | "owners_manual", id }                 -- one row
//   { kind, make, model, year? }                               -- resolve then cover
//   { kind?, sweep: true, limit? }                             -- service/cron only
//   { ..., force: true }                                       -- ignore idempotency
//
// Auth: tenant user JWT or service role / cron secret (sweep is privileged).
//
// Never throws a link harvest off the rails: every failure is recorded on the
// row as cover_status='failed' (retryable) or 'unsupported' (terminal for that
// url) and reported as a 200 with ok:false.
// ──────────────────────────────────────────────────────────────────────
import { json, preflight } from "../_shared/http.ts";
import { adminClient, isServiceOrCron } from "../_shared/supabase.ts";
import {
  COVER_BUCKET,
  COVER_FETCH_TIMEOUT_MS,
  COVER_SOURCE_MAX_BYTES,
  COVER_USER_AGENT,
  type CoverKind,
  coverStoragePath,
  looksLikePdf,
  readyCoverColumns,
  shouldGenerateCover,
  unresolvedCoverColumns,
  urlCouldBePdf,
} from "../_shared/oemCover.ts";
import { extractFirstPageCover, UnsupportedPdfError } from "../_shared/oemCoverPdf.ts";

const TABLE: Record<CoverKind, string> = {
  brochure: "oem_brochure_links",
  owners_manual: "oem_owners_manual_links",
};

const SELECT = "id, make, model, year, url, cover_status, cover_storage_path";

interface LinkRow {
  id: string;
  make: string;
  model: string;
  year: number | null;
  url: string;
  cover_status: string | null;
  cover_storage_path: string | null;
}

type Admin = ReturnType<typeof adminClient>;

/**
 * Read at most `max` bytes of a response body, then give up.
 *
 * res.arrayBuffer() would buffer a 200 MB brochure into an edge worker before
 * we ever got to check its size — the OOM happens during the read, not after
 * it. Streaming and bailing at the cap is the only way the cap actually caps.
 * Content-Length is checked too, but OEM CDNs frequently omit it.
 */
async function readCapped(res: Response, max: number): Promise<Uint8Array | "too_large"> {
  const declared = Number(res.headers.get("content-length") || "");
  if (Number.isFinite(declared) && declared > max) return "too_large";

  const body = res.body;
  if (!body) {
    const buf = new Uint8Array(await res.arrayBuffer());
    return buf.byteLength > max ? "too_large" : buf;
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > max) {
        await reader.cancel().catch(() => undefined);
        return "too_large";
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock?.();
  }

  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.byteLength; }
  return out;
}

interface CoverOutcome {
  ok: boolean;
  status: "ready" | "unsupported" | "failed" | "skipped";
  reason?: string;
  path?: string;
  mime?: string;
  pageCount?: number | null;
}

async function record(
  admin: Admin,
  kind: CoverKind,
  id: string,
  columns: Record<string, unknown>,
): Promise<void> {
  // A write failure here must not surface as a thrown error: the caller is
  // usually a link harvest that has already done its real work.
  await admin.from(TABLE[kind]).update(columns).eq("id", id);
}

export async function generateCover(
  admin: Admin,
  kind: CoverKind,
  row: LinkRow,
  opts: { force?: boolean } = {},
): Promise<CoverOutcome> {
  if (!shouldGenerateCover(row, opts)) {
    return { ok: true, status: "skipped", reason: "cover_current", path: row.cover_storage_path ?? undefined };
  }

  // Only ever fetch a URL we already store as an official manufacturer
  // resource — the url comes off the link row, never from a caller.
  if (!urlCouldBePdf(row.url)) {
    await record(admin, kind, row.id, unresolvedCoverColumns("unsupported"));
    return { ok: false, status: "unsupported", reason: "not_a_document_url" };
  }

  let bytes: Uint8Array;
  try {
    const res = await fetch(row.url, {
      headers: { "User-Agent": COVER_USER_AGENT, Accept: "application/pdf,*/*" },
      redirect: "follow",
      signal: AbortSignal.timeout(COVER_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      // 404/410 means the link itself is gone; anything else may recover.
      const terminal = res.status === 404 || res.status === 410;
      await record(admin, kind, row.id, unresolvedCoverColumns(terminal ? "unsupported" : "failed"));
      return { ok: false, status: terminal ? "unsupported" : "failed", reason: `http_${res.status}` };
    }
    const read = await readCapped(res, COVER_SOURCE_MAX_BYTES);
    if (read === "too_large") {
      await record(admin, kind, row.id, unresolvedCoverColumns("unsupported"));
      return { ok: false, status: "unsupported", reason: "source_too_large" };
    }
    bytes = read;
  } catch (e) {
    await record(admin, kind, row.id, unresolvedCoverColumns("failed"));
    return { ok: false, status: "failed", reason: e instanceof Error ? e.message.slice(0, 160) : "fetch_error" };
  }

  // An OEM "manuals and guides" portal answers 200 with HTML. That is a real,
  // valid link — it just has no page 1 to show — so it is unsupported, not
  // failed, and will not be re-fetched on every sweep.
  if (!looksLikePdf(bytes)) {
    await record(admin, kind, row.id, unresolvedCoverColumns("unsupported"));
    return { ok: false, status: "unsupported", reason: "not_a_pdf" };
  }

  let cover: Awaited<ReturnType<typeof extractFirstPageCover>>;
  try {
    cover = await extractFirstPageCover(bytes);
  } catch (e) {
    const terminal = e instanceof UnsupportedPdfError;
    await record(admin, kind, row.id, unresolvedCoverColumns(terminal ? "unsupported" : "failed"));
    return {
      ok: false,
      status: terminal ? "unsupported" : "failed",
      reason: e instanceof Error ? e.message.slice(0, 160) : "extract_error",
    };
  }

  // Path carries the row id and a token for this exact url, and the upload is
  // upsert:false — so a re-harvest cannot land on another make/model/year's
  // object, and a same-row re-run writes a new version rather than replacing
  // the artifact a passport may still be serving.
  const path = coverStoragePath(kind, row.id, row.url, cover.mime);
  let up = await admin.storage.from(COVER_BUCKET).upload(path, cover.bytes, {
    upsert: false,
    contentType: cover.mime,
  });
  if (up.error) {
    const msg = String(up.error.message || "");
    if (/exists/i.test(msg)) {
      // Deterministic path: an object already here is this row's own cover for
      // this same url. Adopt it instead of failing.
      up = { data: { path, id: "", fullPath: `${COVER_BUCKET}/${path}` }, error: null } as typeof up;
    } else {
      await admin.storage
        .createBucket(COVER_BUCKET, { public: false, fileSizeLimit: 8 * 1024 * 1024 })
        .catch(() => undefined);
      up = await admin.storage.from(COVER_BUCKET).upload(path, cover.bytes, {
        upsert: false,
        contentType: cover.mime,
      });
    }
  }
  if (up.error) {
    await record(admin, kind, row.id, unresolvedCoverColumns("failed"));
    return { ok: false, status: "failed", reason: `store_failed: ${up.error.message}`.slice(0, 160) };
  }

  await record(
    admin,
    kind,
    row.id,
    readyCoverColumns({ path, mime: cover.mime, pageCount: cover.pageCount }),
  );
  return { ok: true, status: "ready", path, mime: cover.mime, pageCount: cover.pageCount };
}

/** Nearest-year pick, matching how every other reader resolves these tables. */
function pickRow(rows: LinkRow[], year: number | null): LinkRow | undefined {
  return (year ? rows.find((r) => r.year === year) : rows[0]) ||
    rows.find((r) => r.year != null && year != null && Math.abs(r.year - year) <= 2) ||
    (!year ? rows[0] : undefined);
}

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const admin = adminClient();
  const privileged = isServiceOrCron(req);
  if (!privileged) {
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jwt) return json(401, { error: "missing bearer token" });
    const { data: ures } = await admin.auth.getUser(jwt);
    if (!ures?.user?.id) return json(401, { error: "unauthorized" });
  }

  const body = await req.json().catch(() => ({}));
  const force = body.force === true;
  const rawKind = String(body.kind || "").trim();
  const kind = (rawKind === "brochure" || rawKind === "owners_manual" ? rawKind : "") as CoverKind | "";

  // ── Sweep: backfill rows that still owe a cover. Privileged only, because
  // it fans out large outbound fetches.
  if (body.sweep === true) {
    if (!privileged) return json(403, { error: "sweep_requires_service_role" });
    const kinds: CoverKind[] = kind ? [kind] : ["brochure", "owners_manual"];
    const limit = Math.max(1, Math.min(Number.parseInt(String(body.limit ?? "8"), 10) || 8, 25));
    const results: Record<string, CoverOutcome[]> = {};
    for (const k of kinds) {
      const { data } = await admin
        .from(TABLE[k])
        .select(SELECT)
        .or("cover_status.is.null,cover_status.eq.pending,cover_status.eq.failed")
        .limit(limit);
      const rows = (data || []) as LinkRow[];
      results[k] = [];
      for (const r of rows) {
        results[k].push(await generateCover(admin, k, r, { force }));
      }
    }
    return json(200, { ok: true, swept: results });
  }

  if (!kind) return json(400, { error: "kind must be brochure or owners_manual" });

  const id = body.id ? String(body.id) : "";
  let row: LinkRow | undefined;
  if (id) {
    const { data } = await admin.from(TABLE[kind]).select(SELECT).eq("id", id).maybeSingle();
    row = (data || undefined) as LinkRow | undefined;
  } else {
    const make = String(body.make || "").trim();
    const model = String(body.model || "").trim();
    const year = Number.parseInt(String(body.year ?? ""), 10) || null;
    if (!make || !model) return json(400, { error: "id, or make and model, required" });
    const { data } = await admin
      .from(TABLE[kind])
      .select(SELECT)
      .ilike("make", make).ilike("model", model)
      .order("year", { ascending: false, nullsFirst: false })
      .limit(6);
    row = pickRow((data || []) as LinkRow[], year);
  }
  if (!row) return json(404, { error: "link_not_found" });

  const outcome = await generateCover(admin, kind, row, { force });
  return json(200, { kind, id: row.id, ...outcome });
});
