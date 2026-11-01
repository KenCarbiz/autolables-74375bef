import { useQuery } from "@tanstack/react-query";
import { getPreviewInventory, listFeedJobs, listProviderUsage, listSnapshots, listSourceMappings, type FeedBinding, type FeedFile, type FeedRun, type GroupInventoryData, type InventoryFeedJob, type InventorySourceMapping, type InventoryStoreSnapshot, type StoreProviderUsage } from "@/lib/inventoryNetwork/api";
import { boardQueries } from "@/components/inventoryNetwork/MappingReviewBoard";
import { isPartitionReport } from "@/lib/inventoryNetwork/api";
import { useNetFixture } from "./al97ui";

export interface LedgerNeeds { jobs?: boolean; snapshots?: boolean; bindings?: boolean; files?: boolean; runs?: boolean; mappings?: string | null; usageStoreId?: string | null; previewStoreId?: string | null }

/** Each ledger is null until read, or when the read failed, so a screen can say Unknown. */
export interface Ledgers {
  jobs: InventoryFeedJob[] | null; snapshots: InventoryStoreSnapshot[] | null; bindings: FeedBinding[] | null; files: FeedFile[] | null;
  runs: FeedRun[] | null; mappings: InventorySourceMapping[] | null; usage: StoreProviderUsage[] | null; preview: GroupInventoryData | null | undefined;
  heartbeatAt: string | null; workerSchedule: "found" | "not_found" | null;
}

export function useLedgers(need: LedgerNeeds): Ledgers {
  const fx = useNetFixture();
  const live = !fx;
  const jobs = useQuery({ queryKey: ["inv-net", "jobs"], queryFn: () => listFeedJobs(100), enabled: live && !!need.jobs });
  const snapshots = useQuery({ queryKey: ["inv-net", "snapshots"], queryFn: () => listSnapshots(100), enabled: live && !!need.snapshots });
  const bindings = useQuery({ ...boardQueries.bindings, enabled: live && !!need.bindings });
  const files = useQuery({ ...boardQueries.files, enabled: live && !!need.files });
  const runs = useQuery({ ...boardQueries.runs, enabled: live && !!need.runs });
  const mappings = useQuery({ queryKey: ["inv-net", "mappings", need.mappings], queryFn: () => listSourceMappings(need.mappings!), enabled: live && !!need.mappings });
  const usage = useQuery({ queryKey: ["inv-net", "provider-usage", need.usageStoreId], queryFn: () => listProviderUsage(need.usageStoreId!), enabled: live && !!need.usageStoreId });
  const preview = useQuery({ queryKey: ["inv-net", "preview", need.previewStoreId, "customer_room"], queryFn: () => getPreviewInventory(need.previewStoreId!, "customer_room"), enabled: live && !!need.previewStoreId });
  if (fx) {
    return {
      jobs: fx.jobs ?? null, snapshots: fx.snapshots ?? null, bindings: fx.bindings ?? null, files: fx.files ?? null, runs: fx.runs ?? null,
      mappings: fx.mappings ?? null, usage: fx.providerUsage ?? null, preview: fx.preview, heartbeatAt: fx.heartbeatAt ?? null, workerSchedule: fx.workerSchedule ?? null,
    };
  }
  return {
    jobs: jobs.data ?? null, snapshots: snapshots.data ?? null, bindings: bindings.data ?? null, files: files.data ?? null, runs: runs.data ?? null,
    mappings: mappings.data ?? null, usage: usage.data ?? null, preview: preview.data, heartbeatAt: null, workerSchedule: null,
  };
}

const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);

/** The feed file a store reads: its own snapshot path first, then a dry run that found its DealerId. */
export function storeSourcePath(storeId: string, dealerIds: string[], snapshots: InventoryStoreSnapshot[] | null, runs: FeedRun[] | null): string | null {
  const snap = (snapshots ?? []).filter((s) => s.store_id === storeId).sort((a, b) => ms(b.created_at) - ms(a.created_at))[0];
  if (snap) return snap.path;
  const run = (runs ?? []).filter((r) => isPartitionReport(r.report) && r.report.partitions.some((p) => dealerIds.includes(p.sourceDealerId))).sort((a, b) => ms(b.started_at) - ms(a.started_at))[0];
  return run?.path ?? null;
}

export const latestPartitionRun = (path: string, runs: FeedRun[] | null): FeedRun | null =>
  (runs ?? []).filter((r) => r.path === path && isPartitionReport(r.report)).sort((a, b) => ms(b.started_at) - ms(a.started_at))[0] ?? null;

export const recordLabel = (prefix: string, id: string) => `${prefix}-${/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(id) ? id.slice(0, 8) : id}`;
