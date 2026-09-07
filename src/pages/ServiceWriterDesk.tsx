import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { useOperatingMetrics } from "@/hooks/useOperatingMetrics";
import { compareServicePriority, deriveServicePriority, type ServicePriority } from "@/lib/service/priority";
import { clearanceReasonLabel } from "@/lib/service/workspaceStatus";
import {
  BTN_SECONDARY, EM_DASH, EmptyState, ErrorCard, LoadingCard, StatusPill,
  formatCommandDate, type Tone,
} from "@/components/command/CommandPrimitives";
import { ChevronDown, ChevronRight, ClipboardList, Headset } from "lucide-react";
import { cn } from "@/lib/utils";

// The service writer's desk: one row per vehicle in the service pipeline, and
// exactly six columns. The column set is deliberately short so NEXT ACTION is
// readable without a horizontal scroll — every secondary fact lives in the row
// detail or in the Service Vehicle Workspace, never in a seventh column.
//
// K-208 is a filter and a state label here. Certification authority comes from
// the store's K-208 policy and is enforced server-side; nothing on this desk
// executes or grants a certification.

// deno-lint-ignore no-explicit-any
const sb = () => supabase as any;

type StatusKey = "WAITING" | "IN_PROGRESS" | "AUTHORIZED" | "NEEDS_REVIEW" | "COMPLETED";

const STATE_LABEL: Record<string, string> = {
  AUTHORIZED_FOR_GET_READY: "Authorized for get ready",
  SERVICE_UNASSIGNED: "Service unassigned",
  K208_IN_PROGRESS: "Inspection in progress",
  SERVICE_FINDINGS_RECORDED: "Service findings recorded",
  WAITING_FOR_MANAGER_DECISION: "Waiting for manager decision",
  RETURNED_FOR_CLARIFICATION: "Returned for clarification",
  WORK_AUTHORIZED: "Work authorized",
  REPAIR_IN_PROGRESS: "Repair in progress",
  REPAIR_VERIFICATION_REQUIRED: "Ready for reinspection",
  K208_READY_TO_CERTIFY: "Awaiting K-208 certification",
  K208_FINALIZED: "K-208 finalized",
  DETAIL_PENDING: "Detail pending",
  DETAIL_IN_PROGRESS: "Detail in progress",
  FINAL_READY_VERIFICATION: "Final ready verification",
};

const STATE_STATUS: Record<string, StatusKey> = {
  AUTHORIZED_FOR_GET_READY: "AUTHORIZED",
  SERVICE_UNASSIGNED: "WAITING",
  K208_IN_PROGRESS: "IN_PROGRESS",
  SERVICE_FINDINGS_RECORDED: "NEEDS_REVIEW",
  WAITING_FOR_MANAGER_DECISION: "WAITING",
  RETURNED_FOR_CLARIFICATION: "NEEDS_REVIEW",
  WORK_AUTHORIZED: "AUTHORIZED",
  REPAIR_IN_PROGRESS: "IN_PROGRESS",
  REPAIR_VERIFICATION_REQUIRED: "WAITING",
  K208_READY_TO_CERTIFY: "WAITING",
  K208_FINALIZED: "COMPLETED",
  DETAIL_PENDING: "WAITING",
  DETAIL_IN_PROGRESS: "IN_PROGRESS",
  FINAL_READY_VERIFICATION: "NEEDS_REVIEW",
};

const STATUS_TONE: Record<StatusKey, Tone> = {
  WAITING: "slate",
  IN_PROGRESS: "blue",
  AUTHORIZED: "blue",
  NEEDS_REVIEW: "amber",
  COMPLETED: "emerald",
};

const NEXT_ACTION: Record<string, string> = {
  AUTHORIZED_FOR_GET_READY: "Start inspection",
  SERVICE_UNASSIGNED: "Assign technician",
  K208_IN_PROGRESS: "Continue inspection",
  SERVICE_FINDINGS_RECORDED: "Review findings",
  WAITING_FOR_MANAGER_DECISION: "Chase the decision",
  RETURNED_FOR_CLARIFICATION: "Answer the manager",
  WORK_AUTHORIZED: "Start authorized work",
  REPAIR_IN_PROGRESS: "Continue repairs",
  REPAIR_VERIFICATION_REQUIRED: "Run reinspection",
  K208_READY_TO_CERTIFY: "Open file",
  K208_FINALIZED: "Open file",
  DETAIL_PENDING: "Hand to detail",
  DETAIL_IN_PROGRESS: "Open file",
  FINAL_READY_VERIFICATION: "Verify ready",
};

const DESK_STATES = new Set(Object.keys(STATE_LABEL));

type TabKey =
  | "all" | "unassigned" | "inspection" | "waiting" | "authorized"
  | "in_repair" | "reinspect" | "k208" | "completed";

const TAB_STATES: Record<Exclude<TabKey, "all">, string[]> = {
  unassigned: ["SERVICE_UNASSIGNED"],
  inspection: ["AUTHORIZED_FOR_GET_READY", "K208_IN_PROGRESS"],
  waiting: ["WAITING_FOR_MANAGER_DECISION", "SERVICE_FINDINGS_RECORDED", "RETURNED_FOR_CLARIFICATION"],
  authorized: ["WORK_AUTHORIZED"],
  in_repair: ["REPAIR_IN_PROGRESS"],
  reinspect: ["REPAIR_VERIFICATION_REQUIRED"],
  k208: ["K208_READY_TO_CERTIFY", "K208_FINALIZED"],
  completed: ["DETAIL_PENDING", "DETAIL_IN_PROGRESS", "FINAL_READY_VERIFICATION", "K208_FINALIZED"],
};

const TABS: { key: TabKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "unassigned", label: "Unassigned" },
  { key: "inspection", label: "Inspection" },
  { key: "waiting", label: "Waiting" },
  { key: "authorized", label: "Authorized" },
  { key: "in_repair", label: "In repair" },
  { key: "reinspect", label: "Reinspect" },
  { key: "k208", label: "K-208" },
  { key: "completed", label: "Completed" },
];

const TAB_EMPTY: Record<TabKey, { title: string; detail: string }> = {
  all: {
    title: "No vehicles are in the service pipeline.",
    detail: "Vehicles appear here from the stored vehicle lifecycle once a manager authorizes them for get ready.",
  },
  unassigned: {
    title: "No vehicles are waiting for a technician.",
    detail: "Every authorized vehicle in the pipeline has a name on it.",
  },
  inspection: {
    title: "No inspections are open.",
    detail: "Vehicles show here from the moment a technician is assigned until the inspection is submitted.",
  },
  waiting: {
    title: "Nothing is waiting on a manager.",
    detail: "Recorded findings, pending estimates and anything a manager sent back for clarification land here.",
  },
  authorized: {
    title: "No approved work is waiting to start.",
    detail: "A vehicle arrives here when a manager approves the estimate and the repair has not begun.",
  },
  in_repair: {
    title: "No repairs are open on the floor.",
    detail: "Authorized work moves here once a technician starts it.",
  },
  reinspect: {
    title: "Nothing is waiting for reinspection.",
    detail: "A vehicle arrives here after every failed item on it has been repaired.",
  },
  k208: {
    title: "No vehicles are at the K-208 stage.",
    detail: "Shown for visibility only. Certification is executed by the store's licensed signer, never from this desk.",
  },
  completed: {
    title: "No vehicles have finished service.",
    detail: "A vehicle lands here when its inspection is certified and the work moves on to detail and final verification.",
  },
};

const PRIORITY_TONE: Record<ServicePriority["level"], Tone> = {
  High: "red",
  Medium: "amber",
  Low: "slate",
};

const durationLabel = (hours: number): string => {
  if (hours < 24) return `${Math.max(0, Math.round(hours))}h`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"}`;
};

const isToday = (iso?: string | null): boolean => {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
};

interface DeskRow {
  vehicleId: string;
  vin: string;
  ymm: string;
  stockNumber: string | null;
  state: string;
  ageHours: number;
  overdue: boolean;
  assignedName: string | null;
  deliveryTarget: string | null;
  blocked: boolean;
  clearanceReasons: string[];
  openRequest: string | null;
  priority: ServicePriority;
}

export default function ServiceWriterDesk() {
  const { tenant } = useTenant();
  const { settings } = useDealerSettings();
  const tenantId = tenant?.id && tenant.id !== "house" ? tenant.id : null;
  const { metrics, loading: metricsLoading, error: metricsError, reload: reloadMetrics } = useOperatingMetrics(tenantId);

  const [rows, setRows] = useState<DeskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const overdueHours = settings.service_overdue_hours || 24;

  const load = useCallback(async () => {
    if (!tenantId) { setLoading(false); return; }
    setLoading(true); setLoadError(null);
    try {
      const { data: lc, error: lcErr } = await sb().from("vehicle_lifecycle")
        .select("vehicle_id, vin, state, state_changed_at")
        .eq("tenant_id", tenantId)
        .order("state_changed_at", { ascending: true })
        .limit(500);
      if (lcErr) throw new Error(lcErr.message);

      const lcRows = (((lc as Record<string, unknown>[]) || [])
        .map((r) => ({
          vehicleId: String(r.vehicle_id || ""),
          vin: String(r.vin || "").toUpperCase(),
          state: String(r.state || ""),
          stateChangedAt: (r.state_changed_at as string) ?? null,
        }))
        .filter((r) => DESK_STATES.has(r.state)));

      const vins = Array.from(new Set(lcRows.map((r) => r.vin).filter(Boolean)));
      const ids = lcRows.map((r) => r.vehicleId).filter(Boolean);
      const none = Promise.resolve({ data: [] });

      const [vRes, siRes, grRes, clrRes, reqRes, memRes] = await Promise.all([
        ids.length
          ? sb().from("vehicle_listings")
            .select("id, ymm, status, deal_processed_at")
            .eq("tenant_id", tenantId).in("id", ids)
          : none,
        vins.length
          ? sb().from("safety_inspections")
            .select("vin, status, assigned_to, stock_number, created_at")
            .eq("tenant_id", tenantId).in("vin", vins)
            .order("created_at", { ascending: false })
          : none,
        vins.length
          ? sb().from("get_ready_records")
            .select("vin, delivery_target, stock_number, created_at")
            .eq("tenant_id", tenantId).in("vin", vins)
            .order("created_at", { ascending: false })
          : none,
        vins.length
          ? sb().from("vehicle_delivery_clearance")
            .select("vin, state, reason_codes")
            .eq("tenant_id", tenantId).in("vin", vins)
          : none,
        vins.length
          ? sb().from("service_requests")
            .select("vin, status, work_requested, updated_at")
            .eq("tenant_id", tenantId).in("vin", vins)
            .in("status", ["pending", "clarify"])
            .order("updated_at", { ascending: false })
          : none,
        sb().rpc("list_tenant_members", { p_tenant_id: tenantId }),
      ]);

      const vehicleById = new Map<string, { ymm: string; sold: boolean }>();
      for (const v of (((vRes.data as Record<string, unknown>[]) || []))) {
        vehicleById.set(String(v.id || ""), {
          ymm: String(v.ymm || "Vehicle"),
          sold: v.deal_processed_at != null || String(v.status || "") === "sold",
        });
      }

      const inspectionByVin = new Map<string, { assignedTo: string | null; stockNumber: string | null }>();
      for (const s of (((siRes.data as Record<string, unknown>[]) || []))) {
        const vin = String(s.vin || "").toUpperCase();
        if (String(s.status || "") === "voided" || inspectionByVin.has(vin)) continue;
        inspectionByVin.set(vin, {
          assignedTo: (s.assigned_to as string) ?? null,
          stockNumber: (s.stock_number as string) ?? null,
        });
      }

      const getReadyByVin = new Map<string, { deliveryTarget: string | null; stockNumber: string | null }>();
      for (const g of (((grRes.data as Record<string, unknown>[]) || []))) {
        const vin = String(g.vin || "").toUpperCase();
        if (getReadyByVin.has(vin)) continue;
        getReadyByVin.set(vin, {
          deliveryTarget: (g.delivery_target as string) ?? null,
          stockNumber: (g.stock_number as string) ?? null,
        });
      }

      const clearanceByVin = new Map<string, { state: string; reasons: string[] }>();
      for (const c of (((clrRes.data as Record<string, unknown>[]) || []))) {
        clearanceByVin.set(String(c.vin || "").toUpperCase(), {
          state: String(c.state || ""),
          reasons: Array.isArray(c.reason_codes) ? (c.reason_codes as string[]) : [],
        });
      }

      const requestByVin = new Map<string, string | null>();
      for (const r of (((reqRes.data as Record<string, unknown>[]) || []))) {
        const vin = String(r.vin || "").toUpperCase();
        if (requestByVin.has(vin)) continue;
        requestByVin.set(vin, (r.work_requested as string) ?? null);
      }

      const nameById = new Map<string, string>();
      for (const m of (((memRes.data as Record<string, unknown>[]) || []))) {
        const uid = (m.user_id as string) ?? "";
        const email = (m.email as string) ?? "";
        if (uid && email) nameById.set(uid, email.split("@")[0]);
      }

      const now = Date.now();
      const out: DeskRow[] = lcRows.map((r) => {
        const v = vehicleById.get(r.vehicleId);
        const inspection = inspectionByVin.get(r.vin) ?? null;
        const getReady = getReadyByVin.get(r.vin) ?? null;
        const clearance = clearanceByVin.get(r.vin) ?? null;
        const changed = r.stateChangedAt ? new Date(r.stateChangedAt).getTime() : NaN;
        const ageHours = Number.isNaN(changed) ? 0 : Math.max(0, (now - changed) / 36e5);
        const blocked = !!clearance && clearance.state !== "cleared_for_delivery";
        const deliveryTarget = getReady?.deliveryTarget ?? null;
        const overdue = ageHours > overdueHours;
        const assignedId = inspection?.assignedTo ?? null;
        return {
          vehicleId: r.vehicleId,
          vin: r.vin,
          ymm: v?.ymm || "Vehicle",
          stockNumber: inspection?.stockNumber || getReady?.stockNumber || null,
          state: r.state,
          ageHours,
          overdue,
          assignedName: assignedId ? (nameById.get(assignedId) ?? "Assigned") : null,
          deliveryTarget,
          blocked,
          clearanceReasons: clearance?.reasons ?? [],
          openRequest: requestByVin.get(r.vin) ?? null,
          priority: deriveServicePriority({
            sold: v?.sold ?? false,
            deliveryToday: isToday(deliveryTarget),
            blocked,
            failedItemsOpen: ["SERVICE_FINDINGS_RECORDED", "WORK_AUTHORIZED", "REPAIR_IN_PROGRESS"].includes(r.state),
            awaitingReinspection: r.state === "REPAIR_VERIFICATION_REQUIRED",
            readyForK208: r.state === "K208_READY_TO_CERTIFY",
            inspectionStarted: !["SERVICE_UNASSIGNED", "AUTHORIZED_FOR_GET_READY"].includes(r.state),
            overdue,
            overdueDays: overdue ? Math.floor((ageHours - overdueHours) / 24) : 0,
            assigned: !!assignedId,
            ageHours,
            cleared: false,
          }),
        };
      });
      out.sort(compareServicePriority);
      setRows(out);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Unknown error");
    }
    setLoading(false);
  }, [tenantId, overdueHours]);

  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => {
    const c = {} as Record<TabKey, number>;
    for (const t of TABS) {
      const key = t.key;
      c[key] = key === "all" ? rows.length : rows.filter((r) => TAB_STATES[key].includes(r.state)).length;
    }
    return c;
  }, [rows]);

  const visible = useMemo(
    () => (tab === "all" ? rows : rows.filter((r) => TAB_STATES[tab].includes(r.state))),
    [rows, tab],
  );

  if (!tenantId) return null;

  if (loading || metricsLoading) {
    return (
      <div className="max-w-[1200px] mx-auto p-4 md:p-6 space-y-4">
        <LoadingCard rows={2} />
        <LoadingCard rows={6} />
      </div>
    );
  }

  if (loadError || metricsError) {
    return (
      <div className="max-w-[1200px] mx-auto p-4 md:p-6">
        <ErrorCard
          message="We could not load the service desk."
          detail={loadError || metricsError}
          onRetry={() => { void load(); void reloadMetrics(); }}
        />
      </div>
    );
  }

  return (
    <div className="max-w-[1200px] mx-auto p-4 md:p-6 space-y-5">
      <header>
        <div className="flex items-center gap-2">
          <Headset className="w-5 h-5 text-primary" aria-hidden="true" />
          <h1 className="text-al-page font-display text-foreground">Service writer desk</h1>
        </div>
        <p className="text-al-body text-muted-foreground mt-0.5">
          {rows.length} {rows.length === 1 ? "vehicle" : "vehicles"} in the service pipeline &middot;{" "}
          {metrics.inGetReady} inside get ready &middot; {metrics.retailReady} retail ready.
        </p>
      </header>

      <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 md:mx-0 md:px-0">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            aria-pressed={tab === t.key}
            onClick={() => { setTab(t.key); setExpanded(null); }}
            className={cn(
              "min-h-[40px] shrink-0 rounded-xl border px-3 text-al-meta font-bold uppercase tracking-[0.08em] transition-colors",
              tab === t.key
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-muted-foreground hover:bg-muted",
            )}
          >
            {t.label}
            <span className="ml-2 tabular-nums">{counts[t.key]}</span>
          </button>
        ))}
      </div>

      <p className="text-al-meta text-muted-foreground">
        K-208 is shown here for visibility only. Certification authority comes from the store&apos;s K-208 policy and is
        enforced by the server &mdash; it is never granted by a job title, and nothing on this desk certifies a vehicle.
      </p>

      {visible.length === 0 ? (
        <EmptyState Icon={ClipboardList} title={TAB_EMPTY[tab].title} detail={TAB_EMPTY[tab].detail} />
      ) : (
        <section className="rounded-2xl border border-border bg-card p-2 md:p-4">
          <table className="w-full table-fixed text-al-body">
            <caption className="sr-only">Vehicles in the service pipeline, highest priority first</caption>
            <colgroup>
              <col className="w-[34%] md:w-[26%]" />
              <col className="w-[30%] md:w-[20%]" />
              <col className="hidden md:table-column md:w-[12%]" />
              <col className="hidden md:table-column md:w-[9%]" />
              <col className="hidden md:table-column md:w-[13%]" />
              <col className="w-[36%] md:w-[20%]" />
            </colgroup>
            <thead>
              <tr className="text-al-meta uppercase tracking-[0.12em] text-muted-foreground border-b border-border">
                <th scope="col" className="text-left font-bold py-2 pr-2">Vehicle</th>
                <th scope="col" className="text-left font-bold py-2 pr-2">Current state</th>
                <th scope="col" className="hidden md:table-cell text-left font-bold py-2 pr-2">Assigned to</th>
                <th scope="col" className="hidden md:table-cell text-left font-bold py-2 pr-2">Age</th>
                <th scope="col" className="hidden md:table-cell text-left font-bold py-2 pr-2">Delivery target</th>
                <th scope="col" className="text-right font-bold py-2">Next action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visible.slice(0, 100).map((r) => {
                const open = expanded === r.vehicleId;
                return [
                  <tr key={r.vehicleId}>
                    <td className="py-2.5 pr-2 align-top">
                      <button
                        type="button"
                        aria-expanded={open}
                        onClick={() => setExpanded(open ? null : r.vehicleId)}
                        className="flex items-start gap-1.5 text-left min-h-[44px] w-full"
                      >
                        {open
                          ? <ChevronDown className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                          : <ChevronRight className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
                        <span className="min-w-0">
                          <span className="block text-foreground font-semibold truncate">{r.ymm}</span>
                          <span className="block font-mono text-al-meta text-muted-foreground">
                            &hellip;{r.vin.slice(-8)}
                          </span>
                        </span>
                      </button>
                    </td>
                    <td className="py-2.5 pr-2 align-top">
                      <span className="block text-foreground">{STATE_LABEL[r.state] || r.state}</span>
                      <span className="mt-1 inline-block">
                        <StatusPill tone={STATUS_TONE[STATE_STATUS[r.state] || "WAITING"]}>
                          {(STATE_STATUS[r.state] || "WAITING").replace("_", " ")}
                        </StatusPill>
                      </span>
                    </td>
                    <td className="hidden md:table-cell py-2.5 pr-2 align-top text-muted-foreground truncate">
                      {r.assignedName ?? "Unassigned"}
                    </td>
                    <td className="hidden md:table-cell py-2.5 pr-2 align-top tabular-nums text-foreground whitespace-nowrap">
                      {durationLabel(r.ageHours)}
                    </td>
                    <td className="hidden md:table-cell py-2.5 pr-2 align-top text-muted-foreground whitespace-nowrap">
                      {formatCommandDate(r.deliveryTarget) ?? EM_DASH}
                    </td>
                    <td className="py-2.5 align-top text-right">
                      <Link
                        to={`/service/vehicle/${encodeURIComponent(r.vin)}`}
                        className={cn(BTN_SECONDARY, "whitespace-nowrap")}
                      >
                        {NEXT_ACTION[r.state] || "Open file"}
                      </Link>
                    </td>
                  </tr>,
                  open ? (
                    <tr key={`${r.vehicleId}-detail`} className="bg-muted">
                      <td colSpan={6} className="p-3">
                        <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-3">
                          <div>
                            <dt className="text-al-meta text-muted-foreground">Stock</dt>
                            <dd className="text-al-body text-foreground">{r.stockNumber || EM_DASH}</dd>
                          </div>
                          <div>
                            <dt className="text-al-meta text-muted-foreground">VIN</dt>
                            <dd className="text-al-body text-foreground font-mono break-all">{r.vin}</dd>
                          </div>
                          <div className="md:hidden">
                            <dt className="text-al-meta text-muted-foreground">Assigned to</dt>
                            <dd className="text-al-body text-foreground">{r.assignedName ?? "Unassigned"}</dd>
                          </div>
                          <div className="md:hidden">
                            <dt className="text-al-meta text-muted-foreground">Age in state</dt>
                            <dd className="text-al-body text-foreground tabular-nums">{durationLabel(r.ageHours)}</dd>
                          </div>
                          <div className="md:hidden">
                            <dt className="text-al-meta text-muted-foreground">Delivery target</dt>
                            <dd className="text-al-body text-foreground">
                              {formatCommandDate(r.deliveryTarget) ?? EM_DASH}
                            </dd>
                          </div>
                          <div>
                            <dt className="text-al-meta text-muted-foreground">Priority</dt>
                            <dd className="text-al-body text-foreground flex flex-wrap items-center gap-1.5">
                              <StatusPill tone={PRIORITY_TONE[r.priority.level]}>{r.priority.level}</StatusPill>
                              <span className="text-al-meta text-muted-foreground">{r.priority.label}</span>
                            </dd>
                          </div>
                          <div>
                            <dt className="text-al-meta text-muted-foreground">Overdue</dt>
                            <dd className="text-al-body text-foreground">
                              {r.overdue ? `Past ${durationLabel(overdueHours)} in this stage` : "Within the store threshold"}
                            </dd>
                          </div>
                          <div className="col-span-2">
                            <dt className="text-al-meta text-muted-foreground">Delivery clearance</dt>
                            <dd className="text-al-body text-foreground">
                              {r.blocked
                                ? (r.clearanceReasons.length
                                  ? r.clearanceReasons.map(clearanceReasonLabel).join(" · ")
                                  : "Blocked")
                                : "No stored blocker"}
                            </dd>
                          </div>
                          <div className="col-span-2 md:col-span-4">
                            <dt className="text-al-meta text-muted-foreground">Open request</dt>
                            <dd className="text-al-body text-foreground">
                              {r.openRequest ?? "No estimate is waiting on a manager."}
                            </dd>
                          </div>
                        </dl>
                      </td>
                    </tr>
                  ) : null,
                ];
              })}
            </tbody>
          </table>
          {visible.length > 100 ? (
            <p className="text-al-meta text-muted-foreground pt-3">
              Showing the 100 highest-priority of {visible.length}.
            </p>
          ) : null}
        </section>
      )}
    </div>
  );
}
