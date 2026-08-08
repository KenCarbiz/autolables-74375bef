import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { RefreshCw, Loader2, Database, Lock } from "lucide-react";
import CronStatusBadge from "@/components/admin/CronStatusBadge";
import { summarizeMarketcheckDiag, type MarketcheckDiag } from "@/hooks/useAdminPlatform";

// MarketcheckSyncCard — per-tenant nightly inventory sync control.
// Super admin grants/revokes the capability (allowed); the dealership turns it
// on/off, points it at their website domain, and sets the schedule + cap.

interface Config {
  tenant_id: string;
  allowed: boolean;
  enabled: boolean;
  source: string;
  dealer_id: string;
  max_vehicles: number;
  frequency: "nightly" | "weekly" | "biweekly" | "monthly";
  day_of_week: number;
  run_hour: number;
  last_run_at: string | null;
  last_status: {
    ran_at?: string; seen?: number; new_vehicles?: number; prices_recorded?: number;
    // Written by the sync at the end of a run. These are the fields that
    // distinguish "the provider has no new cars" from "we never asked" and
    // from "we asked, got rows, and rejected every one of them" — three very
    // different problems that all print as "0 new".
    feed_walked?: boolean; num_found?: number; rejected_other_rooftop?: number;
    prune_skipped?: string | null; mc_param?: string; mc_value?: string;
    new_units?: { primary_feed?: number; total?: number };
    supplemental_new?: { ingested?: number; exhausted?: boolean; attempts?: unknown[] } | null;
  } | null;
}

const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DEFAULTS: Omit<Config, "tenant_id"> = {
  allowed: false, enabled: false, source: "", dealer_id: "", max_vehicles: 1000,
  frequency: "nightly", day_of_week: 0, run_hour: 3, last_run_at: null, last_status: null,
};

type LastStatus = NonNullable<Config["last_status"]>;

/**
 * Why a run that reports "0 new" produced no new cars.
 *
 * "0 new" is the same printed answer to three unrelated questions — the
 * provider has no new units, we never asked for them, or we asked, got rows
 * back and rejected every one on the address check. The run already records
 * enough to tell them apart; none of it was ever rendered, so the only way to
 * separate them was to read the JSON out of the database.
 */
const SyncDiagnostics: React.FC<{
  st: Config["last_status"];
  tenantId: string | null;
  onCleared: () => void;
}> = ({ st, tenantId, onCleared }) => {
  const [clearing, setClearing] = useState(false);
  if (!st) return null;

  // The backstop commit introduced new_units. A run whose status lacks it came
  // from a build that predates the backstop — the function is not redeployed.
  const backstopMissing = st.new_units === undefined;
  const sup = st.supplemental_new;
  const probes = (sup?.attempts as Array<Record<string, number>> | undefined) ?? [];
  const returnedRows = probes.reduce((n, p) => n + (Number(p.got) || 0), 0);
  const ingested = probes.reduce((n, p) => n + (Number(p.ingested) || 0), 0);
  const rejectedAll = probes.length > 0 && returnedRows > 0 && ingested === 0;
  const pinned = !!st.mc_param;

  const clearPin = async () => {
    if (!tenantId) return;
    setClearing(true);
    const { error } = await supabase.rpc("marketcheck_clear_scope", { _tenant_id: tenantId });
    setClearing(false);
    if (error) { toast.error(`Couldn't clear the pin — ${error.message}`); return; }
    toast.success("Scope pin cleared. The next sync re-probes every feed instead of the pinned one.");
    onCleared();
  };

  const Line: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-foreground text-right">{value}</span>
    </div>
  );

  return (
    <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-[11px] space-y-1">
      <div className="font-semibold uppercase tracking-wider text-muted-foreground mb-1">Why this run found what it did</div>
      <Line label="Feed queried" value={pinned ? `${st.mc_param}=${st.mc_value ?? ""}` : "not recorded"} />
      <Line label="Provider reported / we kept" value={`${st.num_found ?? "—"} / ${st.seen ?? "—"}`} />
      <Line label="Walked every page" value={st.feed_walked === undefined ? "—" : st.feed_walked ? "yes" : "no — partial feed"} />
      <Line label="New units in feed" value={st.new_units ? `${st.new_units.primary_feed ?? 0}` : "not reported"} />
      <Line label="Rejected: different rooftop" value={st.rejected_other_rooftop ?? 0} />
      {st.prune_skipped && <Line label="Retire step skipped" value={st.prune_skipped} />}
      {probes.length > 0 && (
        <Line label="New-car probes: got / kept" value={`${returnedRows} / ${ingested}`} />
      )}

      {backstopMissing && (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          This run reported no <code className="font-mono">new_units</code>, which means the deployed sync predates the
          new-car recovery step. Redeploy the edge function before drawing any conclusion from a run.
        </p>
      )}

      {rejectedAll && (
        <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-red-900 dark:bg-red-950/30 dark:text-red-200">
          The provider returned {returnedRows} candidate new {returnedRows === 1 ? "car" : "cars"} and every one was
          rejected by the address check. This is a configuration mismatch on our side, not a provider problem — compare
          the street and ZIP above against the address MarketCheck holds for the new-car lot.
        </p>
      )}

      {pinned && (
        <div className="mt-2 flex items-start justify-between gap-3 rounded-lg bg-background px-3 py-2">
          <p className="text-muted-foreground">
            The sync is pinned to one feed and no longer re-probes the others. If it was pinned while the feed was
            already short, it keeps re-confirming the short list every night.
          </p>
          <button onClick={clearPin} disabled={clearing}
            className="shrink-0 rounded-lg border border-border px-3 py-1.5 font-semibold text-foreground hover:bg-muted disabled:opacity-50">
            {clearing ? "Clearing…" : "Clear pin"}
          </button>
        </div>
      )}
    </div>
  );
};

export default function MarketcheckSyncCard() {
  const { tenant } = useTenant();
  const { isAdmin } = useAuth();
  const tenantId = tenant?.id || null;
  const [cfg, setCfg] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    const { data } = await (supabase as any)
      .from("marketcheck_sync_config").select("*").eq("tenant_id", tenantId).maybeSingle();
    setCfg(data ? { ...DEFAULTS, ...(data as Config) } : { tenant_id: tenantId, ...DEFAULTS });
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  if (!tenantId) return null;
  if (loading || !cfg) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 text-sm text-muted-foreground">
        Loading MarketCheck sync…
      </div>
    );
  }

  const set = (patch: Partial<Config>) => setCfg((c) => (c ? { ...c, ...patch } : c));

  const save = async () => {
    setSaving(true);
    const base = {
      _tenant_id: tenantId, _enabled: cfg.enabled, _source: cfg.source.trim(),
      _max_vehicles: cfg.max_vehicles, _frequency: cfg.frequency,
      _day_of_week: cfg.day_of_week, _run_hour: cfg.run_hour,
    };
    // The pull scopes by website domain only; clear any stale dealer_id so a
    // misleading directory id can't be reused.
    let { error } = await (supabase as any).rpc("save_marketcheck_config", { ...base, _dealer_id: "" });
    if (error && /save_marketcheck_config|function|does not exist|argument/i.test(error.message || "")) {
      ({ error } = await (supabase as any).rpc("save_marketcheck_config", base));
    }
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("MarketCheck settings saved");
  };

  const runNow = async () => {
    if (!cfg.source.trim()) { toast.error("Enter the dealer website domain first"); return; }
    setRunning(true);
    const { data, error } = await supabase.functions.invoke("marketcheck-sync", {
      body: { tenant_id: tenantId, force: true },
    });
    setRunning(false);
    if (error) { toast.error("Sync failed — check the MarketCheck key / domain"); return; }
    const r = (data || {}) as { new_vehicles?: number; listings_seen?: number; prices_recorded?: number; error?: string; diagnostics?: MarketcheckDiag[] };
    if (r.error === "not_configured") { toast.error("MARKETCHECK_API_KEY_1 is not set on the server"); return; }
    const seen = r.listings_seen ?? 0;
    const diag = summarizeMarketcheckDiag(r.diagnostics);
    toast[seen > 0 ? "success" : "error"](`Synced ${seen} vehicles · ${r.new_vehicles ?? 0} new · ${r.prices_recorded ?? 0} price updates`, diag ? { description: diag, duration: 12000 } : undefined);
    load();
  };

  const periodic = cfg.frequency !== "nightly";

  // Hide the whole card from a dealer who hasn't been granted MarketCheck, so
  // a non-premium manager never sees an "access not granted" panel.
  if (!cfg.allowed && !isAdmin) return null;

  return (
    <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Database className="w-4 h-4 text-[#2563EB]" />
        <h3 className="font-display text-lg font-bold tracking-tight text-foreground">MarketCheck inventory sync</h3>
      </div>
      <p className="text-sm text-muted-foreground -mt-1 max-w-2xl">
        Pulls this dealership's new + used inventory nightly from its own website via MarketCheck — creating a vehicle
        file for every new VIN (ready for the addendum flow) and recording the advertised price the integrity gate
        verifies against.
      </p>

      {/* Cron health (admins). The capability GRANT lives on the platform
          Tenants grid — a super admin can't reach another dealer's Admin
          context here, so granting is done from Platform → Tenants. */}
      {isAdmin && <CronStatusBadge jobName="marketcheck-sync" label="MarketCheck" />}

      {!cfg.allowed ? (
        isAdmin ? (
          <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
            <Lock className="w-4 h-4" />
            Not granted yet — set this dealer's plan to Compliance Pro in Platform → Tenants.
          </div>
        ) : null
      ) : (
        <div className="space-y-4">
          <label className="flex items-center justify-between rounded-xl border border-border px-4 py-3">
            <span className="text-sm font-semibold text-foreground">Nightly sync enabled</span>
            <input type="checkbox" checked={cfg.enabled} onChange={(e) => set({ enabled: e.target.checked })}
              className="h-5 w-5 rounded border-border" />
          </label>

          <div>
            <label className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
              Dealer website domain
            </label>
            <input value={cfg.source} onChange={(e) => set({ source: e.target.value })}
              placeholder="hartecars.com"
              className="w-full h-10 rounded-md border border-border bg-background px-3 text-sm font-mono" />
            <p className="text-[11px] text-muted-foreground mt-1">Just the website domain — the sync pulls only this dealership's own listings (matched on the domain).</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Frequency</label>
              <select value={cfg.frequency} onChange={(e) => set({ frequency: e.target.value as Config["frequency"] })}
                className="w-full h-10 rounded-md border border-border bg-background px-2 text-sm">
                <option value="nightly">Nightly</option>
                <option value="weekly">Weekly</option>
                <option value="biweekly">Biweekly</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Run hour (UTC)</label>
              <select value={cfg.run_hour} onChange={(e) => set({ run_hour: parseInt(e.target.value, 10) })}
                className="w-full h-10 rounded-md border border-border bg-background px-2 text-sm">
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>
                ))}
              </select>
            </div>
            {periodic && (
              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Day of week</label>
                <select value={cfg.day_of_week} onChange={(e) => set({ day_of_week: parseInt(e.target.value, 10) })}
                  className="w-full h-10 rounded-md border border-border bg-background px-2 text-sm">
                  {DOW.map((d, i) => <option key={i} value={i}>{d}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1">Max vehicles / run</label>
              <input type="number" min={1} max={10000} value={cfg.max_vehicles}
                onChange={(e) => set({ max_vehicles: Math.max(1, Math.min(10000, parseInt(e.target.value, 10) || 1)) })}
                className="w-full h-10 rounded-md border border-border bg-background px-3 text-sm tabular-nums" />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button onClick={save} disabled={saving}
              className="h-10 px-4 rounded-md bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-50">
              {saving ? "Saving…" : "Save settings"}
            </button>
            <button onClick={runNow} disabled={running}
              className="h-10 px-4 rounded-md border border-border text-sm font-semibold inline-flex items-center gap-2 hover:bg-muted disabled:opacity-50">
              {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              Sync now
            </button>
          </div>

          {cfg.last_run_at && (
            <p className="text-[11px] text-muted-foreground">
              Last run {new Date(cfg.last_run_at).toLocaleString()}
              {cfg.last_status?.seen != null && ` · ${cfg.last_status.seen} vehicles · ${cfg.last_status.new_vehicles ?? 0} new · ${cfg.last_status.prices_recorded ?? 0} price updates`}
            </p>
          )}

          {cfg.last_run_at && <SyncDiagnostics st={cfg.last_status} onCleared={load} tenantId={tenantId} />}
        </div>
      )}
    </div>
  );
}
