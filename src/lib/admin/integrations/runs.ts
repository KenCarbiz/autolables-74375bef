import { classifyRunOutcome, RUN_OUTCOME_META, type HealthTone, type RunLike, type RunOutcome } from "@/lib/admin/health";

// One inventory sync run, read from the ledger the sync writes. Everything a
// dealer sees about a run is derived here from the row itself; nothing is
// inferred from the raw message text when a typed field answers the question.

export interface SyncRunRow {
  id: string;
  tenant_id?: string;
  source: string | null;
  started_at: string;
  finished_at: string | null;
  status: string | null;
  num_found: number | null;
  seen: number | null;
  new_vehicles: number | null;
  updated_vehicles: number | null;
  prices_recorded: number | null;
  removed: number | null;
  http_status: number | null;
  matched_dealer: string | null;
  error_summary: string | null;
  raw: Record<string, unknown> | null;
}

export interface SyncErrorRow {
  id: string;
  vin: string | null;
  code: string | null;
  message: string | null;
  created_at: string;
}

const rawKind = (run: SyncRunRow): string | null => {
  const k = run.raw && typeof run.raw === "object" ? (run.raw as { kind?: unknown }).kind : null;
  return typeof k === "string" ? k : null;
};

/**
 * The sync records what a pinned feed actually said in `raw.kind`
 * (provider_refused, empty_answer, scope_mismatch). That typed fact wins over
 * the message text; the keystone classifier handles every other row.
 */
export function outcomeForRun(run: SyncRunRow): RunOutcome {
  const kind = rawKind(run);
  const status = (run.status ?? "").toLowerCase();
  if (status === "failed" && kind === "provider_refused") {
    const http = run.http_status ?? 0;
    if (http === 429) return "provider_rate_limited";
    if (http === 401 || http === 403) return "provider_auth_failed";
    if (http >= 500) return "provider_error";
    if (http === 0) return "transport_error";
    return "provider_error";
  }
  if (status === "failed" && kind === "empty_answer") return "valid_empty";
  if (status === "failed" && kind === "scope_mismatch") return "identity_hold";
  return classifyRunOutcome(run);
}

/**
 * The keystone health rule classifies with `classifyRunOutcome`. A row whose
 * typed kind disagrees with its message text is translated into that rule's
 * vocabulary first, so the banner and the table never tell different stories.
 */
export function canonicalRunLike(run: SyncRunRow, outcome: RunOutcome): RunLike {
  switch (outcome) {
    case "success":
      return { status: "success", http_status: run.http_status, error_summary: null, seen: run.seen, num_found: run.num_found };
    case "partial":
      return { status: "partial", http_status: run.http_status, error_summary: run.error_summary, seen: run.seen, num_found: run.num_found };
    case "valid_empty":
      return { status: "empty_valid", http_status: run.http_status, error_summary: null, seen: 0, num_found: 0 };
    case "skipped":
      return { status: "skipped", http_status: null, error_summary: run.error_summary };
    case "provider_rate_limited":
      return { status: "failed", http_status: 429, error_summary: "refused_429" };
    case "provider_auth_failed":
      return { status: "failed", http_status: run.http_status === 401 ? 401 : 403, error_summary: run.http_status === 401 ? "refused_401" : "refused_403" };
    case "provider_error":
      return { status: "failed", http_status: run.http_status !== null && run.http_status >= 500 ? run.http_status : 502, error_summary: "provider error" };
    case "identity_hold":
      return { status: "failed", http_status: 200, error_summary: "identity hold: pinned_scope mismatch" };
    case "transport_error":
      return { status: "failed", http_status: null, error_summary: "transport error: no answer" };
    default:
      return { status: "failed", http_status: null, error_summary: null };
  }
}

export function httpReason(status: number | null | undefined): string | null {
  if (status === null || status === undefined) return null;
  const table: Record<number, string> = {
    200: "OK",
    204: "No content",
    400: "Bad request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not found",
    408: "Request timeout",
    429: "Too Many Requests",
    500: "Server error",
    502: "Bad gateway",
    503: "Service unavailable",
    504: "Gateway timeout",
  };
  if (table[status]) return table[status];
  if (status >= 500) return "Provider error";
  if (status >= 400) return "Request refused";
  if (status >= 200 && status < 300) return "OK";
  return null;
}

const n = (v: number | null | undefined): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export function inventoryChangesLabel(run: SyncRunRow, outcome: RunOutcome): string {
  switch (outcome) {
    case "success": {
      const parts = [`${n(run.new_vehicles)} new`, `${n(run.updated_vehicles)} updated`];
      if (n(run.removed) > 0) parts.push(`${n(run.removed)} retired`);
      return run.seen !== null && run.seen !== undefined ? `${run.seen} seen` : parts.join(" · ");
    }
    case "partial":
      return `${n(run.seen)} seen, errors`;
    case "valid_empty":
      return "None (nothing retired)";
    case "skipped":
      return "None";
    default:
      return "None (retained)";
  }
}

export function detailsLabel(run: SyncRunRow, outcome: RunOutcome): string {
  switch (outcome) {
    case "provider_rate_limited":
      return "Rate limit from provider";
    case "provider_auth_failed":
      return "Credential rejected by provider";
    case "provider_error":
      return "Provider error";
    case "transport_error":
      return "No answer from provider";
    case "identity_hold":
      return "Scope did not match this rooftop";
    case "valid_empty":
      return "Feed answered with no vehicles";
    case "skipped": {
      const overdue = run.raw && typeof run.raw === "object" ? Number((run.raw as { overdue_hours?: unknown }).overdue_hours) : 0;
      return overdue > 0 ? `Scheduled run (overdue by ${Math.round(overdue)} h)` : "Scheduled run (cadence)";
    }
    case "success":
      return "Inventory updated";
    case "partial":
      return "Completed with per-vehicle errors";
    default:
      return run.error_summary ? run.error_summary.slice(0, 80) : "Failed";
  }
}

export const httpLabel = (run: SyncRunRow): string => (run.http_status === null || run.http_status === undefined ? "–" : String(run.http_status));

export interface RunTimelineEvent {
  at: string | null;
  label: string;
  detail: string;
  tone: HealthTone;
}

export function sourceHost(run: SyncRunRow | null, configSource: string | null | undefined): string | null {
  const raw = run?.source || (run?.raw && typeof run.raw === "object" ? String((run.raw as { source?: unknown }).source ?? "") : "") || configSource || "";
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
}

/** Events a run row can vouch for. Timestamps are the row's own; nothing is invented between them. */
export function buildRunTimeline(run: SyncRunRow, outcome: RunOutcome, host: string | null): RunTimelineEvent[] {
  const end = run.finished_at ?? null;
  const target = host ? ` for ${host}` : "";
  const events: RunTimelineEvent[] = [];
  const forced = run.raw && typeof run.raw === "object" && (run.raw as { force?: unknown }).force === true;
  events.push({ at: run.started_at, label: forced ? "Manual run started" : "Scheduled run started", detail: `Inventory sync run triggered${target}.`, tone: "success" });
  switch (outcome) {
    case "skipped":
      events.push({ at: run.started_at, label: "Run skipped", detail: detailsLabel(run, outcome) + ". No request was made to the provider.", tone: "neutral" });
      return events;
    case "provider_rate_limited":
    case "provider_auth_failed":
    case "provider_error":
      events.push({ at: end, label: `Provider returned ${run.http_status ?? "an error"}`, detail: `Received HTTP ${run.http_status ?? "error"}${httpReason(run.http_status) ? ` (${httpReason(run.http_status)})` : ""} from provider.`, tone: "danger" });
      events.push({ at: end, label: "Inventory preservation applied", detail: "No inventory was imported or retired. Existing rooftop identity retained.", tone: "info" });
      if (RUN_OUTCOME_META[outcome].retryable) events.push({ at: end, label: "Retry pending review", detail: "Run marked for retry. Review provider quota and retry policy before re-running.", tone: "neutral" });
      return events;
    case "transport_error":
      events.push({ at: end, label: "Provider did not answer", detail: "The request timed out or the connection failed.", tone: "danger" });
      events.push({ at: end, label: "Inventory preservation applied", detail: "No inventory was imported or retired. Existing rooftop identity retained.", tone: "info" });
      events.push({ at: end, label: "Retry pending", detail: "The next scheduled run will try again.", tone: "neutral" });
      return events;
    case "identity_hold":
      events.push({ at: end, label: `Provider returned ${run.http_status ?? 200}`, detail: "The feed answered with vehicles that did not match this rooftop.", tone: "warning" });
      events.push({ at: end, label: "Identity hold applied", detail: "No inventory was imported or retired. The source identity needs review before any change.", tone: "warning" });
      return events;
    case "valid_empty":
      events.push({ at: end, label: `Provider returned ${run.http_status ?? 200}`, detail: "The feed answered with zero vehicles.", tone: "info" });
      events.push({ at: end, label: "Nothing retired", detail: "An empty answer never retires inventory automatically.", tone: "info" });
      return events;
    case "success":
    case "partial":
      events.push({ at: end, label: `Provider returned ${run.http_status ?? 200}`, detail: `${n(run.num_found)} listed by the provider, ${n(run.seen)} matched this rooftop.`, tone: "success" });
      events.push({ at: end, label: outcome === "partial" ? "Inventory updated with errors" : "Inventory updated", detail: `${n(run.new_vehicles)} new, ${n(run.updated_vehicles)} updated, ${n(run.removed)} retired, ${n(run.prices_recorded)} prices recorded.`, tone: outcome === "partial" ? "warning" : "success" });
      return events;
    default:
      events.push({ at: end, label: "Run failed", detail: run.error_summary ? run.error_summary.slice(0, 160) : "The ledger did not record a reason.", tone: "danger" });
      events.push({ at: end, label: "Inventory preservation", detail: "Whether inventory was touched is not recorded for this run; review the evidence.", tone: "warning" });
      return events;
  }
}

export const REDACTED = "[redacted]";
const SENSITIVE_KEY = /key|token|secret|authorization|cookie|password|signature|bearer|credential/i;
const MAX_DEPTH = 4;
const MAX_ITEMS = 20;
const MAX_STRING = 400;

/** Provider evidence a dealer may see: secrets removed by key name, payloads bounded. */
export function redactEvidence(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}… (${value.length} chars)` : value;
  if (typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return "[nested]";
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ITEMS).map((v) => redactEvidence(v, depth + 1));
    if (value.length > MAX_ITEMS) items.push(`… ${value.length - MAX_ITEMS} more`);
    return items;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEY.test(k) ? REDACTED : redactEvidence(v, depth + 1);
  }
  return out;
}

export interface RunImpact {
  newVehicles: number | null;
  updated: number | null;
  retired: number | null;
  prices: number | null;
}

export function runImpact(run: SyncRunRow, outcome: RunOutcome): RunImpact {
  if (outcome === "success" || outcome === "partial") {
    return { newVehicles: n(run.new_vehicles), updated: n(run.updated_vehicles), retired: n(run.removed), prices: n(run.prices_recorded) };
  }
  if (outcome === "failed_unknown") return { newVehicles: null, updated: null, retired: null, prices: null };
  return { newVehicles: 0, updated: 0, retired: 0, prices: 0 };
}

export const inventoryWrites = (impact: RunImpact): number | null =>
  impact.newVehicles === null || impact.updated === null || impact.retired === null ? null : impact.newVehicles + impact.updated + impact.retired;

export interface RunGuidance {
  title: string;
  detail: string;
}

export function diagnosisFor(outcome: RunOutcome, run: SyncRunRow): RunGuidance & { tone: HealthTone } {
  switch (outcome) {
    case "provider_rate_limited":
      return { tone: "danger", title: "The provider declined this request", detail: "No inventory was imported or retired. A rate-limit response does not establish a rooftop mismatch." };
    case "provider_auth_failed":
      return { tone: "danger", title: "The provider rejected the credential", detail: "No inventory was imported or retired. The source identity and the pin are unchanged; the credential, not the rooftop, needs attention." };
    case "provider_error":
      return { tone: "danger", title: "The provider failed to answer", detail: "No inventory was imported or retired. A provider-side error says nothing about this rooftop's identity." };
    case "transport_error":
      return { tone: "danger", title: "The request did not reach the provider", detail: "No inventory was imported or retired. The next scheduled run will try again." };
    case "identity_hold":
      return { tone: "warning", title: "The feed did not match this rooftop", detail: "The provider answered with vehicles from another store. Nothing was imported or retired; the source identity is on hold until it is reviewed." };
    case "valid_empty":
      return { tone: "info", title: "The feed answered with no vehicles", detail: "The provider answered normally and listed nothing for this source. Nothing was retired. Confirm the source scope before trusting the empty result." };
    case "skipped":
      return { tone: "neutral", title: "This run was skipped on cadence", detail: "No request was made. The last real attempt decides feed health." };
    case "partial":
      return { tone: "warning", title: "The pull completed with per-vehicle errors", detail: "Most of the feed was applied; the vehicles that failed are listed below." };
    case "success":
      return { tone: "success", title: "The pull completed", detail: `${n(run.seen)} vehicles matched this rooftop; the inventory was updated.` };
    default:
      return { tone: "danger", title: "The run failed", detail: run.error_summary ? run.error_summary.slice(0, 200) : "The ledger did not classify the failure. Review the technical evidence." };
  }
}

export function nextStepFor(outcome: RunOutcome, http: number | null): RunGuidance {
  switch (outcome) {
    case "provider_rate_limited":
      return { title: "Review provider quota and retry policy", detail: `The provider returned a rate-limit response${http ? ` (HTTP ${http})` : ""}. Review your quota limits and retry policy, then let the next scheduled run try again.` };
    case "provider_auth_failed":
      return { title: "Review the provider credential", detail: "The provider rejected the integration credential. Review it with support; do not change the source identity." };
    case "provider_error":
    case "transport_error":
      return { title: "Retry on the next schedule", detail: "Nothing on this rooftop's side changed. If the next scheduled run fails the same way, review the provider status with support." };
    case "identity_hold":
      return { title: "Review source identity", detail: "Compare the pinned rooftop against the address the provider holds for this store before any change. Clearing the pin is a separate, confirmed action." };
    case "valid_empty":
      return { title: "Confirm the source scope", detail: "Check that the source still lists this rooftop's inventory. Nothing was retired; the previous inventory stands." };
    case "partial":
      return { title: "Review the per-vehicle errors", detail: "The vehicles that failed are listed with their reason. The rest of the feed was applied." };
    case "skipped":
      return { title: "No action needed", detail: "The run was skipped on cadence." };
    case "success":
      return { title: "No action needed", detail: "The pull completed and the inventory was updated." };
    default:
      return { title: RUN_OUTCOME_META.failed_unknown.nextSafeAction, detail: "Open the technical evidence for this run." };
  }
}
