// One EPA retrieval = one snapshot. The annual fuel cost (fuelCost08) and the
// five-year comparison (youSaveSpend) are recalculated by fueleconomy.gov from
// its current fuel prices, so they are only meaningful together with the date
// they were retrieved. Every figure a reader shows comes from a single
// snapshot; older snapshots are kept in `history` and are never read for
// display. Pure (no I/O) so the edge function, the sticker adapter and the
// Passport share it, and tests drive it directly.

export const EPA_SNAPSHOT_SCHEMA = 2;

// fueleconomy.gov web services documentation: fuelCost08 is the annual fuel
// cost for fuelType1 based on 15,000 miles a year at 55% city driving and the
// site's current fuel prices; youSaveSpend is the 5-year fuel cost compared
// with the average new vehicle, positive when the vehicle saves money and
// negative when it costs more.
export const EPA_COST_BASIS = {
  annualMiles: 15000,
  cityPercent: 55,
  documentedBy: "fueleconomy.gov web services documentation (fuelCost08, youSaveSpend)",
} as const;

export type FiveYearDirection = "save" | "spend" | "same";

export interface EpaFuelPrices {
  regular: number | null;
  midgrade: number | null;
  premium: number | null;
  diesel: number | null;
  electric: number | null;
  e85: number | null;
  cng: number | null;
  lpg: number | null;
  retrievedAt: string;
}

export interface EpaCostBasis {
  annualMiles: number;
  cityPercent: number;
  documentedBy: string;
  /** Prices fueleconomy.gov published in the same refresh, or null when not retrieved. */
  fuelPrices: EpaFuelPrices | null;
}

export interface EpaSnapshot {
  schema: typeof EPA_SNAPSHOT_SCHEMA;
  source: "fueleconomy.gov";
  vehicleId: number;
  listingVin: string | null;
  modelYear: number | null;
  make: string | null;
  model: string | null;
  matchedOption: string;
  matchBasis: unknown;
  matcherVersion: string;
  city: number | null;
  highway: number | null;
  combined: number | null;
  co2TailpipeGpm: number | null;
  ghgScore: number | null;
  rangeMiles: number | null;
  fuelType: string | null;
  atvType: string | null;
  annualFuelCost: number | null;
  /** youSaveSpend as supplied: positive = saves vs the average new vehicle, negative = spends more. */
  fiveYearCostDifference: number | null;
  costBasis: EpaCostBasis;
  /** When fueleconomy.gov returned these values. */
  checkedAt: string;
  /** Latest later retrieval that returned exactly the same values. */
  confirmedAt?: string;
}

/** A snapshot as kept in history: a schema-1 record has only the fields the older function wrote. */
export type EpaHistoryEntry = Record<string, unknown> & { checkedAt?: string; supersededAt: string };

export type EpaEconomyRecord = Record<string, unknown> & { history?: EpaHistoryEntry[] };

// deno-lint-ignore no-explicit-any
type Raw = Record<string, any>;

const positive = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

const signed = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!/^[-+]?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const text = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim();
  return s ? s : null;
};

const isoOk = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));

const sameUtcDay = (a: string, b: string) => new Date(a).toISOString().slice(0, 10) === new Date(b).toISOString().slice(0, 10);

export function fiveYearDirection(difference: number): FiveYearDirection {
  return difference > 0 ? "save" : difference < 0 ? "spend" : "same";
}

/** Parses /ws/rest/fuelprices. Unknown shapes give null rather than a guess. */
export function parseFuelPrices(body: unknown, retrievedAt: string): EpaFuelPrices | null {
  const b = (body && typeof body === "object" ? body : null) as Raw | null;
  if (!b || !isoOk(retrievedAt)) return null;
  const prices: EpaFuelPrices = {
    regular: positive(b.regular), midgrade: positive(b.midgrade), premium: positive(b.premium),
    diesel: positive(b.diesel), electric: positive(b.electric), e85: positive(b.e85),
    cng: positive(b.cng), lpg: positive(b.lpg), retrievedAt,
  };
  return prices.regular === null && prices.diesel === null && prices.electric === null ? null : prices;
}

export interface SnapshotContext {
  listingVin: string | null;
  matchedOption: string;
  matchBasis: unknown;
  matcherVersion: string;
  retrievedAt: string;
  fuelPrices?: EpaFuelPrices | null;
}

/** Builds the snapshot from one fueleconomy.gov /vehicle/{id} response. */
export function buildEpaSnapshot(v: Raw, ctx: SnapshotContext): EpaSnapshot | null {
  const vehicleId = Number(v?.id);
  if (!Number.isInteger(vehicleId) || vehicleId <= 0 || !isoOk(ctx.retrievedAt)) return null;
  const year = Number(v.year);
  const prices = ctx.fuelPrices && sameUtcDay(ctx.fuelPrices.retrievedAt, ctx.retrievedAt) ? ctx.fuelPrices : null;
  return {
    schema: EPA_SNAPSHOT_SCHEMA,
    source: "fueleconomy.gov",
    vehicleId,
    listingVin: text(ctx.listingVin)?.toUpperCase() ?? null,
    modelYear: Number.isInteger(year) && year > 1900 ? year : null,
    make: text(v.make),
    model: text(v.model),
    matchedOption: ctx.matchedOption,
    matchBasis: ctx.matchBasis,
    matcherVersion: ctx.matcherVersion,
    city: positive(v.city08),
    highway: positive(v.highway08),
    combined: positive(v.comb08),
    co2TailpipeGpm: positive(v.co2TailpipeGpm),
    ghgScore: positive(v.ghgScore),
    rangeMiles: positive(v.rangeA) ?? positive(v.range),
    fuelType: text(v.fuelType),
    atvType: text(v.atvType),
    annualFuelCost: positive(v.fuelCost08),
    fiveYearCostDifference: signed(v.youSaveSpend),
    costBasis: { ...EPA_COST_BASIS, fuelPrices: prices },
    checkedAt: ctx.retrievedAt,
  };
}

/** Why a snapshot cannot belong to this listing, or null when it can. */
export function snapshotListingMismatch(
  s: Pick<EpaSnapshot, "listingVin" | "modelYear">,
  listing: { vin: string | null; year: string | number | null },
): string | null {
  const vin = text(listing.vin)?.toUpperCase() ?? null;
  if (s.listingVin && vin && s.listingVin !== vin) return "vin_mismatch";
  const year = Number(listing.year);
  const hasYear = Number.isInteger(year) && year > 1900;
  if (s.modelYear !== null && hasYear && s.modelYear !== year) return "model_year_mismatch";
  if (s.modelYear === null && hasYear) return "model_year_missing";
  return null;
}

const VALUE_KEYS = [
  "vehicleId", "city", "highway", "combined", "co2TailpipeGpm", "ghgScore", "rangeMiles",
  "fuelType", "atvType", "annualFuelCost", "fiveYearCostDifference",
] as const;

const pricesKey = (p: unknown) => {
  if (!p || typeof p !== "object") return "none";
  const { retrievedAt: _r, ...rest } = p as Raw;
  return JSON.stringify(Object.keys(rest).sort().map((k) => [k, rest[k]]));
};

/** Same provider values (and the same published fuel prices), whenever retrieved. */
export function sameEpaValues(a: Raw, b: Raw): boolean {
  if (Number(a.schema) !== EPA_SNAPSHOT_SCHEMA || Number(b.schema) !== EPA_SNAPSHOT_SCHEMA) return false;
  if (!VALUE_KEYS.every((k) => (a[k] ?? null) === (b[k] ?? null))) return false;
  return pricesKey(a.costBasis?.fuelPrices) === pricesKey(b.costBasis?.fuelPrices);
}

const isCurrent = (r: Raw | null | undefined): r is Raw =>
  !!r && typeof r === "object" && r.status !== "retired" && !r.error && r.vehicleId != null;

const asHistory = (r: Raw, supersededAt: string): EpaHistoryEntry => {
  const { history: _h, lastConflict: _c, ...rest } = r;
  return { ...rest, schema: Number(rest.schema) || 1, supersededAt };
};

export type MergeOutcome = "created" | "replaced" | "confirmed" | "stale" | "conflict";

export interface MergeResult {
  record: EpaEconomyRecord;
  outcome: MergeOutcome;
  reason?: string;
}

/**
 * Folds a new snapshot into what is stored. The stored current snapshot is
 * never edited in place: a changed value set becomes the new current snapshot
 * and the old one moves to history; an identical refresh only records when it
 * was confirmed; an older or out-of-order retrieval changes nothing; and a
 * different EPA vehicle id or VIN is held as a conflict for review instead of
 * replacing a verified match.
 */
export function mergeEpaSnapshot(stored: unknown, next: EpaSnapshot, verifiedMatchers: readonly string[]): MergeResult {
  const prior = (stored && typeof stored === "object" ? stored : null) as Raw | null;
  const history: EpaHistoryEntry[] = Array.isArray(prior?.history) ? [...prior!.history] : [];

  if (!isCurrent(prior)) {
    return { record: { ...next, history }, outcome: prior ? "replaced" : "created" };
  }

  const latest = Math.max(isoOk(prior.checkedAt) ? Date.parse(prior.checkedAt) : -Infinity, isoOk(prior.confirmedAt) ? Date.parse(prior.confirmedAt) : -Infinity);
  if (Date.parse(next.checkedAt) <= latest) {
    return { record: prior as EpaEconomyRecord, outcome: "stale", reason: "not_newer_than_stored" };
  }

  const conflict =
    prior.listingVin && next.listingVin && prior.listingVin !== next.listingVin ? "vin_mismatch"
      : verifiedMatchers.includes(String(prior.matcherVersion ?? "")) && Number(prior.vehicleId) !== next.vehicleId ? "vehicle_id_changed"
        : null;
  if (conflict) {
    return {
      record: { ...prior, lastConflict: { reason: conflict, vehicleId: next.vehicleId, listingVin: next.listingVin, checkedAt: next.checkedAt } },
      outcome: "conflict",
      reason: conflict,
    };
  }

  if (sameEpaValues(prior, next)) {
    const { lastConflict: _c, ...keep } = prior;
    return { record: { ...keep, confirmedAt: next.checkedAt, history } as EpaEconomyRecord, outcome: "confirmed" };
  }

  return { record: { ...next, history: [asHistory(prior, next.checkedAt), ...history] }, outcome: "replaced" };
}

/** A definite refusal hides the stored figures without deleting them. */
export function retireEpaRecord(stored: unknown, reason: string, at: string): EpaEconomyRecord | null {
  const prior = (stored && typeof stored === "object" ? stored : null) as Raw | null;
  if (!prior) return null;
  const history: EpaHistoryEntry[] = Array.isArray(prior.history) ? [...prior.history] : [];
  if (isCurrent(prior)) history.unshift(asHistory(prior, at));
  return { schema: EPA_SNAPSHOT_SCHEMA, status: "retired", retiredReason: reason, retiredAt: at, history };
}

export interface EpaView {
  vehicleId: number | null;
  city: number | null;
  highway: number | null;
  combined: number | null;
  ghgScore: number | null;
  rangeMiles: number | null;
  fuelType: string | null;
  /** Null unless the snapshot carries a retrieval date. */
  annualFuelCost: number | null;
  fiveYear: { difference: number; amount: number; direction: FiveYearDirection } | null;
  /** The latest retrieval that returned the cost figures shown. */
  retrievedAt: string | null;
  fuelPrices: EpaFuelPrices | null;
}

/**
 * The single reader for stored EPA data. Every value comes from the current
 * snapshot; history is never consulted, so a cost and a five-year figure from
 * different retrievals can never be shown side by side. Cost figures without a
 * retrieval date are withheld because they change with fuel prices.
 */
export function readEpa(
  record: unknown,
  listing?: { vin?: string | null; year?: string | number | null },
): EpaView | null {
  const r = (record && typeof record === "object" ? record : null) as Raw | null;
  if (!isCurrent(r)) return null;
  if (listing) {
    const mismatch = snapshotListingMismatch(
      { listingVin: text(r.listingVin), modelYear: r.modelYear != null && Number.isInteger(Number(r.modelYear)) ? Number(r.modelYear) : null },
      { vin: listing.vin ?? null, year: listing.year ?? null },
    );
    // Schema-1 records never stored the model year; their match was made for
    // this listing's own year, so only a stated contradiction rejects them.
    if (mismatch && mismatch !== "model_year_missing") return null;
  }
  const dated = isoOk(r.checkedAt) ? (isoOk(r.confirmedAt) && Date.parse(r.confirmedAt) > Date.parse(r.checkedAt) ? r.confirmedAt : r.checkedAt) : null;
  const diff = dated ? signed(r.fiveYearCostDifference) : null;
  const prices = r.costBasis?.fuelPrices;
  return {
    vehicleId: Number.isInteger(Number(r.vehicleId)) ? Number(r.vehicleId) : null,
    city: positive(r.city),
    highway: positive(r.highway),
    combined: positive(r.combined),
    ghgScore: positive(r.ghgScore),
    rangeMiles: positive(r.rangeMiles),
    fuelType: text(r.fuelType),
    annualFuelCost: dated ? positive(r.annualFuelCost) : null,
    fiveYear: diff === null ? null : { difference: diff, amount: Math.abs(diff), direction: fiveYearDirection(diff) },
    retrievedAt: dated,
    fuelPrices: dated && prices && typeof prices === "object" && isoOk(prices.retrievedAt) ? prices as EpaFuelPrices : null,
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Nov 5, 2026" in UTC, so every surface prints the same day for one retrieval. */
export function formatEpaDate(iso: string | null | undefined): string | null {
  if (!isoOk(iso)) return null;
  const d = new Date(iso);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

const dollars = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/** fueleconomy.gov's own wording for the 5-year comparison. */
export function fiveYearSentence(f: EpaView["fiveYear"]): string | null {
  if (!f) return null;
  if (f.direction === "save") return `You save ${dollars(f.amount)} in fuel costs over 5 years compared to the average new vehicle.`;
  if (f.direction === "spend") return `You spend ${dollars(f.amount)} more in fuel costs over 5 years compared to the average new vehicle.`;
  return "Fuel costs over 5 years are the same as the average new vehicle.";
}
