import { describe, it, expect } from "vitest";
import { classifyCondition, isTruthyFlag, isNewInventoryType } from "../../../supabase/functions/_shared/vehicleCondition";

// A dealer's new-car count read zero while 39 new units sat in the CPO bucket.
// The sync asked "is it certified" before "is it new", so any new unit the
// feed also flagged as certified was graded CPO — and because the new-unit
// counter only counts cars classified new, the recovery probe that watches
// that counter re-fired every night and re-buried them.

describe("new beats certified, because CPO is a grade of used", () => {
  it("classifies a new unit as new even when the feed also flags it certified", () => {
    expect(classifyCondition({ inventoryType: "new", certified: true })).toBe("new");
  });

  it("still grades a genuinely certified used unit as cpo", () => {
    expect(classifyCondition({ inventoryType: "used", certified: true })).toBe("cpo");
  });

  it("falls back to used", () => {
    expect(classifyCondition({ inventoryType: "used", certified: false })).toBe("used");
    expect(classifyCondition({})).toBe("used");
    expect(classifyCondition({ inventoryType: null, certified: null })).toBe("used");
  });

  it("matches the precedence every DMS normalizer already uses", () => {
    // dms-webhook asks type first in all four vendor mappings; the MarketCheck
    // path was the only one in the repo that inverted it.
    for (const t of ["new", "New", "NEW"]) {
      expect(classifyCondition({ inventoryType: t, certified: "Y" })).toBe("new");
    }
  });
});

describe("the same field arrives in a different shape from every provider", () => {
  it("reads new regardless of casing or padding", () => {
    for (const v of ["new", "New", "NEW", " new ", "New "]) {
      expect(isNewInventoryType(v), `${JSON.stringify(v)} should read as new`).toBe(true);
    }
  });

  it("does not treat a near-miss as new", () => {
    for (const v of ["newish", "renew", "", null, undefined, "used"]) {
      expect(isNewInventoryType(v)).toBe(false);
    }
  });

  it("reads a certification flag whether it is boolean, numeric or string", () => {
    for (const v of [true, 1, "true", "TRUE", "1", "y", "Y", "yes"]) {
      expect(isTruthyFlag(v), `${JSON.stringify(v)} should be truthy`).toBe(true);
    }
  });

  it('does not let the string "false" mean certified', () => {
    // The bare `l.is_certified` test treated "false" as true, which alone is
    // enough to push an entire feed into CPO.
    for (const v of [false, 0, "false", "FALSE", "0", "n", "N", "no", "", null, undefined]) {
      expect(isTruthyFlag(v), `${JSON.stringify(v)} should be falsy`).toBe(false);
    }
  });
});
