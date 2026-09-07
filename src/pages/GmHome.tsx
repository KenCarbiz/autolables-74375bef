import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { useLeads } from "@/hooks/useLeads";
import { useOperatingMetrics } from "@/hooks/useOperatingMetrics";
import { useAdvertisedPrices, assessDrift } from "@/hooks/useAdvertisedPrices";
import { hasDealerCapability, type DealerCapability } from "@/lib/permissions/dealerRoleCapabilities";
import EmptyState from "@/components/ui/empty-state";
import {
  AlertTriangle, ArrowRight, CheckCircle2, ClipboardCheck, Clock, ShieldAlert, Users,
} from "lucide-react";

// A vehicle counts as stuck when its canonical lifecycle state has not moved
// for this long. Stated as a rule so the table never implies a judgement the
// data cannot support.
const STUCK_HOURS = 72;

// RETAIL_READY and REMOVED are terminal — a vehicle resting there is finished,
// not stalled, so ageing it would manufacture risk that does not exist.
const SETTLED_STATES = new Set(["RETAIL_READY", "REMOVED"]);

const BLOCKER_BY_STATE: Record<string, string> = {
  AWAITING_MANAGER_AUTHORIZATION: "Waiting on manager authorization",
  WAITING_FOR_MANAGER_DECISION: "Waiting on a work-authorization decision",
  RETURNED_FOR_CLARIFICATION: "Returned to the shop for clarification",
  PRELOAD_EXCEPTION: "Vehicle data preload failed",
  REPAIR_VERIFICATION_REQUIRED: "Repair needs verification",
  SERVICE_UNASSIGNED: "No technician assigned",
  DETAIL_PENDING: "Detail not started",
};

interface LifecycleRow {
  vehicle_id: string;
  vin: string;
  state: string;
  state_changed_at: string;
  state_changed_by: string | null;
  gate_reason: string | null;
}

interface ListingRow {
  id: string;
  vin: string | null;
  ymm: string | null;
  slug: string | null;
  status: string | null;
  price: number | null;
}

interface MemberRow {
  user_id: string | null;
  email: string | null;
  role: string | null;
}

interface ServiceRequestRow {
  id: string;
  vin: string;
  ymm: string | null;
  work_requested: string;
  est_total: number | null;
  is_safety: boolean;
  status: string;
  created_at: string;
  requested_by_name: string | null;
}

interface ReconEstimateRow {
  id: string;
  vin: string;
  ymm: string | null;
  subtotal: number | null;
  created_at: string;
  submitted_by: string | null;
}

interface ReturnRow {
  id: string;
  vin: string | null;
  signer_name: string | null;
  return_reason: string | null;
  return_requested_at: string | null;
}

interface ApprovalItem {
  id: string;
  kind: string;
  title: string;
  vehicle: string;
  detail: string;
  amount: number | null;
  at: string | null;
  href: string;
  urgent: boolean;
}

interface StuckRow {
  vehicleId: string;
  vin: string;
  vehicle: string;
  stage: string;
  hours: number;
  owner: string;
  blocker: string | null;
}

const money = (n: number) =>
  new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

const prettyState = (state: string) =>
  state.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase());

const hoursSince = (iso: string | null) => {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : (Date.now() - t) / 3_600_000;
};

const duration = (hours: number) => {
  if (hours < 24) return `${Math.max(0, Math.floor(hours))}h`;
  const d = Math.floor(hours / 24);
  const h = Math.floor(hours - d * 24);
  return h > 0 ? `${d}d ${h}h` : `${d}d`;
};

const shortDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—";

const GmHome = () => {
  const { user, isAdmin } = useAuth();
  const { tenant, currentStore } = useTenant();
  const { member } = useEntitlements();
  const can = (c: DealerCapability) => hasDealerCapability(member?.role, c, isAdmin);
  const canApproveService = can("can_approve_service_work");
  const canViewInventory = can("can_view_inventory");
  const canViewCompliance = can("can_view_compliance");
  const canViewGetReady = can("can_view_get_ready");

  const tenantId = tenant?.id && tenant.id !== "house" ? tenant.id : null;
  const storeId = currentStore?.id || "";

  const { metrics, loading: metricsLoading, error: metricsError } = useOperatingMetrics(tenantId);
  const { leads } = useLeads(storeId);
  const { byVin: advertisedByVin } = useAdvertisedPrices(storeId);

  const { data, isLoading } = useQuery({
    queryKey: ["gm-home", tenantId],
    enabled: !!tenantId,
    staleTime: 30_000,
    queryFn: async () => {
      // deno-lint-ignore no-explicit-any -- generated types don't cover these tables
      const db = supabase as any;
      const [svc, recon, returns, lifecycle, listings, members] = await Promise.all([
        db.from("service_requests")
          .select("id, vin, ymm, work_requested, est_total, is_safety, status, created_at, requested_by_name")
          .eq("tenant_id", tenantId).in("status", ["pending", "clarify"])
          .order("created_at", { ascending: true }).limit(50),
        db.from("recon_estimates")
          .select("id, vin, ymm, subtotal, created_at, submitted_by")
          .eq("tenant_id", tenantId).eq("status", "submitted")
          .order("created_at", { ascending: true }).limit(50),
        db.from("addendum_signings")
          .select("id, vin, signer_name, return_reason, return_requested_at")
          .eq("tenant_id", tenantId).eq("return_status", "requested")
          .order("return_requested_at", { ascending: true }).limit(50),
        db.from("vehicle_lifecycle")
          .select("vehicle_id, vin, state, state_changed_at, state_changed_by, gate_reason")
          .eq("tenant_id", tenantId).limit(1000),
        db.from("vehicle_listings")
          .select("id, vin, ymm, slug, status, price")
          .eq("tenant_id", tenantId).neq("status", "archived").limit(1000),
        db.rpc("list_tenant_members", { p_tenant_id: tenantId }),
      ]);
      return {
        service: (svc.data || []) as ServiceRequestRow[],
        recon: (recon.data || []) as ReconEstimateRow[],
        returns: (returns.data || []) as ReturnRow[],
        lifecycle: (lifecycle.data || []) as LifecycleRow[],
        listings: (listings.data || []) as ListingRow[],
        members: (members.data || []) as MemberRow[],
      };
    },
  });

  const listingById = useMemo(() => {
    const m = new Map<string, ListingRow>();
    for (const l of data?.listings || []) m.set(l.id, l);
    return m;
  }, [data?.listings]);

  const memberByUserId = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of data?.members || []) if (r.user_id && r.email) m.set(r.user_id, r.email);
    return m;
  }, [data?.members]);

  const priceDiscrepancies = useMemo(() => {
    const out: ApprovalItem[] = [];
    for (const l of data?.listings || []) {
      if (l.status !== "published" || !l.vin) continue;
      const a = assessDrift(l.price || 0, advertisedByVin.get(l.vin.toUpperCase()));
      if (a.status !== "drift") continue;
      out.push({
        id: `price-${l.id}`,
        kind: "Price discrepancy",
        title: "Sticker price does not match the advertised price",
        vehicle: l.ymm || `VIN ${l.vin.slice(-8)}`,
        detail: `${money(a.sticker)} on the sticker · ${a.delta > 0 ? "+" : ""}${money(a.delta)} against advertised`,
        amount: null,
        at: null,
        href: "/inventory",
        urgent: true,
      });
    }
    return out;
  }, [data?.listings, advertisedByVin]);

  const approvals = useMemo(() => {
    const out: ApprovalItem[] = [];
    if (canApproveService) {
      for (const r of data?.service || []) {
        out.push({
          id: `svc-${r.id}`,
          kind: "Service repair",
          title: r.work_requested,
          vehicle: r.ymm || `VIN ${r.vin.slice(-8)}`,
          detail: r.status === "clarify"
            ? `Returned for clarification${r.requested_by_name ? ` · ${r.requested_by_name}` : ""}`
            : `Requested${r.requested_by_name ? ` by ${r.requested_by_name}` : ""}`,
          amount: r.est_total,
          at: r.created_at,
          href: "/service/approvals",
          urgent: r.is_safety,
        });
      }
      for (const r of data?.recon || []) {
        out.push({
          id: `recon-${r.id}`,
          kind: "Recon estimate",
          title: "Recon estimate awaiting a decision",
          vehicle: r.ymm || `VIN ${r.vin.slice(-8)}`,
          detail: r.submitted_by ? `Submitted by ${r.submitted_by}` : "Submitted by the shop",
          amount: r.subtotal,
          at: r.created_at,
          href: "/recon",
          urgent: false,
        });
      }
    }
    if (canViewInventory) out.push(...priceDiscrepancies);
    if (canViewCompliance) {
      for (const r of data?.returns || []) {
        out.push({
          id: `ret-${r.id}`,
          kind: "Compliance decision",
          title: "Three-day return requested",
          vehicle: r.vin ? `VIN ${r.vin.slice(-8)}` : "Vehicle",
          detail: r.return_reason || `Requested by ${r.signer_name || "the buyer"}`,
          amount: null,
          at: r.return_requested_at,
          href: "/returns",
          urgent: true,
        });
      }
    }
    return out.sort((a, b) => Number(b.urgent) - Number(a.urgent) || (a.at || "").localeCompare(b.at || ""));
  }, [data?.service, data?.recon, data?.returns, priceDiscrepancies, canApproveService, canViewInventory, canViewCompliance]);

  const stuck = useMemo<StuckRow[]>(() => {
    const rows: StuckRow[] = [];
    for (const l of data?.lifecycle || []) {
      if (SETTLED_STATES.has(l.state)) continue;
      if (!listingById.has(l.vehicle_id)) continue;
      const hours = hoursSince(l.state_changed_at);
      if (hours < STUCK_HOURS) continue;
      const listing = listingById.get(l.vehicle_id);
      rows.push({
        vehicleId: l.vehicle_id,
        vin: l.vin,
        vehicle: listing?.ymm || `VIN ${(l.vin || "").slice(-8)}`,
        stage: prettyState(l.state),
        hours,
        owner: (l.state_changed_by && memberByUserId.get(l.state_changed_by)) || "Unassigned",
        blocker: l.gate_reason || BLOCKER_BY_STATE[l.state] || null,
      });
    }
    return rows.sort((a, b) => b.hours - a.hours);
  }, [data?.lifecycle, listingById, memberByUserId]);

  const openLeads = useMemo(
    () => leads.filter((l) => l.status === "new" || l.status === "contacted"),
    [leads],
  );

  const systemIssues = metrics.usedMissingLifecycle;
  const attention = approvals.length + stuck.length + systemIssues;

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 18) return "Good afternoon";
    return "Good evening";
  })();
  const first = user?.email?.split("@")[0].split(".")[0] || "there";
  const name = first.charAt(0).toUpperCase() + first.slice(1);

  const lifecycleStrip = [
    { label: "Intake", value: metrics.getReadyIntake, href: "/get-ready-command" },
    { label: "Service", value: metrics.getReadyService, href: "/service" },
    { label: "Recon", value: metrics.getReadyRecon, href: "/recon" },
    { label: "Prep", value: metrics.getReadyPrep, href: "/prep" },
    { label: "Verified", value: metrics.getReadyVerified, href: "/ready-board" },
    { label: "Ready", value: metrics.retailReady, href: "/inventory" },
  ];

  return (
    <div className="p-4 lg:p-6 max-w-[1600px] mx-auto space-y-5">
      <header className="rounded-2xl bg-card border border-border px-5 lg:px-6 py-5 shadow-sm">
        <p className="text-al-meta font-bold uppercase tracking-[0.18em] text-muted-foreground">
          {currentStore?.name || tenant?.name || "Your dealership"}
        </p>
        <h1 className="font-display text-al-page text-foreground mt-1">{greeting}, {name}.</h1>
        <p className="text-al-body text-muted-foreground mt-2">
          {isLoading || metricsLoading
            ? "Reading today's operating position…"
            : attention === 0
              ? "Nothing needs a decision from you right now."
              : `${attention} item${attention === 1 ? "" : "s"} need${attention === 1 ? "s" : ""} you today — ${approvals.length} awaiting a decision, ${stuck.length} vehicle${stuck.length === 1 ? "" : "s"} stuck, ${systemIssues} system issue${systemIssues === 1 ? "" : "s"}.`}
        </p>
        {metricsError && (
          <p className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-al-meta font-semibold text-amber-800">
            <AlertTriangle className="w-3.5 h-3.5" strokeWidth={2} />
            Operating counts are unavailable: {metricsError}
          </p>
        )}
      </header>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
        <SummaryTile
          label="Needs decision"
          value={approvals.length}
          caption={approvals.length === 1 ? "approval waiting" : "approvals waiting"}
          icon={ClipboardCheck}
          alert={approvals.length > 0}
        />
        <SummaryTile
          label="Vehicles at risk"
          value={stuck.length}
          caption={`no stage change in ${STUCK_HOURS / 24}+ days`}
          icon={AlertTriangle}
          alert={stuck.length > 0}
        />
        <SummaryTile
          label="Customer opportunities"
          value={openLeads.length}
          caption={openLeads.length === 1 ? "open lead" : "open leads"}
          icon={Users}
          alert={false}
        />
        <SummaryTile
          label="System issues"
          value={systemIssues}
          caption={systemIssues === 0 ? "no data defects" : "used vehicles missing a lifecycle row"}
          icon={ShieldAlert}
          alert={systemIssues > 0}
        />
      </div>

      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-al-meta font-bold uppercase tracking-[0.18em] text-muted-foreground">
            My approvals
          </h2>
          {approvals.length > 0 && (
            <span className="text-al-meta font-semibold text-muted-foreground tabular-nums">
              {approvals.length} waiting
            </span>
          )}
        </div>
        {approvals.length === 0 ? (
          <EmptyState
            compact
            icon={CheckCircle2}
            title="Nothing is waiting on your signature"
            description="Service repairs, recon estimates, price discrepancies and compliance decisions land here the moment they are raised."
          />
        ) : (
          <div className="rounded-2xl border border-border bg-card divide-y divide-border overflow-hidden">
            {approvals.map((a) => (
              <Link
                key={a.id}
                to={a.href}
                className="group flex items-start gap-3 px-4 py-3.5 hover:bg-muted/40 transition-colors"
              >
                <span className={`mt-0.5 shrink-0 inline-flex h-6 items-center rounded-md px-2 text-al-meta font-bold uppercase tracking-[0.1em] ${
                  a.urgent ? "bg-rose-100 text-rose-700" : "bg-muted text-muted-foreground"
                }`}>
                  {a.kind}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-al-card text-foreground truncate">{a.title}</p>
                  <p className="text-al-meta text-muted-foreground mt-0.5 truncate">
                    {a.vehicle} · {a.detail}
                    {a.at ? ` · ${shortDate(a.at)}` : ""}
                  </p>
                </div>
                {a.amount !== null && a.amount > 0 && (
                  <span className="shrink-0 text-al-card tabular-nums text-foreground">{money(a.amount)}</span>
                )}
                <ArrowRight className="w-4 h-4 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity mt-0.5" />
              </Link>
            ))}
          </div>
        )}
      </section>

      {canViewInventory && (
        <section>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-al-meta font-bold uppercase tracking-[0.18em] text-muted-foreground">
              Vehicles stuck
            </h2>
            <span className="text-al-meta text-muted-foreground">
              No lifecycle change in {STUCK_HOURS / 24}+ days
            </span>
          </div>
          {stuck.length === 0 ? (
            <EmptyState
              compact
              icon={Clock}
              title="No vehicle has been sitting in one stage"
              description={`Every vehicle with a lifecycle record moved stage inside the last ${STUCK_HOURS / 24} days.`}
            />
          ) : (
            <div className="rounded-2xl border border-border bg-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-al-body">
                  <thead className="bg-muted/40 text-al-meta uppercase tracking-[0.14em] text-muted-foreground">
                    <tr>
                      <th className="text-left px-4 py-2 font-bold">Vehicle</th>
                      <th className="text-left px-4 py-2 font-bold">Stage</th>
                      <th className="text-left px-4 py-2 font-bold">Time in stage</th>
                      <th className="text-left px-4 py-2 font-bold">Owner</th>
                      <th className="text-left px-4 py-2 font-bold">Blocker</th>
                      <th className="text-right px-4 py-2 font-bold">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {stuck.slice(0, 25).map((r) => (
                      <tr key={r.vehicleId} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3">
                          <p className="text-al-card text-foreground">{r.vehicle}</p>
                          <p className="text-al-meta text-muted-foreground font-mono">…{(r.vin || "").slice(-8)}</p>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{r.stage}</td>
                        <td className="px-4 py-3 tabular-nums whitespace-nowrap text-foreground">{duration(r.hours)}</td>
                        <td className="px-4 py-3 text-muted-foreground truncate max-w-[180px]">{r.owner}</td>
                        <td className="px-4 py-3 text-muted-foreground">
                          {r.blocker || <span className="text-muted-foreground/70">No blocker recorded</span>}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Link
                            to={`/vin-command/${r.vehicleId}`}
                            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border text-al-meta font-semibold text-foreground hover:bg-muted transition-colors"
                          >
                            Review
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {stuck.length > 25 && (
                <p className="px-4 py-2.5 text-al-meta text-muted-foreground border-t border-border">
                  Showing the 25 longest-standing of {stuck.length}.
                </p>
              )}
            </div>
          )}
        </section>
      )}

      {canViewGetReady && (
        <section>
          <h2 className="text-al-meta font-bold uppercase tracking-[0.18em] text-muted-foreground mb-2">
            Lifecycle
          </h2>
          <div className="rounded-2xl border border-border bg-card grid grid-cols-3 md:grid-cols-6 divide-x divide-y md:divide-y-0 divide-border overflow-hidden">
            {lifecycleStrip.map((s) => (
              <Link key={s.label} to={s.href} className="px-4 py-3.5 hover:bg-muted/40 transition-colors">
                <p className="text-al-meta font-bold uppercase tracking-[0.14em] text-muted-foreground">{s.label}</p>
                <p className={`font-display text-2xl tabular-nums leading-none mt-1.5 ${s.value === 0 ? "text-muted-foreground" : "text-foreground"}`}>
                  {s.value}
                </p>
              </Link>
            ))}
          </div>
          <p className="text-al-meta text-muted-foreground mt-2">
            Unique vehicles, from the canonical operating metrics. Recon is counted from open estimates and
            overlaps the Service stage, so the strip is not a total.
          </p>
        </section>
      )}
    </div>
  );
};

interface SummaryTileProps {
  label: string;
  value: number;
  caption: string;
  icon: typeof Users;
  alert: boolean;
}

const SummaryTile = ({ label, value, caption, icon: Icon, alert }: SummaryTileProps) => (
  <div className={`rounded-2xl border bg-card p-5 flex flex-col gap-2 ${alert ? "border-amber-200" : "border-border"}`}>
    <div className="flex items-start justify-between gap-2">
      <p className="text-al-meta font-bold uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <span className={`w-8 h-8 rounded-lg inline-flex items-center justify-center ${
        alert ? "bg-amber-100 text-amber-700" : "bg-muted text-muted-foreground"
      }`}>
        <Icon className="w-4 h-4" strokeWidth={2.25} />
      </span>
    </div>
    <p className="font-display text-[32px] lg:text-[36px] font-bold tabular-nums leading-none text-foreground">
      {value}
    </p>
    <p className="text-al-meta text-muted-foreground">{caption}</p>
  </div>
);

export default GmHome;
