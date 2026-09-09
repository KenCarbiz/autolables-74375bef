// GENERATED — do not edit.
// Mirror of src/lib/vehicleFile/market.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// Market intelligence: six named analytical results, and the listing's life.
//
// Nothing in this module is a fact about the vehicle. Every value is a
// provider's opinion about a population the vehicle belongs to (§7, §33),
// which is why the section carries `kind: "analysis"` and why every
// candidate is UNKNOWN-REVIEW REQUIRED: no contract in this repository
// grants redistribution of any MarketCheck analytical family, and the four
// families here that no surface displays today (price change, reference
// price, MDS as a number, listing lifecycle dates) must stay withholdable
// by a customer projection (CUSTOMER_DISPLAY_LICENSE_MATRIX.md rows 1-8).
//
// What the maps established, and what this module refuses to repeat:
//
//   - `mc_attributes` is not a second opinion. `marketcheck-sync` rebuilds
//     it from the same feed listing it stores verbatim in `mc_raw`
//     (`marketcheck-sync/index.ts:1148-1153`), so reading both as separate
//     candidates would manufacture corroboration out of one statement. The
//     verbatim payload is preferred and the rebuilt copy only fills its gap;
//     `origin` always says which one answered.
//   - The feed's stamps are UNIX seconds (`last_seen_at: 1788921659`), which
//     `Date.parse` cannot read, so freshness has to decode them or every
//     market field reports UNKNOWN.
//   - `ref_price` has its own writer stamp, `ref_price_dt`, which lives only
//     in `mc_raw` (120/130 pilot) and runs roughly three weeks behind
//     `last_seen_at`. Ageing the reference price by the sync's stamp would
//     present a three-week-old comparison as today's.
//   - `dom_active`, `dom_180` and `dos_active` are not answers to "how long
//     has this car been for sale" — they count the current active spell, the
//     last 180 days and days on site, and on the pilot `dom` 68 sits against
//     `dom_active` 38 on the same car. They are not candidates for
//     `daysOnMarket`; admitting them would fabricate a disagreement.
//     `market_meta.avg_dom` is the market's average, not this car's.
//   - `dos_active` is days on SITE, not market days supply. The only real MDS
//     is `market_meta.market_days_supply`, from `/v2/mds/car`.
//   - `vehicle_files.market_value` is 0 on 284 of 284 rows across every
//     tenant, written only by a client default (`useVehicleFiles.ts:191`).
//     It is never a candidate (DUPLICATE_READ_PATHS.md §H6).
//   - `mc_attributes.ref_miles` is the mileage of the comparable set, not of
//     this car, and answers nothing in this section.

import type { Confidence, SourceKind } from "../vehicleTruth/precedence.ts";
import type {
  FieldCandidate,
  LicenseClass,
  ListingLifecycleSection,
  MarketIntelligenceSection,
} from "./readModelTypes.ts";
import { emptyField, resolveField } from "./resolveField.ts";
import { iso, latestStamp, num, obj, str, type Row, type VehicleFileSources } from "./sources.ts";

/** Every MarketCheck analytical family (matrix rows 1-8). No exceptions here. */
const ANALYSIS: LicenseClass = "UNKNOWN_REVIEW_REQUIRED";

const FEED = "MarketCheck syndication feed";
const PREDICT = "MarketCheck price prediction (/v2/predict/car/price)";
const COMPS_MEDIAN = "MarketCheck comparable-listing median (vehicle-enrich)";
const SEARCH = "MarketCheck active-listing search (/v2/search/car/active)";
const MDS = "MarketCheck market days supply (/v2/mds/car)";

const VALUE_HISTORY_PROVIDER: Record<string, string> = {
  market_pricing: "MarketCheck price prediction, snapshotted by marketcheck-market-pricing",
  vehicle_enrich: "MarketCheck valuation, snapshotted by vehicle-enrich",
};

interface CandidateInput<T> {
  value: T | null;
  source: SourceKind;
  origin: string;
  provider: string;
  observedAt: string | null;
  confidence: Confidence;
  license: LicenseClass;
  note?: string;
}

/**
 * `FieldCandidate.value` is typed `T`, but `resolveField` deliberately accepts
 * a null-valued candidate: it drops it from the ranking and still reports its
 * origin in the reason, so a source that answered nothing stays named instead
 * of vanishing. This cast is the single place the two shapes are reconciled,
 * mirroring `dealerState.ts`.
 */
const candidate = <T>(input: CandidateInput<T>): FieldCandidate<T> =>
  ({ ...input, value: input.value as T });

/**
 * MarketCheck stamps its syndication rows in UNIX seconds, which `Date.parse`
 * cannot read, so `iso()` returns null for every one of them. The epoch form
 * is checked before the ISO form so the result does not depend on how a
 * runtime guesses at a bare digit string.
 */
const feedStamp = (value: unknown): string | null => {
  const epoch = typeof value === "number"
    ? value
    : (typeof value === "string" && /^\d{9,13}$/.test(value.trim()) ? Number(value.trim()) : null);
  if (epoch != null && Number.isFinite(epoch) && epoch > 0) {
    return new Date(epoch > 1e11 ? epoch : epoch * 1000).toISOString();
  }
  return iso(value);
};

/** The oldest of several stamps; null when none parse. */
const earliestStamp = (...values: Array<string | null>): string | null => {
  let best: string | null = null;
  for (const v of values) {
    if (v && (!best || v < best)) best = v;
  }
  return best;
};

interface FeedRead<T> {
  value: T | null;
  origin: string;
}

const readFeed = <T>(
  mcRaw: Row,
  mcAttrs: Row,
  key: string,
  read: (row: Row) => T | null,
): FeedRead<T> => {
  const verbatim = read(mcRaw);
  if (verbatim !== null && verbatim !== undefined) {
    return { value: verbatim, origin: `vehicle_listings.mc_raw->${key}` };
  }
  const rebuilt = read(mcAttrs);
  if (rebuilt !== null && rebuilt !== undefined) {
    return { value: rebuilt, origin: `vehicle_listings.mc_attributes->${key}` };
  }
  return { value: null, origin: `vehicle_listings.mc_raw->${key}` };
};

export interface MarketIntelligenceOptions {
  now?: number;
  configuredOrder?: SourceKind[] | null;
}

const emptySection = (why: string): MarketIntelligenceSection => ({
  marketValue: emptyField<number>("market_value", why),
  daysOnMarket: emptyField<number>("days_on_market", why),
  comparableCount: emptyField<number>("comparable_count", why),
  marketDaysSupply: emptyField<number>("market_days_supply", why),
  priceChangePercent: emptyField<number>("price_change_percent", why),
  referencePrice: emptyField<number>("reference_price", why),
  kind: "analysis",
});

export function buildMarketIntelligence(
  sources: VehicleFileSources,
  opts: MarketIntelligenceOptions = {},
): MarketIntelligenceSection {
  const now = opts.now ?? Date.now();
  const order = opts.configuredOrder ?? null;
  const listing = sources.listing;

  if (!listing) {
    return emptySection("No vehicle_listings row was read for this vehicle.");
  }

  const mcRaw = obj(listing.mc_raw);
  const mcAttrs = obj(listing.mc_attributes);
  const marketPayload = obj(listing.market_payload);
  const marketMeta = obj(listing.market_meta);

  // When the feed last saw this listing, from the feed's own stamps. Never
  // `vehicle_facts.observed_at`, which records when the orchestrator ran.
  const feedObservedAt = latestStamp(
    feedStamp(mcRaw.scraped_at_date),
    feedStamp(mcRaw.scraped_at),
    feedStamp(mcRaw.last_seen_at_date),
    feedStamp(mcRaw.last_seen_at),
    feedStamp(mcAttrs.scraped_at),
    feedStamp(mcAttrs.last_seen_at),
  );

  // ── market value ─────────────────────────────────────────────────
  // Two writers reach `vehicle_listings.market_value`: the price-prediction
  // endpoint (`marketcheck-market-pricing/index.ts:82-96`) and, when that
  // returns nothing, the median of the comparable set
  // (`vehicle-enrich/index.ts:857-863`). They are different questions with
  // different error, so the provider name says which one answered rather
  // than calling both "market value".
  const payloadSource = str(marketPayload.source);
  const valueProvider = payloadSource && payloadSource.startsWith("comps_median")
    ? COMPS_MEDIAN
    : PREDICT;
  const columnValue = num(listing.market_value);
  const payloadValue = num(marketPayload.marketValue);
  const valueOrigin = columnValue != null
    ? "vehicle_listings.market_value"
    : "vehicle_listings.market_payload->marketValue";
  const valueStamp = latestStamp(listing.market_checked_at, marketPayload.checked_at);

  const marketValueCandidates: Array<FieldCandidate<number>> = [
    candidate<number>({
      value: columnValue ?? payloadValue,
      source: "marketcheck",
      origin: valueOrigin,
      provider: valueProvider,
      observedAt: valueStamp,
      confidence: "HIGH",
      license: ANALYSIS,
      note: payloadSource
        ? `market_payload.source is ${payloadSource}: a median of the stored comparable set, not `
          + "the provider's price model."
        : "An analytical estimate of what this vehicle would fetch, not a price anyone has paid "
          + "or asked. Redistribution standing is UNKNOWN-REVIEW REQUIRED.",
    }),
  ];

  // The time series the Passport's price-history chart is drawn from. It is
  // written by the same two jobs, so it normally agrees; when it does not,
  // one of the two writes failed and the column is behind its own history.
  const latestValueSnapshot = sources.valueHistory.find((row) => num(row.market_value) != null);
  if (latestValueSnapshot) {
    const snapSource = str(latestValueSnapshot.source);
    marketValueCandidates.push(candidate<number>({
      value: num(latestValueSnapshot.market_value),
      source: "marketcheck",
      origin: "vehicle_value_history.market_value",
      provider: snapSource
        ? (VALUE_HISTORY_PROVIDER[snapSource] ?? `MarketCheck valuation, snapshotted by ${snapSource}`)
        : "MarketCheck valuation, snapshot writer untagged",
      observedAt: iso(latestValueSnapshot.captured_at),
      confidence: "MEDIUM",
      license: ANALYSIS,
      note: "The newest snapshot that carries a value. `marketcheck_sync` rows never do (0 of "
        + "4,383 pilot rows), so this is the newest row from market-pricing or vehicle-enrich.",
    }));
  }
  const marketValue = resolveField<number>("market_value", marketValueCandidates, {
    now,
    configuredOrder: order,
  });

  // ── days on market ───────────────────────────────────────────────
  const domRead = readFeed(mcRaw, mcAttrs, "dom", (row) => num(row.dom));
  const domActive = num(mcRaw.dom_active ?? mcAttrs.dom_active);
  const daysOnMarket = resolveField<number>("days_on_market", [
    candidate<number>({
      value: domRead.value,
      source: "marketcheck",
      origin: domRead.origin,
      provider: FEED,
      observedAt: feedObservedAt,
      confidence: "HIGH",
      license: ANALYSIS,
      note: domActive != null && domRead.value != null && domActive !== domRead.value
        ? `The feed also reports dom_active ${domActive}, which counts the current active spell `
          + "rather than the whole listing, and dom_180, which counts only the last 180 days. "
          + "Neither is this field."
        : "The feed's count of days this listing has been on the market. Displayed today as "
          + "\"Days listed\" on the locked Passport; redistribution standing is UNKNOWN.",
    }),
  ], { now, configuredOrder: order });

  // ── comparable count ─────────────────────────────────────────────
  // `similar_count` is the provider's total match count (`numFound`,
  // `vehicle-enrich/index.ts:307,394`); `comparables` is the page of those
  // results we stored. On the pilot they differ by 1 on 44 cars and by as
  // much as 440 on others, because a wide search returns hundreds and we
  // keep a handful. That is two answers to two questions, so the difference
  // is declared expected rather than raised as a conflict.
  const metaStamp = iso(marketMeta.checked_at);
  const similarCount = num(marketMeta.similar_count);
  const storedComparables = Array.isArray(listing.comparables) ? listing.comparables.length : null;
  const comparableCount = resolveField<number>("comparable_count", [
    candidate<number>({
      value: similarCount,
      source: "marketcheck",
      origin: "vehicle_listings.market_meta->similar_count",
      provider: SEARCH,
      observedAt: metaStamp,
      confidence: "HIGH",
      license: ANALYSIS,
      note: "The provider's total match count for the comparable search. Rendered today as "
        + "\"listings analyzed\" on the locked Passport.",
    }),
    candidate<number>({
      value: storedComparables,
      source: "marketcheck",
      origin: "vehicle_listings.comparables (array length)",
      provider: `${SEARCH}, stored page`,
      observedAt: metaStamp,
      confidence: "MEDIUM",
      license: ANALYSIS,
      note: "How many comparable listings we kept, which is a capped page of the match set and "
        + "not a count of the market.",
    }),
  ], {
    now,
    configuredOrder: order,
    expectedDisagreement: "market_meta.similar_count is the provider's total match count and "
      + "vehicle_listings.comparables is the capped page of it that we stored.",
  });

  // ── market days supply ───────────────────────────────────────────
  // `vehicle-enrich` merges this key over the prior `market_meta` rather
  // than replacing the object (`vehicle-enrich/index.ts:875-886`), so a run
  // where the MDS call returned nothing leaves the previous figure in place
  // under the new run's `checked_at`. The stamp can therefore be newer than
  // the number it dates, which understates staleness — named here because
  // the freshness verdict cannot see it.
  const marketDaysSupply = resolveField<number>("market_days_supply", [
    candidate<number>({
      value: num(marketMeta.market_days_supply),
      source: "marketcheck",
      origin: "vehicle_listings.market_meta->market_days_supply",
      provider: MDS,
      observedAt: metaStamp,
      confidence: "HIGH",
      license: ANALYSIS,
      note: "Regional days of supply for this model, not a property of this car. market_meta is "
        + "merged rather than replaced, so this figure may predate its own checked_at stamp. "
        + "mc_raw.dos_active is days on site and is not this field.",
    }),
  ], { now, configuredOrder: order });

  // ── price change percent ─────────────────────────────────────────
  const pcpRead = readFeed(mcRaw, mcAttrs, "price_change_percent", (row) => num(row.price_change_percent));
  const priceChangePercent = resolveField<number>("price_change_percent", [
    candidate<number>({
      value: pcpRead.value,
      source: "marketcheck",
      origin: pcpRead.origin,
      provider: FEED,
      observedAt: feedObservedAt,
      confidence: "HIGH",
      license: ANALYSIS,
      note: "Present on 120 of 130 pilot cars and displayed by no mounted surface today "
        + "(CUSTOMER_DISPLAY_LICENSE_MATRIX row 2): the only readers are the unmounted "
        + "MarketTimingCard and a sticker prefill no template renders.",
    }),
  ], { now, configuredOrder: order });

  // ── reference price ──────────────────────────────────────────────
  // `ref_price_dt` is this field's own writer stamp and lives only in the
  // verbatim payload — `marketcheck-sync` copies `ref_price` into
  // `mc_attributes` and drops the date (`marketcheck-sync/index.ts:1150`). Ageing the reference price
  // by `last_seen_at` would report a three-week-old comparison as today's,
  // which is the whole reason freshness is computed per field.
  const refPriceRead = readFeed(mcRaw, mcAttrs, "ref_price", (row) => num(row.ref_price));
  const refPriceStamp = feedStamp(mcRaw.ref_price_dt);
  const referencePrice = resolveField<number>("reference_price", [
    candidate<number>({
      value: refPriceRead.value,
      source: "marketcheck",
      origin: refPriceRead.origin,
      provider: FEED,
      observedAt: refPriceStamp ?? feedObservedAt,
      confidence: "HIGH",
      license: ANALYSIS,
      note: refPriceStamp
        ? `Dated by the feed's own ref_price_dt (${refPriceStamp}), not by when the sync last ran.`
        : "vehicle_listings.mc_raw->ref_price_dt is absent, so this is aged by the feed's "
          + "last-seen stamp, which dates the sync and not the reference price.",
    }),
  ], { now, configuredOrder: order });

  return {
    marketValue,
    daysOnMarket,
    comparableCount,
    marketDaysSupply,
    priceChangePercent,
    referencePrice,
    kind: "analysis",
  };
}

/**
 * When the feed first and last saw this listing, and what our own records say
 * became of it.
 *
 * `first_seen_at` is not the car's arrival. On 100 of the 128 pilot cars that
 * carry it, it is LATER than our own listing row's `created_at`, because it
 * dates the current feed record rather than the vehicle; `first_seen_at_mc`
 * and `first_seen_at_source` sit months earlier on the same rows. The
 * earliest of the three is taken, since all three are the feed's own answer
 * to "when did this listing first appear" and only the earliest survives a
 * feed record being reissued.
 */
export function buildListingLifecycle(sources: VehicleFileSources): ListingLifecycleSection {
  const listing = sources.listing;
  const lifecycle = sources.lifecycle;
  const mcRaw = obj(listing?.mc_raw);
  const mcAttrs = obj(listing?.mc_attributes);

  const firstSeenAt = earliestStamp(
    feedStamp(mcRaw.first_seen_at_mc),
    feedStamp(mcRaw.first_seen_at_source),
    feedStamp(mcRaw.first_seen_at_date),
    feedStamp(mcRaw.first_seen_at),
    feedStamp(mcAttrs.first_seen_at),
  );
  const lastSeenAt = latestStamp(
    feedStamp(mcRaw.last_seen_at_date),
    feedStamp(mcRaw.last_seen_at),
    feedStamp(mcAttrs.last_seen_at),
  );

  const publishedAt = listing ? iso(listing.published_at) : null;
  const archivedAt = listing ? iso(listing.archived_at) : null;
  const archiveReason = listing ? str(listing.archive_reason) : null;
  const status = listing ? str(listing.status) : null;
  const lifecycleStage = lifecycle ? str(lifecycle.state) : null;

  // `recompute_vehicle_lifecycle` returns early on REMOVED, so a listing the
  // feed dropped and later returned never re-enters the flow. Every
  // lifecycle-first role home filters on this state before it reads the
  // listing, so a car in this position is live to shoppers and invisible to
  // the people who have to prepare it.
  let lifecycleContradiction: string | null = null;
  if (lifecycleStage === "REMOVED" && listing && !archivedAt) {
    const changedAt = iso(lifecycle?.state_changed_at);
    const previous = str(lifecycle?.previous_state);
    lifecycleContradiction = `vehicle_lifecycle.state is REMOVED`
      + `${changedAt ? ` since ${changedAt}` : ""}`
      + `${previous ? ` (previously ${previous})` : ""}`
      + `, while vehicle_listings.status is ${status ?? "unset"} and archived_at is null. `
      + "recompute_vehicle_lifecycle treats REMOVED as terminal, so a relisted car never "
      + "re-enters the flow, and ServiceWriterDesk, TechnicianHome, ServiceManagerHome and "
      + "ManagerIntake all read vehicle_lifecycle before the listing, so this car is invisible "
      + "to every service role while it is live to shoppers. 9 pilot vehicles are in this state.";
  }

  return {
    firstSeenAt,
    lastSeenAt,
    publishedAt,
    archivedAt,
    archiveReason,
    lifecycleStage,
    lifecycleContradiction,
  };
}
