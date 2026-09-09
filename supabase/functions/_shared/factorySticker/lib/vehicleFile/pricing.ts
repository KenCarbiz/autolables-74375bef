// GENERATED — do not edit.
// Mirror of src/lib/vehicleFile/pricing.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// Money: the advertised total, what it is made of, and what the shopper's own
// eyes saw on the dealer's page.
//
// This is the field the maps found wrong most often, so the rules it refuses
// to repeat are worth stating:
//
//   - Advertised retail has five live homes and they do not agree.
//     `vehicle_listings.price` is the number every employee surface and the
//     served Passport show (`priceModel.ts:195-213`: in `website_sale_price`
//     mode with a fee-inclusive tenant `resolveDisplayPrice` returns `price`);
//     the crawler ladder writes `website_sale_price` /
//     `advertised_price_before_doc` off the dealer's own page;
//     `advertised_prices` holds both channels; `vehicle_facts` and
//     `vehicle_snapshots` hold a copy taken at orchestration time that
//     disagrees with the column on 99 of 118 rows. All five are emitted, so
//     no reader can pick one by accident.
//   - `vehicle_facts` is a derived ledger, not a sixth source. Its row is a
//     copy of `vehicle_listings.price` read by `ingest.ts:137`, stored under
//     `source_kind = 'dealer_confirmed'` even on a tenant whose price is
//     written by the MarketCheck feed. Emitting it under that label would let
//     a two-month-old copy outrank the column it was copied from, which is
//     exactly the "Dealer stated over a feed value" defect this model exists
//     to remove. So the copy inherits the provenance of the column it copied,
//     and it is never stamped from `vehicle_facts.observed_at`, which records
//     when the orchestrator ran.
//   - A website observation must be a website observation. Only
//     `captured_method = 'dealer_vdp_observation'` qualifies;
//     `marketcheck_syndication` is the feed wearing the same table,
//     `crawl_seed` is a placeholder the admin panel writes holding the FEED
//     price, and a row whose method is unnamed has unknown provenance. None of
//     the last three is a candidate for anything.
//   - A refused page price leaves no `advertised_prices` row at all. Its only
//     durable trace is `audit_log.action = 'advertised_price_crawl_skipped'`,
//     and without reading it the 4 pilot VINs whose page reads above the feed
//     have no account of their price at all (directive §51).
//   - MSRP is two questions. `msrpFactory` is the Monroney total NeoVIN
//     decoded; `msrpFeed` is the MarketCheck listing field of the same name,
//     whose meaning is UNKNOWN and which disagrees with the factory answer on
//     104 of 123 vehicles. They are separate fields: neither is ever offered
//     as a candidate for the other, so neither reports a conflict against it.
//
// Evidence: SOURCE_TO_FACT_MATRIX.md §2.4, §3.3, §3.4, §5 rows 8-9, §8;
// DUPLICATE_READ_PATHS.md §B3, §C1, §C5, §H1-H2;
// CUSTOMER_DISPLAY_LICENSE_MATRIX.md §2a and rows 21, 22, 30, 31.

import type { Confidence, SourceKind } from "../vehicleTruth/precedence.ts";
import type {
  FieldCandidate,
  LicenseClass,
  PricingSection,
  PublicAdvertisementSection,
  ResolvedField,
} from "./readModelTypes.ts";
import { FRESHNESS_DAYS, emptyField, resolveField } from "./resolveField.ts";
import { dig, iso, num, obj, str, type Row, type VehicleFileSources } from "./sources.ts";

// ── Providers (who said it) ─────────────────────────────────────────

const FEED = "MarketCheck syndication feed";
const FEED_LISTING = "MarketCheck syndication feed (verbatim listing record)";
const FEED_LEDGER = "MarketCheck syndication feed (price-change ledger row)";
const VDP = "Dealer VDP observation (Firecrawl render of the dealer's own page)";
const DEALER_SETTING = "Dealer profile setting";
const DEALER_MANUAL = "Dealer manual confirmation";
const DEALER_ROW = "Dealer inventory row (writer not recorded)";
const NEOVIN_DECODE = "NeoVIN decode snapshot";
const NEOVIN_SHEET = "NeoVIN build sheet";
const GENERIC_SHEET = "Generic build sheet (not a VIN-specific decode)";
const STICKER_RECORD = "Factory sticker record (normalized build sheet)";
const LEDGER = "AutoLabels truth ledger";

// ── Licence classes (CUSTOMER_DISPLAY_LICENSE_MATRIX.md) ────────────

/**
 * §2a: the dealer's own asking price is the dealer's own claim, cleared to
 * display as that claim. The clearance covers the claim and not the record it
 * is stored in — on this tenant that record is the MarketCheck syndication
 * row, whose redistribution is UNKNOWN — and `FieldCandidate` carries one
 * licence field, not two, so the record half travels in `note`.
 */
const DEALER_CLAIM: LicenseClass = "CUSTOMER_DISPLAY_CLEARED";
/** Rows 21-22: both MSRP concepts are provider records with no clearance. */
const PROVIDER_RECORD: LicenseClass = "UNKNOWN_REVIEW_REQUIRED";

const FEED_RECORD_NOTE =
  "Dealer-owned claim (CUSTOMER DISPLAY CLEARED); the stored record is the MarketCheck syndication "
  + "row, whose redistribution is UNKNOWN-REVIEW REQUIRED.";

const VDP_RECORD_NOTE =
  "The dealer's own published price, read off the dealer's own page. Matrix row 30 classes the "
  + "Firecrawl render itself as internal-use only; the price it read is the dealer's own claim (§2a).";

// ── Stamps ──────────────────────────────────────────────────────────

/**
 * MarketCheck stamps `last_seen_at` / `first_seen_at` as epoch seconds, which
 * `Date.parse` rejects. Without this every feed-written price would report an
 * unknown observation time and could never be aged against the 3-day policy.
 */
const feedStamp = (value: unknown): string | null => {
  const s = str(value);
  if (!s) return null;
  if (/^\d{9,13}$/.test(s)) {
    const n = Number(s);
    return new Date(s.length > 10 ? n : n * 1000).toISOString();
  }
  return iso(s);
};

// ── The fee arithmetic, in one place ────────────────────────────────
//
// total   = the advertised retail exactly as the dealer advertises it.
// selling = total − doc fee, and ONLY when this tenant advertises a
//           fee-inclusive total (`dealer_profiles.settings.
//           advertised_includes_doc_fee`, the same flag
//           `marketcheck-sync/index.ts:769` reads and the same rule
//           `buildBreakdown` applies to a page price). When the advertised
//           price already excludes the fee, the advertised total IS the
//           selling price, and subtracting again would invent a discount.
// An unknown fee on a fee-inclusive tenant leaves the selling price unknown;
// it does not make it equal to the total.

const beforeDocFee = (total: number | null, docFee: number | null, includesFee: boolean): number | null => {
  if (total == null) return null;
  if (!includesFee) return total;
  if (docFee == null) return null;
  return total - docFee;
};

/** The inverse, for a figure that was recorded on the before-doc basis. */
const withDocFee = (beforeDoc: number | null, docFee: number | null, includesFee: boolean): number | null => {
  if (beforeDoc == null) return null;
  if (!includesFee) return beforeDoc;
  if (docFee == null) return null;
  return beforeDoc + docFee;
};

// ── Candidate assembly ──────────────────────────────────────────────

export interface BuildPricingOptions {
  /** Milliseconds since the epoch; injected so a projection is testable. */
  now?: number;
  /** Tenant's configured source order, from `source_authority_rules`. */
  configuredOrder?: SourceKind[] | null;
}

interface Spec<T> {
  value: T | null | undefined;
  source: SourceKind;
  origin: string;
  provider: string;
  observedAt: string | null;
  confidence: Confidence;
  license: LicenseClass;
  note?: string;
}

const add = <T>(into: Array<FieldCandidate<T>>, spec: Spec<T>): void => {
  if (spec.value === null || spec.value === undefined || spec.value === "") return;
  const candidate: FieldCandidate<T> = {
    value: spec.value,
    source: spec.source,
    origin: spec.origin,
    provider: spec.provider,
    observedAt: spec.observedAt,
    confidence: spec.confidence,
    license: spec.license,
  };
  if (spec.note) candidate.note = spec.note;
  into.push(candidate);
};

/** Two money figures are the same figure when they are within a dollar. */
const near = (a: number | null, b: number | null): boolean =>
  a != null && b != null && Math.abs(a - b) <= 1.005;

// ── advertised_prices ───────────────────────────────────────────────

const WEBSITE_OBSERVATION = "dealer_vdp_observation";
const FEED_CAPTURE = "marketcheck_syndication";
const MANUAL_CAPTURE = "manual_dealer_confirmation";

/**
 * Newest first by the writer's own `captured_at`.
 *
 * The bundle documents these rows as newest-first already; re-sorting means a
 * change in fetch order cannot silently move which observation counts as the
 * latest. A row whose `captured_method` is not one of the named methods is
 * never returned: `crawl_seed` holds the feed price under a website channel,
 * and an unstamped method is provenance nobody recorded (§H2).
 */
const byCapturedAt = (rows: Row[], method: string): Row[] =>
  rows
    .filter((r) => str(r.captured_method) === method)
    .sort((a, b) => String(iso(b.captured_at) ?? "").localeCompare(String(iso(a.captured_at) ?? "")));

// ── Shared context ──────────────────────────────────────────────────

interface PriceContext {
  listing: Row | null;
  mcRaw: Row;
  mcAttrs: Row;
  /** `vehicle_snapshots.snapshot_json.pricing` — the frozen ledger copy. */
  snapshotPricing: Row;
  /** `vehicle_facts` values by fact key, already narrowed to numbers. */
  facts: Map<string, number>;
  /** The feed's own observation stamp for everything the nightly sync wrote. */
  feedSeenAt: string | null;
  /** Stamped by whichever of the sync, the crawl or the recalc RPC ran last. */
  priceVerifiedAt: string | null;
  /** A feed record backs this row, so its price is the feed's, not a dealer's. */
  feedWritten: boolean;
  webObservations: Row[];
  feedCaptures: Row[];
  manualCaptures: Row[];
  latestWeb: Row | null;
  latestWebAt: string | null;
  docFee: ResolvedField<number>;
  includesDocFee: boolean;
  displayMode: string | null;
}

const PRICE_MODES = new Set(["advertised_before_doc", "website_sale_price"]);

const factValues = (rows: Row[]): Map<string, number> => {
  const out = new Map<string, number>();
  for (const row of rows) {
    const key = str(row.fact_key);
    const value = num(obj(row.fact_value).v);
    if (key && value != null && !out.has(key)) out.set(key, value);
  }
  return out;
};

function priceContext(sources: VehicleFileSources, now: number, order: SourceKind[] | null): PriceContext {
  const listing = sources.listing;
  const mcRaw = obj(listing?.mc_raw);
  const mcAttrs = obj(listing?.mc_attributes);
  const settings = obj(sources.dealerProfile?.settings);

  const priceVerifiedAt = iso(listing?.price_last_verified_at);
  const feedCaptures = byCapturedAt(sources.advertisedPrices, FEED_CAPTURE);
  const webObservations = byCapturedAt(sources.advertisedPrices, WEBSITE_OBSERVATION);
  const latestWeb = webObservations[0] ?? null;

  // `doc_fee_enabled = false` is a real answer of zero. Only a profile that
  // does not mention the fee at all leaves it unanswered.
  const feeConfigured = settings.doc_fee_enabled !== undefined;
  const feeEnabled = str(settings.doc_fee_enabled) === "true";
  const profileFee = feeConfigured ? (feeEnabled ? num(settings.doc_fee_amount) ?? 0 : 0) : null;

  const docFeeCandidates: Array<FieldCandidate<number>> = [];
  add(docFeeCandidates, {
    value: profileFee,
    source: "dealer_confirmed",
    origin: "dealer_profiles.settings.doc_fee_amount",
    provider: DEALER_SETTING,
    observedAt: iso(sources.dealerProfile?.updated_at),
    confidence: "VERIFIED",
    license: DEALER_CLAIM,
    note: feeEnabled
      ? "The tenant's configured conveyance fee. marketcheck-sync and the VDP crawl copy this one "
        + "number onto every listing row, so the listing copy is never independent evidence of it."
      : "doc_fee_enabled is not true, so this tenant's configured fee is zero.",
  });
  add(docFeeCandidates, {
    value: num(listing?.doc_fee),
    source: "dealer_confirmed",
    origin: "vehicle_listings.doc_fee",
    provider: `${DEALER_SETTING} (copied onto the listing)`,
    observedAt: priceVerifiedAt,
    confidence: "HIGH",
    license: DEALER_CLAIM,
    note: "Written by marketcheck-sync, the VDP crawl or recalc_tenant_doc_fee from the profile "
      + "setting; it disagrees with the profile only when one of those is behind.",
  });

  return {
    listing,
    mcRaw,
    mcAttrs,
    snapshotPricing: obj(dig(sources.snapshot?.snapshot_json, "pricing")),
    facts: factValues(sources.facts),
    feedSeenAt: feedStamp(mcRaw.last_seen_at) ?? feedStamp(mcAttrs.last_seen_at),
    priceVerifiedAt,
    feedWritten: num(mcRaw.price) != null || str(mcAttrs.mc_listing_id) != null || feedCaptures.length > 0,
    webObservations,
    feedCaptures,
    manualCaptures: byCapturedAt(sources.advertisedPrices, MANUAL_CAPTURE),
    latestWeb,
    latestWebAt: iso(latestWeb?.captured_at),
    docFee: resolveField<number>("doc_fee", docFeeCandidates, { now, configuredOrder: order }),
    includesDocFee: str(settings.advertised_includes_doc_fee) === "true",
    displayMode: PRICE_MODES.has(str(settings.price_display_mode) ?? "")
      ? str(settings.price_display_mode)
      : null,
  };
}

// ── Advertised retail ───────────────────────────────────────────────

/**
 * A ledger copy inherits the provenance of the column it copied, because that
 * is what it is: a reading of `vehicle_listings.price` taken when the
 * orchestrator last ran.
 */
const ledgerSource = (ctx: PriceContext): SourceKind => (ctx.feedWritten ? "marketcheck" : "dealer_confirmed");

function advertisedRetailCandidates(ctx: PriceContext): Array<FieldCandidate<number>> {
  const out: Array<FieldCandidate<number>> = [];
  const listing = ctx.listing;
  if (!listing) return out;

  // First among the equally ranked feed candidates on purpose: when two of
  // them carry the same stamp the insertion order decides, and the column
  // every consumer already reads is the one that should win, so the shadow
  // answer and the served answer agree instead of differing by provenance.
  add(out, {
    value: num(listing.price),
    source: ctx.feedWritten ? "marketcheck" : "dealer_confirmed",
    origin: "vehicle_listings.price",
    provider: ctx.feedWritten ? FEED : DEALER_ROW,
    observedAt: ctx.priceVerifiedAt,
    confidence: ctx.feedWritten ? "HIGH" : "MEDIUM",
    license: DEALER_CLAIM,
    note: ctx.feedWritten
      ? `${FEED_RECORD_NOTE} price_last_verified_at is stamped by whichever of the nightly sync, the `
        + "VDP crawl or recalc_tenant_doc_fee ran last, so it dates the last verification of the "
        + "price block rather than of the feed value alone."
      : "vehicle_listings has no source column and no feed record backs this row, so the writer "
        + "(dealer entry, DMS or Autocurb) is UNKNOWN; this is not claimed as a dealer confirmation.",
  });

  add(out, {
    value: num(ctx.mcRaw.price),
    source: "marketcheck",
    origin: "vehicle_listings.mc_raw->>'price'",
    provider: FEED_LISTING,
    observedAt: ctx.feedSeenAt,
    confidence: "HIGH",
    license: DEALER_CLAIM,
    note: `${FEED_RECORD_NOTE} Stamped with MarketCheck's own last_seen_at, so this is the one `
      + "advertised-retail candidate aged by the provider's clock rather than by ours.",
  });

  const feedRow = ctx.feedCaptures[0];
  add(out, {
    value: num(feedRow?.advertised_price),
    source: "marketcheck",
    origin: "advertised_prices.advertised_price (captured_method=marketcheck_syndication)",
    provider: FEED_LEDGER,
    observedAt: iso(feedRow?.captured_at),
    confidence: "HIGH",
    license: DEALER_CLAIM,
    note: "marketcheck-sync appends a feed row only when the price moved by at least $1, so this "
      + `stamp dates the last price CHANGE, not the last confirmation. ${FEED_RECORD_NOTE}`,
  });

  const manualRow = ctx.manualCaptures[0];
  add(out, {
    value: num(manualRow?.advertised_price),
    source: "dealer_confirmed",
    origin: "advertised_prices.advertised_price (captured_method=manual_dealer_confirmation)",
    provider: DEALER_MANUAL,
    observedAt: iso(manualRow?.captured_at),
    confidence: "VERIFIED",
    license: DEALER_CLAIM,
    note: "A person at the dealership confirmed this price. 0 such rows exist live; the client "
      + "capture path does not stamp captured_method (useAdvertisedPrices.ts:70-77).",
  });

  // `website_sale_price` is written by two hands: the sync's ladder restates
  // the feed price, and the crawl's clean branch writes the observed page
  // total. Nothing records which one wrote it, so it is read back from the
  // value — the same comparison the crawl's own change detector makes.
  //
  // It is a fee-INCLUSIVE total by construction, so it answers the same
  // question as the advertised total only for a tenant that advertises
  // fee-inclusive. For a fee-exclusive tenant it is `price + doc_fee`, a
  // different number about a different question, and offering it here would
  // report a disagreement on every vehicle forever.
  const websiteSale = ctx.includesDocFee ? num(listing.website_sale_price) : null;
  const latestWebPrice = num(ctx.latestWeb?.advertised_price);
  const ladderIsPageTotal = near(websiteSale, latestWebPrice);
  add(out, {
    value: websiteSale,
    source: ladderIsPageTotal ? "dealer_vdp" : "marketcheck",
    origin: "vehicle_listings.website_sale_price",
    provider: ladderIsPageTotal ? `${VDP} (crawler price ladder)` : `${FEED} (doc-fee ladder)`,
    observedAt: ladderIsPageTotal ? ctx.latestWebAt : ctx.priceVerifiedAt,
    confidence: ladderIsPageTotal ? "MEDIUM" : "HIGH",
    license: DEALER_CLAIM,
    note: ladderIsPageTotal
      ? "Equal to the latest page observation, so the VDP crawl's clean branch wrote it "
        + "(crawl-advertised-prices/index.ts:1704-1715)."
      : "Not equal to any page observation, so the nightly sync's doc-fee ladder wrote it from the "
        + "feed price (marketcheck-sync/index.ts:1061-1067).",
  });

  add(out, {
    value: latestWebPrice,
    source: "dealer_vdp",
    origin: "advertised_prices.advertised_price (captured_method=dealer_vdp_observation)",
    provider: VDP,
    observedAt: ctx.latestWebAt,
    confidence: "MEDIUM",
    license: DEALER_CLAIM,
    note: `${VDP_RECORD_NOTE} It is also carried as its own named concept in publicAdvertisement; on `
      + "5 of the 20 observed pilot VINs it disagrees with the feed on the same day, and no reader "
      + "records which of the two the dealer intends.",
  });

  const ledgerKind = ledgerSource(ctx);
  const ledgerOf = ledgerKind === "marketcheck" ? FEED : DEALER_ROW;
  add(out, {
    value: ctx.facts.get("advertised_price") ?? null,
    source: ledgerKind,
    origin: "vehicle_facts.fact_value->>'v' (fact_key=advertised_price)",
    provider: `${LEDGER} copy of ${ledgerOf}`,
    observedAt: null,
    confidence: "HIGH",
    license: DEALER_CLAIM,
    note: "A copy of vehicle_listings.price taken when the orchestrator last ran (ingest.ts:137). It "
      + "is stored as dealer_confirmed VERIFIED and disagrees with the column on 99 of 118 pilot "
      + "rows; unstamped here because vehicle_facts.observed_at records the orchestration, not an "
      + "observation, which is also why it cannot win the recency tiebreak against the column.",
  });

  add(out, {
    value: num(ctx.snapshotPricing.advertisedPrice),
    source: ledgerKind,
    origin: "vehicle_snapshots.snapshot_json->'pricing'->>'advertisedPrice'",
    provider: `${LEDGER} snapshot copy of ${ledgerOf}`,
    observedAt: null,
    confidence: "HIGH",
    license: DEALER_CLAIM,
    note: "The same orchestration-time copy frozen into the snapshot; unstamped for the same reason.",
  });

  return out;
}

/**
 * The selling price is the advertised total less the fee, computed from the
 * resolved total so the two can never describe different pages.
 *
 * `vehicle_listings.advertised_price_before_doc` is emitted alongside it
 * rather than as it: the nightly sync writes that column as
 * `price − doc_fee`, and the VDP crawl overwrites it as
 * `page price − doc_fee` (`crawl-advertised-prices/index.ts:1704`), so on a
 * crawled vehicle the column is a fee-stripped WEBSITE figure sitting next to
 * a FEED total. Which of the two wrote it is not recorded, so it is read back
 * from the value.
 */
function sellingPrice(
  ctx: PriceContext,
  total: ResolvedField<number>,
  now: number,
  order: SourceKind[] | null,
): ResolvedField<number> {
  const listing = ctx.listing;
  const fee = ctx.docFee.value;
  const derived = beforeDocFee(total.value, fee, ctx.includesDocFee);
  const out: Array<FieldCandidate<number>> = [];

  if (derived != null && total.chosen) {
    add(out, {
      value: derived,
      source: total.chosen.source,
      origin: ctx.includesDocFee ? `${total.chosen.origin} - vehicle_listings.doc_fee` : total.chosen.origin,
      provider: total.chosen.provider,
      observedAt: total.chosen.observedAt,
      confidence: total.chosen.confidence,
      license: DEALER_CLAIM,
      note: ctx.includesDocFee
        ? `The advertised total less the ${fee} doc fee, because this tenant advertises a `
          + "fee-inclusive price (dealer_profiles.settings.advertised_includes_doc_fee)."
        : "This tenant's advertised price already excludes the doc fee, so the advertised total is "
          + "the selling price.",
    });
  }

  const beforeDoc = num(listing?.advertised_price_before_doc);
  const feedLadder = near(beforeDoc, beforeDocFee(num(listing?.price), fee, ctx.includesDocFee));
  const pageLadder = near(beforeDoc, beforeDocFee(num(ctx.latestWeb?.advertised_price), fee, ctx.includesDocFee));
  add(out, {
    value: beforeDoc,
    source: feedLadder ? "marketcheck" : pageLadder ? "dealer_vdp" : "other_structured",
    origin: "vehicle_listings.advertised_price_before_doc",
    provider: feedLadder ? `${FEED} (doc-fee ladder)` : pageLadder ? `${VDP} (crawler price ladder)` : DEALER_ROW,
    observedAt: feedLadder ? ctx.priceVerifiedAt : pageLadder ? ctx.latestWebAt : null,
    confidence: feedLadder ? "HIGH" : "MEDIUM",
    license: DEALER_CLAIM,
    note: feedLadder
      ? "Equals the feed price less the doc fee, so marketcheck-sync's ladder wrote it "
        + "(marketcheck-sync/index.ts:1061-1067)."
      : pageLadder
        ? "Equals the observed page price less the doc fee, so the VDP crawl wrote it. It is a "
          + "fee-stripped WEBSITE figure, which is why it can differ from the feed total's selling "
          + "price without either being wrong."
        : "Matches neither ladder, so which writer produced it is UNKNOWN and it is not stamped.",
  });

  if (!out.length) {
    const why = total.value == null
      ? `No advertised total resolved, so no selling price can follow from it. ${total.reason}`
      : `This tenant advertises a fee-inclusive total and the doc fee is unknown, so the selling `
        + `price cannot be derived. ${ctx.docFee.reason}`;
    return emptyField<number>("selling_price", why);
  }
  return resolveField<number>("selling_price", out, { now, configuredOrder: order });
}

/**
 * `vehicle_listings.dealer_discount` has exactly one writer: the VDP crawl's
 * clean branch. The nightly sync never touches it, so a value here is always a
 * reading of the dealer's own page, dated by the observation that produced it.
 */
function discountCandidates(ctx: PriceContext): Array<FieldCandidate<number>> {
  const out: Array<FieldCandidate<number>> = [];
  add(out, {
    value: num(ctx.listing?.dealer_discount),
    source: "dealer_vdp",
    origin: "vehicle_listings.dealer_discount",
    provider: VDP,
    observedAt: ctx.latestWebAt,
    confidence: "MEDIUM",
    license: DEALER_CLAIM,
    note: `${VDP_RECORD_NOTE} Parsed from the page's savings line by crawl-advertised-prices/index.ts:1707; `
      + (ctx.latestWebAt
        ? "dated by the latest accepted observation, which is the run that wrote it."
        : "no accepted observation remains for this VIN, so nothing dates it."),
  });
  return out;
}

// ── MSRP: two questions, never merged ───────────────────────────────

/**
 * The provider's own response is the verified answer; everything downstream of
 * it is a copy. That is why only `neovin_snapshots.payload` is emitted as
 * VERIFIED: two VERIFIED candidates from the same provider disagreeing would
 * be reported CONFLICTED, when what actually happened is that one copy is
 * older than another.
 */
function msrpFactoryCandidates(sources: VehicleFileSources, ctx: PriceContext): Array<FieldCandidate<number>> {
  const out: Array<FieldCandidate<number>> = [];
  const neovin = sources.neovin;
  const payload = obj(neovin?.payload);
  const decodedByNeovin = (str(neovin?.endpoint) ?? "").includes("neovin");

  // NeoVIN's own `msrp` key is the BASE price; the Monroney total is
  // `combined_msrp` (_shared/neovinSheet.ts:117-121). Reading `msrp` here
  // would put a base price under a total-MSRP label.
  const totalKey = ["combined_msrp", "total_msrp", "total_price", "msrp_with_options"]
    .find((k) => num(payload[k]) != null);
  add(out, {
    value: totalKey ? num(payload[totalKey]) : null,
    source: decodedByNeovin ? "neovin" : "other_structured",
    origin: `neovin_snapshots.payload->>'${totalKey ?? "combined_msrp"}'`,
    provider: decodedByNeovin ? NEOVIN_DECODE : `${NEOVIN_DECODE} (non-NeoVIN endpoint)`,
    observedAt: iso(neovin?.fetched_at),
    confidence: decodedByNeovin ? "VERIFIED" : "MEDIUM",
    license: PROVIDER_RECORD,
    note: "The provider's verbatim response, stamped with its own retrieval time. Its `msrp` key is "
      + "the BASE price and is deliberately not read here.",
  });

  // A generic sheet is typical-for-trim data, not this VIN's build, and the
  // truth engine caps it at MEDIUM for exactly that reason (ingest.ts:69-77).
  const sheet = obj(dig(ctx.mcAttrs, "build_sheet"));
  const generic = dig(sheet, "generic") === true;
  const sheetIsNeovin = str(ctx.mcAttrs.specs_source) === "neovin" && !generic;
  const sheetSource: SourceKind = sheetIsNeovin ? "neovin" : "other_structured";
  const sheetProvider = sheetIsNeovin ? NEOVIN_SHEET : GENERIC_SHEET;
  const decodedAt = iso(ctx.mcAttrs.specs_decoded_at);

  add(out, {
    value: num(dig(sheet, "pricing", "total_msrp")),
    source: sheetSource,
    origin: "vehicle_listings.mc_attributes->'build_sheet'->'pricing'->>'total_msrp'",
    provider: sheetProvider,
    observedAt: decodedAt,
    confidence: sheetIsNeovin ? "HIGH" : "MEDIUM",
    license: PROVIDER_RECORD,
    note: "The extracted build sheet, stamped by specs_decoded_at (when the decode ran). It survives "
      + "the nightly rebuild via DECODE_OWNED_KEYS, unlike engine and drivetrain.",
  });

  add(out, {
    value: num(ctx.mcAttrs.total_msrp),
    source: sheetSource,
    origin: "vehicle_listings.mc_attributes->>'total_msrp'",
    provider: `${sheetProvider} (lifted to the top level)`,
    observedAt: decodedAt,
    confidence: sheetIsNeovin ? "HIGH" : "MEDIUM",
    license: PROVIDER_RECORD,
    note: "Lifted out of the sheet by marketcheck-specs/index.ts:310 so downstream readers find it; "
      + "absent on 22 of the pilot rows whose sheet carries the number.",
  });

  const stickerPricing = obj(dig(sources.factorySticker?.normalized_data_json, "pricing"));
  const stickerTotal = num(stickerPricing.sourceReportedTotalMsrp) ?? num(stickerPricing.calculatedTotalMsrp);
  add(out, {
    value: stickerTotal,
    source: sheetSource,
    origin: "factory_sticker_records.normalized_data_json->'pricing'->>'sourceReportedTotalMsrp'",
    provider: STICKER_RECORD,
    observedAt: null,
    confidence: "MEDIUM",
    license: PROVIDER_RECORD,
    note: "Our own normalization of the same build sheet. Unstamped: factory_sticker_records carries "
      + "our generation time, which is not when the provider observed anything.",
  });

  add(out, {
    value: ctx.facts.get("total_msrp") ?? null,
    source: sheetSource,
    origin: "vehicle_facts.fact_value->>'v' (fact_key=total_msrp)",
    provider: `${LEDGER} copy of ${sheetProvider}`,
    observedAt: null,
    confidence: "MEDIUM",
    license: PROVIDER_RECORD,
    note: "The derived ledger's copy of the same sheet value; unstamped because "
      + "vehicle_facts.observed_at is the orchestration time.",
  });

  return out;
}

/**
 * The feed's own `msrp` field. Its semantics are UNKNOWN — on a 2019 Q50 it
 * read 27,887 against a real base MSRP of 53,350, which is why `ingest.ts:179-184`
 * refuses it as a manufacturer price — and it is nevertheless the number the
 * Passport prints as "MSRP" (`passportV2Data.ts:518`). It is kept as its own
 * field so that printing it never implies a factory answer.
 */
function msrpFeedCandidates(ctx: PriceContext): Array<FieldCandidate<number>> {
  const out: Array<FieldCandidate<number>> = [];
  const note = "Feed field of unknown semantics: it disagrees with the NeoVIN Monroney total on 104 "
    + "of 123 pilot vehicles and is never a manufacturer price. UNKNOWN-REVIEW REQUIRED for display "
    + "(matrix rows 21-22).";

  // The served column first, so a stamp tie resolves to the value the Passport
  // already shows rather than to the raw record behind it.
  add(out, {
    value: num(ctx.mcAttrs.msrp),
    source: "marketcheck",
    origin: "vehicle_listings.mc_attributes->>'msrp'",
    provider: FEED,
    observedAt: ctx.feedSeenAt,
    confidence: "HIGH",
    license: PROVIDER_RECORD,
    note: `${note} This is the column the Passport reads.`,
  });
  add(out, {
    value: num(ctx.mcRaw.msrp),
    source: "marketcheck",
    origin: "vehicle_listings.mc_raw->>'msrp'",
    provider: FEED_LISTING,
    observedAt: ctx.feedSeenAt,
    confidence: "HIGH",
    license: PROVIDER_RECORD,
    note: `${note} The verbatim feed record the column is rebuilt from nightly.`,
  });
  return out;
}

// ── Public advertisement ────────────────────────────────────────────

interface Refusal {
  scraped: number;
  feed: number;
  at: string;
  url: string | null;
}

/**
 * The newest refusal, from the audit tail.
 *
 * A refused observation writes no `advertised_prices` row at all
 * (`crawl-advertised-prices/index.ts:1673-1696`), so this is the only durable
 * record that the dealer's page was read and disbelieved. `details.scraped` is
 * the page price with the doc fee already backed out and `details.feed` is
 * `vehicle_listings.price`, which for a fee-inclusive tenant still contains
 * it: the guard compares the two bases directly. Both are reported exactly as
 * the audit row holds them — an audit record is not rewritten to make its two
 * numbers comparable.
 */
function latestRefusal(rows: Row[]): Refusal | null {
  let best: Refusal | null = null;
  for (const row of rows) {
    const details = obj(row.details);
    const scraped = num(details.scraped);
    const feed = num(details.feed);
    const at = iso(row.created_at);
    if (scraped == null || feed == null || !at) continue;
    if (!best || at > best.at) best = { scraped, feed, at, url: str(details.url) };
  }
  return best;
}

export function buildPublicAdvertisement(
  sources: VehicleFileSources,
  opts: BuildPricingOptions = {},
): PublicAdvertisementSection {
  const now = opts.now ?? Date.now();
  const order = opts.configuredOrder ?? null;
  const ctx = priceContext(sources, now, order);

  const observation = ctx.latestWeb;
  const observedTotal = num(observation?.advertised_price);
  const refusal = latestRefusal(sources.crawlRefusals);
  const fee = ctx.docFee.value;

  // The freshness policy for a page reading is its own 7-day window: a
  // fortnight-old capture is not what the shopper sees. `factKeyFor` folds
  // observed_price onto advertised_price for RANKING, which is right — it is
  // the same fact family — but that also picks up advertised_price's 3-day
  // window, so the observation's own policy is passed explicitly.
  const observationWindow = FRESHNESS_DAYS.observed_price;

  const priceCandidates: Array<FieldCandidate<number>> = [];
  add(priceCandidates, {
    value: observedTotal,
    source: "dealer_vdp",
    origin: "advertised_prices.advertised_price (captured_method=dealer_vdp_observation)",
    provider: VDP,
    observedAt: ctx.latestWebAt,
    confidence: "MEDIUM",
    license: DEALER_CLAIM,
    note: VDP_RECORD_NOTE,
  });

  // A refused reading is evidence that the page moved, not a price, so it is
  // added only when there is an accepted observation for it to supersede. It
  // is capped below that observation so it can never become the answer, and it
  // is converted to the observation's fee basis first, because the audit row
  // records it with the doc fee already removed.
  if (observedTotal != null && refusal && ctx.latestWebAt && refusal.at > ctx.latestWebAt) {
    add(priceCandidates, {
      value: withDocFee(refusal.scraped, fee, ctx.includesDocFee),
      source: "dealer_vdp",
      origin: "audit_log.details->>'scraped' (action=advertised_price_crawl_skipped)",
      provider: `${VDP} (refused by the misparse guard)`,
      observedAt: refusal.at,
      confidence: "LOW",
      license: DEALER_CLAIM,
      note: `The crawl read ${refusal.scraped} before doc fee against a feed price of ${refusal.feed} `
        + "and refused it as a sticker/MSRP or lease mis-parse, so no advertised_prices row was "
        + "written. It is carried only to show that the accepted observation has been overtaken.",
    });
  }

  const observedPrice = priceCandidates.length
    ? resolveField<number>("observed_price", priceCandidates, {
      now,
      configuredOrder: order,
      freshnessDays: observationWindow,
    })
    : emptyField<number>(
      "observed_price",
      refusal
        ? `The only page reading for this vehicle was refused by the misparse guard on ${refusal.at} `
          + `(page ${refusal.scraped} before doc fee against feed ${refusal.feed}); a refusal writes no `
          + "advertised_prices row, so there is no observation. audit_log.advertised_price_crawl_skipped."
        : "No dealer_vdp_observation row exists for this vehicle; the feed rows in advertised_prices "
          + "are the feed's answer, not an observation of the dealer's page.",
    );

  const beforeDoc = beforeDocFee(observedTotal, fee, ctx.includesDocFee);
  const beforeDocCandidates: Array<FieldCandidate<number>> = [];
  if (observation) {
    add(beforeDocCandidates, {
      value: beforeDoc,
      source: "dealer_vdp",
      origin: ctx.includesDocFee
        ? "advertised_prices.advertised_price - vehicle_listings.doc_fee"
        : "advertised_prices.advertised_price",
      provider: VDP,
      observedAt: ctx.latestWebAt,
      confidence: "MEDIUM",
      license: DEALER_CLAIM,
      note: ctx.includesDocFee
        ? "The observed page total less the doc fee, the same derivation buildBreakdown applies "
          + "before storing advertised_price_before_doc."
        : "This tenant's advertised price excludes the doc fee, so the observed total is already the "
          + "before-doc figure.",
    });
    add(beforeDocCandidates, {
      value: near(num(ctx.listing?.advertised_price_before_doc), beforeDoc)
        ? num(ctx.listing?.advertised_price_before_doc)
        : null,
      source: "dealer_vdp",
      origin: "vehicle_listings.advertised_price_before_doc",
      provider: `${VDP} (crawler price ladder)`,
      observedAt: ctx.latestWebAt,
      confidence: "MEDIUM",
      license: DEALER_CLAIM,
      note: "The stored ladder column, emitted only while it still agrees with this observation; when "
        + "the nightly sync has since rewritten it from the feed price it belongs to the feed ladder "
        + "and is not an observation of anything.",
    });
  }

  const docFeeCandidates: Array<FieldCandidate<number>> = [];
  if (observation) {
    add(docFeeCandidates, {
      value: num(ctx.listing?.doc_fee),
      source: "dealer_confirmed",
      origin: "vehicle_listings.doc_fee",
      provider: `${DEALER_SETTING} (echoed by the VDP crawl)`,
      observedAt: ctx.latestWebAt,
      confidence: "MEDIUM",
      license: DEALER_CLAIM,
      note: "Not a page reading: buildBreakdown prefers the tenant's configured fee over the page's "
        + "conveyance line and uses the parsed line only as a reconciliation check "
        + "(crawl-advertised-prices/index.ts:656-659), so the page's own fee is never stored.",
    });
  }

  // Evidence is rendered only when the price or a component moved, so the
  // newest observation usually carries none. The newest render that exists is
  // the picture of this same price, and pairing the observation with a null
  // path would report the evidence as missing when it is not.
  const evidence = ctx.webObservations.find((row) => str(row.screenshot_url) != null) ?? null;

  return {
    observedPrice,
    observedBeforeDocFee: beforeDocCandidates.length
      ? resolveField<number>("observed_before_doc_fee", beforeDocCandidates, { now, configuredOrder: order })
      : emptyField<number>(
        "observed_before_doc_fee",
        `There is no page observation to strip a fee from. ${observedPrice.reason}`,
      ),
    observedDocFee: docFeeCandidates.length
      ? resolveField<number>("observed_doc_fee", docFeeCandidates, { now, configuredOrder: order })
      : emptyField<number>(
        "observed_doc_fee",
        `There is no page observation to attach a fee to. ${observedPrice.reason}`,
      ),
    observedDiscount: resolveField<number>("observed_discount", discountCandidates(ctx), { now, configuredOrder: order }),
    vdpUrl: str(observation?.source_url)
      ?? str(ctx.listing?.price_source_url)
      ?? str(ctx.listing?.source_url)
      ?? str(ctx.mcAttrs.vdp_url),
    observedAt: ctx.latestWebAt,
    evidencePath: str(evidence?.screenshot_url),
    evidenceSha256: str(evidence?.screenshot_sha256),
    lastOutcome: str(sources.crawlAttempt?.outcome),
    lastRefused: refusal ? { scraped: refusal.scraped, feed: refusal.feed, at: refusal.at } : null,
  };
}

// ── Pricing ─────────────────────────────────────────────────────────

export function buildPricing(
  sources: VehicleFileSources,
  opts: BuildPricingOptions = {},
): PricingSection {
  const now = opts.now ?? Date.now();
  const order = opts.configuredOrder ?? null;
  const ctx = priceContext(sources, now, order);

  const advertisedRetail = ctx.listing
    ? resolveField<number>("advertised_retail", advertisedRetailCandidates(ctx), { now, configuredOrder: order })
    : emptyField<number>("advertised_retail", "No vehicle_listings row was read for this vehicle.");

  return {
    advertisedRetail,
    sellingPrice: sellingPrice(ctx, advertisedRetail, now, order),
    docFee: ctx.docFee,
    dealerDiscount: resolveField<number>("dealer_discount", discountCandidates(ctx), { now, configuredOrder: order }),
    msrpFactory: resolveField<number>("msrp_factory", msrpFactoryCandidates(sources, ctx), { now, configuredOrder: order }),
    msrpFeed: resolveField<number>("msrp_feed", msrpFeedCandidates(ctx), { now, configuredOrder: order }),
    advertisedIncludesDocFee: ctx.includesDocFee,
    priceDisplayMode: ctx.displayMode,
  };
}
