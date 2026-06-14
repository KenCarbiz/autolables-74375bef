import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { RefreshCw, PlayCircle, AlertTriangle, CheckCircle2, Clock } from "lucide-react";

// ──────────────────────────────────────────────────────────────
// BillingHandshakeDiagnostic — platform-admin only.
//
// A single pane that answers "is the Autocurb \u2194 AutoLabels billing
// handshake working?" without bouncing through the Supabase
// dashboard. Three reads + one action:
//
//   1. Recent billing_events (raw Stripe webhook ledger) so we can
//      see Autocurb's webhook actually landed.
//   2. Recent audit_log entries with action=entitlements_synced so
//      we can see autocurb_sync_entitlements ran successfully.
//   3. Current app_entitlements for a chosen tenant.
//   4. A replay action that posts a synthetic item into our
//      billing-replay edge fn for end-to-end verification.
// ──────────────────────────────────────────────────────────────

interface BillingEvent {
  id: string;
  tenant_id: string | null;
  stripe_event_id: string | null;
  event_type: string;
  processed_at: string | null;
  created_at: string;
}

interface AuditEntry {
  id: string;
  action: string;
  entity_id: string;
  details: Record<string, unknown> | null;
  created_at: string;
}

interface Entitlement {
  app_slug: string;
  plan_tier: string;
  status: string;
  stripe_subscription_id: string | null;
  expires_at: string | null;
}

const fmt = (s: string | null) =>
  s ? new Date(s).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }) : "\u2014";

const BillingHandshakeDiagnostic = () => {
  const [events, setEvents] = useState<BillingEvent[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [tenants, setTenants] = useState<{ id: string; name: string }[]>([]);
  const [tenantId, setTenantId] = useState("");
  const [entitlements, setEntitlements] = useState<Entitlement[]>([]);
  const [loading, setLoading] = useState(false);
  const [reengageSchedule, setReengageSchedule] = useState<{ schedule: string | null; active: boolean } | null>(null);
  // Wave 24 — surface the advertised-price crawl schedule
  // alongside the reengage one. Same pattern, different RPC.
  const [crawlSchedule, setCrawlSchedule] = useState<{ schedule: string | null; active: boolean; last_run: string | null } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [evRes, auditRes, tenantsRes, schedRes, crawlRes] = await Promise.all([
      (supabase as any)
        .from("billing_events")
        .select("id, tenant_id, stripe_event_id, event_type, processed_at, created_at")
        .order("created_at", { ascending: false })
        .limit(20),
      (supabase as any)
        .from("audit_log")
        .select("id, action, entity_id, details, created_at")
        .eq("action", "entitlements_synced")
        .order("created_at", { ascending: false })
        .limit(20),
      (supabase as any)
        .from("tenants")
        .select("id, name")
        .order("name")
        .limit(50),
      (supabase as any).rpc("get_reengage_schedule"),
      (supabase as any).rpc("get_crawl_advertised_prices_schedule"),
    ]);
    setEvents((evRes.data as BillingEvent[]) || []);
    setAudit((auditRes.data as AuditEntry[]) || []);
    setTenants((tenantsRes.data as { id: string; name: string }[]) || []);
    const schedRow = Array.isArray(schedRes.data) ? schedRes.data[0] : schedRes.data;
    setReengageSchedule(schedRow ? { schedule: schedRow.schedule, active: !!schedRow.active } : { schedule: null, active: false });
    const crawlRow = Array.isArray(crawlRes.data) ? crawlRes.data[0] : crawlRes.data;
    setCrawlSchedule(crawlRow ? {
      schedule: crawlRow.cron_expression,
      active: !!crawlRow.active,
      last_run: crawlRow.last_run ?? null,
    } : { schedule: null, active: false, last_run: null });
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const loadEntitlements = useCallback(async (id: string) => {
    if (!id) { setEntitlements([]); return; }
    const { data } = await (supabase as any)
      .from("app_entitlements")
      .select("app_slug, plan_tier, status, stripe_subscription_id, expires_at")
      .eq("tenant_id", id)
      .order("app_slug");
    setEntitlements((data as Entitlement[]) || []);
  }, []);

  useEffect(() => { loadEntitlements(tenantId); }, [tenantId, loadEntitlements]);

  const triggerDryRun = async () => {
    if (!tenantId) {
      toast.error("Pick a tenant first");
      return;
    }
    const { data, error } = await supabase.functions.invoke("billing-replay", {
      body: {
        tenant_id: tenantId,
        dry_run: true,
        items: [
          {
            app_slug: "autolabels",
            plan_tier: "essential",
            status: "active",
            stripe_subscription_id: "sub_diagnostic_dryrun",
            stripe_subscription_item_id: "si_diagnostic_dryrun",
            expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
            includes_apps: ["autolabels"],
          },
        ],
      },
    });
    if (error) {
      toast.error(`Dry run failed: ${error.message}`);
      return;
    }
    toast.success("Dry run accepted \u2014 contract shape is valid");
    console.log("billing-replay dry run:", data);
  };

  const ledgerEvents = events.length;
  const successfulSyncs = audit.length;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-base font-semibold text-foreground">Billing handshake</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Live state of the Autocurb &harr; AutoLabels billing contract. <span className="font-mono">autocurb_sync_entitlements</span> on every Stripe event from Autocurb's webhook.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border text-sm font-medium hover:bg-muted disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 flex items-start gap-2">
        <Clock className="w-4 h-4 text-slate-600 mt-0.5 flex-shrink-0" />
        <div className="text-[12px] text-slate-700 leading-relaxed">
          <span className="font-semibold">Abandoned-signing re-engagement: </span>
          {reengageSchedule === null ? (
            <span className="text-muted-foreground">checking\u2026</span>
          ) : reengageSchedule.schedule ? (
            <>
              scheduled (<span className="font-mono">{reengageSchedule.schedule}</span>) &middot; {reengageSchedule.active ? "active" : "paused"}
            </>
          ) : (
            <>
              not scheduled. Call <span className="font-mono">SELECT public.schedule_reengage_abandoned_signings();</span> from psql once secrets are in vault.
            </>
          )}
        </div>
      </div>

      {/* Wave 24 — advertised-price crawl status. Same shape. */}
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 flex items-start gap-2">
        <Clock className="w-4 h-4 text-slate-600 mt-0.5 flex-shrink-0" />
        <div className="text-[12px] text-slate-700 leading-relaxed">
          <span className="font-semibold">Advertised-price crawl: </span>
          {crawlSchedule === null ? (
            <span className="text-muted-foreground">checking…</span>
          ) : crawlSchedule.schedule ? (
            <>
              scheduled (<span className="font-mono">{crawlSchedule.schedule}</span>) &middot; {crawlSchedule.active ? "active" : "paused"}
              {crawlSchedule.last_run && (
                <> &middot; last run {new Date(crawlSchedule.last_run).toLocaleString()}</>
              )}
            </>
          ) : (
            <>
              not scheduled. Call <span className="font-mono">SELECT public.schedule_crawl_advertised_prices();</span> from psql to enable nightly drift detection.
            </>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <StatCard
          label="Billing events (last 20)"
          value={ledgerEvents}
          tone={ledgerEvents > 0 ? "ok" : "stale"}
          note={ledgerEvents === 0 ? "No Stripe events received \u2014 webhook may not be wired yet" : "Shadow ledger receiving events"}
        />
        <StatCard
          label="Successful syncs (last 20)"
          value={successfulSyncs}
          tone={successfulSyncs > 0 ? "ok" : "stale"}
          note={successfulSyncs === 0 ? "Autocurb hasn't called autocurb_sync_entitlements yet" : "RPC contract is firing"}
        />
      </div>

      <section className="rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Per-tenant entitlements</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Pick a tenant to see their current app_entitlements.</p>
          </div>
          <button
            onClick={triggerDryRun}
            disabled={!tenantId}
            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-slate-950 text-white text-sm font-medium disabled:opacity-50 hover:bg-slate-900"
          >
            <PlayCircle className="w-3.5 h-3.5" />
            Dry-run replay
          </button>
        </div>
        <select
          value={tenantId}
          onChange={(e) => setTenantId(e.target.value)}
          className="w-full h-10 px-3 rounded-md border border-border bg-background text-sm"
        >
          <option value="">\u2014 select a tenant \u2014</option>
          {tenants.map((t) => (
            <option key={t.id} value={t.id}>{t.name} ({t.id.slice(0, 8)})</option>
          ))}
        </select>

        {tenantId && (
          <div className="mt-3 rounded-xl border border-border overflow-hidden">
            <table className="w-full text-[12px]">
              <thead className="bg-muted text-left">
                <tr>
                  <th className="px-3 py-2 font-semibold">App</th>
                  <th className="px-3 py-2 font-semibold">Tier</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 font-semibold">Subscription</th>
                  <th className="px-3 py-2 font-semibold">Expires</th>
                </tr>
              </thead>
              <tbody>
                {entitlements.length === 0 ? (
                  <tr><td colSpan={5} className="px-3 py-3 text-center text-xs text-muted-foreground">No entitlements for this tenant.</td></tr>
                ) : entitlements.map((e) => (
                  <tr key={e.app_slug} className="border-t border-border">
                    <td className="px-3 py-2 font-mono">{e.app_slug}</td>
                    <td className="px-3 py-2">{e.plan_tier}</td>
                    <td className="px-3 py-2">
                      <StatusPill status={e.status} />
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px]">{e.stripe_subscription_id || "\u2014"}</td>
                    <td className="px-3 py-2 text-muted-foreground">{fmt(e.expires_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-card p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3">Recent billing events</h3>
        {events.length === 0 ? (
          <p className="text-xs text-muted-foreground">No Stripe events received yet.</p>
        ) : (
          <div className="rounded-xl border border-border overflow-hidden">
            <table className="w-full text-[12px]">
              <thead className="bg-muted text-left">
                <tr>
                  <th className="px-3 py-2 font-semibold">Event</th>
                  <th className="px-3 py-2 font-semibold">Tenant</th>
                  <th className="px-3 py-2 font-semibold">Stripe ID</th>
                  <th className="px-3 py-2 font-semibold">Processed</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e) => (
                  <tr key={e.id} className="border-t border-border">
                    <td className="px-3 py-2 font-mono text-[11px]">{e.event_type}</td>
                    <td className="px-3 py-2 font-mono text-[10px]">{e.tenant_id?.slice(0, 8) || "\u2014"}</td>
                    <td className="px-3 py-2 font-mono text-[10px]">{e.stripe_event_id?.slice(0, 14) || "\u2014"}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      {e.processed_at ? fmt(e.processed_at) : <span className="text-amber-700">unprocessed</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-border bg-card p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3">Recent successful syncs</h3>
        {audit.length === 0 ? (
          <p className="text-xs text-muted-foreground">No entitlements_synced calls in the audit log yet.</p>
        ) : (
          <div className="space-y-2">
            {audit.map((a) => {
              const apps = (a.details as { active_apps?: string[] } | null)?.active_apps || [];
              const sub = (a.details as { stripe_subscription_id?: string } | null)?.stripe_subscription_id || "\u2014";
              return (
                <div key={a.id} className="rounded-lg border border-border p-3 text-[12px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-emerald-700 font-semibold">
                      <CheckCircle2 className="w-3.5 h-3.5" /> entitlements_synced
                    </span>
                    <span className="text-[11px] text-muted-foreground">{fmt(a.created_at)}</span>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Tenant <span className="font-mono">{a.entity_id.slice(0, 8)}</span> &middot; Sub <span className="font-mono">{sub}</span> &middot; Apps {apps.length ? apps.join(", ") : "\u2014"}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};

const StatCard = ({
  label,
  value,
  tone,
  note,
}: {
  label: string;
  value: number;
  tone: "ok" | "stale";
  note: string;
}) => (
  <div className={`rounded-xl border p-4 ${tone === "ok" ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
    <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
    <div className="flex items-baseline gap-2 mt-1">
      <span className="text-3xl font-black tabular-nums text-foreground">{value}</span>
      {tone === "stale" && <AlertTriangle className="w-4 h-4 text-amber-600" />}
    </div>
    <p className="text-[11px] text-muted-foreground mt-1">{note}</p>
  </div>
);

const StatusPill = ({ status }: { status: string }) => {
  const tone = status === "active" ? "bg-emerald-100 text-emerald-800"
    : status === "past_due" || status === "paused" ? "bg-amber-100 text-amber-800"
      : status === "canceled" ? "bg-red-100 text-red-800"
        : "bg-slate-100 text-slate-700";
  return (
    <span className={`inline-flex items-center text-[10px] font-bold uppercase tracking-wider rounded px-1.5 py-0.5 ${tone}`}>
      {status}
    </span>
  );
};

export default BillingHandshakeDiagnostic;
