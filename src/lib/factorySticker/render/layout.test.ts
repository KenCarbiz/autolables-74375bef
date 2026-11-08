import { describe, expect, it } from "vitest";
import { getTheme } from "../oem/themes";
import { adaptRenderData, resolveRenderTheme } from "./contract";
import {
  DENSITY_MINIMUM, EQUIPMENT_MIN_FONT_PT, EQUIPMENT_MIN_LINE_HEIGHT_RATIO,
  GENERIC_DENSITY_LADDER, buildStickerLayout, formatMoney, measureText,
} from "./layout";
import {
  infinitiBenchmark,
  longEquipmentFixture,
  newConditionBenchmark,
  noEpaFixture,
  qx55ClassFixture,
  themeFor,
} from "./__fixtures__/renderData";
import {
  expectMinFontRespected,
  expectNoPlaceholderArtifacts,
  expectNoTextOverlap,
  expectWithinBounds,
  pageStrings,
} from "./__fixtures__/layoutAsserts";

const buildRenderLayout = (data: Parameters<typeof adaptRenderData>[0], theme: Parameters<typeof resolveRenderTheme>[1]) =>
  buildStickerLayout(adaptRenderData(data), resolveRenderTheme(data, theme));

const VIN = "JN8AZ3NE5S9123456";

describe("layout: INFINITI benchmark", () => {
  const model = buildRenderLayout(infinitiBenchmark(), themeFor("infiniti"));
  const page1 = pageStrings(model, 0);

  it("fits on a single page at print-legible density", () => {
    expect(model.pages.length).toBe(1);
    expect(["STANDARD", "DENSE"]).toContain(model.mode);
  });

  it("concludes the price table with the reconciled total, not a reversed band", () => {
    // 2026-07 INFINITI directive: the total is the last row OF the price
    // table. A full-width reversed band read as retail advertising.
    expect(page1.some((s) => s.includes("ORIGINAL TOTAL MSRP"))).toBe(true);
    expect(page1).toContain("$95,695.00");
    expect(page1).toContain("$89,450.00");
    // Monroney convention: option and rollup rows carry plain amounts.
    expect(page1).toContain("1,995.00");
  });

  it("draws the VIN as an exact drawn string and as the barcode payload", () => {
    expect(model.drawnStrings).toContain(VIN);
    const barcode = model.pages[0].primitives.find((p) => p.kind === "barcode");
    expect(barcode && barcode.kind === "barcode" ? barcode.payload : null).toBe(VIN);
  });

  it("draws the passport QR with the canonical URL and scan caption", () => {
    const qrs = model.pages[0].primitives.filter((p) => p.kind === "qr");
    expect(qrs.some((q) => q.kind === "qr" && q.payload === "https://autolabels.io/v/demo-qx80")).toBe(true);
    expect(page1).toContain("VEHICLE PASSPORT");
    expect(page1).toContain("autolabels.io/v/demo-qx80");
  });

  it("renders the Monroney-style sections", () => {
    expect(page1).toContain("STANDARD EQUIPMENT");
    expect(page1).toContain("INCLUDED FACTORY PACKAGES");
    expect(page1.some((s) => s.includes("FACTORY OPTIONS"))).toBe(true);
    expect(page1.some((s) => s.includes("DESTINATION & HANDLING"))).toBe(true);
    expect(page1.some((s) => s.includes("BASE MSRP"))).toBe(true);
    expect(page1.some((s) => s.includes("Fuel Economy & Environment"))).toBe(true);
    expect(page1.some((s) => s.includes("EQUIPMENT GROUP SENSORY"))).toBe(true);
    expect(page1).toContain("3,400.00");
    expect(page1.some((s) => s.includes("GOVERNMENT 5-STAR SAFETY RATINGS"))).toBe(true);
  });

  it("keeps every primitive inside the page bounds", () => {
    expectWithinBounds(model);
  });

  it("has no overlapping text on page 1", () => {
    expectNoTextOverlap(model, 0);
  });

  it("respects the minimum body font size", () => {
    expectMinFontRespected(model);
  });

  it("draws no placeholder artifacts", () => {
    expectNoPlaceholderArtifacts(model);
  });
});

describe("layout: condition-specific banner", () => {
  it("uses TOTAL FACTORY MSRP for new vehicles", () => {
    const model = buildRenderLayout(newConditionBenchmark(), themeFor("infiniti"));
    const page1 = pageStrings(model, 0);
    expect(page1).toContain("TOTAL FACTORY MSRP");
    expect(page1.some((s) => (s.includes("TOTAL ORIGINAL MSRP") || s.includes("ORIGINAL TOTAL MSRP")))).toBe(false);
  });
});

describe("layout: empty EPA", () => {
  const model = buildRenderLayout(noEpaFixture(), themeFor("toyota"));
  const strings = model.drawnStrings;

  it("collapses the fuel-economy panel with no EPA strings", () => {
    expect(strings.some((s) => /\bEPA\b|\bMPG\b|FUEL ECONOMY|COMBINED/.test(s))).toBe(false);
  });

  it("collapses the safety panel when NHTSA data is unavailable", () => {
    expect(strings.some((s) => s.includes("SAFETY RATINGS"))).toBe(false);
  });

  it("leaves no empty box artifacts in the right panel above the QR", () => {
    const qr = model.pages[0].primitives.find((p) => p.kind === "qr");
    expect(qr).toBeDefined();
    const qrY = qr && qr.kind === "qr" ? qr.y : 0;
    const strayBoxes = model.pages[0].primitives.filter(
      (p) => p.kind === "rect" && p.x >= 560 && p.y + 12 < qrY && p.fill === null,
    );
    expect(strayBoxes).toHaveLength(0);
  });

  it("still passes global invariants", () => {
    expectWithinBounds(model);
    expectNoPlaceholderArtifacts(model);
  });
});

describe("layout: one physical page only", () => {
  const long = buildRenderLayout(longEquipmentFixture(), themeFor("infiniti"));

  it("never creates a second page: unfittable content is a review-required fit failure", () => {
    expect(long.pages.length).toBe(1);
    expect(long.mode).toBe("REVIEW_REQUIRED");
    expect(long.fit.ok).toBe(false);
    if (long.fit.ok) return;
    expect(long.fit.reason).toBe("one_page_fit_failed");
    expect(long.fit.overflowPt).toBeGreaterThan(0);
    expect(long.fit.detail).toContain("approved one-page layout adjustment");
    const all = long.pages[0].primitives.flatMap((p) => (p.kind === "text" ? [p.str] : []));
    expect(all.some((s) => /CONTINUED ON PAGE 2|EQUIPMENT CONTINUATION|PAGE 2 OF/.test(s))).toBe(false);
  });

  it("exports the validated readability floor", () => {
    expect(EQUIPMENT_MIN_FONT_PT).toBe(5.5);
    expect(EQUIPMENT_MIN_LINE_HEIGHT_RATIO).toBe(1.15);
    expect(DENSITY_MINIMUM.item).toBe(EQUIPMENT_MIN_FONT_PT);
    expect(DENSITY_MINIMUM.itemLh / DENSITY_MINIMUM.item).toBeGreaterThanOrEqual(EQUIPMENT_MIN_LINE_HEIGHT_RATIO);
    for (const d of GENERIC_DENSITY_LADDER) {
      expect(d.item).toBeGreaterThanOrEqual(EQUIPMENT_MIN_FONT_PT);
      expect(d.itemLh / d.item).toBeGreaterThanOrEqual(EQUIPMENT_MIN_LINE_HEIGHT_RATIO);
    }
  });

  describe("QX55-class build (about 60 items, 3 options)", () => {
    const model = buildRenderLayout(qx55ClassFixture(), themeFor("infiniti"));
    const data = qx55ClassFixture();

    it("fits one page at or above the equipment floor", () => {
      expect(model.pages.length).toBe(1);
      expect(model.fit.ok).toBe(true);
      expect(model.fit.ok && model.fit.equipmentFontPt).toBeGreaterThanOrEqual(EQUIPMENT_MIN_FONT_PT);
      expect(Object.values(data.standardEquipment).flat().length).toBeGreaterThanOrEqual(58);
    });

    it("renders no standard-equipment text below the floor", () => {
      const items = new Set(Object.values(data.standardEquipment).flat().map((s) => s.split(" ")[0]));
      for (const prim of model.pages[0].primitives) {
        if (prim.kind !== "text" || prim.font !== "body") continue;
        if (items.has(prim.str.split(" ")[0]) && prim.size < 7.4) {
          expect(prim.size, prim.str).toBeGreaterThanOrEqual(EQUIPMENT_MIN_FONT_PT);
        }
      }
      expectMinFontRespected(model);
      expectWithinBounds(model);
    });

    it("keeps MSRP total, rollup rows and the disclosure at their fixed sizes", () => {
      const prims = model.pages[0].primitives.flatMap((p) => (p.kind === "text" ? [p] : []));
      const total = prims.find((p) => /^\$[\d,]+\.\d{2}$/.test(p.str) && p.size > 10);
      expect(total?.size).toBe(11.5);
      const banner = prims.find((p) => p.str.startsWith("REPRODUCTION WINDOW STICKER") && p.color === "#ffffff");
      expect(banner?.size).toBe(6.4);
      const rollup = prims.find((p) => p.str === "BASE MSRP");
      expect(rollup?.size).toBe(7.6);
    });

    it("has no overlapping text", () => {
      expectNoTextOverlap(model, 0);
    });

    it("never separates a category heading from its first item", () => {
      const texts = model.pages[0].primitives.filter((p) => p.kind === "text");
      for (const t of texts) {
        if (t.kind !== "text" || t.font !== "bold") continue;
        if (!/^(PERFORMANCE|SAFETY|EXTERIOR|INTERIOR|TECHNOLOGY|CONVENIENCE|ADDITIONAL)/.test(t.str)) continue;
        if (t.str.includes(":")) continue;
        const follower = texts.find(
          (o) => o.kind === "text" && o.font === "body" && Math.abs(o.x - t.x) < 6 && o.y > t.y && o.y - t.y < 14,
        );
        expect(follower, `heading ${t.str} has no item beneath it`).toBeDefined();
      }
    });

    it("prints every verified item exactly once", () => {
      const expected = Object.values(data.standardEquipment).flat();
      expect([...model.printedEquipment].sort()).toEqual([...expected].sort());
    });
  });
});

describe("layout: NHTSA panel states", () => {
  it("renders verified star ratings as star glyphs", () => {
    const input = adaptRenderData(infinitiBenchmark());
    input.data.regulatory.nhtsaStatus = "VERIFIED";
    input.data.regulatory.overallRating = 5;
    input.data.regulatory.rolloverRating = 4;
    const model = buildStickerLayout(input, getTheme("INFINITI"));
    const page1 = pageStrings(model, 0);
    expect(page1).toContain("GOVERNMENT 5-STAR SAFETY RATINGS");
    // 5 overall + 4 rollover stars drawn as vector paths, never as text.
    const starPaths = model.pages[0].primitives.filter(
      (p) => p.kind === "path" && p.w >= 7 && p.w <= 8 && p.h >= 7 && p.h <= 8,
    );
    expect(starPaths.length).toBeGreaterThanOrEqual(9);
    expect(page1.some((s) => s.includes("OF 5 STARS"))).toBe(false);
    expectWithinBounds(model);
  });

  it("renders a formal Not Rated state", () => {
    const input = adaptRenderData(infinitiBenchmark());
    input.data.regulatory.nhtsaStatus = "NOT_RATED";
    const model = buildStickerLayout(input, getTheme("INFINITI"));
    const page1 = pageStrings(model, 0);
    expect(page1).toContain("Not Rated");
    expect(page1.some((s) => s.includes("has not been rated"))).toBe(true);
    expectWithinBounds(model);
  });
});

describe("layout helpers", () => {
  it("formats currency deterministically", () => {
    expect(formatMoney(95695)).toBe("$95,695.00");
    expect(formatMoney(500)).toBe("$500.00");
    expect(formatMoney(1234567.5)).toBe("$1,234,567.50");
    expect(formatMoney(-1050)).toBe("-$1,050.00");
  });

  it("measures text monotonically with size and length", () => {
    expect(measureText("INFINITI", "bold", 10)).toBeGreaterThan(measureText("INFINITI", "bold", 8));
    expect(measureText("QX80 AUTOGRAPH", "body", 8)).toBeGreaterThan(measureText("QX80", "body", 8));
    expect(measureText("A", "bold", 10, 5)).toBe(measureText("A", "bold", 10));
  });
});
