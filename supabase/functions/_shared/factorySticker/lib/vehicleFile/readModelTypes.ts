// GENERATED — do not edit.
// Mirror of src/lib/vehicleFile/readModelTypes.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
import type { RecallView } from "../vehicleTruth/recallView.ts";
import type { Confidence, SourceKind } from "../vehicleTruth/precedence.ts";
export type FreshnessState = "CURRENT" | "STALE" | "SUPERSEDED" | "CONFLICTED" | "UNKNOWN";
export type ParityClass = "MATCH" | "SEMANTIC_MATCH" | "CURRENT_OLD_VALUE_WRONG" | "NEW_VALUE_WRONG" | "EXPECTED_SOURCE_DIFFERENCE" | "UNEXPLAINED";
export type LicenseClass = "INTERNAL_USE_CLEARED" | "CUSTOMER_DISPLAY_CLEARED" | "UNKNOWN_REVIEW_REQUIRED";
export const CRITICAL_FIELDS = [
    "vin",
    "year",
    "make",
    "model",
    "trim",
    "stock",
    "mileage",
    "advertised_retail",
    "msrp",
    "engine",
    "drivetrain",
    "condition",
] as const;
export type CriticalField = (typeof CRITICAL_FIELDS)[number];
export const MUST_BE_FULLY_EXPLAINED: CriticalField[] = [
    "vin",
    "stock",
    "mileage",
    "advertised_retail",
];
export interface FieldCandidate<T = unknown> {
    value: T;
    source: SourceKind;
    origin: string;
    provider: string;
    observedAt: string | null;
    confidence: Confidence;
    license: LicenseClass;
    note?: string;
}
export interface ResolvedField<T = unknown> {
    key: string;
    value: T | null;
    chosen: FieldCandidate<T> | null;
    freshness: FreshnessState;
    ageDays: number | null;
    candidates: Array<FieldCandidate<T>>;
    disagreeing: Array<FieldCandidate<T>>;
    disputed: boolean;
    reason: string;
}
export interface IdentitySection {
    vin: ResolvedField<string>;
    year: ResolvedField<number>;
    make: ResolvedField<string>;
    model: ResolvedField<string>;
    trim: ResolvedField<string>;
    bodyStyle: ResolvedField<string>;
    exteriorColor: ResolvedField<string>;
    interiorColor: ResolvedField<string>;
    engine: ResolvedField<string>;
    drivetrain: ResolvedField<string>;
    transmission: ResolvedField<string>;
    fuelType: ResolvedField<string>;
}
export interface DealerStateSection {
    stock: ResolvedField<string>;
    mileage: ResolvedField<number>;
    condition: ResolvedField<string>;
    certified: ResolvedField<boolean>;
    inTransit: ResolvedField<boolean>;
    listingStatus: ResolvedField<string>;
    daysInInventory: ResolvedField<number>;
}
export interface PricingSection {
    advertisedRetail: ResolvedField<number>;
    sellingPrice: ResolvedField<number>;
    docFee: ResolvedField<number>;
    dealerDiscount: ResolvedField<number>;
    msrpFactory: ResolvedField<number>;
    msrpFeed: ResolvedField<number>;
    advertisedIncludesDocFee: boolean;
    priceDisplayMode: string | null;
}
export interface PublicAdvertisementSection {
    observedPrice: ResolvedField<number>;
    observedBeforeDocFee: ResolvedField<number>;
    observedDocFee: ResolvedField<number>;
    observedDiscount: ResolvedField<number>;
    vdpUrl: string | null;
    observedAt: string | null;
    evidencePath: string | null;
    evidenceSha256: string | null;
    lastOutcome: string | null;
    lastRefused: {
        scraped: number;
        feed: number;
        at: string;
    } | null;
}
export interface MarketIntelligenceSection {
    marketValue: ResolvedField<number>;
    daysOnMarket: ResolvedField<number>;
    comparableCount: ResolvedField<number>;
    marketDaysSupply: ResolvedField<number>;
    priceChangePercent: ResolvedField<number>;
    referencePrice: ResolvedField<number>;
    readonly kind: "analysis";
}
export interface ListingLifecycleSection {
    firstSeenAt: string | null;
    lastSeenAt: string | null;
    publishedAt: string | null;
    archivedAt: string | null;
    archiveReason: string | null;
    lifecycleStage: string | null;
    lifecycleContradiction: string | null;
}
export interface GetReadySection {
    stage: string | null;
    status: string | null;
    fromCompletedWork: boolean;
    inspectionSigned: boolean;
    reconApproved: boolean;
    prepSignedOff: boolean;
    deliveryCleared: boolean;
    openWorkItems: number;
    blockers: string[];
}
export interface DocumentsSection {
    buyersGuide: {
        present: boolean;
        source: string;
        documentId: string | null;
    };
    windowSticker: {
        present: boolean;
        source: string;
        documentId: string | null;
    };
    addendum: {
        present: boolean;
        documentId: string | null;
    };
    oemSticker: {
        present: boolean;
        url: string | null;
    };
    staleFlags: Array<{
        documentId: string;
        field: string;
        since: string | null;
    }>;
    counts: {
        generated: number;
        signed: number;
        stale: number;
    };
}
export interface ComplianceSection {
    recall: RecallView;
    recallStatus: ResolvedField<string>;
    openRecallCount: ResolvedField<number>;
    doNotDrive: boolean;
    titleStatus: ResolvedField<string>;
    titleVerification: ResolvedField<string>;
    ctMvpStatus: string | null;
    blockers: string[];
}
export interface MediaSection {
    heroImageUrl: string | null;
    photoCount: number;
    photoHosts: string[];
}
export interface CustomerSection {
    passportSlug: string | null;
    passportPublishedAt: string | null;
    scans: number;
    engagements: number;
    leads: number;
    lastActivityAt: string | null;
}
export interface PublishingSection {
    descriptionVersionId: string | null;
    descriptionUpdatedAt: string | null;
    channelsPublished: string[];
    channelsBlocked: Array<{
        channel: string;
        code: string;
    }>;
    autofilmEligible: boolean;
}
export interface SourceHealthEntry {
    source: string;
    state: "CURRENT" | "STALE" | "FAILING" | "DISABLED" | "NOT_CONFIGURED" | "UNKNOWN";
    lastSuccessAt: string | null;
    lastFailureAt: string | null;
    supplies: string[];
    attention: string | null;
}
export interface TimelineEvent {
    at: string;
    kind: string;
    summary: string;
    origin: string;
}
export interface ConflictEntry {
    field: string;
    winner: {
        value: unknown;
        provider: string;
        origin: string;
    };
    loser: {
        value: unknown;
        provider: string;
        origin: string;
    };
    disputed: boolean;
    expectedBecause: string | null;
}
export interface VehicleFileReadModel {
    version: 1;
    tenantId: string;
    vehicleId: string;
    vin: string;
    generatedAt: string;
    identity: IdentitySection;
    dealerState: DealerStateSection;
    pricing: PricingSection;
    publicAdvertisement: PublicAdvertisementSection;
    marketIntelligence: MarketIntelligenceSection;
    listingLifecycle: ListingLifecycleSection;
    getReady: GetReadySection;
    documents: DocumentsSection;
    compliance: ComplianceSection;
    media: MediaSection;
    customer: CustomerSection;
    publishing: PublishingSection;
    sourceHealth: SourceHealthEntry[];
    conflicts: ConflictEntry[];
    recentChanges: TimelineEvent[];
    currentOwner: string | null;
    blocker: string | null;
    nextAction: string | null;
    missingSources: string[];
    warnings: string[];
}
export interface ParityRow {
    vin: string;
    vehicleId: string;
    tenantId: string;
    field: CriticalField;
    currentValue: unknown;
    currentOrigin: string;
    resolvedValue: unknown;
    resolvedOrigin: string | null;
    resolvedProvider: string | null;
    freshness: FreshnessState;
    observedAt: string | null;
    verdict: ParityClass;
    explanation: string;
}
export interface ParitySummary {
    activeVins: number;
    comparedVins: number;
    byField: Record<string, Record<ParityClass, number>>;
    totals: Record<ParityClass, number>;
    unexplained: ParityRow[];
    fullyExplained: Record<string, boolean>;
    staleValues: number;
    conflicts: number;
    missingSources: Record<string, number>;
}
