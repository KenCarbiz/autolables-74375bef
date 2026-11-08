import { describe, expect, it } from "vitest";
import type { FactoryStickerData } from "../../types";
import { Painter, textBBox, type TextPrimitive } from "../layout";
import { makeGrid } from "./catalogBlocks";
import { evRangeFacts, paintEvEpa, paintRangeChart, type EvMode } from "./evPanels";
import { normalizeForSticker } from "../../../../../supabase/functions/factory-sticker-orchestrate/normalize.ts";
import { canonicalPassportUrl } from "../../reproduction";
import { cadillacListing } from "../__fixtures__/cadillac";

const grid = makeGrid(30, 58, 709, 1045);
type Regulatory = FactoryStickerData["regulatory"];
const reg = (r: Partial<Regulatory>): Regulatory => ({ nhtsaStatus: "UNAVAILABLE", epaStatus: "VERIFIED", ...r });

const draw = (regulatory: Regulatory, mode: EvMode, fuelType?: string): { strings: string[]; rects: number; prims: Painter["primitives"] } => {
  const strings: string[] = [];
  const p = new Painter(strings);
  const d = { regulatory, vehicle: { fuelType }, document: { passportUrl: "" } } as unknown as FactoryStickerData;
  paintEvEpa(p, d, grid, 100, 100, { mode });
  return { strings, rects: p.primitives.filter((x) => x.kind === "rect").length, prims: p.primitives };
};

const chart = (r: Parameters<typeof paintRangeChart>[4], mode: EvMode): { strings: string[]; widths: number[] } => {
  const strings: string[] = [];
  const p = new Painter(strings);
  paintRangeChart(p, 10, 10, 300, r, mode);
  return { strings, widths: p.primitives.flatMap((x) => (x.kind === "rect" && x.fill === "#000000" ? [x.w] : [])) };
};

describe("range facts", () => {
  it("reads an electric vehicle's saved range as its total range", () => {
    expect(evRangeFacts(reg({ epaStatus: "VERIFIED", evRangeMiles: 253, chargeTimeHours: 10 }), "ev")).toEqual({ electric: 253, chargeHours: 10 });
    expect(evRangeFacts(reg({ epaStatus: "VERIFIED" }), "ev")).toEqual({});
  });
  it("reads a plug-in hybrid's saved range as its electric range and the total only when it is longer", () => {
    expect(evRangeFacts(reg({ epaStatus: "VERIFIED", evRangeMiles: 30 }), "phev")).toEqual({ electric: 30 });
    expect(evRangeFacts(reg({ epaStatus: "VERIFIED", electricRangeMiles: 30, totalRangeMiles: 440 }), "phev")).toEqual({ electric: 30, total: 440 });
    expect(evRangeFacts(reg({ epaStatus: "VERIFIED", electricRangeMiles: 30, totalRangeMiles: 20 }), "phev")).toEqual({ electric: 30 });
    expect(evRangeFacts(reg({ epaStatus: "VERIFIED", evRangeMiles: 0 }), "phev")).toEqual({});
  });
});

describe("range chart", () => {
  it("prints an unavailable state and draws no filled bar without a range", () => {
    for (const mode of ["ev", "phev"] as const) {
      const c = chart({}, mode);
      expect(c.strings).toContain("Range Not Available");
      expect(c.widths).toEqual([]);
    }
  });
  it("draws the electric segment in proportion to the record's own figures", () => {
    const c = chart({ electric: 30, total: 300 }, "phev");
    expect(c.strings).toEqual(expect.arrayContaining(["30", "300", "Gasoline only"]));
    expect(c.widths[0] / 222).toBeCloseTo(0.1, 5);
    const half = chart({ electric: 150, total: 300 }, "phev");
    expect(half.widths[0] / 222).toBeCloseTo(0.5, 5);
  });
  it("prints an unavailable total for a plug-in hybrid with only an electric range, and a charge time only when present", () => {
    const c = chart({ electric: 53 }, "phev");
    expect(c.strings).toEqual(expect.arrayContaining(["53", "Total range: Not Available", "Charge Time: Not Available"]));
    expect(chart({ electric: 53, chargeHours: 3 }, "phev").strings).toContain("Charge Time: 3 hours (240V)");
  });
});

describe("electric and plug-in panels", () => {
  const ev = reg({ combinedMpg: 117, cityMpg: 122, highwayMpg: 112, evRangeMiles: 310, annualFuelCost: 650, greenhouseGasRating: 10 });

  it("prints the record's figures and an explicit unavailable state for kWh, charge time, smog and the 5-year comparison", () => {
    const { strings } = draw(ev, "ev", "Electricity");
    expect(strings).toEqual(expect.arrayContaining(["117", "122", "112", "310", "MPGe", "Electric Vehicle", "$650"]));
    expect(strings).toContain("Charge Time: Not Available");
    expect(strings.filter((s) => s === "N/A" || s === "Not Available").length).toBeGreaterThanOrEqual(3);
    expect(strings.join(" ")).not.toMatch(/\b0\.0\b|\$0\b/);
  });

  it("prints every EPA figure as unavailable for an unverified record, with no fuel-type tag", () => {
    const { strings } = draw(reg({ epaStatus: "UNAVAILABLE" }), "ev");
    expect(strings).not.toContain("Electric Vehicle");
    expect(strings).toContain("Range Not Available");
    expect(strings.filter((s) => /^\d+$/.test(s))).toEqual([]);
  });

  it("keeps plug-in gas figures separate from the electricity figure", () => {
    const { strings } = draw(reg({ gasolineCombinedMpg: 42, evRangeMiles: 53, annualFuelCost: 1550 }), "phev", "Gasoline and Electricity");
    expect(strings).toEqual(expect.arrayContaining(["42", "2.4", "53", "Plug-In Hybrid Vehicle", "Electricity-Gasoline"]));
    expect(strings.filter((s) => s === "Not Available").length).toBeGreaterThanOrEqual(1);
    const mpge = draw(reg({ combinedMpge: 106, kwhPer100Miles: 31.4, evRangeMiles: 53 }), "phev").strings;
    expect(mpge).toEqual(expect.arrayContaining(["106", "31.4"]));
  });

  it("moves the greenhouse-gas pointer with the score", () => {
    const xs = [1, 5, 10].map((score) => {
      const { prims } = draw(reg({ ...ev, greenhouseGasRating: score }), "ev");
      const labels = prims.filter((x): x is TextPrimitive => x.kind === "text" && x.str === String(score) && x.color === "#ffffff" && x.align === "center");
      return labels.reduce((a, b) => (b.y < a.y ? b : a)).x;
    });
    expect(xs[0]).toBeLessThan(xs[1]);
    expect(xs[1]).toBeLessThan(xs[2]);
    expect(draw(reg({ ...ev, greenhouseGasRating: 11 }), "ev").strings.filter((s) => s === "Not Available").length).toBeGreaterThanOrEqual(2);
  });

  it("keeps all text inside the panel", () => {
    const { prims } = draw(reg({ ...ev, kwhPer100Miles: 28.9, chargeTimeHours: 10, smogRating: 10, fiveYearCostDifference: 2500, co2TailpipeGpm: 0 }), "ev", "Electricity");
    const x0 = grid.x(100);
    const x1 = grid.x(800);
    for (const t of prims.filter((x): x is TextPrimitive => x.kind === "text")) {
      const b = textBBox(t);
      expect(b.x0, t.str).toBeGreaterThanOrEqual(x0 - 0.5);
      expect(b.x1, t.str).toBeLessThanOrEqual(x1 + 0.5);
    }
  });
});

describe("EV figures from the saved EPA row", () => {
  it("carries them only for catalog makes and only when present", () => {
    const base = cadillacListing();
    const row = { ...(base.epa_economy as object), kwhPer100Miles: 29, chargeTimeHours: 10, electricRangeMiles: 30, totalRangeMiles: 440, combinedMpge: 70, smogScore: 10 };
    const make = (ymm: string, epa: object) => normalizeForSticker({ ...base, ymm, epa_economy: epa }, {}, canonicalPassportUrl("x"), "t").data.epa;
    expect(make("2026 Cadillac Escalade IQL", row)).toMatchObject({ kwhPer100Miles: 29, chargeTimeHours: 10, electricRangeMiles: 30, totalRangeMiles: 440, combinedMpge: 70, smogScore: 10 });
    expect(make("2026 Cadillac Escalade IQL", base.epa_economy as object)).not.toHaveProperty("kwhPer100Miles");
    expect(make("2026 Infiniti QX60", row)).not.toHaveProperty("kwhPer100Miles");
  });
});
