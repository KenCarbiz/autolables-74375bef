import { qrcode } from "https://deno.land/x/qrcode@v2.0.0/mod.ts";
import { json, preflight } from "../_shared/http.ts";
import { SUPABASE_URL, SERVICE_KEY, adminClient } from "../_shared/supabase.ts";

// ──────────────────────────────────────────────────────────────────────
// email-title-request — emails the office a per-vehicle Title/MCO upload link
// + QR. The office taps the link (phone) or scans the QR (from a desktop) to
// open /title/:token and upload the title (used) or MCO (new), front + back.
//
// Body: { tenant_id, vin, to? }  — recipient falls back to the tenant's
//   settings.title_clerk_email, then the onboarding email.
// Auth: service-role (called by the vehicle file via the app, or by intake).
// ──────────────────────────────────────────────────────────────────────

const APP_BASE = Deno.env.get("APP_BASE_URL") || "https://autolabels.io";

const hex16 = () => {
  const b = new Uint8Array(16); crypto.getRandomValues(b);
  return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
};
const b64ToBytes = (b64: string) => {
  const bin = atob(b64); const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  const body = await req.json().catch(() => ({})) as { tenant_id?: string; vin?: string; to?: string };
  const tenantId = body.tenant_id;
  const vin = (body.vin || "").toUpperCase().trim();
  if (!tenantId || !vin) return json(400, { error: "tenant_id and vin required" });

  const admin = adminClient();

  // Vehicle context for the email.
  const { data: listing } = await admin.from("vehicle_listings").select("id, ymm, condition").eq("tenant_id", tenantId).eq("vin", vin).maybeSingle();
  const { data: vf } = await admin.from("vehicle_files").select("stock_number").eq("tenant_id", tenantId).eq("vin", vin).maybeSingle();
  const ymm = listing?.ymm || "Vehicle";
  const stock = vf?.stock_number || "";
  const isNew = String(listing?.condition || "").toLowerCase() === "new";
  const docName = isNew ? "Manufacturer's Certificate of Origin (MCO)" : "vehicle Title";

  // Recipients: explicit → tenant setting (may be several, comma/newline-
  // separated, e.g. a backup clerk when someone's out) → onboarding email.
  const splitEmails = (s: string) => s.split(/[,;\n]/).map((x) => x.trim()).filter((x) => /.+@.+\..+/.test(x));
  const { data: prof } = await admin.from("dealer_profiles").select("settings").eq("tenant_id", tenantId).maybeSingle();
  const settings = (prof?.settings || {}) as Record<string, string>;
  let recipients = body.to ? splitEmails(body.to) : splitEmails(settings.title_clerk_email || "");
  const { data: ob } = await admin.from("onboarding_profiles").select("display_name, email").eq("tenant_id", tenantId).maybeSingle();
  const dealerName = (ob?.display_name as string) || "";
  if (recipients.length === 0 && ob?.email) recipients = splitEmails(ob.email as string);
  if (recipients.length === 0) return json(400, { error: "no recipient — set a title clerk email in Settings" });

  // Round-robin: when enabled, email a single clerk and rotate to the next on
  // each re-send for this vehicle, instead of emailing everyone at once. The
  // rotation index is the count of prior title sends for this VIN, so each
  // reminder lands on a different person until the title is filed.
  if (!body.to && recipients.length > 1 && String(settings.title_round_robin) === "true") {
    const { count } = await admin.from("audit_log")
      .select("id", { count: "exact", head: true })
      .eq("store_id", tenantId).eq("action", "title_request_emailed").eq("entity_id", vin);
    recipients = [recipients[(count || 0) % recipients.length]];
  }

  // Mint or reuse a long-lived title-upload token.
  let token: string | undefined;
  const { data: existing } = await admin.from("dept_signoff_tokens")
    .select("token").eq("tenant_id", tenantId).eq("vin", vin).eq("purpose", "title_upload").eq("status", "pending")
    .gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }).limit(1).maybeSingle();
  token = existing?.token;
  if (!token) {
    token = hex16();
    const expires = new Date(Date.now() + 365 * 864e5).toISOString();
    await admin.from("dept_signoff_tokens").insert({
      tenant_id: tenantId, vehicle_listing_id: listing?.id ?? null, vin, ymm, stock_number: stock || null,
      department: "vehicle", purpose: "title_upload", token, expires_at: expires,
    });
  }

  const uploadUrl = `${APP_BASE}/title/${token}`;

  // QR hosted in the public bucket so it renders inline in any email client.
  let qrImgUrl = "";
  try {
    const dataUrl = await qrcode(uploadUrl, { size: 240 }) as string;
    const b64 = dataUrl.split(",")[1];
    if (b64) {
      const qrPath = `${tenantId}/qr/title-${token}.gif`;
      await admin.storage.from("service-docs").upload(qrPath, b64ToBytes(b64), { contentType: "image/gif", upsert: true });
      qrImgUrl = admin.storage.from("service-docs").getPublicUrl(qrPath).data?.publicUrl || "";
    }
  } catch { /* QR optional — the link button always works */ }

  const subject = `Upload the ${isNew ? "MCO" : "title"} — ${ymm}${stock ? ` (Stock ${stock})` : ""}`;
  const html = `
  <div style="font-family:Inter,Arial,sans-serif;max-width:480px;margin:0 auto;color:#0F172A">
    <h2 style="margin:0 0 4px">${ymm} is in inventory</h2>
    <p style="color:#64748B;margin:0 0 16px">${stock ? `Stock ${stock} · ` : ""}VIN ${vin}</p>
    <p style="margin:0 0 16px">Please upload a copy of the <b>${docName}</b> (front and back) for this vehicle.</p>
    <a href="${uploadUrl}" style="display:inline-block;background:#2563EB;color:#fff;font-weight:bold;text-decoration:none;padding:14px 24px;border-radius:12px">Upload ${isNew ? "MCO" : "Title"}</a>
    ${qrImgUrl ? `<p style="color:#64748B;margin:20px 0 8px">Or scan with your phone:</p><img src="${qrImgUrl}" width="180" height="180" alt="Scan to upload" style="border:1px solid #E6E8EC;border-radius:12px"/>` : ""}
    <p style="color:#94A3B8;font-size:12px;margin-top:20px">Stored securely for dealership use only — never shown to shoppers.</p>
  </div>`;

  void dealerName;
  const sent = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify({ to: recipients, subject, html }),
  });
  if (!sent.ok) {
    const e = await sent.text().catch(() => "");
    return json(502, { error: "email_failed", detail: e.slice(0, 300) });
  }
  // Record the send so the reminder sweep can pace re-sends per vehicle.
  try {
    await admin.from("audit_log").insert({
      action: "title_request_emailed", entity_type: "vehicle_listing", entity_id: vin, store_id: tenantId,
      details: { recipients, doc: isNew ? "mco" : "title" },
    });
  } catch { /* best-effort */ }
  return json(200, { ok: true, recipients, upload_url: uploadUrl });
});
