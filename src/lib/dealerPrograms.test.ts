import { describe, it, expect } from "vitest";
import { emptyProgram, applicablePrograms, requirementLabel, type DealerProgram, programMode, termLabel, warrantyPanelPrograms, includedWarrantyPrograms } from "./dealerPrograms";

const prog = (over: Partial<DealerProgram> = {}): DealerProgram => ({
  ...emptyProgram(),
  title: "10yr / 100k Powertrain",
  ...over,
});

describe("emptyProgram", () => {
  it("defaults to packet-on, sticker-off, applies-to-all, no requirement", () => {
    const p = emptyProgram();
    expect(p.enabled).toBe(true);
    expect(p.showOnPacket).toBe(true);
    expect(p.showOnSticker).toBe(false);
    expect(p.appliesTo).toBe("all");
    expect(p.requirement).toBe("none");
    expect(p.id).toBeTruthy();
  });
});

describe("applicablePrograms", () => {
  it("returns [] for null/undefined program lists", () => {
    expect(applicablePrograms(null, "new", "packet")).toEqual([]);
    expect(applicablePrograms(undefined, "new", "packet")).toEqual([]);
  });

  it("excludes disabled programs", () => {
    expect(applicablePrograms([prog({ enabled: false })], "new", "packet")).toHaveLength(0);
  });

  it("excludes programs with neither a title nor an offer", () => {
    expect(applicablePrograms([prog({ title: "  ", offer: "" })], "new", "packet")).toHaveLength(0);
  });

  it("includes a program with only an offer set", () => {
    expect(applicablePrograms([prog({ title: "", offer: "Free first oil change" })], "new", "packet")).toHaveLength(1);
  });

  it("matches appliesTo against the vehicle condition (case-insensitive)", () => {
    expect(applicablePrograms([prog({ appliesTo: "used" })], "Used", "packet")).toHaveLength(1);
    expect(applicablePrograms([prog({ appliesTo: "used" })], "new", "packet")).toHaveLength(0);
  });

  it("treats appliesTo 'all' as matching any condition (including null)", () => {
    expect(applicablePrograms([prog({ appliesTo: "all" })], null, "packet")).toHaveLength(1);
  });

  it("respects the placement gate", () => {
    const p = prog({ showOnSticker: true, showOnPacket: false });
    expect(applicablePrograms([p], "new", "sticker")).toHaveLength(1);
    expect(applicablePrograms([p], "new", "packet")).toHaveLength(0);
  });
});

describe("requirementLabel", () => {
  it("returns null when there is no requirement", () => {
    expect(requirementLabel(prog({ requirement: "none" }))).toBeNull();
  });

  it("labels a finance requirement, defaulting when no text given", () => {
    expect(requirementLabel(prog({ requirement: "finance", requirementText: "" }))).toBe("With dealer financing");
    expect(requirementLabel(prog({ requirement: "finance", requirementText: "WAC" }))).toBe("WAC");
  });

  it("labels a custom requirement, defaulting when no text given", () => {
    expect(requirementLabel(prog({ requirement: "custom", requirementText: "" }))).toBe("Conditions apply");
    expect(requirementLabel(prog({ requirement: "custom", requirementText: "In-stock only" }))).toBe("In-stock only");
  });
});

describe("warranty benefit helpers", () => {
  it("programMode defaults to included for legacy programs", () => {
    const p = emptyProgram();
    delete (p as Partial<DealerProgram>).mode;
    expect(programMode(p)).toBe("included");
    expect(programMode({ ...p, mode: "available" })).toBe("available");
  });

  it("termLabel formats lifetime, years, miles, and combinations", () => {
    const p = emptyProgram();
    expect(termLabel(p)).toBeNull();
    expect(termLabel({ ...p, lifetime: true })).toBe("Lifetime");
    expect(termLabel({ ...p, termYears: 10 })).toBe("10-Year");
    expect(termLabel({ ...p, termMiles: 100000 })).toBe("100,000-Mile");
    expect(termLabel({ ...p, termYears: 10, termMiles: 100000 })).toBe("10-Year / 100,000-Mile");
  });

  it("warrantyPanelPrograms filters to enabled warranty programs matching the condition", () => {
    const base = { ...emptyProgram(), title: "Dealer CPO", isWarranty: true, showOnWarrantyPanel: true, appliesTo: "used" as const };
    expect(warrantyPanelPrograms([base], "used")).toHaveLength(1);
    expect(warrantyPanelPrograms([base], "new")).toHaveLength(0);
    expect(warrantyPanelPrograms([{ ...base, showOnWarrantyPanel: false }], "used")).toHaveLength(0);
    expect(warrantyPanelPrograms([{ ...base, isWarranty: false }], "used")).toHaveLength(0);
    expect(warrantyPanelPrograms([{ ...base, enabled: false }], "used")).toHaveLength(0);
  });
});

describe("condition matching semantics", () => {
  const used = { ...emptyProgram(), title: "Dealer Pre-Owned Warranty", appliesTo: "used" as const, isWarranty: true, showOnWarrantyPanel: true };

  it("used programs also match cpo vehicles", () => {
    expect(warrantyPanelPrograms([used], "cpo")).toHaveLength(1);
    expect(warrantyPanelPrograms([used], "used")).toHaveLength(1);
    expect(warrantyPanelPrograms([used], "new")).toHaveLength(0);
  });

  it("missing appliesTo behaves as all", () => {
    const p = { ...used };
    delete (p as Partial<DealerProgram>).appliesTo;
    expect(warrantyPanelPrograms([p], "new")).toHaveLength(1);
  });
});

describe("includedWarrantyPrograms (Buyers Guide cross-check)", () => {
  const base = { ...emptyProgram(), title: "Dealer Limited Powertrain Warranty", isWarranty: true, appliesTo: "used" as const, showOnPacket: true };

  it("returns included, customer-visible warranty programs for the condition", () => {
    expect(includedWarrantyPrograms([base], "used")).toHaveLength(1);
    expect(includedWarrantyPrograms([base], "cpo")).toHaveLength(1);
    expect(includedWarrantyPrograms([base], "new")).toHaveLength(0);
  });

  it("excludes available-mode upgrades, disabled, non-warranty, and unplaced programs", () => {
    expect(includedWarrantyPrograms([{ ...base, mode: "available" }], "used")).toHaveLength(0);
    expect(includedWarrantyPrograms([{ ...base, enabled: false }], "used")).toHaveLength(0);
    expect(includedWarrantyPrograms([{ ...base, isWarranty: false }], "used")).toHaveLength(0);
    expect(includedWarrantyPrograms([{ ...base, showOnPacket: false, showOnSticker: false, showOnWarrantyPanel: false }], "used")).toHaveLength(0);
  });
});
