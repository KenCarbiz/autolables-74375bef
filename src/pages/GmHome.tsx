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
import {
  PageBody, PageHeader, SectionHeading, MetricStrip, QueryState, LinkButton, Panel, WorkTable, Th, Td, InlineNote,
} from "@/components/product";

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
  scrape_last_synced_at?: string | null;
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
  owner: string;
  next: string;
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
          .select("id, vin, ymm, slug, status, price, scrape_last_synced_at")
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
        href: `/vehicle-file/${l.id}`,
        urgent: true,
        owner: "Unassigned",
        next: "Review price",
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
          href: `/service/vehicle/${encodeURIComponent(r.vin)}`,
          urgent: r.is_safety,
          owner: r.requested_by_name || "Unassigned",
          next: r.status === "clarify" ? "Review clarification" : "Decide repair",
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
          href: `/service/vehicle/${encodeURIComponent(r.vin)}`,
          urgent: false,
          owner: r.submitted_by || "Shop",
          next: "Decide estimate",
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
          owner: r.signer_name || "Buyer",
          next: "Decide return",
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

  // One ranked list: urgent decisions first, then the longest-waiting item of
  // either kind. Bounded to eight so the page is a worklist, not a log.
  const TODAY_LIMIT = 8;
  const ranked = useMemo(() => {
    const rows = [
      ...approvals.map((a) => ({
        id: a.id,
        urgent: a.urgent,
        age: a.at ? hoursSince(a.at) : 0,
        kind: a.kind,
        vehicle: a.vehicle,
        issue: a.title,
        detail: a.detail,
        owner: a.owner,
        next: a.next,
        href: a.href,
        amount: a.amount,
      })),
      ...(canViewInventory
        ? stuck.map((r) => ({
            id: `stuck-${r.vehicleId}`,
            urgent: false,
            age: r.hours,
            kind: "Stuck vehicle",
            vehicle: r.vehicle,
            issue: r.stage,
            detail: r.blocker || "No blocker recorded",
            owner: r.owner,
            next: "Open vehicle",
            href: `/vin-command/${r.vehicleId}`,
            amount: null as number | null,
          }))
        : []),
    ];
    return rows.sort((a, b) => Number(b.urgent) - Number(a.urgent) || b.age - a.age);
  }, [approvals, stuck, canViewInventory]);
  const shown = ranked.slice(0, TODAY_LIMIT);

  // Feed freshness is read from the listings already loaded. It is a reading
  // only: nothing here starts a provider sync.
  const feedNote = useMemo(() => {
    const stamps = (data?.listings || [])
      .map((l) => (l.scrape_last_synced_at ? Date.parse(l.scrape_last_synced_at) : NaN))
      .filter((t) => !Number.isNaN(t));
    if (!data || stamps.length === 0) return null;
    const newest = Math.max(...stamps);
    const hours = (Date.now() - newest) / 3_600_000;
    return hours > 24 ? { hours, at: new Date(newest) } : null;
  }, [data]);

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

  const reading = isLoading || metricsLoading;
  const readFailed = !reading && !!tenantId && !data;
  const scopeName = currentStore?.name || tenant?.name || "Your dealership";

  return (
    <PageBody width="wide">
      <PageHeader
        title="Today"
        description={
          reading
            ? "Reading today's operating position..."
            : attention === 0
              ? "Nothing needs a decision from you right now."
              : `${greeting}, ${name}. ${attention} item${attention === 1 ? "" : "s"} need${attention === 1 ? "s" : ""} you today: ${approvals.length} awaiting a decision, ${stuck.length} vehicle${stuck.length === 1 ? "" : "s"} stuck, ${systemIssues} system issue${systemIssues === 1 ? "" : "s"}.`
        }
        meta={reading ? undefined : `Last updated ${new Date().toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}`}
      />

      {metricsError && (
        <InlineNote tone="warning" title="Operating counts are unavailable">{metricsError}</InlineNote>
      )}

      {feedNote && (
        <InlineNote
          tone="warning"
          title="Inventory feed may be stale"
          action={<LinkButton to="/admin?tab=inventory-feed" size="sm">Review feed health</LinkButton>}
        >
          Newest listing sync {feedNote.at.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}, {feedNote.hours < 48 ? `${Math.floor(feedNote.hours)} hours ago` : `${Math.floor(feedNote.hours / 24)} days ago`}. Some data may be out of date.
        </InlineNote>
      )}

      <MetricStrip
        allBars
        label="Today at a glance"
        action={canViewInventory ? <LinkButton to="#today-work" variant="primary">Review work</LinkButton> : undefined}
        metrics={[
          { label: "Needs decision", value: reading ? null : approvals.length, hint: "Awaiting authorization", loading: reading, tone: approvals.length > 0 ? "warning" : "neutral" },
          { label: "Vehicles at risk", value: reading ? null : stuck.length, hint: "Stuck in a stage", loading: reading, tone: stuck.length > 0 ? "warning" : "neutral" },
          { label: "Customer opportunities", value: openLeads.length, hint: "Open leads" },
          { label: "System issues", value: metricsError ? null : systemIssues, hint: "Exceptions and blockers", loading: metricsLoading, tone: systemIssues > 0 ? "danger" : "neutral" },
        ]}
      />

      <section id="today-work" aria-label="Work for today" className="flex flex-col gap-3">
        <QueryState
          status={reading ? "loading" : readFailed ? "error" : ranked.length === 0 ? "empty" : "ready"}
          errorTitle="Today's work could not be read."
          errorDetail="Nothing is being shown as clear. Reload to try again."
          emptyTitle="Nothing is waiting on you"
          emptyDetail="Service repairs, recon estimates, price discrepancies, stuck vehicles and compliance decisions appear here when they are raised."
        >
          <WorkTable caption="Ranked work for today" minWidth={900}>
            <thead>
              <tr>
                <Th>Rank</Th>
                <Th>Type</Th>
                <Th>Vehicle</Th>
                <Th>Owner</Th>
                <Th>Issue / Next action</Th>
                <Th align="right">Age</Th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => (
                <tr key={r.id} className="h-12 hover:bg-adm-workspace">
                  <Td className="tabular-nums">
                    <span className={`inline-flex min-w-[24px] justify-center rounded-[2px] px-1.5 text-[12px] font-bold ${r.urgent ? (i === 0 ? "bg-adm-danger text-white" : "bg-[#D97706] text-white") : "bg-adm-workspace text-adm-muted"}`}>{i + 1}</span>
                  </Td>
                  <Td className="max-w-[160px] truncate text-adm-muted">{r.kind}</Td>
                  <Td className="max-w-[320px] truncate font-semibold text-adm-ink">{r.vehicle}</Td>
                  <Td className="max-w-[160px] truncate text-adm-muted">{r.owner}</Td>
                  <Td className="max-w-[380px] truncate">
                    <Link to={r.href} className="text-adm-primary hover:underline" title={r.issue}>{r.next}</Link>
                    <span className="text-adm-muted">{` - ${r.issue}`}</span>
                  </Td>
                  <Td align="right" className="whitespace-nowrap tabular-nums text-adm-muted">
                    {r.age > 0 ? duration(r.age) : "Unknown"}
                  </Td>
                </tr>
              ))}
            </tbody>
          </WorkTable>
          {ranked.length > shown.length && (
            <p className="px-1 text-[12px] leading-[18px] text-adm-muted">
              {ranked.length - shown.length} more open items. Service repairs are listed in{" "}
              <Link className="text-adm-primary underline" to="/service/approvals">Service approvals</Link>, recon in{" "}
              <Link className="text-adm-primary underline" to="/recon">Recon</Link>, and stuck vehicles in{" "}
              <Link className="text-adm-primary underline" to="/ready-board">Ready board</Link>.
            </p>
          )}
        </QueryState>
      </section>

      {canViewGetReady && (
        <section aria-labelledby="today-lifecycle" className="flex flex-col gap-3">
          <SectionHeading id="today-lifecycle" title="Lifecycle" />
          <Panel>
            <ul className="grid grid-cols-3 md:grid-cols-6 divide-x divide-y md:divide-y-0 divide-adm-border">
              {lifecycleStrip.map((s) => (
                <li key={s.label}>
                  <Link to={s.href} className="block min-h-[56px] px-4 py-3 hover:bg-adm-workspace">
                    <p className="text-[12px] leading-[18px] font-medium text-adm-muted">{s.label}</p>
                    <p className="text-[20px] leading-[28px] font-bold tabular-nums text-adm-ink">{metricsError ? "Unknown" : s.value}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
          <p className="text-[12px] leading-[18px] text-adm-muted">
            Unique vehicles, from the canonical operating metrics. Recon is counted from open estimates and
            overlaps the Service stage, so the strip is not a total.
          </p>
        </section>
      )}
    </PageBody>
  );
};

export default GmHome;
