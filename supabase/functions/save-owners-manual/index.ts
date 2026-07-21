// ──────────────────────────────────────────────────────────────────────
// save-owners-manual — cache the OEM owner's-manual PDF into a vehicle's
// passport documents, on demand. This is the "save a copy in the passport"
// step: by default we only keep the LINK (harvested by oem-owners-manual);
// the first time an admin or a customer pulls it, we fetch the OEM-hosted
// PDF once and attach it to vehicle_listings.documents so it lives with the
// car. Idempotent — a manual already saved is returned as-is (no re-fetch).
//
// Body: { vehicle_id?, slug? }
//   - vehicle_id: admin path (any signed-in caller; the row is looked up by id)
//   - slug:       public path (customer on /v/:slug — must be a published car)
// Auth: verify_jwt is OFF (customers are anonymous). The function never trusts
// a client-supplied URL — the manual link is resolved server-side from the
// oem_owners_manual_links cache, so a caller can only ever cause us to store
// the official manual for a real vehicle.
// ──────────────────────────────────────────────────────────────────────
import { json, preflight } from "../_shared/http.ts";
import { adminClient } from "../_shared/supabase.ts";

const BUCKET = "vehicle-docs";
const MAX_BYTES = 60 * 1024 * 1024; // owner's manuals are large but bounded
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

interface DocRow { name: string; url: string; type: string }

// Parse a "2026 INFINITI QX60 LUXE" ymm into make/model/year (same split the
// brochure finder uses).
const parseYmm = (ymm: string): { year: number | null; make: string; model: string } => {
  const parts = String(ymm || "").trim().split(/\s+/);
  const year = Number.parseInt(parts[0] || "", 10) || null;
  const make = parts[1] || "";
  const model = parts.slice(2).join(" ");
  return { year, make, model };
};

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const admin = adminClient();
  const body = await req.json().catch(() => ({}));
  const vehicleId = body.vehicle_id ? String(body.vehicle_id) : "";
  const slug = body.slug ? String(body.slug).trim() : "";
  if (!vehicleId && !slug) return json(400, { error: "vehicle_id or slug required" });

  // Resolve the vehicle. The public path is restricted to published cars.
  let q = admin.from("vehicle_listings")
    .select("id, tenant_id, ymm, slug, vin, status, documents");
  if (vehicleId) q = q.eq("id", vehicleId);
  else q = q.or(`slug.eq.${slug},vin.eq.${slug.toUpperCase()}`).eq("status", "published");
  const { data: listing, error: lErr } = await q.maybeSingle();
  if (lErr || !listing) return json(404, { error: "vehicle_not_found" });

  const docs = (Array.isArray(listing.documents) ? listing.documents : []) as DocRow[];

  // Idempotent: if a manual copy is already attached, return it — never re-fetch.
  const existing = docs.find((d) => d && d.type === "owners_manual" && d.url);
  if (existing) return json(200, { ok: true, cached: true, url: existing.url, name: existing.name });

  // Resolve the manual LINK server-side from the harvested cache (never trust
  // a client URL). Prefer exact year, then nearest within 2 model years.
  const { year, make, model } = parseYmm(listing.ymm || "");
  if (!make || !model) return json(422, { error: "vehicle_missing_ymm" });
  const { data: links } = await admin
    .from("oem_owners_manual_links")
    .select("url, title, year")
    .ilike("make", make).ilike("model", model)
    .order("year", { ascending: false, nullsFirst: false })
    .limit(6);
  const rows = (links || []) as { url: string; title: string | null; year: number | null }[];
  const link =
    (year ? rows.find((r) => r.year === year) : rows[0]) ||
    rows.find((r) => r.year != null && year != null && Math.abs(r.year - year) <= 2) ||
    rows[0];
  if (!link?.url) return json(404, { error: "manual_link_not_harvested" });

  // Fetch the OEM PDF once. Bounded size + content-type sanity so we never
  // store a bot-wall HTML page as a "manual".
  let bytes: Uint8Array;
  let contentType = "application/pdf";
  try {
    const res = await fetch(link.url, { headers: { "User-Agent": UA, Accept: "application/pdf,*/*" }, redirect: "follow", signal: AbortSignal.timeout(45000) });
    if (!res.ok) return json(502, { error: "manual_fetch_failed", status: res.status });
    contentType = (res.headers.get("content-type") || "").toLowerCase();
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > MAX_BYTES) return json(413, { error: "manual_too_large" });
    // Accept PDFs (by header or %PDF magic); reject an HTML interstitial.
    const looksPdf = contentType.includes("pdf") || (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46);
    if (!looksPdf) return json(415, { error: "manual_not_a_pdf", contentType });
    bytes = buf;
    contentType = "application/pdf";
  } catch (e) {
    return json(504, { error: "manual_fetch_timeout", detail: e instanceof Error ? e.message : String(e) });
  }

  const path = `${listing.tenant_id}/${listing.id}/owners_manual-${Date.now()}.pdf`;
  let up = await admin.storage.from(BUCKET).upload(path, bytes, { upsert: false, contentType });
  if (up.error) {
    await admin.storage.createBucket(BUCKET, { public: false, fileSizeLimit: MAX_BYTES }).catch(() => undefined);
    up = await admin.storage.from(BUCKET).upload(path, bytes, { upsert: false, contentType });
  }
  if (up.error) return json(500, { error: "manual_store_failed", detail: up.error.message });

  const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(path, 60 * 60 * 24 * 365);
  const name = `${[year, make, model].filter(Boolean).join(" ")} Owner's Manual`.trim() || "Owner's Manual";
  const next: DocRow[] = [...docs, { name, type: "owners_manual", url: signed?.signedUrl || path }];
  const { error: updErr } = await admin.from("vehicle_listings").update({ documents: next }).eq("id", listing.id);
  if (updErr) return json(500, { error: "attach_failed", detail: updErr.message });

  return json(200, { ok: true, cached: false, url: signed?.signedUrl || path, name });
});
