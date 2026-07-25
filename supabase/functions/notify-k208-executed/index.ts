import { json, preflight, htmlEscape } from "../_shared/http.ts";
import { SUPABASE_URL, SERVICE_KEY, adminClient, isServiceOrCron } from "../_shared/supabase.ts";

// ──────────────────────────────────────────────────────────────────────
// notify-k208-executed — emails the sales manager when a K-208 safety
// inspection is EXECUTED (signed with a non-fail result), per INTAKE_SPEC S9.
// Invoked asynchronously by the trg_notify_on_k208_execution trigger via
// pg_net, so a delivery failure can never block signing.
//
// Body: { tenant_id, vin, inspection_id? }
// Recipient precedence: settings.sales_manager_email (honored when the dealer
// sets it; no settings UI writes it yet), else settings.recon_approval_email,
// else the tenant's primary email.
// Auth: service-role / cron-secret only.
// ──────────────────────────────────────────────────────────────────────

const splitEmails = (s: string) => s.split(/[\n,;]+/).map((e) => e.trim()).filter((e) => /.+@.+\..+/.test(e));

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  const body = await req.json().catch(() => ({})) as { tenant_id?: string; vin?: string; inspection_id?: string };
  const tenantId = body.tenant_id;
  const vin = (body.vin || "").toUpperCase().trim();
  const inspectionId = (body.inspection_id || "").trim();
  if (!tenantId || !vin) return json(400, { error: "tenant_id and vin required" });

  const admin = adminClient();
  if (!isServiceOrCron(req)) return json(401, { error: "unauthorized" });

  // Dedupe: the trigger only fires on the executed transition, but a signed row
  // re-saved with a result edit could re-fire — one email per inspection.
  if (inspectionId) {
    const { data: prior } = await admin.from("audit_log")
      .select("id").eq("action", "k208_execution_notified").eq("entity_type", "vehicle").eq("entity_id", vin)
      .filter("details->>inspection_id", "eq", inspectionId).limit(1).maybeSingle();
    if (prior) return json(200, { ok: true, skipped: "already_notified" });
  }

  const { data: insp } = inspectionId
    ? await admin.from("safety_inspections")
      .select("inspector_name, signed_at, result, ymm").eq("id", inspectionId).eq("tenant_id", tenantId).maybeSingle()
    : { data: null };

  const { data: prof } = await admin.from("dealer_profiles").select("settings").eq("tenant_id", tenantId).maybeSingle();
  const settings = (prof?.settings || {}) as Record<string, string>;
  let recipients = splitEmails(settings.sales_manager_email || "");
  if (!recipients.length) recipients = splitEmails(settings.recon_approval_email || "");
  if (!recipients.length) {
    const { data: ten } = await admin.from("tenants").select("primary_email").eq("id", tenantId).maybeSingle();
    recipients = splitEmails((ten?.primary_email as string) || "");
  }
  if (!recipients.length) return json(200, { ok: false, error: "no_recipient" });

  const ymm = (insp?.ymm as string) || "Vehicle";
  const signedAt = insp?.signed_at ? new Date(insp.signed_at as string).toLocaleString("en-US", { timeZone: "America/New_York", timeZoneName: "short" }) : "";
  const html = `
  <div style="font-family:Inter,Arial,sans-serif;max-width:480px;margin:0 auto;color:#0F172A">
    <h2 style="margin:0 0 4px">${htmlEscape(ymm)}</h2>
    <p style="color:#64748B;margin:0 0 16px">VIN ${htmlEscape(vin)}</p>
    <p style="margin:0 0 16px">The CT K-208 safety inspection for this vehicle has been completed and signed${insp?.inspector_name ? ` by ${htmlEscape(insp.inspector_name)}` : ""}${signedAt ? ` on ${htmlEscape(signedAt)}` : ""}.</p>
    <p style="margin:0 0 16px;padding:12px 14px;background:#F1F5F9;border-radius:10px">The executed K-208 is now published to the customer's Passport documents, and delivery readiness has been updated.</p>
  </div>`;

  const sent = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify({ to: recipients.slice(0, 3), subject: `K-208 executed: ${ymm}`, html }),
  }).catch(() => null);
  const ok = !!(sent && sent.ok);

  if (ok) {
    try {
      await admin.from("audit_log").insert({
        action: "k208_execution_notified", entity_type: "vehicle", entity_id: vin, store_id: tenantId,
        details: { inspection_id: inspectionId || null, recipients: recipients.length },
      });
    } catch { /* audit is best-effort */ }
  }

  return json(ok ? 200 : 502, { ok, recipients: recipients.length });
});
