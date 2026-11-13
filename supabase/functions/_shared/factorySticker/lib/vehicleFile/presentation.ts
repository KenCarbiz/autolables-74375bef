// GENERATED — do not edit.
// Mirror of src/lib/vehicleFile/presentation.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
import { FRESHNESS_DAYS } from "./resolveField.ts";
import { deriveRecallView } from "../vehicleTruth/recallView.ts";
import type { CustomerSection, MediaSection, PricingSection, PublishingSection, SourceHealthEntry, TimelineEvent, VehicleFileReadModel, } from "./readModelTypes.ts";
import { arr, bool, iso, latestStamp, num, obj, str, type Row, type VehicleFileSources, } from "./sources.ts";
const DAY_MS = 86400000;
const ageDays = (stamp: string | null, now: number): number | null => {
    if (!stamp)
        return null;
    const t = Date.parse(stamp);
    return Number.isNaN(t) ? null : (now - t) / DAY_MS;
};
const money = (value: number): string => {
    const rounded = Math.round(value);
    const sign = rounded < 0 ? "-" : "";
    const digits = String(Math.abs(rounded)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return `${sign}$${digits}`;
};
const count = (value: number): string => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
export const hostOf = (url: string): string | null => {
    const withoutScheme = url.trim().replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
    const authority = withoutScheme.split(/[/?#]/)[0] ?? "";
    const afterUserInfo = authority.indexOf("@") >= 0
        ? authority.slice(authority.lastIndexOf("@") + 1)
        : authority;
    const host = afterUserInfo.replace(/:\d+$/, "").toLowerCase();
    if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(host))
        return null;
    return host.replace(/^www\./, "");
};
const photoUrls = (listing: Row): string[] => {
    const out: string[] = [];
    for (const entry of arr(listing.photos)) {
        const direct = str(entry);
        if (direct) {
            out.push(direct);
            continue;
        }
        const nested = str(obj(entry).url);
        if (nested)
            out.push(nested);
    }
    return out;
};
export function buildMedia(sources: VehicleFileSources): MediaSection {
    const listing = sources.listing;
    if (!listing)
        return { heroImageUrl: null, photoCount: 0, photoHosts: [] };
    const heroImageUrl = str(listing.hero_image_url);
    const urls = photoUrls(listing);
    if (heroImageUrl)
        urls.push(heroImageUrl);
    const distinct = new Set(urls);
    const hosts = new Set<string>();
    for (const url of distinct) {
        const host = hostOf(url);
        if (host)
            hosts.add(host);
    }
    return {
        heroImageUrl,
        photoCount: distinct.size,
        photoHosts: Array.from(hosts).sort(),
    };
}
const SCAN_EVENTS = new Set(["passport_opened", "customer_passport_opened", "qr_scan"]);
const PASSIVE_EVENTS = new Set([
    "engagement_ping",
    "time_on_page",
    "scroll_depth",
    "customer_passport_closed",
]);
type EngagementKind = "scan" | "action" | "passive";
const classifyEngagement = (row: Row): {
    at: string | null;
    kind: EngagementKind;
} => {
    const scannedAt = iso(row.scanned_at);
    if (scannedAt || str(row.qr_code_id))
        return { at: scannedAt, kind: "scan" };
    const eventType = str(row.event_type);
    if (eventType) {
        const at = latestStamp(row.occurred_at, row.created_at);
        if (SCAN_EVENTS.has(eventType))
            return { at, kind: "scan" };
        return { at, kind: PASSIVE_EVENTS.has(eventType) ? "passive" : "action" };
    }
    const dwellAt = latestStamp(row.last_at, row.first_at);
    if (dwellAt || str(row.module))
        return { at: dwellAt, kind: "passive" };
    return { at: null, kind: "passive" };
};
export function buildCustomer(sources: VehicleFileSources): CustomerSection {
    const listing = sources.listing;
    let scans = 0;
    let engagements = 0;
    let lastActivityAt: string | null = null;
    for (const row of sources.engagement) {
        const read = classifyEngagement(row);
        if (read.kind === "scan")
            scans += 1;
        else if (read.kind === "action")
            engagements += 1;
        lastActivityAt = latestStamp(lastActivityAt, read.at);
    }
    for (const lead of sources.leads) {
        lastActivityAt = latestStamp(lastActivityAt, lead.captured_at, lead.created_at, lead.updated_at);
    }
    return {
        passportSlug: listing ? str(listing.slug) : null,
        passportPublishedAt: listing ? iso(listing.published_at) : null,
        scans,
        engagements,
        leads: sources.leads.length,
        lastActivityAt,
    };
}
const BLOCKING_CHANNEL_STATUS = new Set(["blocked", "failed"]);
const CHANNEL_FACT_PREFIX = "channel:";
const UNRECORDED = "BLOCKED_REASON_NOT_RECORDED";
const addCode = (into: Map<string, Set<string>>, channel: string, code: string): void => {
    const existing = into.get(channel);
    if (existing)
        existing.add(code);
    else
        into.set(channel, new Set([code]));
};
interface BlockingCodes {
    scoped: Map<string, Set<string>>;
    unscoped: Set<string>;
}
const blockingCodes = (exceptions: Row[]): BlockingCodes => {
    const scoped = new Map<string, Set<string>>();
    const unscoped = new Set<string>();
    for (const exception of exceptions) {
        if (str(exception.status) !== "open")
            continue;
        if (bool(exception.blocking) !== true)
            continue;
        const rowChannel = str(exception.channel);
        let named = false;
        for (const rawFinding of arr(obj(exception.details_json).findings)) {
            const finding = obj(rawFinding);
            if (bool(finding.blocking) !== true && str(finding.severity) !== "blocking")
                continue;
            const code = str(finding.validator_code);
            if (!code)
                continue;
            named = true;
            const factPath = str(finding.fact_path);
            const channel = factPath && factPath.indexOf(CHANNEL_FACT_PREFIX) === 0
                ? factPath.slice(CHANNEL_FACT_PREFIX.length)
                : rowChannel;
            if (channel)
                addCode(scoped, channel, code);
            else
                unscoped.add(code);
        }
        if (named)
            continue;
        const type = str(exception.exception_type) ?? UNRECORDED;
        if (rowChannel)
            addCode(scoped, rowChannel, type);
        else
            unscoped.add(type);
    }
    return { scoped, unscoped };
};
const newestChannelRows = (rows: Row[]): Map<string, Row> => {
    const best = new Map<string, Row>();
    for (const row of rows) {
        const channel = str(row.channel);
        if (!channel)
            continue;
        const stamp = latestStamp(row.updated_at, row.created_at) ?? "";
        const current = best.get(channel);
        const currentStamp = current ? (latestStamp(current.updated_at, current.created_at) ?? "") : null;
        if (currentStamp === null || stamp >= currentStamp)
            best.set(channel, row);
    }
    return best;
};
export interface PublishingOptions {
    pricing?: PricingSection | null;
}
export function buildPublishing(sources: VehicleFileSources, opts: PublishingOptions = {}): PublishingSection {
    const version = sources.descriptionVersion;
    const { scoped, unscoped } = blockingCodes(sources.descriptionExceptions);
    const channelRows = newestChannelRows(sources.descriptionChannels);
    const channels = new Set<string>();
    for (const channel of channelRows.keys())
        channels.add(channel);
    for (const channel of scoped.keys())
        channels.add(channel);
    const channelsPublished: string[] = [];
    const channelsBlocked: Array<{
        channel: string;
        code: string;
    }> = [];
    for (const channel of Array.from(channels).sort()) {
        const row = channelRows.get(channel);
        const status = row ? str(row.validation_status) : null;
        const codes = new Set<string>(scoped.get(channel) ?? []);
        const statusBlocks = status !== null && BLOCKING_CHANNEL_STATUS.has(status);
        if (codes.size === 0 && !statusBlocks) {
            if (row)
                channelsPublished.push(channel);
            continue;
        }
        for (const code of unscoped)
            codes.add(code);
        if (codes.size === 0)
            codes.add(UNRECORDED);
        for (const code of Array.from(codes).sort())
            channelsBlocked.push({ channel, code });
    }
    const retail = opts.pricing?.advertisedRetail ?? null;
    const autofilmEligible = retail !== null
        && retail.value !== null
        && retail.freshness === "CURRENT"
        && !retail.disputed;
    return {
        descriptionVersionId: version ? str(version.id) : null,
        descriptionUpdatedAt: version ? latestStamp(version.approved_at, version.created_at) : null,
        channelsPublished,
        channelsBlocked,
        autofilmEligible,
    };
}
const LIFECYCLE_SUMMARY: Record<string, string> = {
    new_vehicle: "First seen in the dealer feed",
    removed_from_feed: "Left the dealer feed",
    relisted: "Returned to the dealer feed",
};
const MONEY_FIELDS = new Set(["price", "advertised_price", "msrp", "doc_fee", "dealer_discount"]);
const FIELD_LABEL: Record<string, string> = {
    price: "Advertised price",
    mileage: "Mileage",
    condition: "Condition",
    stock_number: "Stock number",
    trim: "Trim",
    vin: "VIN",
};
const describeChange = (field: string, previous: string | null, next: string | null): string => {
    const label = FIELD_LABEL[field] ?? field;
    if (MONEY_FIELDS.has(field)) {
        const before = num(previous);
        const after = num(next);
        if (before !== null && after !== null) {
            const delta = after - before;
            const direction = delta > 0 ? "up" : "down";
            return `${label} ${money(before)} to ${money(after)} (${direction} ${money(Math.abs(delta))})`;
        }
    }
    if (field === "mileage") {
        const before = num(previous);
        const after = num(next);
        if (before !== null && after !== null)
            return `${label} ${count(before)} to ${count(after)}`;
    }
    return `${label} ${previous ?? "unset"} to ${next ?? "unset"}`;
};
const changeEvents = (rows: Row[]): TimelineEvent[] => {
    const ordered = rows
        .map((row) => ({ row, at: iso(row.changed_at) }))
        .filter((entry): entry is {
        row: Row;
        at: string;
    } => entry.at !== null)
        .sort((a, b) => a.at.localeCompare(b.at));
    const out: TimelineEvent[] = [];
    let lastLifecycle: string | null = null;
    for (const { row, at } of ordered) {
        const field = str(row.field_key);
        if (!field)
            continue;
        const previous = str(row.previous_value);
        const next = str(row.new_value);
        if (field === "_lifecycle") {
            const transition = `${previous ?? "none"}>${next ?? "none"}`;
            if (transition === lastLifecycle)
                continue;
            lastLifecycle = transition;
            const summary = (next && LIFECYCLE_SUMMARY[next])
                ?? `Listing state ${previous ?? "unset"} to ${next ?? "unset"}`;
            out.push({ at, kind: "listing_lifecycle", summary, origin: "vehicle_change_history" });
            continue;
        }
        const needsDocument = bool(row.requires_new_document) === true;
        out.push({
            at,
            kind: field === "price" ? "price_changed" : `${field}_changed`,
            summary: describeChange(field, previous, next)
                + (needsDocument ? "; a new document is required" : ""),
            origin: "vehicle_change_history",
        });
    }
    return out;
};
const valueEvents = (rows: Row[]): TimelineEvent[] => {
    const ordered = rows
        .map((row) => ({
        at: latestStamp(row.captured_at, row.created_at),
        value: num(row.market_value),
    }))
        .filter((entry): entry is {
        at: string;
        value: number;
    } => entry.at !== null && entry.value !== null)
        .sort((a, b) => a.at.localeCompare(b.at));
    const out: TimelineEvent[] = [];
    let previous: number | null = null;
    for (const entry of ordered) {
        if (previous !== null && Math.abs(entry.value - previous) < 1)
            continue;
        out.push({
            at: entry.at,
            kind: "market_value_changed",
            summary: previous === null
                ? `Market value first recorded at ${money(entry.value)}`
                : `Market value ${money(previous)} to ${money(entry.value)}`,
            origin: "vehicle_value_history",
        });
        previous = entry.value;
    }
    return out;
};
const documentEvents = (sources: VehicleFileSources): TimelineEvent[] => {
    const out: TimelineEvent[] = [];
    for (const doc of sources.generatedDocuments) {
        const type = str(doc.document_type) ?? "document";
        const version = num(doc.version);
        const suffix = version !== null ? ` (v${version})` : "";
        const stages: Array<[
            unknown,
            string,
            string
        ]> = [
            [doc.created_at, "document_generated", `Generated ${type}${suffix}`],
            [doc.published_at, "document_published", `Published ${type}${suffix}`],
            [doc.rejected_at, "document_rejected", `Rejected ${type}${suffix}`],
            [doc.superseded_at, "document_superseded", `Superseded ${type}${suffix}`],
        ];
        for (const [stamp, kind, summary] of stages) {
            const at = iso(stamp);
            if (at)
                out.push({ at, kind, summary, origin: "generated_documents" });
        }
    }
    for (const doc of sources.signedDocuments) {
        const at = iso(doc.created_at);
        if (!at)
            continue;
        out.push({
            at,
            kind: "document_signed",
            summary: `Signed ${str(doc.doc_type) ?? "document"} archived`,
            origin: "signed_document_archive",
        });
    }
    return out;
};
const listingEvents = (sources: VehicleFileSources): TimelineEvent[] => {
    const listing = sources.listing;
    if (!listing)
        return [];
    const out: TimelineEvent[] = [];
    const publishedAt = iso(listing.published_at);
    if (publishedAt) {
        const slug = str(listing.slug);
        out.push({
            at: publishedAt,
            kind: "passport_published",
            summary: slug ? `Vehicle Passport published at /v/${slug}` : "Vehicle Passport published",
            origin: "vehicle_listings.published_at",
        });
    }
    const archivedAt = iso(listing.archived_at);
    if (archivedAt) {
        const reason = str(listing.archive_reason);
        out.push({
            at: archivedAt,
            kind: "listing_archived",
            summary: reason ? `Listing archived (${reason})` : "Listing archived",
            origin: "vehicle_listings.archived_at",
        });
    }
    const version = sources.descriptionVersion;
    if (version) {
        const at = latestStamp(version.approved_at, version.created_at);
        const number = num(version.version_number);
        if (at) {
            out.push({
                at,
                kind: "description_updated",
                summary: number !== null ? `Description version ${number} generated` : "Description generated",
                origin: "description_versions",
            });
        }
    }
    return out;
};
export function buildTimeline(sources: VehicleFileSources, limit = 25): TimelineEvent[] {
    const events = [
        ...changeEvents(sources.changeHistory),
        ...valueEvents(sources.valueHistory),
        ...documentEvents(sources),
        ...listingEvents(sources),
    ];
    events.sort((a, b) => {
        const byTime = b.at.localeCompare(a.at);
        if (byTime !== 0)
            return byTime;
        const byOrigin = a.origin.localeCompare(b.origin);
        if (byOrigin !== 0)
            return byOrigin;
        return a.summary.localeCompare(b.summary);
    });
    return limit >= 0 ? events.slice(0, limit) : events;
}
const WINDOW_DAYS = {
    inventory: 2,
    market: FRESHNESS_DAYS.market_value ?? 7,
    website: FRESHNESS_DAYS.observed_price ?? 7,
    recall: FRESHNESS_DAYS.recall_status ?? 30,
    epa: 30,
} as const;
const freshnessState = (lastSuccessAt: string | null, windowDays: number, now: number): SourceHealthEntry["state"] => {
    const age = ageDays(lastSuccessAt, now);
    if (age === null)
        return "UNKNOWN";
    return age > windowDays ? "STALE" : "CURRENT";
};
const SYNC_FAILURE_STATUS = new Set(["failed", "partial", "empty_valid"]);
const CRAWL_FAILURE_OUTCOME = new Set([
    "render_rate_limited",
    "render_cost_refused",
    "render_failed",
    "fetch_failed",
    "parse_failed",
    "price_rejected",
]);
export interface SourceHealthOptions {
    now?: number;
}
const inventoryHealth = (sources: VehicleFileSources, now: number): SourceHealthEntry => {
    const config = sources.syncConfig;
    const supplies = ["VIN", "year/make/model/trim", "mileage", "advertised retail", "condition", "photos"];
    const allowed = config ? bool(config.allowed) : null;
    const enabled = config ? bool(config.enabled) : null;
    let lastSuccessAt: string | null = null;
    let lastFailureAt: string | null = null;
    let failureSummary: string | null = null;
    for (const run of sources.syncRuns) {
        const status = str(run.status);
        const finished = iso(run.finished_at) ?? iso(run.started_at) ?? iso(run.created_at);
        if (status === "success")
            lastSuccessAt = latestStamp(lastSuccessAt, finished);
        else if (status !== null && SYNC_FAILURE_STATUS.has(status)) {
            const next = latestStamp(lastFailureAt, finished);
            if (next !== lastFailureAt)
                failureSummary = str(run.error_summary);
            lastFailureAt = next;
        }
    }
    lastSuccessAt = latestStamp(lastSuccessAt, config?.last_good_at);
    if (config && (allowed === false || enabled === false)) {
        return {
            source: "MarketCheck inventory",
            state: "DISABLED",
            lastSuccessAt,
            lastFailureAt,
            supplies,
            attention: "MarketCheck inventory sync is switched off for this tenant; nothing refreshes the listing.",
        };
    }
    if (!config && !sources.syncRuns.length) {
        return {
            source: "MarketCheck inventory",
            state: "NOT_CONFIGURED",
            lastSuccessAt: null,
            lastFailureAt: null,
            supplies,
            attention: "No MarketCheck sync configuration or run exists for this tenant.",
        };
    }
    const state = lastFailureAt !== null && (lastSuccessAt === null || lastFailureAt > lastSuccessAt)
        ? "FAILING"
        : freshnessState(lastSuccessAt, WINDOW_DAYS.inventory, now);
    const refused = bool(obj(config?.last_status).provider_refused) === true;
    let attention: string | null = null;
    if (state === "FAILING") {
        attention = `The last MarketCheck inventory sync did not succeed${failureSummary ? `: ${failureSummary}` : "."}`;
    }
    else if (refused) {
        attention = "The provider refused the last feed page, so the prune was held back and archived cars may still show as live.";
    }
    else if (state === "STALE") {
        attention = `No successful inventory sync in ${WINDOW_DAYS.inventory} days; the listing may no longer match the feed.`;
    }
    else if (state === "UNKNOWN") {
        attention = "No inventory sync run has been recorded for this tenant.";
    }
    return { source: "MarketCheck inventory", state, lastSuccessAt, lastFailureAt, supplies, attention };
};
const marketHealth = (sources: VehicleFileSources, now: number): SourceHealthEntry => {
    const listing = sources.listing;
    const marketMeta = obj(listing?.market_meta);
    const marketPayload = obj(listing?.market_payload);
    const lastSuccessAt = latestStamp(listing?.market_checked_at, marketMeta.checked_at, marketPayload.checked_at);
    const state = freshnessState(lastSuccessAt, WINDOW_DAYS.market, now);
    const hasValue = num(listing?.market_value) ?? num(marketPayload.marketValue);
    return {
        source: "Market intelligence",
        state,
        lastSuccessAt,
        lastFailureAt: null,
        supplies: ["market value", "days on market", "comparable count", "market days supply", "reference price"],
        attention: hasValue === null
            ? "No market value has been computed for this vehicle."
            : (state === "STALE" ? `Market analysis is older than ${WINDOW_DAYS.market} days.` : null),
    };
};
const neovinHealth = (sources: VehicleFileSources): SourceHealthEntry => {
    const listing = sources.listing;
    const mcAttrs = obj(listing?.mc_attributes);
    const lastSuccessAt = latestStamp(sources.neovin?.fetched_at, mcAttrs.specs_decoded_at);
    const buildSheet = obj(mcAttrs.build_sheet);
    const hasBuildSheet = Object.keys(buildSheet).length > 0
        || Object.keys(obj(sources.neovin?.payload)).length > 0;
    let parseFailed = false;
    for (const shape of sources.providerShapes) {
        if (str(shape.provider) !== "marketcheck_neovin")
            continue;
        if (bool(shape.parse_failed) === true)
            parseFailed = true;
    }
    const attempts = num(mcAttrs.specs_attempts);
    const state: SourceHealthEntry["state"] = hasBuildSheet
        ? "CURRENT"
        : (attempts !== null && attempts >= 3 ? "FAILING" : "UNKNOWN");
    return {
        source: "NeoVIN build sheet",
        state,
        lastSuccessAt,
        lastFailureAt: null,
        supplies: ["factory MSRP ladder", "engine", "drivetrain", "transmission", "factory options", "standard equipment"],
        attention: parseFailed
            ? "The last NeoVIN payload for this VIN could not be parsed into a build sheet."
            : (hasBuildSheet
                ? null
                : "No NeoVIN build sheet exists for this VIN, so factory MSRP and equipment are unverified."),
    };
};
const websiteHealth = (sources: VehicleFileSources, now: number): SourceHealthEntry => {
    const listing = sources.listing;
    const supplies = ["observed website price", "observed doc fee", "observed discount", "price evidence"];
    const vdpUrl = str(listing?.source_url) ?? str(listing?.price_source_url);
    let lastSuccessAt: string | null = null;
    for (const row of sources.advertisedPrices) {
        if (str(row.source_channel) !== "website")
            continue;
        if (str(row.captured_method) !== "dealer_vdp_observation")
            continue;
        lastSuccessAt = latestStamp(lastSuccessAt, row.captured_at);
    }
    const attempt = sources.crawlAttempt;
    const outcome = attempt ? str(attempt.outcome) : null;
    if (outcome === "captured")
        lastSuccessAt = latestStamp(lastSuccessAt, attempt?.resolved_at);
    const lastFailureAt = outcome !== null && CRAWL_FAILURE_OUTCOME.has(outcome)
        ? iso(attempt?.last_attempt_at)
        : null;
    if (!vdpUrl) {
        return {
            source: "Dealer website (Firecrawl)",
            state: "NOT_CONFIGURED",
            lastSuccessAt,
            lastFailureAt,
            supplies,
            attention: "This listing carries no dealer VDP URL, so the advertised price cannot be observed.",
        };
    }
    const state = lastFailureAt !== null && (lastSuccessAt === null || lastFailureAt > lastSuccessAt)
        ? "FAILING"
        : freshnessState(lastSuccessAt, WINDOW_DAYS.website, now);
    let attention: string | null = null;
    if (state === "FAILING")
        attention = `The last crawl of this vehicle's page ended ${outcome}.`;
    else if (state === "STALE")
        attention = `The dealer's own page has not been observed in ${WINDOW_DAYS.website} days.`;
    else if (state === "UNKNOWN")
        attention = "The dealer's own page has never been observed for this vehicle.";
    return { source: "Dealer website (Firecrawl)", state, lastSuccessAt, lastFailureAt, supplies, attention };
};
const recallHealth = (sources: VehicleFileSources, now: number): SourceHealthEntry => {
    const listing = sources.listing;
    const payload = obj(listing?.recall_payload);
    const check = obj(listing?.recall_check);
    const lastSuccessAt = latestStamp(listing?.recall_checked_at, payload.checked_at, check.checked_at);
    const state = freshnessState(lastSuccessAt, WINDOW_DAYS.recall, now);
    const status = str(listing?.recall_status);
    const hasPayload = Object.keys(payload).length > 0;
    const recall = deriveRecallView(listing ?? null, { now });
    let attention: string | null = null;
    if (state === "UNKNOWN")
        attention = "No recall check has been recorded for this vehicle.";
    else if (state === "STALE")
        attention = `The recall answer is older than ${WINDOW_DAYS.recall} days and must be re-asked.`;
    else if (hasPayload && !status)
        attention = "A recall payload was stored without a recall status, so the result is unreadable.";
    else if (!recall.vin.checkComplete) {
        attention = `${recall.vin.label}: ${recall.model ? `NHTSA answered at model scope (${recall.model.state}), which cannot verify this VIN.` : "no VIN-level recall source has answered."}`;
    }
    return {
        source: "NHTSA recall",
        state,
        lastSuccessAt,
        lastFailureAt: null,
        supplies: recall.vin.checkComplete
            ? ["open recall count", "recall status", "do-not-drive campaigns"]
            : ["model-level campaign context", "do-not-drive campaigns"],
        attention,
    };
};
const epaHealth = (sources: VehicleFileSources, now: number): SourceHealthEntry => {
    const listing = sources.listing;
    const lastSuccessAt = iso(listing?.epa_checked_at);
    const state = freshnessState(lastSuccessAt, WINDOW_DAYS.epa, now);
    const economy = obj(listing?.epa_economy);
    const matched = Object.keys(economy).length > 0;
    return {
        source: "EPA fuel economy",
        state,
        lastSuccessAt,
        lastFailureAt: null,
        supplies: ["city mpg", "highway mpg", "combined mpg", "annual fuel cost"],
        attention: lastSuccessAt !== null && !matched
            ? "The EPA lookup ran but matched no vehicle, so fuel economy is unavailable."
            : (state === "UNKNOWN" ? "No EPA lookup has been recorded for this vehicle." : null),
    };
};
const nmvtisHealth = (): SourceHealthEntry => ({
    source: "NMVTIS title history",
    state: "NOT_CONFIGURED",
    lastSuccessAt: null,
    lastFailureAt: null,
    supplies: ["title brand", "odometer brand", "theft record", "salvage record"],
    attention: "The NMVTIS pull ledger does not exist in this database, so the monthly cap cannot bind and no pull can be recorded.",
});
const incentivesHealth = (): SourceHealthEntry => ({
    source: "OEM incentives",
    state: "DISABLED",
    lastSuccessAt: null,
    lastFailureAt: null,
    supplies: ["customer cash", "APR programs", "lease programs"],
    attention: null,
});
const oemStickerHealth = (sources: VehicleFileSources): SourceHealthEntry => {
    const checkedAt = iso(sources.listing?.oem_sticker_checked_at);
    return {
        source: "OEM window sticker",
        state: checkedAt ? "CURRENT" : "NOT_CONFIGURED",
        lastSuccessAt: checkedAt,
        lastFailureAt: null,
        supplies: ["original manufacturer sticker image"],
        attention: checkedAt
            ? null
            : "No OEM window sticker provider is configured, so the original sticker image is never fetched.",
    };
};
const getReadyHealth = (sources: VehicleFileSources): SourceHealthEntry => {
    const record = sources.getReady;
    const supplies = ["inspection outcome", "reconditioning work", "prep sign-off", "delivery clearance"];
    if (!record) {
        return {
            source: "Get Ready",
            state: "NOT_CONFIGURED",
            lastSuccessAt: null,
            lastFailureAt: null,
            supplies,
            attention: "No Get Ready record exists for this vehicle.",
        };
    }
    const completedAt = latestStamp(record.get_ready_complete_date, record.inspection_date, ...sources.safetyInspections
        .filter((row) => iso(row.voided_at) === null)
        .map((row) => latestStamp(row.signed_at, row.licensee_certified_at)), ...sources.prepSignOffs.map((row) => row.signed_at));
    return {
        source: "Get Ready",
        state: completedAt ? "CURRENT" : "UNKNOWN",
        lastSuccessAt: completedAt,
        lastFailureAt: null,
        supplies,
        attention: completedAt
            ? null
            : "The Get Ready record is seeded but no completed work has been recorded, so it supplies no operational facts.",
    };
};
export function buildSourceHealth(sources: VehicleFileSources, opts: SourceHealthOptions = {}): SourceHealthEntry[] {
    const now = opts.now ?? Date.now();
    return [
        inventoryHealth(sources, now),
        marketHealth(sources, now),
        neovinHealth(sources),
        websiteHealth(sources, now),
        recallHealth(sources, now),
        epaHealth(sources, now),
        nmvtisHealth(),
        incentivesHealth(),
        oemStickerHealth(sources),
        getReadyHealth(sources),
    ];
}
const OWNER_SERVICE = "Service Manager";
const OWNER_COMPLIANCE = "Compliance/Admin";
const OWNER_USED_CAR = "Used Car Manager";
const RESALE_CONDITIONS = new Set(["used", "cpo", "certified", "certified pre-owned"]);
export type AttentionInput = Omit<VehicleFileReadModel, "blocker" | "nextAction" | "currentOwner">;
export interface Attention {
    blocker: string | null;
    nextAction: string | null;
    currentOwner: string | null;
}
export function deriveAttention(model: AttentionInput): Attention {
    const condition = str(model.dealerState.condition.value);
    const isResale = condition !== null && RESALE_CONDITIONS.has(condition.toLowerCase());
    if (model.compliance.doNotDrive) {
        return {
            blocker: "An open do-not-drive recall campaign applies to this vehicle.",
            nextAction: "Do not move or deliver this vehicle. Open the recall, book the repair and record the completion before it is shown again.",
            currentOwner: OWNER_SERVICE,
        };
    }
    if (isResale && !model.documents.buyersGuide.present) {
        return {
            blocker: "The FTC Buyers Guide is missing on a used vehicle that is being displayed.",
            nextAction: "Generate and post the Buyers Guide for this vehicle before it stays on the lot another day.",
            currentOwner: OWNER_COMPLIANCE,
        };
    }
    const complianceBlocker = model.compliance.blockers[0];
    if (complianceBlocker) {
        return {
            blocker: complianceBlocker,
            nextAction: "Clear the compliance blocker on this vehicle, then re-check the document set.",
            currentOwner: OWNER_COMPLIANCE,
        };
    }
    const getReadyBlocker = model.getReady.blockers[0];
    if (getReadyBlocker) {
        return {
            blocker: getReadyBlocker,
            nextAction: "Clear the Get Ready blocker and record the completed work, so readiness comes from an event and not a flag.",
            currentOwner: OWNER_SERVICE,
        };
    }
    if (isResale && !model.getReady.inspectionSigned) {
        return {
            blocker: "The safety inspection has not been signed for this used vehicle.",
            nextAction: "Assign the safety inspection and have the technician sign it off; the vehicle is listed without one today.",
            currentOwner: OWNER_SERVICE,
        };
    }
    const retail = model.pricing.advertisedRetail;
    if (retail.freshness === "CONFLICTED" || retail.disputed) {
        return {
            blocker: `Two sources disagree about the advertised price. ${retail.reason}`,
            nextAction: "Confirm today's advertised price and let the confirmed figure supersede the other source.",
            currentOwner: OWNER_USED_CAR,
        };
    }
    if (retail.freshness === "STALE" || retail.freshness === "SUPERSEDED") {
        return {
            blocker: `The advertised price is not current. ${retail.reason}`,
            nextAction: "Re-verify the advertised price against the feed and the dealer's own page before this vehicle is advertised again.",
            currentOwner: OWNER_USED_CAR,
        };
    }
    if (retail.value === null) {
        return {
            blocker: "No source supplies an advertised price for this vehicle.",
            nextAction: "Set the advertised price, or confirm why this vehicle carries none.",
            currentOwner: OWNER_USED_CAR,
        };
    }
    return { blocker: null, nextAction: null, currentOwner: null };
}
