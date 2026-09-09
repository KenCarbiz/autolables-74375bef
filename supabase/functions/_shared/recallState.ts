// ── Recall has TWO scopes, and they are different questions ────────────────
//
// VIN scope answers "does THIS VIN have an applicable open recall?" Only a
// VIN-level provider can answer it, and only that answer may ever clear a car.
// MODEL scope answers "does NHTSA hold campaigns for this year/make/model?"
// That is useful context and it is not clearance: 2027 INFINITI QX60 is a model
// NHTSA recognises with zero campaigns, which says nothing about any one QX60.
//
// The two scopes are separate types here on purpose. Their state vocabularies
// are disjoint, each answer carries its own `scope` discriminant, and each is
// branded with a module-private symbol so no caller outside this file can build
// one by hand. A model answer therefore cannot be passed where a VIN answer is
// required — not by convention, but because the compiler rejects it.
//
// The provenance rule is enforced by construction: every constructor demands a
// source and a checked-at time, so a count cannot exist without them. UNKNOWN,
// MODEL_NOT_FOUND and LOOKUP_FAILED carry a null count, never 0, because zero
// is a factual result and a failure is not.
//
// STALE appears nowhere below. Staleness is the age of an answer, a property of
// the read, so readers derive it from the checked-at time. It is never stored.
//
// NHTSA behaviour this module encodes, verified live on 2026-09-09:
//   recallsByVehicle 2027/INFINITI/QX80        -> 200, Count 1
//   recallsByVehicle 2027/INFINITI/QX60        -> 400, {"Count":0,"Message":"Results returned successfully","results":[]}
//   recallsByVehicle 2027/INFINITI/QX65        -> 400, byte-identical body
//   products/vehicle/models 2027/infiniti      -> 200, [QX80, QX60]
// The recalls endpoint alone cannot separate "known model, no campaigns" from
// "model I have never heard of". The models catalogue can, so it is consulted
// for exactly that one ambiguous response shape and no other.

import { parseYmm } from "./ymm.ts";

export interface RecallCampaign {
  campaign: string | null;
  component: string | null;
  summary: string | null;
  consequence: string | null;
  remedy: string | null;
  manufacturer: string | null;
  reportDate: string | null;
  status: "open" | "closed";
}

export interface RecallProvenance {
  source: string;
  checkedAt: string;
}

export interface VinProvenance extends RecallProvenance {
  vin: string;
}

// ── VIN scope ──────────────────────────────────────────────────────────────

export type VinRecallState = "VERIFIED_CLEAR" | "OPEN" | "UNKNOWN";

export const VIN_RECALL_STATUS_VALUES = ["verified_clear", "open_recalls", "unknown"] as const;
export type VinRecallStatusColumn = (typeof VIN_RECALL_STATUS_VALUES)[number];

const VIN_STATUS: Record<VinRecallState, VinRecallStatusColumn> = {
  VERIFIED_CLEAR: "verified_clear",
  OPEN: "open_recalls",
  UNKNOWN: "unknown",
};

// Not exported: an object literal assembled anywhere else cannot carry this
// key, so `VinRecallAnswer` is unforgeable outside this module.
const VIN_BRAND: unique symbol = Symbol("autolabels.recall.vin");

export interface VinRecallAnswer {
  readonly [VIN_BRAND]: true;
  readonly scope: "vin";
  readonly state: VinRecallState;
  readonly vin: string;
  readonly source: string;
  readonly checkedAt: string;
  readonly openCount: number | null;
  readonly closedCount: number | null;
  readonly campaigns: readonly RecallCampaign[];
  readonly note: string | null;
}

// ── MODEL scope ────────────────────────────────────────────────────────────

export type ModelRecallState =
  | "MODEL_CAMPAIGNS_FOUND"
  | "NO_MODEL_CAMPAIGNS_FOUND"
  | "MODEL_NOT_FOUND"
  | "LOOKUP_FAILED";

export const MODEL_RECALL_STATE_VALUES = [
  "model_campaigns_found",
  "no_model_campaigns_found",
  "model_not_found",
  "lookup_failed",
] as const;
export type ModelRecallStateToken = (typeof MODEL_RECALL_STATE_VALUES)[number];

const MODEL_TOKEN: Record<ModelRecallState, ModelRecallStateToken> = {
  MODEL_CAMPAIGNS_FOUND: "model_campaigns_found",
  NO_MODEL_CAMPAIGNS_FOUND: "no_model_campaigns_found",
  MODEL_NOT_FOUND: "model_not_found",
  LOOKUP_FAILED: "lookup_failed",
};

const MODEL_BRAND: unique symbol = Symbol("autolabels.recall.model");

export interface ModelQuery {
  year: string;
  make: string;
  model: string;
}

export interface ModelRecallAnswer {
  readonly [MODEL_BRAND]: true;
  readonly scope: "model";
  readonly state: ModelRecallState;
  readonly source: "nhtsa";
  readonly checkedAt: string;
  readonly campaignCount: number | null;
  readonly campaigns: readonly RecallCampaign[];
  readonly queried: ModelQuery;
  readonly matchedModel: string | null;
  readonly matchRule: ModelMatchRule | null;
  readonly note: string | null;
}

// ── Small helpers ──────────────────────────────────────────────────────────

const squash = (v: string): string => v.trim().replace(/\s+/g, " ");
const upper = (v: string): string => squash(v).toUpperCase();
const text = (v: unknown): string | null => {
  if (v == null) return null;
  const s = typeof v === "string" ? v : typeof v === "number" ? String(v) : "";
  return s.trim() ? s.trim() : null;
};
const bag = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};

function requireProvenance(source: string, checkedAt: string): void {
  if (!squash(String(source ?? ""))) throw new Error("recall answer requires a source");
  if (!squash(String(checkedAt ?? ""))) throw new Error("recall answer requires a checked-at time");
}

// Deliberately the same phrase set the previous writer used, so moving the
// model answer to its own store cannot change which campaigns count as
// do-not-drive. "park it" is excluded: NHTSA remedy text says it about safe
// parking, and it over-matched.
const DO_NOT_DRIVE_RE = /do not drive|do-not-drive|stop sale|park outside|fire risk/i;

export function campaignsAreDoNotDrive(campaigns: readonly RecallCampaign[]): boolean {
  return campaigns.some((c) =>
    DO_NOT_DRIVE_RE.test(`${c.component ?? ""} ${c.summary ?? ""} ${c.consequence ?? ""} ${c.remedy ?? ""}`)
  );
}

const openOf = (campaigns: readonly RecallCampaign[]): number =>
  campaigns.filter((c) => c.status === "open").length;
const closedOf = (campaigns: readonly RecallCampaign[]): number =>
  campaigns.filter((c) => c.status === "closed").length;

// ── VIN constructors ───────────────────────────────────────────────────────
// Every one of them takes provenance. There is no way to obtain a VIN answer,
// and therefore no way to obtain a VIN count, without a source and a time.

function makeVin(
  state: VinRecallState,
  p: VinProvenance,
  openCount: number | null,
  closedCount: number | null,
  campaigns: readonly RecallCampaign[],
  note: string | null,
): VinRecallAnswer {
  requireProvenance(p.source, p.checkedAt);
  if (!squash(String(p.vin ?? ""))) throw new Error("vin recall answer requires a vin");
  return {
    [VIN_BRAND]: true,
    scope: "vin",
    state,
    vin: upper(p.vin),
    source: squash(p.source),
    checkedAt: squash(p.checkedAt),
    openCount,
    closedCount,
    campaigns,
    note,
  };
}

export const vinVerifiedClear = (
  p: VinProvenance,
  campaigns: readonly RecallCampaign[] = [],
  note: string | null = null,
): VinRecallAnswer => makeVin("VERIFIED_CLEAR", p, 0, closedOf(campaigns), campaigns, note);

export const vinOpen = (
  p: VinProvenance,
  campaigns: readonly RecallCampaign[],
  note: string | null = null,
): VinRecallAnswer => makeVin("OPEN", p, openOf(campaigns), closedOf(campaigns), campaigns, note);

export const vinUnknown = (p: VinProvenance, note: string): VinRecallAnswer =>
  makeVin("UNKNOWN", p, null, null, [], note);

/** A VIN-level provider answered: zero open campaigns is a real clearance. */
export function vinAnswerFromCampaigns(
  p: VinProvenance,
  campaigns: readonly RecallCampaign[],
  note: string | null = null,
): VinRecallAnswer {
  return openOf(campaigns) > 0 ? vinOpen(p, campaigns, note) : vinVerifiedClear(p, campaigns, note);
}

export const isVinAnswered = (a: VinRecallAnswer): boolean =>
  a.state === "VERIFIED_CLEAR" || a.state === "OPEN";

// ── MODEL constructors ─────────────────────────────────────────────────────

function makeModel(
  state: ModelRecallState,
  p: RecallProvenance,
  campaignCount: number | null,
  campaigns: readonly RecallCampaign[],
  queried: ModelQuery,
  matchedModel: string | null,
  matchRule: ModelMatchRule | null,
  note: string | null,
): ModelRecallAnswer {
  requireProvenance(p.source, p.checkedAt);
  return {
    [MODEL_BRAND]: true,
    scope: "model",
    state,
    source: "nhtsa",
    checkedAt: squash(p.checkedAt),
    campaignCount,
    campaigns,
    queried,
    matchedModel,
    matchRule,
    note,
  };
}

const nhtsaProvenance = (checkedAt: string): RecallProvenance => ({ source: "nhtsa", checkedAt });

export const modelCampaignsFound = (
  checkedAt: string,
  campaigns: readonly RecallCampaign[],
  queried: ModelQuery,
  matchedModel: string | null = null,
  matchRule: ModelMatchRule | null = null,
  note: string | null = null,
): ModelRecallAnswer =>
  makeModel("MODEL_CAMPAIGNS_FOUND", nhtsaProvenance(checkedAt), campaigns.length, campaigns, queried, matchedModel, matchRule, note);

export const noModelCampaignsFound = (
  checkedAt: string,
  queried: ModelQuery,
  matchedModel: string | null = null,
  matchRule: ModelMatchRule | null = null,
  note: string | null = null,
): ModelRecallAnswer =>
  makeModel("NO_MODEL_CAMPAIGNS_FOUND", nhtsaProvenance(checkedAt), 0, [], queried, matchedModel, matchRule, note);

export const modelNotFound = (
  checkedAt: string,
  queried: ModelQuery,
  note: string | null = null,
): ModelRecallAnswer =>
  makeModel("MODEL_NOT_FOUND", nhtsaProvenance(checkedAt), null, [], queried, null, null, note);

export const modelLookupFailed = (
  checkedAt: string,
  queried: ModelQuery,
  note: string,
): ModelRecallAnswer =>
  makeModel("LOOKUP_FAILED", nhtsaProvenance(checkedAt), null, [], queried, null, null, note);

export const isModelAnswered = (a: ModelRecallAnswer): boolean =>
  a.state === "MODEL_CAMPAIGNS_FOUND" || a.state === "NO_MODEL_CAMPAIGNS_FOUND";

// ── The two stored shapes ──────────────────────────────────────────────────
//
// vehicle_listings carries two jsonb stores and this is the line between them:
//
//   recall_check   + recall_status + open_recall_count + closed_recall_count
//                  = VIN scope. recall_status is what delivery clearance and
//                    the Passport read as a clean claim and open_recall_count
//                    is read as "this car has N open recalls", so the lock's
//                    "only a VIN-level source may clear a VIN" rule has to bind
//                    exactly these columns. recall_check is their provenance
//                    envelope, which is also why the publish gate's freshness
//                    requirement (recall_check.checked_at) now means a
//                    VIN-level check and can no longer be satisfied by a
//                    model-level one.
//
//   recall_payload = MODEL scope. Every one of the 276 payloads in production
//                    already holds an NHTSA model-level answer, so this store
//                    is being named for what it has always contained rather
//                    than being repurposed, and no row has to move. It keeps
//                    do_not_drive and campaigns so the do-not-drive unpublish
//                    guard and the recall service task still fire on exactly
//                    the model evidence they fire on today.

export interface VinRecallColumnPatch {
  recall_status: VinRecallStatusColumn | null;
  open_recall_count: number | null;
  closed_recall_count: number | null;
  recall_checked_at: string | null;
  recall_check: Record<string, unknown>;
}

/**
 * An unanswered lookup records the ATTEMPT, never a check date. The publish
 * gate and the stale worklist both key on recall_check.checked_at, so emitting
 * one for an UNKNOWN would let a lookup that answered nothing satisfy a
 * requirement for a valid check. recall_status is left NULL rather than set to
 * 'unknown' so the enrich sweep, which re-queues on a NULL recall_status, keeps
 * coming back to the vehicle.
 */
export function vinRecallColumns(a: VinRecallAnswer): VinRecallColumnPatch {
  if (!isVinAnswered(a)) {
    return {
      recall_status: null,
      open_recall_count: null,
      closed_recall_count: null,
      recall_checked_at: null,
      recall_check: {
        scope: "vin",
        state: "unknown",
        source: a.source,
        attempted_at: a.checkedAt,
        vin: a.vin,
        campaigns: [],
        ...(a.note ? { note: a.note } : {}),
      },
    };
  }
  return {
    recall_status: VIN_STATUS[a.state],
    open_recall_count: a.openCount,
    closed_recall_count: a.closedCount,
    recall_checked_at: a.checkedAt,
    recall_check: {
      scope: "vin",
      state: VIN_STATUS[a.state],
      source: a.source,
      checked_at: a.checkedAt,
      vin: a.vin,
      open_count: a.openCount,
      closed_count: a.closedCount,
      has_open: a.state === "OPEN",
      do_not_drive: campaignsAreDoNotDrive(a.campaigns),
      campaigns: a.campaigns,
      ...(a.note ? { note: a.note } : {}),
    },
  };
}

export interface ModelRecallColumnPatch {
  recall_payload: Record<string, unknown>;
}

export function modelRecallColumns(a: ModelRecallAnswer): ModelRecallColumnPatch {
  return {
    recall_payload: {
      scope: "model",
      state: MODEL_TOKEN[a.state],
      source: a.source,
      checked_at: a.checkedAt,
      campaign_count: a.campaignCount,
      campaigns: a.campaigns,
      queried: a.queried,
      matched_model: a.matchedModel,
      match_rule: a.matchRule,
      has_open: a.state === "MODEL_CAMPAIGNS_FOUND",
      do_not_drive: campaignsAreDoNotDrive(a.campaigns),
      ...(a.note ? { note: a.note } : {}),
    },
  };
}

/**
 * An unanswered VIN lookup may record itself only where no VIN answer stands.
 * It must never replace a known OPEN, and it must never erase a real clearance
 * — an answer that ages is the reader's STALE, not the writer's failure.
 */
export const mayOverwriteVinWithUnanswered = (stored: string | null | undefined): boolean => {
  const s = String(stored ?? "").trim().toLowerCase();
  return s === "" || s === "unknown";
};

// ── Model normalisation ────────────────────────────────────────────────────
// The feed's model key is a marketing string ("Wrangler 4-Door", "MX-5 Miata",
// "Town & Country"); NHTSA's vocabulary is "WRANGLER", "MX-5", "TOWN AND
// COUNTRY". No rule here can invent an answer: a candidate is used only when
// the live catalogue itself contains it.

export type ModelMatchRule = "exact" | "ampersand" | "door_style" | "trimmed_suffix" | "make_prefix";

export interface ModelCandidate {
  model: string;
  rule: ModelMatchRule;
}

const MAX_TRIMMED_TOKENS = 2;

export function nhtsaModelCandidates(make: string, model: string): ModelCandidate[] {
  const out: ModelCandidate[] = [];
  const seen = new Set<string>();
  const add = (value: string, rule: ModelMatchRule) => {
    const v = squash(value);
    if (!v) return;
    const k = upper(v);
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ model: v, rule });
  };

  const base = squash(model);
  if (!base) return out;
  add(base, "exact");

  const ampersand = squash(base.replace(/\s*&\s*/g, " and "));
  add(ampersand, "ampersand");

  const roots = ampersand === base ? [base] : [base, ampersand];
  for (const root of roots) add(root.replace(/\s+(\d)[-\s]?door$/i, " $1DR"), "door_style");

  const trims = (root: string, rule: ModelMatchRule) => {
    const parts = squash(root).split(" ");
    for (let drop = 1; drop <= MAX_TRIMMED_TOKENS && parts.length - drop >= 1; drop++) {
      add(parts.slice(0, parts.length - drop).join(" "), rule);
    }
  };
  for (const root of roots) trims(root, "trimmed_suffix");

  const mk = upper(make);
  if (mk) {
    for (const root of roots) {
      if (!upper(root).startsWith(`${mk} `)) continue;
      const stripped = squash(squash(root).slice(squash(make).length));
      add(stripped, "make_prefix");
      trims(stripped, "make_prefix");
    }
  }

  return out;
}

export interface ModelMatch {
  model: string;
  rule: ModelMatchRule;
}

export function matchNhtsaModel(
  make: string,
  model: string,
  catalogue: readonly string[],
): ModelMatch | null {
  const index = new Map<string, string>();
  for (const entry of catalogue) {
    const k = upper(String(entry ?? ""));
    if (k && !index.has(k)) index.set(k, squash(String(entry)));
  }
  for (const candidate of nhtsaModelCandidates(make, model)) {
    const hit = index.get(upper(candidate.model));
    if (hit) return { model: hit, rule: candidate.rule };
  }
  return null;
}

// ── Provider transport ─────────────────────────────────────────────────────
// The classifiers are pure: edge functions inject the fetch, tests inject a
// script of responses. A body that could not be parsed arrives as `undefined`.

export type HttpOutcome =
  | { kind: "response"; status: number; body: unknown }
  | { kind: "transport_error"; reason: string };

export type HttpGet = (url: string) => Promise<HttpOutcome>;

export const nhtsaRecallsUrl = (year: string, make: string, model: string): string =>
  "https://api.nhtsa.gov/recalls/recallsByVehicle"
  + `?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&modelYear=${encodeURIComponent(year)}`;

export const nhtsaModelsUrl = (year: string, make: string): string =>
  "https://api.nhtsa.gov/products/vehicle/models"
  + `?modelYear=${encodeURIComponent(year)}&make=${encodeURIComponent(make)}&issueType=r`;

interface NhtsaBody {
  count: number | null;
  message: string | null;
  results: unknown[] | null;
}

function readNhtsaBody(body: unknown): NhtsaBody | null {
  const b = bag(body);
  const results = Array.isArray(b.results) ? b.results : Array.isArray(b.Results) ? b.Results : null;
  const rawCount = b.Count ?? b.count;
  const count = typeof rawCount === "number" && Number.isFinite(rawCount) ? rawCount : null;
  const rawMessage = b.Message ?? b.message;
  const message = typeof rawMessage === "string" ? rawMessage : null;
  if (results === null && count === null) return null;
  return { count, message, results };
}

export function toRecallCampaigns(results: readonly unknown[]): RecallCampaign[] {
  return results.map((raw) => {
    const r = bag(raw);
    const status = text(r.status) ?? text(r.recall_status) ?? "";
    return {
      campaign: text(r.NHTSACampaignNumber) ?? text(r.CampaignNumber) ?? text(r.campaign_id) ?? text(r.id),
      component: text(r.Component) ?? text(r.component) ?? text(r.components),
      summary: text(r.Summary) ?? text(r.summary) ?? text(r.description) ?? text(r.defect_summary),
      consequence: text(r.Consequence) ?? text(r.consequence) ?? text(r.consequence_summary),
      remedy: text(r.Remedy) ?? text(r.remedy) ?? text(r.corrective_action) ?? text(r.remedy_summary),
      manufacturer: text(r.Manufacturer) ?? text(r.manufacturer) ?? text(r.make) ?? text(r.mfr),
      reportDate: text(r.ReportReceivedDate) ?? text(r.report_date) ?? text(r.recall_date) ?? text(r.report_received_date),
      status: status.toLowerCase().includes("close") ? "closed" : "open",
    };
  });
}

const SUCCESS_MESSAGE = /results returned successfully/i;

/** The one response the recalls endpoint alone cannot decide. */
export function isAmbiguousNhtsaZero(outcome: HttpOutcome): boolean {
  if (outcome.kind !== "response" || outcome.status !== 400) return false;
  const parsed = readNhtsaBody(outcome.body);
  return !!parsed
    && parsed.count === 0
    && parsed.results != null
    && parsed.results.length === 0
    && SUCCESS_MESSAGE.test(parsed.message ?? "");
}

/** What the models catalogue said about the model we asked about. */
export type CatalogueVerdict = "listed" | "absent" | "unavailable";

export interface NhtsaClassifyContext {
  checkedAt: string;
  queried: ModelQuery;
  matchedModel?: string | null;
  matchRule?: ModelMatchRule | null;
}

/**
 * NHTSA is model scope, so this returns a ModelRecallAnswer and nothing else.
 * There is no branch, and no overload, that can hand back a VIN answer.
 */
export function classifyNhtsaRecall(
  outcome: HttpOutcome,
  verdict: CatalogueVerdict,
  ctx: NhtsaClassifyContext,
): ModelRecallAnswer {
  const { checkedAt, queried } = ctx;
  const matched = ctx.matchedModel ?? null;
  const rule = ctx.matchRule ?? null;

  if (outcome.kind === "transport_error") {
    return modelLookupFailed(checkedAt, queried, `nhtsa_transport_error:${outcome.reason || "unknown"}`);
  }

  const { status, body } = outcome;
  const parsed = readNhtsaBody(body);

  if (status >= 200 && status < 300) {
    if (!parsed || parsed.results === null) {
      return modelLookupFailed(checkedAt, queried, "nhtsa_response_parse_error");
    }
    const campaigns = toRecallCampaigns(parsed.results);
    return campaigns.length > 0
      ? modelCampaignsFound(checkedAt, campaigns, queried, matched, rule)
      : noModelCampaignsFound(checkedAt, queried, matched, rule);
  }

  // A rejected request that still carries campaigns may only move the answer
  // towards "campaigns exist"; a failure must never delete a campaign we were
  // told about.
  if (parsed?.results && parsed.results.length > 0) {
    return modelCampaignsFound(checkedAt, toRecallCampaigns(parsed.results), queried, matched, rule, `nhtsa_http_${status}_with_results`);
  }

  if (isAmbiguousNhtsaZero(outcome)) {
    if (verdict === "listed") {
      return noModelCampaignsFound(checkedAt, queried, matched, rule, "nhtsa_catalogue_confirmed_zero_campaigns");
    }
    if (verdict === "absent") {
      return modelNotFound(checkedAt, queried, "nhtsa_model_absent_from_catalogue");
    }
    return modelLookupFailed(checkedAt, queried, "nhtsa_catalogue_unavailable");
  }

  return modelLookupFailed(checkedAt, queried, `nhtsa_http_${status}`);
}

// ── MarketCheck AutoRecalls (licensed, VIN-level) ──────────────────────────
//
// The 404 branch used to return {recalls: []} and call it clear, "no record on
// file (typical new model year)". That is the same mistake as the NHTSA 400 in
// the licensed path: the absence of a record is not a statement about the car.
// It is the only thing this product has ever produced in this database — the
// five rows labelled marketcheck_autorecalls all carry an empty recall list —
// so it is the whole of our MarketCheck experience and all of it was wrong.
//
// This function is the switch the owner asked for: the day the AutoRecalls
// terms are accepted and the endpoint answers 200, the same call starts
// yielding VERIFIED_CLEAR and OPEN with no further redesign. Until then every
// non-2xx maps to UNKNOWN, which is the honest VIN state for every vehicle.

export function classifyMarketcheckVinRecall(outcome: HttpOutcome, p: VinProvenance): VinRecallAnswer {
  if (outcome.kind === "transport_error") {
    return vinUnknown(p, `marketcheck_transport_error:${outcome.reason || "unknown"}`);
  }
  const { status, body } = outcome;
  if (status === 404) return vinUnknown(p, "marketcheck_vin_not_on_file");
  if (status === 429) return vinUnknown(p, "marketcheck_rate_limited");
  if (status < 200 || status >= 300) return vinUnknown(p, `marketcheck_http_${status}`);

  const b = bag(body);
  const list = Array.isArray(body)
    ? body as unknown[]
    : Array.isArray(b.recalls)
      ? b.recalls as unknown[]
      : Array.isArray(b.results)
        ? b.results as unknown[]
        : null;
  // A 200 whose body carries no recognisable recall array is not a "no recalls"
  // answer either — it is a shape we do not understand.
  if (list === null) return vinUnknown(p, "marketcheck_response_shape_unrecognised");
  return vinAnswerFromCampaigns(p, toRecallCampaigns(list));
}

// ── Models catalogue, cached per (year, make) for the life of one run ───────

export type CatalogueLookup = { ok: true; models: string[] } | { ok: false; reason: string };

function readCatalogue(outcome: HttpOutcome): CatalogueLookup {
  if (outcome.kind === "transport_error") {
    return { ok: false, reason: `transport_error:${outcome.reason || "unknown"}` };
  }
  if (outcome.status < 200 || outcome.status >= 300) return { ok: false, reason: `http_${outcome.status}` };
  const results = bag(outcome.body).results;
  if (!Array.isArray(results)) return { ok: false, reason: "parse_error" };
  const models = results
    .map((entry) => text(bag(entry).model) ?? text(bag(entry).Model))
    .filter((m): m is string => m != null);
  return { ok: true, models };
}

/**
 * A 130-vehicle sweep asks about a handful of distinct (year, make) pairs, so
 * the catalogue is fetched once per pair and reused — failures included, so a
 * dead endpoint cannot turn one sweep into hundreds of calls.
 */
export class NhtsaModelCatalogue {
  private readonly cache = new Map<string, { at: number; result: CatalogueLookup }>();
  private fetches = 0;

  // `ttlMs` matters only for a long-lived isolate, where the cache outlives one
  // sweep: NHTSA adds models to a year mid-season, and an entry that never
  // expired would keep answering "absent" for a model it has since listed.
  constructor(private readonly get: HttpGet, private readonly ttlMs = Number.POSITIVE_INFINITY) {}

  get callCount(): number {
    return this.fetches;
  }

  async lookup(year: string, make: string): Promise<CatalogueLookup> {
    const key = `${squash(year)}|${upper(make)}`;
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.at < this.ttlMs) return cached.result;
    this.fetches += 1;
    const result = readCatalogue(await this.get(nhtsaModelsUrl(year, make)));
    this.cache.set(key, { at: Date.now(), result });
    return result;
  }
}

// ── Identity: prefer the structured feed keys over the display string ──────

export type IdentityOrigin = "mc_attributes" | "mc_raw_build" | "ymm" | "none";

export interface ResolvedIdentity extends ModelQuery {
  origin: IdentityOrigin;
}

export interface IdentitySource {
  ymm?: string | null;
  mc_attributes?: unknown;
  mc_raw?: unknown;
}

/**
 * `parseYmm` splits a display string, which is how "Alfa Romeo Stelvio" became
 * make "Alfa" and how a recall query became model "Ram 1500 Pickup". The feed's
 * own make/model keys are structured data and are preferred wherever they
 * exist; the display string is the last resort, never the first choice.
 */
export function resolveNhtsaIdentity(row: IdentitySource): ResolvedIdentity {
  const parsed = parseYmm(typeof row.ymm === "string" ? row.ymm : null);
  const pick = (source: unknown): ModelQuery => {
    const o = bag(source);
    return { year: text(o.year) ?? "", make: text(o.make) ?? "", model: text(o.model) ?? "" };
  };
  const attrs = pick(row.mc_attributes);
  const build = pick(bag(row.mc_raw).build);

  if (attrs.make && attrs.model) {
    return { ...attrs, year: attrs.year || build.year || parsed.year, origin: "mc_attributes" };
  }
  if (build.make && build.model) {
    return { ...build, year: build.year || parsed.year, origin: "mc_raw_build" };
  }
  if (parsed.make && parsed.model) return { ...parsed, origin: "ymm" };
  return { ...parsed, origin: "none" };
}

// ── NHTSA resolution ───────────────────────────────────────────────────────

export interface NhtsaResolveDeps {
  get: HttpGet;
  catalogue: NhtsaModelCatalogue;
  now?: () => string;
}

/**
 * Ask NHTSA about one vehicle. The catalogue is consulted only for the single
 * ambiguous response shape, so a vehicle that answers 200 still costs exactly
 * one call. The return type is MODEL scope and cannot be anything else.
 */
export async function resolveNhtsaModelRecall(
  identity: ModelQuery,
  deps: NhtsaResolveDeps,
): Promise<ModelRecallAnswer> {
  const at = (deps.now ?? (() => new Date().toISOString()))();
  const year = squash(identity.year);
  const make = squash(identity.make);
  const model = squash(identity.model);
  const queried: ModelQuery = { year, make, model };

  if (!/^\d{4}$/.test(year) || !make || !model) {
    return modelLookupFailed(at, queried, "nhtsa_identity_incomplete");
  }

  const first = await deps.get(nhtsaRecallsUrl(year, make, model));
  if (!isAmbiguousNhtsaZero(first)) {
    return classifyNhtsaRecall(first, "unavailable", { checkedAt: at, queried, matchedModel: model, matchRule: "exact" });
  }

  const catalogue = await deps.catalogue.lookup(year, make);
  if (!catalogue.ok) {
    return modelLookupFailed(at, queried, `nhtsa_catalogue_unavailable:${catalogue.reason}`);
  }

  const match = matchNhtsaModel(make, model, catalogue.models);
  if (!match) return classifyNhtsaRecall(first, "absent", { checkedAt: at, queried });
  if (match.rule === "exact") {
    return classifyNhtsaRecall(first, "listed", { checkedAt: at, queried, matchedModel: match.model, matchRule: "exact" });
  }

  const second = await deps.get(nhtsaRecallsUrl(year, make, match.model));
  return classifyNhtsaRecall(second, "listed", {
    checkedAt: at,
    queried,
    matchedModel: match.model,
    matchRule: match.rule,
  });
}
