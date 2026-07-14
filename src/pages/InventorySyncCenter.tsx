import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import {
  RefreshCw, Loader2, CheckCircle2, AlertTriangle, XCircle, Info, Clock,
  Database, Download, FileText, Pause, TestTube2, RotateCcw,
} from "lucide-react";

// ──────────────────────────────────────────────────────────────
// InventorySyncCenter — data-integrity dashboard for the primary
// marketcheck-sync ingest. Read-only in this phase (Run Sync Now
// is the only mutation). Reads inventory_sync_runs and
// inventory_sync_errors written by the edge function.
// ──────────────────────────────────────────────────────────────

type RunStatus = "success" | "partial" | "failed" | "empty_valid" | "skipped";

interface Run {
  id: string;
  tenant_id: string;
  source: string;
  started_at: string;
  finished_at: string | null;
  status: RunStatus;
  num_found: number;
  seen: number;
  new_vehicles: number;
  updated_vehicles: number;
  prices_recorded: number;
  removed: number;
  http_status: number | null;
  matched_dealer: string | null;
  error_summary: string | null;
  raw: Record<string, unknown> | null;
}

interface SyncErr {
  id: string;
  sync_run_id: string;
  vin: string | null;
  code: string | null;
  message: string | null;
  created_at: string;
}

interface Cfg {
  source: string;
  enabled: boolean;
  frequency: "nightly" | "weekly" | "biweekly" | "monthly";
  run_hour: number;
  day_of_week: number;
  last_run_at: string | null;
}

const STATUS_META: Record<RunStatus, { label: string; cls: string; Icon: typeof CheckCircle2 }> = {
  success:     { label: "Success",     cls: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30", Icon: CheckCircle2 },
  partial:     { label: "Partial",     cls: "bg-amber-500/15 text-amber-700 border-amber-500/30",       Icon: AlertTriangle },
  empty_valid: { label: "Empty (valid)", cls: "bg-sky-500/15 text-sky-700 border-sky-500/30",           Icon: Info },
  failed:      { label: "Failed",      cls: "bg-red-500/15 text-red-700 border-red-500/30",             Icon: XCircle },
  skipped:     { label: "Skipped",     cls: "bg-muted text-muted-foreground border-border",             Icon: Info },
};

const fmtWhen = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  return d.toLocaleString();
};

const fmtDuration = (a: string, b: string | null) => {
  if (!b) return "—";
  const ms = new Date(b).getTime() - new Date(a).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
};

const nextNightlyRun = (cfg: Cfg | null): Date | null => {
  if (!cfg || !cfg.enabled) return null;
  const now = new Date();
  const next = new Date(now);
  next.setUTCMinutes(0, 0, 0);
  next.setUTCHours(cfg.run_hour);
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  return next;
};

const StatusBadge = ({ status }: { status: RunStatus }) => {
  const m = STATUS_META[status];
  const Icon = m.Icon;
  return (
    <span className={`inline-flex items-center gap-1 h-6 px-2 rounded-full border text-[11px] font-semibold ${m.cls}`}>
      <Icon className="w-3 h-3" /> {m.label}
    </span>
  );
};

export default function InventorySyncCenter() {
  const { tenant } = useTenant();
  const { isAdmin } = useAuth();
  const tenantId = tenant?.id || null;

  const [cfg, setCfg] = useState<Cfg | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [selected, setSelected] = useState<Run | null>(null);
  const [selectedErrs, setSelectedErrs] = useState<SyncErr[]>([]);
  const [errsLoading, setErrsLoading] = useState(false);
  const [unresolvedCount, setUnresolvedCount] = useState<number>(0);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    const [{ data: c }, { data: r }, { count: excCount }] = await Promise.all([
      (supabase as any).from("marketcheck_sync_config")
        .select("source, enabled, frequency, run_hour, day_of_week, last_run_at")
        .eq("tenant_id", tenantId).maybeSingle(),
      (supabase as any).from("inventory_sync_runs")
        .select("*").eq("tenant_id", tenantId)
        .order("started_at", { ascending: false }).limit(50),
      (supabase as any).from("vehicle_exceptions")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId).in("status", ["open", "in_progress"]),
    ]);
    setCfg((c as Cfg) || null);
    setRuns((r as Run[]) || []);
    setUnresolvedCount(typeof excCount === "number" ? excCount : 0);
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { load(); }, [load]);

  const openRun = async (run: Run) => {
    setSelected(run);
    setErrsLoading(true);
    const { data } = await (supabase as any).from("inventory_sync_errors")
      .select("*").eq("sync_run_id", run.id).order("created_at", { ascending: true });
    setSelectedErrs((data as SyncErr[]) || []);
    setErrsLoading(false);
  };

  const runNow = async () => {
    if (!tenantId) return;
    if (!cfg?.source?.trim()) { toast.error("Set the dealer website domain in Admin → MarketCheck first"); return; }
    setRunning(true);
    const { error } = await supabase.functions.invoke("marketcheck-sync", {
      body: { tenant_id: tenantId, force: true },
    });
    setRunning(false);
    if (error) { toast.error("Sync failed to start — check function logs"); return; }
    toast.success("Sync started — refreshing history");
    setTimeout(load, 1500);
  };

  const downloadCsv = async () => {
    if (!tenantId) return;
    const { data } = await (supabase as any).from("inventory_sync_errors")
      .select("created_at, vin, code, message, sync_run_id")
      .eq("tenant_id", tenantId).order("created_at", { ascending: false }).limit(5000);
    const rows = (data as SyncErr[]) || [];
    const header = "created_at,sync_run_id,vin,code,message";
    const body = rows.map((e) => [e.created_at, e.sync_run_id, e.vin ?? "", e.code ?? "", (e.message ?? "").replace(/"/g, '""')]
      .map((v) => `"${v}"`).join(",")).join("\n");
    const blob = new Blob([`${header}\n${body}`], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `inventory-sync-errors-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  const latest = runs[0] || null;
  const lastSuccessful = useMemo(() => runs.find((r) => r.status === "success" || r.status === "partial") || null, [runs]);
  const prevWithInventory = useMemo(() => runs.slice(1).find((r) => r.seen > 0) || null, [runs]);

  const health: { tone: "healthy" | "warning" | "failed"; label: string } = useMemo(() => {
    if (!latest) return { tone: "warning", label: "No runs yet" };
    if (latest.status === "failed") return { tone: "failed", label: "Failed" };
    if (latest.status === "partial") return { tone: "warning", label: "Warning" };
    if (latest.status === "empty_valid" && prevWithInventory) return { tone: "warning", label: "Warning" };
    return { tone: "healthy", label: "Healthy" };
  }, [latest, prevWithInventory]);

  const warnings = useMemo(() => {
    const out: { level: "red" | "amber" | "blue"; title: string; body: string }[] = [];
    if (!latest) return out;
    if (latest.status === "failed") {
      out.push({ level: "red", title: "Last sync failed",
        body: latest.error_summary || "The sync did not complete. Existing inventory was NOT pruned. Review the error log." });
    }
    if (latest.status === "empty_valid" && prevWithInventory) {
      out.push({ level: "amber", title: "Source returned zero vehicles",
        body: `The feed responded but returned 0 cars. The previous run saw ${prevWithInventory.seen}. This may indicate a source/domain break — the lot is not necessarily empty.` });
    }
    if (lastSuccessful && prevWithInventory && prevWithInventory !== lastSuccessful) {
      const prior = prevWithInventory.seen;
      const curr = lastSuccessful.seen;
      if (prior > 0 && curr < prior * 0.7) {
        out.push({ level: "amber", title: "Large inventory drop",
          body: `Latest inventory count dropped from ${prior} to ${curr} (${Math.round((1 - curr / prior) * 100)}% fewer).` });
      }
    }
    if (lastSuccessful) {
      const hrs = (Date.now() - new Date(lastSuccessful.started_at).getTime()) / 3.6e6;
      if (hrs > 30) {
        out.push({ level: "red", title: "Sync is stale",
          body: `Last successful sync was ${Math.round(hrs)} hours ago (> 30h threshold). The nightly cron may be broken.` });
      }
    }
    return out;
  }, [latest, prevWithInventory, lastSuccessful]);

  if (!tenantId) return null;
  if (loading) {
    return (
      <div className="p-6 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading sync history…
      </div>
    );
  }

  const nextRun = nextNightlyRun(cfg);

  return (
    <div className="max-w-6xl mx-auto p-4 lg:p-6 space-y-5">
      {/* ── Header ───────────────────────────────────────────── */}
      <div>
        <div className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          Data integrity
        </div>
        <h1 className="mt-1 text-2xl font-display font-semibold tracking-tight text-foreground">
          Inventory Sync Center
        </h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
          Visibility into every MarketCheck inventory pull for this rooftop — what ran, what came back, and what to trust. A failed pull is never conflated with a legitimately empty feed.
        </p>
      </div>

      {/* ── Header cards ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard icon={CheckCircle2} label="Last successful sync"
          primary={lastSuccessful ? fmtWhen(lastSuccessful.started_at) : "Never"}
          secondary={lastSuccessful ? new Date(lastSuccessful.started_at).toLocaleString() : "No successful run recorded"} />
        <StatCard icon={Clock} label="Last attempted sync"
          primary={latest ? fmtWhen(latest.started_at) : "—"}
          secondary={latest ? STATUS_META[latest.status].label : "No attempts yet"} />
        <StatCard icon={RefreshCw} label="Next scheduled sync"
          primary={nextRun ? nextRun.toLocaleString(undefined, { hour: "2-digit", minute: "2-digit", month: "short", day: "numeric" }) : "Not scheduled"}
          secondary={cfg ? `${cfg.frequency} · ${String(cfg.run_hour).padStart(2, "0")}:00 UTC` : "Sync is disabled"} />
        <StatCard icon={Database} label="Source health"
          primary={<HealthPill tone={health.tone} label={health.label} />}
          secondary={cfg?.source ? cfg.source : "No source configured"} />
      </div>

      {/* ── Warning banners ──────────────────────────────────── */}
      {warnings.length > 0 && (
        <div className="space-y-2">
          {warnings.map((w, i) => (
            <div key={i} className={`rounded-xl border p-3 flex items-start gap-3 ${
              w.level === "red" ? "bg-red-500/5 border-red-500/30 text-red-700"
                : w.level === "amber" ? "bg-amber-500/5 border-amber-500/30 text-amber-800"
                : "bg-sky-500/5 border-sky-500/30 text-sky-700"}`}>
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <div className="text-sm">
                <div className="font-semibold">{w.title}</div>
                <div className="opacity-90">{w.body}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Latest run stats ─────────────────────────────────── */}
      {latest && (
        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <div className="flex items-center gap-2">
              <h2 className="font-display text-lg font-bold tracking-tight text-foreground">Latest run</h2>
              <StatusBadge status={latest.status} />
              <span className="text-xs text-muted-foreground">{new Date(latest.started_at).toLocaleString()}</span>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={runNow} disabled={running}
                className="h-9 px-3.5 rounded-md bg-[#F97316] hover:bg-[#EA6A0C] text-white text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50">
                {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Run Sync Now
              </button>
              <button onClick={downloadCsv}
                className="h-9 px-3 rounded-md border border-border text-sm font-semibold inline-flex items-center gap-2 hover:bg-muted">
                <Download className="w-4 h-4" /> Download Error Report
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
            <Metric label="Found"    value={latest.num_found} />
            <Metric label="Seen"     value={latest.seen} />
            <Metric label="New"      value={latest.new_vehicles} tone="emerald" />
            <Metric label="Updated"  value={latest.updated_vehicles} />
            <Metric label="Prices"   value={latest.prices_recorded} />
            <Metric label="Removed"  value={latest.removed} tone={latest.removed > 0 ? "amber" : undefined} />
            <Metric label="HTTP"     value={latest.http_status ?? "—"} />
            <Metric label="Duration" value={fmtDuration(latest.started_at, latest.finished_at)} />
          </div>
          {latest.matched_dealer && (
            <p className="text-[11px] text-muted-foreground mt-3">
              Matched dealer: <span className="font-mono">{latest.matched_dealer}</span>
            </p>
          )}
        </div>
      )}

      {/* ── Coming-soon controls (visible but disabled) ─────── */}
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className="text-muted-foreground uppercase font-bold tracking-wider">Coming soon</span>
        {[{ Icon: Pause, label: "Pause sync" }, { Icon: TestTube2, label: "Test source" }, { Icon: RotateCcw, label: "Refresh VIN" }].map(({ Icon, label }) => (
          <button key={label} disabled
            className="h-7 px-2.5 rounded-md border border-border bg-muted/40 text-muted-foreground inline-flex items-center gap-1.5 cursor-not-allowed">
            <Icon className="w-3.5 h-3.5" /> {label}
          </button>
        ))}
      </div>

      {/* ── Runs history table ───────────────────────────────── */}
      <div className="rounded-2xl border border-border bg-card">
        <div className="px-5 py-3 border-b border-border">
          <h2 className="font-display text-lg font-bold tracking-tight text-foreground">Runs history</h2>
          <p className="text-[11px] text-muted-foreground">Click a row to open its error list. Showing latest {runs.length} runs.</p>
        </div>
        {runs.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No sync runs have been recorded yet. Instrumentation begins on the next MarketCheck pull.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground bg-muted/40 sticky top-0">
                <tr>
                  <th className="text-left px-4 py-2">When</th>
                  <th className="text-left px-4 py-2">Status</th>
                  <th className="text-right px-4 py-2">Found</th>
                  <th className="text-right px-4 py-2">New</th>
                  <th className="text-right px-4 py-2">Removed</th>
                  <th className="text-right px-4 py-2">Errors</th>
                  <th className="text-right px-4 py-2">Duration</th>
                  <th className="text-right px-4 py-2 pr-5">HTTP</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} onClick={() => openRun(r)}
                    className="border-t border-border hover:bg-muted/40 cursor-pointer">
                    <td className="px-4 py-2 tabular-nums">{new Date(r.started_at).toLocaleString()}</td>
                    <td className="px-4 py-2"><StatusBadge status={r.status} /></td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.num_found}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.new_vehicles}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.removed}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{r.error_summary ? "1+" : "0"}</td>
                    <td className="px-4 py-2 text-right tabular-nums">{fmtDuration(r.started_at, r.finished_at)}</td>
                    <td className="px-4 py-2 text-right tabular-nums pr-5">{r.http_status ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Error drawer ─────────────────────────────────────── */}
      {selected && (
        <div className="fixed inset-0 z-50 bg-black/40 flex justify-end" onClick={() => setSelected(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg h-full overflow-y-auto bg-background border-l border-border p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Run detail</div>
                <div className="font-display text-lg font-bold text-foreground">{new Date(selected.started_at).toLocaleString()}</div>
              </div>
              <StatusBadge status={selected.status} />
            </div>
            {selected.error_summary && (
              <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-700">
                {selected.error_summary}
              </div>
            )}
            <div className="rounded-lg border border-border p-3 text-xs space-y-1 text-muted-foreground">
              <div>Found: <span className="text-foreground tabular-nums">{selected.num_found}</span></div>
              <div>Seen: <span className="text-foreground tabular-nums">{selected.seen}</span></div>
              <div>New: <span className="text-foreground tabular-nums">{selected.new_vehicles}</span></div>
              <div>Prices recorded: <span className="text-foreground tabular-nums">{selected.prices_recorded}</span></div>
              <div>Removed: <span className="text-foreground tabular-nums">{selected.removed}</span></div>
              <div>Duration: <span className="text-foreground tabular-nums">{fmtDuration(selected.started_at, selected.finished_at)}</span></div>
              <div>HTTP: <span className="text-foreground tabular-nums">{selected.http_status ?? "—"}</span></div>
              {selected.matched_dealer && <div>Matched dealer: <span className="font-mono text-foreground">{selected.matched_dealer}</span></div>}
            </div>
            <div>
              <div className="flex items-center gap-2 mb-2">
                <FileText className="w-4 h-4 text-muted-foreground" />
                <div className="text-sm font-semibold text-foreground">Error log ({selectedErrs.length})</div>
              </div>
              {errsLoading ? (
                <div className="text-xs text-muted-foreground flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin" /> Loading…</div>
              ) : selectedErrs.length === 0 ? (
                <div className="text-xs text-muted-foreground">No per-VIN errors recorded for this run.</div>
              ) : (
                <ul className="space-y-2">
                  {selectedErrs.map((e) => (
                    <li key={e.id} className="rounded-md border border-border p-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-foreground">{e.vin || "(no vin)"}</span>
                        <span className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">{e.code || "error"}</span>
                      </div>
                      {e.message && <div className="text-muted-foreground mt-1 break-words">{e.message}</div>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {isAdmin && selected.raw && (
              <details className="text-[11px]">
                <summary className="cursor-pointer text-muted-foreground">Raw diagnostics</summary>
                <pre className="mt-2 p-2 rounded bg-muted/40 overflow-x-auto font-mono">{JSON.stringify(selected.raw, null, 2)}</pre>
              </details>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const StatCard = ({ icon: Icon, label, primary, secondary }: {
  icon: typeof CheckCircle2; label: string; primary: React.ReactNode; secondary?: string;
}) => (
  <div className="rounded-2xl border border-border bg-card p-4">
    <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
      <Icon className="w-3.5 h-3.5" /> {label}
    </div>
    <div className="mt-1 text-lg font-display font-semibold text-foreground">{primary}</div>
    {secondary && <div className="text-[11px] text-muted-foreground mt-0.5">{secondary}</div>}
  </div>
);

const HealthPill = ({ tone, label }: { tone: "healthy" | "warning" | "failed"; label: string }) => {
  const cls = tone === "healthy" ? "bg-emerald-500/15 text-emerald-700 border-emerald-500/30"
    : tone === "warning" ? "bg-amber-500/15 text-amber-700 border-amber-500/30"
    : "bg-red-500/15 text-red-700 border-red-500/30";
  return <span className={`inline-flex items-center h-6 px-2 rounded-full border text-[11px] font-semibold ${cls}`}>{label}</span>;
};

const Metric = ({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "emerald" | "amber" }) => (
  <div className="rounded-lg border border-border bg-background p-2.5">
    <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</div>
    <div className={`mt-0.5 text-lg font-semibold tabular-nums ${
      tone === "emerald" ? "text-emerald-700" : tone === "amber" ? "text-amber-700" : "text-foreground"}`}>
      {value}
    </div>
  </div>
);
