import { describe, it, expect } from "vitest";
import { matchIihsAward, iihsAwardLabel, type IihsAward } from "./iihsAwards";

const AWARDS: IihsAward[] = [
  { year: "2026", make: "INFINITI", model: "QX60", award: "tsp_plus" },
  { year: "2026", make: "Nissan", model: "Altima", award: "tsp" },
  { year: "2025", make: "Land Rover", model: "Defender", award: "tsp" },
];

describe("matchIihsAward", () => {
  it("matches year + make + model with trim tail", () => {
    const m = matchIihsAward(AWARDS, "2026 INFINITI QX60 Autograph");
    expect(m?.award).toBe("tsp_plus");
    expect(m?.label).toBe("2026 IIHS Top Safety Pick+");
  });
  it("is case-insensitive and matches exact ymm", () => {
    expect(matchIihsAward(AWARDS, "2026 nissan altima")?.award).toBe("tsp");
  });
  it("handles multi-word makes", () => {
    expect(matchIihsAward(AWARDS, "2025 Land Rover Defender 110")?.award).toBe("tsp");
  });
  it("never matches a different model year or a model prefix", () => {
    expect(matchIihsAward(AWARDS, "2025 INFINITI QX60")).toBeNull();
    expect(matchIihsAward([{ year: "2026", make: "INFINITI", model: "QX6", award: "tsp" }], "2026 INFINITI QX60")).toBeNull();
  });
  it("returns null on empty inputs", () => {
    expect(matchIihsAward(AWARDS, null)).toBeNull();
    expect(matchIihsAward(null, "2026 INFINITI QX60")).toBeNull();
  });
});

describe("iihsAwardLabel", () => {
  it("distinguishes TSP from TSP+", () => {
    expect(iihsAwardLabel({ year: "2026", award: "tsp" })).toBe("2026 IIHS Top Safety Pick");
    expect(iihsAwardLabel({ year: "2026", award: "tsp_plus" })).toBe("2026 IIHS Top Safety Pick+");
  });
});
