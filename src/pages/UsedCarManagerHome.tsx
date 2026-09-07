import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { useOperatingMetrics } from "@/hooks/useOperatingMetrics";
import { useReconEstimates } from "@/hooks/useReconEstimates";
import { useAdvertisedPrices, assessDrift } from "@/hooks/useAdvertisedPrices";
import { clearanceReasonLabel } from "@/lib/service/workspaceStatus";
import {
  CommandCard, CommandStatCard, EmptyState, ErrorCard, LoadingCard, StatusPill,
  BTN_PRIMARY, BTN_SECONDARY, EM_DASH, type Tone,
} from "@/components/command/CommandPrimitives";
import {
  ClipboardCheck, Wrench, Receipt, PauseCircle, Clock, Tag, ShieldCheck,
  ChevronRight, AlertTriangle, CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";

// /used-car-manager — the used-car manager's home: the PHYSICAL path of used
// inventory, in the order this role has to act on it. Counts that exist in
// public.operating_metrics come from useOperatingMetrics; everything else is a
// filter over the rows this page actually renders, so a tile can never claim a
// number the list below it cannot show.

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

const STATE_LABEL: Record<string, string> = {
  INGESTED: "Ingested",
  PRELOAD_RUNNING: "Preload running",
  PRELOAD_EXCEPTION: "Preload exception",
  AWAITING_MANAGER_AUTHORIZATION: "Awaiting manager authorization",
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
  RETAIL_READY: "Retail ready",
  ON_HOLD: "On hold",
  WHOLESALE: "Wholesale",
  REMOVED: "Removed",
};

const STATE_STATUS: Record<string, StatusKey> = {
  INGESTED: "WAITING",
  PRELOAD_RUNNING: "IN_PROGRESS",
  PRELOAD_EXCEPTION: "FAILED",
  AWAITING_MANAGER_AUTHORIZATION: "NEEDS_REVIEW",
  AUTHORIZED_FOR_GET_READY: "AUTHORIZED",
  SERVICE_UNASSIGNED: "WAITING",
  K208_IN_PROGRESS: "IN_PROGRESS",
  SERVICE_FINDINGS_RECORDED: "NEEDS_REVIEW",
  WAITING_FOR_MANAGER_DECISION: "NEEDS_REVIEW",
  RETURNED_FOR_CLARIFICATION: "WAITING",
  WORK_AUTHORIZED: "AUTHORIZED",
  REPAIR_IN_PROGRESS: "IN_PROGRESS",
  REPAIR_VERIFICATION_REQUIRED: "WAITING",
  K208_READY_TO_CERTIFY: "WAITING",
  K208_FINALIZED: "COMPLETED",
  DETAIL_PENDING: "WAITING",
  DETAIL_IN_PROGRESS: "IN_PROGRESS",
  FINAL_READY_VERIFICATION: "NEEDS_REVIEW",
  RETAIL_READY: "READY",
  ON_HOLD: "BLOCKED",
  WHOLESALE: "COMPLETED",
  REMOVED: "COMPLETED",
};

// Which desk owns the vehicle while it sits in this state. Derived from the
// state machine, never from a person record we do not hold.
const STATE_OWNER: Record<string, string> = {
  INGESTED: "Inventory ingest",
  PRELOAD_RUNNING: "Inventory ingest",
  PRELOAD_EXCEPTION: "Inventory ingest",
  AWAITING_MANAGER_AUTHORIZATION: "Used car manager",
  AUTHORIZED_FOR_GET_READY: "Service",
  SERVICE_UNASSIGNED: "Service",
  K208_IN_PROGRESS: "Service",
  SERVICE_FINDINGS_RECORDED: "Used car manager",
  WAITING_FOR_MANAGER_DECISION: "Used car manager",
  RETURNED_FOR_CLARIFICATION: "Service",
  WORK_AUTHORIZED: "Service",
  REPAIR_IN_PROGRESS: "Service",
  REPAIR_VERIFICATION_REQUIRED: "Service",
  K208_READY_TO_CERTIFY: "Service",
  K208_FINALIZED: "Detail",
  DETAIL_PENDING: "Detail",
  DETAIL_IN_PROGRESS: "Detail",
  FINAL_READY_VERIFICATION: "Used car manager",
  RETAIL_READY: "Used car manager",
  ON_HOLD: "Used car manager",
  WHOLESALE: "Used car manager",
  REMOVED: "Used car manager",
};

const STATE_BLOCKER: Record<string, string> = {
  INGESTED: "Preload has not run yet",
  PRELOAD_RUNNING: "Preload still running",
  PRELOAD_EXCEPTION: "Preload failed and needs a manual fix",
  AWAITING_MANAGER_AUTHORIZATION: "No authorization decision yet",
  AUTHORIZED_FOR_GET_READY: "Released, no inspection started",
  SERVICE_UNASSIGNED: "No technician assigned",
  K208_IN_PROGRESS: "Inspection open on the floor",
  SERVICE_FINDINGS_RECORDED: "Findings recorded, no work decision",
  WAITING_FOR_MANAGER_DECISION: "Additional work needs your approval",
  RETURNED_FOR_CLARIFICATION: "Service owes an answer on your question",
  WORK_AUTHORIZED: "Approved work not started",
  REPAIR_IN_PROGRESS: "Repairs open",
  REPAIR_VERIFICATION_REQUIRED: "Repairs done, reinspection not run",
  K208_READY_TO_CERTIFY: "Certification pending with the licensee",
  K208_FINALIZED: "Certified, detail not started",
  DETAIL_PENDING: "Detail not started",
  DETAIL_IN_PROGRESS: "Detail open",
  FINAL_READY_VERIFICATION: "Final walk needs your sign-off",
  RETAIL_READY: "None",
  ON_HOLD: "Held by a manager decision",
  WHOLESALE: "Out of the retail pipeline",
  REMOVED: "Out of the retail pipeline",
};

// Terminal or out-of-pipeline states never appear as "stuck".
const RESTING_STATES = new Set(["RETAIL_READY", "WHOLESALE", "REMOVED"]);

const nextActionFor = (state: string, vehicleId: string, vin: string): { label: string; href: string } => {
  if (state === "AWAITING_MANAGER_AUTHORIZATION" || state === "ON_HOLD" || state === "PRELOAD_EXCEPTION") {
    return { label: "Review intake", href: `/get-ready-command/${vehicleId}` };
  }
  if (state === "WAITING_FOR_MANAGER_DECISION" || state === "SERVICE_FINDINGS_RECORDED") {
    return { label: "Decide on work", href: "/service/approvals" };
  }
  if (state === "DETAIL_PENDING" || state === "DETAIL_IN_PROGRESS" || state === "FINAL_READY_VERIFICATION") {
    return { label: "Open ready board", href: "/ready-board" };
  }
  return { label: "Open service file", href: `/service/vehicle/${encodeURIComponent(vin)}` };
};

const money = (v: number | null | undefined): string =>
  v == null || Number.isNaN(v) ? EM_DASH : `$${Math.round(v).toLocaleString("en-US")}`;

const durationLabel = (hours: number): string => {
  if (hours < 24) return `${Math.max(0, Math.round(hours))}h`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"}`;
};

const daysBetween = (iso: string | null | undefined, now: number): number | null => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now - t) / 864e5));
};

interface Lifecycle {
  vehicleId: string; vin: string; state: string; stateChangedAt: string | null; gateReason: string | null;
}
interface Vehicle {
  id: string; vin: string; ymm: string; price: number | null; mileage: number | null;
  createdAt: string | null; status: string; condition: string;
}
interface ServiceRequest {
  id: string; vin: string; ymm: string | null; workRequested: string; estTotal: number | null;
  requestedBy: string | null; status: string; isSafety: boolean; createdAt: string | null;
}
interface Clearance { vin: string; state: string; reasonCodes: string[] }

interface StuckRow {
  vehicleId: string; vin: string; ymm: string; state: string; hoursInState: number;
  owner: string; blocker: string; cost: number | null; next: { label: string; href: string };
}

export default function UsedCarManagerHome() {
  const { tenant } = useTenant();
  const { settings } = useDealerSettings();
  const tenantId = tenant?.id && tenant.id !== "house" ? tenant.id : null;
  const { metrics, loading: metricsLoading, error: metricsError, reload: reloadMetrics } = useOperatingMetrics(tenantId);
  const { estimates, loading: reconLoading } = useReconEstimates();
  const { byVin: advertisedByVin } = useAdvertisedPrices();

  const [lifecycle, setLifecycle] = useState<Lifecycle[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [requests, setRequests] = useState<ServiceRequest[]>([]);
  const [clearances, setClearances] = useState<Clearance[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const stuckThresholdHours = settings.service_overdue_hours || 24;

  const load = useCallback(async () => {
    if (!tenantId) { setLoading(false); return; }
    setLoading(true); setLoadError(null);
    try {
      const [lcRes, vRes, srRes, clrRes] = await Promise.all([
        sb().from("vehicle_lifecycle")
          .select("vehicle_id, vin, state, state_changed_at, gate_reason")
          .eq("tenant_id", tenantId)
          .order("state_changed_at", { ascending: true })
          .limit(500),
        sb().from("vehicle_listings")
          .select("id, vin, ymm, price, mileage, created_at, status, condition")
          .eq("tenant_id", tenantId)
          .in("condition", ["used", "cpo", "certified"])
          .neq("status", "archived")
          .order("created_at", { ascending: true })
          .limit(500),
        sb().from("service_requests")
          .select("id, vin, ymm, work_requested, est_total, requested_by_name, status, is_safety, created_at")
          .eq("tenant_id", tenantId)
          .in("status", ["pending", "clarify"])
          .order("created_at", { ascending: true })
          .limit(200),
        sb().from("vehicle_delivery_clearance")
          .select("vin, state, reason_codes")
          .eq("tenant_id", tenantId)
          .neq("state", "cleared_for_delivery")
          .limit(500),
      ]);
      if (lcRes.error) throw new Error(lcRes.error.message);
      if (vRes.error) throw new Error(vRes.error.message);

      setLifecycle((((lcRes.data as Record<string, unknown>[]) || [])).map((r) => ({
        vehicleId: String(r.vehicle_id || ""),
        vin: String(r.vin || "").toUpperCase(),
        state: String(r.state || ""),
        stateChangedAt: (r.state_changed_at as string) ?? null,
        gateReason: (r.gate_reason as string) ?? null,
      })));
      setVehicles((((vRes.data as Record<string, unknown>[]) || [])).map((v) => ({
        id: String(v.id || ""),
        vin: String(v.vin || "").toUpperCase(),
        ymm: String(v.ymm || "Vehicle"),
        price: v.price != null ? Number(v.price) : null,
        mileage: v.mileage != null ? Number(v.mileage) : null,
        createdAt: (v.created_at as string) ?? null,
        status: String(v.status || ""),
        condition: String(v.condition || "used"),
      })));
      setRequests((((srRes.data as Record<string, unknown>[]) || [])).map((r) => ({
        id: String(r.id || ""),
        vin: String(r.vin || "").toUpperCase(),
        ymm: (r.ymm as string) ?? null,
        workRequested: String(r.work_requested || ""),
        estTotal: r.est_total != null ? Number(r.est_total) : null,
        requestedBy: (r.requested_by_name as string) ?? null,
        status: String(r.status || ""),
        isSafety: r.is_safety === true,
        createdAt: (r.created_at as string) ?? null,
      })));
      setClearances((((clrRes.data as Record<string, unknown>[]) || [])).map((c) => ({
        vin: String(c.vin || "").toUpperCase(),
        state: String(c.state || ""),
        reasonCodes: Array.isArray(c.reason_codes) ? (c.reason_codes as string[]) : [],
      })));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Unknown error");
    }
    setLoading(false);
  }, [tenantId]);

  useEffect(() => { void load(); }, [load]);

  const vehicleById = useMemo(() => {
    const m = new Map<string, Vehicle>();
    for (const v of vehicles) m.set(v.id, v);
    return m;
  }, [vehicles]);

  const vehicleByVin = useMemo(() => {
    const m = new Map<string, Vehicle>();
    for (const v of vehicles) m.set(v.vin, v);
    return m;
  }, [vehicles]);

  // Dollars parked on this role's desk for one VIN: open additional-work
  // requests plus recon estimates still awaiting a decision.
  const costByVin = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of requests) {
      if (r.estTotal == null) continue;
      m.set(r.vin, (m.get(r.vin) || 0) + r.estTotal);
    }
    for (const e of estimates) {
      if (e.status !== "submitted") continue;
      const vin = String(e.vin || "").toUpperCase();
      m.set(vin, (m.get(vin) || 0) + Number(e.subtotal || 0));
    }
    return m;
  }, [requests, estimates]);

  const now = useMemo(() => Date.now(), [lifecycle, vehicles]);

  const awaiting = useMemo(
    () => lifecycle.filter((l) => l.state === "AWAITING_MANAGER_AUTHORIZATION"),
    [lifecycle],
  );

  const stuck = useMemo<StuckRow[]>(() => {
    return lifecycle
      .filter((l) => !RESTING_STATES.has(l.state))
      .map((l) => {
        const v = vehicleById.get(l.vehicleId);
        const changed = l.stateChangedAt ? new Date(l.stateChangedAt).getTime() : NaN;
        const hoursInState = Number.isNaN(changed) ? 0 : Math.max(0, (now - changed) / 36e5);
        return {
          vehicleId: l.vehicleId,
          vin: l.vin,
          ymm: v?.ymm || "Vehicle",
          state: l.state,
          hoursInState,
          owner: STATE_OWNER[l.state] || EM_DASH,
          blocker: l.gateReason || STATE_BLOCKER[l.state] || EM_DASH,
          cost: costByVin.get(l.vin) ?? null,
          next: nextActionFor(l.state, l.vehicleId, l.vin),
        };
      })
      .filter((r) => r.hoursInState >= stuckThresholdHours)
      .sort((a, b) => b.hoursInState - a.hoursInState);
  }, [lifecycle, vehicleById, costByVin, now, stuckThresholdHours]);

  const reconPending = useMemo(() => estimates.filter((e) => e.status === "submitted"), [estimates]);

  const aging = useMemo(() => {
    const rows = vehicles
      .map((v) => ({ v, days: daysBetween(v.createdAt, now) }))
      .filter((r): r is { v: Vehicle; days: number } => r.days !== null)
      .sort((a, b) => b.days - a.days);
    const buckets = [
      { label: "0-30 days", count: rows.filter((r) => r.days <= 30).length },
      { label: "31-60 days", count: rows.filter((r) => r.days > 30 && r.days <= 60).length },
      { label: "61-90 days", count: rows.filter((r) => r.days > 60 && r.days <= 90).length },
      { label: "Over 90 days", count: rows.filter((r) => r.days > 90).length },
    ];
    return { rows, buckets };
  }, [vehicles, now]);

  const priceExceptions = useMemo(() => {
    const drift: { vehicle: Vehicle; advertised: number; sticker: number; delta: number }[] = [];
    let untracked = 0;
    for (const v of vehicles) {
      if (v.status !== "published" || v.price == null) continue;
      const a = assessDrift(v.price, advertisedByVin.get(v.vin));
      if (a.status === "untracked") { untracked += 1; continue; }
      if (a.status === "drift") {
        drift.push({ vehicle: v, advertised: a.advertised ?? 0, sticker: a.sticker, delta: a.delta });
      }
    }
    drift.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    return { drift, untracked };
  }, [vehicles, advertisedByVin]);

  const blockers = useMemo(() => clearances
    .map((c) => ({ clearance: c, vehicle: vehicleByVin.get(c.vin) }))
    .filter((r) => !!r.vehicle)
    .sort((a, b) => b.clearance.reasonCodes.length - a.clearance.reasonCodes.length),
    [clearances, vehicleByVin]);

  if (!tenantId) return null;

  if (loading || metricsLoading || reconLoading) {
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
          message="We could not load the used-car pipeline."
          detail={loadError || metricsError}
          onRetry={() => { void load(); void reloadMetrics(); }}
        />
      </div>
    );
  }

  const usedTotal = metrics.usedInventory;
  const awaitingShare = usedTotal > 0
    ? Math.round((metrics.awaitingAuthorization / usedTotal) * 100)
    : 0;

  return (
    <div className="max-w-[1500px] mx-auto p-4 md:p-6 space-y-6">
      <header>
        <div className="flex items-center gap-2">
          <ClipboardCheck className="w-5 h-5 text-primary" aria-hidden="true" />
          <h1 className="text-al-page font-display text-foreground">Used Car Manager</h1>
        </div>
        <p className="text-al-body text-muted-foreground mt-0.5">
          The physical path of used inventory, in the order you have to act on it.
          {" "}{metrics.usedInventory} used {metrics.usedInventory === 1 ? "vehicle" : "vehicles"} active
          {" "}&middot; {metrics.inGetReady} in get ready &middot; {metrics.retailReady} retail ready.
        </p>
        {metrics.usedMissingLifecycle > 0 && (
          <p className="text-al-meta text-red-700 mt-1.5 inline-flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4" aria-hidden="true" />
            {metrics.usedMissingLifecycle} used {metrics.usedMissingLifecycle === 1 ? "vehicle is" : "vehicles are"} missing a lifecycle
            record and cannot be tracked on this page.
          </p>
        )}
      </header>

      {/* 1 — Awaiting intake authorization. Over half the used lot can sit
          here, and nothing downstream moves until this role decides. */}
      <section
        aria-labelledby="ucm-awaiting"
        className={cn(
          "rounded-2xl border p-5",
          metrics.awaitingAuthorization > 0 ? "border-amber-200 bg-amber-50/50" : "border-border bg-card",
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id="ucm-awaiting" className="text-al-section font-display text-foreground">
              Awaiting intake authorization
            </h2>
            <p className="text-al-body text-muted-foreground mt-1 max-w-xl">
              Every used vehicle stops at this gate. Nothing reaches service, detail, or the lot
              until you release it.
            </p>
          </div>
          <div className="flex items-center gap-4 shrink-0">
            <div className="text-right">
              <p className="text-[44px] leading-none font-bold tabular-nums text-foreground">
                {metrics.awaitingAuthorization}
              </p>
              <p className="text-al-meta text-muted-foreground mt-1">
                {usedTotal > 0
                  ? `${awaitingShare}% of ${usedTotal} used vehicles`
                  : "vehicles at the gate"}
              </p>
            </div>
            <Status status={metrics.awaitingAuthorization > 0 ? "NEEDS_REVIEW" : "READY"} />
          </div>
        </div>

        {metrics.awaitingAuthorization > 0 && (
          <Link to="/get-ready-command" className={cn(BTN_PRIMARY, "mt-4")}>
            Review the intake queue
            <ChevronRight className="w-4 h-4" aria-hidden="true" />
          </Link>
        )}

        <div className="mt-4">
          {awaiting.length === 0 ? (
            <EmptyState
              Icon={CheckCircle2}
              title={
                metrics.awaitingAuthorization > 0
                  ? "The intake queue is larger than this page lists."
                  : "No vehicles are waiting for manager approval."
              }
              detail={
                metrics.awaitingAuthorization > 0
                  ? "Open the intake queue to work through every vehicle at the gate."
                  : "New arrivals land here after nightly ingest. When one does, it appears at the top of this page."
              }
            />
          ) : (
            <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
              {awaiting.slice(0, 8).map((l) => {
                const v = vehicleById.get(l.vehicleId);
                const waited = l.stateChangedAt ? (now - new Date(l.stateChangedAt).getTime()) / 36e5 : 0;
                return (
                  <li key={l.vehicleId} className="flex flex-wrap items-center gap-3 p-3.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-al-card text-foreground truncate">{v?.ymm || "Vehicle"}</p>
                      <p className="font-mono text-al-meta text-muted-foreground">
                        &hellip;{l.vin.slice(-8)} &middot; waiting {durationLabel(waited)}
                        {v?.price != null ? ` · ${money(v.price)}` : ""}
                      </p>
                    </div>
                    <Status status="NEEDS_REVIEW" />
                    <Link to={`/get-ready-command/${l.vehicleId}`} className={cn(BTN_SECONDARY, "shrink-0")}>
                      Review
                    </Link>
                  </li>
                );
              })}
              {awaiting.length > 8 && (
                <li className="p-3.5 text-al-meta text-muted-foreground">
                  {awaiting.length - 8} more in the intake queue.
                </li>
              )}
            </ul>
          )}
        </div>
      </section>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <CommandStatCard
          label="Service decisions"
          value={requests.length}
          sub="Additional work awaiting you"
          Icon={Wrench}
          tone={requests.length > 0 ? "amber" : "slate"}
        />
        <CommandStatCard
          label="Recon approvals"
          value={reconPending.length}
          sub="Estimates awaiting a decision"
          Icon={Receipt}
          tone={reconPending.length > 0 ? "amber" : "slate"}
        />
        <CommandStatCard
          label="Vehicles stuck"
          value={stuck.length}
          sub={`Over ${durationLabel(stuckThresholdHours)} in one stage`}
          Icon={PauseCircle}
          tone={stuck.length > 0 ? "red" : "slate"}
        />
        <CommandStatCard
          label="Retail ready"
          value={metrics.retailReady}
          sub={`${metrics.gated} still gated`}
          Icon={ShieldCheck}
          tone={metrics.retailReady > 0 ? "emerald" : "slate"}
        />
      </div>

      {/* 2 — Service decisions. */}
      <CommandCard
        title="Service decisions"
        subtitle="Additional-work requests from the shop that need your approval."
        action={
          requests.length > 0 ? (
            <Link to="/service/approvals" className={BTN_SECONDARY}>Open approvals</Link>
          ) : undefined
        }
      >
        {requests.length === 0 ? (
          <EmptyState
            Icon={CheckCircle2}
            title="No service requests are waiting on a decision."
            detail="When a technician asks for additional work, the request and its estimate land here."
          />
        ) : (
          <ul className="divide-y divide-border">
            {requests.slice(0, 8).map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-al-card text-foreground truncate">{r.ymm || "Vehicle"}</p>
                  <p className="text-al-meta text-muted-foreground truncate">
                    {r.workRequested || "Additional work"}
                    {r.requestedBy ? ` · requested by ${r.requestedBy}` : ""}
                  </p>
                </div>
                <p className="text-al-card tabular-nums text-foreground shrink-0">{money(r.estTotal)}</p>
                {r.isSafety && <StatusPill tone="red">Safety</StatusPill>}
                <Status status={r.status === "clarify" ? "WAITING" : "NEEDS_REVIEW"} />
                <Link to="/service/approvals" className={cn(BTN_SECONDARY, "shrink-0")}>Decide</Link>
              </li>
            ))}
          </ul>
        )}
      </CommandCard>

      {/* 3 — Recon approvals. */}
      <CommandCard
        title="Recon approvals"
        subtitle="Reconditioning estimates submitted for your decision."
        action={
          reconPending.length > 0 ? (
            <Link to="/recon" className={BTN_SECONDARY}>Open recon board</Link>
          ) : undefined
        }
      >
        {reconPending.length === 0 ? (
          <EmptyState
            Icon={CheckCircle2}
            title="No recon estimates are waiting for approval."
            detail="Estimates submitted by service or seeded at ingest appear here until you approve or decline them."
          />
        ) : (
          <ul className="divide-y divide-border">
            {reconPending.slice(0, 8).map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-al-card text-foreground truncate">{e.ymm || "Vehicle"}</p>
                  <p className="font-mono text-al-meta text-muted-foreground">
                    &hellip;{String(e.vin || "").slice(-8)}
                    {e.submitted_by ? ` · ${e.submitted_by}` : ""}
                  </p>
                </div>
                <p className="text-al-card tabular-nums text-foreground shrink-0">{money(Number(e.subtotal || 0))}</p>
                <Status status="NEEDS_REVIEW" />
                <Link to="/recon" className={cn(BTN_SECONDARY, "shrink-0")}>Review</Link>
              </li>
            ))}
          </ul>
        )}
      </CommandCard>

      {/* 4 — Vehicles stuck. */}
      <CommandCard
        title="Vehicles stuck"
        subtitle={`Used vehicles sitting in one lifecycle stage longer than ${durationLabel(stuckThresholdHours)}.`}
      >
        {stuck.length === 0 ? (
          <EmptyState
            Icon={CheckCircle2}
            title="No vehicles are stuck in a stage."
            detail={`Every used vehicle has moved stage within the last ${durationLabel(stuckThresholdHours)}.`}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-al-body">
              <caption className="sr-only">Used vehicles stuck in a lifecycle stage</caption>
              <thead>
                <tr className="text-al-meta uppercase tracking-[0.12em] text-muted-foreground border-b border-border">
                  <th scope="col" className="text-left font-bold py-2 pr-3">Vehicle</th>
                  <th scope="col" className="text-left font-bold py-2 pr-3">Current stage</th>
                  <th scope="col" className="text-left font-bold py-2 pr-3">Time in stage</th>
                  <th scope="col" className="text-left font-bold py-2 pr-3">Current owner</th>
                  <th scope="col" className="text-left font-bold py-2 pr-3">Primary blocker</th>
                  <th scope="col" className="text-right font-bold py-2 pr-3">Cost awaiting approval</th>
                  <th scope="col" className="text-right font-bold py-2">Next action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {stuck.slice(0, 25).map((r) => (
                  <tr key={r.vehicleId}>
                    <td className="py-2.5 pr-3 align-top">
                      <p className="text-foreground font-semibold">{r.ymm}</p>
                      <p className="font-mono text-al-meta text-muted-foreground">&hellip;{r.vin.slice(-8)}</p>
                    </td>
                    <td className="py-2.5 pr-3 align-top">
                      <div className="flex flex-col gap-1 items-start">
                        <span className="text-foreground">{STATE_LABEL[r.state] || r.state}</span>
                        <Status status={STATE_STATUS[r.state] || "WAITING"} />
                      </div>
                    </td>
                    <td className="py-2.5 pr-3 align-top tabular-nums text-foreground whitespace-nowrap">
                      {durationLabel(r.hoursInState)}
                    </td>
                    <td className="py-2.5 pr-3 align-top text-muted-foreground">{r.owner}</td>
                    <td className="py-2.5 pr-3 align-top text-muted-foreground">{r.blocker}</td>
                    <td className="py-2.5 pr-3 align-top text-right tabular-nums text-foreground whitespace-nowrap">
                      {money(r.cost)}
                    </td>
                    <td className="py-2.5 align-top text-right">
                      <Link to={r.next.href} className={BTN_SECONDARY}>{r.next.label}</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {stuck.length > 25 && (
              <p className="text-al-meta text-muted-foreground pt-3">
                Showing the 25 longest-standing of {stuck.length}.
              </p>
            )}
          </div>
        )}
      </CommandCard>

      {/* 5 — Aging inventory. */}
      <CommandCard
        title="Aging inventory"
        subtitle="Days in stock for active used inventory, oldest first."
        action={<Link to="/inventory" className={BTN_SECONDARY}>Open inventory</Link>}
      >
        {aging.rows.length === 0 ? (
          <EmptyState
            Icon={Clock}
            title="No active used inventory to age."
            detail="Vehicles appear here once they are in stock with an intake date on file."
          />
        ) : (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              {aging.buckets.map((b) => (
                <div key={b.label} className="rounded-2xl border border-border bg-card p-3">
                  <p className="text-al-meta text-muted-foreground">{b.label}</p>
                  <p className="text-[22px] font-bold tabular-nums leading-none text-foreground mt-1.5">{b.count}</p>
                </div>
              ))}
            </div>
            <ul className="divide-y divide-border">
              {aging.rows.slice(0, 8).map(({ v, days }) => (
                <li key={v.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-al-card text-foreground truncate">{v.ymm}</p>
                    <p className="font-mono text-al-meta text-muted-foreground">
                      &hellip;{v.vin.slice(-8)}
                      {v.mileage != null ? ` · ${v.mileage.toLocaleString("en-US")} mi` : ""}
                      {v.price != null ? ` · ${money(v.price)}` : ""}
                    </p>
                  </div>
                  <p className="text-al-body tabular-nums text-foreground shrink-0">{days} days in stock</p>
                  {days > 90 && <Status status="STALE" />}
                </li>
              ))}
            </ul>
          </>
        )}
      </CommandCard>

      {/* 6 — Price exceptions. */}
      <CommandCard
        title="Price exceptions"
        subtitle="Published used vehicles whose sticker disagrees with the advertised price on file."
        action={<Link to="/inventory" className={BTN_SECONDARY}>Open inventory</Link>}
      >
        {priceExceptions.drift.length === 0 ? (
          <EmptyState
            Icon={Tag}
            title="No price exceptions on published used inventory."
            detail={
              priceExceptions.untracked > 0
                ? `${priceExceptions.untracked} published ${priceExceptions.untracked === 1 ? "vehicle has" : "vehicles have"} no advertised price captured, so drift cannot be checked for them.`
                : "Every published used vehicle matches its captured advertised price."
            }
          />
        ) : (
          <>
            <ul className="divide-y divide-border">
              {priceExceptions.drift.slice(0, 8).map(({ vehicle, advertised, sticker, delta }) => (
                <li key={vehicle.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-al-card text-foreground truncate">{vehicle.ymm}</p>
                    <p className="font-mono text-al-meta text-muted-foreground">&hellip;{vehicle.vin.slice(-8)}</p>
                  </div>
                  <p className="text-al-meta text-muted-foreground shrink-0">
                    Sticker {money(sticker)} &middot; advertised {money(advertised)}
                  </p>
                  <p className="text-al-card tabular-nums text-foreground shrink-0">
                    {delta > 0 ? "+" : "-"}{money(Math.abs(delta))}
                  </p>
                  <Status status="NEEDS_REVIEW" />
                </li>
              ))}
            </ul>
            {priceExceptions.untracked > 0 && (
              <p className="text-al-meta text-muted-foreground pt-3">
                {priceExceptions.untracked} published {priceExceptions.untracked === 1 ? "vehicle has" : "vehicles have"} no
                advertised price captured and is not counted above.
              </p>
            )}
          </>
        )}
      </CommandCard>

      {/* 7 — Retail-readiness blockers. */}
      <CommandCard
        title="Retail-readiness blockers"
        subtitle="Stored delivery clearance for used inventory that is not cleared."
        action={<Link to="/ready-board" className={BTN_SECONDARY}>Open ready board</Link>}
      >
        {blockers.length === 0 ? (
          <EmptyState
            Icon={ShieldCheck}
            title="No used vehicle is blocked from delivery."
            detail="Delivery clearance is stored per vehicle. Anything not cleared for delivery would be listed here."
          />
        ) : (
          <ul className="divide-y divide-border">
            {blockers.slice(0, 10).map(({ clearance, vehicle }) => {
              const count = clearance.reasonCodes.length;
              return (
                <li key={clearance.vin} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-al-card text-foreground truncate">{vehicle?.ymm || "Vehicle"}</p>
                    <p className="text-al-meta text-muted-foreground truncate">
                      {count > 0
                        ? clearance.reasonCodes.map(clearanceReasonLabel).join(" · ")
                        : "Clearance not granted"}
                    </p>
                  </div>
                  <Status
                    status="NOT_READY"
                    suffix={count > 0 ? `${count} ${count === 1 ? "BLOCKER" : "BLOCKERS"}` : undefined}
                  />
                  <Link
                    to={`/service/vehicle/${encodeURIComponent(clearance.vin)}`}
                    className={cn(BTN_SECONDARY, "shrink-0")}
                  >
                    Open
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </CommandCard>
    </div>
  );
}
