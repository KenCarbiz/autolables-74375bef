import type { MetricModel, StageModel, TimelineItem, Tone } from "../types";
import { consolePath } from "../sections";
import { readRows, settle, type Settled } from "./read";
import { clockTime, plural, provenance, unknownMetric, type ToneLabel } from "./shared";

// Connections list, the Files.com feed screen and feed mapping. Read-only:
// every source is a recorded table row, and a source that cannot be read is
// shown as Unknown or Not monitored, never as healthy.

interface SnapRow { id: string; run_id: string | null; path: string; source_dealer_id: string | null; store_id: string | null; status: string; reason: string | null; row_count: number | null; valid_count: number | null; created_at: string; applied_at: string | null }
interface RunRow { id: string; path: string; kind: string; status: string; failure_reason: string | null; started_at: string; finished_at: string | null }
interface EventRow { id: string; path: string; action: string; received_at: string }
interface JobRow { id: string; path: string; status: string; created_at: string }
interface ControlRow { id: string | number; ingestion_paused: boolean; emergency_stop: boolean; reason: string | null; updated_at: string }
interface BindingRow { id: string; path: string; status: string }
interface StoreRow { id: string; display_name: string; group_id: string | null }
interface RuleRow { source_store_id: string; destination_store_id: string; status: string; show_prices: boolean }
interface PolicyRow { store_id: string; mode: string; budget_blocked: boolean }

const HELD = new Set(["quarantined", "rejected", "failed"]);
const val = <T,>(s: Settled<T[]>): T[] => (s.ok ? s.value : []);

export interface PipelineState {
  label: string;
  tone: Tone;
  /** The newest snapshot is held and has not been superseded by an applied one. */
  held: boolean;
  snapshot: SnapRow | null;
  reason: string | null;
}

/** Newest snapshot decides the pipeline state; snapshots arrive newest first. */
export function pipelineOf(snaps: SnapRow[]): PipelineState {
  const latest = snaps[0] ?? null;
  if (!latest) return { label: "Unknown", tone: "neutral", held: false, snapshot: null, reason: null };
  if (HELD.has(latest.status)) return { label: "Held", tone: "warn", held: true, snapshot: latest, reason: latest.reason };
  if (latest.status === "applied") return { label: "Healthy", tone: "good", held: false, snapshot: latest, reason: null };
  return { label: "In progress", tone: "info", held: false, snapshot: latest, reason: null };
}

const clock = (iso: string | null) => (iso ? `${clockTime(iso)} local` : "No measurement");

export interface ConnectionRow {
  id: string;
  name: string;
  configuration: ToneLabel;
  operation: ToneLabel;
  scope: string;
  lastChecked: string;
  actionLabel: string;
  href: string;
}
export interface ConnectionsModel { rows: ConnectionRow[]; note: string }

const NOT_MONITORED: ToneLabel = { tone: "neutral", label: "Not monitored" };
const CONFIG_UNKNOWN: ToneLabel = { tone: "neutral", label: "Unknown" };

export async function loadConnections(): Promise<ConnectionsModel> {
  const [bindings, snaps, controls, groups, stores, policies, deliveries, contracts, events] = await Promise.all([
    settle(readRows<BindingRow>("inventory_feed_bindings", "id,path,status", { limit: 500 })),
    settle(readRows<SnapRow>("inventory_store_snapshots", "id,run_id,path,source_dealer_id,store_id,status,reason,row_count,valid_count,created_at,applied_at", { order: "created_at", limit: 50 })),
    settle(readRows<ControlRow>("inventory_feed_controls", "id,ingestion_paused,emergency_stop,updated_at,reason", { limit: 1 })),
    settle(readRows<{ id: string }>("dealer_groups", "id", { limit: 500 })),
    settle(readRows<{ id: string }>("dealer_stores", "id", { limit: 1000 })),
    settle(readRows<PolicyRow>("store_enrichment_policies", "store_id,mode,budget_blocked", { limit: 1000 })),
    settle(readRows<{ id: string; status: string; received_at: string | null }>("bulk_feed_deliveries", "id,status,received_at", { order: "received_at", limit: 5 })),
    settle(readRows<{ feed_key: string; enabled: boolean }>("bulk_feed_contracts", "feed_key,enabled", { limit: 50 })),
    settle(readRows<EventRow>("inventory_feed_events", "id,path,action,received_at", { order: "received_at", limit: 1 })),
  ]);

  const pipeline = pipelineOf(val(snaps));
  const paused = controls.ok && controls.value[0] ? controls.value[0].ingestion_paused || controls.value[0].emergency_stop : false;
  const approved = bindings.ok ? bindings.value.filter((b) => b.status === "approved").length : null;
  const filesConfig: ToneLabel = approved === null ? CONFIG_UNKNOWN : approved > 0 ? { tone: "good", label: "Configured" } : { tone: "neutral", label: "Not configured" };
  const filesOp: ToneLabel = paused ? { tone: "warn", label: "Paused" } : snaps.ok ? { tone: pipeline.tone, label: pipeline.held ? "Import held" : pipeline.label } : CONFIG_UNKNOWN;
  const lastFilesAt = events.ok && events.value[0] ? events.value[0].received_at : pipeline.snapshot?.created_at ?? null;

  const enrichStores = policies.ok ? policies.value.filter((p) => p.mode === "enrichment").length : null;
  const contractsEnabled = contracts.ok ? contracts.value.filter((c) => c.enabled).length : null;
  const mcConfig: ToneLabel = contractsEnabled === null ? CONFIG_UNKNOWN : contractsEnabled > 0 ? { tone: "good", label: "Configured" } : { tone: "neutral", label: "Not configured" };
  const lastDelivery = deliveries.ok ? deliveries.value[0] : undefined;
  const mcOp: ToneLabel = !deliveries.ok ? CONFIG_UNKNOWN : !lastDelivery ? NOT_MONITORED : lastDelivery.status === "failed" || lastDelivery.status === "quarantined" ? { tone: "bad", label: "Failed" } : lastDelivery.status === "imported" || lastDelivery.status === "validated" ? { tone: "good", label: "Healthy" } : { tone: "info", label: "Receiving" };
  const mcPaused = policies.ok && policies.value.length > 0 && policies.value.every((p) => p.mode === "paused");

  const rows: ConnectionRow[] = [
    { id: "filescom", name: "Files.com / feeds", configuration: filesConfig, operation: filesOp, scope: groups.ok && stores.ok ? `${plural(groups.value.length, "group")} / ${plural(stores.value.length, "store")}` : "Unknown", lastChecked: clock(lastFilesAt), actionLabel: "Open detail", href: consolePath.filesCom() },
    { id: "marketcheck", name: "MarketCheck / data", configuration: mcConfig, operation: mcPaused ? { tone: "warn", label: "Paused" } : mcOp, scope: enrichStores === null ? "Unknown" : `${plural(enrichStores, "enriched store")}`, lastChecked: clock(lastDelivery?.received_at ?? null), actionLabel: "Open detail", href: consolePath.usage() },
    { id: "crawler", name: "Website crawler", configuration: CONFIG_UNKNOWN, operation: NOT_MONITORED, scope: "No crawler telemetry", lastChecked: "No measurement", actionLabel: "Open setup", href: consolePath.monitoring() },
    { id: "billing", name: "Billing bridge", configuration: CONFIG_UNKNOWN, operation: NOT_MONITORED, scope: "Platform", lastChecked: "No measurement", actionLabel: "Inspect access", href: consolePath.billing() },
    { id: "email", name: "Email provider", configuration: CONFIG_UNKNOWN, operation: NOT_MONITORED, scope: "Transactional", lastChecked: "No measurement", actionLabel: "Open setup", href: consolePath.monitoring() },
    { id: "storage", name: "Object storage", configuration: CONFIG_UNKNOWN, operation: NOT_MONITORED, scope: "Platform", lastChecked: "No measurement", actionLabel: "Open setup", href: consolePath.monitoring() },
    { id: "realtime", name: "Realtime updates", configuration: CONFIG_UNKNOWN, operation: NOT_MONITORED, scope: "Authorized sessions", lastChecked: "No measurement", actionLabel: "Open setup", href: consolePath.monitoring() },
  ];
  return { rows, note: "Configuration is not proof of delivery. Connections without recorded telemetry are Not monitored, not healthy." };
}

export interface FeedRowModel { id: string; folder: string; owner: string; viewers: string; enrichment: string; href: string }
export interface FilesComModel {
  metrics: MetricModel[];
  details: { site: string; credential: string; schedule: string };
  controlsNote: string;
  stages: StageModel[];
  feeds: FeedRowModel[];
  feedsNote: string;
  connectionState: { label: string; state: ToneLabel }[];
  journey: { subtitle: string; steps: TimelineItem[]; importId: string | null };
}

const AUTH_FAILURE = /auth|credential|login|401|403|permission/i;
const sec = (iso: string) => {
  const d = new Date(iso);
  return `${clockTime(iso)}:${String(d.getSeconds()).padStart(2, "0")}`;
};

export async function loadFilesCom(now = Date.now()): Promise<FilesComModel> {
  const [events, jobs, snaps, runs, controls, bindings, stores, rules, policies] = await Promise.all([
    settle(readRows<EventRow>("inventory_feed_events", "id,path,action,received_at", { order: "received_at", limit: 50 })),
    settle(readRows<JobRow>("inventory_feed_jobs", "id,path,status,created_at", { order: "created_at", limit: 20 })),
    settle(readRows<SnapRow>("inventory_store_snapshots", "id,run_id,path,source_dealer_id,store_id,status,reason,row_count,valid_count,created_at,applied_at", { order: "created_at", limit: 50 })),
    settle(readRows<RunRow>("inventory_feed_runs", "id,path,kind,status,failure_reason,started_at,finished_at", { order: "started_at", limit: 20 })),
    settle(readRows<ControlRow>("inventory_feed_controls", "id,ingestion_paused,emergency_stop,reason,updated_at", { limit: 1 })),
    settle(readRows<BindingRow>("inventory_feed_bindings", "id,path,status", { limit: 200 })),
    settle(readRows<StoreRow>("dealer_stores", "id,display_name,group_id", { limit: 1000 })),
    settle(readRows<RuleRow>("inventory_sharing_rules", "source_store_id,destination_store_id,status,show_prices", { limit: 500 })),
    settle(readRows<PolicyRow>("store_enrichment_policies", "store_id,mode,budget_blocked", { limit: 1000 })),
  ]);
  const asOf = new Date(now).toISOString();
  const scope = "Files.com inventory feeds";
  const snapList = val(snaps);
  const pipeline = pipelineOf(snapList);
  const nameById = new Map(val(stores).map((s) => [s.id, s.display_name]));
  const latestEvent = events.ok ? events.value[0] : undefined;
  const latestRun = runs.ok ? runs.value[0] : undefined;
  const latestJob = jobs.ok ? jobs.value[0] : undefined;

  const authFailed = runs.ok && runs.value.some((r) => r.failure_reason && AUTH_FAILURE.test(r.failure_reason));
  const auth: MetricModel = !runs.ok
    ? unknownMetric({ key: "auth", icon: "lock", label: "Authentication" }, "inventory_feed_runs", scope, "Run history is not readable yet")
    : authFailed
      ? { key: "auth", icon: "lock", label: "Authentication", value: "Failed", tone: "bad", helper: "A recent run reported a credential error · secret hidden", provenance: provenance("inventory_feed_runs", "failed", scope, asOf) }
      : latestRun
        ? { key: "auth", icon: "lock", label: "Authentication", value: "Verified", tone: "good", helper: `Used by a run at ${clockTime(latestRun.started_at)} · secret hidden`, provenance: provenance("inventory_feed_runs", "healthy", scope, asOf) }
        : { key: "auth", icon: "lock", label: "Authentication", value: "Unknown", tone: "neutral", helper: "No run has used the credential · secret hidden", provenance: provenance("inventory_feed_runs", "unknown", scope, null) };

  const webhook: MetricModel = !events.ok
    ? unknownMetric({ key: "webhook", icon: "plug", label: "Webhook delivery" }, "inventory_feed_events", scope, "Event log is not readable yet")
    : latestEvent
      ? { key: "webhook", icon: "plug", label: "Webhook delivery", value: "Receiving", tone: "good", helper: `Last accepted ${sec(latestEvent.received_at)}`, provenance: provenance("inventory_feed_events", "healthy", scope, asOf) }
      : { key: "webhook", icon: "plug", label: "Webhook delivery", value: "No events", tone: "neutral", helper: "No webhook has been recorded", provenance: provenance("inventory_feed_events", "unknown", scope, null) };

  const pipe: MetricModel = !snaps.ok
    ? unknownMetric({ key: "pipeline", icon: "warning", label: "Import pipeline" }, "inventory_store_snapshots", scope, "Snapshots are not readable yet")
    : { key: "pipeline", icon: pipeline.held ? "warning" : "check", label: "Import pipeline", value: pipeline.label, tone: pipeline.tone, helper: pipeline.snapshot ? `${nameById.get(pipeline.snapshot.store_id ?? "") ?? "Unresolved store"}${pipeline.reason ? ` · ${pipeline.reason.replace(/_/g, " ")}` : ""}` : "No snapshots recorded", provenance: provenance("inventory_store_snapshots", "healthy", scope, asOf) };

  const applied = snapList.find((s) => s.status === "applied" && s.applied_at);
  const matching = applied ? val(events).find((e) => e.path === applied.path && e.received_at <= (applied.applied_at ?? "")) : undefined;
  const lagMin = applied?.applied_at && matching ? Math.max(0, Math.round((new Date(applied.applied_at).getTime() - new Date(matching.received_at).getTime()) / 60_000)) : null;
  const lag: MetricModel = lagMin === null
    ? unknownMetric({ key: "lag", icon: "clock", label: "End-to-end lag" }, "inventory_feed_events", scope, "No applied snapshot has a matching file event")
    : { key: "lag", icon: "clock", label: "End-to-end lag", value: lagMin >= 60 ? `${Math.round(lagMin / 60)} hr` : `${lagMin} min`, tone: lagMin > 60 ? "warn" : "info", helper: "Arrival → published inventory", provenance: provenance("inventory_feed_events", "healthy", scope, asOf) };

  const ctl = controls.ok ? controls.value[0] : undefined;
  const controlsNote = !controls.ok ? "Pause state is not readable." : ctl?.ingestion_paused || ctl?.emergency_stop ? `Ingestion is paused${ctl.reason ? `: ${ctl.reason}` : ""} · last changed ${clockTime(ctl.updated_at)}` : "Ingestion is running. Pause state and actor remain visible.";

  const received = latestEvent?.received_at ?? null;
  const stages: StageModel[] = [
    { key: "received", label: "Received", value: events.ok ? (received ? sec(received) : "None recorded") : "Unknown", tone: received ? "good" : "neutral" },
    { key: "queued", label: "Queued", value: jobs.ok ? (latestJob ? sec(latestJob.created_at) : "None recorded") : "Unknown", tone: latestJob ? "good" : "neutral" },
    { key: "validated", label: "Validated", value: !snaps.ok ? "Unknown" : pipeline.held ? "Held" : pipeline.snapshot ? "Passed" : "None recorded", tone: !snaps.ok ? "neutral" : pipeline.held ? "warn" : pipeline.snapshot ? "good" : "neutral" },
    { key: "imported", label: "Imported", value: !snaps.ok ? "Unknown" : pipeline.held ? "Not started" : applied ? "Complete" : "Not started", tone: !snaps.ok ? "neutral" : applied && !pipeline.held ? "good" : "info" },
    { key: "published", label: "Published", value: !snaps.ok ? "Unknown" : pipeline.held ? "Prior data kept" : applied ? "Current" : "Nothing published", tone: !snaps.ok ? "neutral" : applied && !pipeline.held ? "good" : "info" },
  ];

  const approved = val(bindings).filter((b) => b.status === "approved");
  const ownerByPath = new Map<string, string>();
  for (const s of snapList) if (s.store_id && !ownerByPath.has(s.path)) ownerByPath.set(s.path, s.store_id);
  const policyByStore = new Map(val(policies).map((p) => [p.store_id, p]));
  const feeds: FeedRowModel[] = approved.map((b) => {
    const ownerId = ownerByPath.get(b.path);
    const viewers = ownerId ? val(rules).filter((r) => r.source_store_id === ownerId && r.status === "active") : [];
    const pol = ownerId ? policyByStore.get(ownerId) : undefined;
    return {
      id: b.id,
      folder: b.path,
      owner: ownerId ? nameById.get(ownerId) ?? "Unresolved store" : "Not resolved",
      viewers: !rules.ok ? "Unknown" : !ownerId ? "Unknown" : viewers.length ? viewers.map((r) => `${nameById.get(r.destination_store_id) ?? "Unresolved store"}: view only`).join(", ") : "No other store",
      enrichment: !policies.ok || !ownerId ? "Unknown" : !pol || pol.mode === "feed_only" ? "Feed only; no paid calls" : pol.mode === "paused" ? "Paused" : pol.budget_blocked ? "Budget blocked" : "Owner authorization only",
      href: consolePath.mapping(),
    };
  });

  const stepsSnap = pipeline.snapshot;
  const steps: TimelineItem[] = [
    { id: "received", tone: received ? "good" : "neutral", title: received ? `Received ${clockTime(received)}` : "Received", detail: received ? "Event recorded" : "No file event recorded" },
    { id: "queued", tone: latestJob ? "good" : "neutral", title: latestJob ? `Queued ${clockTime(latestJob.created_at)}` : "Queued", detail: latestJob ? "Durable event receipt" : "No job recorded" },
    { id: "validation", tone: pipeline.held ? "warn" : stepsSnap ? "good" : "neutral", title: pipeline.held ? "Validation held" : stepsSnap ? "Validated" : "Validation", detail: pipeline.held ? (pipeline.reason ?? "Needs review").replace(/_/g, " ") : stepsSnap ? "No blocking findings" : "Nothing to validate yet" },
    { id: "publish", tone: "info", title: "Import / publish", detail: pipeline.held ? "Not started; prior data retained" : applied ? "Published" : "Not started" },
  ];

  return {
    metrics: [auth, webhook, pipe, lag],
    details: {
      site: "Site and account are held server-side and are not shown here",
      credential: "Credential: server-side only · rotation date is not recorded",
      schedule: "Next expected feed: not recorded here · delivery quiet is normal between feeds",
    },
    controlsNote,
    stages,
    feeds,
    feedsNote: bindings.ok ? "No approved folder bindings are recorded." : "Folder bindings are not readable.",
    connectionState: [
      { label: "Authentication", state: authFailed ? { tone: "bad", label: "Failed" } : latestRun ? { tone: "good", label: "Verified" } : CONFIG_UNKNOWN },
      { label: "Webhook", state: latestEvent ? { tone: "good", label: "Receiving" } : events.ok ? { tone: "neutral", label: "No events" } : CONFIG_UNKNOWN },
      { label: "Import pipeline", state: snaps.ok ? { tone: pipeline.tone, label: pipeline.label } : CONFIG_UNKNOWN },
    ],
    journey: {
      subtitle: stepsSnap ? `${nameById.get(stepsSnap.store_id ?? "") ?? "Unresolved store"} · ${stepsSnap.path.split("/").pop() ?? stepsSnap.path}` : "No file recorded",
      steps,
      importId: stepsSnap?.run_id ?? latestRun?.id ?? null,
    },
  };
}

export interface MappingRule { id: string; source: string; normalized: string; transform: string; required: string }
export interface MappingModel {
  ownership: StageModel[];
  rules: MappingRule[];
  rulesNote: string;
}

interface SchemaRow { feed_key: string; version: string; status: string; fields: unknown }

function parseRules(fields: unknown): MappingRule[] {
  if (!Array.isArray(fields)) return [];
  const out: MappingRule[] = [];
  for (const f of fields) {
    if (!f || typeof f !== "object") continue;
    const o = f as Record<string, unknown>;
    const source = typeof o.source === "string" ? o.source : typeof o.name === "string" ? o.name : null;
    if (!source) continue;
    const normalized = typeof o.normalized === "string" ? o.normalized : typeof o.field === "string" ? o.field : "Not recorded";
    const transform = typeof o.transform === "string" ? o.transform : typeof o.rule === "string" ? o.rule : "Not recorded";
    const required = o.required === true ? "Yes" : o.required === false ? "No" : "Not recorded";
    out.push({ id: source, source, normalized, transform, required });
  }
  return out;
}

export async function loadMapping(): Promise<MappingModel> {
  const [snaps, stores, rules, policies, schemas] = await Promise.all([
    settle(readRows<SnapRow>("inventory_store_snapshots", "id,run_id,path,source_dealer_id,store_id,status,reason,row_count,valid_count,created_at,applied_at", { order: "created_at", limit: 1 })),
    settle(readRows<StoreRow>("dealer_stores", "id,display_name,group_id", { limit: 1000 })),
    settle(readRows<RuleRow>("inventory_sharing_rules", "source_store_id,destination_store_id,status,show_prices", { limit: 500 })),
    settle(readRows<PolicyRow>("store_enrichment_policies", "store_id,mode,budget_blocked", { limit: 1000 })),
    settle(readRows<SchemaRow>("bulk_feed_schema_versions", "feed_key,version,status,fields", { filters: [{ col: "status", op: "eq", value: "current" }], limit: 1 })),
  ]);
  if (!snaps.ok) throw new Error(`Feed snapshots are not readable: ${snaps.error}`);
  const snap = snaps.value[0];
  const nameById = new Map(val(stores).map((s) => [s.id, s.display_name]));
  const owner = snap?.store_id ?? null;
  const viewers = owner ? val(rules).filter((r) => r.source_store_id === owner && r.status === "active") : [];
  const pol = owner ? val(policies).find((p) => p.store_id === owner) : undefined;
  const unknown = (label: string, value: string, readable: boolean): StageModel => ({ key: label, label, value: readable ? value : "Unknown", tone: readable ? "info" : "neutral" });
  const ownership: StageModel[] = [
    unknown("Folder", snap?.path ?? "No file recorded", true),
    unknown("Feed source", snap?.source_dealer_id ?? "Not recorded", true),
    { key: "owner", label: "Owner", value: owner ? nameById.get(owner) ?? "Unresolved store" : "Not resolved", tone: owner ? "good" : "neutral" },
    unknown("Viewers", viewers.length ? viewers.map((r) => `${nameById.get(r.destination_store_id) ?? "Unresolved"} only`).join(", ") : "No other store", rules.ok && !!owner),
    unknown("Enrichment", !pol || pol.mode === "feed_only" ? "Feed only" : `${nameById.get(owner ?? "") ?? "Owner"} budget`, policies.ok && !!owner),
  ];
  const parsed = schemas.ok && schemas.value[0] ? parseRules(schemas.value[0].fields) : [];
  return {
    ownership,
    rules: parsed,
    rulesNote: schemas.ok
      ? "No column-level mapping rules are recorded for this feed. Mapping is defined in the importer and is not stored as telemetry."
      : "Mapping rules are not readable.",
  };
}
