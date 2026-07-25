import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle, Car, CheckCircle2, ChevronDown, ChevronRight, ChevronUp, Clock, Loader2,
  RefreshCw, Search, ShieldCheck, Sparkles, XCircle, Settings2, FileText, SlidersHorizontal,
} from "lucide-react";
import { useDescriptionOperations, useDescriptionPermissions } from "@/hooks/useDescriptionOps";
import {
  STATUS_META, TONE_CLASS, factConfidenceLabel, type DescriptionStatus,
} from "@/lib/description/model";
import { toast } from "sonner";

// /description-operations — the fleet-level workspace. The primary action is
// reviewing exceptions, not generating copy: clean vehicles are expected to
// publish without anyone opening this page.

const PAGE_SIZES = [10, 25, 50, 100];
type SortKey = "vehicle" | "status" | "confidence" | "updated";

interface FilterDef { value: string; set: (v: string) => void; label: string; allLabel: string; options: [string, string][] }

const FILTERS = (
  status: string, setStatus: (v: string) => void,
  validation: string, setValidation: (v: string) => void,
  channel: string, setChannel: (v: string) => void,
  condition: string, setCondition: (v: string) => void,
): FilterDef[] => [
  { value: status, set: setStatus, label: "Filter by status", allLabel: "All Statuses",
    options: [["exceptions", "Has Exceptions"],
      ...Object.keys(STATUS_META).map((s) => [s, STATUS_META[s as DescriptionStatus].label] as [string, string])] },
  { value: validation, set: setValidation, label: "Filter by validation", allLabel: "All Validations",
    options: [["passed", "Passed"], ["review", "Review Required"], ["blocked", "Blocked"]] },
  { value: channel, set: setChannel, label: "Filter by channel readiness", allLabel: "All Channels",
    options: [["complete", "All Ready"], ["incomplete", "Partially Ready"], ["none", "Not Generated"]] },
  { value: condition, set: setCondition, label: "Filter by location or inventory type", allLabel: "All Locations",
    options: [["new", "New"], ["used", "Used"], ["cpo", "CPO"]] },
];

const Pill = ({ tone, children }: { tone: keyof typeof TONE_CLASS; children: React.ReactNode }) => (
  <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border whitespace-nowrap ${TONE_CLASS[tone]}`}>{children}</span>
);

function StatCard({ label, value, tone, Icon, active, onClick }: {
  label: string; value: number; tone: keyof typeof TONE_CLASS;
  Icon: typeof Clock; active: boolean; onClick: () => void;
}) {
  return (
    <button onClick={onClick} aria-pressed={active}
      className={`text-left rounded-2xl border bg-card p-3.5 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary min-h-[76px] ${
        active ? "border-primary shadow-[0_8px_24px_-14px_rgba(37,99,235,0.4)]" : "border-border hover:border-primary/40"}`}>
      <span className="flex items-center gap-2.5">
        <span className={`grid place-items-center w-10 h-10 rounded-xl border shrink-0 ${TONE_CLASS[tone]}`}><Icon className="w-4 h-4" /></span>
        <span className="min-w-0">
          <span className="block text-[22px] font-bold text-foreground leading-none">{value}</span>
          <span className="block text-[11.5px] text-muted-foreground mt-1 leading-tight truncate">{label}</span>
        </span>
      </span>
    </button>
  );
}

export default function DescriptionOperations() {
  const navigate = useNavigate();
  const perms = useDescriptionPermissions();
  const { cases, vehicles, channelCounts, summary, error, reload, reconcile } = useDescriptionOperations();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [conditionFilter, setConditionFilter] = useState<string>("all");
  const [validationFilter, setValidationFilter] = useState<string>("all");
  const [channelFilter, setChannelFilter] = useState<string>("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "updated", dir: "desc" });
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [syncing, setSyncing] = useState(false);

  const runReconcile = async () => {
    setSyncing(true);
    const res = await reconcile(25);
    setSyncing(false);
    if (!res.ok) { toast.error(res.error || "Reconciliation could not run"); return; }
    toast.success(`Reconciliation examined ${res.examined} vehicle${res.examined === 1 ? "" : "s"}`);
  };

  const lastSync = useMemo(() => {
    const times = (cases || []).map((c) => c.last_orchestrated_at).filter(Boolean) as string[];
    return times.length ? new Date(Math.max(...times.map((t) => new Date(t).getTime()))) : null;
  }, [cases]);

  const rows = useMemo(() => {
    if (!cases) return [];
    const q = query.trim().toLowerCase();
    const filtered = cases.filter((c) => {
      const v = vehicles[c.vehicle_id] || {};
      if (statusFilter === "exceptions" && c.open_exception_count === 0) return false;
      // these cards count a family of states, so they must filter the same family
      if (statusFilter === "FAILED_BLOCKED" && !["FAILED_BLOCKED", "FAILED_RETRYABLE"].includes(c.status)) return false;
      if (statusFilter === "STALE" && !(c.status === "STALE" || c.potentially_stale)) return false;
      if (!["all", "exceptions", "FAILED_BLOCKED", "STALE"].includes(statusFilter) && c.status !== statusFilter) return false;
      if (conditionFilter !== "all" && String(v.condition || "").toLowerCase() !== conditionFilter) return false;
      if (validationFilter === "passed" && c.publication_eligibility !== "eligible") return false;
      if (validationFilter === "blocked" && c.publication_eligibility !== "blocked") return false;
      if (validationFilter === "review" && c.publication_eligibility !== "review_required") return false;
      if (channelFilter === "complete" && !(channelCounts[c.id] && channelCounts[c.id].ready === channelCounts[c.id].total)) return false;
      if (channelFilter === "incomplete" && (!channelCounts[c.id] || channelCounts[c.id].ready === channelCounts[c.id].total)) return false;
      if (channelFilter === "none" && channelCounts[c.id]) return false;
      if (!q) return true;
      return [c.vin, v.ymm, v.trim, (v.mc_attributes || {}).stock_no]
        .filter(Boolean).some((s: string) => String(s).toLowerCase().includes(q));
    });
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const va = vehicles[a.vehicle_id] || {}, vb = vehicles[b.vehicle_id] || {};
      switch (sort.key) {
        case "vehicle": return String(va.ymm || "").localeCompare(String(vb.ymm || "")) * dir;
        case "status": return String(a.status).localeCompare(String(b.status)) * dir;
        case "confidence": return ((a.fact_confidence ?? -1) - (b.fact_confidence ?? -1)) * dir;
        default: return (new Date(a.updated_at || 0).getTime() - new Date(b.updated_at || 0).getTime()) * dir;
      }
    });
  }, [cases, vehicles, channelCounts, query, statusFilter, conditionFilter, validationFilter, channelFilter, sort]);

  const paged = rows.slice(page * pageSize, page * pageSize + pageSize);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const exceptionCount = (cases || []).reduce((n, c) => n + (c.open_exception_count || 0), 0);
  const setFilter = (f: string) => { setStatusFilter((cur) => (cur === f ? "all" : f)); setPage(0); };
  const toggleSort = (key: SortKey) =>
    setSort((cur) => ({ key, dir: cur.key === key && cur.dir === "desc" ? "asc" : "desc" }));

  const SortHead = ({ k, children }: { k: SortKey; children: React.ReactNode }) => (
    <th className="px-3 py-2.5">
      <button onClick={() => toggleSort(k)} className="inline-flex items-center gap-1 hover:text-foreground min-h-[44px]">
        {children}
        {sort.key === k && (sort.dir === "desc" ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />)}
      </button>
    </th>
  );

  const pageNumbers = useMemo(() => {
    const out: (number | "…")[] = [];
    for (let i = 0; i < pageCount; i++) {
      if (i < 2 || i > pageCount - 2 || Math.abs(i - page) <= 1) out.push(i);
      else if (out[out.length - 1] !== "…") out.push("…");
    }
    return out;
  }, [pageCount, page]);

  return (
    <div className="max-w-[1480px] mx-auto p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        {/* The app chrome carries this title on desktop; repeating it there
            would show it twice, so the in-content copy is mobile-only. */}
        <div className="min-w-0 lg:hidden">
          <h1 className="font-display text-[26px] font-bold tracking-tight text-foreground leading-none">Description Operations</h1>
          <p className="text-sm text-muted-foreground mt-2">Automated merchandising intelligence across every vehicle.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={runReconcile} disabled={syncing}
            className="min-h-[44px] px-3.5 rounded-xl border border-border bg-card text-[13px] font-semibold text-foreground hover:border-primary inline-flex items-center gap-1.5 disabled:opacity-60">
            {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Run Reconciliation
          </button>
          {perms.canConfigure && (
            <button onClick={() => navigate("/admin?tab=merchandising-seo")}
              className="min-h-[44px] px-3.5 rounded-xl border border-border bg-card text-[13px] font-semibold text-foreground hover:border-primary inline-flex items-center gap-1.5">
              <Settings2 className="w-4 h-4" /> Automation Settings
            </button>
          )}
          <button onClick={() => setFilter("exceptions")}
            className="min-h-[44px] px-4 rounded-xl bg-primary text-primary-foreground text-[13px] font-semibold inline-flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4" /> Review Exceptions
            {exceptionCount > 0 && <span className="ml-1 px-1.5 py-0.5 rounded-full bg-white/20 text-[11px]">{exceptionCount}</span>}
          </button>
        </div>
      </div>

      {/* Summary band */}
      {summary ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2.5 mb-3">
          <StatCard label="Active Inventory" value={summary.activeInventory} tone="blue" Icon={FileText} active={statusFilter === "all"} onClick={() => setFilter("all")} />
          <StatCard label="Published" value={summary.published} tone="emerald" Icon={ShieldCheck} active={statusFilter === "PUBLISHED"} onClick={() => setFilter("PUBLISHED")} />
          <StatCard label="Ready" value={summary.ready} tone="emerald" Icon={CheckCircle2} active={statusFilter === "READY"} onClick={() => setFilter("READY")} />
          <StatCard label="Review Required" value={summary.reviewRequired} tone="amber" Icon={AlertTriangle} active={statusFilter === "REVIEW_REQUIRED"} onClick={() => setFilter("REVIEW_REQUIRED")} />
          <StatCard label="Failed" value={summary.failed} tone="red" Icon={XCircle} active={statusFilter === "FAILED_BLOCKED"} onClick={() => setFilter("FAILED_BLOCKED")} />
          <StatCard label="Stale" value={summary.stale} tone="amber" Icon={Clock} active={statusFilter === "STALE"} onClick={() => setFilter("STALE")} />
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2.5 mb-3">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-[76px] rounded-2xl border border-border bg-card animate-pulse" />)}
        </div>
      )}

      {/* Automation status band */}
      {summary && (
        summary.missing > 0 ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-3 mb-3 flex items-center justify-between gap-3 flex-wrap">
            <p className="text-[13px] text-amber-900 inline-flex items-center gap-2 min-w-0">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span><b>{summary.missing}</b> active vehicle{summary.missing === 1 ? "" : "s"} never initialized a description. Vehicles added outside the inventory feed are picked up by reconciliation.</span>
            </p>
            <button onClick={runReconcile} disabled={syncing}
              className="min-h-[44px] px-3.5 rounded-lg bg-amber-600 text-white text-[12.5px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-60 shrink-0">
              {syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Initialize Now
            </button>
          </div>
        ) : (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-3 mb-3 flex items-center justify-between gap-3 flex-wrap">
            <p className="text-[13px] text-emerald-900 inline-flex items-center gap-2 min-w-0">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>
                {lastSync ? `Last automated run ${lastSync.toLocaleString()}` : "Automation is connected"} · {summary.activeInventory} processed
                {exceptionCount > 0 ? ` · ${exceptionCount} need attention` : " · none need attention"}
              </span>
            </p>
            <button onClick={() => navigate("/admin?tab=audit")}
              className="text-[12.5px] font-semibold text-emerald-800 hover:underline shrink-0 min-h-[44px]">
              View Sync History
            </button>
          </div>
        )
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-muted-foreground absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }}
            placeholder="Search by make, model, stock # or VIN…" aria-label="Search vehicles"
            className="w-full min-h-[44px] pl-10 pr-3 rounded-xl border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary" />
        </div>
        {(FILTERS(statusFilter, setStatusFilter, validationFilter, setValidationFilter,
                  channelFilter, setChannelFilter, conditionFilter, setConditionFilter)).map((f) => (
          <select key={f.label} value={f.value} onChange={(e) => { f.set(e.target.value); setPage(0); }}
            aria-label={f.label}
            className="min-h-[44px] px-3 rounded-xl border border-border bg-card text-[13px] font-medium">
            <option value="all">{f.allLabel}</option>
            {f.options.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        ))}
        <button onClick={() => { setStatusFilter("all"); setValidationFilter("all"); setChannelFilter("all"); setConditionFilter("all"); setQuery(""); setPage(0); }}
          className="min-h-[44px] px-3.5 rounded-xl border border-border bg-card text-[13px] font-semibold text-foreground inline-flex items-center gap-1.5">
          <SlidersHorizontal className="w-4 h-4" /> Filters
        </button>
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        {error ? (
          <div className="p-8 text-center">
            <XCircle className="w-8 h-8 text-red-500 mx-auto mb-2" />
            <p className="text-sm font-semibold text-foreground">Could not load description operations.</p>
            <p className="text-xs text-muted-foreground mt-1">{error}</p>
            <button onClick={reload} className="mt-3 min-h-[44px] px-4 rounded-lg border border-border text-[13px] font-semibold">Try Again</button>
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
              <table className="w-full text-left border-collapse min-w-[1040px]">
                <thead>
                  <tr className="text-[11.5px] font-semibold text-muted-foreground border-b border-border">
                    <SortHead k="vehicle">Vehicle</SortHead>
                    <th className="px-3 py-2.5">Stock / VIN</th>
                    <SortHead k="status">Description Status</SortHead>
                    <SortHead k="confidence">Fact Confidence</SortHead>
                    <th className="px-3 py-2.5">Validation</th>
                    <th className="px-3 py-2.5">Internal Publication</th>
                    <th className="px-3 py-2.5">Channel Readiness</th>
                    <SortHead k="updated">Updated</SortHead>
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
                    const cc = channelCounts[c.id];
                    return (
                      <tr key={c.id} className="hover:bg-primary/[0.025] transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5 min-w-0">
                            {v.hero_image_url ? (
                              <img src={v.hero_image_url} alt="" loading="lazy"
                                className="w-14 h-10 rounded-lg object-cover border border-border shrink-0" />
                            ) : (
                              <span className="w-14 h-10 rounded-lg border border-border bg-muted/40 grid place-items-center shrink-0">
                                <Car className="w-4 h-4 text-muted-foreground" />
                              </span>
                            )}
                            <span className="min-w-0">
                              <span className="block text-[13.5px] font-semibold text-foreground leading-tight truncate">{v.ymm || "Vehicle"}</span>
                              <span className="block text-[11.5px] text-muted-foreground truncate">{v.trim || "—"}</span>
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-3">
                          <p className="text-[12px] text-foreground">{(v.mc_attributes || {}).stock_no || "—"}</p>
                          <p className="text-[10.5px] font-mono text-muted-foreground">{c.vin}</p>
                        </td>
                        <td className="px-3 py-3"><Pill tone={meta.tone}>{meta.label}</Pill></td>
                        <td className="px-3 py-3">
                          <span className={`block text-[12px] font-semibold ${
                            conf.tone === "emerald" ? "text-emerald-700" : conf.tone === "amber" ? "text-amber-700" : "text-red-600"}`}>
                            {conf.label.split(" ")[0]}
                          </span>
                          <span className="block text-[12.5px] font-bold text-foreground">
                            {c.fact_confidence != null ? `${c.fact_confidence}%` : "—"}
                          </span>
                        </td>
                        <td className="px-3 py-3">
                          {blocked ? (
                            <span className="text-[12px] font-semibold text-red-600 inline-flex items-center gap-1">
                              <XCircle className="w-3.5 h-3.5" /> {c.open_exception_count || 1} Error{(c.open_exception_count || 1) === 1 ? "" : "s"}
                            </span>
                          ) : needsReview ? (
                            <span className="text-[12px] font-semibold text-amber-700 inline-flex items-center gap-1">
                              <AlertTriangle className="w-3.5 h-3.5" /> {c.open_exception_count || 1} Conflict{(c.open_exception_count || 1) === 1 ? "" : "s"}
                            </span>
                          ) : (
                            <span className="text-[12px] font-semibold text-emerald-700 inline-flex items-center gap-1">
                              <CheckCircle2 className="w-3.5 h-3.5" /> Passed
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          {c.status === "PUBLISHED" ? (
                            <>
                              <span className="block text-[12px] font-semibold text-emerald-700">Published</span>
                              <span className="block text-[10.5px] text-muted-foreground">
                                {c.last_success_at ? new Date(c.last_success_at).toLocaleDateString() : ""}
                              </span>
                            </>
                          ) : <span className="text-[12px] text-muted-foreground">Not Published</span>}
                        </td>
                        <td className="px-3 py-3 text-[12px]">
                          {cc ? (
                            <span className={`font-semibold ${cc.ready === cc.total ? "text-emerald-700"
                              : cc.ready === 0 ? "text-red-600" : "text-amber-700"}`}>
                              {cc.ready === cc.total && <span className="block">All Ready</span>}
                              <span className="block">{cc.ready} / {cc.total}</span>
                            </span>
                          ) : <span className="text-muted-foreground">Not Generated</span>}
                        </td>
                        <td className="px-3 py-3 whitespace-nowrap">
                          <span className="block text-[11.5px] text-foreground">
                            {c.updated_at ? new Date(c.updated_at).toLocaleDateString() : "—"}
                          </span>
                          <span className="block text-[10.5px] text-muted-foreground">
                            {c.updated_at ? new Date(c.updated_at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : ""}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-right">
                          <button onClick={() => navigate(`/description-intelligence/${c.vehicle_id}`)}
                            className="min-h-[44px] px-3 rounded-lg border border-blue-200 bg-blue-50 text-[12px] font-semibold text-blue-700 hover:bg-blue-100 inline-flex items-center gap-1">
                            {c.open_exception_count > 0 ? "Review Issue" : "Open Record"}
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
                {page * pageSize + 1}–{Math.min(rows.length, (page + 1) * pageSize)} of {rows.length} vehicles
              </p>
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-1">
                  <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}
                    aria-label="Previous page"
                    className="w-11 h-11 grid place-items-center rounded-lg border border-border disabled:opacity-40">
                    <ChevronRight className="w-4 h-4 rotate-180" />
                  </button>
                  {pageNumbers.map((n, i) => n === "…" ? (
                    <span key={`gap-${i}`} className="px-1 text-[12px] text-muted-foreground">…</span>
                  ) : (
                    <button key={n} onClick={() => setPage(n)}
                      aria-current={n === page ? "page" : undefined}
                      className={`min-w-[44px] h-11 px-2 rounded-lg text-[12px] font-semibold ${
                        n === page ? "bg-primary text-primary-foreground" : "border border-border text-foreground"}`}>
                      {n + 1}
                    </button>
                  ))}
                  <button onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} disabled={page >= pageCount - 1}
                    aria-label="Next page"
                    className="w-11 h-11 grid place-items-center rounded-lg border border-border disabled:opacity-40">
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
                <label className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
                  Rows per page
                  <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }}
                    className="h-11 px-2 rounded-lg border border-border bg-card text-[12px] font-medium">
                    {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
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
