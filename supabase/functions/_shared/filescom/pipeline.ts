// Phase 2 ingestion: stable download -> CSV -> per-dealer partitions ->
// approved mapping -> store-scoped staging -> one-transaction apply per store.
// Shared by the worker (queue + reconciliation) and the admin console
// (partition dry run, Import now). Dependencies are injected so the whole path
// runs in unit tests against an in-memory database and a fake Files.com.
//
// This module never writes vehicle tables and never calls MarketCheck: the
// only inventory write is the SQL function inventory_apply_store_snapshot.

import {
  API_FOLDER_LIST_PATH, FILESCOM_ORIGIN, assertConnectorWrite, canonicalFromProvider, checkDownloadedContent, downloadFileContents,
  providerPath, remoteMeta, sha256Hex, type RemoteMeta,
} from "./policy.ts";
import { parseCsv } from "./csv.ts";
import {
  compareToStore, decidePartition, diffAgainstStore, partitionFeed, type MappingRef, type Partition, type StoreIdentity,
} from "./partition.ts";

// deno-lint-ignore no-explicit-any
type Row = any;
type Result = { data: Row; error: { message?: string; code?: string } | null };
export interface Query extends PromiseLike<Result> {
  select(cols?: string): Query; insert(v: unknown): Query; update(v: unknown): Query; upsert(v: unknown, o?: unknown): Query;
  eq(c: string, v: unknown): Query; in(c: string, v: unknown[]): Query; order(c: string, o?: unknown): Query; limit(n: number): Query;
  maybeSingle(): Query; single(): Query;
}
export interface Db { from(table: string): Query; rpc(fn: string, args?: Record<string, unknown>): PromiseLike<Result> }
type Fetch = (url: string, init: RequestInit) => Promise<Response>;
export type Deps = { db: Db; key: string; fetchFn: Fetch };

export class PipelineError extends Error {
  constructor(public code: string, public retryable: boolean) { super(code); }
}

const STAGE_CHUNK = 500;

const write = (db: Db, table: string) => { assertConnectorWrite(table); return db.from(table); };
const must = <T extends Result>(r: T, code = "ledger_write_failed"): T => { if (r.error) throw new PipelineError(code, true); return r; };

async function fcJson(deps: Deps, path: string): Promise<unknown> {
  let res: Response;
  try {
    res = await deps.fetchFn(`${FILESCOM_ORIGIN}/api/rest/v1/${path}`, { headers: { "X-FilesAPI-Key": deps.key, Accept: "application/json" }, redirect: "error" });
  } catch {
    throw new PipelineError("filescom_unreachable", true);
  }
  if (!res.ok) {
    await res.body?.cancel();
    if (res.status === 401 || res.status === 403) throw new PipelineError("filescom_auth_failed", false);
    if (res.status === 404) throw new PipelineError("filescom_not_found", false);
    throw new PipelineError("filescom_http_error", res.status >= 500 || res.status === 429);
  }
  return await res.json();
}

export const fileMeta = async (deps: Deps, path: string): Promise<RemoteMeta> => remoteMeta(await fcJson(deps, `file_actions/metadata/${providerPath(path)}`));
export const versionKey = (m: RemoteMeta): string => `${m.size}|${m.mtime}|${m.checksum ?? ""}`;

export type Loaded = { before: RemoteMeta; after: RemoteMeta; sha: string; headers: string[]; rows: string[][] };

// Metadata before and after the download must agree, and the bytes must match
// the size (and sha256 when Files.com reports one). A file mid-upload fails
// retryably; malformed content is rejected for good.
export async function loadStableFile(deps: Deps, path: string, before?: RemoteMeta): Promise<Loaded> {
  const b = before ?? await fileMeta(deps, path);
  let bytes: Uint8Array;
  try { bytes = await downloadFileContents(deps.fetchFn, deps.key, path); }
  catch (e) {
    const code = e instanceof Error ? e.message : "download_failed";
    throw new PipelineError(code, code !== "file_too_large" && code !== "filescom_auth_failed");
  }
  const after = await fileMeta(deps, path);
  const sha = await sha256Hex(bytes);
  const chk = checkDownloadedContent(b, after, bytes.byteLength, sha);
  if (!chk.ok) throw new PipelineError(chk.reason, chk.reason === "file_changed_during_download" || chk.reason === "remote_version_unavailable");
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw Object.assign(new PipelineError("not_utf8", false), { sha, after }); }
  const csv = parseCsv(text);
  if (!csv.ok) throw Object.assign(new PipelineError(`csv_${csv.reason}`, false), { sha, after });
  return { before: b, after, sha, headers: csv.headers, rows: csv.rows };
}

type Binding = { id: string; status: string; tenant_id: string | null; proposed_at: string | null };
async function bindingFor(db: Db, path: string): Promise<Binding | null> {
  const r = await db.from("inventory_feed_bindings").select("id,status,tenant_id,proposed_at").eq("provider", "filescom").eq("path", path).maybeSingle();
  if (r.error) throw new PipelineError("read_failed", true);
  return r.data as Binding | null;
}

async function groupForTenant(db: Db, tenantId: string | null): Promise<string | null> {
  if (!tenantId) return null;
  const r = await db.from("dealer_groups").select("id").eq("tenant_id", tenantId).maybeSingle();
  if (r.error) throw new PipelineError("read_failed", true);
  return (r.data as { id: string } | null)?.id ?? null;
}

type StoreRow = StoreIdentity & { group_id: string; status: string; inventory_feed_enabled: boolean; feed_import_paused: boolean; max_invalid_rows: number };
type MappingRow = MappingRef & { store: StoreRow | null };

async function mappingsFor(db: Db, dealerIds: string[]): Promise<Map<string, MappingRow>> {
  const out = new Map<string, MappingRow>();
  if (!dealerIds.length) return out;
  const r = await db.from("inventory_source_mappings").select("id,status,store_id,group_id,source_dealer_id,observed_identity").eq("provider", "vauto").in("source_dealer_id", dealerIds).in("status", ["pending", "approved"]);
  if (r.error) throw new PipelineError("read_failed", true);
  const rows = (r.data ?? []) as Array<MappingRef & { source_dealer_id: string }>;
  const storeIds = [...new Set(rows.map((m) => m.store_id))];
  const stores = new Map<string, StoreRow>();
  if (storeIds.length) {
    const s = await db.from("dealer_stores").select("id,group_id,display_name,legal_name,street,city,state,zip,status,inventory_feed_enabled,feed_import_paused,max_invalid_rows").in("id", storeIds);
    if (s.error) throw new PipelineError("read_failed", true);
    for (const st of (s.data ?? []) as StoreRow[]) stores.set(st.id, st);
  }
  for (const m of rows) out.set(m.source_dealer_id, { ...m, store: stores.get(m.store_id) ?? null });
  return out;
}

export type PartitionReport = {
  sourceDealerId: string; identity: Partition["identity"]; identityVariants: number;
  mapping: { id: string; status: string; storeId: string; storeName: string | null } | null;
  comparison: ReturnType<typeof compareToStore>;
  outcome: ReturnType<typeof decidePartition>["outcome"]; reasons: string[]; clean: boolean;
  counts: Partition["counts"]; errors: Partition["errors"]; warnings: Partition["warnings"];
  inventoryDiff: ReturnType<typeof diffAgainstStore>;
  snapshotId?: string | null; status?: string; reason?: string | null; apply?: unknown;
};

function reportFor(p: Partition, m: MappingRow | null, decision: ReturnType<typeof decidePartition>, diff: ReturnType<typeof diffAgainstStore>): PartitionReport {
  return {
    sourceDealerId: p.sourceDealerId, identity: p.identity, identityVariants: p.identityVariants,
    mapping: m ? { id: m.id, status: m.status, storeId: m.store_id, storeName: m.store?.display_name ?? null } : null,
    comparison: compareToStore(p.identity, m?.store ?? null),
    outcome: decision.outcome, reasons: decision.reasons, clean: decision.clean,
    counts: p.counts, errors: p.errors, warnings: p.warnings, inventoryDiff: diff,
  };
}

async function startRun(db: Db, fields: Record<string, unknown>): Promise<string> {
  const r = await write(db, "inventory_feed_runs").insert(fields).select("id").single();
  if (r.error || !r.data) throw new PipelineError("run_create_failed", true);
  return (r.data as { id: string }).id;
}

async function finishRun(db: Db, runId: string, fileId: string | null, status: string, patch: Record<string, unknown>) {
  const now = new Date().toISOString();
  must(await write(db, "inventory_feed_runs").update({ status, finished_at: now, ...patch }).eq("id", runId));
  if (fileId) {
    const fileStatus = status === "passed" || status === "applied" || status === "partial" ? "validated" : status === "rejected" ? "rejected" : status === "skipped" ? "validated" : "failed";
    const version = patch.content_sha256 ? { last_content_sha256: patch.content_sha256, remote_size: patch.remote_size ?? null, remote_mtime: patch.remote_mtime ?? null } : {};
    must(await write(db, "inventory_feed_files").update({ status: fileStatus, last_run_id: runId, updated_at: now, ...version }).eq("id", fileId));
  }
}

async function fileRow(db: Db, path: string): Promise<{ id: string } | null> {
  const r = await db.from("inventory_feed_files").select("id").eq("provider", "filescom").eq("path", path).maybeSingle();
  if (r.error) throw new PipelineError("read_failed", true);
  return r.data as { id: string } | null;
}

// Dry run across every partition. Reads only; writes the run ledger.
export async function partitionDryRun(deps: Deps, path: string, uid: string | null) {
  const { db } = deps;
  const file = await fileRow(db, path);
  if (!file) throw new PipelineError("file_not_discovered", false);
  const binding = await bindingFor(db, path);
  const runId = await startRun(db, { kind: "dry_run", file_id: file.id, path, binding_id: binding?.id ?? null, binding_status: binding?.status ?? "unmapped", tenant_id: binding?.tenant_id ?? null, triggered_by: uid });
  let loaded: Loaded;
  try { loaded = await loadStableFile(deps, path); }
  catch (e) {
    const pe = e instanceof PipelineError ? e : new PipelineError("validation_error", true);
    const extra = e as { sha?: string; after?: RemoteMeta };
    await finishRun(db, runId, file.id, pe.retryable ? "failed" : "rejected", {
      failure_reason: pe.code, ...(extra.sha ? { content_sha256: extra.sha, remote_size: extra.after?.size ?? null, remote_mtime: extra.after?.mtime ?? null } : {}),
    });
    return { runId, status: pe.retryable ? "failed" : "rejected", report: null, error: pe.code };
  }
  const parts = partitionFeed(loaded.headers, loaded.rows);
  const version = { content_sha256: loaded.sha, remote_size: loaded.after.size, remote_mtime: loaded.after.mtime };
  if (!parts.ok) {
    const report = { kind: "partition_dry_run", outcome: "rejected", rejectReasons: [parts.reason], headers: parts.headers, identities: 0, identity: null, partitions: [], bindingProposedAt: binding?.proposed_at ?? null, inventoryWrites: 0, providerCalls: 0 };
    await finishRun(db, runId, file.id, "rejected", { ...version, failure_reason: parts.reason, report });
    return { runId, status: "rejected", report };
  }
  const groupId = await groupForTenant(db, binding?.tenant_id ?? null);
  const maps = await mappingsFor(db, parts.partitions.map((p) => p.sourceDealerId));
  const partitions: PartitionReport[] = [];
  for (const p of parts.partitions) {
    const m = maps.get(p.sourceDealerId) ?? null;
    const decision = decidePartition(p, m, groupId, m?.store?.max_invalid_rows ?? 0);
    let diff: ReturnType<typeof diffAgainstStore> = null;
    if (m?.store) {
      const ex = await db.from("store_inventory").select("vin,feed_price,mileage,presence").eq("store_id", m.store_id).limit(20000);
      if (!ex.error) diff = diffAgainstStore(p, (ex.data ?? []) as Array<{ vin: string; feed_price: number | null; mileage: number | null; presence: string }>);
    }
    partitions.push(reportFor(p, m, decision, diff));
  }
  const rejectReasons = parts.rowsWithoutDealer > 0 ? ["rows_without_dealer_id"] : [];
  const report = {
    kind: "partition_dry_run", outcome: "passed", rejectReasons, headers: parts.headers, rowsWithoutDealer: parts.rowsWithoutDealer,
    identities: partitions.length, identity: partitions.length === 1 ? partitions[0].identity : null, partitions,
    bindingProposedAt: binding?.proposed_at ?? null, inventoryWrites: 0, providerCalls: 0,
  };
  await finishRun(db, runId, file.id, "passed", { ...version, failure_reason: null, report });
  return { runId, status: "passed", report };
}

type Job = { id: string; path: string; lock_token: string; attempts: number; max_attempts: number };
export type JobOutcome = { status: string; error?: string; result?: unknown };

async function finishJob(db: Db, job: Job, status: "succeeded" | "partial" | "skipped" | "failed", opts: { error?: string; retryable?: boolean; result?: unknown; runId?: string | null; versionKey?: string | null }) {
  const r = await db.rpc("inventory_feed_finish_job", {
    p_job_id: job.id, p_lock_token: job.lock_token, p_status: status, p_error: opts.error ?? null, p_retryable: opts.retryable === true,
    p_result: opts.result ?? null, p_run_id: opts.runId ?? null, p_version_key: opts.versionKey ?? null,
  });
  return r.error ? "finish_failed" : String(r.data);
}

async function setVersion(db: Db, versionId: string, status: string, patch: Record<string, unknown> = {}) {
  must(await write(db, "inventory_feed_versions").update({ status, finished_at: new Date().toISOString(), ...patch }).eq("id", versionId));
}

async function stagePartition(db: Db, p: Partition, m: MappingRow, runId: string, jobId: string, path: string, loaded: Loaded, clean: boolean, report: PartitionReport): Promise<string> {
  const ins = await write(db, "inventory_store_snapshots").insert({
    run_id: runId, job_id: jobId, path, source_dealer_id: p.sourceDealerId, store_id: m.store_id, group_id: m.group_id, mapping_id: m.id,
    source_mtime: loaded.after.mtime, content_sha256: loaded.sha, clean, status: "staged",
    row_count: p.counts.rows, valid_count: p.vehicles.length, invalid_count: p.counts.invalid, duplicate_count: p.counts.duplicateIdentical + p.counts.duplicateConflicts,
    price_missing_count: p.counts.priceMissing, photo_missing_count: p.counts.photoMissing,
    report: { counts: report.counts, errors: report.errors, warnings: report.warnings, comparison: report.comparison },
  }).select("id").single();
  if (ins.error || !ins.data) throw new PipelineError("snapshot_create_failed", true);
  const snapshotId = (ins.data as { id: string }).id;
  for (let i = 0; i < p.vehicles.length; i += STAGE_CHUNK) {
    const chunk = p.vehicles.slice(i, i + STAGE_CHUNK).map((v) => ({ ...v, snapshot_id: snapshotId }));
    const r = await write(db, "inventory_snapshot_vehicles").insert(chunk);
    if (r.error) {
      await write(db, "inventory_store_snapshots").update({ status: "failed", reason: "staging_write_failed" }).eq("id", snapshotId);
      throw Object.assign(new PipelineError("staging_write_failed", true), { snapshotId });
    }
  }
  return snapshotId;
}

async function recordUnstaged(db: Db, p: Partition, m: MappingRow | null, runId: string, jobId: string, path: string, loaded: Loaded, status: "quarantined" | "rejected", reason: string, report: PartitionReport) {
  const r = await write(db, "inventory_store_snapshots").insert({
    run_id: runId, job_id: jobId, path, source_dealer_id: p.sourceDealerId, store_id: m?.store_id ?? null, group_id: m?.group_id ?? null, mapping_id: m?.id ?? null,
    source_mtime: loaded.after.mtime, content_sha256: loaded.sha, clean: false, status, reason,
    row_count: p.counts.rows, valid_count: p.vehicles.length, invalid_count: p.counts.invalid, duplicate_count: p.counts.duplicateIdentical + p.counts.duplicateConflicts,
    price_missing_count: p.counts.priceMissing, photo_missing_count: p.counts.photoMissing,
    report: { identity: p.identity, reasons: report.reasons, counts: report.counts, errors: report.errors },
  }).select("id").single();
  return r.error ? null : (r.data as { id: string }).id;
}

// Processes one claimed import job end to end. Each store partition is staged
// and applied on its own; a failure in one never touches another store.
export async function processImportJob(deps: Deps, job: Job): Promise<JobOutcome> {
  const { db } = deps;
  const binding = await bindingFor(db, job.path);
  if (binding?.status !== "approved") {
    await finishJob(db, job, "skipped", { error: "binding_not_approved" });
    return { status: "skipped", error: "binding_not_approved" };
  }
  let before: RemoteMeta;
  try { before = await fileMeta(deps, job.path); }
  catch (e) {
    const pe = e instanceof PipelineError ? e : new PipelineError("metadata_failed", true);
    const st = await finishJob(db, job, "failed", { error: pe.code, retryable: pe.retryable });
    return { status: st, error: pe.code };
  }
  if (before.size === null || before.mtime === null) {
    const st = await finishJob(db, job, "failed", { error: "remote_version_unavailable", retryable: true });
    return { status: st, error: "remote_version_unavailable" };
  }
  const vkey = versionKey(before);
  const claim = await db.rpc("inventory_feed_claim_version", { p_path: job.path, p_version_key: vkey, p_size: before.size, p_mtime: before.mtime, p_checksum: before.checksum, p_job_id: job.id });
  if (claim.error) { const st = await finishJob(db, job, "failed", { error: "version_claim_failed", retryable: true }); return { status: st, error: "version_claim_failed" }; }
  const c = claim.data as { claimed: boolean; version_id: string; status?: string };
  if (!c.claimed) {
    const st = await finishJob(db, job, "skipped", { error: `version_${c.status ?? "claimed"}`, versionKey: vkey });
    return { status: st, error: `version_${c.status ?? "claimed"}` };
  }

  const file = await fileRow(db, job.path);
  const runId = await startRun(db, { kind: "import", job_id: job.id, file_id: file?.id ?? null, path: job.path, binding_id: binding.id, binding_status: binding.status, tenant_id: binding.tenant_id, remote_size: before.size, remote_mtime: before.mtime });

  let loaded: Loaded;
  try { loaded = await loadStableFile(deps, job.path, before); }
  catch (e) {
    const pe = e instanceof PipelineError ? e : new PipelineError("download_failed", true);
    const extra = e as { sha?: string };
    await setVersion(db, c.version_id, pe.retryable ? "failed" : "rejected", { run_id: runId, content_sha256: extra.sha ?? null });
    await finishRun(db, runId, file?.id ?? null, pe.retryable ? "failed" : "rejected", { failure_reason: pe.code });
    const st = await finishJob(db, job, "failed", { error: pe.code, retryable: pe.retryable, runId, versionKey: vkey });
    return { status: st, error: pe.code };
  }
  const version = { content_sha256: loaded.sha, remote_size: loaded.after.size, remote_mtime: loaded.after.mtime };
  const parts = partitionFeed(loaded.headers, loaded.rows);
  if (!parts.ok) {
    await setVersion(db, c.version_id, "rejected", { run_id: runId, content_sha256: loaded.sha });
    await finishRun(db, runId, file?.id ?? null, "rejected", { ...version, failure_reason: parts.reason, report: { kind: "import", rejectReasons: [parts.reason], headers: parts.headers, partitions: [] } });
    const st = await finishJob(db, job, "failed", { error: parts.reason, runId, versionKey: vkey });
    return { status: st, error: parts.reason };
  }

  const groupId = await groupForTenant(db, binding.tenant_id);
  const maps = await mappingsFor(db, parts.partitions.map((p) => p.sourceDealerId));
  const partitions: PartitionReport[] = [];
  const affected: string[] = [];
  let applied = 0;
  let transientFailure = false;
  for (const p of parts.partitions) {
    const m = maps.get(p.sourceDealerId) ?? null;
    const decision = decidePartition(p, m, groupId, m?.store?.max_invalid_rows ?? 0);
    const rep = reportFor(p, m, decision, null);
    if (decision.outcome !== "ready" || !m) {
      const status = decision.outcome === "rejected" ? "rejected" : "quarantined";
      rep.snapshotId = await recordUnstaged(db, p, m, runId, job.id, job.path, loaded, status, decision.reasons.join(","), rep);
      rep.status = status; rep.reason = decision.reasons.join(",");
      partitions.push(rep);
      continue;
    }
    if (!m.store || m.store.status !== "active" || !m.store.inventory_feed_enabled || m.store.feed_import_paused) {
      rep.snapshotId = await recordUnstaged(db, p, m, runId, job.id, job.path, loaded, "rejected", "store_feed_not_enabled", rep);
      rep.status = "rejected"; rep.reason = "store_feed_not_enabled";
      partitions.push(rep);
      continue;
    }
    try {
      const snapshotId = await stagePartition(db, p, m, runId, job.id, job.path, loaded, decision.clean, rep);
      rep.snapshotId = snapshotId;
      const ap = await db.rpc("inventory_apply_store_snapshot", { p_snapshot_id: snapshotId });
      if (ap.error) {
        await write(db, "inventory_store_snapshots").update({ status: "failed", reason: "apply_failed" }).eq("id", snapshotId).eq("status", "staged");
        rep.status = "failed"; rep.reason = "apply_failed"; transientFailure = true;
      } else {
        const a = ap.data as { applied: boolean; reason?: string };
        rep.apply = a;
        rep.status = a.applied ? "applied" : a.reason === "older_than_applied_snapshot" || a.reason === "same_version_already_applied" ? "superseded" : a.reason === "held_for_review" ? "held" : "rejected";
        rep.reason = a.applied ? null : a.reason ?? null;
        if (a.applied) { applied++; affected.push(m.store_id); }
      }
    } catch (e) {
      const pe = e instanceof PipelineError ? e : new PipelineError("staging_failed", true);
      rep.status = "failed"; rep.reason = pe.code; transientFailure = true;
    }
    partitions.push(rep);
  }

  const total = partitions.length;
  const missingPartitions = await missingPartitionsFor(db, job.path, parts.partitions.map((p) => p.sourceDealerId));
  const runStatus = applied === total && missingPartitions.length === 0 ? "applied" : applied > 0 ? "partial" : transientFailure ? "failed" : "rejected";
  const report = { kind: "import", outcome: runStatus, headers: parts.headers, rowsWithoutDealer: parts.rowsWithoutDealer, identities: total, partitions, missingPartitions, inventoryWrites: applied, providerCalls: 0 };
  await finishRun(db, runId, file?.id ?? null, runStatus, { ...version, failure_reason: runStatus === "applied" ? null : [...partitions.filter((x) => x.status !== "applied").map((x) => `${x.sourceDealerId}:${x.reason}`), ...missingPartitions.map((d) => `${d}:partition_missing`)].join(",").slice(0, 300), report, affected_store_ids: affected });
  await setVersion(db, c.version_id, runStatus === "applied" ? "applied" : runStatus === "partial" ? "partial" : runStatus === "failed" ? "failed" : "rejected", { run_id: runId, content_sha256: loaded.sha });
  const result = { runId, partitions: partitions.map((x) => ({ sourceDealerId: x.sourceDealerId, storeId: x.mapping?.storeId ?? null, snapshotId: x.snapshotId ?? null, status: x.status, reason: x.reason ?? null, apply: x.apply ?? null })) };
  const jobStatus = runStatus === "applied" ? "succeeded" : runStatus === "partial" ? "partial" : "failed";
  const st = await finishJob(db, job, jobStatus, { error: jobStatus === "succeeded" ? undefined : report.partitions.find((x) => x.status !== "applied")?.reason ?? runStatus, retryable: runStatus === "failed", result, runId, versionKey: vkey });
  return { status: st, result };
}

// A dealer whose stock this file delivered before but which is absent now.
// Its store receives no snapshot, so nothing changes; the run says why.
async function missingPartitionsFor(db: Db, path: string, present: string[]): Promise<string[]> {
  const r = await db.from("inventory_store_snapshots").select("source_dealer_id").eq("path", path).eq("status", "applied").order("created_at", { ascending: false }).limit(200);
  if (r.error) return [];
  const seen = new Set(((r.data ?? []) as Array<{ source_dealer_id: string }>).map((x) => x.source_dealer_id));
  return [...seen].filter((d) => !present.includes(d)).sort();
}

// Reconciliation: compare the folder listing against the newest processed
// version of each approved file and enqueue any file whose version is new.
export async function reconcile(deps: Deps): Promise<{ checked: number; enqueued: number; coalesced: number }> {
  const { db } = deps;
  const list = await fcJson(deps, API_FOLDER_LIST_PATH);
  if (!Array.isArray(list)) throw new PipelineError("filescom_unexpected_response", true);
  const b = await db.from("inventory_feed_bindings").select("path,status").eq("provider", "filescom").eq("status", "approved");
  if (b.error) throw new PipelineError("read_failed", true);
  const approved = new Set(((b.data ?? []) as Array<{ path: string }>).map((x) => x.path));
  let checked = 0, enqueued = 0, coalesced = 0;
  for (const item of list) {
    const o = item as { path?: unknown; type?: unknown };
    if (o.type !== "file") continue;
    const p = canonicalFromProvider(o.path);
    if (!p.ok || !approved.has(p.path)) continue;
    checked++;
    const m = remoteMeta(item);
    if (m.size === null || m.mtime === null) continue;
    const v = await db.from("inventory_feed_versions").select("id,status").eq("provider", "filescom").eq("path", p.path).eq("version_key", versionKey(m)).maybeSingle();
    if (v.error) throw new PipelineError("read_failed", true);
    if (v.data && (v.data as { status: string }).status !== "failed") continue;
    const r = await db.rpc("inventory_feed_enqueue", { p_path: p.path, p_trigger: "reconcile", p_requested_by: null, p_event_id: null });
    if (r.error) throw new PipelineError("enqueue_failed", true);
    const res = (r.data ?? {}) as { enqueued?: boolean; reason?: string };
    if (res.enqueued) enqueued++; else if (res.reason === "coalesced") coalesced++;
  }
  return { checked, enqueued, coalesced };
}
