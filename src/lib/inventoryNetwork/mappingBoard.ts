import {
  isPartitionReport, isTestPath,
  type DealerGroup, type DealerStore, type FeedBinding, type FeedFile, type FeedRun, type InventoryFeedControls, type InventorySourceMapping, type PartitionReportItem, type SourceIdentity,
} from "./api";

export type MappingState =
  | "source_unread" | "stale" | "validation_failed" | "unmapped" | "proposed" | "identity_conflict" | "ready_for_approval" | "approved_paused" | "approved" | "import_failed" | "imported";

export const STATE_LABEL: Record<MappingState, string> = {
  source_unread: "Source unread",
  stale: "Stale",
  validation_failed: "Validation failed",
  unmapped: "Unmapped",
  proposed: "Proposed",
  identity_conflict: "Identity conflict",
  ready_for_approval: "Ready for approval",
  approved_paused: "Import paused",
  approved: "Ready to import",
  import_failed: "Import failed",
  imported: "Imported",
};

export interface MappingRow {
  key: string;
  path: string;
  file: FeedFile;
  run: FeedRun | null;
  partition: PartitionReportItem | null;
  dealerId: string | null;
  observed: SourceIdentity | null;
  mapping: InventorySourceMapping | null;
  store: DealerStore | null;
  group: DealerGroup | null;
  bindingGroup: DealerGroup | null;
  stale: boolean;
  state: MappingState;
  nextAction: string;
  lastArrival: string | null;
  lastImport: string | null;
  lastImportFailure: { at: string; reason: string | null } | null;
  fileApproved: boolean;
  validated: boolean;
  pausedReason: string | null;
}

export interface MappingBoardInput {
  files: FeedFile[];
  runs: FeedRun[];
  mappings: InventorySourceMapping[];
  stores: DealerStore[];
  groups: DealerGroup[];
  bindings: FeedBinding[];
  controls: InventoryFeedControls | null;
}

const latestPartitionRun = (runs: FeedRun[], path: string) =>
  runs.filter((r) => r.path === path && r.kind === "dry_run" && isPartitionReport(r.report)).sort((a, b) => b.started_at.localeCompare(a.started_at))[0] ?? null;

interface ImportHistory { success: { at: string; sha: string | null } | null; failure: { at: string; reason: string | null } | null }

// Walks this DealerId's import runs newest first. The failure is reported only
// when it is newer than the last success, so an old paused attempt never hides
// a later good import.
function importHistory(runs: FeedRun[], path: string, dealerId: string, since: string | null): ImportHistory {
  let failure: ImportHistory["failure"] = null;
  for (const r of runs.filter((x) => x.path === path && x.kind === "import" && (!since || x.started_at >= since)).sort((a, b) => b.started_at.localeCompare(a.started_at))) {
    const parts = (r.report as { partitions?: Array<{ sourceDealerId?: string; status?: string; reason?: string | null }> } | null)?.partitions ?? [];
    const p = parts.find((x) => x.sourceDealerId === dealerId);
    if (!p) continue;
    if (p.status === "applied") return { success: { at: r.finished_at ?? r.started_at, sha: r.content_sha256 ?? null }, failure };
    if (!failure && p.status !== "superseded") failure = { at: r.finished_at ?? r.started_at, reason: p.reason ?? r.failure_reason ?? null };
  }
  return { success: null, failure };
}

function pauseReason(controls: InventoryFeedControls | null, store: DealerStore | null): string | null {
  if (controls?.emergency_stop) return "Emergency stop is on";
  if (!controls || controls.ingestion_paused) return "Ingestion is paused";
  if (store && !store.inventory_feed_enabled) return "Feed is off for this store";
  if (store?.feed_import_paused) return "Import is paused for this store";
  return null;
}

export function buildMappingRows(input: MappingBoardInput): { production: MappingRow[]; tests: FeedFile[] } {
  const production: MappingRow[] = [];
  const tests = input.files.filter((f) => isTestPath(f.path));
  const storeById = new Map(input.stores.map((s) => [s.id, s]));
  const groupById = new Map(input.groups.map((g) => [g.id, g]));
  for (const file of input.files.filter((f) => !isTestPath(f.path))) {
    const run = latestPartitionRun(input.runs, file.path);
    const binding = input.bindings.find((b) => b.path === file.path && b.status === "approved") ?? null;
    const bindingGroup = binding?.tenant_id ? input.groups.find((g) => g.tenant_id === binding.tenant_id) ?? null : null;
    const lastArrival = file.latest_event_at ?? file.remote_mtime;
    const stale = !!run && !!file.last_content_sha256 && !!run.content_sha256 && file.last_content_sha256 !== run.content_sha256;
    const report = run && isPartitionReport(run.report) ? run.report : null;
    const base = { path: file.path, file, run, bindingGroup, lastArrival, stale };
    if (!report || report.partitions.length === 0) {
      const failed = !!report && run?.status !== "passed";
      production.push({
        ...base, key: file.path, partition: null, dealerId: null, observed: null, mapping: null, store: null, group: null, lastImport: null, lastImportFailure: null, pausedReason: null,
        fileApproved: !!binding, validated: false,
        state: failed ? "validation_failed" : "source_unread",
        nextAction: failed ? `Fix the feed: ${(report?.rejectReasons ?? []).join(", ").replace(/_/g, " ") || "the file was rejected"}` : "Run a dry run",
      });
      continue;
    }
    for (const p of report.partitions) {
      const mapping = input.mappings.find((m) => m.source_dealer_id === p.sourceDealerId && (m.status === "pending" || m.status === "approved")) ?? null;
      const store = mapping ? storeById.get(mapping.store_id) ?? null : null;
      const group = store ? groupById.get(store.group_id) ?? null : null;
      const hist = importHistory(input.runs, file.path, p.sourceDealerId, mapping?.approved_at ?? null);
      const lastImport = hist.success?.at ?? null;
      const lastImportFailure = hist.failure;
      const pausedReason = pauseReason(input.controls, store);
      const newerFile = hist.success ? !!hist.success.sha && !!file.last_content_sha256 && hist.success.sha !== file.last_content_sha256 : stale;
      const validated = run!.status === "passed" && p.outcome !== "rejected" && !stale;
      let state: MappingState;
      let nextAction: string;
      const ev = mapping?.evidence ?? null;
      if (mapping?.status === "approved") {
        if (pausedReason) { state = "approved_paused"; nextAction = `${pausedReason}. Resume it to import.`; }
        else if (lastImportFailure) { state = "import_failed"; nextAction = `Last import failed: ${(lastImportFailure.reason ?? "unknown").replace(/^[^:]*:/, "").replace(/_/g, " ")}. Import again.`; }
        else if (lastImport) { state = "imported"; nextAction = newerFile ? "Newer file waiting; import when ready" : "None"; }
        else { state = "approved"; nextAction = "Import now"; }
      } else if (stale) {
        state = "stale"; nextAction = "Run a new dry run; the file changed";
      } else if (run!.status !== "passed" || p.outcome === "rejected") {
        state = "validation_failed"; nextAction = `Fix the feed: ${[...report.rejectReasons, ...p.reasons].join(", ").replace(/_/g, " ") || "rows failed validation"}`;
      } else if (!mapping) {
        state = "unmapped"; nextAction = p.identityVariants > 1 ? "Ask the provider to fix mixed identities" : "Review identity and choose or create a store";
      } else if (ev?.computed_by !== "server") {
        state = "proposed"; nextAction = "Reject and propose again from this dry run";
      } else if (ev.verdict === "mismatch" || ev.verdict === "incomplete") {
        state = "identity_conflict"; nextAction = ev.verdict === "mismatch" ? "Fix the store identity or reject" : "Complete the store identity, then propose again";
      } else if (ev.content_sha256 && file.last_content_sha256 && ev.content_sha256 !== file.last_content_sha256) {
        state = "stale"; nextAction = "File changed since review; dry run and propose again";
      } else {
        state = "ready_for_approval"; nextAction = ev.verdict === "name_review" ? "Approve with name acknowledgement" : "Approve";
      }
      production.push({ ...base, key: `${file.path}::${p.sourceDealerId}`, partition: p, dealerId: p.sourceDealerId, observed: p.identity, mapping, store, group, lastImport, lastImportFailure, fileApproved: !!binding, validated, pausedReason, state, nextAction, stale: lastImport ? newerFile : stale });
    }
  }
  return { production, tests };
}
