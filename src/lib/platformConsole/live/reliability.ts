import type { MetricModel, Tone } from "../types";
import { readRows, relativeAge, settle } from "./read";

export interface JourneyRow {
  id: string;
  name: string;
  result: { label: string; tone: Tone };
  impact: string;
  href?: string;
}

export interface ReliabilityModel {
  metrics: MetricModel[];
  journeys: JourneyRow[];
  recoveryHelper: string;
  recoveryLines: string[];
  releaseHelper: string;
  releaseText: string;
}

interface QueuedJobRow { id: string; created_at: string }

const none = (key: string, icon: MetricModel["icon"], label: string, helper: string): MetricModel => ({ key, icon, label, value: "Not monitored", tone: "neutral", helper, provenance: { source: "none", asOf: null, state: "not_monitored", scope: label } });
const NOT_MONITORED = { label: "Not monitored", tone: "neutral" as Tone };

/**
 * Only the oldest queued feed job is measured here. Customer journeys,
 * response times, backups, restore drills and release versions have no
 * recorded telemetry, so each says Not monitored rather than showing a value.
 */
export async function loadReliability(now = Date.now()): Promise<ReliabilityModel> {
  const queued = await settle(readRows<QueuedJobRow>("inventory_feed_jobs", "id,created_at", { filters: [{ col: "status", op: "eq", value: "queued" }], order: "created_at", ascending: true, limit: 1 }));
  const asOf = new Date(now).toISOString();
  const queue: MetricModel = !queued.ok
    ? { key: "queue", icon: "layers", label: "Oldest queued job", value: "Unknown", tone: "neutral", helper: "The feed job queue is not readable yet", provenance: { source: "inventory_feed_jobs", asOf: null, state: "unknown", scope: "Feed jobs" } }
    : queued.value.length === 0
      ? { key: "queue", icon: "layers", label: "Oldest queued job", value: "None queued", tone: "good", helper: "Feed job queue only · other workflows not measured", provenance: { source: "inventory_feed_jobs", asOf, state: "healthy", scope: "Feed jobs" } }
      : { key: "queue", icon: "layers", label: "Oldest queued job", value: relativeAge(queued.value[0].created_at, now), tone: "info", helper: "Feed job queue only · no threshold configured", provenance: { source: "inventory_feed_jobs", asOf, state: "healthy", scope: "Feed jobs" } };
  return {
    metrics: [
      none("journeys", "activity", "Journey checks", "No synthetic journey checks are configured"),
      none("api", "clock", "API response p95", "No request timing is recorded"),
      queue,
      none("restore", "archive", "Restore verification", "No restore drill is recorded"),
    ],
    journeys: [
      { id: "login", name: "Login / store selection", result: NOT_MONITORED, impact: "No synthetic check" },
      { id: "passport", name: "Passport / estimate", result: NOT_MONITORED, impact: "No synthetic check" },
      { id: "document", name: "Document download", result: NOT_MONITORED, impact: "No synthetic check" },
      { id: "lead", name: "Lead → assignment", result: NOT_MONITORED, impact: "No synthetic check" },
    ],
    recoveryHelper: "Database and stored objects are separate",
    recoveryLines: ["Database backup: not monitored", "Object backup: not monitored", "Restore drill: not recorded"],
    releaseHelper: "Relate symptoms to frontend, edge functions, migrations and configuration changes.",
    releaseText: "Not monitored: deployed UI, function and migration versions are not recorded here yet.",
  };
}
