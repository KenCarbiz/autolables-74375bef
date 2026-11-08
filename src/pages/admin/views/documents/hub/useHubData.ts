import { useMemo } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useTenant } from "@/contexts/TenantContext";
import { useViewFixture } from "@/lib/admin/dataSource";
import { useWaveCVariant } from "@/pages/admin/views/publishing/waveCVariant";
import { hasDerivedFilter, type HubFilters } from "@/lib/admin/documentsHubModel";
import { HubReadError, liveDb, loadHubPage, loadSnapshot, loadVehicleHistory, pageFromRows, snapshotRows, type HubPage, type HubRow, type HubSnapshot, type VehicleHistory } from "./hubData";

export interface DocumentsHubFixture {
  rooftopLabel?: string;
  snapshot: HubSnapshot;
  history?: Record<string, VehicleHistory>;
}

export interface HubReadState {
  loading: boolean;
  error: { reason: "failed" | "incomplete"; message: string } | null;
  refetch: () => void;
}

const toError = (e: unknown): HubReadState["error"] => (e instanceof HubReadError ? { reason: e.reason, message: e.message } : e ? { reason: "failed", message: "The vehicle records could not be read." } : null);

function useTenantId(): string | null {
  const { tenant } = useTenant();
  return tenant?.id && tenant.id !== "house" ? tenant.id : null;
}

/** The ?state= variant applied to a fixture snapshot: empty, a failed read, or reads cut off by their caps. */
function useFixtureSnapshot(): { snapshot: HubSnapshot | null; variant: ReturnType<typeof useWaveCVariant>; fixture: DocumentsHubFixture | null } {
  const fixture = useViewFixture<DocumentsHubFixture>("documents-hub");
  const variant = useWaveCVariant(!!fixture);
  const snapshot = useMemo(() => {
    if (!fixture) return null;
    if (variant === "empty") return { ...fixture.snapshot, listings: [], docs: [], inspections: [], stock: {}, totalActive: 0, complete: true };
    if (variant === "blocked") return { ...fixture.snapshot, complete: false };
    return fixture.snapshot;
  }, [fixture, variant]);
  return { snapshot, variant, fixture };
}

export function useHubTable(filters: HubFilters, enabled: boolean): HubReadState & { page: HubPage | undefined } {
  const tenantId = useTenantId();
  const { snapshot, variant } = useFixtureSnapshot();
  const live = useQuery({
    queryKey: ["admin-v2", "documents-hub", "page", tenantId, filters],
    enabled: enabled && !snapshot && !!tenantId,
    queryFn: () => loadHubPage(liveDb(), tenantId as string, filters),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    retry: false,
  });
  const fixturePage = useMemo(() => {
    if (!snapshot) return null;
    if (variant === "error") return { error: new HubReadError("failed", "Vehicles could not be read.") };
    if (hasDerivedFilter(filters) && !snapshot.complete) return { error: new HubReadError("incomplete", "This dealership has more vehicles or records than the filters can resolve exactly. Clear the document, status and blocker filters, or narrow by search or condition.") };
    return { page: pageFromRows(snapshotRows(snapshot), filters) };
  }, [snapshot, variant, filters]);

  if (fixturePage) return { page: "page" in fixturePage ? fixturePage.page : undefined, loading: false, error: "error" in fixturePage ? toError(fixturePage.error) : null, refetch: () => undefined };
  if (!tenantId) return { page: undefined, loading: false, error: { reason: "failed", message: "No dealership is selected." }, refetch: () => undefined };
  return { page: live.data, loading: live.isLoading || (live.isFetching && !live.data), error: live.isError ? toError(live.error) : null, refetch: () => void live.refetch() };
}

export interface HubOverviewData extends HubReadState {
  rows: HubRow[] | undefined;
  complete: boolean;
}

export function useHubOverview(enabled: boolean): HubOverviewData {
  const tenantId = useTenantId();
  const { snapshot, variant } = useFixtureSnapshot();
  const live = useQuery({
    queryKey: ["admin-v2", "documents-hub", "snapshot", tenantId],
    enabled: enabled && !snapshot && !!tenantId,
    queryFn: async () => {
      const s = await loadSnapshot(liveDb(), tenantId as string);
      return { rows: snapshotRows(s), complete: s.complete };
    },
    staleTime: 60_000,
    retry: false,
  });
  const fixtureRows = useMemo(() => (snapshot ? snapshotRows(snapshot) : null), [snapshot]);
  if (snapshot && fixtureRows) {
    if (variant === "error") return { rows: undefined, complete: false, loading: false, error: { reason: "failed", message: "Vehicles could not be read." }, refetch: () => undefined };
    return { rows: fixtureRows, complete: snapshot.complete, loading: false, error: null, refetch: () => undefined };
  }
  if (!tenantId) return { rows: undefined, complete: false, loading: false, error: { reason: "failed", message: "No dealership is selected." }, refetch: () => undefined };
  return { rows: live.data?.rows, complete: live.data?.complete ?? false, loading: live.isLoading, error: live.isError ? toError(live.error) : null, refetch: () => void live.refetch() };
}

export interface VehicleHistoryState {
  history: VehicleHistory | undefined;
  loading: boolean;
  unavailable: boolean;
}

export function useVehicleHistory(vehicleId: string | null): VehicleHistoryState {
  const tenantId = useTenantId();
  const fixture = useViewFixture<DocumentsHubFixture>("documents-hub");
  const live = useQuery({
    queryKey: ["admin-v2", "documents-hub", "history", tenantId, vehicleId],
    enabled: !fixture && !!tenantId && !!vehicleId,
    queryFn: () => loadVehicleHistory(liveDb(), tenantId as string, vehicleId as string),
    staleTime: 30_000,
    retry: false,
  });
  if (fixture) return { history: vehicleId ? fixture.history?.[vehicleId] : undefined, loading: false, unavailable: !!vehicleId && !fixture.history?.[vehicleId] };
  return { history: live.data, loading: !!vehicleId && live.isLoading, unavailable: live.isError };
}
