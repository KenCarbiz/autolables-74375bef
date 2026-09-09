// GENERATED — do not edit.
// Mirror of src/lib/vehicleFile/readModelTypes.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// The Vehicle File read model — one shape, assembled once, server-side.
//
// Today the browser assembles a vehicle from 48 read sites and no two agree
// (DUPLICATE_READ_PATHS.md). This module is the contract for the projection
// that replaces them: what a field is, where it came from, when the SOURCE
// (not the orchestrator) last saw it, and whether anything disagrees.
//
// Three rules the shapes here exist to enforce:
//
//   1. A value is never separable from its provenance. Every resolved field
//      carries the candidate that won, the candidates that lost, and the
//      physical origin of each — so "Dealer stated" can never again be
//      printed over a MarketCheck feed value (SOURCE_TO_FACT_MATRIX §3).
//   2. Freshness is computed from the writer's own stamp. `vehicle_facts`
//      stamps `observed_at` with orchestration time and never refreshes for
//      a published vehicle, so it cannot answer "is this current".
//   3. Nothing here is persisted. This is a DTO. The directive forbids a
//      second truth table, and a projection that has to be migrated is a
//      projection that cannot be corrected in one deploy.

import type { RecallView } from "../vehicleTruth/recallView.ts";
import type { Confidence, SourceKind } from "../vehicleTruth/precedence.ts";

/** Where a value stands relative to the world, per directive §10. */
export type FreshnessState =
  /** The source stamp is inside this family's policy window. */
  | "CURRENT"
  /** Older than the policy window; the value may still be right. */
  | "STALE"
  /** A later observation from a source of equal or better standing exists. */
  | "SUPERSEDED"
  /** Two sources that may both verify this fact disagree. */
  | "CONFLICTED"
  /** No candidate, or no stamp to age it by. Never guessed. */
  | "UNKNOWN";

/** Shadow-parity verdict for one field on one vehicle, per directive §50. */
export type ParityClass =
  | "MATCH"
  | "SEMANTIC_MATCH"
  | "CURRENT_OLD_VALUE_WRONG"
  | "NEW_VALUE_WRONG"
  | "EXPECTED_SOURCE_DIFFERENCE"
  | "UNEXPLAINED";

/** Redistribution standing, per directive §34 and CUSTOMER_DISPLAY_LICENSE_MATRIX.md. */
export type LicenseClass =
  | "INTERNAL_USE_CLEARED"
  | "CUSTOMER_DISPLAY_CLEARED"
  | "UNKNOWN_REVIEW_REQUIRED";

/** The twelve fields §50 requires, plus the four §51 holds to 100% explained. */
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

/** §51: a 99% average is unacceptable if the 1% includes a wrong price. */
export const MUST_BE_FULLY_EXPLAINED: CriticalField[] = [
  "vin",
  "stock",
  "mileage",
  "advertised_retail",
];

/**
 * One source's answer for one field.
 *
 * `origin` is physical (`vehicle_listings.price`, `mc_attributes.msrp`) and
 * `provider` is who said it. They differ constantly and conflating them is
 * the defect this whole build exists to remove: `mc_attributes.engine` is
 * physically a listing column and providerially the MarketCheck feed, even
 * on a vehicle whose NeoVIN build sheet was purchased.
 */
export interface FieldCandidate<T = unknown> {
  value: T;
  source: SourceKind;
  /** `table.column`, or `table.column->json.path`. Always a real location. */
  origin: string;
  /** Human provider name: "MarketCheck syndication feed", "NeoVIN build sheet". */
  provider: string;
  /**
   * When the SOURCE observed it, from the writer's own stamp
   * (`price_last_verified_at`, `advertised_prices.captured_at`,
   * `mc_attributes.specs_decoded_at`, ...). Null when nothing stamps it —
   * which makes the field UNKNOWN-fresh, never CURRENT.
   */
  observedAt: string | null;
  confidence: Confidence;
  license: LicenseClass;
  /** Why this candidate is worth considering, or what is wrong with it. */
  note?: string;
}

export interface ResolvedField<T = unknown> {
  key: string;
  /** The winning value, or null when there is no usable candidate. */
  value: T | null;
  chosen: FieldCandidate<T> | null;
  freshness: FreshnessState;
  /** Age of `chosen.observedAt` in days, or null when unstamped. */
  ageDays: number | null;
  /** Every candidate seen, winner first. */
  candidates: Array<FieldCandidate<T>>;
  /** Candidates whose value differs from the winner's. */
  disagreeing: Array<FieldCandidate<T>>;
  /** Two sources that may both verify this fact disagree — a person decides. */
  disputed: boolean;
  /** Plain sentence: why this won, or why nothing did. */
  reason: string;
}

// ── Sections (directive §11) ────────────────────────────────────────

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
  /** `new` | `used` | `cpo`, as the dealer's own systems state it. */
  certified: ResolvedField<boolean>;
  inTransit: ResolvedField<boolean>;
  listingStatus: ResolvedField<string>;
  daysInInventory: ResolvedField<number>;
}

/**
 * Money, kept as named questions rather than one number.
 *
 * `advertisedRetail` is what the dealer asks today, total, fee-inclusive
 * where the tenant advertises that way. `sellingPrice` is that total minus
 * the doc fee. `msrpFactory` is the Monroney total from the build sheet;
 * `msrpFeed` is the MarketCheck listing field of the same name, whose
 * semantics are UNKNOWN (they disagree on 104 of 123 vehicles). Answering
 * "the MSRP" with one of them silently is how the current system lies.
 */
export interface PricingSection {
  advertisedRetail: ResolvedField<number>;
  sellingPrice: ResolvedField<number>;
  docFee: ResolvedField<number>;
  dealerDiscount: ResolvedField<number>;
  msrpFactory: ResolvedField<number>;
  msrpFeed: ResolvedField<number>;
  /** True when this tenant advertises a fee-inclusive total. */
  advertisedIncludesDocFee: boolean;
  /** The tenant's configured display mode, echoed for the projections. */
  priceDisplayMode: string | null;
}

/** What a shopper actually saw on the dealer's own page. */
export interface PublicAdvertisementSection {
  observedPrice: ResolvedField<number>;
  observedBeforeDocFee: ResolvedField<number>;
  observedDocFee: ResolvedField<number>;
  observedDiscount: ResolvedField<number>;
  vdpUrl: string | null;
  observedAt: string | null;
  /** Storage path of the evidence render, never a signed URL. */
  evidencePath: string | null;
  evidenceSha256: string | null;
  /** Crawl outcome of the most recent attempt, from the ledger. */
  lastOutcome: string | null;
  /** The guard refused the page price; no observation row exists. */
  lastRefused: { scraped: number; feed: number; at: string } | null;
}

export interface MarketIntelligenceSection {
  marketValue: ResolvedField<number>;
  daysOnMarket: ResolvedField<number>;
  comparableCount: ResolvedField<number>;
  marketDaysSupply: ResolvedField<number>;
  priceChangePercent: ResolvedField<number>;
  referencePrice: ResolvedField<number>;
  /** Every field here is analysis, not an intrinsic fact (§7). */
  readonly kind: "analysis";
}

export interface ListingLifecycleSection {
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  publishedAt: string | null;
  archivedAt: string | null;
  archiveReason: string | null;
  lifecycleStage: string | null;
  /** Lifecycle says one thing and `status` another. */
  lifecycleContradiction: string | null;
}

export interface GetReadySection {
  stage: string | null;
  status: string | null;
  /** True only when a real workflow event produced it (§36). */
  fromCompletedWork: boolean;
  inspectionSigned: boolean;
  reconApproved: boolean;
  prepSignedOff: boolean;
  deliveryCleared: boolean;
  openWorkItems: number;
  blockers: string[];
}

export interface DocumentsSection {
  buyersGuide: { present: boolean; source: string; documentId: string | null };
  windowSticker: { present: boolean; source: string; documentId: string | null };
  addendum: { present: boolean; documentId: string | null };
  oemSticker: { present: boolean; url: string | null };
  /** De-duplicated per (document, field): the raw table has 7,079 dupes. */
  staleFlags: Array<{ documentId: string; field: string; since: string | null }>;
  counts: { generated: number; signed: number; stale: number };
}

export interface ComplianceSection {
  /**
   * The two recall scopes, resolved once. `recall.vin.checkComplete` is the
   * only thing that may satisfy a VIN-level requirement — a verified badge, a
   * clearance, a clean claim. `recallStatus` and `openRecallCount` below stay
   * as the provenance-carrying projections of the underlying columns.
   */
  recall: RecallView;
  recallStatus: ResolvedField<string>;
  openRecallCount: ResolvedField<number>;
  doNotDrive: boolean;
  titleStatus: ResolvedField<string>;
  /** UNKNOWN on every vehicle today: the column does not exist live. */
  titleVerification: ResolvedField<string>;
  ctMvpStatus: string | null;
  blockers: string[];
}

export interface MediaSection {
  heroImageUrl: string | null;
  photoCount: number;
  /** Every photo URL resolves to the dealer's own site or syndication CDN. */
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
  channelsBlocked: Array<{ channel: string; code: string }>;
  autofilmEligible: boolean;
}

export interface SourceHealthEntry {
  source: string;
  state: "CURRENT" | "STALE" | "FAILING" | "DISABLED" | "NOT_CONFIGURED" | "UNKNOWN";
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  supplies: string[];
  /** Something a person should act on, or null. */
  attention: string | null;
}

export interface TimelineEvent {
  at: string;
  kind: string;
  summary: string;
  /** `vehicle_change_history`, `vehicle_value_history`, ... never the audit tail. */
  origin: string;
}

export interface ConflictEntry {
  field: string;
  winner: { value: unknown; provider: string; origin: string };
  loser: { value: unknown; provider: string; origin: string };
  disputed: boolean;
  /** Present when the disagreement is expected, e.g. two MSRP concepts. */
  expectedBecause: string | null;
}

/**
 * The whole vehicle, once.
 *
 * `blocker` and `nextAction` are the only opinionated fields: everything
 * else states what is, and those two state what a person should do about it.
 */
export interface VehicleFileReadModel {
  /** Model shape version, so a consumer can refuse an older projection. */
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
  /** Sources that could not be read at all, so a gap is never silent. */
  missingSources: string[];
  /** Non-fatal problems assembling the model. */
  warnings: string[];
}

// ── Shadow parity (directive §50-§52) ───────────────────────────────

export interface ParityRow {
  vin: string;
  vehicleId: string;
  tenantId: string;
  field: CriticalField;
  /** What the app renders today, and from where. */
  currentValue: unknown;
  currentOrigin: string;
  /** What the read model resolves, and from where. */
  resolvedValue: unknown;
  resolvedOrigin: string | null;
  resolvedProvider: string | null;
  freshness: FreshnessState;
  observedAt: string | null;
  verdict: ParityClass;
  /** Required for every verdict that is not MATCH. Never empty. */
  explanation: string;
}

export interface ParitySummary {
  activeVins: number;
  comparedVins: number;
  byField: Record<string, Record<ParityClass, number>>;
  totals: Record<ParityClass, number>;
  unexplained: ParityRow[];
  /** §51: these four must have zero UNEXPLAINED. */
  fullyExplained: Record<string, boolean>;
  staleValues: number;
  conflicts: number;
  missingSources: Record<string, number>;
}
