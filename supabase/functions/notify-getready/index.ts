import { qrcode } from "https://deno.land/x/qrcode@v2.0.0/mod.ts";
import { json, preflight, htmlEscape } from "../_shared/http.ts";
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

// Roles that hold can_approve_print (mirrors dealerRoleCapabilities.ts). Keep in
// sync with the accept_addendum SQL guard.
const MANAGER_ROLES = new Set([
  "owner", "general_manager", "gsm", "admin", "manager",
  "sales_manager", "used_car_manager", "inventory_manager",
]);

// Member-scoped auth: validate the caller's user JWT, then confirm they are an
// accepted manager member of the tenant (or a platform admin). Lets a manager
// dispatch the Get-Ready on addendum acceptance from the app.
// deno-lint-ignore no-explicit-any
async function isManagerMember(admin: any, req: Request, tenantId: string): Promise<boolean> {
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return false;
  const { data: u } = await admin.auth.getUser(jwt);
  const uid = u?.user?.id;
  if (!uid) return false;
  const { data: pa } = await admin.from("user_roles").select("role").eq("user_id", uid).eq("role", "admin").maybeSingle();
  if (pa) return true;
  const { data: m } = await admin.from("tenant_members")
    .select("role").eq("tenant_id", tenantId).eq("user_id", uid).not("accepted_at", "is", null).maybeSingle();
  return !!m && MANAGER_ROLES.has(String(m.role));
}

const splitEmails = (s: string) => s.split(/[\n,;]+/).map((e) => e.trim()).filter((e) => /.+@.+\..+/.test(e));
const b64ToBytes = (b64: string) => { const bin = atob(b64); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; };

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  const body = await req.json().catch(() => ({})) as { tenant_id?: string; vin?: string };
  const tenantId = body.tenant_id;
  const vin = (body.vin || "").toUpperCase().trim();
  if (!tenantId || !vin) return json(400, { error: "tenant_id and vin required" });

  const admin = adminClient();

  // Auth: server callers (ingest-orchestrate, cron) use the service/cron gate.
  // A logged-in manager may also dispatch on addendum acceptance — accept a
  // valid user JWT when the caller is an accepted manager member of the tenant.
  if (!isServiceOrCron(req) && !(await isManagerMember(admin, req, tenantId))) {
    return json(401, { error: "unauthorized" });
  }

  const { data: prof } = await admin.from("dealer_profiles").select("settings").eq("tenant_id", tenantId).maybeSingle();
  const settings = (prof?.settings || {}) as Record<string, string>;

  // The permanent Get-Ready hub token (minted at intake). Don't create one here
  // — if it isn't there yet, there's nothing to dispatch to.
  const { data: tok } = await admin.from("dept_signoff_tokens")
    .select("token, ymm").eq("tenant_id", tenantId).eq("vin", vin).eq("purpose", "get_ready").eq("status", "pending")
    .gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!tok?.token) return json(200, { ok: false, error: "no_token" });
  const ymm = (tok.ymm as string) || "Vehicle";

  // Per-department fanout. Each department gets its OWN work order: a link
  // scoped to only its stations (?dept=...), its own instructions, its own
  // recipients. Service K-208 never lands on the detail sheet and vice versa.
  // Detail is the default target; service is added when a service email is set.
  const detailEmails = splitEmails(settings.detail_email || "");
  const serviceEmails = splitEmails(settings.service_email || "");
  type Target = { dept: string; subject: string; blurb: string; recipients: string[]; instructions: string };
  const targets: Target[] = [];
  if (detailEmails.length) targets.push({
    dept: "detail", subject: `Get-ready: ${ymm}`,
    blurb: "This vehicle is in inventory. Please complete the detail / get-ready and sign off from your phone.",
    recipients: detailEmails.slice(0, 3), instructions: (settings.detail_default_instructions || "").trim(),
  });
  if (serviceEmails.length) targets.push({
    dept: "service", subject: `Safety inspection: ${ymm}`,
    blurb: "This vehicle needs its safety inspection (K-208) before it can be sold. Please complete and sign off from your phone.",
    recipients: serviceEmails.slice(0, 3), instructions: (settings.service_default_instructions || "").trim(),
  });
  // Fallback: no department email configured — dispatch the detail work order
  // to the dealership's primary email so nothing is silently dropped.
  if (targets.length === 0) {
    const { data: ten } = await admin.from("tenants").select("primary_email").eq("id", tenantId).maybeSingle();
    const fb = splitEmails((ten?.primary_email as string) || "");
    if (fb.length) targets.push({
      dept: "detail", subject: `Get-ready: ${ymm}`,
      blurb: "This vehicle is in inventory. Please complete the detail / get-ready and sign off from your phone.",
      recipients: fb.slice(0, 3), instructions: (settings.detail_default_instructions || "").trim(),
    });
  }
  if (targets.length === 0) return json(200, { ok: false, error: "no_recipient" });

  let anySent = false;
  const dispatched: { dept: string; ok: boolean; recipients: number }[] = [];
  for (const t of targets) {
    const readyUrl = `${APP_BASE}/ready/${tok.token}?dept=${t.dept}`;
    let qrImgUrl = "";
    try {
      const dataUrl = await qrcode(readyUrl, { size: 240 }) as string;
      const b64 = dataUrl.split(",")[1];
      if (b64) {
        const qrPath = `${tenantId}/qr/getready-${tok.token}-${t.dept}.gif`;
        await admin.storage.from("service-docs").upload(qrPath, b64ToBytes(b64), { contentType: "image/gif", upsert: true });
        qrImgUrl = admin.storage.from("service-docs").getPublicUrl(qrPath).data?.publicUrl || "";
      }
    } catch { /* QR optional — the link button always works */ }

    const html = `
    <div style="font-family:Inter,Arial,sans-serif;max-width:480px;margin:0 auto;color:#0F172A">
      <h2 style="margin:0 0 4px">${htmlEscape(ymm)}</h2>
      <p style="color:#64748B;margin:0 0 16px">VIN ${htmlEscape(vin)}</p>
      <p style="margin:0 0 16px">${htmlEscape(t.blurb)}</p>
      ${t.instructions ? `<p style="margin:0 0 16px;padding:12px 14px;background:#F1F5F9;border-radius:10px"><b>Instructions:</b> ${htmlEscape(t.instructions)}</p>` : ""}
      <a href="${readyUrl}" style="display:inline-block;background:#2563EB;color:#fff;font-weight:bold;text-decoration:none;padding:14px 24px;border-radius:12px">Open work order</a>
      ${qrImgUrl ? `<p style="color:#64748B;margin:20px 0 8px">Or scan with your phone:</p><img src="${qrImgUrl}" width="180" height="180" alt="Scan to open" style="border:1px solid #E6E8EC;border-radius:12px"/>` : ""}
    </div>`;

    const sent = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ to: t.recipients, subject: t.subject, html }),
    }).catch(() => null);
    const ok = !!(sent && sent.ok);
    if (ok) {
      anySent = true;
      try {
        await admin.from("audit_log").insert({
          action: "getready_dispatched", entity_type: "vehicle", entity_id: vin, store_id: tenantId,
          details: { dept: t.dept, recipients: t.recipients.length },
        });
      } catch { /* best-effort */ }
    }
    dispatched.push({ dept: t.dept, ok, recipients: t.recipients.length });
  }

  return json(anySent ? 200 : 502, { ok: anySent, dispatched });
});
