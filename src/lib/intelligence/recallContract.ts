// ── VIN recall contract (master build section 17) ──────────────────────────
//
// The stored recall columns are read through vehicleTruth/recallView, which
// already refuses to let a model-level NHTSA answer or a legacy 404 clear a
// VIN. This module maps that view onto the current contract's seven VIN
// states, keeps the model context beside it, and writes the one public
// sentence a customer may see. An unanswered attempt is told apart by the
// note the classifier stored: a 401 or 403 is an entitlement block, a 429,
// 5xx or transport error is the provider being unavailable, and a VIN the
// product has no record of is simply unknown. None of them is "no recalls".

import {
  deriveRecallView, RECALL_STALE_DAYS, type RecallModelState, type RecallRowInput, type RecallVinState,
} from "../vehicleTruth/recallView.ts";
import { resolveFreshness, type PublicState, type RecallSummary, type VinRecallContractState } from "./contracts.ts";

export const RECALL_CONTRACT_VERSION = "recall-contract-v1.0.0";
export const DEFAULT_RECALL_TTL_DAYS = RECALL_STALE_DAYS;
/** The documented current path. The code still calls the legacy family below until autorecalls_vin is on. */
export const CURRENT_AUTORECALLS_PATH = "/v2/car/autorecalls/{vin}";
export const LEGACY_RECALL_PATHS = [
  "/v2/recall/car/{vin}", "mc-api /v2/recall/car/{vin}", "/v2/recall/car?vin={vin}", "/v2/recalls/car/{vin}",
] as const;

export type VinAttemptOutcome = "answered" | "entitlement_blocked" | "provider_unavailable" | "not_on_file" | "not_attempted";

export interface RecallContractInput {
  row: RecallRowInput | null | undefined;
  /** The latest VIN attempt's outcome when the caller knows it; otherwise it is read from the stored note. */
  attemptOutcome?: VinAttemptOutcome | null;
  /** True when every campaign the VIN answer carries is a manufacturer service campaign, not a safety recall. */
  oemServiceCampaignOnly?: boolean;
  nowMs: number;
}

export interface RecallContractOptions { ttlDays?: number }

const noteOf = (row: RecallRowInput | null | undefined): string | null => {
  const check = row?.recall_check;
  if (!check || typeof check !== "object" || Array.isArray(check)) return null;
  const n = (check as Record<string, unknown>).note;
  return typeof n === "string" && n.trim() ? n.trim().toLowerCase() : null;
};

/** The classifier's stored note, read back as an outcome. */
export function readAttemptOutcome(note: string | null | undefined): VinAttemptOutcome {
  const n = (note ?? "").toLowerCase();
  if (!n) return "not_attempted";
  if (/http_(401|403)\b/.test(n) || /entitle|forbidden|unauthori[sz]ed|plan_scope/.test(n)) return "entitlement_blocked";
  if (/rate_limited|http_429|http_5\d\d|transport_error|timeout|unreachable|unavailable/.test(n)) return "provider_unavailable";
  if (/not_on_file|http_404|no_record/.test(n)) return "not_on_file";
  return "not_attempted";
}

const asOf = (iso: string | null): string | null =>
  iso && Number.isFinite(Date.parse(iso))
    ? new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" })
    : null;

const modelSentence = (state: RecallModelState | null, count: number | null): string | null => {
  switch (state) {
    case "MODEL_CAMPAIGNS_FOUND":
      return `NHTSA lists ${count === 1 ? "1 safety campaign" : `${count ?? 0} safety campaigns`} for this year, make and model; that is model-level context, not a check of this VIN.`;
    case "NO_MODEL_CAMPAIGNS_FOUND":
      return "NHTSA lists no safety campaigns for this year, make and model; that is model-level context, not a check of this VIN.";
    default:
      return null;
  }
};

export function summarizeRecall(input: RecallContractInput, options: RecallContractOptions = {}): RecallSummary {
  const ttlDays = options.ttlDays ?? DEFAULT_RECALL_TTL_DAYS;
  const view = deriveRecallView(input.row, { now: input.nowMs, staleDays: ttlDays });
  const vin = view.vin;
  const modelState: RecallModelState | null = view.model?.state ?? null;
  const modelCount = view.model?.campaignCount ?? null;
  const closedOnFile = view.campaigns.filter((c) => !c.open).length;
  const storedClosed = input.row?.closed_recall_count;
  const closedCount = typeof storedClosed === "number" && storedClosed >= 0 ? storedClosed : (closedOnFile || null);
  const attempt = input.attemptOutcome ?? readAttemptOutcome(noteOf(input.row));
  const date = asOf(vin.checkedAt);
  const model = modelSentence(modelState, modelCount);

  let vinState: VinRecallContractState;
  let truthState: RecallVinState | null = vin.state;
  let publicState: PublicState;
  let statement: string;

  if (view.doNotDrive) {
    vinState = "OPEN";
    truthState = "OPEN";
    publicState = "adverse";
    statement = `A VIN-level recall check reports an open manufacturer campaign with do-not-drive language${date ? ` as of ${date}` : ""}. The remedy must be recorded before this vehicle is driven or delivered.`;
  } else if (vin.state === "OPEN") {
    vinState = "OPEN";
    publicState = "adverse";
    const n = vin.openCount ?? 0;
    statement = `A VIN-level recall check reports ${n > 0 ? `${n} open manufacturer campaign${n === 1 ? "" : "s"}` : "an open manufacturer campaign"}${date ? ` as of ${date}` : ""}.`;
  } else if (vin.state === "STALE") {
    if (view.riskSignalled) {
      vinState = "OPEN";
      truthState = "OPEN";
      publicState = "adverse";
      statement = `A VIN-level recall check last reported an open manufacturer campaign${date ? ` on ${date}` : ""}; that answer is older than ${ttlDays} days and must be re-checked, and the campaign is treated as open until it is.`;
    } else {
      vinState = "UNKNOWN";
      publicState = "stale";
      statement = `The last VIN-level recall check${date ? ` (${date})` : ""} is older than ${ttlDays} days; re-check before relying on it.`;
    }
  } else if (view.conflict) {
    vinState = "UNKNOWN";
    truthState = "UNKNOWN";
    publicState = "warning";
    statement = "Recall records on file disagree; VIN-level recall status needs confirmation with the manufacturer.";
  } else if (vin.state === "VERIFIED_CLEAR" && vin.clearClaimAllowed) {
    if (input.oemServiceCampaignOnly) {
      vinState = "OEM_SERVICE_CAMPAIGN";
      publicState = "warning";
      statement = `A VIN-level check reports no open safety recall${date ? ` as of ${date}` : ""}; a manufacturer service campaign applies to this vehicle, which is not a safety recall.`;
    } else if ((closedCount ?? 0) > 0) {
      vinState = "CLOSED_CAMPAIGN_ONLY";
      publicState = "verified";
      statement = `A VIN-level recall check reported no open campaigns${date ? ` as of ${date}` : ""}; ${closedCount} earlier campaign${closedCount === 1 ? " is" : "s are"} recorded as completed.`;
    } else {
      vinState = "NO_OPEN";
      publicState = "verified";
      statement = `A VIN-level recall check reported no open campaigns for this vehicle${date ? ` as of ${date}` : ""}.`;
    }
  } else {
    truthState = "UNKNOWN";
    if (attempt === "entitlement_blocked") {
      vinState = "ENTITLEMENT_BLOCKED";
      publicState = "unavailable";
    } else if (attempt === "provider_unavailable") {
      vinState = "PROVIDER_UNAVAILABLE";
      publicState = "unavailable";
    } else {
      vinState = "UNKNOWN";
      publicState = "unknown";
    }
    statement = ["VIN-level recall status has not been verified for this vehicle.", model].filter(Boolean).join(" ");
  }

  const openCount = vinState === "OPEN"
    ? (vin.openCount ?? null)
    : vin.state === "VERIFIED_CLEAR" && vin.clearClaimAllowed ? 0 : null;

  return {
    vinState,
    truthState,
    openCount,
    closedCount,
    modelState,
    modelCampaignCount: modelCount,
    doNotDrive: view.doNotDrive,
    checkedAt: vin.checkedAt,
    publicState,
    publicStatement: statement,
    freshness: resolveFreshness({ checkedAt: vin.checkedAt, ttlDays, nowMs: input.nowMs }),
  };
}

/** Words a public recall statement may never contain. */
export const FORBIDDEN_RECALL_WORDS = /\b(clean|guarantee[ds]?|recall[- ]free)\b/i;
