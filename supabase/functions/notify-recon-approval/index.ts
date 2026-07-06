import { json, preflight } from "../_shared/http.ts";
import { SUPABASE_URL, SERVICE_KEY, adminClient } from "../_shared/supabase.ts";

// ──────────────────────────────────────────────────────────────────────
// notify-recon-approval — emails the used-car manager the one-tap approve/
// decline link when a recon estimate has line items awaiting a decision.
// Called (anon, with the estimate's approval token as the capability) right
// after service submits a worksheet that isn't fully auto-approved.
//
// Body: { approval_token }
// Recipients: dealer settings.recon_approval_email, else the dealership's main
//   onboarding email. Sent via the service-role send-email function.
// ──────────────────────────────────────────────────────────────────────

const APP_BASE = Deno.env.get("APP_BASE_URL") || "https://autolabels.io";
const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const splitEmails = (s: string) => s.split(/[\n,;]+/).map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@"));

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  const { approval_token } = await req.json().catch(() => ({}));
  if (!approval_token || typeof approval_token !== "string") return json(400, { ok: false, error: "approval_token required" });

  const admin = adminClient();

  const { data: est } = await admin.from("recon_estimates")
    .select("id, tenant_id, vin, ymm, status").eq("approval_token", approval_token).maybeSingle();
  if (!est) return json(404, { ok: false, error: "not_found" });

  // Pending lines only — nothing to decide if everything auto-approved.
  const { data: pending } = await admin.from("recon_estimate_lines")
    .select("description, line_total").eq("estimate_id", est.id).eq("approval_status", "pending");
  const pendingLines = (pending || []) as { description: string; line_total: number }[];
  if (!pendingLines.length) return json(200, { ok: true, skipped: "nothing_pending" });

  // Recipients: configured UCM email(s), else the dealership's onboarding email.
  const { data: prof } = await admin.from("dealer_profiles").select("settings").eq("tenant_id", est.tenant_id).maybeSingle();
  const settings = (prof?.settings || {}) as Record<string, string>;
  let recipients = splitEmails(settings.recon_approval_email || "");
  if (!recipients.length) {
    const { data: ten } = await admin.from("tenants").select("primary_email").eq("id", est.tenant_id).maybeSingle();
    if (ten?.primary_email) recipients = splitEmails(ten.primary_email as string);
  }
  if (!recipients.length) return json(200, { ok: false, error: "no_recipient" });

  const total = pendingLines.reduce((s, l) => s + (Number(l.line_total) || 0), 0);
  const ymm = est.ymm || "Vehicle";
  const approveUrl = `${APP_BASE}/approve/${approval_token}`;
  const rows = pendingLines.slice(0, 12).map((l) =>
    `<tr><td style="padding:6px 0;font-size:14px;color:#0F172A">${l.description}</td><td style="padding:6px 0;font-size:14px;text-align:right;color:#0F172A;font-weight:600">${money(Number(l.line_total) || 0)}</td></tr>`).join("");

  const html = `
    <div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:0 auto;color:#0F172A">
      <p style="font-size:15px;margin:0 0 4px">Recon work needs your approval:</p>
      <h2 style="font-size:20px;margin:8px 0 2px">${ymm}</h2>
      <p style="font-size:13px;color:#64748B;margin:0 0 14px">VIN ${est.vin} &middot; ${pendingLines.length} item${pendingLines.length === 1 ? "" : "s"} &middot; ${money(total)}</p>
      <table style="width:100%;border-collapse:collapse;border-top:1px solid #E6E8EC;border-bottom:1px solid #E6E8EC;margin:0 0 16px">${rows}</table>
      <a href="${approveUrl}" style="display:inline-block;background:#2563EB;color:#fff;text-decoration:none;padding:12px 20px;border-radius:12px;font-weight:600;font-size:14px">Review &amp; approve</a>
      <p style="font-size:12px;color:#94A3B8;margin:18px 0 0">Approve or decline each item from your phone &mdash; no login needed. Items under your auto-approve amount already cleared.</p>
    </div>`;

  const res = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify({ to: recipients, subject: `Recon approval needed: ${ymm} (${money(total)})`, html }),
  }).catch(() => null);

  return json(res && res.ok ? 200 : 502, { ok: !!(res && res.ok), recipients: recipients.length });
});
