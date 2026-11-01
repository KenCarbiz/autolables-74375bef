import { useMemo, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { useViewFixture } from "@/lib/admin/dataSource";
import { Al97Frame, Banner, Metrics, useFixtureCopy, type MetricItem } from "@/components/admin/al97/al97ui";
import { loadSnapshot, lookupVehicle, replayInbox, resolveReappearance, setTenantSetting } from "@/lib/vehicleHistory/api";
import { countLabel, NOT_INSTALLED_BANNER } from "@/lib/vehicleHistory/labels";
import type { Snapshot, VehicleLookup, VehicleRecordsActions } from "@/lib/vehicleHistory/types";
import SearchSection from "./vehicleRecords/SearchSection";
import LifecycleSection from "./vehicleRecords/LifecycleSection";
import ServiceSection from "./vehicleRecords/ServiceSection";
import SyncSection from "./vehicleRecords/SyncSection";
import SettingsSection from "./vehicleRecords/SettingsSection";
import { fixtureActions } from "./vehicleRecords/fixtureActions";
import "./vehicleRecords/vehicleRecords.css";

// Vehicle records and lifecycle. Every read is tenant-scoped and every write
// is a server RPC that re-checks the caller; the page never edits a table.
// The tables are proposed, so a missing relation is shown as not installed
// and every count as Unknown, never as zero.

export type VehicleRecordsStatus = "loading" | "error" | "missing" | "ready";

export interface VehicleRecordsFixture {
  account: string;
  store: string | null;
  status: VehicleRecordsStatus;
  canManage: boolean;
  snapshot: Snapshot | null;
  vehicles: VehicleLookup[];
  stockByVin: Record<string, string>;
}

export interface VehicleRecordsScreenProps {
  account: string;
  store: string | null;
  status: VehicleRecordsStatus;
  canManage: boolean;
  snapshot: Snapshot | null;
  actions: VehicleRecordsActions;
  onChanged: () => void;
}

const VIEWS = [
  { id: "search", label: "Vehicle files search" },
  { id: "lifecycle", label: "Lifecycle and returns" },
  { id: "service", label: "Service and MPI" },
  { id: "sync", label: "Sync activity and exceptions" },
  { id: "settings", label: "Settings" },
] as const;
type ViewId = (typeof VIEWS)[number]["id"];

const SUBTITLE = "Custody episodes, service visits and returns stay with the vehicle. A sold or archived vehicle is a state, never a deletion.";

function metricItems(status: VehicleRecordsStatus, snapshot: Snapshot | null): MetricItem[] {
  const c = status === "ready" ? snapshot?.counts ?? null : null;
  const why = status === "missing" ? "Not installed" : status === "loading" ? "Reading" : "Read failed";
  const one = (label: string, n: number | null | undefined, sub: string, icon: MetricItem["icon"], plus = false): MetricItem =>
    typeof n === "number" ? { label, value: `${countLabel(n)}${plus ? "+" : ""}`, sub, icon } : { label, value: "Unknown", sub: c ? "Read failed" : why, icon, known: false };
  return [
    one("Vehicles with history", c?.vehicles, "At least one custody episode", "car", c?.vehiclesAtLeast),
    one("Open returns to review", c?.openReturns, "Vehicles seen again", "history"),
    one("Service events awaiting a match", c?.awaitingMatch, "Held, unmatched or quarantined", "warning"),
    one("Sync dead letters", c?.deadLetters, "Events that ran out of retries", "database"),
  ];
}

export function VehicleRecordsScreen({ account, store, status, canManage, snapshot, actions, onChanged }: VehicleRecordsScreenProps) {
  const copy = useFixtureCopy();
  const [params] = useSearchParams();
  const requested = params.get("view");
  const view: ViewId = VIEWS.some((v) => v.id === requested) ? (requested as ViewId) : "search";
  const installed = status !== "missing";
  const s = status === "ready" ? snapshot : null;

  const frame = (main: ReactNode) => (
    <Al97Frame crumb="Vehicle records & lifecycle" title="Vehicle records & lifecycle" subtitle={SUBTITLE} scopeLabel={{ account, store }} main={main} />
  );

  if (status === "loading") {
    return frame(<div className="work" aria-busy="true"><Banner tone="blue" icon="info" title="Reading vehicle records" detail="Counts show once the records answer." /></div>);
  }

  const synthetic = copy("vr.synthetic", "");
  const common = { canManage, actions, onChanged };

  return frame(
    <div className="work">
      {synthetic && <p className="vr-fixture-note">{synthetic}</p>}
      {status === "missing" && <Banner tone="blue" icon="info" title={NOT_INSTALLED_BANNER} detail="Nothing here is empty or healthy; it simply is not there yet. Counts show Unknown." />}
      {status === "error" && <Banner tone="red" icon="warning" title="Vehicle records could not be read" detail="This is a read failure, not an empty record. Nothing is shown as missing or healthy." />}
      {!canManage && status !== "missing" && <Banner tone="amber" icon="info" title="Read-only for your role" detail="Only account owners and admins can decide returns, replay events or change settings, so those buttons are hidden." />}
      <Metrics label="Vehicle record counts" items={metricItems(status, snapshot)} />
      <nav aria-label="Vehicle records views" className="tabs">
        {VIEWS.map((v) => (
          <Link key={v.id} to={{ search: `?view=${v.id}` }} replace aria-current={v.id === view ? "page" : undefined}>{v.label}</Link>
        ))}
      </nav>
      {view === "search" && <SearchSection actions={actions} installed={installed} />}
      {view === "lifecycle" && <LifecycleSection {...common} installed={installed} reviews={s?.reviews ?? null} />}
      {view === "service" && <ServiceSection installed={installed} visits={s?.visits ?? null} inspections={s?.inspections ?? []} repairs={s?.repairs ?? []} />}
      {view === "sync" && <SyncSection {...common} installed={installed} inbox={s?.inbox ?? null} inboxCounts={s?.inboxCounts ?? null} quarantine={s?.quarantine ?? null} replayCap={s?.replayCap ?? null} />}
      {view === "settings" && <SettingsSection {...common} installed={installed} settings={s?.settings ?? null} />}
    </div>,
  );
}

function LiveVehicleRecords() {
  const { tenant } = useTenant();
  const { isAdmin } = useAuth();
  const { member } = useEntitlements();
  const qc = useQueryClient();
  const tenantId = tenant?.id ?? null;
  const key = ["vehicle-records", tenantId];
  const q = useQuery({ queryKey: key, queryFn: () => loadSnapshot(tenantId!), enabled: !!tenantId });
  const canManage = isAdmin || member?.role === "owner" || member?.role === "admin";
  const actions = useMemo<VehicleRecordsActions>(() => ({
    lookup: (query) => (tenantId ? lookupVehicle(tenantId, query) : Promise.resolve({ kind: "error" as const })),
    resolveReview: resolveReappearance,
    replay: (ids, reason) => replayInbox(tenantId!, ids, reason),
    saveSetting: (k, value, version, reason) => setTenantSetting(tenantId!, k, value, version, reason),
  }), [tenantId]);

  const status: VehicleRecordsStatus = !tenantId ? "error" : q.isLoading ? "loading" : q.isError || !q.data ? "error" : q.data.missing ? "missing" : "ready";
  return (
    <VehicleRecordsScreen
      account={tenant?.name ?? "This account"}
      store={null}
      status={status}
      canManage={canManage}
      snapshot={q.data ?? null}
      actions={actions}
      onChanged={() => { void qc.invalidateQueries({ queryKey: key }); }}
    />
  );
}

export default function VehicleRecordsPage() {
  const fx = useViewFixture<VehicleRecordsFixture>("vehicle-records");
  const actions = useMemo(() => (fx ? fixtureActions(fx.vehicles, fx.stockByVin) : null), [fx]);
  return fx && actions
    ? <VehicleRecordsScreen account={fx.account} store={fx.store} status={fx.status} canManage={fx.canManage} snapshot={fx.snapshot} actions={actions} onChanged={() => undefined} />
    : <LiveVehicleRecords />;
}
