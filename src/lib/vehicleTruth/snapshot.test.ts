import { describe, expect, it } from "vitest";
import {
  buildVehicleSnapshot,
  carryForward,
  decideSnapshotVersion,
  emptySnapshot,
  factStatus,
  SNAPSHOT_FIELDS,
  type VehicleTruthSnapshot,
} from "./snapshot";
import type { CandidateFact } from "./precedence";

const VIN = "3PCAJ5BB1PF113139";

const fact = (
  factKey: string,
  value: unknown,
  source: CandidateFact["source"],
  confidence: CandidateFact["confidence"] = "VERIFIED",
  sourceTimestamp?: string,
): CandidateFact => ({ factKey, value, source, confidence, sourceTimestamp });

const full = (): CandidateFact[] => [
  fact("condition", "used", "dealer_confirmed"),
  fact("mileage", 13127, "dealer_confirmed"),
  fact("manufacturer", "Nissan Motor Corporation", "neovin"),
  fact("make", "INFINITI", "neovin"),
  fact("model_year", 2023, "neovin"),
  fact("model", "QX50", "neovin"),
  fact("trim", "SENSORY AWD", "neovin"),
  fact("base_msrp", 47595, "neovin"),
  fact("destination_charge", 1195, "neovin"),
  fact("total_msrp", 52785, "neovin"),
  fact("standard_equipment", ["Navigation System", "Bose Audio"], "neovin"),
  fact("advertised_price", 41995, "dealer_confirmed"),
];

describe("snapshot shape", () => {
  it("keeps every fact key mapped to a real snapshot path", () => {
    const blank = emptySnapshot(VIN) as unknown as Record<string, unknown>;
    for (const path of Object.values(SNAPSHOT_FIELDS)) {
      const value = path.split(".").reduce<unknown>(
        (acc, part) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[part] : undefined),
        blank,
      );
      expect(value === null || Array.isArray(value), path).toBe(true);
    }
  });

  it("normalizes the VIN", () => {
    expect(emptySnapshot(" 3pcaj5bb1pf113139 ").vin).toBe(VIN);
  });

  it("leaves an unanswered fact null rather than guessing it", () => {
    const { snapshot } = buildVehicleSnapshot(VIN, [fact("make", "INFINITI", "neovin")]);
    expect(snapshot.identity.make).toBe("INFINITI");
    expect(snapshot.identity.trim).toBeNull();
    expect(snapshot.pricing.baseMsrp).toBeNull();
    expect(snapshot.equipment.factoryOptions).toEqual([]);
  });

  it("ignores a fact key that has no snapshot home", () => {
    const { snapshot, facts } = buildVehicleSnapshot(VIN, [
      fact("some_unmapped_field", "x", "neovin"),
      fact("make", "INFINITI", "neovin"),
    ]);
    expect(facts.some_unmapped_field).toBeUndefined();
    expect(snapshot.identity.make).toBe("INFINITI");
  });
});

describe("building from competing candidates", () => {
  it("resolves each fact through precedence, not insertion order", () => {
    const { snapshot } = buildVehicleSnapshot(VIN, [
      fact("trim", "LUXE", "marketcheck", "HIGH"),
      fact("trim", "SENSORY AWD", "neovin"),
    ]);
    expect(snapshot.identity.trim).toBe("SENSORY AWD");
  });

  it("records the lineage of every resolved fact", () => {
    const { facts } = buildVehicleSnapshot(VIN, [
      { ...fact("make", "INFINITI", "neovin", "VERIFIED", "2026-07-01T00:00:00Z"), sourceRecordId: "rec-1" },
    ]);
    expect(facts.make.source).toBe("neovin");
    expect(facts.make.confidence).toBe("VERIFIED");
    expect(facts.make.status).toBe("verified");
    expect(facts.make.observedAt).toBe("2026-07-01T00:00:00Z");
    expect(facts.make.evidence.sourceRecordId).toBe("rec-1");
  });

  it("never lets an inferred value become copy or a verified fact", () => {
    const { facts, snapshot } = buildVehicleSnapshot(VIN, [
      fact("trim", "SENSORY AWD", "ai_inference", "VERIFIED"),
    ]);
    expect(snapshot.identity.trim).toBe("SENSORY AWD");
    expect(facts.trim.confidence).toBe("LOW");
    expect(facts.trim.status).toBe("inferred");
    expect(facts.trim.usableInCopy).toBe(false);
  });

  it("raises a blocking conflict when two verifying sources disagree on a manufacturer fact", () => {
    const { conflicts, facts } = buildVehicleSnapshot(VIN, [
      fact("base_msrp", 47595, "neovin"),
      fact("base_msrp", 45900, "dealer_confirmed"),
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].factKey).toBe("base_msrp");
    expect(conflicts[0].authority).toBe("manufacturer");
    expect(conflicts[0].blocksGeneration).toBe(true);
    expect(conflicts[0].candidates).toHaveLength(2);
    expect(facts.base_msrp.status).toBe("disputed");
    expect(facts.base_msrp.usableInCopy).toBe(false);
  });

  it("does not block generation on a dealer-controlled disagreement", () => {
    const { conflicts } = buildVehicleSnapshot(VIN, [
      fact("mileage", 13127, "dealer_confirmed"),
      fact("mileage", 13500, "neovin"),
    ]);
    expect(conflicts[0].blocksGeneration).toBe(false);
  });

  it("raises no conflict when a weak source is the only dissenter", () => {
    const { conflicts } = buildVehicleSnapshot(VIN, [
      fact("trim", "SENSORY AWD", "neovin"),
      fact("trim", "LUXE", "ai_inference", "VERIFIED"),
    ]);
    expect(conflicts).toEqual([]);
  });

  it("reports which sources contributed", () => {
    const { sourceKinds } = buildVehicleSnapshot(VIN, full());
    expect(sourceKinds.sort()).toEqual(["dealer_confirmed", "neovin"]);
  });

  it("is deterministic for the same candidates in any order", () => {
    const a = buildVehicleSnapshot(VIN, full());
    const b = buildVehicleSnapshot(VIN, [...full()].reverse());
    expect(a.checksum).toBe(b.checksum);
    expect(a.checksum).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("fact status mapping", () => {
  it("marks a dispute regardless of source strength", () => {
    expect(factStatus("oem_authorized", "VERIFIED", true)).toBe("disputed");
  });

  it("distinguishes a dealer statement from a verified fact", () => {
    expect(factStatus("dealer_confirmed", "VERIFIED", false)).toBe("dealer_entered");
    expect(factStatus("neovin", "VERIFIED", false)).toBe("verified");
    expect(factStatus("marketcheck", "HIGH", false)).toBe("feed_provided");
    expect(factStatus("vin_decode", "MEDIUM", false)).toBe("calculated");
  });
});

describe("versioning decisions", () => {
  const built = (candidates: CandidateFact[]): VehicleTruthSnapshot =>
    buildVehicleSnapshot(VIN, candidates).snapshot;

  it("creates the first snapshot", () => {
    const d = decideSnapshotVersion(null, built(full()));
    expect(d.createVersion).toBe(true);
    expect(d.nextVersion).toBe(1);
    expect(d.reason).toBe("first_snapshot");
  });

  it("costs nothing when a nightly refresh returns the same vehicle", () => {
    const current = { snapshot: built(full()), version: 3 };
    const d = decideSnapshotVersion(current, built(full()));
    expect(d.createVersion).toBe(false);
    expect(d.nextVersion).toBe(3);
    expect(d.reason).toBe("unchanged");
    expect(d.affectedFamilies).toEqual([]);
  });

  it("mints a version and routes an MSRP correction to the OEM sticker only", () => {
    const current = { snapshot: built(full()), version: 3 };
    const next = built([...full().filter((f) => f.factKey !== "base_msrp"), fact("base_msrp", 47995, "neovin")]);
    const d = decideSnapshotVersion(current, next);
    expect(d.createVersion).toBe(true);
    expect(d.nextVersion).toBe(4);
    expect(d.affectedFamilies).toEqual(["oem_window_sticker_reproduction"]);
  });

  it("does not erase a held fact when a provider stops answering", () => {
    const current = { snapshot: built(full()), version: 2 };
    const silent = built(full().filter((f) => f.factKey !== "trim"));
    expect(silent.identity.trim).toBeNull();

    const d = decideSnapshotVersion(current, silent);
    expect(d.createVersion).toBe(false);
    expect(carryForward(current.snapshot, silent).identity.trim).toBe("SENSORY AWD");
  });

  it("carries a held equipment list through an empty answer", () => {
    const current = { snapshot: built(full()), version: 1 };
    const silent = built(full().filter((f) => f.factKey !== "standard_equipment"));
    expect(carryForward(current.snapshot, silent).equipment.standard)
      .toEqual(["Navigation System", "Bose Audio"]);
  });

  it("still accepts a real correction over a held value", () => {
    const current = { snapshot: built(full()), version: 1 };
    const corrected = built([...full().filter((f) => f.factKey !== "trim"), fact("trim", "LUXE AWD", "neovin")]);
    const d = decideSnapshotVersion(current, corrected);
    expect(d.createVersion).toBe(true);
    expect(d.changes.map((c) => c.field)).toEqual(["identity.trim"]);
  });

  it("keeps a dealer price change away from the manufacturer document", () => {
    const current = { snapshot: built(full()), version: 1 };
    const next = built([
      ...full().filter((f) => f.factKey !== "advertised_price"),
      fact("advertised_price", 40995, "dealer_confirmed"),
    ]);
    const d = decideSnapshotVersion(current, next);
    expect(d.createVersion).toBe(true);
    expect(d.affectedFamilies).not.toContain("oem_window_sticker_reproduction");
  });
});
