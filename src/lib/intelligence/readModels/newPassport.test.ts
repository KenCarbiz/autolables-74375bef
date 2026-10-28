import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildNewPassportReadModel, factoryVerifiedFact, type NewPassportInputs } from "./newPassport";
import { ReadModelInputError } from "./shared";
import { identityFromRow, listingFacts, type ListingRowLike } from "./listingFacts";
import { containsForbiddenKey, isNewPassport, resolveFreshness, type IncentiveSummary, type NewPassportReadModel, type RecallSummary } from "../contracts";
import { epoch, exactSheet, iso, newRow, NOW, usedRow } from "./__fixtures__/rows";

const attrs = (row: ListingRowLike): Record<string, unknown> => row.mc_attributes as Record<string, unknown>;
const withAttrs = (patch: Record<string, unknown>): ListingRowLike => {
  const row = newRow();
  return { ...row, mc_attributes: { ...attrs(row), ...patch } };
};

const inputs = (patch: Partial<NewPassportInputs> = {}): NewPassportInputs => ({ row: newRow(), nowMs: NOW, ...patch });

const example = JSON.parse(readFileSync(join(__dirname, "__fixtures__", "new_passport_example.json"), "utf8")) as Record<string, Record<string, unknown>>;

describe("the new passport read model", () => {
  it("builds verified states from the row and never a quality score", () => {
    const m = buildNewPassportReadModel(inputs());
    expect(m.passportVersion).toBe("2.0");
    expect(m.vehicleType).toBe("new");
    expect(isNewPassport(m)).toBe(true);
    expect("vehicleScore" in m).toBe(false);
    expect(m.factoryVerified).toMatchObject({ value: true, state: "verified", authority: "manufacturer", source: "neovin", confidence: "VERIFIED" });
    expect(m.factoryVerified.evidence).toHaveLength(1);
    expect(m.configuration.matchLevel).toBe("EXACT_VIN");
    expect(m.configuration).toBe(m.vehicle);
    expect(m.msrp).toMatchObject({ baseMsrp: 66150, installedOptionsMsrp: 3420, destination: 1395, configuredMsrp: 70965, source: "neovin", state: "verified" });
    expect(m.dealerOffer).toMatchObject({ advertisedPrice: 68995, feeBasis: "excluded", fees: 895, channel: "feed", state: "verified" });
    expect(m.priceIntegrity.state).toBe("consistent");
    expect(m.availability).toMatchObject({ state: "available", inTransit: false });
    expect(m.warranty.terms).toHaveLength(2);
    expect(m.warranty.remainingCoverage).toBe("not_calculated_without_in_service_date");
    expect(m.incentives).toEqual([]);
    expect(m.recall.vinState).toBe("NO_OPEN");
    expect(m.media.photoCount).toBe(1);
  });

  it("covers every block of the new example and carries its values", () => {
    const m = buildNewPassportReadModel(inputs());
    const blocks: Record<string, unknown> = {
      vehicle: m.vehicle, factory_verified: m.factoryVerified, configuration: m.msrp, dealer_offer: m.dealerOffer,
      incentives: m.incentives, warranty: m.warranty, recall: m.recall,
    };
    for (const key of Object.keys(example).filter((k) => k !== "meta")) expect(blocks[key], key).toBeDefined();

    expect(m.vehicle).toMatchObject({
      vin: example.vehicle.vin, year: example.vehicle.year, make: example.vehicle.make, model: example.vehicle.model,
      trim: example.vehicle.trim, drivetrain: example.vehicle.drivetrain,
    });
    expect(m.availability.state).toBe(example.vehicle.vehicle_status);
    expect(m.availability.inTransit).toBe(example.vehicle.in_transit);
    expect(m.factoryVerified.state).toBe(example.factory_verified.status);
    expect(m.vehicle.decodeSource).toBe(String(example.factory_verified.decode_source).toLowerCase());
    expect(m.msrp).toMatchObject({
      baseMsrp: example.configuration.base_msrp, installedOptionsMsrp: example.configuration.installed_options_msrp,
      destination: example.configuration.destination, configuredMsrp: example.configuration.configured_msrp,
    });
    expect(m.msrp.packages.map((p) => ({ name: p.name, msrp: p.msrp }))).toEqual(example.configuration.packages);
    expect(m.dealerOffer.advertisedPrice).toBe(example.dealer_offer.advertised_price);
    expect(m.dealerOffer.fees).toBe(example.dealer_offer.fees);
    expect(m.dealerOffer.feeBasis).toBe(example.dealer_offer.price_includes_fees ? "included" : "excluded");
    expect(m.priceIntegrity.state).toBe(example.dealer_offer.price_integrity);
    expect(m.warranty.remainingCoverage).toBe(example.warranty.remaining_coverage);
    expect(m.warranty.basis).toBe("original_factory");
    expect(m.recall.vinState).toBe("NO_OPEN");
    expect(m.recall.checkedAt).toBe(iso(7));
    // The example shows an incentive the row cannot supply; the model carries
    // the list shape and nothing invented until the incentives surface exists.
    expect(Array.isArray(m.incentives)).toBe(true);
    expect(m.incentives).toHaveLength(0);
  });

  it("lists one freshness row per dated block", () => {
    const m = buildNewPassportReadModel(inputs());
    expect(m.freshness.map((f) => f.key)).toEqual(["factory_identity", "msrp", "dealer_offer", "availability", "warranty", "incentives", "recall"]);
    const byKey = Object.fromEntries(m.freshness.map((f) => [f.key, f]));
    expect(byKey.factory_identity.state).toBe("verified");
    expect(byKey.msrp.source).toBe("neovin");
    expect(byKey.dealer_offer.source).toBe("feed");
    expect(byKey.availability.state).toBe("verified");
    expect(byKey.incentives.state).toBe("unknown");
    expect(byKey.recall.state).toBe("verified");
  });

  it("goes stale and unknown together when the feed has not seen the vehicle", () => {
    const m = buildNewPassportReadModel(inputs({ row: { ...newRow(), mc_raw: { last_seen_at: epoch(6), in_transit: false, vehicle_status: "available" } } }));
    expect(m.availability.state).toBe("unknown");
    expect(m.dealerOffer.state).toBe("stale");
    const byKey = Object.fromEntries(m.freshness.map((f) => [f.key, f.state]));
    expect(byKey.availability).toBe("stale");
    expect(byKey.dealer_offer).toBe("stale");
  });

  it("never claims factory verification or exact MSRP from a generic decode", () => {
    const m = buildNewPassportReadModel(inputs({ row: withAttrs({ build_sheet: { ...exactSheet(), generic: true } }) }));
    expect(m.factoryVerified).toMatchObject({ value: false, state: "warning", confidence: "LOW" });
    expect(m.factoryVerified.reasons[0]).toContain("generic_candidate");
    expect(m.configuration.matchLevel).toBe("GENERIC_CANDIDATE");
    expect(m.configuration.version).toBeNull();
    expect(m.msrp).toMatchObject({ baseMsrp: null, installedOptionsMsrp: null, destination: null, configuredMsrp: 70965, source: "feed", state: "warning" });
    expect(m.msrp.packages).toEqual([]);
    expect(m.freshness.find((f) => f.key === "factory_identity")?.state).toBe("warning");
  });

  it("is unknown, with a reason, when no decode is on record", () => {
    const row = newRow();
    const mc = { ...attrs(row) };
    delete mc.build_sheet;
    const none = factoryVerifiedFact(identityFromRow({ ...row, mc_attributes: mc }, NOW), NOW);
    expect(none).toMatchObject({ value: null, state: "unknown", confidence: "UNVERIFIED", reasons: ["no_factory_decode_on_record"] });
    const unknown = factoryVerifiedFact(identityFromRow({ vin: "EXAMPLEVIN0000004", condition: "new" }, NOW), NOW);
    expect(unknown.reasons).toEqual(["identity_unknown"]);
  });

  it("carries supplied incentives and a supplied recall verbatim", () => {
    const incentive: IncentiveSummary = {
      title: "Retail Customer Cash", type: "cash", amount: 1500, apr: null, termMonths: null, validThrough: "2026-11-02",
      eligibility: null, source: "oem_incentives", freshness: resolveFreshness({ checkedAt: iso(0.2), ttlDays: 1, nowMs: NOW }),
    };
    const recall: RecallSummary = { ...listingFacts(newRow(), NOW).recall, publicStatement: "override" };
    const m = buildNewPassportReadModel(inputs({ incentives: [incentive], recall }));
    expect(m.incentives).toEqual([incentive]);
    expect(m.recall.publicStatement).toBe("override");
    const row = m.freshness.find((f) => f.key === "incentives");
    expect(row?.state).toBe("verified");
    expect(row?.source).toBe("oem_incentives");
  });

  it("refuses a used vehicle and a block that carries raw provider material", () => {
    try {
      buildNewPassportReadModel(inputs({ row: usedRow() }));
      expect.unreachable("a used row must be refused");
    } catch (e) {
      expect(e).toBeInstanceOf(ReadModelInputError);
      expect((e as ReadModelInputError).code).toBe("vehicle_type_mismatch");
    }
    const tainted = { ...listingFacts(newRow(), NOW).recall, raw_payload: {} } as unknown as RecallSummary;
    try {
      buildNewPassportReadModel(inputs({ recall: tainted }));
      expect.unreachable("a forbidden key must be refused");
    } catch (e) {
      expect((e as ReadModelInputError).code).toBe("forbidden_key");
    }
  });

  it("is a plain serializable document with no raw provider material", () => {
    const m = buildNewPassportReadModel(inputs());
    expect(containsForbiddenKey(m)).toBeNull();
    const roundTrip = JSON.parse(JSON.stringify(m)) as NewPassportReadModel;
    expect(roundTrip).toEqual(m);
    expect(JSON.stringify(m)).not.toContain("mc_raw");
  });
});
