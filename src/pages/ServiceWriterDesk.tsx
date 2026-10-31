import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { compareServicePriority, deriveServicePriority, type ServicePriority } from "@/lib/service/priority";
import { clearanceReasonLabel } from "@/lib/service/workspaceStatus";
import {
  EM_DASH, EmptyState, ErrorCard, LoadingCard,
  formatCommandDate, type Tone,
} from "@/components/command/CommandPrimitives";
import { ClipboardList } from "lucide-react";
import { LinkButton, LocalTabs, MetricStrip, PageBody, PageHeader, StatusText, Td, Th, WorkTable, type LocalTab, type Tone as ProductTone } from "@/components/product";
import { cn } from "@/lib/utils";
import { SERVICE_FLOOR_STATES, stateLabel, type ServiceFloorState } from "@/lib/lifecycle/states";

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

const STATUS_TONE: Record<StatusKey, Tone> = {
  WAITING: "slate",
  IN_PROGRESS: "blue",
  AUTHORIZED: "blue",
  NEEDS_REVIEW: "amber",
  COMPLETED: "emerald",
};

const NEXT_ACTION: Record<ServiceFloorState, string> = {
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

const DESK_STATES = new Set<string>(SERVICE_FLOOR_STATES);

type TabKey =
  | "all" | "unassigned" | "inspection" | "waiting"
  | "in_repair" | "reinspect" | "k208" | "completed";

const TAB_STATES: Record<Exclude<TabKey, "all">, string[]> = {
  unassigned: ["SERVICE_UNASSIGNED"],
  inspection: ["AUTHORIZED_FOR_GET_READY", "K208_IN_PROGRESS"],
  waiting: ["WAITING_FOR_MANAGER_DECISION", "SERVICE_FINDINGS_RECORDED", "RETURNED_FOR_CLARIFICATION"],
  in_repair: ["WORK_AUTHORIZED", "REPAIR_IN_PROGRESS"],
  reinspect: ["REPAIR_VERIFICATION_REQUIRED"],
  k208: ["K208_READY_TO_CERTIFY", "K208_FINALIZED"],
  completed: ["DETAIL_PENDING", "DETAIL_IN_PROGRESS", "FINAL_READY_VERIFICATION", "K208_FINALIZED"],
};

const TABS: { key: TabKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "unassigned", label: "Unassigned" },
  { key: "inspection", label: "Inspection" },
  { key: "waiting", label: "Waiting" },
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
  in_repair: {
    title: "No repairs are open on the floor.",
    detail: "Approved work and repairs in progress appear here.",
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
  photo: string | null;
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
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const [rows, setRows] = useState<DeskRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  const tab: TabKey = TABS.some((t) => t.key === tabParam) ? (tabParam as TabKey) : "all";

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
            .select("id, ymm, status, deal_processed_at, hero_image_url")
            .eq("tenant_id", tenantId).in("id", ids).neq("status", "archived")
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

      const vehicleById = new Map<string, { ymm: string; sold: boolean; photo: string | null }>();
      for (const v of (((vRes.data as Record<string, unknown>[]) || []))) {
        vehicleById.set(String(v.id || ""), {
          ymm: String(v.ymm || "Vehicle"),
          sold: v.deal_processed_at != null || String(v.status || "") === "sold",
          photo: (v.hero_image_url as string) || null,
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
      // A lifecycle row outlives its vehicle: production has 0 completed
      // get_ready_records, so a car routinely sells while parked in a working
      // state. Dropping rows whose vehicle is gone is what stops a board
      // claiming more vehicles than the lot holds. Sold-but-present cars are
      // deliberately kept: one still in the shop is urgent.
      const out: DeskRow[] = lcRows
        .filter((r) => vehicleById.has(r.vehicleId))
        .map((r) => {
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
          photo: v?.photo ?? null,
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

  if (loading) {
    return (
      <div className="max-w-[1200px] mx-auto p-4 md:p-6 space-y-4">
        <LoadingCard rows={2} />
        <LoadingCard rows={6} />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="max-w-[1200px] mx-auto p-4 md:p-6">
        <ErrorCard
          message="We could not load the service desk."
          detail={loadError}
          onRetry={() => { void load(); }}
        />
      </div>
    );
  }

  const tabs = TABS.map((t): LocalTab => ({ key: t.key, label: t.label, to: `/service-desk?tab=${t.key}`, count: counts[t.key], active: t.key === tab }));
  const PRODUCT_TONE: Record<StatusKey, ProductTone> = { WAITING: "warning", IN_PROGRESS: "info", AUTHORIZED: "info", NEEDS_REVIEW: "warning", COMPLETED: "success" };

  return (
    <PageBody width="wide">
      <PageHeader
        title="Service Writer Desk"
        actions={
          visible.length > 0 ? (
            <LinkButton variant="primary" to={`/service/vehicle/${encodeURIComponent((visible.find((r) => picked.has(r.vehicleId)) ?? visible.find((r) => !r.assignedName) ?? visible[0]).vin)}`}>
              Assign to technician
            </LinkButton>
          ) : undefined
        }
      />

      <LocalTabs label="Service pipeline stages" tabs={tabs} />

      <MetricStrip
        numberFirst
        noBars
        label="Service pipeline summary"
        metrics={[
          { label: "Unassigned", value: counts.unassigned, hint: "Needs a writer", tone: counts.unassigned > 0 ? "warning" : "neutral" },
          { label: "In inspection", value: counts.inspection, hint: "Initial multi-point" },
          { label: "In repair", value: counts.in_repair, hint: "Active work" },
          { label: "K-208", value: counts.k208, hint: `of ${rows.length} in the pipeline` },
        ]}
      />

      {visible.length === 0 ? (
        <EmptyState Icon={ClipboardList} title={TAB_EMPTY[tab].title} detail={TAB_EMPTY[tab].detail} />
      ) : (
        <div>
          <div className="overflow-hidden rounded-md border border-adm-border bg-white">
          <WorkTable caption="Vehicles in the service pipeline, highest priority first" minWidth={960}>
            <thead>
              <tr>
                <Th className="w-8">
                  <input type="checkbox" aria-label="Select all vehicles" className="h-4 w-4 accent-[#2457D6]"
                    checked={visible.length > 0 && visible.slice(0, 100).every((r) => picked.has(r.vehicleId))}
                    onChange={(e) => setPicked(e.target.checked ? new Set(visible.slice(0, 100).map((r) => r.vehicleId)) : new Set())} />
                </Th>
                <Th>Vehicle</Th>
                <Th>Stage</Th>
                <Th>Technician</Th>
                <Th align="right">Age</Th>
                <Th className="whitespace-nowrap">Delivery target</Th>
                <Th>Next action</Th>
                <Th align="right">Action</Th>
              </tr>
            </thead>
            <tbody>
              {visible.slice(0, 100).map((r) => (
                <tr key={r.vehicleId} className="h-14 hover:bg-adm-workspace">
                  <Td className="w-8">
                    <input type="checkbox" aria-label={`Select ${r.ymm}`} className="h-4 w-4 accent-[#2457D6]" checked={picked.has(r.vehicleId)}
                      onChange={(e) => setPicked((prev) => { const n = new Set(prev); if (e.target.checked) n.add(r.vehicleId); else n.delete(r.vehicleId); return n; })} />
                  </Td>
                  <Td className="max-w-[300px]">
                    <div className="flex items-center gap-3">
                      {r.photo
                        ? <img src={r.photo} alt="" className="h-10 w-14 shrink-0 rounded-[4px] border border-adm-border object-cover" />
                        : <span className="h-10 w-14 shrink-0 rounded-[4px] bg-adm-workspace" aria-hidden="true" />}
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-adm-ink" title={r.ymm}>{r.ymm}</p>
                        <p className="truncate font-mono text-[12px] leading-[18px] text-adm-muted">{r.stockNumber ? `${r.stockNumber} / ` : ""}{r.vin}</p>
                      </div>
                    </div>
                  </Td>
                  <Td className="whitespace-nowrap">
                    <StatusText tone={r.state === "SERVICE_UNASSIGNED" ? "neutral" : PRODUCT_TONE[STATE_STATUS[r.state as ServiceFloorState] || "WAITING"]}>{stateLabel(r.state)}</StatusText>
                  </Td>
                  <Td className="text-adm-muted">{r.assignedName ?? "Unassigned"}</Td>
                  <Td align="right" className="tabular-nums whitespace-nowrap">{durationLabel(r.ageHours)}</Td>
                  <Td className="text-adm-muted whitespace-nowrap">{formatCommandDate(r.deliveryTarget) ?? EM_DASH}</Td>
                  <Td className="whitespace-nowrap">{NEXT_ACTION[r.state as ServiceFloorState] || "Open file"}</Td>
                  <Td align="right">
                    <Link className="text-[14px] font-medium text-adm-primary hover:underline" to={`/service/vehicle/${encodeURIComponent(r.vin)}`}>{r.assignedName ? "View" : "Assign"}</Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </WorkTable>
          </div>
          {visible.length > 100 ? (
            <p className="text-[12px] leading-[18px] text-adm-muted pt-3">
              Showing the 100 highest-priority of {visible.length}.
            </p>
          ) : null}
        </div>
      )}
    </PageBody>
  );
}
