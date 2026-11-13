// GENERATED — do not edit.
// Mirror of src/lib/passportV2Data.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
import { verifiedInServiceDate } from "./warranty/inServiceEvidence.ts";
import { storedEpaConflict, listingPowertrain, driveOf, litersOf } from "../../epaMatch.ts";
import type { VehicleListing } from "./vehicleListingType.ts";
import { deriveRecallView, type RecallView } from "./vehicleTruth/recallView.ts";
import { buildDiscountBreakdown, type PriceDisplayMode, type DiscountBreakdown } from "./priceModel.ts";
import { resolvePassportSellingPrice } from "./passport/sellingPrice.ts";
import { estimateAssumptionLine, listingModelYear, normalizeEstimatorConfig, resolveEstimate, type EstimateResult, type EstimatorConfig } from "./payment/estimator.ts";
import type { OemFactoryWarranty } from "./oemWarranty.ts";
import { legacyMarketView, type LegacyListingFields } from "./market/surfaceCompat.ts";
export type OemWarrantyView = Partial<OemFactoryWarranty> & {
    owner?: "original" | "subsequent";
};
const UK_US: [
    RegExp,
    string
][] = [
    [/\blitres?\b/gi, "Liters"],
    [/\bcentre\b/gi, "Center"],
    [/\bgrey\b/gi, "Gray"],
    [/\bcolour\b/gi, "Color"],
    [/\baluminium\b/gi, "Aluminum"],
    [/\btyres?\b/gi, "Tire"],
    [/\bmetre\b/gi, "Meter"],
    [/\bkerb\b/gi, "Curb"],
];
const normSpelling = (s: string) => UK_US.reduce((a, [re, t]) => a.replace(re, t), s);
export const CREDIBLE_AVG_DOM_MAX = 75;
const CODE_RE = /^[A-Z]{1,3}\d{1,4}$/;
const META_RE = /\b(msrp|warranty|currency|invoice|jato|segment|dimensions?|emission|plant of assembly|country|weights?|charges?|model generation|model year|ramp angle|secondary|delivery charge)\b/i;
const RATING_RE = /\b(iihs|nhtsa)\b|-(good|acceptable|marginal|poor|tsp|updated|[1-5])$|overlap|rollover|frontal crash|side impact-/i;
const PAINT_RE = /\b(metallic|pearl)\b|^paint[- ]/i;
const SPEC_MEASURE_RE = /\(\s*\d+(\.\d+)?\s?(in|mm|cm|cu\.?\s?ft|lbs?|kg|gal|l)\b\.?\s*\)\s*$/i;
const SPEC_DIM_RE = /\b(wheelbase|wheel (diameter|width)|(front|rear) wheel (diameter|width)|track (front|rear)|(front|rear) track|overhang|bore|stroke|axle ratio|compression ratio|approach angle|departure angle)\b/i;
const ACTIVATES_RE = /^activates\b/i;
const WARNING_RE = /\bwarnings?$/i;
const WARNING_KEEP_RE = /\b(blind ?spot|lane departure|forward collision|cross ?traffic|driver attention|tire pressure|low tire|pedestrian)\b/i;
const GENERIC = new Set([
    "engine",
    "fuel",
    "fuel tanks",
    "fuel consumption",
    "transmission",
    "electrical system",
    "performance",
    "tires",
    "tire",
    "suspension",
    "ventilation system",
    "air conditioning",
    "doors",
    "door",
    "powertrain",
    "wheels",
    "wheel",
    "spare wheel",
    "brakes",
    "disc brakes",
    "abs",
    "seating",
    "console",
    "paint",
    "speakers",
    "vehicle type",
    "computer",
    "floor covering",
    "floor mats",
    "power",
    "power locks",
    "power steering",
    "power windows",
    "head restraints",
    "blind",
    "stability control",
    "garage door opener",
    "bumpers",
    "glass roof",
    "telematics",
    "remote services",
    "drive",
    "compressor",
    "charges",
    "start/stop",
    "privacy glass",
    "rear axle",
    "driver modes",
    "vanity mirror",
    "apps control",
    "trip computer",
    "crash test results",
    "body style",
    "over air updates",
    "windshield wipers",
    "rear window",
    "rear side windows",
    "cup holders",
    "cupholders",
    "seat upholstery",
    "instrument cluster",
    "cargo capacity",
    "underbody protection",
    "emergency call",
    "ground view",
    "differential lock",
    "torque vectoring",
    "active grille shutter",
    "hill holder",
    "memorized adjustment",
    "anti-theft protection",
    "isofix preparation",
    "voice activating system",
    "laminated side windows",
    "electronic hand brake",
    "door sill protector",
    "accident data recorder",
    "electronic traction control",
    "multiple user profiles",
    "emission control level",
    "load restraint",
    "model generation id",
    "secondary ventilation controls",
    "compass",
    "suspension",
    "weights",
    "performance",
]);
const isEquipNoise = (raw: string): boolean => {
    const s = raw.trim();
    if (s.length < 2)
        return true;
    if (CODE_RE.test(s))
        return true;
    if (META_RE.test(s) || RATING_RE.test(s) || PAINT_RE.test(s))
        return true;
    if (SPEC_MEASURE_RE.test(s) || SPEC_DIM_RE.test(s) || ACTIVATES_RE.test(s))
        return true;
    if (WARNING_RE.test(s) && !WARNING_KEEP_RE.test(s))
        return true;
    if (GENERIC.has(s.toLowerCase()))
        return true;
    return false;
};
const FAMILY_RULES: {
    re: RegExp;
    canon: (members: string[]) => string;
}[] = [
    { re: /\b(sun ?roofs?|moon ?roofs?)\b/i, canon: (m) => m.some((s) => /panoramic/i.test(s)) ? "Panoramic sunroof" : m.some((s) => /power|electric|one.?touch/i.test(s)) ? "Power sunroof" : "Sunroof" },
    { re: /\bhead ?(light|lamp)s?\b/i, canon: (m) => `${m.some((s) => /\bled\b/i.test(s)) ? "LED headlights" : "Headlights"}${m.some((s) => /high ?beam|auto/i.test(s)) ? " (auto high-beam)" : ""}` },
    { re: /\b(heated|ventilated|cooled|climate.?controlled)\b[^.]*\bseats?\b/i, canon: (m) => {
            const heated = m.some((s) => /heated/i.test(s));
            const vented = m.some((s) => /ventilated|cooled|climate/i.test(s));
            return heated && vented ? "Heated & ventilated seats" : heated ? "Heated seats" : "Ventilated seats";
        } },
    { re: /\b(keyless|proximity key|push.?button start|remote (engine )?start)\b/i, canon: (m) => m.some((s) => /remote (engine )?start/i.test(s)) ? "Keyless entry & remote start" : "Keyless entry & push-button start" },
    { re: /\b(park(ing)? (sensor|assist|aid)s?|surround.?view|360.?(degree)? camera|birds?.?eye)\b/i, canon: (m) => m.some((s) => /surround|360|birds?.?eye/i.test(s)) ? "Surround-view camera & parking sensors" : "Parking sensors" },
    { re: /\bwireless (charging|charger|phone charg)/i, canon: () => "Wireless phone charging" },
];
const equipKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const equipTokens = (key: string) => key.split(" ").filter(Boolean).map((t) => t.replace(/s$/, ""));
export const cleanEquipmentList = (items: string[]): string[] => {
    const seen = new Set<string>();
    const kept: string[] = [];
    for (const raw of items) {
        if (isEquipNoise(raw))
            continue;
        const norm = normSpelling(raw);
        const key = equipKey(norm);
        if (!key || seen.has(key))
            continue;
        seen.add(key);
        kept.push(norm);
    }
    const familyOf = (s: string) => FAMILY_RULES.findIndex((f) => f.re.test(s));
    const members = new Map<number, string[]>();
    for (const item of kept) {
        const f = familyOf(item);
        if (f >= 0)
            members.set(f, [...(members.get(f) || []), item]);
    }
    const merged: string[] = [];
    const emittedFamily = new Set<number>();
    for (const item of kept) {
        const f = familyOf(item);
        if (f < 0) {
            merged.push(item);
            continue;
        }
        const fam = members.get(f)!;
        if (fam.length < 2) {
            merged.push(item);
            continue;
        }
        if (!emittedFamily.has(f)) {
            emittedFamily.add(f);
            merged.push(FAMILY_RULES[f].canon(fam));
        }
    }
    const tokenSets = merged.map((s) => new Set(equipTokens(equipKey(s))));
    const byToken = new Map<string, number[]>();
    tokenSets.forEach((ts, i) => ts.forEach((t) => byToken.set(t, [...(byToken.get(t) || []), i])));
    const drop = new Set<number>();
    tokenSets.forEach((ts, i) => {
        if (ts.size === 0)
            return;
        const candidates = new Set<number>();
        ts.forEach((t) => (byToken.get(t) || []).forEach((j) => { if (j !== i)
            candidates.add(j); }));
        for (const j of candidates) {
            if (drop.has(j))
                continue;
            const other = tokenSets[j];
            if (other.size > ts.size && [...ts].every((t) => other.has(t))) {
                drop.add(i);
                break;
            }
        }
    });
    return merged.filter((_, i) => !drop.has(i));
};
const UPHOLSTERY_RE = /\b(leather(ette)?|cloth|upholstery|semi.?aniline|nappa|suede|ultrasuede|vinyl)\b/i;
const COLOR_WORDS = ["black", "white", "red", "blue", "gray", "grey", "brown", "tan", "beige", "ivory", "cream", "charcoal", "graphite", "ebony", "vermilion", "saddle", "camel", "stone", "slate", "espresso", "cocoa", "chestnut", "sand", "linen", "oyster", "parchment", "mocha", "burgundy", "wine", "navy", "titanium", "ash", "walnut", "cognac", "caramel", "terracotta"];
export const listingEquipment = (listing: VehicleListing): string[] => {
    const toList = (v: unknown): string[] => Array.isArray(v)
        ? v.map((x) => typeof x === "string" ? x : String((x as Record<string, unknown>)?.name ?? (x as Record<string, unknown>)?.label ?? (x as Record<string, unknown>)?.description ?? "")).map((s) => s.trim()).filter(Boolean)
        : typeof v === "string" ? v.split(/[,;|]/).map((s) => s.trim()).filter(Boolean) : [];
    const mc = (listing.mc_attributes || {}) as Record<string, unknown>;
    const ksRaw = (listing.key_specs || {}) as Record<string, unknown>;
    const intColor = String(ksRaw.interior_color ?? mc.interior_color ?? "").toLowerCase();
    const fromFeatures = (listing.features || []).map((f) => [f.title, f.subtitle].filter(Boolean).join(" ").trim()).filter(Boolean);
    const all = [...fromFeatures, ...toList(mc.options), ...toList(mc.features)].filter((item) => {
        if (!intColor || !UPHOLSTERY_RE.test(item))
            return true;
        const lc = item.toLowerCase();
        const named = COLOR_WORDS.filter((c) => new RegExp(`\\b${c}\\b`).test(lc));
        return named.length === 0 || named.some((c) => intColor.includes(c));
    });
    return cleanEquipmentList(all);
};
export const fmt$ = (n: number | null | undefined) => n == null ? "" : `$${Math.round(n).toLocaleString()}`;
export interface VerifyRow {
    label: string;
    done: boolean;
}
export interface Highlight {
    key: string;
    label: string;
    sub: string;
}
export interface PassportData {
    price: number | null;
    msrp: number | null;
    priceLabel: string;
    websitePriceTerm: string | null;
    estMonthly: number | null;
    paymentAssumptions: string;
    paymentEstimator: EstimatorConfig | null;
    paymentEstimate: EstimateResult;
    modelYear: number | null;
    saveVsMsrp: number | null;
    belowOriginalMsrp: number | null;
    docFee: number | null;
    websiteSalePrice: number | null;
    priceMode: PriceDisplayMode;
    priceIncludesDoc: boolean;
    priceBreakdown: DiscountBreakdown | null;
    dealerDiscount: number | null;
    retailCash: number | null;
    recon: {
        inspection: {
            type: string | null;
            passed: boolean;
            date: string | null;
        } | null;
        detailed: boolean;
        detailDate: string | null;
        workItems: string[];
        thirdParty: {
            product: string;
            company: string;
        }[];
        photos: string[];
    } | null;
    marketAvg: number | null;
    marketLow: number | null;
    marketHigh: number | null;
    belowMarket: number | null;
    aboveMarket: number | null;
    marketBasisWeak: boolean;
    viewCount: number | null;
    dom: number | null;
    marketMeta: {
        percentile: number | null;
        radius: number | null;
        similarCount: number | null;
        avgDom: number | null;
        daysSupply: number | null;
        inventoryCount: number | null;
        checkedAt: string | null;
        trimMatched: boolean | null;
        priceMedian: number | null;
        priceMean: number | null;
        milesMean: number | null;
        likeCount: number | null;
        likeMedian: number | null;
        soldCount: number | null;
        soldPriceMedian: number | null;
        soldDomMedian: number | null;
        soldMilesMedian: number | null;
        soldScope: string | null;
        soldState: string | null;
        soldCheckedAt: string | null;
        soldDisplayable: boolean;
        cohort: CompCohort | null;
        analyzedCount: number | null;
    };
    comparables: {
        vin?: string | null;
        ymm?: string | null;
        trim?: string | null;
        miles?: number | null;
        price?: number | null;
        dist?: number | null;
        dealer?: string | null;
        dom?: number | null;
        image?: string | null;
    }[];
    blackbook: {
        tradeinClean: number | null;
        retailClean: number | null;
        wholesaleClean: number | null;
        available: boolean;
    } | null;
    marketCheckedAt: string | null;
    history: {
        available: boolean;
        entries: {
            price: number | null;
            miles: number | null;
            seller_type: string | null;
            inventory_type: string | null;
            dealer: string | null;
            first_seen: string | null;
            last_seen: string | null;
        }[];
        owners: number | null;
        inServiceDate: string | null;
        firstSeen: string | null;
    } | null;
    ownerCount: number | null;
    accidentCount: number | null;
    cleanTitle: boolean;
    titleStatus: "clean" | "branded" | "unknown";
    titleVerifiedAt: string | null;
    titleVerifiedSource: "nmvtis" | null;
    titlePolicyAttested: boolean;
    titlePolicyAttestedBy: string | null;
    serviceCount: number;
    recall: RecallView;
    recallClear: boolean;
    openRecalls: number | null;
    hasRecallCheck: boolean;
    warranty: NonNullable<VehicleListing["warranty_info"]>;
    warrantyStr: string | null;
    warrantyExpired: boolean;
    oemWarranty: OemWarrantyView | null;
    confScore: number | null;
    confLabel: string;
    confDeductions: {
        label: string;
        points: number;
    }[];
    confBlockedBy: string[];
    verifiedBy: string[];
    dealerVerified: boolean;
    verifyRows: VerifyRow[];
    highlights: Highlight[];
    specRows: [
        string,
        string | null | undefined
    ][];
    keySpecs: [
        string,
        string
    ][];
    epa: {
        city: number | null;
        highway: number | null;
        combined: number | null;
        annualFuelCost: number | null;
        ghgScore: number | null;
        rangeMiles: number | null;
        fuelType: string | null;
    } | null;
    overview: string;
    whyBuy: string[];
    reviewRating: number | null;
    reviewCount: number | null;
    reviewUrl: string;
    dealer: Record<string, unknown>;
    dealerName: string;
    dealerPhone: string;
    dealerAddress: string;
    offers: {
        title: string;
        body: string;
        exp: string;
    }[];
    valueHistory: {
        captured_at: string;
        market_value: number | null;
        listing_price: number | null;
        below_market: number | null;
        position: string | null;
    }[];
    priceChange7d: number | null;
    priceChangeTotal: number | null;
    priceChangeLatest: number | null;
    dealerTrust: {
        yearsInBusiness: string;
        satisfaction: string;
        bbbRating: string;
        googleRating: string;
        googleCount: string;
        certifications: string[];
        storefrontUrl: string;
        reviewSources: {
            name: string;
            rating: number | null;
            quote: string;
        }[];
        advisorName: string;
        advisorTitle: string;
        advisorPhoto: string;
        advisorResponse: string;
        familyOwned: boolean;
        serviceLocation: string;
        serviceAddress: string;
        delivery: string;
        financing: boolean;
        amenities: string[];
        services: string[];
        hours: string;
        mobileCtaVariant: string;
    };
    contactRouting: import("./passportRouting.ts").PassportRoutingResult | null;
    iihsAward: import("./iihsAwards.ts").MatchedIihsAward | null;
    historyReport: {
        url: string;
        provider: "carfax" | "autocheck";
        source?: "dealer" | "vin";
    } | null;
    dealerCoverage: {
        title: string;
        coverage: string;
        termYears: number | null;
        termMiles: number | null;
        lifetime: boolean;
        mode: "included" | "available";
        offer: string;
        disclosure: string;
    }[];
}
export const historyReportName = (provider: "carfax" | "autocheck"): string => provider === "autocheck" ? "AutoCheck" : "CARFAX";
export interface PricePoint {
    captured_at: string;
    market_value: number | null;
    listing_price: number | null;
    below_market: number | null;
    position: string | null;
}
export const computePriceHistory = (listing: VehicleListing): {
    valueHistory: PricePoint[];
    priceChange7d: number | null;
    priceChangeTotal: number | null;
    priceChangeLatest: number | null;
} => {
    const rawHist = (listing as unknown as {
        value_history?: unknown;
    }).value_history;
    const rawHistory: PricePoint[] = (Array.isArray(rawHist) ? rawHist : []).map((h) => h as Record<string, unknown>).map((h) => ({
        captured_at: String(h.captured_at ?? ""),
        market_value: h.market_value != null ? Number(h.market_value) : null,
        listing_price: h.listing_price != null ? Number(h.listing_price) : null,
        below_market: h.below_market != null ? Number(h.below_market) : null,
        position: (h.position as string) ?? null,
    })).filter((h) => h.captured_at);
    const SPIKE = 250;
    const rawPriced = rawHistory.filter((h) => h.listing_price != null);
    const spikeAts = new Set<string>();
    for (let i = 1; i < rawPriced.length - 1; i++) {
        const p = rawPriced[i].listing_price!, prev = rawPriced[i - 1].listing_price!, next = rawPriced[i + 1].listing_price!;
        if (p - prev > SPIKE && p - next > SPIKE)
            spikeAts.add(rawPriced[i].captured_at);
    }
    const valueHistory = rawHistory.filter((h) => !spikeAts.has(h.captured_at));
    const priced = valueHistory.filter((h) => h.listing_price != null);
    const latestPrice = priced.length ? priced[priced.length - 1].listing_price! : null;
    const priceChangeTotal = priced.length >= 2 && latestPrice != null ? latestPrice - priced[0].listing_price! : null;
    const priceChange7d = (() => {
        if (priced.length < 2 || latestPrice == null)
            return null;
        const latestT = new Date(priced[priced.length - 1].captured_at).getTime();
        const weekAgo = latestT - 7 * 24 * 60 * 60 * 1000;
        const staleFloor = latestT - 10 * 24 * 60 * 60 * 1000;
        const prior = [...priced].reverse().find((h) => {
            const t = new Date(h.captured_at).getTime();
            return t <= weekAgo && t >= staleFloor;
        });
        if (!prior)
            return null;
        return latestPrice - prior.listing_price!;
    })();
    const priceChangeLatest = (() => {
        for (let i = priced.length - 1; i >= 1; i--) {
            const d = priced[i].listing_price! - priced[i - 1].listing_price!;
            if (Math.abs(d) >= 1)
                return d;
        }
        return null;
    })();
    return { valueHistory, priceChange7d, priceChangeTotal, priceChangeLatest };
};
export interface CompCohort {
    selection: string;
    total_matches: number | null;
    returned_count: number;
    analyzed_count: number;
    sampled: boolean;
    sort_basis: string;
    radius_miles: number | null;
    year: string | null;
    trim: string | null;
    miles_band: {
        percent: number | null;
        range: string;
    } | null;
    excluded: {
        subject_vin: number;
        dealer_own_listings: number;
        unpriced: number;
        trim_or_drivetrain_mismatch?: number;
        outliers: number;
    };
    outlier_rule: string;
    median_method: string;
}
const readCohort = (v: unknown): CompCohort | null => {
    if (!v || typeof v !== "object")
        return null;
    const c = v as Record<string, unknown>;
    if (c.selection !== "price_independent_cohort" || typeof c.analyzed_count !== "number")
        return null;
    return c as unknown as CompCohort;
};
export const cohortExplanation = (c: CompCohort): string[] => {
    const out: string[] = [];
    const total = c.total_matches;
    out.push(total != null && total > c.analyzed_count
        ? `${c.analyzed_count.toLocaleString()} listings analyzed out of ${total.toLocaleString()} matching listings${c.sampled ? " (a nearest-first sample)" : ""}`
        : `${c.analyzed_count.toLocaleString()} listings analyzed`);
    const crit: string[] = [];
    if (c.year)
        crit.push(`model year ${c.year}`);
    crit.push(c.trim ? `trim ${c.trim}` : "all trims");
    if (c.miles_band)
        crit.push(`mileage within the ${c.miles_band.range.replace("-", " to ")} mile band`);
    out.push(`Selected by ${crit.join(", ")}${c.radius_miles != null ? `, within ${c.radius_miles} miles` : ", no distance limit"}; chosen without reference to this vehicle's price`);
    const ex: string[] = [];
    if (c.excluded.subject_vin > 0)
        ex.push("this vehicle");
    if (c.excluded.dealer_own_listings > 0)
        ex.push(`${c.excluded.dealer_own_listings} of this dealer's own listings`);
    if (c.excluded.unpriced > 0)
        ex.push(`${c.excluded.unpriced} without a price`);
    if ((c.excluded.trim_or_drivetrain_mismatch ?? 0) > 0)
        ex.push(`${c.excluded.trim_or_drivetrain_mismatch} with a different trim or drivetrain`);
    if (c.excluded.outliers > 0)
        ex.push(`${c.excluded.outliers} statistical outliers`);
    if (ex.length)
        out.push(`Excluded: ${ex.join(", ")}`);
    return out;
};
export const compSampleView = (m: PassportData["marketMeta"]): {
    analyzed: boolean;
    n: number | null;
    total: number | null;
    caption: string;
} => {
    const where = m.radius != null ? `within ${m.radius} mi` : "nearby";
    if (m.analyzedCount != null) {
        const total = m.cohort?.total_matches ?? m.similarCount;
        return { analyzed: true, n: m.analyzedCount, total, caption: total != null && total > m.analyzedCount ? `of ${total.toLocaleString()} matches, ${where}` : where };
    }
    if (m.similarCount != null)
        return { analyzed: false, n: m.similarCount, total: m.similarCount, caption: `${where}; not all analyzed` };
    return { analyzed: false, n: null, total: null, caption: where };
};
export const derivePassport = (listing: VehicleListing): PassportData => {
    const dealer = (listing.dealer_snapshot || {}) as Record<string, unknown>;
    const mc = (listing.mc_attributes || {}) as Record<string, unknown>;
    const ksRaw = (listing.key_specs || {}) as Record<string, unknown>;
    const ks = {
        ...ksRaw,
        engine: (ksRaw.engine ?? mc.engine ?? undefined) as string | undefined,
        drivetrain: (ksRaw.drivetrain ?? mc.drivetrain ?? undefined) as string | undefined,
        transmission: (ksRaw.transmission ?? mc.transmission ?? undefined) as string | undefined,
        fuel: (ksRaw.fuel ?? mc.fuel_type ?? undefined) as string | undefined,
        mpg_city: (ksRaw.mpg_city ?? mc.city_mpg ?? undefined) as number | undefined,
        mpg_hwy: (ksRaw.mpg_hwy ?? mc.highway_mpg ?? undefined) as number | undefined,
        exterior_color: (ksRaw.exterior_color ?? mc.exterior_color ?? undefined) as string | undefined,
        interior_color: (ksRaw.interior_color ?? mc.interior_color ?? undefined) as string | undefined,
    };
    const mp = listing.market_payload || {};
    const mm = ((listing as unknown as {
        market_meta?: Record<string, unknown>;
    }).market_meta || {}) as Record<string, unknown>;
    const n = (v: unknown): number | null => (v != null && Number.isFinite(Number(v)) ? Number(v) : null);
    const ps = (mm.price_stats || {}) as Record<string, unknown>;
    const ss = (mm.sold_stats || {}) as Record<string, unknown>;
    const soldCount = n(ss.count);
    const soldScope = (ss.scope as string) || null;
    const soldCheckedAt = (ss.checked_at as string) || null;
    const marketMeta = {
        percentile: n(mm.price_percentile),
        radius: n(mm.search_radius),
        similarCount: n(mm.similar_count),
        avgDom: n(mm.avg_dom),
        daysSupply: n(mm.market_days_supply),
        inventoryCount: n(mm.inventory_count),
        checkedAt: (mm.checked_at as string) || null,
        trimMatched: typeof mm.trim_matched === "boolean" ? mm.trim_matched : null,
        priceMedian: n(ps.median),
        priceMean: n(ps.mean),
        milesMean: n(mm.miles_mean),
        likeCount: n(mm.like_count),
        likeMedian: n(mm.like_median),
        soldCount,
        soldPriceMedian: n(ss.price_median),
        soldDomMedian: n(ss.dom_median),
        soldMilesMedian: n(ss.miles_median),
        soldScope,
        soldState: (ss.state as string) || null,
        soldCheckedAt,
        cohort: readCohort(mm.cohort),
        analyzedCount: readCohort(mm.cohort)?.analyzed_count ?? null,
        soldDisplayable: soldScope != null && soldScope !== "make_state" && soldCount != null && soldCount >= 5
            && soldCheckedAt != null && Date.now() - new Date(soldCheckedAt).getTime() <= 45 * 86400000,
    };
    const comparables = Array.isArray((listing as unknown as {
        comparables?: unknown;
    }).comparables)
        ? ((listing as unknown as {
            comparables: PassportData["comparables"];
        }).comparables) : [];
    const bbRaw = (listing as unknown as {
        blackbook?: Record<string, unknown>;
    }).blackbook || null;
    const blackbook = bbRaw ? {
        tradeinClean: n((bbRaw.tradein as Record<string, unknown>)?.clean),
        retailClean: n((bbRaw.retail as Record<string, unknown>)?.clean),
        wholesaleClean: n((bbRaw.wholesale as Record<string, unknown>)?.clean),
        available: !!bbRaw.available,
    } : null;
    const marketCheckedAt = (listing as unknown as {
        market_checked_at?: string;
    }).market_checked_at || marketMeta.checkedAt || null;
    const histRaw = (listing as unknown as {
        history_payload?: Record<string, unknown>;
    }).history_payload || null;
    type HistEntries = NonNullable<PassportData["history"]>["entries"];
    const history: PassportData["history"] = histRaw && histRaw.available ? {
        available: true,
        entries: (Array.isArray(histRaw.entries) ? histRaw.entries : []) as HistEntries,
        owners: n(histRaw.owners),
        inServiceDate: null,
        firstSeen: (histRaw.firstSeen as string) || null,
    } : null;
    const lp = listing as unknown as {
        advertised_price_before_doc?: number | null;
        doc_fee?: number | null;
        website_sale_price?: number | null;
        price_display_mode?: unknown;
        advertised_excludes_doc_fee?: boolean | null;
        price_label?: string | null;
        website_price_term?: string | null;
        dealer_discount?: number | null;
        retail_cash?: number | null;
        payment_display?: unknown;
    };
    const selling = resolvePassportSellingPrice({ price: listing.price, advertised_price_before_doc: lp.advertised_price_before_doc, doc_fee: lp.doc_fee, website_sale_price: lp.website_sale_price }, { price_display_mode: lp.price_display_mode, advertised_excludes_doc_fee: lp.advertised_excludes_doc_fee ?? null });
    const priceMode: PriceDisplayMode = selling.mode;
    const advBeforeDoc = selling.advertisedBeforeDoc;
    const docFee = selling.docFee;
    const websiteSalePrice = selling.websiteSalePrice;
    const price = selling.price;
    const priceIncludesDoc = selling.includesDocFee;
    const isNew = String((listing as {
        condition?: string;
    }).condition || "").toLowerCase() === "new";
    const msrp = (mc.msrp as number) ?? null;
    const priceBreakdown = isNew
        ? buildDiscountBreakdown({
            msrp,
            advertisedBeforeDoc: advBeforeDoc,
            price: listing.price,
            docFee,
            dealerDiscount: lp.dealer_discount ?? null,
            retailCash: lp.retail_cash ?? null,
        }, priceMode)
        : null;
    const marketAvg = listing.market_value ?? null;
    const marketHigh = (mp.high as number) ?? null;
    const marketLow = (mp.low as number) ?? null;
    const marketBasisWeak = ((mp as Record<string, unknown>).source as string | undefined) === "comps_median";
    const passportMarketView = legacyMarketView(listing as unknown as LegacyListingFields, "passport", { comparePrice: price });
    const belowMarket = marketBasisWeak ? null : marketAvg != null
        ? (passportMarketView.difference != null && passportMarketView.difference < 0
            ? -passportMarketView.difference : null)
        : (mp.belowMarket as number) ?? null;
    const aboveMarket = passportMarketView.difference != null && passportMarketView.difference > 250
        ? passportMarketView.difference : null;
    const priceLabel = (lp.price_label as string) || (dealer.price_label as string) || "Our Price";
    const websitePriceTerm = (lp.website_price_term as string) || null;
    const saveVsMsrp = isNew && msrp != null && price != null && msrp > price ? msrp - price : null;
    const belowOriginalMsrp = !isNew && msrp != null && price != null && msrp > price ? msrp - price : null;
    const rawEstimator = (lp as {
        payment_estimator?: unknown;
    }).payment_estimator;
    const paymentEstimator = rawEstimator && typeof rawEstimator === "object" && (rawEstimator as {
        enabled?: unknown;
    }).enabled === true
        ? normalizeEstimatorConfig(rawEstimator)
        : null;
    const modelYear = listingModelYear(listing as unknown as {
        year?: unknown;
        model_year?: unknown;
        ymm?: string | null;
    });
    const paymentEstimate = resolveEstimate(paymentEstimator, { modelYear, sellingPrice: price });
    const estMonthly = paymentEstimate.status === "available" ? paymentEstimate.monthlyPayment : null;
    const paymentAssumptions = paymentEstimate.status === "available" ? estimateAssumptionLine(paymentEstimate) : "";
    const ownerCount = isNew ? 0 : ((mc.owner_count as number) ?? (mc.carfax_1_owner === true ? 1 : null));
    const accidentCount = (mc.accident_count as number) ?? null;
    const titleAttest = listing.title_verification || null;
    const dealerTitleClean = titleAttest?.status === "clean";
    const dealerTitleBranded = titleAttest?.status === "branded";
    const cleanTitle = dealerTitleClean || mc.carfax_clean_title === true;
    const titleBrand = String((mc.title_brand ?? mc.title_status ?? "") as string).trim();
    const titleStatus: PassportData["titleStatus"] = dealerTitleClean
        ? "clean"
        : dealerTitleBranded
            ? "branded"
            : cleanTitle
                ? "clean"
                : mc.carfax_clean_title === false || (titleBrand !== "" && !/^clean/i.test(titleBrand)) ? "branded" : "unknown";
    const titleVerifiedAt = titleAttest?.verified_at || null;
    const titleVerifiedSource: PassportData["titleVerifiedSource"] = titleAttest ? "nmvtis" : null;
    const titlePolicyAttested = titleStatus === "unknown"
        && (dealer.title_policy_no_branded === true || (lp as Record<string, unknown>).title_policy_no_branded === true);
    const titlePolicyAttestedBy = titlePolicyAttested
        ? ((dealer.dealership_name as string) || (dealer.name as string) || null)
        : null;
    const serviceCount = listing.service_records?.length ?? 0;
    const recall = deriveRecallView(listing);
    const recallClear = recall.vin.clearClaimAllowed;
    const openRecalls = recall.vin.openCount;
    const hasRecallCheck = recall.vin.checkComplete;
    const verificationChecks = (listingEquipment(listing).length > 0 ? 1 : 0) +
        (marketAvg != null || marketMeta.similarCount != null ? 1 : 0) +
        (hasRecallCheck ? 1 : 0) +
        ((listing.photos?.length ?? 0) > 0 || listing.hero_image_url ? 1 : 0);
    const dealerVerified = verificationChecks >= 2;
    const warranty: NonNullable<VehicleListing["warranty_info"]> = (() => {
        const w = listing.warranty_info || {};
        if (isNew || !w.in_service_date || verifiedInServiceDate(w.in_service_date, histRaw))
            return w;
        return { ...w, in_service_date: undefined };
    })();
    const warrantyStr = (() => {
        const yrs = warranty.factory_months ? Math.round(warranty.factory_months / 12) : null;
        const mi = warranty.factory_miles ? `${(warranty.factory_miles / 1000).toFixed(0)},000 mi` : null;
        return [yrs ? `${yrs} yr` : null, mi].filter(Boolean).join(" / ") || null;
    })();
    const warrantyExpired = (() => {
        if (isNew)
            return false;
        const timeRemains = (() => {
            if (!warranty.in_service_date || !warranty.factory_months)
                return null;
            const end = new Date(warranty.in_service_date);
            end.setMonth(end.getMonth() + warranty.factory_months);
            return end.getTime() - Date.now() > 0;
        })();
        const milesRemain = warranty.factory_miles && warranty.factory_miles > 0 && listing.mileage != null
            ? warranty.factory_miles - listing.mileage > 0 : null;
        if (timeRemains == null && milesRemain == null)
            return false;
        return timeRemains === false || milesRemain === false;
    })();
    const knownSignals = (typeof mc.carfax_clean_title === "boolean" ? 1 : 0) + (accidentCount != null ? 1 : 0) +
        (ownerCount != null ? 1 : 0) + (hasRecallCheck ? 1 : 0) +
        (serviceCount > 0 ? 1 : 0) + (warrantyStr ? 1 : 0);
    const confDeductions: {
        label: string;
        points: number;
    }[] = [];
    const ded = (cond: boolean, label: string, points: number) => { if (cond)
        confDeductions.push({ label, points }); };
    ded(typeof mc.carfax_clean_title === "boolean" && !cleanTitle, "Title not confirmed clean", 14);
    ded(accidentCount != null && accidentCount > 0, `${accidentCount} reported accident${accidentCount === 1 ? "" : "s"}`, Math.min(18, (accidentCount ?? 0) * 9));
    ded(!isNew && ownerCount != null && ownerCount > 1, `${ownerCount} previous owners`, 6);
    ded(recall.riskSignalled, "Open recall \u2014 needs remedy", 12);
    ded(!isNew && serviceCount === 0 && knownSignals >= 2, "No service records on file", 4);
    ded(!warrantyStr && knownSignals >= 2, "No factory warranty remaining", 5);
    ded(!isNew && typeof mc.carfax_clean_title !== "boolean" && accidentCount == null, "History report not yet attached", 7);
    const titleResolved = titleStatus !== "unknown";
    const historyResolved = accidentCount != null || ownerCount != null;
    const confBlockedBy: string[] = [];
    if (!titleResolved)
        confBlockedBy.push("Title & brand");
    if (!historyResolved)
        confBlockedBy.push("Vehicle history");
    const confScore = confBlockedBy.length === 0 && knownSignals >= 2
        ? Math.max(35, 97 - confDeductions.reduce((s, x) => s + x.points, 0))
        : null;
    const confLabel = confScore == null
        ? (confBlockedBy.length ? "Insufficient data" : "")
        : confScore >= 90 ? "Excellent" : confScore >= 80 ? "Very Good" : confScore >= 70 ? "Good" : "Fair";
    const verifiedBy = [
        { label: "Vehicle History", on: typeof mc.carfax_clean_title === "boolean" || ownerCount != null },
        { label: "Live Market Data", on: marketAvg != null },
        { label: "NHTSA", on: hasRecallCheck },
    ].filter((x) => x.on).map((x) => x.label);
    const verifyRows: VerifyRow[] = [
        { label: "VIN Verified", done: !!listing.vin },
        { label: "Vehicle History", done: typeof mc.carfax_clean_title === "boolean" || ownerCount != null || accidentCount != null },
        { label: "Recall Verification", done: hasRecallCheck },
        { label: "Market Data", done: marketAvg != null || verifiedBy.includes("Live Market Data") },
        { label: "Title & Brand", done: cleanTitle },
        { label: "Warranty Checked", done: !!warrantyStr },
        { label: "Service History", done: serviceCount > 0 },
    ].filter((r) => r.done);
    const highlights: Highlight[] = [];
    if (ks.engine)
        highlights.push({ key: "engine", label: ks.engine, sub: "Engine" });
    if (mc.horsepower)
        highlights.push({ key: "hp", label: `${mc.horsepower} HP`, sub: "Horsepower" });
    if (ks.drivetrain)
        highlights.push({ key: "drive", label: ks.drivetrain, sub: "Drivetrain" });
    if (ks.transmission)
        highlights.push({ key: "trans", label: ks.transmission, sub: "Transmission" });
    if (ks.mpg_city && ks.mpg_hwy)
        highlights.push({ key: "mpg", label: `${ks.mpg_city}/${ks.mpg_hwy} MPG`, sub: "Fuel economy" });
    else if (ks.mpg_city)
        highlights.push({ key: "mpg", label: `${ks.mpg_city} MPG`, sub: "City" });
    else if (ks.fuel)
        highlights.push({ key: "fuel", label: ks.fuel, sub: "Fuel" });
    if (ks.exterior_color)
        highlights.push({ key: "ext", label: ks.exterior_color, sub: "Exterior" });
    listingEquipment(listing).forEach((label, i) => { if (highlights.length < 8)
        highlights.push({ key: `f${i}`, label, sub: "Feature" }); });
    const overview = listing.description ||
        (ks.engine || ks.drivetrain
            ? `The ${listing.ymm}${listing.trim ? " " + listing.trim : ""} pairs a ${ks.engine || "capable"} powertrain with ${ks.drivetrain || "a refined drivetrain"} and a well-equipped cabin.`
            : "");
    const specRows: [
        string,
        string | null | undefined
    ][] = [
        ["Exterior Color", ks.exterior_color as string | undefined],
        ["Interior Color", ks.interior_color as string | undefined],
        ["Transmission", ks.transmission],
        ["Drivetrain", ks.drivetrain],
        ["Engine", ks.engine],
        ["Fuel Type", ks.fuel],
        ks.mpg_city && ks.mpg_hwy ? ["MPG (est.)", `${ks.mpg_city} city / ${ks.mpg_hwy} hwy`] : ["", null],
    ];
    const epaStored = (listing as unknown as {
        epa_economy?: Record<string, unknown> | null;
    }).epa_economy || null;
    const epaModel = String(listing.ymm ?? "").trim().split(/\s+/).slice(2).join(" ");
    const epaRaw = epaStored && storedEpaConflict(epaStored, {
        powertrain: listingPowertrain({ powertrainType: mc.powertrain_type, fuelType: mc.fuel_type, trim: listing.trim, model: epaModel }),
        drive: driveOf(ks.drivetrain),
        liters: litersOf(ks.engine),
        text: `${epaModel} ${listing.trim ?? ""}`,
    }) === null ? epaStored : null;
    const epa = epaRaw && (epaRaw.combined != null || epaRaw.city != null) ? {
        city: (epaRaw.city as number) ?? null,
        highway: (epaRaw.highway as number) ?? null,
        combined: (epaRaw.combined as number) ?? null,
        annualFuelCost: (epaRaw.annualFuelCost as number) ?? null,
        ghgScore: (epaRaw.ghgScore as number) ?? null,
        rangeMiles: (epaRaw.rangeMiles as number) ?? null,
        fuelType: (epaRaw.fuelType as string) ?? null,
    } : null;
    const keySpecs = ([
        ["Engine", ks.engine],
        ["Horsepower", mc.horsepower ? `${mc.horsepower} HP` : null],
        ["Transmission", ks.transmission],
        ["Drivetrain", ks.drivetrain],
        ["Fuel Economy", epa && epa.city && epa.highway
                ? `${epa.city}/${epa.highway} MPG (EPA)`
                : ks.mpg_city && ks.mpg_hwy ? `${ks.mpg_city}/${ks.mpg_hwy} MPG` : ks.fuel || null],
        ["EPA Range", epa?.rangeMiles ? `${epa.rangeMiles} mi` : null],
        ["Exterior Color", ks.exterior_color],
        ["Interior Color", ks.interior_color],
        ["Seats", (mc.seating as string | number) ? `${mc.seating}-Passenger` : null],
    ] as [
        string,
        unknown
    ][]).filter(([, v]) => v).map(([k, v]) => [k, String(v)] as [
        string,
        string
    ]);
    const whyBuy: string[] = [];
    if (saveVsMsrp)
        whyBuy.push(`Priced ${fmt$(saveVsMsrp)} below MSRP`);
    else if (belowOriginalMsrp)
        whyBuy.push(`Priced ${fmt$(belowOriginalMsrp)} below original MSRP`);
    if (belowMarket && belowMarket > 0)
        whyBuy.push(`${fmt$(belowMarket)} below market average`);
    if (warrantyStr && !warrantyExpired)
        whyBuy.push(isNew || warranty.in_service_date ? "Factory warranty remaining" : "Factory warranty terms on record");
    if (recall.vin.clearClaimAllowed)
        whyBuy.push("No open recalls");
    if (ownerCount === 1)
        whyBuy.push("One owner \u2014 personal use");
    if (listing.mileage != null && listing.mileage < 30000)
        whyBuy.push(`Low mileage — ${listing.mileage.toLocaleString()} mi`);
    if (listing.trim && /luxe|autograph|limited|platinum|premium|touring|sport|signature|reserve|titanium|sensory|denali/i.test(listing.trim))
        whyBuy.push(`Premium trim — ${listing.trim}`);
    if (cleanTitle && accidentCount === 0)
        whyBuy.push("Clean vehicle history");
    else if (accidentCount === 0)
        whyBuy.push("No accidents reported");
    if (/awd|4wd|4x4/i.test(String(ks.drivetrain || "")))
        whyBuy.push(`${ks.drivetrain} — all-weather confidence`);
    const rawOffers = (listing as unknown as {
        incentives?: unknown;
    }).incentives ?? (mc as {
        incentives?: unknown;
    }).incentives;
    const offers = (Array.isArray(rawOffers) ? rawOffers : []).map((o) => o as Record<string, unknown>).map((o) => ({
        title: (o.title as string) || (o.program as string) || "Offer",
        body: (o.summary as string) || (o.description as string) || (o.amount ? `$${Number(o.amount).toLocaleString()}` : ""),
        exp: o.valid_through ? `Expires ${new Date(o.valid_through as string).toLocaleDateString()}` : "",
    })).filter((o) => o.body).slice(0, 6);
    const { valueHistory, priceChange7d, priceChangeTotal, priceChangeLatest } = computePriceHistory(listing);
    const t = (listing as unknown as {
        dealer_trust?: Record<string, string>;
    }).dealer_trust ?? {};
    const dealerTrust = {
        yearsInBusiness: t.years_in_business || "",
        satisfaction: t.satisfaction || "",
        bbbRating: t.bbb_rating || "",
        googleRating: t.google_rating || "",
        googleCount: t.google_count || "",
        certifications: (t.certifications || "").split(",").map((c) => c.trim()).filter(Boolean),
        storefrontUrl: t.storefront_url || "",
        reviewSources: (t.review_sources || "").split("\n").map((line) => {
            const [name, rating, ...rest] = line.split("|").map((p) => p.trim());
            return { name: name || "", rating: rating ? Number(rating) : null, quote: rest.join(" | ") };
        }).filter((r) => r.name),
        advisorName: t.advisor_name || "",
        advisorTitle: t.advisor_title || "",
        advisorPhoto: t.advisor_photo || "",
        advisorResponse: t.advisor_response || "",
        familyOwned: t.family_owned === "yes",
        serviceLocation: t.service_location || "",
        serviceAddress: t.service_address || "",
        delivery: t.delivery || "",
        financing: t.financing === "yes",
        amenities: (t.amenities || "").split(",").map((a) => a.trim()).filter(Boolean),
        services: (t.services || "").split(",").map((a) => a.trim()).filter(Boolean),
        hours: t.hours || "",
        mobileCtaVariant: t.mobile_cta_variant || "dealer_availability",
    };
    return {
        price,
        msrp,
        priceLabel,
        websitePriceTerm,
        estMonthly,
        paymentAssumptions,
        paymentEstimator,
        paymentEstimate,
        modelYear,
        saveVsMsrp,
        belowOriginalMsrp,
        docFee,
        websiteSalePrice,
        priceMode,
        priceIncludesDoc,
        priceBreakdown,
        dealerDiscount: lp.dealer_discount ?? null,
        retailCash: lp.retail_cash ?? null,
        recon: (listing as unknown as {
            recon?: PassportData["recon"];
        }).recon ?? null,
        marketAvg,
        marketLow,
        marketHigh,
        belowMarket,
        aboveMarket,
        marketBasisWeak,
        marketMeta,
        comparables,
        blackbook,
        marketCheckedAt,
        history,
        viewCount: listing.view_count ?? null,
        dom: (mc.dom as number) ?? null,
        ownerCount,
        accidentCount,
        cleanTitle,
        titleStatus,
        titleVerifiedAt,
        titleVerifiedSource,
        titlePolicyAttested,
        titlePolicyAttestedBy,
        serviceCount,
        recall,
        recallClear,
        openRecalls,
        hasRecallCheck,
        warranty,
        warrantyStr,
        warrantyExpired,
        oemWarranty: ((listing as unknown as {
            oem_warranty?: OemWarrantyView;
        }).oem_warranty) || null,
        confScore,
        confLabel,
        confDeductions,
        confBlockedBy,
        verifiedBy,
        dealerVerified,
        verifyRows,
        highlights,
        specRows,
        keySpecs,
        epa,
        overview,
        whyBuy,
        reviewRating: (dealer.review_rating as number) ?? null,
        reviewCount: (dealer.review_count as number) ?? null,
        reviewUrl: (dealer.review_url as string) || (dealer.google_url as string) || (dealer.reviews_url as string) || "",
        dealer,
        dealerName: (dealer.name as string) || "the dealership",
        dealerPhone: (dealer.phone as string) || "",
        dealerAddress: [dealer.address, dealer.city, dealer.state, dealer.zip].filter(Boolean).join(", "),
        offers,
        valueHistory,
        priceChange7d,
        priceChangeTotal,
        priceChangeLatest,
        dealerTrust,
        dealerCoverage: (Array.isArray((listing as {
            dealer_coverage?: unknown[];
        }).dealer_coverage) ? (listing as unknown as {
            dealer_coverage: Record<string, unknown>[];
        }).dealer_coverage : []).map((c) => ({
            title: String(c.title || ""),
            coverage: String(c.coverage || ""),
            termYears: typeof c.term_years === "number" ? c.term_years : null,
            termMiles: typeof c.term_miles === "number" ? c.term_miles : null,
            lifetime: c.lifetime === true,
            mode: c.mode === "available" ? "available" as const : "included" as const,
            offer: String(c.offer || ""),
            disclosure: String(c.disclosure || ""),
        })),
        contactRouting: ((listing as unknown as {
            contact_routing?: PassportData["contactRouting"];
        }).contact_routing) ?? null,
        iihsAward: ((listing as unknown as {
            iihs_award?: PassportData["iihsAward"];
        }).iihs_award) ?? null,
        historyReport: ((listing as unknown as {
            history_report?: PassportData["historyReport"];
        }).history_report) ?? null,
    };
};
export type RatingFactorKey = "price" | "history" | "demand" | "equipment" | "coverage";
export interface RatingFactor {
    key: RatingFactorKey;
    label: string;
    score: number | null;
    weight: number;
    evidence: string[];
}
export interface RatingTier {
    id: "exceptional" | "strong" | "solid" | "fair" | "closer-look" | "pending";
    label: string;
    buyLabel: string;
}
export const ratingTier = (s: number | null): RatingTier => s == null ? { id: "pending", label: "Pending", buyLabel: "Pending Verification" }
    : s >= 90 ? { id: "exceptional", label: "Exceptional", buyLabel: "Exceptional Buy" }
        : s >= 80 ? { id: "strong", label: "Strong", buyLabel: "Strong Buy" }
            : s >= 70 ? { id: "solid", label: "Solid", buyLabel: "Solid Buy" }
                : s >= 60 ? { id: "fair", label: "Fair", buyLabel: "Fair" }
                    : { id: "closer-look", label: "Worth a Closer Look", buyLabel: "Worth a Closer Look" };
export interface VehicleRating {
    overall: number | null;
    tier: RatingTier;
    factors: RatingFactor[];
    coverage: {
        measured: number;
        total: number;
        sources: number;
    };
}
const buildSheetValue = (listing: VehicleListing): number | null => {
    const mc = (listing.mc_attributes || {}) as Record<string, unknown>;
    const raw = mc.build_sheet as Record<string, unknown> | null | undefined;
    if (!raw || typeof raw !== "object")
        return null;
    const rows = [
        ...(Array.isArray(raw.packages) ? raw.packages : []),
        ...(Array.isArray(raw.options) ? raw.options : []),
    ] as Record<string, unknown>[];
    const msrps = rows.map((r) => Number(r?.msrp)).filter((n) => Number.isFinite(n) && n > 0);
    return msrps.length ? msrps.reduce((a, b) => a + b, 0) : null;
};
const clampScore = (lo: number, hi: number, v: number) => Math.max(lo, Math.min(hi, Math.round(v)));
export const deriveRating = (listing: VehicleListing, d: PassportData): VehicleRating => {
    const isNew = String((listing as {
        condition?: string;
    }).condition || "").toLowerCase() === "new";
    const m = d.marketMeta;
    const subjMileage = (listing as {
        mileage?: number | null;
    }).mileage ?? null;
    const soldMilesOk = subjMileage == null || m.soldMilesMedian == null || m.soldMilesMedian <= 0
        || (subjMileage >= m.soldMilesMedian * 0.75 && subjMileage <= m.soldMilesMedian * 1.25);
    const soldAnchor = m.soldDisplayable && m.soldCount != null && m.soldCount >= 8
        && m.soldScope === "model_year_state" && m.soldPriceMedian != null && soldMilesOk ? m.soldPriceMedian : null;
    const likeAnchor = m.likeCount != null && m.likeCount >= 3 ? m.likeMedian : null;
    const statsRaw = m.priceMedian ?? m.priceMean;
    const subjTrim = String((listing as {
        trim?: string | null;
    }).trim || "").trim();
    const trimRepresentative = !subjTrim || m.trimMatched !== false;
    const milesRepresentative = subjMileage == null || m.milesMean == null || m.milesMean <= 0
        || Math.abs(subjMileage - m.milesMean) <= m.milesMean * 0.25;
    const statsMayPunish = trimRepresentative && milesRepresentative;
    const statsAnchor = statsRaw != null && d.price != null && d.price > statsRaw
        && likeAnchor == null && !statsMayPunish ? null : statsRaw;
    const anchor = soldAnchor ?? likeAnchor ?? statsAnchor ?? (d.marketBasisWeak ? null : d.marketAvg) ?? (isNew ? d.msrp : null);
    const priceEvidence: string[] = [];
    let priceScore: number | null = null;
    if (anchor != null && anchor > 0 && d.price != null) {
        const pct = ((d.price - anchor) / anchor) * 100;
        priceScore = clampScore(55, 98, 80 - pct * 2);
        if (soldAnchor != null) {
            priceEvidence.push(`Median last advertised price of ${m.soldCount!.toLocaleString()} listings that left the market in ${m.soldState ?? "your state"}`);
        }
        else if (likeAnchor != null || statsAnchor != null || (!d.marketBasisWeak && d.marketAvg != null)) {
            priceEvidence.push(likeAnchor != null && m.likeCount != null
                ? `Checked against ${m.likeCount.toLocaleString()} closely matched listings${m.radius != null ? ` within ${m.radius} miles` : ""}`
                : m.similarCount != null
                    ? `Checked against ${m.similarCount.toLocaleString()} similar listings${m.radius != null ? ` within ${m.radius} miles` : ""}`
                    : "Checked against live local market data");
        }
        else {
            priceEvidence.push(d.msrp != null && d.price <= d.msrp
                ? `Compared against the ${fmt$(d.msrp)} factory sticker for this build`
                : "Compared against the factory sticker for this build");
        }
        if (d.price <= anchor) {
            priceEvidence.push(pct <= -1
                ? `Priced ${fmt$(anchor - d.price)} under the market benchmark`
                : "Priced right at the market benchmark");
        }
        else {
            priceEvidence.push(pct < 3
                ? `Within ${Math.max(1, Math.round(pct))}% of the market benchmark`
                : "Priced above the market benchmark for the model line");
        }
    }
    const demandInputs: {
        score: number;
        line: string;
    }[] = [];
    if (m.soldDisplayable && m.soldDomMedian != null && m.soldDomMedian >= 1) {
        const sd = Math.round(m.soldDomMedian);
        demandInputs.push({ score: sd <= 30 ? 90 : sd <= 45 ? 80 : sd <= 60 ? 68 : 55, line: `Similar listings were typically listed ~${sd} days before leaving the market here` });
    }
    if (d.dom != null && m.avgDom != null && m.avgDom > 0) {
        const credibleAvg = m.avgDom <= CREDIBLE_AVG_DOM_MAX ? m.avgDom : null;
        if (credibleAvg != null) {
            const r = d.dom / credibleAvg;
            demandInputs.push({ score: r <= 0.5 ? 90 : r <= 1 ? 78 : r <= 1.5 ? 60 : 48, line: `${d.dom} days listed vs a ${credibleAvg}-day average for comparable listings` });
        }
        else if (d.dom <= 30) {
            demandInputs.push({ score: d.dom <= 14 ? 82 : 70, line: `Listed ${d.dom} days — fresh to market` });
        }
    }
    if (m.daysSupply != null) {
        demandInputs.push({ score: m.daysSupply < 30 ? 88 : m.daysSupply < 60 ? 72 : 55, line: `${Math.round(m.daysSupply)}-day local supply of similar vehicles` });
    }
    const demandScore = demandInputs.length
        ? clampScore(5, 95, demandInputs.reduce((a, b) => a + b.score, 0) / demandInputs.length)
        : null;
    const historyEvidence = d.confScore == null ? [] : d.confDeductions.length
        ? d.confDeductions.map((x) => `${x.label} (−${x.points} pts)`)
        : ["Every known history signal on this vehicle is clean"];
    const equipCount = listingEquipment(listing).length;
    const optValue = buildSheetValue(listing);
    const equipEvidence: string[] = [];
    let equipScore: number | null = null;
    if (equipCount > 0 || optValue != null) {
        const base = equipCount > 0 ? clampScore(55, 90, 55 + equipCount * 2.5) : 60;
        equipScore = Math.min(96, Math.round(base + (optValue ? Math.min(8, optValue / 1500) : 0)));
        if (equipCount > 0)
            equipEvidence.push(`${equipCount} options decoded from VIN`);
        if (optValue)
            equipEvidence.push(`${fmt$(optValue)} in factory packages`);
    }
    const covInputs: {
        score: number;
        line: string;
    }[] = [];
    const dealerCov = d.dealerCoverage.find((c) => c.mode === "included") || null;
    const factoryScore = (() => {
        if (!d.warrantyStr || d.warrantyExpired)
            return null;
        const w = d.warranty;
        if (w.in_service_date && w.factory_months) {
            const end = new Date(w.in_service_date);
            end.setMonth(end.getMonth() + w.factory_months);
            const monthsLeft = Math.max(0, end.getTime() - Date.now()) / (1000 * 60 * 60 * 24 * 30.4);
            return clampScore(55, 98, 55 + (monthsLeft / w.factory_months) * 43);
        }
        return 80;
    })();
    if (factoryScore != null) {
        covInputs.push({
            score: factoryScore,
            line: isNew ? `Full factory coverage — ${d.warrantyStr}` : `${d.warrantyStr} factory coverage on the books`,
        });
    }
    if (dealerCov) {
        covInputs.push({
            score: dealerCov.lifetime ? 96 : 90,
            line: dealerCov.lifetime
                ? `Lifetime ${dealerCov.coverage || "powertrain"} coverage included by the dealer`
                : `Dealer ${dealerCov.coverage || "coverage"} included`,
        });
    }
    if (d.serviceCount > 0) {
        covInputs.push({ score: clampScore(70, 92, 70 + d.serviceCount * 4), line: `${d.serviceCount} service record${d.serviceCount === 1 ? "" : "s"} on file` });
    }
    const signedAt = listing.prep_status?.foreman_signed_at || null;
    if (signedAt) {
        covInputs.push({ score: 90, line: `Reconditioning signed off ${new Date(signedAt).toLocaleDateString()}` });
    }
    const covScore = covInputs.length
        ? Math.round(covInputs.reduce((a, b) => a + b.score, 0) / covInputs.length)
        : null;
    const covEvidence = covInputs.map((c) => c.line);
    if (covScore != null && d.warrantyStr && d.warrantyExpired) {
        covEvidence.push("Factory term has ended \u2014 ask the dealer about available coverage");
    }
    const factors: RatingFactor[] = [
        { key: "price", label: "Price vs Market", score: priceScore, weight: 30, evidence: priceEvidence },
        ...(isNew ? [] : [{ key: "history" as const, label: "History & Title", score: d.confScore, weight: 25, evidence: historyEvidence }]),
        { key: "demand", label: "Demand & Velocity", score: demandScore, weight: 15, evidence: demandInputs.map((x) => x.line) },
        { key: "equipment", label: "Equipment & Build", score: equipScore, weight: 15, evidence: equipEvidence },
        { key: "coverage", label: "Coverage & Care", score: covScore, weight: 15, evidence: covEvidence },
    ];
    const measured = factors.filter((f) => f.score != null);
    const anchored = measured.some((f) => f.key === "price" || f.key === "history");
    const adverseHistory = d.titleStatus === "branded"
        || (d.accidentCount ?? 0) > 0
        || (d.openRecalls ?? 0) > 0
        || d.recall.riskSignalled;
    const overall = measured.length >= 2 && anchored && !adverseHistory
        ? Math.min(97, Math.round(measured.reduce((s, f) => s + (f.score as number) * f.weight, 0) /
            measured.reduce((s, f) => s + f.weight, 0)))
        : null;
    const mc = (listing.mc_attributes || {}) as Record<string, unknown>;
    const sources = [
        anchor != null || m.similarCount != null,
        typeof mc.carfax_clean_title === "boolean" || d.ownerCount != null || d.accidentCount != null,
        d.hasRecallCheck,
        equipCount > 0 || optValue != null,
        !!d.warrantyStr || dealerCov != null,
        d.serviceCount > 0 || !!signedAt,
    ].filter(Boolean).length;
    return {
        overall,
        tier: ratingTier(overall),
        factors,
        coverage: { measured: measured.length, total: factors.length, sources },
    };
};
export interface SoldClaims {
    velocity: string | null;
    soldPrice: {
        headline: string;
        sub: string;
        amount: number;
    } | null;
    sellTime: string | null;
    milesAdv: string | null;
}
export const deriveSoldClaims = (d: PassportData, mileage: number | null, condition?: string | null): SoldClaims => {
    const m = d.marketMeta;
    const none: SoldClaims = { velocity: null, soldPrice: null, sellTime: null, milesAdv: null };
    if (!m.soldDisplayable || m.soldCount == null || !m.soldState)
        return none;
    const isNewCar = String(condition || "").toLowerCase() === "new";
    const noun = isNewCar ? "same-model vehicles" : "similar vehicles";
    const velocity = `${m.soldCount.toLocaleString()} ${noun} left the market in ${m.soldState} (listing records, not confirmed sales)`;
    const aboveMarket = d.marketAvg != null && d.price != null && d.price > d.marketAvg;
    const soldPrice = m.soldCount >= 10 && m.soldScope === "model_year_state" && m.soldPriceMedian != null
        && d.price != null && d.price <= m.soldPriceMedian * 0.97
        && (mileage == null || m.soldMilesMedian == null || mileage <= m.soldMilesMedian * 1.25)
        && !aboveMarket
        ? {
            headline: `Priced ${fmt$(m.soldPriceMedian - d.price)} below the typical last advertised price of similar listings that left the market`,
            sub: `Median last advertised price of ${m.soldCount.toLocaleString()} listings that left the market in ${m.soldState}; advertised prices, not transaction prices`,
            amount: m.soldPriceMedian - d.price,
        }
        : null;
    const sellTime = m.soldDomMedian != null && m.soldDomMedian >= 1 && m.soldDomMedian <= 60
        ? `Similar listings typically left the market after ~${Math.round(m.soldDomMedian)} days listed here`
        : null;
    const milesAdv = mileage != null && m.soldMilesMedian != null && m.soldMilesMedian >= mileage * 1.15
        ? `${mileage.toLocaleString()} miles — under the ${Math.round(m.soldMilesMedian).toLocaleString()}-mile median of similar listings that left the market`
        : null;
    return { velocity, soldPrice, sellTime, milesAdv };
};
export const suppressPassportMarketClaim = (d: PassportData): PassportData => ({
    ...d,
    marketAvg: null,
    marketLow: null,
    marketHigh: null,
    belowMarket: null,
    aboveMarket: null,
    marketCheckedAt: null,
    marketBasisWeak: false,
    marketMeta: { ...d.marketMeta, checkedAt: null },
    valueHistory: d.valueHistory.map((p) => ({ ...p, market_value: null, below_market: null })),
});
