import { qrcode } from "https://deno.land/x/qrcode@v2.0.0/mod.ts";
import { json, preflight } from "../_shared/http.ts";
import { SUPABASE_URL, SERVICE_KEY, adminClient, isServiceOrCron } from "../_shared/supabase.ts";

// ──────────────────────────────────────────────────────────────────────
// notify-getready — emails the detail department the per-vehicle Get-Ready
// link + QR on intake, with the dealer's standing detail instructions. The
// detailer taps the link (phone) or scans the QR to open /ready/:token and
// sign off the cleaning / pre-install work.
//
// Body: { tenant_id, vin }
// Recipient: settings.detail_email, else the onboarding email.
// Auth: service-role / cron-secret (called by ingest-orchestrate).
// ──────────────────────────────────────────────────────────────────────

const APP_BASE = Deno.env.get("APP_BASE_URL") || "https://autolabels.io";
const splitEmails = (s: string) => s.split(/[\n,;]+/).map((e) => e.trim()).filter((e) => /.+@.+\..+/.test(e));
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

  const { data: prof } = await admin.from("dealer_profiles").select("settings").eq("tenant_id", tenantId).maybeSingle();
  const settings = (prof?.settings || {}) as Record<string, string>;
  let recipients = splitEmails(settings.detail_email || "");
  const { data: ten } = await admin.from("tenants").select("primary_email").eq("id", tenantId).maybeSingle();
  if (recipients.length === 0 && ten?.primary_email) recipients = splitEmails(ten.primary_email as string);
  if (recipients.length === 0) return json(200, { ok: false, error: "no_recipient" });
  recipients = recipients.slice(0, 3);

  // The permanent Get-Ready hub token (minted at intake). Don't create one here
  // — if it isn't there yet, there's nothing to dispatch to.
  const { data: tok } = await admin.from("dept_signoff_tokens")
    .select("token, ymm").eq("tenant_id", tenantId).eq("vin", vin).eq("purpose", "get_ready").eq("status", "pending")
    .gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!tok?.token) return json(200, { ok: false, error: "no_token" });
  const ymm = (tok.ymm as string) || "Vehicle";
  const readyUrl = `${APP_BASE}/ready/${tok.token}`;
  const instructions = (settings.detail_default_instructions || "").trim();

  let qrImgUrl = "";
  try {
    const dataUrl = await qrcode(readyUrl, { size: 240 }) as string;
    const b64 = dataUrl.split(",")[1];
    if (b64) {
      const qrPath = `${tenantId}/qr/getready-${tok.token}.gif`;
      await admin.storage.from("service-docs").upload(qrPath, b64ToBytes(b64), { contentType: "image/gif", upsert: true });
      qrImgUrl = admin.storage.from("service-docs").getPublicUrl(qrPath).data?.publicUrl || "";
    }
  } catch { /* QR optional — the link button always works */ }

  const html = `
  <div style="font-family:Inter,Arial,sans-serif;max-width:480px;margin:0 auto;color:#0F172A">
    <h2 style="margin:0 0 4px">${ymm} — ready for get-ready</h2>
    <p style="color:#64748B;margin:0 0 16px">VIN ${vin}</p>
    <p style="margin:0 0 16px">This vehicle is in inventory. Please complete the detail / get-ready and sign off from your phone.</p>
    ${instructions ? `<p style="margin:0 0 16px;padding:12px 14px;background:#F1F5F9;border-radius:10px"><b>Instructions:</b> ${instructions}</p>` : ""}
    <a href="${readyUrl}" style="display:inline-block;background:#2563EB;color:#fff;font-weight:bold;text-decoration:none;padding:14px 24px;border-radius:12px">Open Get-Ready</a>
    ${qrImgUrl ? `<p style="color:#64748B;margin:20px 0 8px">Or scan with your phone:</p><img src="${qrImgUrl}" width="180" height="180" alt="Scan to open" style="border:1px solid #E6E8EC;border-radius:12px"/>` : ""}
  </div>`;

  const sent = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify({ to: recipients, subject: `Get-ready: ${ymm}`, html }),
  }).catch(() => null);

  if (sent && sent.ok) {
    try {
      await admin.from("audit_log").insert({
        action: "getready_dispatched", entity_type: "vehicle", entity_id: vin, store_id: tenantId, details: { recipients: recipients.length },
      });
    } catch { /* best-effort */ }
  }
  return json(sent && sent.ok ? 200 : 502, { ok: !!(sent && sent.ok), recipients: recipients.length });
});
