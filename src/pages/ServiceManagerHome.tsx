import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { useOperatingMetrics } from "@/hooks/useOperatingMetrics";
import { deriveServicePriority, compareServicePriority, type ServicePriority } from "@/lib/service/priority";
import { clearanceReasonLabel } from "@/lib/service/workspaceStatus";
import {
  CommandCard, CommandStatCard, EmptyState, ErrorCard, LoadingCard, StatusPill,
  BTN_SECONDARY, EM_DASH, formatCommandDate, type Tone,
} from "@/components/command/CommandPrimitives";
import {
  Wrench, UserX, ClipboardList, ClipboardCheck, CheckCircle2, RotateCcw,
  FileText, ShieldAlert, Clock, ArrowUp, ArrowDown, Minus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SERVICE_FLOOR_STATES, stateLabel, type ServiceFloorState } from "@/lib/lifecycle/states";

// /service-manager — the service manager's home. Physical work only: what is
// unassigned, what is open on the floor, what is waiting on someone else, and
// what is late. Every row is one vehicle_lifecycle row (the canonical 22-state
// machine); every tile is a filter over the rows below it, so a tile can never
// report a number the queue cannot show.
//
// K-208 is surfaced for visibility ONLY. Certification authority comes from the
// store's K-208 policy (k208_authority_roles / k208_authorized_users, enforced
// server-side by k208_signer_allowed) and is never implied by a job title, so
// nothing on this page executes or grants a certification.

// deno-lint-ignore no-explicit-any
const sb = () => supabase as any;

type StatusKey =
  | "READY" | "NOT_READY" | "BLOCKED" | "NEEDS_REVIEW" | "WAITING"
  | "IN_PROGRESS" | "AUTHORIZED" | "COMPLETED" | "FAILED" | "STALE";

const STATUS_LABEL: Record<StatusKey, string> = {
  READY: "READY",
  NOT_READY: "NOT READY",
  BLOCKED: "BLOCKED",
  NEEDS_REVIEW: "NEEDS REVIEW",
  WAITING: "WAITING",
  IN_PROGRESS: "IN PROGRESS",
  AUTHORIZED: "AUTHORIZED",
  COMPLETED: "COMPLETED",
  FAILED: "FAILED",
  STALE: "STALE",
};

const STATUS_TONE: Record<StatusKey, Tone> = {
  READY: "emerald",
  NOT_READY: "amber",
  BLOCKED: "red",
  NEEDS_REVIEW: "amber",
  WAITING: "slate",
  IN_PROGRESS: "blue",
  AUTHORIZED: "blue",
  COMPLETED: "emerald",
  FAILED: "red",
  STALE: "amber",
};

const Status = ({ status, suffix }: { status: StatusKey; suffix?: string }) => (
  <StatusPill tone={STATUS_TONE[status]}>
    {suffix ? `${STATUS_LABEL[status]} - ${suffix}` : STATUS_LABEL[status]}
  </StatusPill>
);

const STATE_STATUS: Record<ServiceFloorState, StatusKey> = {
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

// Desk-specific CTA copy: what THIS screen's button says. The state
// vocabulary it is keyed on is shared; the wording is not, because the service
// writer and the technician are told to do different things in the same state.
const NEXT_ACTION: Record<ServiceFloorState, string> = {
  AUTHORIZED_FOR_GET_READY: "Start inspection",
  SERVICE_UNASSIGNED: "Assign technician",
  K208_IN_PROGRESS: "Continue inspection",
  SERVICE_FINDINGS_RECORDED: "Review findings",
  WAITING_FOR_MANAGER_DECISION: "Open file",
  RETURNED_FOR_CLARIFICATION: "Answer the manager",
  WORK_AUTHORIZED: "Start authorized work",
  REPAIR_IN_PROGRESS: "Continue repairs",
  REPAIR_VERIFICATION_REQUIRED: "Run reinspection",
  K208_READY_TO_CERTIFY: "Open file",
  K208_FINALIZED: "Open file",
  DETAIL_PENDING: "Open file",
  DETAIL_IN_PROGRESS: "Open file",
  FINAL_READY_VERIFICATION: "Open file",
};

// The states this desk works. Gate states (AWAITING_MANAGER_AUTHORIZATION,
// ON_HOLD, WHOLESALE, REMOVED) and the resting states belong elsewhere.
const QUEUE_STATES = new Set<string>(SERVICE_FLOOR_STATES);

const PRIORITY_ICON = { High: ArrowUp, Medium: Minus, Low: ArrowDown } as const;
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

interface QueueRow {
  vehicleId: string;
  vin: string;
  ymm: string;
  state: string;
  ageHours: number;
  assignedName: string | null;
  deliveryTarget: string | null;
  clearanceState: string | null;
  clearanceReasons: string[];
  blocked: boolean;
  overdue: boolean;
  priority: ServicePriority;
}

type TileKey =
  | "all" | "unassigned" | "in_inspection" | "waiting_approval" | "authorized"
  | "reinspection" | "awaiting_k208" | "delivery_blocked" | "overdue";

const TILE_EMPTY: Record<TileKey, string> = {
  all: "No used vehicles are in the service pipeline.",
  unassigned: "No vehicles are waiting for a technician assignment.",
  in_inspection: "No inspections are open on the floor.",
  waiting_approval: "No vehicles are waiting for manager approval.",
  authorized: "No authorized work is open.",
  reinspection: "No vehicles are waiting for reinspection.",
  awaiting_k208: "No vehicles are awaiting K-208 certification.",
  delivery_blocked: "No vehicles in service are blocked from delivery.",
  overdue: "No vehicles are past the store's overdue threshold.",
};

export default function ServiceManagerHome() {
  const { tenant } = useTenant();
  const { settings } = useDealerSettings();
  const tenantId = tenant?.id && tenant.id !== "house" ? tenant.id : null;
  const { metrics, loading: metricsLoading, error: metricsError, reload: reloadMetrics } = useOperatingMetrics(tenantId);

  const [rows, setRows] = useState<QueueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tile, setTile] = useState<TileKey>("all");

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
        .filter((r) => QUEUE_STATES.has(r.state)));

      const vins = Array.from(new Set(lcRows.map((r) => r.vin).filter(Boolean)));
      const ids = lcRows.map((r) => r.vehicleId).filter(Boolean);
      const none = Promise.resolve({ data: [] });

      const [vRes, siRes, grRes, clrRes, memRes] = await Promise.all([
        ids.length
          ? sb().from("vehicle_listings")
            .select("id, vin, ymm, status, deal_processed_at")
            .eq("tenant_id", tenantId).in("id", ids).neq("status", "archived")
          : none,
        vins.length
          ? sb().from("safety_inspections")
            .select("vin, status, assigned_to, created_at")
            .eq("tenant_id", tenantId).in("vin", vins)
            .order("created_at", { ascending: false })
          : none,
        vins.length
          ? sb().from("get_ready_records")
            .select("vin, delivery_target, created_at")
            .eq("tenant_id", tenantId).in("vin", vins)
            .order("created_at", { ascending: false })
          : none,
        vins.length
          ? sb().from("vehicle_delivery_clearance")
            .select("vin, state, reason_codes")
            .eq("tenant_id", tenantId).in("vin", vins)
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

      // Newest non-voided inspection per VIN carries the assignment.
      const assignedByVin = new Map<string, string | null>();
      for (const s of (((siRes.data as Record<string, unknown>[]) || []))) {
        const vin = String(s.vin || "").toUpperCase();
        if (String(s.status || "") === "voided" || assignedByVin.has(vin)) continue;
        assignedByVin.set(vin, (s.assigned_to as string) ?? null);
      }

      const deliveryByVin = new Map<string, string | null>();
      for (const g of (((grRes.data as Record<string, unknown>[]) || []))) {
        const vin = String(g.vin || "").toUpperCase();
        if (deliveryByVin.has(vin)) continue;
        deliveryByVin.set(vin, (g.delivery_target as string) ?? null);
      }

      const clearanceByVin = new Map<string, { state: string; reasons: string[] }>();
      for (const c of (((clrRes.data as Record<string, unknown>[]) || []))) {
        clearanceByVin.set(String(c.vin || "").toUpperCase(), {
          state: String(c.state || ""),
          reasons: Array.isArray(c.reason_codes) ? (c.reason_codes as string[]) : [],
        });
      }

      const nameById = new Map<string, string>();
      for (const m of (((memRes.data as Record<string, unknown>[]) || []))) {
        const uid = (m.user_id as string) ?? "";
        const email = (m.email as string) ?? "";
        if (uid && email) nameById.set(uid, email.split("@")[0]);
      }

      const now = Date.now();
      // A lifecycle row outlives its vehicle: production has 0 completed
      // get_ready_records, so a car routinely sells while parked in a working
      // state. Dropping rows whose vehicle is gone is what stops a board
      // claiming more vehicles than the lot holds. Sold-but-present cars are
      // deliberately kept: one still in the shop is urgent.
      const out: QueueRow[] = lcRows
        .filter((r) => vehicleById.has(r.vehicleId))
        .map((r) => {
        const v = vehicleById.get(r.vehicleId);
        const changed = r.stateChangedAt ? new Date(r.stateChangedAt).getTime() : NaN;
        const ageHours = Number.isNaN(changed) ? 0 : Math.max(0, (now - changed) / 36e5);
        const assignedId = assignedByVin.get(r.vin) ?? null;
        const clearance = clearanceByVin.get(r.vin) ?? null;
        const blocked = !!clearance && clearance.state !== "cleared_for_delivery";
        const deliveryTarget = deliveryByVin.get(r.vin) ?? null;
        const overdue = ageHours > overdueHours;
        const priority = deriveServicePriority({
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
          ageHours: ageHours,
          cleared: false,
        });
        return {
          vehicleId: r.vehicleId,
          vin: r.vin,
          ymm: v?.ymm || "Vehicle",
          state: r.state,
          ageHours,
          assignedName: assignedId ? (nameById.get(assignedId) ?? "Assigned") : null,
          deliveryTarget,
          clearanceState: clearance?.state ?? null,
          clearanceReasons: clearance?.reasons ?? [],
          blocked,
          overdue,
          priority,
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

  const counts = useMemo(() => ({
    all: rows.length,
    unassigned: rows.filter((r) => r.state === "SERVICE_UNASSIGNED").length,
    in_inspection: rows.filter((r) => r.state === "K208_IN_PROGRESS").length,
    waiting_approval: rows.filter((r) => r.state === "WAITING_FOR_MANAGER_DECISION").length,
    authorized: rows.filter((r) => r.state === "WORK_AUTHORIZED" || r.state === "REPAIR_IN_PROGRESS").length,
    reinspection: rows.filter((r) => r.state === "REPAIR_VERIFICATION_REQUIRED").length,
    awaiting_k208: rows.filter((r) => r.state === "K208_READY_TO_CERTIFY").length,
    delivery_blocked: rows.filter((r) => r.blocked).length,
    overdue: rows.filter((r) => r.overdue).length,
  }), [rows]);

  const visible = useMemo(() => rows.filter((r) => {
    switch (tile) {
      case "unassigned": return r.state === "SERVICE_UNASSIGNED";
      case "in_inspection": return r.state === "K208_IN_PROGRESS";
      case "waiting_approval": return r.state === "WAITING_FOR_MANAGER_DECISION";
      case "authorized": return r.state === "WORK_AUTHORIZED" || r.state === "REPAIR_IN_PROGRESS";
      case "reinspection": return r.state === "REPAIR_VERIFICATION_REQUIRED";
      case "awaiting_k208": return r.state === "K208_READY_TO_CERTIFY";
      case "delivery_blocked": return r.blocked;
      case "overdue": return r.overdue;
      default: return true;
    }
  }), [rows, tile]);

  if (!tenantId) return null;

  if (loading || metricsLoading) {
    return (
      <div className="max-w-[1500px] mx-auto p-4 md:p-6 space-y-4">
        <LoadingCard rows={2} />
        <LoadingCard rows={6} />
      </div>
    );
  }

  if (loadError || metricsError) {
    return (
      <div className="max-w-[1500px] mx-auto p-4 md:p-6">
        <ErrorCard
          message="We could not load the service queue."
          detail={loadError || metricsError}
          onRetry={() => { void load(); void reloadMetrics(); }}
        />
      </div>
    );
  }

  const tiles: { key: TileKey; label: string; value: number; sub: string; Icon: typeof Wrench; tone: Tone }[] = [
    { key: "unassigned", label: "Unassigned", value: counts.unassigned, sub: "No technician yet", Icon: UserX, tone: counts.unassigned > 0 ? "amber" : "slate" },
    { key: "in_inspection", label: "In inspection", value: counts.in_inspection, sub: "Open on the floor", Icon: ClipboardList, tone: counts.in_inspection > 0 ? "blue" : "slate" },
    { key: "waiting_approval", label: "Waiting for approval", value: counts.waiting_approval, sub: "With the manager", Icon: Clock, tone: counts.waiting_approval > 0 ? "amber" : "slate" },
    { key: "authorized", label: "Authorized work", value: counts.authorized, sub: "Approved, in the shop", Icon: ClipboardCheck, tone: counts.authorized > 0 ? "blue" : "slate" },
    { key: "reinspection", label: "Ready for reinspection", value: counts.reinspection, sub: "Repairs done", Icon: RotateCcw, tone: counts.reinspection > 0 ? "amber" : "slate" },
    { key: "awaiting_k208", label: "Awaiting K-208", value: counts.awaiting_k208, sub: "Certification pending", Icon: FileText, tone: counts.awaiting_k208 > 0 ? "amber" : "slate" },
    { key: "delivery_blocked", label: "Delivery blocked", value: counts.delivery_blocked, sub: "Stored clearance says no", Icon: ShieldAlert, tone: counts.delivery_blocked > 0 ? "red" : "slate" },
    { key: "overdue", label: "Overdue", value: counts.overdue, sub: `Over ${durationLabel(overdueHours)} in stage`, Icon: Clock, tone: counts.overdue > 0 ? "red" : "slate" },
  ];

  return (
    <div className="max-w-[1500px] mx-auto p-4 md:p-6 space-y-6">
      <header>
        <div className="flex items-center gap-2">
          <Wrench className="w-5 h-5 text-primary" aria-hidden="true" />
          <h1 className="text-al-page font-display text-foreground">Service Manager</h1>
        </div>
        <p className="text-al-body text-muted-foreground mt-0.5">
          Physical work in the shop right now. {metrics.inGetReady} used {metrics.inGetReady === 1 ? "vehicle is" : "vehicles are"} inside
          get ready &middot; {metrics.getReadyService} at the service stage &middot; {metrics.retailReady} retail ready.
        </p>
      </header>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {tiles.map((t) => (
          <CommandStatCard
            key={t.key}
            label={t.label}
            value={t.value}
            sub={t.sub}
            Icon={t.Icon}
            tone={t.tone}
            onClick={() => setTile(tile === t.key ? "all" : t.key)}
          />
        ))}
      </div>

      <p className="text-al-meta text-muted-foreground">
        K-208 is shown here for visibility only. Certification authority comes from the store&apos;s K-208 policy and is
        enforced by the server &mdash; it is never granted by a job title, and nothing on this page certifies a vehicle.
      </p>

      <CommandCard
        title={tile === "all" ? "Service queue" : `Service queue — ${tiles.find((t) => t.key === tile)?.label ?? ""}`}
        subtitle={
          tile === "all"
            ? "Every used vehicle inside the service pipeline, highest priority first."
            : "Filtered view. Select the tile again to show the full queue."
        }
        action={<Link to="/service" className={BTN_SECONDARY}>Open service desk</Link>}
      >
        {visible.length === 0 ? (
          <EmptyState
            Icon={CheckCircle2}
            title={TILE_EMPTY[tile]}
            detail="Vehicles appear here from the stored vehicle lifecycle once a manager authorizes them for get ready."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-al-body">
              <caption className="sr-only">Used vehicles in the service pipeline</caption>
              <thead>
                <tr className="text-al-meta uppercase tracking-[0.12em] text-muted-foreground border-b border-border">
                  <th scope="col" className="text-left font-bold py-2 pr-3">Vehicle</th>
                  <th scope="col" className="text-left font-bold py-2 pr-3">Priority</th>
                  <th scope="col" className="text-left font-bold py-2 pr-3">Current state</th>
                  <th scope="col" className="text-left font-bold py-2 pr-3">Assigned</th>
                  <th scope="col" className="text-left font-bold py-2 pr-3">Age in state</th>
                  <th scope="col" className="text-left font-bold py-2 pr-3">Delivery target</th>
                  <th scope="col" className="text-right font-bold py-2">Next action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visible.slice(0, 50).map((r) => {
                  const PIcon = PRIORITY_ICON[r.priority.level];
                  return (
                    <tr key={r.vehicleId}>
                      <td className="py-2.5 pr-3 align-top">
                        <p className="text-foreground font-semibold">{r.ymm}</p>
                        <p className="font-mono text-al-meta text-muted-foreground">&hellip;{r.vin.slice(-8)}</p>
                      </td>
                      <td className="py-2.5 pr-3 align-top">
                        <div className="flex flex-col gap-1 items-start">
                          <StatusPill tone={PRIORITY_TONE[r.priority.level]} Icon={PIcon}>
                            {r.priority.level}
                          </StatusPill>
                          <span className="text-al-meta text-muted-foreground">{r.priority.label}</span>
                        </div>
                      </td>
                      <td className="py-2.5 pr-3 align-top">
                        <div className="flex flex-col gap-1 items-start">
                          <span className="text-foreground">{stateLabel(r.state)}</span>
                          <Status status={STATE_STATUS[r.state as ServiceFloorState] || "WAITING"} />
                          {r.blocked && (
                            <Status
                              status="NOT_READY"
                              suffix={
                                r.clearanceReasons.length > 0
                                  ? `${r.clearanceReasons.length} ${r.clearanceReasons.length === 1 ? "BLOCKER" : "BLOCKERS"}`
                                  : undefined
                              }
                            />
                          )}
                          {r.blocked && r.clearanceReasons.length > 0 && (
                            <span className="text-al-meta text-muted-foreground">
                              {r.clearanceReasons.map(clearanceReasonLabel).join(" · ")}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 pr-3 align-top text-muted-foreground">
                        {r.assignedName ?? "Unassigned"}
                      </td>
                      <td className="py-2.5 pr-3 align-top whitespace-nowrap">
                        <span className="tabular-nums text-foreground">{durationLabel(r.ageHours)}</span>
                        {r.overdue && <span className="ml-2 inline-block align-middle"><Status status="STALE" /></span>}
                      </td>
                      <td className="py-2.5 pr-3 align-top text-muted-foreground whitespace-nowrap">
                        {formatCommandDate(r.deliveryTarget) ?? EM_DASH}
                      </td>
                      <td className="py-2.5 align-top text-right">
                        <Link
                          to={`/service/vehicle/${encodeURIComponent(r.vin)}`}
                          className={cn(BTN_SECONDARY, "whitespace-nowrap")}
                        >
                          {NEXT_ACTION[r.state as ServiceFloorState] || "Open file"}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {visible.length > 50 && (
              <p className="text-al-meta text-muted-foreground pt-3">
                Showing the 50 highest-priority of {visible.length}.
              </p>
            )}
          </div>
        )}
      </CommandCard>
    </div>
  );
}
