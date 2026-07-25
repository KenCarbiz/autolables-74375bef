import { describe, it, expect } from "vitest";
import {
  countFinished,
  countProduced,
  isFinishedState,
  isProducedState,
  isReadyToMarket,
  type PackageItemStatus,
} from "./packageState";

const items = (...statuses: PackageItemStatus[]) => statuses.map((status) => ({ status }));

describe("produced vs finished", () => {
  // The root defect: a state meaning "an artifact exists" was read as "the work
  // is finished". A draft sticker and a prefilled K-208 are neither.
  it("draft_created, created and prefilled are produced but NOT finished", () => {
    for (const s of ["draft_created", "created", "prefilled"] as PackageItemStatus[]) {
      expect(isProducedState(s)).toBe(true);
      expect(isFinishedState(s)).toBe(false);
    }
  });

  it("ready and published are both produced and finished", () => {
    for (const s of ["ready", "published"] as PackageItemStatus[]) {
      expect(isProducedState(s)).toBe(true);
      expect(isFinishedState(s)).toBe(true);
    }
  });

  it("pending, retry_required and blocked are neither", () => {
    for (const s of ["pending", "retry_required", "blocked"] as PackageItemStatus[]) {
      expect(isProducedState(s)).toBe(false);
      expect(isFinishedState(s)).toBe(false);
    }
  });

  it("counts them separately over the same package", () => {
    const pkg = items("draft_created", "prefilled", "ready", "published", "pending");
    expect(countProduced(pkg)).toBe(4);
    expect(countFinished(pkg)).toBe(2);
  });
});

describe("isReadyToMarket", () => {
  const finished = items("ready", "published", "ready");

  it("is false while any item is only a produced artifact", () => {
    expect(isReadyToMarket({ items: items("ready", "prefilled"), getReadyStep: 4 })).toBe(false);
    expect(isReadyToMarket({ items: items("ready", "draft_created"), getReadyStep: 4 })).toBe(false);
  });

  // Screen 1's green pill and screen 2's step 4 are the same claim, so they are
  // derived from the same inputs.
  it("is false unless the get-ready has reached step 4", () => {
    expect(isReadyToMarket({ items: finished, getReadyStep: 1 })).toBe(false);
    expect(isReadyToMarket({ items: finished, getReadyStep: 3 })).toBe(false);
    expect(isReadyToMarket({ items: finished, getReadyStep: 4 })).toBe(true);
  });

  it("is false for an empty package — nothing measured is not readiness", () => {
    expect(isReadyToMarket({ items: [], getReadyStep: 4 })).toBe(false);
  });
});
