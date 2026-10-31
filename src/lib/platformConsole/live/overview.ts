import type { AttentionRow, MetricModel, StageModel, TimelineItem, Tone } from "../types";
import { consolePath } from "../sections";
import { readRows, relativeAge, settle, sinceHours } from "./read";

export interface OverviewModel {
  metrics: MetricModel[];
  attention: AttentionRow[];
  /** Why the attention list is empty, when it is: "none found" differs from "not monitored". */
  attentionNote: string;
  operations: TimelineItem[];
  operationsNote: string;
  stages: StageModel[];
  stagesNote: string;
  liveChannel: "connected" | "disconnected" | "polling";
  /** Phone wording, when the phone reference differs from the desktop one. Live falls back to the desktop rows. */
  phone?: {
    metricHelper: string;
    attention: { id: string; title: string; detail: string; tone: Tone; href: string }[];
    operations: TimelineItem[];
  };
}

interface StoreRow { id: string; display_name: string; status: string; subscription_status: string; feed_import_paused: boolean }
interface StoreStateRow { store_id: string; last_applied_at: string | null; last_failure_at: string | null; last_failure_reason: string | null }
interface RunRow { id: string; kind: string; status: string; failure_reason: string | null; started_at: string; finished_at: string | null }
interface EventRow { id: string; action: string; path: string; received_at: string }
interface SnapshotRow { id: string; store_id: string; status: string; created_at: string }
interface ProviderRequestRow { status: string }

const SUCCESS = new Set(["succeeded", "completed", "applied", "success"]);

export async function loadOverview(now = Date.now()): Promise<OverviewModel> {
  const day = sinceHours(now, 24);
  const month = new Date(new Date(now).getFullYear(), new Date(now).getMonth(), 1).toISOString();
  const [stores, states, runs, events, snapshots, requests] = await Promise.all([
    settle(readRows<StoreRow>("dealer_stores", "id,display_name,status,subscription_status,feed_import_paused", { limit: 1000 })),
    settle(readRows<StoreStateRow>("inventory_store_state", "store_id,last_applied_at,last_failure_at,last_failure_reason", { limit: 1000 })),
    settle(readRows<RunRow>("inventory_feed_runs", "id,kind,status,failure_reason,started_at,finished_at", { filters: [{ col: "started_at", op: "gte", value: day }], order: "started_at", limit: 1000 })),
    settle(readRows<EventRow>("inventory_feed_events", "id,action,path,received_at", { filters: [{ col: "received_at", op: "gte", value: day }], order: "received_at", limit: 1000 })),
    settle(readRows<SnapshotRow>("inventory_store_snapshots", "id,store_id,status,created_at", { filters: [{ col: "created_at", op: "gte", value: day }], order: "created_at", limit: 1000 })),
    settle(readRows<ProviderRequestRow>("provider_requests", "status", { filters: [{ col: "created_at", op: "gte", value: month }], limit: 5000 })),
  ]);
  const asOf = new Date(now).toISOString();

  // Stores needing attention: a recorded failure newer than the last applied snapshot.
  const storeById = new Map((stores.ok ? stores.value : []).map((s) => [s.id, s]));
  const failing = (states.ok ? states.value : []).filter((s) => s.last_failure_at && (!s.last_applied_at || s.last_failure_at > s.last_applied_at));
  const attention: AttentionRow[] = failing
    .sort((a, b) => (b.last_failure_at ?? "").localeCompare(a.last_failure_at ?? ""))
    .slice(0, 8)
    .map((s) => ({
      id: s.store_id,
      severity: "high",
      store: storeById.get(s.store_id)?.display_name ?? "Unresolved store",
      issue: s.last_failure_reason ? `Import failed: ${s.last_failure_reason}` : "Import failed; no reason recorded",
      age: relativeAge(s.last_failure_at, now),
      actionLabel: "Inspect store",
      href: consolePath.store(s.store_id),
    }));
  const storeTotal = stores.ok ? stores.value.filter((s) => s.status === "active").length : 0;

  const imports = runs.ok ? runs.value.filter((r) => r.kind === "import" && r.finished_at) : [];
  const importOk = imports.filter((r) => SUCCESS.has(r.status)).length;

  const consumed = requests.ok ? requests.value.filter((r) => r.status === "consumed").length : 0;
  const uncertain = requests.ok ? requests.value.filter((r) => r.status === "billing_uncertain").length : 0;

  const metrics: MetricModel[] = [
    stores.ok && states.ok
      ? { key: "stores", icon: "store", label: "Stores needing attention", value: `${failing.length} / ${storeTotal}`, tone: failing.length ? "warn" : "good", helper: failing.length ? `${failing.length} with an unresolved import failure` : "No unresolved import failures recorded", provenance: { source: "inventory_store_state", asOf, state: "healthy", scope: "All active stores" } }
      : { key: "stores", icon: "store", label: "Stores needing attention", value: "Unknown", tone: "neutral", helper: "Store state is not readable yet", provenance: { source: "inventory_store_state", asOf: null, state: "unknown", scope: "All active stores" } },
    runs.ok
      ? imports.length
        ? { key: "imports", icon: "file", label: "Imports succeeded", value: `${((importOk / imports.length) * 100).toFixed(1)}%`, tone: importOk === imports.length ? "info" : "warn", helper: `Last 24h · ${importOk} / ${imports.length} finished runs · no service target set`, provenance: { source: "inventory_feed_runs", asOf, state: "healthy", scope: "Last 24 hours" } }
        : { key: "imports", icon: "file", label: "Imports succeeded", value: "No runs", tone: "neutral", helper: "Last 24h · 0 finished import runs", provenance: { source: "inventory_feed_runs", asOf, state: "healthy", scope: "Last 24 hours" } }
      : { key: "imports", icon: "file", label: "Imports succeeded", value: "Unknown", tone: "neutral", helper: "Run history is not readable yet", provenance: { source: "inventory_feed_runs", asOf: null, state: "unknown", scope: "Last 24 hours" } },
    { key: "journeys", icon: "activity", label: "Customer journey checks", value: "Not monitored", tone: "neutral", helper: "No synthetic journey checks are configured", provenance: { source: "none", asOf: null, state: "not_monitored", scope: "Synthetic journeys" } },
    requests.ok
      ? { key: "cost", icon: "dollar", label: "Measured provider cost", value: "Unknown", tone: "neutral", helper: `${consumed} metered calls this month${uncertain ? ` · ${uncertain} billing uncertain` : ""} · no confirmed price`, provenance: { source: "provider_requests", asOf, state: "unknown", scope: "This month" } }
      : { key: "cost", icon: "dollar", label: "Measured provider cost", value: "Unknown", tone: "neutral", helper: "Provider metering is not readable yet", provenance: { source: "provider_requests", asOf: null, state: "unknown", scope: "This month" } },
  ];

  const operations: TimelineItem[] = [];
  for (const r of (runs.ok ? runs.value : []).slice(0, 3)) {
    const ok = SUCCESS.has(r.status);
    operations.push({ id: `run-${r.id}`, tone: ok ? "good" : r.status === "running" || r.status === "queued" ? "info" : "warn", title: `${r.kind === "import" ? "Import" : "Dry run"} ${r.status}`, detail: r.failure_reason ?? relativeAge(r.started_at, now) + " ago" });
  }

  const snaps = snapshots.ok ? snapshots.value : [];
  const stage = (key: string, label: string, ok: boolean, count: number, noun: string, held = 0): StageModel =>
    !ok ? { key, label, value: "Unknown", tone: "neutral" } : { key, label, value: held ? `${held} held` : `${count} ${noun}`, tone: held ? "warn" : count ? "good" : "neutral" };
  const stages: StageModel[] = [
    stage("received", "Received", events.ok, events.ok ? events.value.length : 0, "files"),
    stage("validated", "Validated", snapshots.ok, snaps.filter((s) => s.status !== "rejected").length, "passed", snaps.filter((s) => s.status === "quarantined" || s.status === "rejected").length),
    stage("imported", "Imported", runs.ok, importOk, "complete"),
    { key: "calculated", label: "Calculated", value: "Not monitored", tone: "neutral" },
    stage("published", "Published", snapshots.ok, snaps.filter((s) => s.status === "applied").length, "updates"),
  ];

  return {
    metrics,
    attention,
    attentionNote: states.ok ? "No unresolved store failures are recorded. Incident detection beyond import failures is not instrumented yet." : "Store state is not readable, so attention items are unknown.",
    operations,
    operationsNote: runs.ok ? "No feed runs in the last 24 hours. Quiet between scheduled feeds can be normal." : "Run history is not readable yet.",
    stages,
    stagesNote: "Last 24 hours · inspect each stage for its source",
    liveChannel: "polling",
  };
}
