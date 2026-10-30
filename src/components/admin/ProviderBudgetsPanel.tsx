import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Switch } from "@/components/ui/switch";
import { AlertTriangle, BellRing, Mail, MessageSquare, Pencil, Plus, RefreshCw, Send, Trash2, Wallet } from "lucide-react";
import {
  BUDGET_PROVIDERS, CHANNEL_STATUS_LABEL, MODE_LABEL, budgetPayload, isMissingSchema, parseEmails, parsePhones,
  percentUsed, providerLabel, type BudgetForm, type BudgetMode,
} from "@/lib/admin/providerBudgets";

// ──────────────────────────────────────────────────────────────────────
// Budgets & alerts — per-dealership provider budgets and the super-admin
// alert channels. PLATFORM-ADMIN ONLY: the route gate is the primary control,
// the isAdmin check below is the second, and every write is a SECURITY
// DEFINER function that checks the admin role again and writes an audit row.
//
// Reads the tables of proposed migration 20261103000000. Until it is applied
// the panel says so instead of showing empty tables.
// ──────────────────────────────────────────────────────────────────────

interface OverviewRow {
  tenant_id: string;
  tenant_name: string | null;
  provider: string;
  mode: BudgetMode | null;
  monthly_call_cap: number | null;
  monthly_usd_cap: number | string | null;
  alert_thresholds: number[] | null;
  block_essential: boolean | null;
  notes: string | null;
  calls: number;
  usd: number | string;
  denied: number;
}
interface AlertRow {
  id: number;
  created_at: string;
  tenant_id: string;
  provider: string;
  kind: string;
  threshold: number;
  email_status: string | null;
  sms_status: string | null;
  attempts: number;
  delivered_at: string | null;
}
interface UnitPrice { provider: string; product: string; usd_per_call: number | string; notes: string | null }
interface Settings { email_enabled: boolean; sms_enabled: boolean; email_recipients: string[]; sms_recipients: string[] }

const usd = (v: number | string | null | undefined) => `$${Number(v ?? 0).toFixed(2)}`;
const EMPTY_FORM: BudgetForm = {
  tenantId: "", provider: "*", mode: "alert_only", callCap: "", usdCap: "", thresholds: "80, 100", notes: "",
};
// deno-lint-ignore no-explicit-any
const db = supabase as any;

export default function ProviderBudgetsPanel() {
  const { isAdmin } = useAuth();
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [rows, setRows] = useState<OverviewRow[]>([]);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [prices, setPrices] = useState<UnitPrice[]>([]);
  const [tenants, setTenants] = useState<Array<{ id: string; name: string }>>([]);
  const [settings, setSettings] = useState<Settings>({ email_enabled: false, sms_enabled: false, email_recipients: [], sms_recipients: [] });
  const [emailsText, setEmailsText] = useState("");
  const [phonesText, setPhonesText] = useState("");
  const [form, setForm] = useState<BudgetForm | null>(null);
  const [priceForm, setPriceForm] = useState({ provider: "firecrawl", product: "*", usd: "" });
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true);
    const ov = await db.rpc("platform_provider_budget_overview");
    if (ov.error) {
      setMissing(isMissingSchema(ov.error));
      if (!isMissingSchema(ov.error)) toast.error(`Could not load budgets: ${ov.error.message}`);
      setLoading(false);
      return;
    }
    setMissing(false);
    setRows((ov.data || []) as OverviewRow[]);
    const [st, al, pr, tn] = await Promise.all([
      db.from("platform_alert_settings").select("email_enabled, sms_enabled, email_recipients, sms_recipients").eq("id", true).maybeSingle(),
      db.from("provider_budget_alerts").select("id, created_at, tenant_id, provider, kind, threshold, email_status, sms_status, attempts, delivered_at")
        .order("created_at", { ascending: false }).limit(25),
      db.from("provider_unit_prices").select("provider, product, usd_per_call, notes").order("provider"),
      db.from("tenants").select("id, name").order("name"),
    ]);
    const s = (st.data || {}) as Partial<Settings>;
    const next = {
      email_enabled: !!s.email_enabled, sms_enabled: !!s.sms_enabled,
      email_recipients: s.email_recipients || [], sms_recipients: s.sms_recipients || [],
    };
    setSettings(next);
    setEmailsText(next.email_recipients.join(", "));
    setPhonesText(next.sms_recipients.join(", "));
    setAlerts((al.data || []) as AlertRow[]);
    setPrices((pr.data || []) as UnitPrice[]);
    setTenants((tn.data || []) as Array<{ id: string; name: string }>);
    setLoading(false);
  };

  useEffect(() => { if (isAdmin) load(); }, [isAdmin]); // eslint-disable-line react-hooks/exhaustive-deps

  const names = useMemo(() => {
    const m: Record<string, string> = {};
    for (const t of tenants) m[t.id] = t.name;
    for (const r of rows) if (r.tenant_name) m[r.tenant_id] = r.tenant_name;
    return m;
  }, [tenants, rows]);

  if (!isAdmin) return null;
  if (loading) return <p className="p-4 text-sm text-muted-foreground">Loading budgets…</p>;

  if (missing) {
    return (
      <div className="rounded-3xl border border-dashed border-border bg-card p-6" data-testid="budgets-migration-pending">
        <h2 className="text-xl font-black tracking-tight text-foreground inline-flex items-center gap-2">
          <Wallet className="w-6 h-6" /> Budgets & alerts
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Per-dealership budgets are not switched on yet: the database change they need
          (supabase/proposed/20261103000000_provider_tenant_budgets.sql) has not been applied. Nothing is
          limited and no alerts are sent until it is.
        </p>
      </div>
    );
  }

  const saveSettings = async () => {
    const e = parseEmails(emailsText);
    const p = parsePhones(phonesText);
    if (e.invalid.length) return toast.error(`Not an email address: ${e.invalid.join(", ")}`);
    if (p.invalid.length) return toast.error(`Not a phone number: ${p.invalid.join(", ")}`);
    if (settings.email_enabled && !e.ok.length) return toast.error("Email alerts need at least one address.");
    if (settings.sms_enabled && !p.ok.length) return toast.error("Text message alerts need at least one number.");
    setBusy(true);
    const { error } = await db.rpc("platform_set_alert_settings", {
      p_email_enabled: settings.email_enabled, p_sms_enabled: settings.sms_enabled,
      p_email_recipients: e.ok, p_sms_recipients: p.ok,
    });
    setBusy(false);
    if (error) return toast.error(`Not saved: ${error.message}`);
    toast.success("Alert delivery saved");
    load();
  };

  const sendTest = async () => {
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("provider-budget-alerts", {
      body: { action: "test", email: settings.email_enabled, sms: settings.sms_enabled },
    });
    setBusy(false);
    if (error) return toast.error(`Test not sent: ${error.message}`);
    const r = (data?.result || {}) as Record<string, string>;
    toast.success(`Test: ${Object.entries(r).map(([k, v]) => `${k === "sms" ? "text" : k} ${v}`).join(", ") || "nothing to send"}`);
  };

  const saveBudget = async () => {
    if (!form) return;
    const { payload, error } = budgetPayload(form);
    if (error || !payload) return toast.error(error);
    setBusy(true);
    const res = await db.rpc("platform_set_tenant_budget", payload);
    setBusy(false);
    if (res.error) return toast.error(`Not saved: ${res.error.message}`);
    toast.success("Budget saved");
    setForm(null);
    load();
  };

  const removeBudget = async (r: OverviewRow) => {
    if (!window.confirm(`Remove the ${providerLabel(r.provider)} budget for ${names[r.tenant_id] || "this dealership"}?`)) return;
    const { error } = await db.rpc("platform_delete_tenant_budget", { p_tenant_id: r.tenant_id, p_provider: r.provider });
    if (error) return toast.error(`Not removed: ${error.message}`);
    toast.success("Budget removed");
    load();
  };

  const savePrice = async () => {
    const v = Number(priceForm.usd);
    if (!Number.isFinite(v) || v < 0) return toast.error("Enter the price of one call, such as 0.01.");
    const { error } = await db.rpc("platform_set_unit_price", {
      p_provider: priceForm.provider, p_product: priceForm.product || "*", p_usd_per_call: v,
    });
    if (error) return toast.error(`Not saved: ${error.message}`);
    toast.success("Price saved");
    setPriceForm({ ...priceForm, usd: "" });
    load();
  };

  const editRow = (r: OverviewRow) => setForm({
    tenantId: r.tenant_id, provider: r.provider, mode: r.mode || "alert_only",
    callCap: r.monthly_call_cap == null ? "" : String(r.monthly_call_cap),
    usdCap: r.monthly_usd_cap == null ? "" : String(Number(r.monthly_usd_cap)),
    thresholds: (r.alert_thresholds || [80, 100]).join(", "), notes: r.notes || "",
  });

  const inputCls = "h-10 w-full rounded-lg border border-border bg-background px-3 text-sm";
  const labelCls = "text-[12px] font-semibold text-muted-foreground";

  return (
    <div className="space-y-4">
      <div className="rounded-3xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-amber-50 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-amber-700">
              Platform admin only
            </div>
            <h2 className="mt-3 text-2xl font-black tracking-tight text-foreground inline-flex items-center gap-2">
              <Wallet className="w-6 h-6" /> Budgets & alerts
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Monthly limits on paid provider calls for individual dealerships. "Alert only" tells you when a
              dealership reaches each alert point; "Enforce" also refuses further calls once the limit is used up.
              An enforced limit covers every call for the dealership, the inventory feed included.
            </p>
          </div>
          <button onClick={load} className="h-10 rounded-lg border border-border px-3 text-xs font-bold inline-flex items-center gap-1.5">
            <RefreshCw className="w-5 h-5" /> Refresh
          </button>
        </div>
      </div>

      <section className="rounded-2xl border border-border bg-card p-4 space-y-4" aria-labelledby="alert-delivery">
        <h3 id="alert-delivery" className="text-base font-black text-foreground inline-flex items-center gap-2">
          <BellRing className="w-5 h-5" /> Alert delivery
        </h3>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <label className="flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-2 text-sm font-semibold"><Mail className="w-5 h-5" /> Email</span>
              <Switch aria-label="Send alerts by email" checked={settings.email_enabled}
                onCheckedChange={(v) => setSettings({ ...settings, email_enabled: v })} />
            </label>
            <textarea aria-label="Email recipients" value={emailsText} onChange={(e) => setEmailsText(e.target.value)}
              placeholder="admin@example.com, ops@example.com" rows={2}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
          </div>
          <div className="space-y-2">
            <label className="flex items-center justify-between gap-3">
              <span className="inline-flex items-center gap-2 text-sm font-semibold"><MessageSquare className="w-5 h-5" /> Text message</span>
              <Switch aria-label="Send alerts by text message" checked={settings.sms_enabled}
                onCheckedChange={(v) => setSettings({ ...settings, sms_enabled: v })} />
            </label>
            <textarea aria-label="Text message recipients" value={phonesText} onChange={(e) => setPhonesText(e.target.value)}
              placeholder="+15551234567" rows={2}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm" />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {settings.email_enabled && settings.sms_enabled ? "Alerts go out by email and text message at the same time."
            : settings.email_enabled ? "Alerts go out by email only."
            : settings.sms_enabled ? "Alerts go out by text message only."
            : "Alerts are recorded below but not sent."}
        </p>
        <div className="flex flex-wrap gap-2">
          <button disabled={busy} onClick={saveSettings} className="h-10 rounded-lg bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-50">
            Save alert delivery
          </button>
          <button disabled={busy || (!settings.email_enabled && !settings.sms_enabled)} onClick={sendTest}
            className="h-10 rounded-lg border border-border px-4 text-sm font-bold inline-flex items-center gap-1.5 disabled:opacity-50">
            <Send className="w-5 h-5" /> Send a test
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-4 space-y-3" aria-labelledby="dealer-budgets">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="dealer-budgets" className="text-base font-black text-foreground">Dealership budgets, this month</h3>
          <button onClick={() => setForm({ ...EMPTY_FORM })} className="h-10 rounded-lg border border-border px-3 text-sm font-bold inline-flex items-center gap-1.5">
            <Plus className="w-5 h-5" /> Add a budget
          </button>
        </div>

        {form && (
          <div className="rounded-xl border border-border bg-muted/40 p-3 grid gap-3 md:grid-cols-4" data-testid="budget-form">
            <label className="space-y-1 md:col-span-2"><span className={labelCls}>Dealership</span>
              <select aria-label="Dealership" className={inputCls} value={form.tenantId} onChange={(e) => setForm({ ...form, tenantId: e.target.value })}>
                <option value="">Choose…</option>
                {tenants.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
            <label className="space-y-1"><span className={labelCls}>Provider</span>
              <select aria-label="Provider" className={inputCls} value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })}>
                {BUDGET_PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </label>
            <label className="space-y-1"><span className={labelCls}>Mode</span>
              <select aria-label="Mode" className={inputCls} value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value as BudgetMode })}>
                {(Object.keys(MODE_LABEL) as BudgetMode[]).map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
              </select>
            </label>
            <label className="space-y-1"><span className={labelCls}>Calls per month</span>
              <input aria-label="Calls per month" inputMode="numeric" className={inputCls} value={form.callCap} onChange={(e) => setForm({ ...form, callCap: e.target.value })} placeholder="No limit" />
            </label>
            <label className="space-y-1"><span className={labelCls}>Dollars per month</span>
              <input aria-label="Dollars per month" inputMode="decimal" className={inputCls} value={form.usdCap} onChange={(e) => setForm({ ...form, usdCap: e.target.value })} placeholder="No limit" />
            </label>
            <label className="space-y-1"><span className={labelCls}>Alert at (%)</span>
              <input aria-label="Alert points" className={inputCls} value={form.thresholds} onChange={(e) => setForm({ ...form, thresholds: e.target.value })} />
            </label>
            <label className="space-y-1 md:col-span-4"><span className={labelCls}>Note</span>
              <input aria-label="Note" className={inputCls} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Why this dealership has a budget" />
            </label>
            <div className="md:col-span-4 flex gap-2">
              <button disabled={busy} onClick={saveBudget} className="h-10 rounded-lg bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-50">Save budget</button>
              <button onClick={() => setForm(null)} className="h-10 rounded-lg border border-border px-4 text-sm font-bold">Cancel</button>
            </div>
          </div>
        )}

        {!rows.length ? (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No dealership has a budget or provider calls this month.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[12px] text-muted-foreground">
                  <th className="py-2 pr-3">Dealership</th><th className="py-2 pr-3">Provider</th><th className="py-2 pr-3">Mode</th>
                  <th className="py-2 pr-3">Used</th><th className="py-2 pr-3">Limit</th><th className="py-2 pr-3">Refused</th><th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const pct = percentUsed(r.calls, Number(r.usd), r.monthly_call_cap, r.monthly_usd_cap == null ? null : Number(r.monthly_usd_cap));
                  const limit = [r.monthly_call_cap != null ? `${r.monthly_call_cap} calls` : null, r.monthly_usd_cap != null ? usd(r.monthly_usd_cap) : null].filter(Boolean).join(" / ");
                  return (
                    <tr key={`${r.tenant_id}:${r.provider}`} className="border-t border-border align-top">
                      <td className="py-2 pr-3 font-semibold">{names[r.tenant_id] || r.tenant_id}</td>
                      <td className="py-2 pr-3">{providerLabel(r.provider)}</td>
                      <td className="py-2 pr-3">{r.mode ? MODE_LABEL[r.mode] : <span className="text-muted-foreground">No budget</span>}</td>
                      <td className="py-2 pr-3 tabular-nums">
                        {r.calls} calls · {usd(r.usd)}
                        {pct != null && (
                          <div className="mt-1 h-1.5 w-32 rounded-full bg-muted" aria-label={`${Math.round(pct)}% of the limit used`}>
                            <div className={`h-1.5 rounded-full ${pct >= 100 ? "bg-rose-500" : pct >= 80 ? "bg-amber-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(100, pct)}%` }} />
                          </div>
                        )}
                      </td>
                      <td className="py-2 pr-3 tabular-nums">{limit || "—"}</td>
                      <td className="py-2 pr-3 tabular-nums">{r.denied ? <span className="inline-flex items-center gap-1 font-semibold text-rose-700"><AlertTriangle className="w-5 h-5" />{r.denied}</span> : 0}</td>
                      <td className="py-2 text-right whitespace-nowrap">
                        <button aria-label={`Edit budget for ${names[r.tenant_id] || r.tenant_id}, ${providerLabel(r.provider)}`} onClick={() => editRow(r)} className="p-2 rounded-lg hover:bg-muted"><Pencil className="w-5 h-5" /></button>
                        {r.mode && <button aria-label={`Remove budget for ${names[r.tenant_id] || r.tenant_id}, ${providerLabel(r.provider)}`} onClick={() => removeBudget(r)} className="p-2 rounded-lg hover:bg-muted"><Trash2 className="w-5 h-5" /></button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-card p-4 space-y-3" aria-labelledby="unit-prices">
        <h3 id="unit-prices" className="text-base font-black text-foreground">Price per call</h3>
        <p className="text-xs text-muted-foreground">
          Used to count dollar limits for providers whose price is not built in. MarketCheck uses its list prices.
          A provider without a price here counts toward call limits only.
        </p>
        {prices.length > 0 && (
          <ul className="text-sm space-y-1">
            {prices.map((p) => (
              <li key={`${p.provider}:${p.product}`} className="flex justify-between gap-3">
                <span>{providerLabel(p.provider)}{p.product !== "*" ? ` · ${p.product}` : ""}</span>
                <span className="tabular-nums font-semibold">${Number(p.usd_per_call).toFixed(4)}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="grid gap-2 sm:grid-cols-4">
          <select aria-label="Price provider" className={inputCls} value={priceForm.provider} onChange={(e) => setPriceForm({ ...priceForm, provider: e.target.value })}>
            {BUDGET_PROVIDERS.filter((p) => p.id !== "*").map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          <input aria-label="Price product" className={inputCls} value={priceForm.product} onChange={(e) => setPriceForm({ ...priceForm, product: e.target.value })} placeholder="* for every product" />
          <input aria-label="Price per call in dollars" inputMode="decimal" className={inputCls} value={priceForm.usd} onChange={(e) => setPriceForm({ ...priceForm, usd: e.target.value })} placeholder="0.0100" />
          <button onClick={savePrice} className="h-10 rounded-lg border border-border px-3 text-sm font-bold">Save price</button>
        </div>
      </section>

      <section className="rounded-2xl border border-border bg-card p-4 space-y-3" aria-labelledby="recent-alerts">
        <h3 id="recent-alerts" className="text-base font-black text-foreground">Recent alerts</h3>
        {!alerts.length ? (
          <p className="text-sm text-muted-foreground">No alerts yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[12px] text-muted-foreground">
                  <th className="py-2 pr-3">When</th><th className="py-2 pr-3">Dealership</th><th className="py-2 pr-3">Alert</th>
                  <th className="py-2 pr-3">Email</th><th className="py-2">Text</th>
                </tr>
              </thead>
              <tbody>
                {alerts.map((a) => (
                  <tr key={a.id} className="border-t border-border">
                    <td className="py-2 pr-3 whitespace-nowrap">{new Date(a.created_at).toLocaleString()}</td>
                    <td className="py-2 pr-3">{names[a.tenant_id] || a.tenant_id}</td>
                    <td className="py-2 pr-3">{providerLabel(a.provider)}: {a.kind === "call_denied" ? "calls refused" : `${a.threshold}% used`}</td>
                    <td className="py-2 pr-3">{a.email_status ? CHANNEL_STATUS_LABEL[a.email_status] || a.email_status : "Waiting"}</td>
                    <td className="py-2">{a.sms_status ? CHANNEL_STATUS_LABEL[a.sms_status] || a.sms_status : "Waiting"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
