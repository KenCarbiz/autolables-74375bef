// Budget alerts for the platform's super admins: what each alert says, and
// which channels a delivery attempt should still try. Pure, so the dispatcher
// (provider-budget-alerts) and the tests read the same rules.
//
// Channels follow platform_alert_settings: email, text message, or both. A
// channel that is switched off is recorded as "disabled" and never retried; a
// channel that failed is retried on the next run until MAX_ATTEMPTS, and a
// channel that was sent is never sent again.

export const MAX_ATTEMPTS = 5;

export type Channel = "email" | "sms";
export type ChannelStatus = "sent" | "failed" | "disabled" | "no_recipients" | null;

export interface AlertSettings {
  email_enabled: boolean;
  sms_enabled: boolean;
  email_recipients: string[];
  sms_recipients: string[];
}

export interface BudgetAlertRow {
  id: number;
  tenant_id: string;
  provider: string;
  month: string;
  kind: "threshold" | "call_denied";
  threshold: number;
  mode: string;
  calls: number;
  usd: number | string;
  monthly_call_cap: number | null;
  monthly_usd_cap: number | string | null;
  caller: string | null;
  email_status: ChannelStatus;
  sms_status: ChannelStatus;
  attempts: number;
}

const money = (v: number | string | null): string | null => {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? `$${n.toFixed(2)}` : null;
};

export const providerLabel = (p: string): string => (p === "*" ? "all providers" : p);

export function monthLabel(month: string): string {
  const d = new Date(`${month.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? month : d.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

export function usageLine(a: BudgetAlertRow): string {
  const parts: string[] = [];
  parts.push(a.monthly_call_cap != null ? `${a.calls} of ${a.monthly_call_cap} calls` : `${a.calls} calls`);
  const usd = money(a.usd);
  const cap = money(a.monthly_usd_cap);
  if (cap) parts.push(`${usd ?? "$0.00"} of ${cap}`);
  else if (usd && Number(a.usd) > 0) parts.push(`${usd} estimated`);
  return parts.join(", ");
}

export function headline(a: BudgetAlertRow, dealer: string): string {
  const what = providerLabel(a.provider);
  if (a.kind === "call_denied") return `${dealer}: ${what} budget reached, calls are being refused`;
  return `${dealer}: ${what} budget at ${a.threshold}%`;
}

export interface ComposedAlert {
  subject: string;
  text: string;
  html: string;
}

export function composeAlert(a: BudgetAlertRow, dealer: string, adminUrl: string, esc: (v: unknown) => string): ComposedAlert {
  const subject = `AutoLabels budget alert - ${headline(a, dealer)}`;
  const modeNote = a.kind === "call_denied"
    ? "This budget is enforced, so further calls this month are refused until the budget is raised or the month ends."
    : a.mode === "enforce"
    ? "This budget is enforced: calls are refused once it is used up."
    : "This budget only alerts; calls are not refused.";
  const usage = usageLine(a);
  const text = `${headline(a, dealer)}. ${monthLabel(a.month)}: ${usage}. ${modeNote} Review: ${adminUrl}`;
  const html = `
  <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;color:#0F172A">
    <h2 style="margin:0 0 6px">${esc(headline(a, dealer))}</h2>
    <p style="color:#64748B;margin:0 0 12px">${esc(monthLabel(a.month))}</p>
    <table style="border-collapse:collapse;width:100%;font-size:14px">
      <tr><td style="padding:6px 10px;border-bottom:1px solid #E6E8EC">Provider</td><td style="padding:6px 10px;border-bottom:1px solid #E6E8EC">${esc(providerLabel(a.provider))}</td></tr>
      <tr><td style="padding:6px 10px;border-bottom:1px solid #E6E8EC">Used this month</td><td style="padding:6px 10px;border-bottom:1px solid #E6E8EC">${esc(usage)}</td></tr>
      <tr><td style="padding:6px 10px;border-bottom:1px solid #E6E8EC">Budget mode</td><td style="padding:6px 10px;border-bottom:1px solid #E6E8EC">${esc(a.mode === "enforce" ? "Enforce" : "Alert only")}</td></tr>
      ${a.caller ? `<tr><td style="padding:6px 10px;border-bottom:1px solid #E6E8EC">Last caller</td><td style="padding:6px 10px;border-bottom:1px solid #E6E8EC">${esc(a.caller)}</td></tr>` : ""}
    </table>
    <p style="margin:14px 0">${esc(modeNote)}</p>
    <p style="margin:18px 0"><a href="${esc(adminUrl)}" style="display:inline-block;background:#2563EB;color:#fff;font-weight:bold;text-decoration:none;padding:12px 22px;border-radius:10px">Review budgets</a></p>
  </div>`;
  return { subject, text: text.slice(0, 600), html };
}

// The channels this attempt should send on, and the status to record now for
// the channels it should not.
export function planDelivery(a: Pick<BudgetAlertRow, "email_status" | "sms_status">, s: AlertSettings): {
  send: Channel[];
  settled: Partial<Record<Channel, ChannelStatus>>;
} {
  const send: Channel[] = [];
  const settled: Partial<Record<Channel, ChannelStatus>> = {};
  const plan = (ch: Channel, enabled: boolean, recipients: string[], current: ChannelStatus) => {
    if (current === "sent" || current === "disabled" || current === "no_recipients") return;
    if (!enabled) settled[ch] = "disabled";
    else if (!recipients.length) settled[ch] = "no_recipients";
    else send.push(ch);
  };
  plan("email", s.email_enabled, s.email_recipients, a.email_status);
  plan("sms", s.sms_enabled, s.sms_recipients, a.sms_status);
  return { send, settled };
}

// Delivered when no channel is waiting on a retry, or retries are used up.
export function isSettled(email: ChannelStatus, sms: ChannelStatus, attempts: number): boolean {
  const waiting = (st: ChannelStatus) => st === null || st === "failed";
  return attempts >= MAX_ATTEMPTS || (!waiting(email) && !waiting(sms));
}

// A channel succeeds when every recipient on it was sent to.
export function channelResult(results: boolean[]): ChannelStatus {
  return results.length > 0 && results.every(Boolean) ? "sent" : "failed";
}
