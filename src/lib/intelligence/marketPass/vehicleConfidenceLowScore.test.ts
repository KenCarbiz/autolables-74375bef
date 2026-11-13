import { describe, it, expect, vi } from "vitest";
import { buildVehicleConfidence } from "./vehicleConfidence";
import { buildDataConfidence } from "../dataConfidence";
import { exactIdentity, fullDocs, inspectedCondition, knownProvenance, recall, verifiedTitle } from "../scoreFixtures.test";

vi.mock("../vehicleScore", async (orig) => {
  const mod = await orig<typeof import("../vehicleScore")>();
  return { ...mod, buildVehicleScore: (...a: Parameters<typeof mod.buildVehicleScore>) => ({ ...mod.buildVehicleScore(...a), score: 41, publication: "eligible" as const }) };
});

const base = () => {
  const m = { vehicleType: "used" as const, identity: exactIdentity(), titleOdometer: verifiedTitle(), condition: inspectedCondition(), provenance: knownProvenance(), recall: recall(), documentation: fullDocs() };
  return { ...m, feedFlags: { titleBrand: null, carfaxCleanTitleFalse: false, accidentCount: null }, dataConfidence: buildDataConfidence(m), evidence: [] };
};

describe("decision 9: a low score is not an adverse finding", () => {
  it("score 41 with no adverse finding is Review recommended, segment 1", () => {
    const r = buildVehicleConfidence(base());
    expect(r.state).toBe("assessed");
    expect(r.internal.vehicleScore).toBe(41);
    expect(r.segmentIndex).toBe(1);
    expect(r.label).toBe("Review recommended");
  });

  it("the same low score with an actual adverse finding is still Concerns reported", () => {
    const r = buildVehicleConfidence({ ...base(), feedFlags: { titleBrand: "Salvage", carfaxCleanTitleFalse: false, accidentCount: null } });
    expect(r.state).toBe("adverse");
    expect(r.segmentIndex).toBe(0);
    expect(r.label).toBe("Concerns reported");
  });
});
