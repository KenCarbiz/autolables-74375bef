import { shortVehicle } from "@/lib/shortVehicle";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  CheckCircle2, ChevronDown, ChevronRight, ChevronUp, Loader2, RefreshCw, Search, X, XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { vehicleStockNumber } from "@/lib/vehicleStockNumber";
import { useOperatingMetrics } from "@/hooks/useOperatingMetrics";
import {
  useDescriptionOperations, useDescriptionPermissions, type DescriptionCaseRow,
} from "@/hooks/useDescriptionOps";
import { PageBody, PageHeader, MetricStrip, Button, InlineNote, StatusText, FilterSelect, type Tone } from "@/components/product";
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

const STATE_META: Record<OpsState, { label: string; tone: Tone }> = {
  published:       { label: "Published",       tone: "success" },
  ready:           { label: "Ready",           tone: "success" },
  needs_review:    { label: "Needs review",    tone: "warning" },
  waiting_on_data: { label: "Waiting on data", tone: "warning" },
  failed:          { label: "Failed",          tone: "danger" },
  in_progress:     { label: "In progress",     tone: "neutral" },
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

const SHORT_STATE: Record<OpsState, string> = {
  published: "Published", ready: "Ready", needs_review: "Review", waiting_on_data: "Waiting", failed: "Failed", in_progress: "In progress",
};

const sourceStatus = (caseRow: DescriptionCaseRow | null): string => {
  if (!caseRow) return "Not started";
  const cur = caseRow.current_source_data_version as string | null | undefined;
  const done = caseRow.processed_source_data_version as string | null | undefined;
  if (caseRow.potentially_stale || (cur && done && cur !== done)) return "Changed";
  if (!done) return "Not processed";
  return "Current";
};

const shortDateTime = (v: unknown) =>
  v ? new Date(v as string).toLocaleString(undefined, { month: "numeric", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : "None";

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
  const [syncing, setSyncing] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [drawerTab, setDrawerTab] = useState<"overview" | "source">("overview");
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get("vehicle");
  const select = (id: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (id) next.set("vehicle", id); else next.delete("vehicle");
    setSearchParams(next, { replace: true });
  };

  const runReconcile = async () => {
    // Reconciliation can start description generation, which can incur cost.
    // The buttons say "Review", so nothing runs until the person confirms.
    if (typeof window !== "undefined" && !window.confirm("Reconciliation checks up to 25 vehicles and may start description generation, which can incur cost. Continue?")) return;
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
    <th className="px-2 py-1">
      <button type="button" onClick={() => toggleSort(k)} className="inline-flex items-center gap-1 min-h-[36px] hover:text-foreground">
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
      <PageBody>
        <PageHeader title="Description Operations" description="Which vehicles have a description, and which ones need a person." />
        <InlineNote tone="info" title="Select a dealership">
          Description coverage is shown for one dealership at a time.
        </InlineNote>
      </PageBody>
    );
  }

  const loadingRows = allRows === null;
  const metricList = [
    { label: "Total vehicles", value: metricsLoading || metricsError ? null : metrics.activeInventory, hint: "Active inventory", loading: metricsLoading },
    { label: "Published", value: loadingRows ? null : kpis.published, hint: "Description live", tone: "success" as Tone, loading: loadingRows },
    { label: "Needs review", value: loadingRows ? null : kpis.needs_review, hint: "A person must check", tone: "warning" as Tone, loading: loadingRows },
    { label: "Failed generation", value: loadingRows ? null : kpis.failed, hint: "Blocked or retryable", tone: "danger" as Tone, loading: loadingRows },
  ];

  const selectedRow = (allRows || []).find((r) => r.vehicleId === selectedId) ?? null;


  const retryEligible = selectedRow ? selectedRow.state === "failed" || selectedRow.state === "needs_review" || selectedRow.state === "waiting_on_data" : false;

  const drawer = selectedRow ? (
    <>
    <aside aria-label="Description record" className="flex w-full shrink-0 flex-col self-start rounded-[6px] border border-adm-border bg-adm-surface lg:w-[340px] lg:sticky lg:top-4">
      <div className="flex items-start justify-between gap-3 px-4 pt-4">
        <div className="min-w-0">
          <p className="text-[17px] leading-[24px] font-semibold text-adm-ink truncate">{vehicleStockNumber(selectedRow.vehicle) || "No stock number"}</p>
          <p className="text-[13px] leading-[18px] text-adm-muted truncate">{selectedRow.vehicle.ymm || "Vehicle"}</p>
        </div>
        <button type="button" onClick={() => select(null)} aria-label="Close record" className="w-9 h-9 grid place-items-center rounded-md text-adm-muted hover:bg-adm-workspace">
          <X className="w-5 h-5" />
        </button>
      </div>
      <div role="tablist" aria-label="Record sections" className="mt-3 flex gap-6 border-b border-adm-border px-4">
        {([["overview", "Overview"], ["source", "Source details"]] as const).map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={drawerTab === key} onClick={() => setDrawerTab(key)}
            className={`-mb-px min-h-[40px] border-b-2 text-[14px] ${drawerTab === key ? "border-adm-primary font-semibold text-adm-primary" : "border-transparent font-medium text-adm-muted hover:text-adm-ink"}`}>
            {label}
          </button>
        ))}
      </div>
      <div className="space-y-4 px-4 py-4 text-[14px] leading-[20px]">
        {drawerTab === "overview" ? (
          <>
        <dl className="space-y-1.5">
          {[
            ["Stock #", vehicleStockNumber(selectedRow.vehicle) || "Unknown"],
            ["VIN", selectedRow.vehicle.vin || "Unknown"],
            ["Condition", selectedRow.vehicle.condition ? String(selectedRow.vehicle.condition).replace(/^./, (c) => c.toUpperCase()) : "Unknown"],
            ["Status", <StatusText key="s" tone={STATE_META[selectedRow.state].tone}>{STATE_META[selectedRow.state].label}</StatusText>],
            ["Fact confidence", selectedRow.caseRow?.fact_confidence != null ? `${selectedRow.caseRow.fact_confidence}% sourced` : "Not evaluated"],
          ].map(([k, v]) => (
            <div key={String(k)} className="flex items-baseline justify-between gap-3">
              <dt className="text-adm-muted">{k}</dt>
              <dd className="text-adm-ink text-right min-w-0 truncate">{v}</dd>
            </div>
          ))}
        </dl>
        <div>
          <p className="font-semibold text-adm-ink mb-1.5">Source gaps</p>
          {selectedRow.exceptions.length === 0 ? (
            <p className="text-adm-muted">{selectedRow.issue || "No open source gaps."}</p>
          ) : (
            <ul className="space-y-1">
              {selectedRow.exceptions.slice(0, 6).map((e) => (
                <li key={e.id} className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-adm-ink">{issueLabel(e.exception_type)}</span>
                  <StatusText tone={e.blocking ? "danger" : "warning"}>{e.blocking ? "Blocking" : "Open"}</StatusText>
                </li>
              ))}
              {selectedRow.exceptions.length > 6 && <li className="text-adm-muted">+{selectedRow.exceptions.length - 6} more</li>}
            </ul>
          )}
        </div>
        <div>
          <p className="font-semibold text-adm-ink mb-1.5">Latest attempt</p>
          <p className="text-adm-ink">
            {selectedRow.caseRow?.last_orchestrated_at ? new Date(selectedRow.caseRow.last_orchestrated_at as string).toLocaleString() : "No attempt recorded"}
          </p>
          {selectedRow.caseRow?.status && <p className="text-adm-muted">{String(selectedRow.caseRow.status).replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase())}</p>}
          {selectedRow.state === "failed" && (
            <p className="text-adm-muted">{(selectedRow.caseRow?.last_error_message as string | null | undefined) || "No failure detail recorded"}</p>
          )}
        </div>
        <div>
          <p className="font-semibold text-adm-ink mb-1.5">Retry eligibility</p>
          <p className="text-adm-muted">
            {retryEligible
              ? "A retry can regenerate this description and may incur cost. Review the record before it runs."
              : "No retry needed for this vehicle."}
          </p>
        </div>
          </>
        ) : (
          <div className="overflow-x-auto">
            <VehicleDiagnosticPanel
              vin={selectedRow.vehicle.vin || ""}
              caseStatus={(selectedRow.caseRow?.status as string | undefined) ?? null}
              eligibility={(selectedRow.caseRow?.publication_eligibility as string | undefined) ?? null}
              factConfidence={(selectedRow.caseRow?.fact_confidence as number | null | undefined) ?? null}
              currentSourceVersion={(selectedRow.caseRow?.current_source_data_version as string | undefined) ?? null}
              processedSourceVersion={(selectedRow.caseRow?.processed_source_data_version as string | undefined) ?? null}
              lastRunAt={(selectedRow.caseRow?.last_orchestrated_at as string | undefined) ?? null}
              presentChannels={selectedRow.channelsPresent}
              configuredChannels={configuredChannels}
              exceptions={selectedRow.exceptions}
              onOpenRecord={() => navigate(`/description-intelligence/${selectedRow.vehicleId}`)}
              onOpenStudio={() => navigate(`/description-studio?vehicle=${selectedRow.vehicleId}`)}
            />
          </div>
        )}
      </div>
      <div className="flex flex-col gap-2 border-t border-adm-border px-4 py-3">
        <Button variant="primary" onClick={() => navigate(`/description-intelligence/${selectedRow.vehicleId}`)}>{retryEligible ? "Review retry" : "Review description record"}</Button>
        <div className="flex gap-2">
          <Button className="flex-1" onClick={() => navigate(`/description-studio?vehicle=${selectedRow.vehicleId}`)}>Open studio</Button>
          <Button className="flex-1" onClick={() => navigate(`/vehicle-file/${selectedRow.vehicleId}`)}>Vehicle file</Button>
        </div>
      </div>
    </aside>
    </>
  ) : null;

  return (
    <PageBody width="wide">
      <PageHeader
        title="Description Operations"
        description="Generate and manage vehicle descriptions from multiple sources."
        actions={
          <>
            <Button onClick={() => applyStateFilter("needs_review")}>
              Review vehicles{kpis.needs_review > 0 ? ` (${kpis.needs_review})` : ""}
            </Button>
          </>
        }
      />

      <MetricStrip numberFirst noBars label="Description coverage" metrics={metricList} />

      {metricsError && (
        <InlineNote tone="warning" title="Inventory counts unavailable">{metricsError}</InlineNote>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[220px] max-w-[280px]">
          <Search className="w-4 h-4 text-muted-foreground absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(0); }}
            placeholder="Search stock #, VIN, vehicle"
            aria-label="Search vehicles"
            className="w-full h-9 pl-10 pr-3 rounded-[6px] border border-adm-border bg-adm-surface text-[14px] focus:outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <FilterSelect label="Filter by description state" value={stateFilter} onChange={(v) => { setStateFilter(v as "all" | OpsState); setPage(0); }}
          options={[{ value: "all", label: "All description states" }, ...(Object.keys(STATE_META) as OpsState[]).map((k) => ({ value: k, label: STATE_META[k].label }))]} />
        <FilterSelect label="Filter by condition" value={conditionFilter} onChange={(v) => { setConditionFilter(v); setPage(0); }}
          options={[{ value: "all", label: "New and used" }, { value: "new", label: "New" }, { value: "used", label: "Used" }, { value: "cpo", label: "CPO" }]} />
        <FilterSelect label="Filter by channel coverage" value={channelFilter} onChange={(v) => { setChannelFilter(v); setPage(0); }}
          options={[{ value: "all", label: "Any channel coverage" }, { value: "complete", label: "Every channel covered" }, { value: "partial", label: "Some channels covered" }, { value: "none", label: "No channel copy" }]} />
        <button
          type="button"
          onClick={() => { setStateFilter("all"); setConditionFilter("all"); setChannelFilter("all"); setQuery(""); setPage(0); }}
          className="h-9 px-2 text-[14px] font-semibold text-adm-primary hover:underline"
        >
          Clear filters
        </button>
      </div>

      <div className="flex flex-col items-start gap-4 lg:flex-row">
      <div className="min-w-0 w-full flex-1 rounded-[6px] border border-adm-border bg-adm-surface overflow-hidden">
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
            <table className="w-full table-fixed text-left border-collapse">
              <colgroup>
                <col className="w-[36px]" /><col className="w-[12%]" /><col className="w-[30%]" /><col className="w-[14%]" /><col className="w-[17%]" /><col className="w-[14%]" /><col className="w-[13%]" />
              </colgroup>
              <thead>
                <tr className="text-[12px] leading-[18px] font-semibold text-adm-muted bg-adm-workspace border-b border-adm-border">
                  <th className="pl-3 py-2.5"><input type="checkbox" aria-label="Select all vehicles on this page" className="h-4 w-4 rounded-[3px] border-adm-border" checked={paged.length > 0 && paged.every((r) => checked.has(r.vehicleId))} onChange={(e) => setChecked(e.target.checked ? new Set(paged.map((r) => r.vehicleId)) : new Set())} /></th>
                  <th className="px-2 py-2.5">Stock #</th>
                  <SortHead k="vehicle">Vehicle</SortHead>
                  <th className="px-2 py-2.5">Source status</th>
                  <SortHead k="updated">Latest attempt</SortHead>
                  <th className="px-2 py-2.5">Next retry</th>
                  <SortHead k="state">Status</SortHead>
                </tr>
              </thead>
              <tbody className="divide-y divide-adm-border">
                {paged.map((r) => {
                  const state = STATE_META[r.state];
                  const stock = vehicleStockNumber(r.vehicle);
                  const active = selectedId === r.vehicleId;
                  return (
                    <tr
                      key={r.vehicleId}
                      onClick={() => select(active ? null : r.vehicleId)}
                      aria-selected={active}
                      className={`h-11 cursor-pointer transition-colors ${active ? "bg-adm-selected" : "hover:bg-adm-workspace"}`}
                    >
                      <td className="pl-3" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" aria-label={`Select ${r.vehicle.ymm || "vehicle"}`} className="h-4 w-4 rounded-[3px] border-adm-border" checked={checked.has(r.vehicleId)}
                          onChange={(e) => setChecked((cur) => { const n = new Set(cur); if (e.target.checked) n.add(r.vehicleId); else n.delete(r.vehicleId); return n; })} />
                      </td>
                      <td className="px-2 text-[13px] text-adm-muted truncate">{stock || "Unknown"}</td>
                      <td className="px-2 text-[14px] text-adm-ink truncate">
                        <button type="button" onClick={(e) => { e.stopPropagation(); select(active ? null : r.vehicleId); }} title={r.vehicle.ymm || "Vehicle"} className="text-left max-w-full truncate hover:underline focus-visible:underline">
                          {shortVehicle(r.vehicle.ymm || "Vehicle")}
                        </button>
                      </td>
                      <td className="px-2 text-[13px] text-adm-ink truncate">{sourceStatus(r.caseRow)}</td>
                      <td className="px-2 text-[13px] text-adm-muted truncate">{shortDateTime(r.caseRow?.last_orchestrated_at)}</td>
                      <td className="px-2 text-[13px] text-adm-muted truncate">{r.state === "failed" ? "Manual review" : "None"}</td>
                      <td className="px-2"><StatusText tone={state.tone}>{SHORT_STATE[r.state]}</StatusText></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-adm-border flex-wrap">
              <p className="text-al-meta text-muted-foreground">
                {page * pageSize + 1}–{Math.min(total, (page + 1) * pageSize)} of {total} vehicles - active inventory
                {lastRun ? ` - last automated run ${lastRun.toLocaleString()}` : ""}
              </p>
              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-1">
                  <button
                    type="button" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}
                    aria-label="Previous page"
                    className="w-9 h-9 grid place-items-center rounded-[6px] border border-adm-border disabled:opacity-40"
                  >
                    <ChevronRight className="w-4 h-4 rotate-180" />
                  </button>
                  {pageNumbers.map((n, i) => n === "..." ? (
                    <span key={`gap-${i}`} className="px-1 text-al-meta text-muted-foreground">...</span>
                  ) : (
                    <button
                      key={n} type="button" onClick={() => setPage(n)}
                      aria-current={n === page ? "page" : undefined}
                      className={`min-w-[36px] h-9 px-2 rounded-[6px] text-al-meta font-semibold ${
                        n === page ? "bg-adm-primary text-white" : "border border-adm-border text-foreground"}`}
                    >
                      {n + 1}
                    </button>
                  ))}
                  <button
                    type="button" onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} disabled={page >= pageCount - 1}
                    aria-label="Next page"
                    className="w-9 h-9 grid place-items-center rounded-[6px] border border-adm-border disabled:opacity-40"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
                <label className="inline-flex items-center gap-1.5 text-al-meta text-muted-foreground">
                  Rows per page
                  <FilterSelect label="Rows per page" className="min-w-[72px]" value={String(pageSize)} onChange={(v) => { setPageSize(Number(v)); setPage(0); }}
                    options={PAGE_SIZES.map((n) => ({ value: String(n), label: String(n) }))} />
                </label>
              </div>
            </div>
          </>
        )}
      </div>
      {drawer}
      </div>


      <p className="text-[12px] leading-[18px] text-adm-muted">
        Descriptions generate automatically at ingest. Counts are vehicles, not validation events.
        {summary && summary.missing > 0 ? ` ${summary.missing} active vehicle${summary.missing === 1 ? "" : "s"} never started a description.` : ""}
        {perms.canGenerate && (<> <button type="button" onClick={runReconcile} disabled={syncing} className="font-semibold text-adm-primary hover:underline disabled:opacity-50">{syncing ? "Reconciling" : "Review reconciliation"}</button></>)}
        {perms.canConfigure && (<> <button type="button" onClick={() => navigate("/admin?tab=merchandising-seo")} className="font-semibold text-adm-primary hover:underline">Automation settings</button></>)}
      </p>
    </PageBody>
  );
}
