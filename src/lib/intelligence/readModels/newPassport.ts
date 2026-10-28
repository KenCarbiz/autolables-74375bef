// ── New Passport 2.0 read model ────────────────────────────────────────────
//
// A new vehicle gets verified states, never a 0 to 100 quality score: the
// factory decode, the MSRP breakdown, the dealer's offer against it, the
// incentives on the table, availability and the recall answer. Every block
// comes from the listing row through listingFacts; the builder adds the
// factory-verified Fact, which hangs on exact identity and nothing else.

import {
  makeFact, unknownFact,
  type Fact, type FreshnessSummary, type IdentitySummary, type IncentiveSummary, type NewPassportReadModel,
  type RecallSummary, type VehicleMedia,
} from "../contracts.ts";
import { listingFacts, type ListingRowLike } from "./listingFacts.ts";
import { assertPublishableShape, freshnessEntry, isNewCondition, ReadModelInputError } from "./shared.ts";

export interface NewPassportInputs {
  row: ListingRowLike;
  nowMs: number;
  /** Defaults derived from the row; pass one to override, for example from a fresher check. */
  recall?: RecallSummary;
  /** Incentives are not stored on the row; the oem_incentives_v2 surface supplies them once it exists. */
  incentives?: IncentiveSummary[];
  identity?: IdentitySummary;
  media?: VehicleMedia;
}

export function factoryVerifiedFact(vehicle: IdentitySummary, nowMs: number): Fact<boolean> {
  if (vehicle.factoryVerified) {
    return makeFact(true, {
      state: "verified", authority: "manufacturer", source: vehicle.decodeSource, confidence: "VERIFIED",
      checkedAt: vehicle.freshness.checkedAt, ttlDays: vehicle.freshness.ttlDays, nowMs,
      evidence: [{ kind: "factory_build_record", id: null, label: "Factory build record for this VIN", visibility: "public" }],
      reasons: [`identity_${vehicle.matchLevel.toLowerCase()}`],
    });
  }
  if (vehicle.matchLevel === "GENERIC_CANDIDATE") {
    return makeFact(false, {
      state: "warning", authority: "manufacturer", source: vehicle.decodeSource, confidence: "LOW",
      checkedAt: vehicle.freshness.checkedAt, ttlDays: vehicle.freshness.ttlDays, nowMs,
      reasons: ["generic_candidate_decode_describes_vehicles_like_this_one"],
    });
  }
  return unknownFact<boolean>(vehicle.matchLevel === "UNKNOWN" ? "identity_unknown" : "no_factory_decode_on_record");
}

export function buildNewPassportReadModel(input: NewPassportInputs): NewPassportReadModel {
  if (!isNewCondition(input.row.condition)) {
    throw new ReadModelInputError("vehicle_type_mismatch", "only a vehicle whose condition is new takes the new passport read model");
  }
  const facts = listingFacts(input.row, input.nowMs);
  const vehicle = input.identity ?? facts.identity;
  const recall = input.recall ?? facts.recall;
  const incentives = input.incentives ?? facts.incentives;
  const factoryVerified = factoryVerifiedFact(vehicle, input.nowMs);
  const newestIncentive = incentives
    .map((i) => i.freshness)
    .sort((a, b) => (b.checkedAt ?? "").localeCompare(a.checkedAt ?? ""))[0]
    ?? { checkedAt: null, observedAt: null, ttlDays: null, staleAt: null, state: "unknown" as const };

  const freshness: FreshnessSummary[] = [
    freshnessEntry({ key: "factory_identity", label: "Factory identity", freshness: vehicle.freshness, source: vehicle.decodeSource === "none" ? null : vehicle.decodeSource, factState: factoryVerified.state }),
    freshnessEntry({ key: "msrp", label: "Factory MSRP", freshness: facts.msrp.freshness, source: facts.msrp.source === "none" ? null : facts.msrp.source, factState: facts.msrp.state }),
    freshnessEntry({ key: "dealer_offer", label: "Dealer offer", freshness: facts.dealerOffer.freshness, source: facts.dealerOffer.channel, factState: facts.dealerOffer.state }),
    freshnessEntry({ key: "availability", label: "Availability", freshness: facts.availability.freshness, source: facts.availability.lastSeenInFeedAt ? "feed" : null, factState: facts.availability.state === "unknown" ? "unknown" : "verified" }),
    freshnessEntry({ key: "warranty", label: "Warranty", freshness: facts.warranty.freshness, source: facts.warranty.source, factState: facts.warranty.state }),
    freshnessEntry({ key: "incentives", label: "Incentives", freshness: newestIncentive, source: incentives[0]?.source ?? null, factState: incentives.length ? null : "unknown" }),
    freshnessEntry({ key: "recall", label: "Recall", freshness: recall.freshness, source: null, factState: recall.publicState }),
  ];

  const model: NewPassportReadModel = {
    passportVersion: "2.0",
    vehicleType: "new",
    vehicle,
    media: input.media ?? facts.media,
    factoryVerified,
    configuration: vehicle,
    msrp: facts.msrp,
    dealerOffer: facts.dealerOffer,
    incentives,
    priceIntegrity: facts.priceIntegrity,
    availability: facts.availability,
    warranty: facts.warranty,
    recall,
    freshness,
  };
  assertPublishableShape(model, "NewPassportReadModel");
  return model;
}
