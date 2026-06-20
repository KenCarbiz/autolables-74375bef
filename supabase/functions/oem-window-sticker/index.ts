// ──────────────────────────────────────────────────────────────────────
// oem-window-sticker — pull the rendered OEM Monroney window sticker for a VIN
// from a provider, cache the image/PDF in the public `oem-stickers` bucket, and
// store the URL on the listing (oem_sticker_url) so the customer packet can
// show the original factory sticker. Provider-agnostic; VinAudit is primary.
//
// Env (set whichever provider you use):
//   VINAUDIT_WINDOW_STICKER_KEY   — VinAudit window-sticker API key (primary)
//   MONRONEY_LABELS_KEY           — MonroneyLabels.com key (fallback, URL-based)
//
// Body: { vin, tenant_id?, vehicle_id? }
// ──────────────────────────────────────────────────────────────────────
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const VINAUDIT_KEY = Deno.env.get("VINAUDIT_WINDOW_STICKER_KEY") || "";
const MONRONEY_KEY = Deno.env.get("MONRONEY_LABELS_KEY") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const validVin = (vin: string) => /^[A-HJ-NPR-Z0-9]{17}$/i.test(vin);
const extFor = (ct: string) => (ct.includes("pdf") ? "pdf" : ct.includes("png") ? "png" : ct.includes("jpeg") || ct.includes("jpg") ? "jpg" : "bin");

interface Fetched { bytes: Uint8Array; contentType: string }

// VinAudit returns the rendered sticker as binary (PNG/PDF) directly, or a JSON
// error envelope. We detect success by content-type.
async function fromVinAudit(vin: string): Promise<Fetched | { error: string }> {
  const url = `https://windowstickers.vinaudit.com/v1/windowsticker?key=${encodeURIComponent(VINAUDIT_KEY)}&vin=${encodeURIComponent(vin)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
  const ct = res.headers.get("content-type") || "";
  if (res.ok && (ct.startsWith("image/") || ct.includes("pdf"))) {
    return { bytes: new Uint8Array(await res.arrayBuffer()), contentType: ct };
  }
  // Error path — try to surface the provider's message.
  const body = await res.json().catch(() => null);
  return { error: (body && (body.error || body.message)) || `no_sticker (${res.status})` };
}

// MonroneyLabels returns JSON with a hosted PDF/JPG URL; we fetch that URL's
// bytes so everything is served from our own bucket.
async function fromMonroney(vin: string): Promise<Fetched | { error: string }> {
  const res = await fetch(`https://monroneylabels.com/api/v1/cars?vin=${encodeURIComponent(vin)}`, {
    headers: { Authorization: `Bearer ${MONRONEY_KEY}` },
    signal: AbortSignal.timeout(20000),
  });
  const body = await res.json().catch(() => null);
  // deno-lint-ignore no-explicit-any
  const car: any = body?.data?.[0] ?? body?.data ?? body;
  const link = car?.pdf || car?.jpg || car?.image || car?.url;
  if (!res.ok || !link) return { error: `no_sticker (${res.status})` };
  const img = await fetch(link, { signal: AbortSignal.timeout(20000) });
  if (!img.ok) return { error: "fetch_render_failed" };
  return { bytes: new Uint8Array(await img.arrayBuffer()), contentType: img.headers.get("content-type") || "application/pdf" };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (!VINAUDIT_KEY && !MONRONEY_KEY) {
    return json(200, { ok: false, error: "not_configured", note: "Set VINAUDIT_WINDOW_STICKER_KEY or MONRONEY_LABELS_KEY" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const body = await req.json().catch(() => ({}));
  const vin = String(body.vin || "").toUpperCase().trim();
  const tenantId: string | null = body.tenant_id || null;
  const vehicleId: string | null = body.vehicle_id || null;
  if (!validVin(vin)) return json(400, { ok: false, error: "invalid_vin" });

  // ── Auth gate ────────────────────────────────────────────────
  // Service-role (cron/admin) bypasses; otherwise require a signed-in
  // tenant member (or platform admin) for the requested tenant_id.
  const auth = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (auth !== serviceKey) {
    const { data: ures, error: uerr } = await admin.auth.getUser(auth);
    const userId = ures?.user?.id;
    if (uerr || !userId) return json(401, { ok: false, error: "authentication required" });
    if (!tenantId) return json(400, { ok: false, error: "tenant_id required" });
    const { data: isAdmin } = await admin.from("user_roles")
      .select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
    if (!isAdmin) {
      const { data: membership } = await admin.from("tenant_members")
        .select("tenant_id").eq("user_id", userId).eq("tenant_id", tenantId).maybeSingle();
      if (!membership) return json(403, { ok: false, error: "not a member of this tenant" });
    }
  }


  let fetched: Fetched | { error: string };
  let provider = "";
  if (VINAUDIT_KEY) { provider = "vinaudit"; fetched = await fromVinAudit(vin); }
  else { provider = "monroneylabels"; fetched = await fromMonroney(vin); }

  if ("error" in fetched) return json(200, { ok: false, error: fetched.error, provider });

  const ext = extFor(fetched.contentType);

  const path = `${tenantId || "house"}/${vin}.${ext}`;
  const up = await admin.storage.from("oem-stickers").upload(path, fetched.bytes, {
    contentType: fetched.contentType,
    upsert: true,
  });
  if (up.error) return json(200, { ok: false, error: "storage_failed", detail: up.error.message, provider });

  const { data: signed, error: signErr } = await admin.storage.from("oem-stickers")
    .createSignedUrl(path, 60 * 60 * 24 * 365 * 5); // 5 years
  if (signErr || !signed?.signedUrl) return json(200, { ok: false, error: "sign_failed", detail: signErr?.message, provider });
  const stickerUrl = signed.signedUrl;


  // Persist on the listing (best-effort; columns may not be migrated yet).
  try {
    let q = admin.from("vehicle_listings")
      .update({ oem_sticker_url: stickerUrl, oem_sticker_checked_at: new Date().toISOString() });
    q = vehicleId ? q.eq("id", vehicleId) : q.eq("vin", vin);
    if (tenantId) q = q.eq("tenant_id", tenantId);
    await q;
  } catch { /* oem_sticker_* columns may not be migrated yet */ }

  return json(200, { ok: true, vin, provider, url: stickerUrl, contentType: fetched.contentType });
});
