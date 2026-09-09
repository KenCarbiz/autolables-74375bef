// ── The one way a READER is allowed to look at a recall answer ──────────────
//
// There are TWO questions here and this product spent its whole life
// answering them with one column.
//
//   1. VIN RECALL VERIFICATION — "does THIS VIN currently have an applicable
//      open recall?" Only a VIN-level source can answer it. MarketCheck's
//      licensed AutoRecalls product is the intended one; as of 2026-09-09 it
//      has never returned a single stored row, so the honest VIN answer for
//      the whole pilot lot is UNKNOWN.
//   2. MODEL RECALL CAMPAIGN CONTEXT — "are there campaigns for this
//      year/make/model?" NHTSA's recallsByVehicle answers this, and only this.
//      It is useful context. It is not VIN clearance.
//
// The collapse of 2 into 1 is the defect this module exists to make
// impossible: `recall_status` and `open_recall_count` are written from a
// MODEL-level NHTSA answer and then read by delivery clearance, compliance,
// the Vehicle File badge, the Passport and the lot feed as though they
// described the car in front of the customer.
//
// Two more facts about the data make a naive read worse than useless. NHTSA
// answers HTTP 400 with the body {"Count":0,"Message":"Results returned
// successfully"} for BOTH "this model has no campaigns" and "I have never
// heard of this vehicle" — verified live on 2026-09-09, where 2027 INFINITI
// QX60 (real) and 2027 INFINITI QX65 (not in NHTSA's catalogue) returned
// byte-identical 400s. And 74 of the pilot tenant's 130 active listings carry
// exactly that unanswered 400 with `recall_status` NULL beside
// `open_recall_count` = 0, so every reader of the count renders them green.
//
// The invariants every consumer inherits:
//   · A count exists only where a check ANSWERED at that scope. UNKNOWN,
//     MODEL_NOT_FOUND and LOOKUP_FAILED carry null, never 0.
//   · `vin.clearClaimAllowed` is the ONLY permission to say "no open recalls",
//     and it requires a VIN-scoped source, a timestamp and a live answer.
//   · `model` is null when no model-level lookup is on record. The five model
//     states describe a lookup that happened; none of them may stand in for
//     one that did not.
//   · `riskSignalled` is scope-blind on purpose. Model-level evidence may
//     never CLEAR a car, but it must still be able to WARN about one, so the
//     existing recall-blocking behaviour survives this correction intact.

/** Matches FRESHNESS_DAYS.recall_status in src/lib/vehicleFile/resolveField.ts. */
export const RECALL_STALE_DAYS = 30;

/** "Does this VIN have an open recall?" Only a VIN-level source may answer. */
export type RecallVinState = "VERIFIED_CLEAR" | "OPEN" | "UNKNOWN" | "STALE";

/** "Are there campaigns for this year/make/model?" NHTSA answers this. */
export type RecallModelState =
  | "MODEL_CAMPAIGNS_FOUND"
  | "NO_MODEL_CAMPAIGNS_FOUND"
  | "MODEL_NOT_FOUND"
  | "LOOKUP_FAILED"
  | "STALE";

export type RecallScope = "vin" | "model";

/**
 * Which scope a provider can speak at. NHTSA's recallsByVehicle takes a
 * year/make/model and cannot take a VIN; MarketCheck AutoRecalls takes a VIN.
 * A source we do not recognise gets no scope, and a scopeless answer can
 * verify nothing.
 */
const VIN_LEVEL_SOURCES = new Set([
  "marketcheck", "marketcheck_recalls", "autorecalls", "marketcheck_autorecalls",
  "oem", "manufacturer", "dealer_verified",
]);
const MODEL_LEVEL_SOURCES = new Set(["nhtsa", "nhtsa_recalls", "nhtsa_recallsbyvehicle"]);

/** A note recording an attempt that did not come back with a record. */
const NO_RECORD_NOTE = /no_[a-z]*_?record|not_in_catalog|model_not_found|unlisted|http_400/i;
/** A note recording the provider itself failing. */
const FAILURE_NOTE = /error|fail|timeout|unavailable|rate[_ ]?limit|http_(4[0-24-9]\d|5\d\d)|not_configured|no_authoritative_source/i;
/** The do-not-drive test the publish gate applies to campaign text. */
const DO_NOT_DRIVE = /do not drive|do-not-drive|stop sale|stop-sale|park outside/i;

const CAMPAIGN_TEXT_KEYS = ["title", "description", "summary", "consequence", "component", "remedy"];

export interface RecallRowInput {
  recall_status?: string | null;
  open_recall_count?: number | null;
  closed_recall_count?: number | null;
  recall_checked_at?: string | null;
  recall_payload?: unknown;
  recall_check?: unknown;
}

export interface RecallCampaignView {
  number: string | null;
  component: string | null;
  summary: string | null;
  remedy: string | null;
  open: boolean;
}

export interface RecallVinScope {
  state: RecallVinState;
  /** Open campaigns on THIS VIN. Null unless a VIN-level source answered. */
  openCount: number | null;
  /** A VIN-level lookup returned a usable answer (before ageing). */
  answered: boolean;
  /** The ONLY permission any surface has to make a clean or no-recall claim. */
  clearClaimAllowed: boolean;
  /** The VIN-level check a workflow can require. False for every model-level answer. */
  checkComplete: boolean;
  source: string | null;
  /** When a VIN-level check ANSWERED. Null when none has. */
  checkedAt: string | null;
  /** When a check was last ATTEMPTED at any scope — evidence of the failure. */
  attemptedAt: string | null;
  label: string;
  detail: string;
}

export interface RecallModelScope {
  state: RecallModelState;
  /** Campaigns on the model line. Null unless the lookup answered. */
  campaignCount: number | null;
  source: string | null;
  checkedAt: string | null;
  label: string;
  detail: string;
}

export interface RecallView {
  vin: RecallVinScope;
  /** Null when no model-level lookup is on record. Never a stand-in for one. */
  model: RecallModelScope | null;
  /**
   * Any evidence, at any scope, of a live campaign or do-not-drive language.
   * Warns; never clears. This is what preserves the existing blocking
   * behaviour while the VIN answer stays honestly UNKNOWN.
   */
  riskSignalled: boolean;
  doNotDrive: boolean;
  campaigns: RecallCampaignView[];
  /** Two stores disagree — one reports clear, another reports a campaign. */
  conflict: boolean;
}

type Bag = Record<string, unknown>;

const bag = (v: unknown): Bag => (v && typeof v === "object" && !Array.isArray(v) ? v as Bag : {});
const list = (v: unknown): Bag[] => (Array.isArray(v) ? v.map(bag) : []);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
const stamp = (v: unknown): string | null => {
  const s = str(v);
  return s && Number.isFinite(Date.parse(s)) ? s : null;
};
const newest = (...v: unknown[]): string | null => {
  const valid = v.map(stamp).filter((s): s is string => s != null).sort();
  return valid.length ? valid[valid.length - 1] : null;
};
const lower = (v: unknown): string => (str(v) ?? "").toLowerCase().replace(/[\s-]+/g, "_");

export const recallScopeOfSource = (source: string | null): RecallScope | null => {
  const s = lower(source);
  if (!s) return null;
  if (VIN_LEVEL_SOURCES.has(s)) return "vin";
  if (MODEL_LEVEL_SOURCES.has(s)) return "model";
  return null;
};

const campaignOpen = (c: Bag): boolean => !lower(c.status).includes("close");

/**
 * The writer's own state vocabulary, read verbatim.
 * `supabase/functions/_shared/recallState.ts` stamps `state` on both stores —
 * VIN_RECALL_STATUS_VALUES on `recall_check`, MODEL_RECALL_STATE_VALUES on
 * `recall_payload` — and where it is present it IS the answer. Everything
 * below it in `deriveRecallView` exists only to read rows written before that
 * vocabulary existed.
 */
const WRITTEN_VIN_STATE: Record<string, RecallVinState> = {
  verified_clear: "VERIFIED_CLEAR",
  open_recalls: "OPEN",
  unknown: "UNKNOWN",
};
const WRITTEN_MODEL_STATE: Record<string, RecallModelState> = {
  model_campaigns_found: "MODEL_CAMPAIGNS_FOUND",
  no_model_campaigns_found: "NO_MODEL_CAMPAIGNS_FOUND",
  model_not_found: "MODEL_NOT_FOUND",
  lookup_failed: "LOOKUP_FAILED",
};

const campaignView = (c: Bag): RecallCampaignView => ({
  number: str(c.campaignNumber) ?? str(c.nhtsaCampaignNumber) ?? str(c.campaignId)
    ?? str(c.campaign) ?? str(c.NHTSACampaignNumber),
  component: str(c.component) ?? str(c.Component),
  summary: str(c.summary) ?? str(c.description) ?? str(c.title) ?? str(c.Summary),
  remedy: str(c.remedy) ?? str(c.Remedy),
  open: campaignOpen(c),
});

const mentionsDoNotDrive = (campaigns: Bag[]): boolean =>
  campaigns.some((c) => DO_NOT_DRIVE.test(CAMPAIGN_TEXT_KEYS.map((k) => str(c[k]) ?? "").join(" ")));

/** One provider answer, however it was stored. */
interface Evidence {
  scope: RecallScope | null;
  source: string | null;
  note: string | null;
  campaigns: Bag[];
  openCount: number | null;
  checkedAt: string | null;
  /** The writer's own word for what it decided, when it recorded one. */
  stateToken: string | null;
  /** NHTSA models-catalogue verdict: did NHTSA recognise this year/make/model? */
  inCatalogue: boolean | null;
  /** This store, read alone, reports no open campaign. */
  saysClear: boolean;
}

const catalogueVerdict = (b: Bag): boolean | null => {
  if (typeof b.model_in_catalog === "boolean") return b.model_in_catalog;
  if (typeof b.modelInCatalog === "boolean") return b.modelInCatalog;
  const verdict = lower(b.catalog_verdict ?? b.catalogVerdict ?? b.verdict);
  if (verdict === "listed") return true;
  if (verdict === "unlisted" || verdict === "not_listed") return false;
  return null;
};

function readEvidence(raw: unknown, fallbackScope: RecallScope | null): Evidence | null {
  const b = bag(raw);
  if (Object.keys(b).length === 0) return null;
  // `marketcheck-recalls` stores its Normalized shape verbatim, and that shape
  // names the provider `rawProvider`. Missing it made every real VIN-level
  // answer we already hold look scopeless.
  const source = str(b.source) ?? str(b.provider) ?? str(b.rawProvider);
  const declared = lower(b.scope ?? b.level);
  const scope: RecallScope | null =
    declared === "vin" ? "vin"
    : declared === "model" ? "model"
    : recallScopeOfSource(source) ?? fallbackScope;
  const campaigns = [...list(b.campaigns), ...list(b.recalls)];
  return {
    scope,
    source,
    note: str(b.note) ?? str(b.error) ?? str(b.reason),
    campaigns,
    // `open_count` / `campaign_count` are the writer's own key names
    // (recallState.ts `vinRecallColumns` / `modelRecallColumns`); the other two
    // are the legacy shapes still on every stored row.
    openCount: num(b.open_count) ?? num(b.campaign_count)
      ?? num(b.open_recall_count) ?? num(b.openRecallCount)
      ?? (campaigns.length ? campaigns.filter(campaignOpen).length : null),
    checkedAt: newest(b.checked_at, b.checkedAt, b.recall_checked_at, b.observed_at),
    stateToken: str(b.vin_state) ?? str(b.model_state) ?? str(b.state) ?? str(b.recall_status)
      ?? str(b.recallStatus) ?? (typeof b.has_open === "boolean" ? (b.has_open ? "open_recalls" : "clear") : null),
    inCatalogue: catalogueVerdict(b),
    saysClear: b.has_open === false
      || ["clear", "verified_clear", "no_open_recalls", "none", "no_model_campaigns_found"].includes(
        lower(b.vin_state ?? b.model_state ?? b.state ?? b.recall_status ?? b.recallStatus),
      )
      || (campaigns.length === 0 && (num(b.open_recall_count) ?? num(b.openRecallCount)) === 0),
  };
}

const dateFmt = (iso: string | null): string | null =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;

export interface DeriveRecallOptions {
  now?: number;
  staleDays?: number;
}

/**
 * Resolve a listing row into the two scopes. Pure and deterministic: the same
 * row and the same clock always produce the same view, so every surface can be
 * exercised without a browser or a provider.
 */
export function deriveRecallView(
  row: RecallRowInput | null | undefined,
  opts: DeriveRecallOptions = {},
): RecallView {
  const now = opts.now ?? Date.now();
  const staleMs = (opts.staleDays ?? RECALL_STALE_DAYS) * 86_400_000;

  const evidence = [
    readEvidence(row?.recall_payload, null),
    readEvidence(row?.recall_check, null),
  ].filter((e): e is Evidence => e != null);

  const allCampaigns = evidence.flatMap((e) => e.campaigns);
  const campaigns = allCampaigns.map(campaignView);
  const doNotDrive = bag(row?.recall_check).do_not_drive === true
    || bag(row?.recall_payload).do_not_drive === true
    || mentionsDoNotDrive(allCampaigns);

  const columnStatus = lower(row?.recall_status);
  const columnCount = num(row?.open_recall_count);
  const attemptedAt = newest(row?.recall_checked_at, ...evidence.map((e) => e.checkedAt));

  // ── VIN scope ────────────────────────────────────────────────────────────
  // Only evidence a VIN-level source produced may resolve this. The status
  // column is deliberately NOT consulted: it is written from whichever source
  // answered last, carries no scope of its own, and is the exact channel
  // through which the model-level answer used to become VIN clearance.
  const vinEvidence = evidence.filter((e) => e.scope === "vin");
  const vinAnswer = vinEvidence.find((e) => e.checkedAt != null && !e.note) ?? vinEvidence[0] ?? null;
  const vinCampaigns = vinEvidence.flatMap((e) => e.campaigns);
  const vinOpen = vinEvidence.reduce<number | null>(
    (acc, e) => (e.openCount == null ? acc : Math.max(acc ?? 0, e.openCount)),
    null,
  );
  const vinToken = lower(vinAnswer?.stateToken);
  const vinNoteFailed = vinAnswer?.note != null
    && (NO_RECORD_NOTE.test(vinAnswer.note) || FAILURE_NOTE.test(vinAnswer.note));
  const vinCheckedAt = vinAnswer && !vinNoteFailed ? vinAnswer.checkedAt : null;

  const writtenVin = WRITTEN_VIN_STATE[vinToken];
  let vinState: RecallVinState;
  if (writtenVin != null && (writtenVin === "UNKNOWN" || vinCheckedAt != null)) {
    vinState = writtenVin;
  } else if (vinAnswer == null || vinNoteFailed || vinCheckedAt == null) {
    vinState = "UNKNOWN";
  } else if ((vinOpen ?? 0) > 0 || vinCampaigns.some(campaignOpen)
    || ["open", "open_recalls", "open_recall"].includes(vinToken)) {
    vinState = "OPEN";
  } else if (["clear", "verified_clear", "no_open_recalls", "none"].includes(vinToken) || vinOpen === 0) {
    vinState = "VERIFIED_CLEAR";
  } else {
    vinState = "UNKNOWN";
  }

  const vinAnswered = vinState === "VERIFIED_CLEAR" || vinState === "OPEN";
  const vinAge = vinCheckedAt ? now - Date.parse(vinCheckedAt) : null;
  if (vinAnswered && vinAge != null && vinAge > staleMs) vinState = "STALE";

  // ── Model scope ──────────────────────────────────────────────────────────
  // Absence of a model lookup is represented by a null scope, never by one of
  // the five states — none of which may stand in for a question nobody asked.
  const modelEvidence = evidence.filter((e) => e.scope === "model");
  const modelAnswer = modelEvidence[0] ?? null;
  let model: RecallModelScope | null = null;
  if (modelAnswer != null) {
    const note = modelAnswer.note;
    const modelToken = lower(modelAnswer.stateToken);
    const modelOpen = modelAnswer.openCount
      ?? (modelAnswer.campaigns.length ? modelAnswer.campaigns.filter(campaignOpen).length : null);
    const writtenModel = WRITTEN_MODEL_STATE[modelToken];
    let modelState: RecallModelState;
    let campaignCount: number | null;
    if (writtenModel != null) {
      modelState = writtenModel;
      campaignCount = writtenModel === "MODEL_CAMPAIGNS_FOUND" ? (modelOpen ?? 0)
        : writtenModel === "NO_MODEL_CAMPAIGNS_FOUND" ? 0
        : null;
    } else if (modelOpen != null && modelOpen > 0) {
      modelState = "MODEL_CAMPAIGNS_FOUND";
      campaignCount = modelOpen;
    } else if (note != null && FAILURE_NOTE.test(note) && !NO_RECORD_NOTE.test(note)) {
      modelState = "LOOKUP_FAILED";
      campaignCount = null;
    } else if (note != null && NO_RECORD_NOTE.test(note)) {
      // The ambiguous 400. Only the models catalogue can tell the two apart,
      // and without its verdict the honest answer is that NHTSA holds no
      // record of this vehicle — never that the vehicle is clean.
      modelState = modelAnswer.inCatalogue === true ? "NO_MODEL_CAMPAIGNS_FOUND" : "MODEL_NOT_FOUND";
      campaignCount = modelState === "NO_MODEL_CAMPAIGNS_FOUND" ? 0 : null;
    } else if (modelAnswer.checkedAt != null
      && (modelOpen === 0 || ["clear", "no_open_recalls", "none"].includes(modelToken))) {
      modelState = modelAnswer.inCatalogue === false ? "MODEL_NOT_FOUND" : "NO_MODEL_CAMPAIGNS_FOUND";
      campaignCount = modelState === "NO_MODEL_CAMPAIGNS_FOUND" ? 0 : null;
    } else {
      modelState = "LOOKUP_FAILED";
      campaignCount = null;
    }
    const modelAge = modelAnswer.checkedAt ? now - Date.parse(modelAnswer.checkedAt) : null;
    const modelAnswered = modelState === "MODEL_CAMPAIGNS_FOUND" || modelState === "NO_MODEL_CAMPAIGNS_FOUND";
    if (modelAnswered && modelAge != null && modelAge > staleMs) modelState = "STALE";
    const asOf = dateFmt(modelAnswer.checkedAt);
    model = {
      state: modelState,
      campaignCount,
      source: modelAnswer.source,
      checkedAt: modelAnswer.checkedAt,
      ...MODEL_COPY[modelState](campaignCount, asOf),
    };
  }

  // A campaign or a count from ANY store is a reason to warn. It is never a
  // reason to clear, which is why it lands here and not in `vinState`.
  const riskSignalled = doNotDrive
    || (columnCount ?? 0) > 0
    || (vinOpen ?? 0) > 0
    || campaigns.some((c) => c.open)
    || columnStatus === "open_recalls"
    || model?.state === "MODEL_CAMPAIGNS_FOUND";

  // A disagreement is reported as a disagreement: one store says no open
  // campaign while another reports one. It is never resolved into a clean car.
  const conflict = riskSignalled
    && (vinState === "VERIFIED_CLEAR" || columnStatus === "clear" || evidence.some((e) => e.saysClear));

  const clearClaimAllowed = vinState === "VERIFIED_CLEAR"
    && vinCheckedAt != null
    && vinAnswer?.source != null
    && !riskSignalled
    && !conflict;

  const openCount = vinState === "OPEN"
    ? (vinOpen != null && vinOpen > 0 ? vinOpen : (vinCampaigns.filter(campaignOpen).length || null))
    : vinState === "VERIFIED_CLEAR" && clearClaimAllowed ? 0
    : null;

  const vinAsOf = dateFmt(vinCheckedAt);
  const vin: RecallVinScope = {
    state: vinState,
    openCount,
    answered: vinAnswered,
    clearClaimAllowed,
    checkComplete: clearClaimAllowed || vinState === "OPEN",
    source: vinAnswer?.source ?? null,
    checkedAt: vinCheckedAt,
    attemptedAt,
    ...vinCopy(vinState, openCount, doNotDrive, conflict, vinAsOf, model),
  };

  return { vin, model, riskSignalled, doNotDrive, campaigns, conflict };
}

const MODEL_COPY: Record<
  RecallModelState,
  (count: number | null, asOf: string | null) => { label: string; detail: string }
> = {
  MODEL_CAMPAIGNS_FOUND: (count, asOf) => ({
    label: count === 1 ? "1 campaign on this model" : `${count ?? 0} campaigns on this model`,
    detail: `NHTSA lists ${count === 1 ? "a safety campaign" : `${count ?? 0} safety campaigns`} for this year, make and model${asOf ? ` as of ${asOf}` : ""}. This is model-level context, not a check of this VIN.`,
  }),
  NO_MODEL_CAMPAIGNS_FOUND: (_count, asOf) => ({
    label: "No campaigns on this model",
    detail: `NHTSA recognises this year, make and model and lists no safety campaigns for it${asOf ? ` as of ${asOf}` : ""}. This is model-level context, not a check of this VIN.`,
  }),
  MODEL_NOT_FOUND: () => ({
    label: "Model not in NHTSA's records",
    detail: "NHTSA holds no record of this year, make and model, so its answer says nothing about this vehicle either way.",
  }),
  LOOKUP_FAILED: () => ({
    label: "Model lookup failed",
    detail: "The NHTSA campaign lookup did not return a result. A failed lookup is not a clean car.",
  }),
  STALE: (_count, asOf) => ({
    label: "Model campaign context out of date",
    detail: `The last NHTSA campaign answer${asOf ? ` (${asOf})` : ""} is older than ${RECALL_STALE_DAYS} days. Re-run the check before relying on it.`,
  }),
};

function vinCopy(
  state: RecallVinState,
  openCount: number | null,
  doNotDrive: boolean,
  conflict: boolean,
  asOf: string | null,
  model: RecallModelScope | null,
): { label: string; detail: string } {
  if (doNotDrive) {
    return {
      label: "Do-not-drive recall",
      detail: "A campaign on record carries do-not-drive language. Do not move or deliver this vehicle until the remedy is recorded.",
    };
  }
  if (state === "OPEN") {
    const n = openCount ?? 0;
    return {
      label: n > 0 ? `${n} open recall${n === 1 ? "" : "s"}` : "Open recall reported",
      detail: `A VIN-level check reports an open manufacturer campaign${asOf ? ` as of ${asOf}` : ""}. Service must record an outcome.`,
    };
  }
  if (state === "VERIFIED_CLEAR" && !conflict) {
    return {
      label: "No open recalls",
      detail: `A VIN-level recall check returned no open campaigns for this vehicle${asOf ? ` as of ${asOf}` : ""}.`,
    };
  }
  if (conflict) {
    return {
      label: "Recall status needs confirmation",
      detail: "One store reports no open campaigns while another reports one. Confirm with the manufacturer before making any claim.",
    };
  }
  if (state === "STALE") {
    return {
      label: "Recall check out of date",
      detail: `The last VIN-level answer${asOf ? ` (${asOf})` : ""} is older than ${RECALL_STALE_DAYS} days. Re-run the check before relying on it.`,
    };
  }
  return {
    label: "Recall verification unavailable",
    detail: model
      ? `No VIN-level recall check has answered for this vehicle, so its recall status is unknown. ${model.detail}`
      : "No VIN-level recall check has answered for this vehicle, so its recall status is unknown.",
  };
}

/** Surface tone. Never green unless a clean claim is actually permitted. */
export type RecallTone = "green" | "red" | "amber" | "muted";

export function recallTone(v: RecallView): RecallTone {
  if (v.doNotDrive) return "red";
  if (v.riskSignalled) return (v.vin.openCount ?? v.model?.campaignCount ?? 0) >= 2 ? "red" : "amber";
  if (v.vin.clearClaimAllowed) return "green";
  if (v.conflict) return "amber";
  return "muted";
}

/**
 * The gate every workflow that requires a VIN-specific recall check must call:
 * delivery clearance, compliance clearance, the Vehicle File verified badge, a
 * Passport clean claim, an AutoFilm talking point, a Description Intelligence
 * claim. A model-level answer never satisfies it.
 */
export const vinRecallCheckComplete = (v: RecallView): boolean => v.vin.checkComplete;

/** The count a surface may print. Null whenever no VIN-level check answered. */
export const displayOpenRecallCount = (v: RecallView): number | null => v.vin.openCount;
