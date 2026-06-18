import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { RefreshCw, Loader2, Database, Lock } from "lucide-react";
import CronStatusBadge from "@/components/admin/CronStatusBadge";

// MarketcheckSyncCard — per-tenant nightly inventory sync control.
// Super admin grants/revokes the capability (allowed); the dealership turns it
// on/off, points it at their website domain, and sets the schedule + cap.

interface Config {
  tenant_id: string;
  allowed: boolean;
  enabled: boolean;
  source: string;
  max_vehicles: number;
  frequency: "nightly" | "weekly" | "biweekly" | "monthly";
  day_of_week: number;
  run_hour: number;
  last_run_at: string | null;
  last_status: { ran_at?: string; seen?: number; new_vehicles?: number; prices_recorded?: number } | null;
}

const DOW = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DEFAULTS: Omit<Config, "tenant_id"> = {
  allowed: false, enabled: false, source: "", max_vehicles: 1000,
  frequency: "nightly", day_of_week: 0, run_hour: 3, last_run_at: null, last_status: null,
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
    setCfg(data ? (data as Config) : { tenant_id: tenantId, ...DEFAULTS });
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
    const { error } = await (supabase as any).rpc("save_marketcheck_config", {
      _tenant_id: tenantId, _enabled: cfg.enabled, _source: cfg.source.trim(),
      _max_vehicles: cfg.max_vehicles, _frequency: cfg.frequency,
      _day_of_week: cfg.day_of_week, _run_hour: cfg.run_hour,
    });
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
    const r = (data || {}) as { new_vehicles?: number; listings_seen?: number; prices_recorded?: number; error?: string };
    if (r.error === "not_configured") { toast.error("MARKETCHECK_API_KEY_1 is not set on the server"); return; }
    toast.success(`Synced ${r.listings_seen ?? 0} vehicles · ${r.new_vehicles ?? 0} new · ${r.prices_recorded ?? 0} price updates`);
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
            <p className="text-[11px] text-muted-foreground mt-1">Just the domain — MarketCheck matches your own-site listings to it.</p>
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
        </div>
      )}
    </div>
  );
}
