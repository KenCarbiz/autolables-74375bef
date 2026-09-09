// Assembling the whole Vehicle File, once.
//
// Every builder is called here, in the one order their inputs allow, and the
// result is the single shape the directive's §11 read model describes. Two
// rules govern this file and nothing else in it is interesting:
//
//   1. IT MUST NOT THROW. A projection that dies on one bad vehicle takes the
//      page down and tells a person nothing; a projection that survives and
//      reports the gap keeps the other eleven sections on screen and names
//      what failed. So every builder call is wrapped, a failure becomes a line
//      in `warnings` plus an empty section, and the return value is always a
//      valid VehicleFileReadModel.
//   2. A GAP IS NAMED, NEVER SILENT. `missingSources` carries the bundle's own
//      read failures plus every section that received no candidate at all, so
//      "we have no price" and "we never asked for a price" are never the same
//      sentence.

import { buildDealerState } from "./dealerState.ts";
import { buildIdentity } from "./identity.ts";
import { buildListingLifecycle, buildMarketIntelligence } from "./market.ts";
import { buildCompliance, buildDocuments, buildGetReady } from "./operations.ts";
import {
  buildCustomer,
  buildMedia,
  buildPublishing,
  buildSourceHealth,
  buildTimeline,
  deriveAttention,
  type Attention,
  type AttentionInput,
} from "./presentation.ts";
import { buildPricing, buildPublicAdvertisement } from "./pricing.ts";
import { emptyField } from "./resolveField.ts";
import { deriveRecallView } from "../vehicleTruth/recallView.ts";
import type {
  ComplianceSection,
  ConflictEntry,
  CustomerSection,
  DealerStateSection,
  DocumentsSection,
  GetReadySection,
  IdentitySection,
  ListingLifecycleSection,
  MarketIntelligenceSection,
  MediaSection,
  PricingSection,
  PublicAdvertisementSection,
  PublishingSection,
  ResolvedField,
  VehicleFileReadModel,
} from "./readModelTypes.ts";
import { str, type VehicleFileSources } from "./sources.ts";

export interface BuildReadModelOptions {
  /** Milliseconds since the epoch; injected so a projection is testable. */
  now?: number;
}

// ── Empty sections, so a failed builder still returns its shape ─────

const emptyIdentity = (why: string): IdentitySection => ({
  vin: emptyField<string>("vin", why),
  year: emptyField<number>("year", why),
  make: emptyField<string>("make", why),
  model: emptyField<string>("model", why),
  trim: emptyField<string>("trim", why),
  bodyStyle: emptyField<string>("body_style", why),
  exteriorColor: emptyField<string>("exterior_color", why),
  interiorColor: emptyField<string>("interior_color", why),
  engine: emptyField<string>("engine", why),
  drivetrain: emptyField<string>("drivetrain", why),
  transmission: emptyField<string>("transmission", why),
  fuelType: emptyField<string>("fuel_type", why),
});

const emptyDealerState = (why: string): DealerStateSection => ({
  stock: emptyField<string>("stock", why),
  mileage: emptyField<number>("mileage", why),
  condition: emptyField<string>("condition", why),
  certified: emptyField<boolean>("certified", why),
  inTransit: emptyField<boolean>("in_transit", why),
  listingStatus: emptyField<string>("listing_status", why),
  daysInInventory: emptyField<number>("days_in_inventory", why),
});

const emptyPricing = (why: string): PricingSection => ({
  advertisedRetail: emptyField<number>("advertised_retail", why),
  sellingPrice: emptyField<number>("selling_price", why),
  docFee: emptyField<number>("doc_fee", why),
  dealerDiscount: emptyField<number>("dealer_discount", why),
  msrpFactory: emptyField<number>("msrp_factory", why),
  msrpFeed: emptyField<number>("msrp_feed", why),
  advertisedIncludesDocFee: false,
  priceDisplayMode: null,
});

const emptyPublicAdvertisement = (why: string): PublicAdvertisementSection => ({
  observedPrice: emptyField<number>("observed_price", why),
  observedBeforeDocFee: emptyField<number>("observed_before_doc_fee", why),
  observedDocFee: emptyField<number>("observed_doc_fee", why),
  observedDiscount: emptyField<number>("observed_discount", why),
  vdpUrl: null,
  observedAt: null,
  evidencePath: null,
  evidenceSha256: null,
  lastOutcome: null,
  lastRefused: null,
});

const emptyMarket = (why: string): MarketIntelligenceSection => ({
  marketValue: emptyField<number>("market_value", why),
  daysOnMarket: emptyField<number>("days_on_market", why),
  comparableCount: emptyField<number>("comparable_count", why),
  marketDaysSupply: emptyField<number>("market_days_supply", why),
  priceChangePercent: emptyField<number>("price_change_percent", why),
  referencePrice: emptyField<number>("reference_price", why),
  kind: "analysis",
});

const emptyLifecycle = (): ListingLifecycleSection => ({
  firstSeenAt: null,
  lastSeenAt: null,
  publishedAt: null,
  archivedAt: null,
  archiveReason: null,
  lifecycleStage: null,
  lifecycleContradiction: null,
});

const emptyGetReady = (why: string): GetReadySection => ({
  stage: null,
  status: null,
  fromCompletedWork: false,
  inspectionSigned: false,
  reconApproved: false,
  prepSignedOff: false,
  deliveryCleared: false,
  openWorkItems: 0,
  blockers: [why],
});

const emptyDocuments = (why: string): DocumentsSection => ({
  buyersGuide: { present: false, source: why, documentId: null },
  windowSticker: { present: false, source: why, documentId: null },
  addendum: { present: false, documentId: null },
  oemSticker: { present: false, url: null },
  staleFlags: [],
  counts: { generated: 0, signed: 0, stale: 0 },
});

const emptyCompliance = (why: string): ComplianceSection => ({
  recall: deriveRecallView(null),
  recallStatus: emptyField<string>("recall_status", why),
  openRecallCount: emptyField<number>("open_recall_count", why),
  doNotDrive: false,
  titleStatus: emptyField<string>("title_status", why),
  titleVerification: emptyField<string>("title_verification", why),
  ctMvpStatus: null,
  blockers: [why],
});

const emptyMedia = (): MediaSection => ({ heroImageUrl: null, photoCount: 0, photoHosts: [] });

const emptyCustomer = (): CustomerSection => ({
  passportSlug: null,
  passportPublishedAt: null,
  scans: 0,
  engagements: 0,
  leads: 0,
  lastActivityAt: null,
});

const emptyPublishing = (): PublishingSection => ({
  descriptionVersionId: null,
  descriptionUpdatedAt: null,
  channelsPublished: [],
  channelsBlocked: [],
  autofilmEligible: false,
});

// ── Failure containment ─────────────────────────────────────────────

const attempt = <T>(
  label: string,
  warnings: string[],
  run: () => T,
  fallback: (why: string) => T,
): T => {
  try {
    return run();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const why = `${label} could not be assembled (${detail}); the section is reported empty.`;
    warnings.push(why);
    return fallback(why);
  }
};

// ── Conflicts ───────────────────────────────────────────────────────

/**
 * `resolveField` records a caller-declared expected disagreement by appending
 * a sentence to `reason` and nothing else — there is no structured flag on
 * ResolvedField — so this marker is the only carrier the projection has. It is
 * matched against the exact literal the resolver writes.
 */
const EXPECTED_MARKER = "Disagreement is expected: ";

const expectedBecause = (field: ResolvedField<unknown>): string | null => {
  const at = field.reason.indexOf(EXPECTED_MARKER);
  return at === -1 ? null : field.reason.slice(at + EXPECTED_MARKER.length);
};

interface SectionFields {
  section: string;
  fields: Array<ResolvedField<unknown>>;
}

const resolvedSections = (parts: {
  identity: IdentitySection;
  dealerState: DealerStateSection;
  pricing: PricingSection;
  publicAdvertisement: PublicAdvertisementSection;
  marketIntelligence: MarketIntelligenceSection;
  compliance: ComplianceSection;
}): SectionFields[] => [
  {
    section: "identity",
    fields: [
      parts.identity.vin, parts.identity.year, parts.identity.make, parts.identity.model,
      parts.identity.trim, parts.identity.bodyStyle, parts.identity.exteriorColor,
      parts.identity.interiorColor, parts.identity.engine, parts.identity.drivetrain,
      parts.identity.transmission, parts.identity.fuelType,
    ],
  },
  {
    section: "dealerState",
    fields: [
      parts.dealerState.stock, parts.dealerState.mileage, parts.dealerState.condition,
      parts.dealerState.certified, parts.dealerState.inTransit, parts.dealerState.listingStatus,
      parts.dealerState.daysInInventory,
    ],
  },
  {
    section: "pricing",
    fields: [
      parts.pricing.advertisedRetail, parts.pricing.sellingPrice, parts.pricing.docFee,
      parts.pricing.dealerDiscount, parts.pricing.msrpFactory, parts.pricing.msrpFeed,
    ],
  },
  {
    section: "publicAdvertisement",
    fields: [
      parts.publicAdvertisement.observedPrice, parts.publicAdvertisement.observedBeforeDocFee,
      parts.publicAdvertisement.observedDocFee, parts.publicAdvertisement.observedDiscount,
    ],
  },
  {
    section: "marketIntelligence",
    fields: [
      parts.marketIntelligence.marketValue, parts.marketIntelligence.daysOnMarket,
      parts.marketIntelligence.comparableCount, parts.marketIntelligence.marketDaysSupply,
      parts.marketIntelligence.priceChangePercent, parts.marketIntelligence.referencePrice,
    ],
  },
  {
    section: "compliance",
    fields: [
      parts.compliance.recallStatus, parts.compliance.openRecallCount,
      parts.compliance.titleStatus, parts.compliance.titleVerification,
    ],
  },
];

const collectConflicts = (sections: SectionFields[]): ConflictEntry[] => {
  const out: ConflictEntry[] = [];
  for (const { fields } of sections) {
    for (const field of fields) {
      const winner = field.chosen;
      if (!winner) continue;
      if (!field.disputed && !field.disagreeing.length) continue;
      const because = expectedBecause(field);
      for (const loser of field.disagreeing) {
        out.push({
          field: field.key,
          winner: { value: winner.value, provider: winner.provider, origin: winner.origin },
          loser: { value: loser.value, provider: loser.provider, origin: loser.origin },
          disputed: field.disputed,
          expectedBecause: because,
        });
      }
    }
  }
  return out;
};

const collectMissing = (sources: VehicleFileSources, sections: SectionFields[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (line: string) => {
    if (seen.has(line)) return;
    seen.add(line);
    out.push(line);
  };
  for (const line of sources.missing) push(line);
  for (const { section, fields } of sections) {
    if (!fields.length) continue;
    if (fields.every((f) => f.candidates.length === 0)) {
      push(`${section}: no source supplied a candidate for any field in this section.`);
    }
  }
  return out;
};

// ── The projection ──────────────────────────────────────────────────

export function buildVehicleFileReadModel(
  sources: VehicleFileSources,
  opts: BuildReadModelOptions = {},
): VehicleFileReadModel {
  const now = opts.now ?? Date.now();
  const warnings: string[] = [];
  const listing = sources.listing;

  if (!listing) {
    warnings.push(
      "No vehicle_listings row was read for this vehicle; every section is resolved from the "
      + "remaining stores only.",
    );
  }

  const identity = attempt("identity", warnings, () => buildIdentity(sources, { now }), emptyIdentity);
  const dealerState = attempt("dealerState", warnings, () => buildDealerState(sources, { now }), emptyDealerState);
  const pricing = attempt("pricing", warnings, () => buildPricing(sources, { now }), emptyPricing);
  const publicAdvertisement = attempt(
    "publicAdvertisement",
    warnings,
    () => buildPublicAdvertisement(sources, { now }),
    emptyPublicAdvertisement,
  );
  const marketIntelligence = attempt(
    "marketIntelligence",
    warnings,
    () => buildMarketIntelligence(sources, { now }),
    emptyMarket,
  );
  const listingLifecycle = attempt("listingLifecycle", warnings, () => buildListingLifecycle(sources), emptyLifecycle);
  const getReady = attempt("getReady", warnings, () => buildGetReady(sources), emptyGetReady);
  const documents = attempt("documents", warnings, () => buildDocuments(sources), emptyDocuments);
  const compliance = attempt("compliance", warnings, () => buildCompliance(sources, { now }), emptyCompliance);
  const media = attempt("media", warnings, () => buildMedia(sources), emptyMedia);
  const customer = attempt("customer", warnings, () => buildCustomer(sources), emptyCustomer);

  // AutoFilm eligibility (§41) is a claim about the resolved price, so
  // `buildPublishing` is given the pricing section rather than resolving a
  // second price of its own; without it the section fails closed.
  const publishing = attempt(
    "publishing",
    warnings,
    () => buildPublishing(sources, { pricing }),
    emptyPublishing,
  );
  const sourceHealth = attempt("sourceHealth", warnings, () => buildSourceHealth(sources, { now }), () => []);
  const recentChanges = attempt("recentChanges", warnings, () => buildTimeline(sources), () => []);

  const sections = resolvedSections({
    identity, dealerState, pricing, publicAdvertisement, marketIntelligence, compliance,
  });
  const conflicts = attempt("conflicts", warnings, () => collectConflicts(sections), () => []);
  const missingSources = attempt("missingSources", warnings, () => collectMissing(sources, sections), () => [
    ...sources.missing,
  ]);

  const rowTenant = str(listing?.tenant_id);
  if (rowTenant && sources.tenantId && rowTenant !== sources.tenantId) {
    warnings.push(
      `This listing belongs to tenant ${rowTenant}, not the tenant the bundle was fetched for `
      + `(${sources.tenantId}); the model reports the row's own tenant.`,
    );
  }

  const vehicleId = str(listing?.id);
  if (!vehicleId) {
    warnings.push("No vehicle id: the model cannot be keyed back to a vehicle_listings row.");
  }

  const storedVin = str(listing?.vin);
  const resolvedVin = identity.vin.value;
  if (!resolvedVin && storedVin) {
    warnings.push(
      `vehicle_listings.vin "${storedVin}" does not pass the ISO 3779 shape and check-digit test, so no `
      + "candidate was usable; the model carries the stored string so the vehicle can still be reported.",
    );
  }
  if (!resolvedVin && !storedVin) {
    warnings.push("No VIN on any source for this vehicle.");
  }

  const base: AttentionInput = {
    version: 1,
    tenantId: rowTenant ?? sources.tenantId,
    vehicleId: vehicleId ?? "",
    vin: resolvedVin ?? storedVin?.toUpperCase() ?? "",
    generatedAt: new Date(now).toISOString(),
    identity,
    dealerState,
    pricing,
    publicAdvertisement,
    marketIntelligence,
    listingLifecycle,
    getReady,
    documents,
    compliance,
    media,
    customer,
    publishing,
    sourceHealth,
    conflicts,
    recentChanges,
    missingSources,
    warnings,
  };

  const attention = attempt<Attention>(
    "attention",
    warnings,
    () => deriveAttention(base),
    () => ({ blocker: null, nextAction: null, currentOwner: null }),
  );

  return { ...base, ...attention };
}
