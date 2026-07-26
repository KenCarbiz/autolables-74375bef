import { describe, expect, it } from "vitest";
import { THEME_REGISTRY } from "../oem/themes";
import type { OemId } from "../oem/identity";
import { adaptRenderData } from "./contract";
import { buildStickerLayout } from "./layout";
import { infinitiBenchmark } from "./__fixtures__/renderData";
import {
  expectMinFontRespected,
  expectNoPlaceholderArtifacts,
  expectWithinBounds,
  pageStrings,
} from "./__fixtures__/layoutAsserts";

// Per-OEM regression net: every registered theme must lay out the benchmark
// vehicle without overflow, artifacts, or identity loss.
describe("theme matrix: benchmark renders under every OEM theme", () => {
  const oemIds = Object.keys(THEME_REGISTRY) as OemId[];

  it("covers the full registry", () => {
    expect(oemIds.length).toBeGreaterThanOrEqual(30);
  });

  for (const oemId of oemIds) {
    it(`lays out cleanly for ${oemId}`, () => {
      const theme = THEME_REGISTRY[oemId];
      const model = buildStickerLayout(adaptRenderData(infinitiBenchmark()), theme);
      expect(model.pages.length).toBeGreaterThanOrEqual(1);
      expect(model.pages.length).toBeLessThanOrEqual(2);
      expectWithinBounds(model);
      expectMinFontRespected(model);
      expectNoPlaceholderArtifacts(model);
      const page1 = pageStrings(model, 0);
      expect(model.drawnStrings).toContain("JN8AZ2NE8P9123456");
      expect(page1).toContain("$95,695.00");
      expect(page1.some((s) => s.includes("TOTAL ORIGINAL MSRP"))).toBe(true);
      expect(page1.some((s) => s.includes(theme.logo.wordmarkText.toUpperCase()))).toBe(true);
      if (theme.layout.barcodeVariant === "NONE") {
        expect(model.pages[0].primitives.some((p) => p.kind === "barcode")).toBe(false);
      } else {
        const barcode = model.pages[0].primitives.find((p) => p.kind === "barcode");
        expect(barcode && barcode.kind === "barcode" ? barcode.payload : null).toBe("JN8AZ2NE8P9123456");
      }
    });
  }
});
