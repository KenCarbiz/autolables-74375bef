import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle, Car, CheckCircle2, ChevronDown, ChevronRight, ChevronUp, Clock, Database,
  Loader2, MoreVertical, RefreshCw, Search, Settings2, ShieldCheck, SlidersHorizontal, XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { vehicleStockNumber } from "@/lib/vehicleStockNumber";
import { useOperatingMetrics } from "@/hooks/useOperatingMetrics";
import {
  useDescriptionOperations, useDescriptionPermissions, type DescriptionCaseRow,
} from "@/hooks/useDescriptionOps";
import { OperationsKpiCard, type KpiTone } from "@/components/description/OperationsKpiCard";
import {
  VehicleDiagnosticPanel, type DiagnosticException,
} from "@/components/description/VehicleDiagnosticPanel";

// /description-operations — a VEHICLE report, not an event log.
//
// description_exceptions holds one row per validation event and several rows
// can concern the same car, so every headline number here is a count of
// DISTINCT VEHICLES folded out of those events. Validator codes, severities
// and raw payloads live in the per-vehicle diagnostic panel.

const PAGE_SIZES = [10, 25, 50, 100];

type SortKey = "vehicle" | "state" | "confidence" | "updated";

type OpsState = "published" | "ready" | "needs_review" | "waiting_on_data" | "failed" | "in_progress";

const STATE_META: Record<OpsState, { label: string; className: string }> = {
  published:       { label: "Published",       className: "bg-emerald-50 text-emerald-700" },
  ready:           { label: "Ready",           className: "bg-emerald-50 text-emerald-700" },
  needs_review:    { label: "Needs Review",    className: "bg-amber-50 text-amber-700" },
  waiting_on_data: { label: "Waiting on Data", className: "bg-blue-50 text-blue-700" },
  failed:          { label: "Failed",          className: "bg-rose-50 text-rose-700" },
  in_progress:     { label: "In Progress",     className: "bg-muted text-muted-foreground" },
};

const ACTION_LABEL: Record<OpsState, string> = {
  published: "OPEN RECORD",
  ready: "OPEN RECORD",
  needs_review: "REVIEW FACTS",
  waiting_on_data: "CHECK DATA",
  failed: "REVIEW ERROR",
  in_progress: "OPEN RECORD",
};

// Plain-language issue names. The validator code itself is kept for the
// diagnostic panel; it is never the thing a manager reads first.
const ISSUE_LABELS: Record<string, string> = {
  EQUIPMENT_CONFLICT: "Equipment conflict",
  CPO_STATUS_CONFLICT: "CPO status conflict",
  REQUIRED_DATA_MISSING: "Missing vehicle data",
  VALIDATION_FAILED: "Unverified claim",
  REVIEW_REQUIRED: "Manager review",
  GENERATION_FAILED: "Generation failed",
  GENERATION_BLOCKED: "Generation blocked",
  CHANNEL_GENERATION_FAILED: "Channel copy failed",
  CHANNEL_LENGTH_EXCEEDED: "Copy too long for a channel",
  MANUAL_CONTENT_STALE: "Locked copy may be stale",
  INTERNAL_PUBLICATION_FAILED: "Publication failed",
};

const DATA_ISSUES = new Set(["REQUIRED_DATA_MISSING"]);
const FAILURE_ISSUES = new Set([
  "GENERATION_FAILED", "GENERATION_BLOCKED", "CHANNEL_GENERATION_FAILED", "INTERNAL_PUBLICATION_FAILED",
]);
const SEVERITY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1, info: 0 };

const issueLabel = (code: string) =>
  ISSUE_LABELS[code] ?? code.toLowerCase().replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

const confidenceBand = (n: number | null | undefined): { word: string; className: string } => {
  if (n == null) return { word: "Not checked", className: "text-muted-foreground" };
  if (n >= 80) return { word: "Verified", className: "text-emerald-700" };
  if (n >= 50) return { word: "Partial", className: "text-amber-700" };
  return { word: "Unverified", className: "text-rose-600" };
};

interface ExceptionRow extends DiagnosticException {
  vehicle_id: string;
  description_case_id: string;
}

interface VehicleLite {
  id: string;
  vin: string | null;
  ymm: string | null;
  trim: string | null;
  condition: string | null;
  status: string | null;
  hero_image_url: string | null;
  mc_attributes: Record<string, unknown> | null;
}

interface OpsRow {
  vehicleId: string;
  vehicle: VehicleLite;
  caseRow: DescriptionCaseRow | null;
  state: OpsState;
  issue: string | null;
  exceptions: ExceptionRow[];
  channelsPresent: string[];
  updatedAt: string | null;
}

/** Every OPEN exception event for the tenant, paged past PostgREST's row cap. */
function useOpenExceptions(tenantId: string | null) {
  const [exceptions, setExceptions] = useState<ExceptionRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!tenantId) { setExceptions([]); return; }
    setError(null);
    const all: ExceptionRow[] = [];
    for (let from = 0; from < 10000; from += 1000) {
      // deno-lint-ignore no-explicit-any
      const { data, error: err } = await (supabase as any)
        .from("description_exceptions")
        .select("id, vehicle_id, description_case_id, exception_type, severity, blocking, status, title, summary, channel, created_at, details_json")
        .eq("tenant_id", tenantId)
        .in("status", ["open", "in_progress"])
        .order("created_at", { ascending: false })
        .range(from, from + 999);
      if (err) { setError(err.message || "Could not load exceptions"); break; }
      const page = (data || []) as ExceptionRow[];
      all.push(...page);
      if (page.length < 1000) break;
    }
    setExceptions(all);
  }, [tenantId]);

  useEffect(() => { void load(); }, [load]);
  return { exceptions, exceptionError: error, reloadExceptions: load };
}

/**
 * Channel variants that exist for each case's CURRENT master version.
 *
 * Regeneration writes a fresh row per channel against a new master, so an
 * unfiltered read counts every historical variant and reports more variants
 * than there are channels. A locked variant keeps its manual copy attached to
 * the older master it was written against, so it counts too.
 */
function useChannelPresence(tenantId: string | null, cases: DescriptionCaseRow[] | null) {
  const [presence, setPresence] = useState<Record<string, string[]>>({});
  const [configuredChannels, setConfiguredChannels] = useState<string[]>([]);

  const load = useCallback(async () => {
    if (!tenantId || !cases) return;
    // deno-lint-ignore no-explicit-any
    const sb = supabase as any;
    const { data: settings } = await sb.from("description_settings")
      .select("enabled_channels").eq("tenant_id", tenantId).maybeSingle();
    const enabled: string[] = Array.isArray(settings?.enabled_channels) ? settings.enabled_channels : [];
    setConfiguredChannels(enabled);

    const caseToVehicle = new Map(cases.map((c) => [c.id, c.vehicle_id]));
    const masterIds = cases.map((c) => c.current_master_version_id).filter(Boolean) as string[];
    const rows: { description_case_id: string; channel: string }[] = [];
    for (let i = 0; i < masterIds.length; i += 100) {
      const { data } = await sb.from("description_channel_versions")
        .select("description_case_id, channel")
        .eq("tenant_id", tenantId).in("master_version_id", masterIds.slice(i, i + 100));
      if (data) rows.push(...data);
    }
    const { data: locked } = await sb.from("description_channel_versions")
      .select("description_case_id, channel")
      .eq("tenant_id", tenantId).eq("locked", true).limit(2000);

    const byVehicle: Record<string, string[]> = {};
    const seen = new Set<string>();
    for (const cv of [...(locked || []), ...rows]) {
      const vehicleId = caseToVehicle.get(cv.description_case_id);
      if (!vehicleId) continue;
      if (enabled.length && !enabled.includes(cv.channel)) continue;
      const dedupe = `${vehicleId}:${cv.channel}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      (byVehicle[vehicleId] ||= []).push(cv.channel);
    }
    setPresence(byVehicle);
  }, [tenantId, cases]);

  useEffect(() => { void load(); }, [load]);
  return { presence, configuredChannels, reloadPresence: load };
}

export default function DescriptionOperations() {
  const navigate = useNavigate();
  const { tenant } = useTenant();
  const tenantId = tenant?.id && tenant.id !== "house" ? tenant.id : null;
  const perms = useDescriptionPermissions();
  const { metrics, loading: metricsLoading, error: metricsError } = useOperatingMetrics(tenantId);
  const { cases, vehicles, summary, error, reload, reconcile } = useDescriptionOperations();
  const { exceptions, exceptionError, reloadExceptions } = useOpenExceptions(tenantId);
  const { presence, configuredChannels, reloadPresence } = useChannelPresence(tenantId, cases);

  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState<"all" | OpsState>("all");
  const [conditionFilter, setConditionFilter] = useState("all");
  const [channelFilter, setChannelFilter] = useState("all");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "updated", dir: "desc" });
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number; vehicleId: string; vin: string } | null>(null);

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(null); };
    const onScroll = () => setMenu(null);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [menu]);

  const runReconcile = async () => {
    setSyncing(true);
    const res = await reconcile(25);
    setSyncing(false);
    if (!res.ok) { toast.error(res.error || "Reconciliation could not run"); return; }
    await Promise.all([reloadExceptions(), reloadPresence()]);
    toast.success(`Reconciliation examined ${res.examined} vehicle${res.examined === 1 ? "" : "s"}`);
  };

  const lastRun = useMemo(() => {
    const times = (cases || []).map((c) => c.last_orchestrated_at).filter(Boolean) as string[];
    return times.length ? new Date(Math.max(...times.map((t) => new Date(t).getTime()))) : null;
  }, [cases]);

  // One entry per VEHICLE. The exception events fold in here, which is where
  // 470 open events collapse to the number of cars they actually concern.
  const allRows = useMemo<OpsRow[] | null>(() => {
    if (!cases || !exceptions) return null;
    const caseByVehicle = new Map(cases.map((c) => [c.vehicle_id, c]));
    const excByVehicle = new Map<string, ExceptionRow[]>();
    for (const e of exceptions) {
      const list = excByVehicle.get(e.vehicle_id);
      if (list) list.push(e); else excByVehicle.set(e.vehicle_id, [e]);
    }

    const list = Object.values(vehicles) as VehicleLite[];
    return list.map((vehicle) => {
      const caseRow = caseByVehicle.get(vehicle.id) ?? null;
      const rowExceptions = (excByVehicle.get(vehicle.id) || []).slice().sort((a, b) => {
        if (a.blocking !== b.blocking) return a.blocking ? -1 : 1;
        const sev = (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0);
        if (sev !== 0) return sev;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });
      const codes = new Set(rowExceptions.map((e) => e.exception_type));
      const hasFailure = [...codes].some((c) => FAILURE_ISSUES.has(c));
      const hasDataGap = [...codes].some((c) => DATA_ISSUES.has(c));
      const status = caseRow?.status ?? null;

      let state: OpsState;
      if (!caseRow) state = "waiting_on_data";
      else if (status === "FAILED_BLOCKED" || status === "FAILED_RETRYABLE" || hasFailure) state = "failed";
      else if (status === "UNINITIALIZED" || hasDataGap) state = "waiting_on_data";
      else if (
        status === "REVIEW_REQUIRED" || status === "STALE" || caseRow.potentially_stale ||
        caseRow.publication_eligibility === "review_required" || rowExceptions.length > 0
      ) state = "needs_review";
      else if (status === "PUBLISHED" || status === "PARTIALLY_PUBLISHED") state = "published";
      else if (status === "READY") state = "ready";
      else state = "in_progress";

      let issue: string | null = rowExceptions.length ? issueLabel(rowExceptions[0].exception_type) : null;
      if (!issue && !caseRow) issue = "No description started";
      if (!issue && (status === "STALE" || caseRow?.potentially_stale)) issue = "Source data changed";
      if (!issue && caseRow?.publication_eligibility === "review_required") issue = "Manager review";

      return {
        vehicleId: vehicle.id,
        vehicle,
        caseRow,
        state,
        issue,
        exceptions: rowExceptions,
        channelsPresent: presence[vehicle.id] || [],
        updatedAt: (caseRow?.updated_at as string | undefined) ?? null,
      };
    });
  }, [cases, exceptions, vehicles, presence]);

  const kpis = useMemo(() => {
    const counts = { published: 0, needs_review: 0, waiting_on_data: 0, failed: 0 };
    for (const r of allRows || []) {
      if (r.state === "published") counts.published += 1;
      else if (r.state === "needs_review") counts.needs_review += 1;
      else if (r.state === "waiting_on_data") counts.waiting_on_data += 1;
      else if (r.state === "failed") counts.failed += 1;
    }
    return counts;
  }, [allRows]);

  const rows = useMemo(() => {
    if (!allRows) return null;
    const q = query.trim().toLowerCase();
    const filtered = allRows.filter((r) => {
      if (stateFilter !== "all" && r.state !== stateFilter) return false;
      if (conditionFilter !== "all" && String(r.vehicle.condition || "").toLowerCase() !== conditionFilter) return false;
      const present = r.channelsPresent.length;
      const configured = configuredChannels.length;
      if (channelFilter === "complete" && !(configured > 0 && present === configured)) return false;
      if (channelFilter === "partial" && !(present > 0 && present < configured)) return false;
      if (channelFilter === "none" && present !== 0) return false;
      if (!q) return true;
      return [r.vehicle.vin, r.vehicle.ymm, r.vehicle.trim, vehicleStockNumber(r.vehicle)]
        .filter(Boolean).some((s) => String(s).toLowerCase().includes(q));
    });
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sort.key) {
        case "vehicle": return String(a.vehicle.ymm || "").localeCompare(String(b.vehicle.ymm || "")) * dir;
        case "state": return STATE_META[a.state].label.localeCompare(STATE_META[b.state].label) * dir;
        case "confidence":
          return (((a.caseRow?.fact_confidence ?? -1) as number) - ((b.caseRow?.fact_confidence ?? -1) as number)) * dir;
        default:
          return (new Date(a.updatedAt || 0).getTime() - new Date(b.updatedAt || 0).getTime()) * dir;
      }
    });
  }, [allRows, query, stateFilter, conditionFilter, channelFilter, configuredChannels, sort]);

  const total = rows?.length ?? 0;
  const paged = (rows || []).slice(page * pageSize, page * pageSize + pageSize);
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  // Events attached to vehicles still on the lot: the same population the
  // KPI above them counts.
  const openEventCount = (allRows || []).reduce((n, r) => n + r.exceptions.length, 0);

  const applyStateFilter = (s: "all" | OpsState) => {
    setStateFilter((cur) => (cur === s ? "all" : s));
    setPage(0);
  };

  const toggleSort = (key: SortKey) =>
    setSort((cur) => ({ key, dir: cur.key === key && cur.dir === "desc" ? "asc" : "desc" }));

  const SortHead = ({ k, children }: { k: SortKey; children: React.ReactNode }) => (
    <th className="px-3 py-2.5">
      <button type="button" onClick={() => toggleSort(k)} className="inline-flex items-center gap-1 min-h-[44px] hover:text-foreground">
        {children}
        {sort.key === k && (sort.dir === "desc" ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />)}
      </button>
    </th>
  );

  const pageNumbers = useMemo(() => {
    const out: (number | "...")[] = [];
    for (let i = 0; i < pageCount; i++) {
      if (i < 2 || i > pageCount - 2 || Math.abs(i - page) <= 1) out.push(i);
      else if (out[out.length - 1] !== "...") out.push("...");
    }
    return out;
  }, [pageCount, page]);

  if (!tenantId) {
    return (
      <div className="p-4 sm:p-6">
        <p className="text-al-body text-muted-foreground">
          Select a dealership to see description coverage for its vehicles.
        </p>
      </div>
    );
  }

  const kpiCards: {
    key: "all" | OpsState; label: string; value: number | string; scope: string;
    detail?: string; tone: KpiTone; icon: typeof Car;
  }[] = [
    {
      key: "all", label: "Active vehicles", value: metricsLoading ? "—" : metrics.activeInventory,
      scope: "Current snapshot - inventory not archived",
      detail: metricsLoading ? undefined : `${metrics.newInventory} new - ${metrics.usedInventory} used`,
      tone: "neutral", icon: Car,
    },
    {
      key: "published", label: "Published", value: kpis.published,
      scope: "Current snapshot - distinct vehicles",
      detail: "Live on the shopper listing, nothing outstanding",
      tone: "positive", icon: ShieldCheck,
    },
    {
      key: "needs_review", label: "Needs review", value: kpis.needs_review,
      scope: "Current snapshot - distinct vehicles",
      detail: `Folded from ${openEventCount} open exception event${openEventCount === 1 ? "" : "s"}`,
      tone: "attention", icon: AlertTriangle,
    },
    {
      key: "waiting_on_data", label: "Waiting on data", value: kpis.waiting_on_data,
      scope: "Current snapshot - distinct vehicles",
      detail: "No description possible until facts arrive",
      tone: "neutral", icon: Database,
    },
    {
      key: "failed", label: "Failed generation", value: kpis.failed,
      scope: "Current snapshot - distinct vehicles",
      detail: "Last attempt failed or was blocked",
      tone: "critical", icon: XCircle,
    },
  ];

  return (
    <div className="max-w-[1480px] mx-auto p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        {/* The app chrome carries this title on desktop; repeating it there
            would show it twice, so the in-content copy is mobile-only. */}
        <div className="min-w-0 lg:hidden">
          <h1 className="text-al-page text-foreground">Description Operations</h1>
          <p className="text-al-body text-muted-foreground mt-1">
            Which vehicles have a description, and which ones need a person.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap ml-auto">
          {perms.canGenerate && (
            <button
              type="button" onClick={runReconcile} disabled={syncing}
              className="min-h-[44px] px-3.5 rounded-xl border border-border bg-card text-al-meta font-semibold text-foreground hover:border-primary inline-flex items-center gap-1.5 disabled:opacity-60"
            >
              {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Run reconciliation
            </button>
          )}
          {perms.canConfigure && (
            <button
              type="button" onClick={() => navigate("/admin?tab=merchandising-seo")}
              className="min-h-[44px] px-3.5 rounded-xl border border-border bg-card text-al-meta font-semibold text-foreground hover:border-primary inline-flex items-center gap-1.5"
            >
              <Settings2 className="w-4 h-4" /> Automation settings
            </button>
          )}
          <button
            type="button" onClick={() => applyStateFilter("needs_review")}
            className="min-h-[44px] px-4 rounded-xl bg-primary text-primary-foreground text-al-meta font-semibold inline-flex items-center gap-1.5"
          >
            <AlertTriangle className="w-4 h-4" /> Review vehicles
            {kpis.needs_review > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full bg-card/20 tabular-nums">{kpis.needs_review}</span>
            )}
          </button>
        </div>
      </div>

      {allRows === null ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 mb-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-[124px] rounded-2xl border border-border bg-card animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5 mb-3">
          {kpiCards.map((k) => (
            <OperationsKpiCard
              key={k.key}
              label={k.label}
              value={k.value}
              scope={k.scope}
              detail={k.detail}
              tone={k.tone}
              icon={k.icon}
              active={stateFilter === k.key}
              onClick={() => applyStateFilter(k.key === "all" ? "all" : k.key)}
            />
          ))}
        </div>
      )}

      {metricsError && (
        <p className="text-al-meta text-rose-600 mb-3 inline-flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5" /> Inventory counts unavailable: {metricsError}
        </p>
      )}

      {allRows && (
        <p className="text-al-meta text-muted-foreground mb-3">
          {allRows.length} vehicle{allRows.length === 1 ? "" : "s"} classified: {kpis.published} published,{" "}
          {kpis.needs_review} needs review, {kpis.waiting_on_data} waiting on data, {kpis.failed} failed,{" "}
          {allRows.length - kpis.published - kpis.needs_review - kpis.waiting_on_data - kpis.failed} ready or in progress.
          Each vehicle is counted once.
          {!metricsLoading && !metricsError && metrics.activeInventory !== allRows.length
            ? ` Operating metrics reports ${metrics.activeInventory} active vehicles for this dealership.`
            : ""}
        </p>
      )}

      {summary && summary.missing > 0 && (
        <div className="rounded-2xl border border-border bg-card p-3 mb-3 flex items-center justify-between gap-3 flex-wrap">
          <p className="text-al-body text-foreground inline-flex items-center gap-2 min-w-0">
            <Database className="w-4 h-4 shrink-0 text-muted-foreground" />
            <span>
              <b>{summary.missing}</b> active vehicle{summary.missing === 1 ? "" : "s"} never started a description.
              Vehicles added outside the inventory feed are picked up by reconciliation.
            </span>
          </p>
          {perms.canGenerate && (
            <button
              type="button" onClick={runReconcile} disabled={syncing}
              className="min-h-[44px] px-3.5 rounded-lg bg-primary text-primary-foreground text-al-meta font-semibold inline-flex items-center gap-1.5 disabled:opacity-60 shrink-0"
            >
              {syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Initialize now
            </button>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-muted-foreground absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(0); }}
            placeholder="Search by make, model, stock # or VIN"
            aria-label="Search vehicles"
            className="w-full min-h-[44px] pl-10 pr-3 rounded-xl border border-border bg-card text-al-body focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <select
          value={stateFilter} aria-label="Filter by description state"
          onChange={(e) => { setStateFilter(e.target.value as "all" | OpsState); setPage(0); }}
          className="min-h-[44px] px-3 rounded-xl border border-border bg-card text-al-meta font-medium"
        >
          <option value="all">All description states</option>
          {(Object.keys(STATE_META) as OpsState[]).map((s) => (
            <option key={s} value={s}>{STATE_META[s].label}</option>
          ))}
        </select>
        <select
          value={conditionFilter} aria-label="Filter by condition"
          onChange={(e) => { setConditionFilter(e.target.value); setPage(0); }}
          className="min-h-[44px] px-3 rounded-xl border border-border bg-card text-al-meta font-medium"
        >
          <option value="all">New and used</option>
          <option value="new">New</option>
          <option value="used">Used</option>
          <option value="cpo">CPO</option>
        </select>
        <select
          value={channelFilter} aria-label="Filter by channel coverage"
          onChange={(e) => { setChannelFilter(e.target.value); setPage(0); }}
          className="min-h-[44px] px-3 rounded-xl border border-border bg-card text-al-meta font-medium"
        >
          <option value="all">Any channel coverage</option>
          <option value="complete">Every channel covered</option>
          <option value="partial">Some channels covered</option>
          <option value="none">No channel copy</option>
        </select>
        <button
          type="button"
          onClick={() => { setStateFilter("all"); setConditionFilter("all"); setChannelFilter("all"); setQuery(""); setPage(0); }}
          className="min-h-[44px] px-3.5 rounded-xl border border-border bg-card text-al-meta font-semibold text-foreground inline-flex items-center gap-1.5"
        >
          <SlidersHorizontal className="w-4 h-4" /> Reset
        </button>
      </div>

      <div className="rounded-2xl border border-border bg-card overflow-hidden">
        {error || exceptionError ? (
          <div className="p-8 text-center">
            <XCircle className="w-8 h-8 text-rose-500 mx-auto mb-2" />
            <p className="text-al-card text-foreground">Could not load description operations.</p>
            <p className="text-al-meta text-muted-foreground mt-1">{error || exceptionError}</p>
            <button
              type="button"
              onClick={() => { void reload(); void reloadExceptions(); }}
              className="mt-3 min-h-[44px] px-4 rounded-lg border border-border text-al-meta font-semibold"
            >
              Try again
            </button>
          </div>
        ) : rows === null ? (
          <div className="divide-y divide-border">
            {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-[68px] animate-pulse bg-muted/30" />)}
          </div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center">
            <CheckCircle2 className="w-9 h-9 text-emerald-600 mx-auto mb-2" />
            <p className="text-al-card text-foreground">
              {(allRows || []).length === 0 ? "No active vehicles in this dealership." : "No vehicles match these filters."}
            </p>
            <p className="text-al-meta text-muted-foreground mt-1">
              {(allRows || []).length === 0
                ? "Vehicles appear here as soon as inventory syncs; descriptions start automatically at ingest."
                : "Clear a filter to widen the view."}
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[1100px]">
                <thead>
                  <tr className="text-al-meta font-semibold uppercase tracking-wide text-muted-foreground border-b border-border">
                    <th className="px-2 py-2.5"><span className="sr-only">Expand diagnostics</span></th>
                    <SortHead k="vehicle">Vehicle</SortHead>
                    <SortHead k="state">Description state</SortHead>
                    <SortHead k="confidence">Fact confidence</SortHead>
                    <th className="px-3 py-2.5">Primary issue</th>
                    <th className="px-3 py-2.5">Publication state</th>
                    <th className="px-3 py-2.5">Channels</th>
                    <SortHead k="updated">Updated</SortHead>
                    <th className="px-3 py-2.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {paged.map((r) => {
                    const conf = confidenceBand(r.caseRow?.fact_confidence as number | null | undefined);
                    const state = STATE_META[r.state];
                    const stock = vehicleStockNumber(r.vehicle);
                    const isOpen = expanded === r.vehicleId;
                    const published = r.caseRow?.status === "PUBLISHED" || r.caseRow?.status === "PARTIALLY_PUBLISHED";
                    return (
                      <Fragment key={r.vehicleId}>
                        <tr className="hover:bg-primary/[0.025] transition-colors duration-hover ease-standard motion-reduce:transition-none">
                          <td className="px-2 py-3 align-top">
                            <button
                              type="button"
                              aria-expanded={isOpen}
                              aria-label={`${isOpen ? "Hide" : "Show"} diagnostics for ${r.vehicle.ymm || r.vehicle.vin || "vehicle"}`}
                              onClick={() => setExpanded(isOpen ? null : r.vehicleId)}
                              className="w-9 h-9 grid place-items-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60"
                            >
                              {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                            </button>
                          </td>
                          <td className="px-3 py-3">
                            <div className="flex items-center gap-2.5 min-w-0">
                              {r.vehicle.hero_image_url ? (
                                <img
                                  src={r.vehicle.hero_image_url} alt="" loading="lazy"
                                  className="w-14 h-10 rounded-lg object-cover border border-border shrink-0"
                                />
                              ) : (
                                <span className="w-14 h-10 rounded-lg border border-border bg-muted grid place-items-center shrink-0">
                                  <Car className="w-4 h-4 text-muted-foreground" />
                                </span>
                              )}
                              <span className="min-w-0">
                                <span className="block text-al-body font-semibold text-foreground truncate">{r.vehicle.ymm || "Vehicle"}</span>
                                <span className="block text-al-meta text-muted-foreground truncate">
                                  {[r.vehicle.trim, stock ? `Stock ${stock}` : "No stock number"].filter(Boolean).join(" - ")}
                                </span>
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-3">
                            <span className={`inline-flex text-al-meta font-bold uppercase tracking-wide px-2 py-0.5 rounded-full whitespace-nowrap ${state.className}`}>
                              {state.label}
                            </span>
                          </td>
                          <td className="px-3 py-3">
                            <span className={`block text-al-body font-semibold ${conf.className}`}>{conf.word}</span>
                            <span className="block text-al-meta text-muted-foreground tabular-nums">
                              {r.caseRow?.fact_confidence != null ? `${r.caseRow.fact_confidence}% of claims sourced` : "Not evaluated"}
                            </span>
                          </td>
                          <td className="px-3 py-3">
                            <span className="block text-al-body text-foreground">{r.issue || "None"}</span>
                            {r.exceptions.length > 1 && (
                              <span className="block text-al-meta text-muted-foreground">
                                +{r.exceptions.length - 1} more open on this vehicle
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-3">
                            {published ? (
                              <>
                                <span className="block text-al-body font-semibold text-emerald-700">
                                  {r.caseRow?.status === "PARTIALLY_PUBLISHED" ? "Partly Published" : "Published"}
                                </span>
                                <span className="block text-al-meta text-muted-foreground">
                                  {r.caseRow?.last_success_at ? new Date(r.caseRow.last_success_at as string).toLocaleDateString() : ""}
                                </span>
                              </>
                            ) : (
                              <span className="text-al-body text-muted-foreground">Not Published</span>
                            )}
                          </td>
                          <td className="px-3 py-3">
                            {configuredChannels.length === 0 ? (
                              <>
                                <span className="block text-al-body text-muted-foreground">—</span>
                                <span className="block text-al-meta text-muted-foreground">No channels enabled</span>
                              </>
                            ) : (
                              <>
                                <span className={`block text-al-body font-semibold tabular-nums ${
                                  r.channelsPresent.length === configuredChannels.length ? "text-emerald-700"
                                    : r.channelsPresent.length === 0 ? "text-muted-foreground" : "text-amber-700"}`}>
                                  {r.channelsPresent.length}/{configuredChannels.length}
                                </span>
                                <span className="block text-al-meta text-muted-foreground">variants live</span>
                              </>
                            )}
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap">
                            <span className="block text-al-meta text-foreground">
                              {r.updatedAt ? new Date(r.updatedAt).toLocaleDateString() : "—"}
                            </span>
                            <span className="block text-al-meta text-muted-foreground">
                              {r.updatedAt ? new Date(r.updatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : ""}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-right">
                            <span className="inline-flex items-center gap-1 justify-end">
                              <button
                                type="button"
                                onClick={() => navigate(`/description-intelligence/${r.vehicleId}`)}
                                className="min-h-[44px] px-3 rounded-lg border border-border bg-card text-al-meta font-bold tracking-wide text-foreground hover:border-primary"
                              >
                                {ACTION_LABEL[r.state]}
                              </button>
                              <button
                                type="button"
                                aria-label={`More actions for ${r.vehicle.ymm || r.vehicle.vin || "vehicle"}`}
                                aria-haspopup="menu" aria-expanded={menu?.id === r.vehicleId}
                                onClick={(e) => {
                                  const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                  // Flip above the trigger when the menu would run
                                  // off the bottom of the viewport.
                                  const MENU_H = 156;
                                  const below = window.innerHeight - box.bottom > MENU_H + 12;
                                  setMenu(menu?.id === r.vehicleId ? null : {
                                    id: r.vehicleId, x: box.right,
                                    y: below ? box.bottom + 4 : Math.max(8, box.top - MENU_H - 4),
                                    vehicleId: r.vehicleId, vin: r.vehicle.vin || "",
                                  });
                                }}
                                className="w-11 h-11 grid place-items-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60"
                              >
                                <MoreVertical className="w-4 h-4" />
                              </button>
                            </span>
                          </td>
                        </tr>
                        {isOpen && (
                          <tr>
                            <td colSpan={9} className="px-3 pb-4 bg-muted/20">
                              <VehicleDiagnosticPanel
                                vin={r.vehicle.vin || ""}
                                caseStatus={(r.caseRow?.status as string | undefined) ?? null}
                                eligibility={(r.caseRow?.publication_eligibility as string | undefined) ?? null}
                                factConfidence={(r.caseRow?.fact_confidence as number | null | undefined) ?? null}
                                currentSourceVersion={(r.caseRow?.current_source_data_version as string | undefined) ?? null}
                                processedSourceVersion={(r.caseRow?.processed_source_data_version as string | undefined) ?? null}
                                lastRunAt={(r.caseRow?.last_orchestrated_at as string | undefined) ?? null}
                                presentChannels={r.channelsPresent}
                                configuredChannels={configuredChannels}
                                exceptions={r.exceptions}
                                onOpenRecord={() => navigate(`/description-intelligence/${r.vehicleId}`)}
                                onOpenStudio={() => navigate(`/description-studio?vehicle=${r.vehicleId}`)}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-border flex-wrap">
              <p className="text-al-meta text-muted-foreground">
                {page * pageSize + 1}–{Math.min(total, (page + 1) * pageSize)} of {total} vehicles - active inventory
                {lastRun ? ` - last automated run ${lastRun.toLocaleString()}` : ""}
              </p>
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-1">
                  <button
                    type="button" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}
                    aria-label="Previous page"
                    className="w-11 h-11 grid place-items-center rounded-lg border border-border disabled:opacity-40"
                  >
                    <ChevronRight className="w-4 h-4 rotate-180" />
                  </button>
                  {pageNumbers.map((n, i) => n === "..." ? (
                    <span key={`gap-${i}`} className="px-1 text-al-meta text-muted-foreground">...</span>
                  ) : (
                    <button
                      key={n} type="button" onClick={() => setPage(n)}
                      aria-current={n === page ? "page" : undefined}
                      className={`min-w-[44px] h-11 px-2 rounded-lg text-al-meta font-semibold ${
                        n === page ? "bg-primary text-primary-foreground" : "border border-border text-foreground"}`}
                    >
                      {n + 1}
                    </button>
                  ))}
                  <button
                    type="button" onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} disabled={page >= pageCount - 1}
                    aria-label="Next page"
                    className="w-11 h-11 grid place-items-center rounded-lg border border-border disabled:opacity-40"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
                <label className="inline-flex items-center gap-1.5 text-al-meta text-muted-foreground">
                  Rows per page
                  <select
                    value={pageSize}
                    onChange={(e) => { setPageSize(Number(e.target.value)); setPage(0); }}
                    className="h-11 px-2 rounded-lg border border-border bg-card text-al-meta font-medium"
                  >
                    {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
              </div>
            </div>
          </>
        )}
      </div>

      {menu && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setMenu(null)} aria-hidden />
          <div role="menu" style={{ top: menu.y, left: Math.max(8, menu.x - 208) }}
            className="fixed z-40 w-52 rounded-xl border border-border bg-card shadow-lg p-1">
            {([
              ["Open description record", () => navigate(`/description-intelligence/${menu.vehicleId}`)],
              ["Open studio", () => navigate(`/description-studio?vehicle=${menu.vehicleId}`)],
              ["Open vehicle file", () => navigate(`/vehicle-file/${menu.vehicleId}`)],
              ["Copy VIN", () => {
                if (!menu.vin) { toast.error("This vehicle has no VIN on file"); return; }
                navigator.clipboard.writeText(menu.vin)
                  .then(() => toast.success("VIN copied"), () => toast.error("Clipboard unavailable"));
              }],
            ] as [string, () => void][]).map(([label, fn]) => (
              <button
                key={label} type="button" role="menuitem"
                onClick={() => { fn(); setMenu(null); }}
                className="w-full text-left min-h-[44px] px-3 rounded-lg text-al-body font-medium text-foreground hover:bg-muted/60"
              >
                {label}
              </button>
            ))}
          </div>
        </>
      )}

      <p className="text-al-meta text-muted-foreground mt-3 inline-flex items-center gap-1.5">
        <Clock className="w-3.5 h-3.5" />
        Descriptions generate automatically at ingest. Every count above is vehicles, not validation events.
      </p>
    </div>
  );
}
