import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle, CheckCircle2, ChevronRight, Clock, Loader2, RefreshCw, Search,
  ShieldCheck, Sparkles, XCircle, Settings2, FileText,
} from "lucide-react";
import { useDescriptionOperations, useDescriptionPermissions } from "@/hooks/useDescriptionOps";
import {
  STATUS_META, TONE_CLASS, CHANNEL_META, channelMeta, connectorLabel,
  factConfidenceLabel, type DescriptionStatus,
} from "@/lib/description/model";
import { toast } from "sonner";

// /description-operations — the fleet-level workspace. The primary action is
// reviewing exceptions, not generating copy: clean vehicles are expected to
// publish without anyone opening this page.

const PAGE_SIZE = 25;

const Pill = ({ tone, children }: { tone: keyof typeof TONE_CLASS; children: React.ReactNode }) => (
  <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${TONE_CLASS[tone]}`}>{children}</span>
);

function StatCard({ label, value, tone, Icon, active, onClick }: {
  label: string; value: number; tone: keyof typeof TONE_CLASS;
  Icon: typeof Clock; active: boolean; onClick: () => void;
}) {
  return (
    <button onClick={onClick}
      aria-pressed={active}
      className={`text-left rounded-2xl border bg-card p-3.5 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${active ? "border-primary shadow-[0_8px_24px_-14px_rgba(37,99,235,0.4)]" : "border-border hover:border-primary/40"}`}>
      <span className={`inline-grid place-items-center w-9 h-9 rounded-xl border mb-2 ${TONE_CLASS[tone]}`}><Icon className="w-4 h-4" /></span>
      <p className="text-[22px] font-bold text-foreground leading-none">{value}</p>
      <p className="text-[11.5px] text-muted-foreground mt-1 leading-tight">{label}</p>
    </button>
  );
}

export default function DescriptionOperations() {
  const navigate = useNavigate();
  const perms = useDescriptionPermissions();
  const { cases, vehicles, summary, error, reload, reconcile } = useDescriptionOperations();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [conditionFilter, setConditionFilter] = useState<string>("all");
  const [page, setPage] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const runReconcile = async () => {
    setSyncing(true);
    const res = await reconcile(25);
    setSyncing(false);
    if (!res.ok) { toast.error(res.error || "Reconciliation could not run"); return; }
    toast.success(`Reconciliation examined ${res.examined} vehicle${res.examined === 1 ? "" : "s"}`);
  };

  const rows = useMemo(() => {
    if (!cases) return [];
    const q = query.trim().toLowerCase();
    return cases.filter((c) => {
      const v = vehicles[c.vehicle_id] || {};
      if (statusFilter === "exceptions" && c.open_exception_count === 0) return false;
      if (statusFilter !== "all" && statusFilter !== "exceptions" && c.status !== statusFilter) return false;
      if (conditionFilter !== "all" && String(v.condition || "").toLowerCase() !== conditionFilter) return false;
      if (!q) return true;
      return [c.vin, v.ymm, v.trim, (v.mc_attributes || {}).stock_no]
        .filter(Boolean).some((s: string) => String(s).toLowerCase().includes(q));
    });
  }, [cases, vehicles, query, statusFilter, conditionFilter]);

  const paged = rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const exceptionCount = (cases || []).reduce((n, c) => n + (c.open_exception_count || 0), 0);

  const setFilter = (f: string) => { setStatusFilter((cur) => (cur === f ? "all" : f)); setPage(0); };

  return (
    <div className="max-w-[1480px] mx-auto p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div className="min-w-0">
          <h1 className="font-display text-[26px] sm:text-[28px] font-bold tracking-tight text-foreground leading-none">Description Operations</h1>
          <p className="text-sm text-muted-foreground mt-2">Automated merchandising intelligence across every vehicle.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={runReconcile} disabled={syncing}
            className="h-10 px-3.5 rounded-xl border border-border bg-card text-[13px] font-semibold text-foreground hover:border-primary inline-flex items-center gap-1.5 disabled:opacity-60">
            {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Run reconciliation
          </button>
          {perms.canConfigure && (
            <button onClick={() => navigate("/admin?tab=merchandising-seo")}
              className="h-10 px-3.5 rounded-xl border border-border bg-card text-[13px] font-semibold text-foreground hover:border-primary inline-flex items-center gap-1.5">
              <Settings2 className="w-4 h-4" /> Automation settings
            </button>
          )}
          <button onClick={() => setFilter("exceptions")}
            className="h-10 px-4 rounded-xl bg-primary text-primary-foreground text-[13px] font-semibold inline-flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4" /> Review exceptions
            {exceptionCount > 0 && <span className="ml-1 px-1.5 py-0.5 rounded-full bg-white/20 text-[11px]">{exceptionCount}</span>}
          </button>
        </div>
      </div>

      {/* Summary band */}
      {summary ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2.5 mb-4">
          <StatCard label="Active inventory" value={summary.activeInventory} tone="blue" Icon={FileText} active={statusFilter === "all"} onClick={() => setFilter("all")} />
          <StatCard label="Published" value={summary.published} tone="emerald" Icon={ShieldCheck} active={statusFilter === "PUBLISHED"} onClick={() => setFilter("PUBLISHED")} />
          <StatCard label="Ready" value={summary.ready} tone="emerald" Icon={CheckCircle2} active={statusFilter === "READY"} onClick={() => setFilter("READY")} />
          <StatCard label="Review required" value={summary.reviewRequired} tone="amber" Icon={AlertTriangle} active={statusFilter === "REVIEW_REQUIRED"} onClick={() => setFilter("REVIEW_REQUIRED")} />
          <StatCard label="Failed" value={summary.failed} tone="red" Icon={XCircle} active={statusFilter === "FAILED_BLOCKED"} onClick={() => setFilter("FAILED_BLOCKED")} />
          <StatCard label="Stale" value={summary.stale} tone="amber" Icon={Clock} active={statusFilter === "STALE"} onClick={() => setFilter("STALE")} />
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2.5 mb-4">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-[104px] rounded-2xl border border-border bg-card animate-pulse" />)}
        </div>
      )}

      {/* Coverage band — the honest read on automatic initialization */}
      {summary && summary.missing > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-3.5 mb-4 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-[13px] text-amber-900 inline-flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span><b>{summary.missing}</b> active vehicle{summary.missing === 1 ? "" : "s"} never initialized a description. Vehicles added outside the MarketCheck feed are picked up by reconciliation.</span>
          </p>
          <button onClick={runReconcile} disabled={syncing}
            className="h-9 px-3.5 rounded-lg bg-amber-600 text-white text-[12.5px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-60 shrink-0">
            {syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Initialize now
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-muted-foreground absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }}
            placeholder="Search by make, model, stock # or VIN…"
            aria-label="Search vehicles"
            className="w-full h-10 pl-10 pr-3 rounded-xl border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
        </div>
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(0); }}
          aria-label="Filter by status"
          className="h-10 px-3 rounded-xl border border-border bg-card text-[13px] font-medium">
          <option value="all">All statuses</option>
          <option value="exceptions">Has exceptions</option>
          {Object.keys(STATUS_META).map((s) => <option key={s} value={s}>{STATUS_META[s as DescriptionStatus].label}</option>)}
        </select>
        <select value={conditionFilter} onChange={(e) => { setConditionFilter(e.target.value); setPage(0); }}
          aria-label="Filter by inventory type"
          className="h-10 px-3 rounded-xl border border-border bg-card text-[13px] font-medium">
          <option value="all">All inventory</option>
          <option value="new">New</option><option value="used">Used</option><option value="cpo">CPO</option>
        </select>
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        {error ? (
          <div className="p-8 text-center">
            <XCircle className="w-8 h-8 text-red-500 mx-auto mb-2" />
            <p className="text-sm font-semibold text-foreground">Could not load description operations.</p>
            <p className="text-xs text-muted-foreground mt-1">{error}</p>
            <button onClick={reload} className="mt-3 h-9 px-4 rounded-lg border border-border text-[13px] font-semibold">Try again</button>
          </div>
        ) : !cases ? (
          <div className="divide-y divide-border">
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-[68px] animate-pulse bg-muted/30" />)}
          </div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center">
            <CheckCircle2 className="w-9 h-9 text-emerald-500 mx-auto mb-2" />
            <p className="text-sm font-semibold text-foreground">
              {cases.length === 0 ? "No description cases yet." : "All active descriptions are current. No review is required."}
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              {cases.length === 0
                ? "New vehicles initialize automatically at ingest. Run reconciliation to cover inventory added another way."
                : "Nothing matches the current filters."}
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[900px]">
                <thead>
                  <tr className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground border-b border-border">
                    <th className="px-4 py-2.5">Vehicle</th>
                    <th className="px-3 py-2.5">Stock / VIN</th>
                    <th className="px-3 py-2.5">Status</th>
                    <th className="px-3 py-2.5">Fact confidence</th>
                    <th className="px-3 py-2.5">Validation</th>
                    <th className="px-3 py-2.5">Internal publication</th>
                    <th className="px-3 py-2.5">Channels</th>
                    <th className="px-3 py-2.5">Updated</th>
                    <th className="px-3 py-2.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {paged.map((c) => {
                    const v = vehicles[c.vehicle_id] || {};
                    const meta = STATUS_META[c.status as DescriptionStatus] ?? STATUS_META.UNINITIALIZED;
                    const conf = factConfidenceLabel(c.fact_confidence);
                    const blocked = c.publication_eligibility === "blocked";
                    const needsReview = c.publication_eligibility === "review_required";
                    const ready = CHANNEL_META.filter((ch) => ch.deliveryMode === "internal_projection").length;
                    return (
                      <tr key={c.id} className="hover:bg-primary/[0.025] transition-colors">
                        <td className="px-4 py-3">
                          <p className="text-[13.5px] font-semibold text-foreground leading-tight">{v.ymm || "Vehicle"}</p>
                          <p className="text-[11.5px] text-muted-foreground">{v.trim || "—"}</p>
                        </td>
                        <td className="px-3 py-3">
                          <p className="text-[12px] text-foreground">{(v.mc_attributes || {}).stock_no || "—"}</p>
                          <p className="text-[11px] font-mono text-muted-foreground">…{String(c.vin).slice(-8)}</p>
                        </td>
                        <td className="px-3 py-3"><Pill tone={meta.tone}>{meta.label}</Pill></td>
                        <td className="px-3 py-3"><Pill tone={conf.tone}>{conf.label}</Pill></td>
                        <td className="px-3 py-3">
                          {blocked ? <Pill tone="red"><XCircle className="w-3 h-3" /> Blocked</Pill>
                            : needsReview ? <Pill tone="amber"><AlertTriangle className="w-3 h-3" /> {c.open_exception_count || 1} issue</Pill>
                            : <Pill tone="emerald"><CheckCircle2 className="w-3 h-3" /> Passed</Pill>}
                        </td>
                        <td className="px-3 py-3">
                          {c.status === "PUBLISHED"
                            ? <span className="text-[12px] font-semibold text-emerald-700">Published</span>
                            : <span className="text-[12px] text-muted-foreground">Not published</span>}
                        </td>
                        <td className="px-3 py-3 text-[12px] text-muted-foreground">{ready} internal · {CHANNEL_META.length - ready} export</td>
                        <td className="px-3 py-3 text-[11.5px] text-muted-foreground whitespace-nowrap">
                          {c.updated_at ? new Date(c.updated_at).toLocaleDateString() : "—"}
                        </td>
                        <td className="px-3 py-3 text-right">
                          <button onClick={() => navigate(`/description-intelligence/${c.vehicle_id}`)}
                            className="h-8 px-3 rounded-lg border border-border text-[12px] font-semibold text-foreground hover:border-primary hover:text-primary inline-flex items-center gap-1">
                            {c.open_exception_count > 0 ? "Review issue" : "Open record"} <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-border flex-wrap">
              <p className="text-[12px] text-muted-foreground">
                {page * PAGE_SIZE + 1}–{Math.min(rows.length, (page + 1) * PAGE_SIZE)} of {rows.length} vehicles
              </p>
              <div className="flex items-center gap-1.5">
                <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}
                  className="h-8 px-3 rounded-lg border border-border text-[12px] font-semibold disabled:opacity-40">Previous</button>
                <span className="text-[12px] text-muted-foreground px-2">{page + 1} / {pageCount}</span>
                <button onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} disabled={page >= pageCount - 1}
                  className="h-8 px-3 rounded-lg border border-border text-[12px] font-semibold disabled:opacity-40">Next</button>
              </div>
            </div>
          </>
        )}
      </div>

      <p className="text-[11.5px] text-muted-foreground mt-3 inline-flex items-center gap-1.5">
        <Sparkles className="w-3.5 h-3.5 text-violet-500" />
        Descriptions generate automatically at ingest. Only exceptions need a person.
      </p>
    </div>
  );
}
