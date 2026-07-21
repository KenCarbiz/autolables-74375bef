import { qrcode } from "https://deno.land/x/qrcode@v2.0.0/mod.ts";
import { json, preflight, htmlEscape } from "../_shared/http.ts";
import { SUPABASE_URL, SERVICE_KEY, adminClient, isServiceOrCron } from "../_shared/supabase.ts";

// ──────────────────────────────────────────────────────────────────────
// notify-installer — emails the dealer's third-party installers the per-
// vehicle install link + QR on intake, so they know a new car is in for the
// pre-install protection products they handle (tint, ceramic, etc). The
// installer opens /install/:install_token to record the install with photo +
// signature proof.
//
// Body: { tenant_id, vin }
// Recipients: active installer_contacts for the tenant. If an installer has a
//   `product` set, it's named in their email; otherwise they're treated as a
//   general installer. Skips silently when the dealer has no installers or no
//   preinstall products are offered.
// Auth: service-role / cron-secret (called by ingest-orchestrate).
// ──────────────────────────────────────────────────────────────────────

const APP_BASE = Deno.env.get("APP_BASE_URL") || "https://autolabels.io";
const b64ToBytes = (b64: string) => { const bin = atob(b64); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; };

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return json(405, { error: "method not allowed" });
  if (!isServiceOrCron(req)) return json(401, { error: "unauthorized" });

  const body = await req.json().catch(() => ({})) as { tenant_id?: string; vin?: string };
  const tenantId = body.tenant_id;
  const vin = (body.vin || "").toUpperCase().trim();
  if (!tenantId || !vin) return json(400, { error: "tenant_id and vin required" });

  const admin = adminClient();

  // Only worth notifying if the dealer actually offers pre-installed products.
  const { count: preinstallCount } = await admin.from("products")
    .select("id", { count: "exact", head: true }).eq("is_active", true).eq("available_preinstalled", true);
  if (!preinstallCount) return json(200, { ok: false, error: "no_preinstall_products" });

  const { data: installers } = await admin.from("installer_contacts")
    .select("company, product, email").eq("tenant_id", tenantId).eq("active", true);
  const recips = (installers || []).filter((i) => /.+@.+\..+/.test(String(i.email || ""))) as { company: string; product: string | null; email: string }[];
  if (!recips.length) return json(200, { ok: false, error: "no_installers" });

  const { data: vl } = await admin.from("vehicle_listings")
    .select("ymm, install_token").eq("tenant_id", tenantId).eq("vin", vin).maybeSingle();
  if (!vl?.install_token) return json(200, { ok: false, error: "no_install_token" });
  const ymm = (vl.ymm as string) || "Vehicle";
  const installUrl = `${APP_BASE}/install/${vl.install_token}`;

  let qrImgUrl = "";
  try {
    const dataUrl = await qrcode(installUrl, { size: 240 }) as string;
    const b64 = dataUrl.split(",")[1];
    if (b64) {
      const qrPath = `${tenantId}/qr/install-${vl.install_token}.gif`;
      await admin.storage.from("service-docs").upload(qrPath, b64ToBytes(b64), { contentType: "image/gif", upsert: true });
      qrImgUrl = admin.storage.from("service-docs").getPublicUrl(qrPath).data?.publicUrl || "";
    }
  } catch { /* QR optional */ }

  let sentCount = 0;
  for (const inst of recips) {
    const product = (inst.product || "").trim();
    const html = `
    <div style="font-family:Inter,Arial,sans-serif;max-width:480px;margin:0 auto;color:#0F172A">
      <h2 style="margin:0 0 4px">${htmlEscape(ymm)} is ready for ${htmlEscape(product || "your install")}</h2>
      <p style="color:#64748B;margin:0 0 16px">VIN ${htmlEscape(vin)}</p>
      <p style="margin:0 0 16px">A new vehicle is in inventory${product ? ` for <b>${htmlEscape(product)}</b>` : ""}. Record the install with a photo and your signature when complete.</p>
      <a href="${installUrl}" style="display:inline-block;background:#2563EB;color:#fff;font-weight:bold;text-decoration:none;padding:14px 24px;border-radius:12px">Record Install</a>
      ${qrImgUrl ? `<p style="color:#64748B;margin:20px 0 8px">Or scan with your phone:</p><img src="${qrImgUrl}" width="180" height="180" alt="Scan to record install" style="border:1px solid #E6E8EC;border-radius:12px"/>` : ""}
      <p style="color:#94A3B8;font-size:12px;margin-top:20px">A photo and signature are required to mark the install complete.</p>
    </div>`;
    const sent = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ to: [inst.email], subject: `Install request: ${ymm}${product ? ` — ${product}` : ""}`, html }),
    }).catch(() => null);
    if (sent && sent.ok) sentCount++;
  }

  if (sentCount > 0) {
    try {
      await admin.from("audit_log").insert({
        action: "installer_notified", entity_type: "vehicle", entity_id: vin, store_id: tenantId, details: { installers: sentCount },
      });
    } catch { /* best-effort */ }
  }
  return json(200, { ok: sentCount > 0, notified: sentCount });
});
