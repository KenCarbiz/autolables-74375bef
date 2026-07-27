import { describe, expect, it } from "vitest";
import {
  computePipelineState,
  computeVehiclePipeline,
  familiesInvalidatedBy,
  isProduced,
  type PipelineInput,
} from "./pipeline";
import type { DocumentFamilyId } from "../documents/families";

const OEM: DocumentFamilyId = "oem_window_sticker_reproduction";
const GUIDE: DocumentFamilyId = "ftc_buyers_guide";
const USED_STICKER: DocumentFamilyId = "used_vehicle_window_sticker";
const NEW_ADD: DocumentFamilyId = "new_vehicle_addendum";

const state = (over: Partial<PipelineInput> = {}) =>
  computePipelineState({
    family: OEM,
    condition: "used",
    currentSnapshotVersion: 3,
    hasRequiredInputs: true,
    ...over,
  });

describe("applicability gates the ledger", () => {
  it("does not present a new-vehicle document as work on a used vehicle", () => {
    const s = state({ family: NEW_ADD, condition: "used" });
    expect(s.stage).toBe("not_applicable");
    expect(s.applicable).toBe(false);
    expect(s.needsAttention).toBe(false);
  });

  it("treats a Buyers Guide as required on a used vehicle and absent on a new one", () => {
    expect(state({ family: GUIDE, condition: "used" }).required).toBe(true);
    expect(state({ family: GUIDE, condition: "new" }).applicable).toBe(false);
  });

  it("flags an unresolved condition for a person rather than guessing", () => {
    const s = state({ condition: null });
    expect(s.stage).toBe("not_applicable");
    expect(s.needsAttention).toBe(true);
    expect(s.reason).toMatch(/condition is unresolved/i);
  });
});

describe("readiness", () => {
  it("waits when no snapshot has been resolved", () => {
    const s = state({ currentSnapshotVersion: null });
    expect(s.stage).toBe("awaiting_data");
    expect(s.nextAction).toBe("await_data");
  });

  it("waits when the family's own inputs are missing", () => {
    const s = state({ hasRequiredInputs: false });
    expect(s.stage).toBe("awaiting_data");
    expect(s.reason).toMatch(/source data/i);
  });

  it("is ready once a snapshot and the inputs exist", () => {
    expect(state().stage).toBe("ready");
    expect(state().nextAction).toBe("generate");
  });
});

describe("blocking conflicts", () => {
  it("stops the manufacturer document on a disputed manufacturer fact", () => {
    const s = state({ blockingConflicts: 1 });
    expect(s.stage).toBe("blocked");
    expect(s.nextAction).toBe("resolve_conflict");
    expect(s.needsAttention).toBe(true);
  });

  it("outranks readiness, so a disputed vehicle is never quietly generated", () => {
    expect(state({ blockingConflicts: 2, hasRequiredInputs: true }).stage).toBe("blocked");
  });

  it("does not block a required federal disclosure on a manufacturer dispute", () => {
    // The Buyers Guide says nothing about MSRP; a disputed MSRP must not
    // stop a legally required document from being produced.
    const pipeline = computeVehiclePipeline({
      condition: "used", currentSnapshotVersion: 3, blockingConflicts: 1,
      families: { [GUIDE]: { hasRequiredInputs: true } },
    });
    const guide = pipeline.states.find((s) => s.family === GUIDE)!;
    const oem = pipeline.states.find((s) => s.family === OEM)!;
    expect(oem.stage).toBe("blocked");
    expect(guide.stage).not.toBe("blocked");
  });
});

describe("staleness", () => {
  it("marks a produced document stale only when its own family moved", () => {
    const stale = state({
      documentStatus: "published", generatedFromVersion: 2,
      affectedSinceGenerated: [OEM],
    });
    expect(stale.stale).toBe(true);
    expect(stale.nextAction).toBe("regenerate");

    const untouched = state({
      documentStatus: "published", generatedFromVersion: 2,
      affectedSinceGenerated: [GUIDE],
    });
    expect(untouched.stale).toBe(false);
    expect(untouched.nextAction).toBe("none");
  });

  it("does not call an ungenerated family stale", () => {
    expect(state({ affectedSinceGenerated: [OEM] }).stale).toBe(false);
  });

  it("keeps the document's stage while reporting it as stale", () => {
    const s = state({ documentStatus: "approved", affectedSinceGenerated: [OEM] });
    expect(s.stage).toBe("approved");
    expect(s.stale).toBe(true);
  });
});

describe("produced states", () => {
  it("routes each produced state to the action that advances it", () => {
    expect(state({ documentStatus: "generated" }).nextAction).toBe("publish");
    expect(state({ documentStatus: "review_required" }).nextAction).toBe("review");
    expect(state({ documentStatus: "approved" }).nextAction).toBe("publish");
    expect(state({ documentStatus: "published" }).nextAction).toBe("none");
  });

  it("does not treat generating as attention", () => {
    const s = state({ documentStatus: "generating" });
    expect(s.needsAttention).toBe(false);
    expect(s.nextAction).toBe("none");
  });

  it("escalates a repeatedly failing family to review instead of retrying forever", () => {
    expect(state({ documentStatus: "failed", failureCount: 1 }).nextAction).toBe("retry");
    expect(state({ documentStatus: "failed", failureCount: 3 }).nextAction).toBe("review");
  });

  it("classifies which stages count as produced", () => {
    expect(isProduced("published")).toBe(true);
    expect(isProduced("ready")).toBe(false);
    expect(isProduced("blocked")).toBe(false);
  });
});

describe("the whole vehicle", () => {
  it("reports a used vehicle with nothing generated as non-compliant", () => {
    const p = computeVehiclePipeline({ condition: "used", currentSnapshotVersion: 1 });
    expect(p.compliant).toBe(false);
    expect(p.needsAttention.some((s) => s.family === GUIDE)).toBe(true);
  });

  it("is compliant once every required family is published", () => {
    const p = computeVehiclePipeline({
      condition: "used", currentSnapshotVersion: 4,
      families: { [GUIDE]: { documentStatus: "published" } },
    });
    expect(p.compliant).toBe(true);
  });

  it("stops being compliant when the required family goes stale", () => {
    const p = computeVehiclePipeline({
      condition: "used", currentSnapshotVersion: 5,
      families: {
        [GUIDE]: { documentStatus: "published", affectedSinceGenerated: [GUIDE] },
      },
    });
    expect(p.compliant).toBe(false);
    expect(p.outstanding.some((s) => s.family === GUIDE)).toBe(true);
  });

  it("counts completion across applicable families only", () => {
    const p = computeVehiclePipeline({
      condition: "new", currentSnapshotVersion: 2,
      families: { [OEM]: { documentStatus: "published" } },
    });
    // A new vehicle has two applicable families; one is finished.
    const applicable = p.states.filter((s) => s.applicable);
    expect(applicable).toHaveLength(2);
    expect(p.completion).toBeCloseTo(0.5);
    expect(p.states.filter((s) => !s.applicable)).toHaveLength(3);
  });

  it("gives an unresolved-condition vehicle no applicable work but flags it", () => {
    const p = computeVehiclePipeline({ condition: "", currentSnapshotVersion: 1 });
    expect(p.outstanding).toEqual([]);
    expect(p.needsAttention).toHaveLength(5);
    expect(p.compliant).toBe(false);
  });

  it("keeps the used sticker independent of the Buyers Guide", () => {
    const p = computeVehiclePipeline({
      condition: "used", currentSnapshotVersion: 3,
      families: {
        [GUIDE]: { documentStatus: "published" },
        [USED_STICKER]: { documentStatus: "published", affectedSinceGenerated: [USED_STICKER] },
      },
    });
    expect(p.states.find((s) => s.family === GUIDE)!.stale).toBe(false);
    expect(p.states.find((s) => s.family === USED_STICKER)!.stale).toBe(true);
    // A stale optional document does not make the vehicle non-compliant.
    expect(p.compliant).toBe(true);
  });
});

describe("snapshot invalidation", () => {
  it("collects the families named across every newer snapshot", () => {
    expect(familiesInvalidatedBy([[OEM], [GUIDE, OEM]]).sort()).toEqual([GUIDE, OEM].sort());
  });

  it("drops snapshot keys that are not document families", () => {
    // Snapshots also route to `description` and `passport`, which are not
    // documents and must not be invented into one.
    expect(familiesInvalidatedBy([["description", "passport", OEM]])).toEqual([OEM]);
  });

  it("returns nothing when no snapshot moved anything", () => {
    expect(familiesInvalidatedBy([])).toEqual([]);
    expect(familiesInvalidatedBy([[]])).toEqual([]);
  });
});
