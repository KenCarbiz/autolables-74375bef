import { describe, expect, it } from "vitest";
import { getTheme } from "../oem/themes";
import { adaptRenderData, buildRenderLayout } from "./contract";
import { buildStickerLayout, formatMoney, measureText } from "./layout";
import {
  infinitiBenchmark,
  longEquipmentFixture,
  newConditionBenchmark,
  noEpaFixture,
  themeFor,
} from "./__fixtures__/renderData";
import {
  expectMinFontRespected,
  expectNoPlaceholderArtifacts,
  expectNoTextOverlap,
  expectWithinBounds,
  pageStrings,
} from "./__fixtures__/layoutAsserts";

const VIN = "JN8AZ3NE5S9123456";

describe("layout: INFINITI benchmark", () => {
  const model = buildRenderLayout(infinitiBenchmark(), themeFor("infiniti"));
  const page1 = pageStrings(model, 0);

  it("fits on a single page at print-legible density", () => {
    expect(model.pages.length).toBe(1);
    expect(["STANDARD", "DENSE"]).toContain(model.mode);
  });

  it("draws the used-vehicle total banner with the reconciled amount", () => {
    expect(page1.some((s) => s.includes("TOTAL ORIGINAL MSRP"))).toBe(true);
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
    expect(page1.some((s) => s.includes("TOTAL ORIGINAL MSRP"))).toBe(false);
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

describe("layout: long equipment continuation", () => {
  const model = buildRenderLayout(longEquipmentFixture(), themeFor("infiniti"));

  it("produces two pages in continuation mode", () => {
    expect(model.pages.length).toBe(2);
    expect(model.mode).toBe("CONTINUATION_REQUIRED");
  });

  it("keeps pricing, banner, VIN and disclosures on page 1", () => {
    const page1 = pageStrings(model, 0);
    expect(page1.some((s) => s.includes("TOTAL ORIGINAL MSRP"))).toBe(true);
    expect(page1).toContain("$95,695.00");
    expect(page1).toContain(VIN);
    expect(page1.some((s) => s.includes("Monroney label"))).toBe(true);
    expect(page1.some((s) => s.includes("CONTINUED ON PAGE 2"))).toBe(true);
  });

  it("labels the continuation page and repeats the identity", () => {
    const page2 = pageStrings(model, 1);
    expect(page2).toContain("FACTORY EQUIPMENT CONTINUATION");
    expect(page2).toContain(`VIN: ${VIN}`);
    expect(page2).toContain("PAGE 2 OF 2");
    expect(page2.some((s) => s.includes("belongs to the sticker on page 1"))).toBe(true);
  });

  it("never separates a category heading from its first item", () => {
    for (const page of [0, 1] as const) {
      const texts = model.pages[page].primitives.filter((p) => p.kind === "text");
      // Category headings are bold sectionHeading-colored column entries;
      // an item at the same x must follow within one line height.
      for (const t of texts) {
        if (t.kind !== "text" || t.font !== "bold") continue;
        if (!/EQUIPMENT ITEM|^(EXTERIOR|INTERIOR|SAFETY|MECHANICAL|TECHNOLOGY|COMFORT)/.test(t.str)) continue;
        if (/ITEM/.test(t.str)) continue;
        // Identity lines like "EXTERIOR: MAJESTIC WHITE" are not column headings.
        if (t.str.includes(":")) continue;
        // Items sit a bullet-indent (5pt) right of their column heading.
        const follower = texts.find(
          (o) =>
            o.kind === "text" &&
            o.font === "body" &&
            Math.abs(o.x - t.x) < 6 &&
            o.y > t.y &&
            o.y - t.y < 14,
        );
        expect(follower, `heading ${t.str} on page ${page + 1} has no item beneath it`).toBeDefined();
      }
    }
  });

  it("stays within bounds on both pages", () => {
    expectWithinBounds(model);
    expectMinFontRespected(model);
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
