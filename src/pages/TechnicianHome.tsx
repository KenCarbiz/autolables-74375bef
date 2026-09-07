import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { useOperatingMetrics } from "@/hooks/useOperatingMetrics";
import { compareServicePriority, deriveServicePriority, type ServicePriority } from "@/lib/service/priority";
import { listingHero } from "@/lib/photos";
import {
  BTN_PRIMARY, EM_DASH, EmptyState, ErrorCard, LoadingCard, StatusPill,
  formatCommandDate, type Tone,
} from "@/components/command/CommandPrimitives";
import { Car, ClipboardList, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";

// The technician's own bench. Tablet-first: one card per vehicle with a single
// primary action, because a phone or shop tablet cannot work a dense table.
// Every row is a stored vehicle_lifecycle row; nothing on this page is
// administration, pricing or deal data.
//
// K-208 appears only as a state the vehicle is in. Certification authority
// comes from the store's K-208 policy and is enforced server-side, so nothing
// here executes or grants a certification.

// deno-lint-ignore no-explicit-any
const sb = () => supabase as any;

type TabKey = "assigned" | "available" | "in_progress" | "waiting" | "reinspect" | "completed";

const STATE_LABEL: Record<string, string> = {
  AUTHORIZED_FOR_GET_READY: "Inspection not started",
  SERVICE_UNASSIGNED: "Waiting for a technician",
  K208_IN_PROGRESS: "Inspection in progress",
  SERVICE_FINDINGS_RECORDED: "Findings with the manager",
  WAITING_FOR_MANAGER_DECISION: "Waiting for manager decision",
  RETURNED_FOR_CLARIFICATION: "Manager asked a question",
  WORK_AUTHORIZED: "Repairs authorized",
  REPAIR_IN_PROGRESS: "Repair in progress",
  REPAIR_VERIFICATION_REQUIRED: "Repairs done, verify them",
  K208_READY_TO_CERTIFY: "Passed, awaiting certification",
  K208_FINALIZED: "K-208 finalized",
  DETAIL_PENDING: "Handed to detail",
  DETAIL_IN_PROGRESS: "In detail",
  FINAL_READY_VERIFICATION: "Final ready verification",
};

const STATE_CTA: Record<string, string> = {
  AUTHORIZED_FOR_GET_READY: "Start inspection",
  SERVICE_UNASSIGNED: "Start inspection",
  K208_IN_PROGRESS: "Continue inspection",
  SERVICE_FINDINGS_RECORDED: "Open vehicle",
  WAITING_FOR_MANAGER_DECISION: "Open vehicle",
  RETURNED_FOR_CLARIFICATION: "Answer manager",
  WORK_AUTHORIZED: "Begin repair",
  REPAIR_IN_PROGRESS: "Continue repair",
  REPAIR_VERIFICATION_REQUIRED: "Verify repair",
  K208_READY_TO_CERTIFY: "View inspection",
  K208_FINALIZED: "View inspection",
  DETAIL_PENDING: "View inspection",
  DETAIL_IN_PROGRESS: "View inspection",
  FINAL_READY_VERIFICATION: "View inspection",
};

const MINE_ASSIGNED = ["AUTHORIZED_FOR_GET_READY", "WORK_AUTHORIZED"];
const MINE_IN_PROGRESS = ["K208_IN_PROGRESS", "REPAIR_IN_PROGRESS"];
const MINE_WAITING = ["SERVICE_FINDINGS_RECORDED", "WAITING_FOR_MANAGER_DECISION", "RETURNED_FOR_CLARIFICATION"];
const MINE_REINSPECT = ["REPAIR_VERIFICATION_REQUIRED"];
const MINE_COMPLETED = [
  "K208_READY_TO_CERTIFY", "K208_FINALIZED",
  "DETAIL_PENDING", "DETAIL_IN_PROGRESS", "FINAL_READY_VERIFICATION",
];

const BENCH_STATES = new Set<string>([
  "SERVICE_UNASSIGNED",
  ...MINE_ASSIGNED, ...MINE_IN_PROGRESS, ...MINE_WAITING, ...MINE_REINSPECT, ...MINE_COMPLETED,
]);

const TABS: { key: TabKey; label: string }[] = [
  { key: "assigned", label: "Assigned" },
  { key: "available", label: "Available" },
  { key: "in_progress", label: "In progress" },
  { key: "waiting", label: "Waiting" },
  { key: "reinspect", label: "Reinspect" },
  { key: "completed", label: "Completed" },
];

const TAB_EMPTY: Record<TabKey, { title: string; detail: string }> = {
  assigned: {
    title: "No service work is assigned to you.",
    detail: "A vehicle lands here once a manager authorizes it for get ready and the service desk puts your name on it.",
  },
  available: {
    title: "No vehicles are waiting to be picked up.",
    detail: "Authorized vehicles with no technician on them show here so you can take the next one.",
  },
  in_progress: {
    title: "You have nothing open on the floor.",
    detail: "An inspection or repair you start shows here until you finish it.",
  },
  waiting: {
    title: "No vehicles are waiting on you.",
    detail: "Vehicles sitting with the manager for an estimate decision, and anything the manager sent back with a question, appear here.",
  },
  reinspect: {
    title: "Nothing is ready to reinspect.",
    detail: "A vehicle arrives here after every failed item on it has been repaired and needs your verification.",
  },
  completed: {
    title: "No completed work yet.",
    detail: "Vehicles you finished stay here after the inspection leaves your hands.",
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

interface BenchRow {
  vehicleId: string;
  vin: string;
  ymm: string;
  stockNumber: string | null;
  photo: string;
  state: string;
  ageHours: number;
  overdue: boolean;
  deliveryTarget: string | null;
  managerNote: string | null;
  mine: boolean;
  priority: ServicePriority;
}

export default function TechnicianHome() {
  const { user } = useAuth();
  const { tenant } = useTenant();
  const { settings } = useDealerSettings();
  const tenantId = tenant?.id && tenant.id !== "house" ? tenant.id : null;
  const { metrics, loading: metricsLoading, error: metricsError, reload: reloadMetrics } = useOperatingMetrics(tenantId);

  const [rows, setRows] = useState<BenchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("assigned");

  const overdueHours = settings.service_overdue_hours || 24;
  const userId = user?.id ?? null;
  const userEmail = (user?.email ?? "").trim().toLowerCase();

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
        .filter((r) => BENCH_STATES.has(r.state)));

      const vins = Array.from(new Set(lcRows.map((r) => r.vin).filter(Boolean)));
      const ids = lcRows.map((r) => r.vehicleId).filter(Boolean);
      const none = Promise.resolve({ data: [] });

      const [vRes, siRes, grRes, reqRes] = await Promise.all([
        ids.length
          ? sb().from("vehicle_listings")
            .select("id, vin, ymm, status, deal_processed_at, hero_image_url, photos")
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
            .select("vin, delivery_target, stock_number, assigned_technician, created_at")
            .eq("tenant_id", tenantId).in("vin", vins)
            .order("created_at", { ascending: false })
          : none,
        vins.length
          ? sb().from("service_requests")
            .select("vin, status, manager_note, updated_at")
            .eq("tenant_id", tenantId).in("vin", vins)
            .in("status", ["pending", "clarify"])
            .order("updated_at", { ascending: false })
          : none,
      ]);

      const vehicleById = new Map<string, { ymm: string; sold: boolean; photo: string }>();
      for (const v of (((vRes.data as Record<string, unknown>[]) || []))) {
        vehicleById.set(String(v.id || ""), {
          ymm: String(v.ymm || "Vehicle"),
          sold: v.deal_processed_at != null || String(v.status || "") === "sold",
          photo: listingHero({ photos: v.photos, hero_image_url: (v.hero_image_url as string) ?? null }),
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

      const getReadyByVin = new Map<string, { deliveryTarget: string | null; stockNumber: string | null; technician: string }>();
      for (const g of (((grRes.data as Record<string, unknown>[]) || []))) {
        const vin = String(g.vin || "").toUpperCase();
        if (getReadyByVin.has(vin)) continue;
        getReadyByVin.set(vin, {
          deliveryTarget: (g.delivery_target as string) ?? null,
          stockNumber: (g.stock_number as string) ?? null,
          technician: String(g.assigned_technician || "").trim().toLowerCase(),
        });
      }

      const noteByVin = new Map<string, string | null>();
      for (const r of (((reqRes.data as Record<string, unknown>[]) || []))) {
        const vin = String(r.vin || "").toUpperCase();
        if (noteByVin.has(vin)) continue;
        noteByVin.set(vin, (r.manager_note as string) ?? null);
      }

      const now = Date.now();
      const out: BenchRow[] = lcRows.map((r) => {
        const v = vehicleById.get(r.vehicleId);
        const inspection = inspectionByVin.get(r.vin) ?? null;
        const getReady = getReadyByVin.get(r.vin) ?? null;
        const changed = r.stateChangedAt ? new Date(r.stateChangedAt).getTime() : NaN;
        const ageHours = Number.isNaN(changed) ? 0 : Math.max(0, (now - changed) / 36e5);
        const deliveryTarget = getReady?.deliveryTarget ?? null;
        const overdue = ageHours > overdueHours;
        // get_ready_records.assigned_technician is free text, so it counts as
        // mine only on an exact identity match — never a name-shaped guess.
        const mine = (!!userId && inspection?.assignedTo === userId)
          || (!!userEmail && !!getReady && getReady.technician === userEmail);
        return {
          vehicleId: r.vehicleId,
          vin: r.vin,
          ymm: v?.ymm || "Vehicle",
          stockNumber: inspection?.stockNumber || getReady?.stockNumber || null,
          photo: v?.photo || "",
          state: r.state,
          ageHours,
          overdue,
          deliveryTarget,
          managerNote: r.state === "RETURNED_FOR_CLARIFICATION" ? (noteByVin.get(r.vin) ?? null) : null,
          mine,
          priority: deriveServicePriority({
            sold: v?.sold ?? false,
            deliveryToday: isToday(deliveryTarget),
            blocked: false,
            failedItemsOpen: ["SERVICE_FINDINGS_RECORDED", "WORK_AUTHORIZED", "REPAIR_IN_PROGRESS"].includes(r.state),
            awaitingReinspection: r.state === "REPAIR_VERIFICATION_REQUIRED",
            readyForK208: r.state === "K208_READY_TO_CERTIFY",
            inspectionStarted: !["SERVICE_UNASSIGNED", "AUTHORIZED_FOR_GET_READY"].includes(r.state),
            overdue,
            overdueDays: overdue ? Math.floor((ageHours - overdueHours) / 24) : 0,
            assigned: !!inspection?.assignedTo,
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
  }, [tenantId, overdueHours, userId, userEmail]);

  useEffect(() => { void load(); }, [load]);

  const inTab = useCallback((r: BenchRow, key: TabKey): boolean => {
    switch (key) {
      case "assigned": return r.mine && MINE_ASSIGNED.includes(r.state);
      case "available": return r.state === "SERVICE_UNASSIGNED";
      case "in_progress": return r.mine && MINE_IN_PROGRESS.includes(r.state);
      case "waiting": return r.mine && MINE_WAITING.includes(r.state);
      case "reinspect": return r.mine && MINE_REINSPECT.includes(r.state);
      case "completed": return r.mine && MINE_COMPLETED.includes(r.state);
    }
  }, []);

  const counts = useMemo(() => {
    const c = {} as Record<TabKey, number>;
    for (const t of TABS) c[t.key] = rows.filter((r) => inTab(r, t.key)).length;
    return c;
  }, [rows, inTab]);

  const visible = useMemo(() => rows.filter((r) => inTab(r, tab)), [rows, tab, inTab]);

  if (!tenantId) return null;

  if (loading || metricsLoading) {
    return (
      <div className="max-w-[1100px] mx-auto p-4 md:p-6 space-y-4">
        <LoadingCard rows={2} />
        <LoadingCard rows={4} />
      </div>
    );
  }

  if (loadError || metricsError) {
    return (
      <div className="max-w-[1100px] mx-auto p-4 md:p-6">
        <ErrorCard
          message="We could not load your service work."
          detail={loadError || metricsError}
          onRetry={() => { void load(); void reloadMetrics(); }}
        />
      </div>
    );
  }

  return (
    <div className="max-w-[1100px] mx-auto p-4 md:p-6 space-y-5">
      <header>
        <div className="flex items-center gap-2">
          <Wrench className="w-5 h-5 text-primary" aria-hidden="true" />
          <h1 className="text-al-page font-display text-foreground">My service work</h1>
        </div>
        <p className="text-al-body text-muted-foreground mt-0.5">
          {counts.assigned + counts.in_progress + counts.reinspect === 0
            ? "Nothing is open on your bench right now."
            : `${counts.assigned + counts.in_progress + counts.reinspect} ${counts.assigned + counts.in_progress + counts.reinspect === 1 ? "vehicle needs" : "vehicles need"} you.`}
          {" "}
          {metrics.getReadyService} at the service stage across the shop.
        </p>
      </header>

      <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 md:mx-0 md:px-0">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            aria-pressed={tab === t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "min-h-[44px] shrink-0 rounded-xl border px-4 text-al-meta font-bold uppercase tracking-[0.08em] transition-colors",
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

      {visible.length === 0 ? (
        <EmptyState Icon={ClipboardList} title={TAB_EMPTY[tab].title} detail={TAB_EMPTY[tab].detail} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {visible.map((r) => (
            <article key={r.vehicleId} className="rounded-2xl border border-border bg-card p-4 flex flex-col gap-3">
              <div className="flex gap-3">
                <div className="w-24 h-[72px] md:w-32 md:h-24 shrink-0 rounded-xl border border-border bg-muted overflow-hidden flex items-center justify-center">
                  {r.photo ? (
                    <img src={r.photo} alt="" loading="lazy" className="w-full h-full object-cover" />
                  ) : (
                    <Car className="w-6 h-6 text-muted-foreground" aria-hidden="true" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-al-card text-foreground truncate">{r.ymm}</h2>
                  <p className="text-al-meta text-muted-foreground font-mono">&hellip;{r.vin.slice(-8)}</p>
                  <p className="text-al-meta text-muted-foreground">
                    Stock {r.stockNumber || EM_DASH}
                  </p>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    <StatusPill tone={PRIORITY_TONE[r.priority.level]}>{r.priority.level} priority</StatusPill>
                    {r.overdue ? <StatusPill tone="red">Overdue</StatusPill> : null}
                  </div>
                </div>
              </div>

              <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
                <div className="col-span-2">
                  <dt className="text-al-meta text-muted-foreground">Current task</dt>
                  <dd className="text-al-body text-foreground">{STATE_LABEL[r.state] || r.state}</dd>
                </div>
                <div>
                  <dt className="text-al-meta text-muted-foreground">Delivery target</dt>
                  <dd className="text-al-body text-foreground">{formatCommandDate(r.deliveryTarget) ?? EM_DASH}</dd>
                </div>
                <div>
                  <dt className="text-al-meta text-muted-foreground">In this stage</dt>
                  <dd className="text-al-body text-foreground tabular-nums">{durationLabel(r.ageHours)}</dd>
                </div>
              </dl>

              {r.managerNote ? (
                <p className="text-al-meta text-muted-foreground bg-muted rounded-xl p-3">
                  Manager: {r.managerNote}
                </p>
              ) : null}

              {r.state === "K208_READY_TO_CERTIFY" ? (
                <p className="text-al-meta text-muted-foreground">
                  Certification is handled by the store&apos;s licensed signer. Nothing here certifies this vehicle.
                </p>
              ) : null}

              <Link
                to={`/service/vehicle/${encodeURIComponent(r.vin)}`}
                className={cn(BTN_PRIMARY, "w-full mt-auto")}
              >
                {STATE_CTA[r.state] || "Open vehicle"}
              </Link>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
