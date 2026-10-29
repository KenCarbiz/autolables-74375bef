// ──────────────────────────────────────────────────────────────────────
// provider-budget-alerts — deliver the dealership budget alerts that
// provider_call_admit queues (provider_budget_alerts) to the platform's super
// admins, by email, text message or both, as platform_alert_settings says.
//
// Body:
//   {}                          deliver pending alerts (cron, every 10 minutes
//                               once schedule_provider_budget_alerts() is run)
//   { action: "test", email?: boolean, sms?: boolean }
//                               send one test message to the saved recipients
//                               on the chosen channels (platform admin only)
//
// Auth: service role or cron secret for delivery; a platform admin's session
// for delivery or a test. Sends go through send-email and send-sms with the
// service role, so recipients are the saved super-admin list only.
// ──────────────────────────────────────────────────────────────────────
import { json, preflight, htmlEscape } from "../_shared/http.ts";
import { adminClient, isServiceOrCron, SERVICE_KEY, SUPABASE_URL } from "../_shared/supabase.ts";
import {
  type AlertSettings, type BudgetAlertRow, type Channel, type ChannelStatus,
  channelResult, composeAlert, isSettled, planDelivery,
} from "../_shared/budgetAlerts.ts";

const APP_BASE = Deno.env.get("APP_BASE_URL") || "https://autolabels.io";
const ADMIN_URL = `${APP_BASE}/platform-admin?tab=budgets`;
const BATCH = 50;

async function sendEmail(to: string[], subject: string, html: string): Promise<boolean> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ to, subject, html }),
      signal: AbortSignal.timeout(20000),
    });
    return res.ok;
  } catch { return false; }
}

async function sendSms(to: string, body: string): Promise<boolean> {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/send-sms`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ to, body }),
      signal: AbortSignal.timeout(20000),
    });
    return res.ok;
  } catch { return false; }
}

async function deliver(ch: Channel, s: AlertSettings, subject: string, text: string, html: string): Promise<ChannelStatus> {
  if (ch === "email") return channelResult([await sendEmail(s.email_recipients, subject, html)]);
  const results: boolean[] = [];
  for (const phone of s.sms_recipients) results.push(await sendSms(phone, text));
  return channelResult(results);
}

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const admin = adminClient();
  let actor: string | null = null;
  if (!isServiceOrCron(req)) {
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: ures } = jwt ? await admin.auth.getUser(jwt) : { data: null };
    const uid = ures?.user?.id;
    if (!uid) return json(401, { error: "unauthorized" });
    const { data: role } = await admin.from("user_roles").select("role").eq("user_id", uid).eq("role", "admin").maybeSingle();
    if (!role) return json(403, { error: "platform_admin_required" });
    actor = uid;
  }

  const body = await req.json().catch(() => ({})) as { action?: string; email?: boolean; sms?: boolean };
  const { data: settingsRow, error: settingsErr } = await admin.from("platform_alert_settings")
    .select("email_enabled, sms_enabled, email_recipients, sms_recipients").eq("id", true).maybeSingle();
  if (settingsErr) return json(503, { error: "not_migrated", detail: settingsErr.message });
  const settings: AlertSettings = {
    email_enabled: !!settingsRow?.email_enabled,
    sms_enabled: !!settingsRow?.sms_enabled,
    email_recipients: (settingsRow?.email_recipients as string[] | null) ?? [],
    sms_recipients: (settingsRow?.sms_recipients as string[] | null) ?? [],
  };

  if (body.action === "test") {
    if (!actor) return json(403, { error: "a test is sent from a platform admin's session" });
    const channels: Channel[] = [];
    if (body.email !== false && settings.email_recipients.length) channels.push("email");
    if (body.sms !== false && settings.sms_recipients.length) channels.push("sms");
    if (!channels.length) return json(400, { error: "no_recipients", detail: "Save at least one recipient for the chosen channel first." });
    const subject = "AutoLabels budget alert - test";
    const text = "AutoLabels budget alerts: this is a test. Dealership budget alerts will arrive on this channel.";
    const html = `<div style="font-family:Inter,Arial,sans-serif;color:#0F172A"><h2>Budget alerts test</h2><p>${htmlEscape(text)}</p><p><a href="${htmlEscape(ADMIN_URL)}">Review budgets</a></p></div>`;
    const result: Partial<Record<Channel, ChannelStatus>> = {};
    for (const ch of channels) result[ch] = await deliver(ch, settings, subject, text, html);
    try {
      await admin.from("audit_log").insert({
        action: "platform_alert_test_sent", entity_type: "platform_alert_settings", entity_id: "budget_alerts",
        user_id: actor, details: { result },
      });
    } catch { /* the send already happened; the audit row is best-effort */ }
    return json(200, { ok: true, result });
  }

  const { data: pending, error: pendErr } = await admin.from("provider_budget_alerts")
    .select("id, tenant_id, provider, month, kind, threshold, mode, calls, usd, monthly_call_cap, monthly_usd_cap, caller, email_status, sms_status, attempts")
    .is("delivered_at", null).order("created_at", { ascending: true }).limit(BATCH);
  if (pendErr) return json(503, { error: "not_migrated", detail: pendErr.message });
  const alerts = (pending || []) as BudgetAlertRow[];
  if (!alerts.length) return json(200, { ok: true, pending: 0 });

  const tenantIds = [...new Set(alerts.map((a) => a.tenant_id))];
  const { data: tenants } = await admin.from("tenants").select("id, name").in("id", tenantIds);
  const names = new Map(((tenants || []) as Array<{ id: string; name: string | null }>).map((t) => [t.id, t.name || "Dealership"]));

  const summary = { pending: alerts.length, delivered: 0, retrying: 0, sent: { email: 0, sms: 0 }, failed: { email: 0, sms: 0 } };
  for (const a of alerts) {
    const { send, settled } = planDelivery(a, settings);
    const status: Record<Channel, ChannelStatus> = { email: a.email_status, sms: a.sms_status, ...settled };
    const msg = composeAlert(a, names.get(a.tenant_id) || "Dealership", ADMIN_URL, htmlEscape);
    for (const ch of send) {
      status[ch] = await deliver(ch, settings, msg.subject, msg.text, msg.html);
      if (status[ch] === "sent") summary.sent[ch]++; else summary.failed[ch]++;
    }
    const attempts = a.attempts + (send.length ? 1 : 0);
    const done = isSettled(status.email, status.sms, attempts);
    await admin.from("provider_budget_alerts").update({
      email_status: status.email, sms_status: status.sms, attempts,
      last_error: send.some((ch) => status[ch] === "failed") ? `failed: ${send.filter((ch) => status[ch] === "failed").join(", ")}` : null,
      delivered_at: done ? new Date().toISOString() : null,
    }).eq("id", a.id);
    if (done) summary.delivered++; else summary.retrying++;
  }
  return json(200, { ok: true, ...summary });
});
