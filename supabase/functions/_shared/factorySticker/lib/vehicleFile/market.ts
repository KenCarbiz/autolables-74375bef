// GENERATED — do not edit.
// Mirror of src/lib/vehicleFile/market.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
import type { Confidence, SourceKind } from "../vehicleTruth/precedence.ts";
import type { FieldCandidate, LicenseClass, ListingLifecycleSection, MarketIntelligenceSection, } from "./readModelTypes.ts";
import { emptyField, resolveField } from "./resolveField.ts";
import { iso, latestStamp, num, obj, str, type Row, type VehicleFileSources } from "./sources.ts";
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
const candidate = <T>(input: CandidateInput<T>): FieldCandidate<T> => ({ ...input, value: input.value as T });
const feedStamp = (value: unknown): string | null => {
    const epoch = typeof value === "number"
        ? value
        : (typeof value === "string" && /^\d{9,13}$/.test(value.trim()) ? Number(value.trim()) : null);
    if (epoch != null && Number.isFinite(epoch) && epoch > 0) {
        return new Date(epoch > 100000000000 ? epoch : epoch * 1000).toISOString();
    }
    return iso(value);
};
const earliestStamp = (...values: Array<string | null>): string | null => {
    let best: string | null = null;
    for (const v of values) {
        if (v && (!best || v < best))
            best = v;
    }
    return best;
};
interface FeedRead<T> {
    value: T | null;
    origin: string;
}
const readFeed = <T>(mcRaw: Row, mcAttrs: Row, key: string, read: (row: Row) => T | null): FeedRead<T> => {
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
export function buildMarketIntelligence(sources: VehicleFileSources, opts: MarketIntelligenceOptions = {}): MarketIntelligenceSection {
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
    const feedObservedAt = latestStamp(feedStamp(mcRaw.scraped_at_date), feedStamp(mcRaw.scraped_at), feedStamp(mcRaw.last_seen_at_date), feedStamp(mcRaw.last_seen_at), feedStamp(mcAttrs.scraped_at), feedStamp(mcAttrs.last_seen_at));
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
export function buildListingLifecycle(sources: VehicleFileSources): ListingLifecycleSection {
    const listing = sources.listing;
    const lifecycle = sources.lifecycle;
    const mcRaw = obj(listing?.mc_raw);
    const mcAttrs = obj(listing?.mc_attributes);
    const firstSeenAt = earliestStamp(feedStamp(mcRaw.first_seen_at_mc), feedStamp(mcRaw.first_seen_at_source), feedStamp(mcRaw.first_seen_at_date), feedStamp(mcRaw.first_seen_at), feedStamp(mcAttrs.first_seen_at));
    const lastSeenAt = latestStamp(feedStamp(mcRaw.last_seen_at_date), feedStamp(mcRaw.last_seen_at), feedStamp(mcAttrs.last_seen_at));
    const publishedAt = listing ? iso(listing.published_at) : null;
    const archivedAt = listing ? iso(listing.archived_at) : null;
    const archiveReason = listing ? str(listing.archive_reason) : null;
    const status = listing ? str(listing.status) : null;
    const lifecycleStage = lifecycle ? str(lifecycle.state) : null;
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
