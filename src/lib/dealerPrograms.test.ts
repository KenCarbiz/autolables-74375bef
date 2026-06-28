import { describe, it, expect } from "vitest";
import { emptyProgram, applicablePrograms, requirementLabel, type DealerProgram } from "./dealerPrograms";

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
