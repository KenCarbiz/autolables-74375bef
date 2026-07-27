import { describe, expect, it } from "vitest";
import { parseYmm } from "./ymm";
import { resolveOem } from "./oem/identity";

describe("ymm parsing", () => {
  it("parses a single-word make", () => {
    expect(parseYmm("2025 INFINITI QX50 LUXE"))
      .toEqual({ year: "2025", make: "INFINITI", model: "QX50 LUXE" });
  });

  it("keeps multi-word makes intact", () => {
    // The bug this exists for: a positional split made this make "Land",
    // which fails brand resolution and drops the vehicle onto the neutral
    // template even though a Land Rover template exists.
    expect(parseYmm("2024 Land Rover Defender 110"))
      .toEqual({ year: "2024", make: "Land Rover", model: "Defender 110" });
    expect(parseYmm("2025 Alfa Romeo Giulia Ti"))
      .toEqual({ year: "2025", make: "Alfa Romeo", model: "Giulia Ti" });
    expect(parseYmm("2024 Aston Martin DB12"))
      .toEqual({ year: "2024", make: "Aston Martin", model: "DB12" });
  });

  it("maps a consumer sub-brand back to the manufacturer", () => {
    // Feeds sometimes put "Range Rover" where the make belongs; the
    // manufacturer is what selects a template.
    expect(parseYmm("2025 Range Rover Sport Autobiography"))
      .toEqual({ year: "2025", make: "Land Rover", model: "Sport Autobiography" });
  });

  it("handles hyphenated and spaced Mercedes-Benz alike", () => {
    expect(parseYmm("2025 Mercedes-Benz GLE 450").make).toBe("Mercedes-Benz");
    expect(parseYmm("2025 Mercedes Benz GLE 450").make).toBe("Mercedes Benz");
  });

  it("tolerates a missing year, extra whitespace and empty input", () => {
    expect(parseYmm("INFINITI QX80")).toEqual({ year: "", make: "INFINITI", model: "QX80" });
    expect(parseYmm("  2025   Buick   Envision  "))
      .toEqual({ year: "2025", make: "Buick", model: "Envision" });
    expect(parseYmm("")).toEqual({ year: "", make: "", model: "" });
    expect(parseYmm(null)).toEqual({ year: "", make: "", model: "" });
    expect(parseYmm("2025")).toEqual({ year: "2025", make: "", model: "" });
  });

  it("does not mistake a model year inside the model for the year", () => {
    expect(parseYmm("2025 Ford F-150 Lightning").model).toBe("F-150 Lightning");
  });
});

describe("parsed makes reach their brand template", () => {
  // End-to-end on the part that was broken: what the feed actually stores
  // must resolve to the brand whose template we built.
  const cases: Array<[string, string]> = [
    ["2025 INFINITI QX50 LUXE", "INFINITI"],
    ["2024 Land Rover Defender 110", "LAND_ROVER"],
    ["2025 Range Rover Sport Autobiography", "LAND_ROVER"],
    ["2025 Buick Envision Avenir", "BUICK"],
    ["2025 Mercedes-Benz GLE 450", "MERCEDES_BENZ"],
    ["2026 Porsche 911 Carrera 4 GTS", "PORSCHE"],
    ["2025 Dodge Durango R/T", "DODGE"],
  ];

  for (const [ymm, expected] of cases) {
    it(`${ymm} resolves to ${expected}`, () => {
      const { make, year } = parseYmm(ymm);
      const resolved = resolveOem(make, Number(year) || undefined);
      expect(resolved.confidence, `${ymm} -> ${make}`).not.toBe("UNRESOLVED");
      expect(resolved.identity.id).toBe(expected);
    });
  }

  it("shows the old positional split would have failed Land Rover", () => {
    const naive = "2024 Land Rover Defender 110".split(/\s+/)[1];
    expect(naive).toBe("Land");
    expect(resolveOem(naive, 2024).confidence).toBe("UNRESOLVED");
  });
});
