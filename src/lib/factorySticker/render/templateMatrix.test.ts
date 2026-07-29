import { describe, expect, it } from "vitest";
import { adaptRenderData, type FactoryStickerRenderData } from "./contract";
import {
  buildStickerLayout, MIN_BODY_FONT_SIZE, PAGE_HEIGHT, PAGE_MARGIN, PAGE_WIDTH,
  type LayoutModel,
} from "./layout";
import { layoutToSvg } from "./previewSvg";
import { getTheme, THEME_REGISTRY } from "../oem/themes";
import type { OemId } from "../oem/identity";
import { getTemplateDefinition, validatePageGeometry } from "../oem/selection";
import { checkRenderedCompleteness } from "./completeness";
import { expectMinFontRespected, expectWithinBounds } from "./__fixtures__/layoutAsserts";
import { infinitiBenchmark } from "./__fixtures__/renderData";
import { buildVariant, VARIANT_IDS, type VariantId } from "./__fixtures__/variants";

// Every registered template × every shape real inventory produces.
//
// The per-template snapshots elsewhere prove a template did not change.
// This proves a template does not BREAK — on a stripped base model, on a
// loaded one, on a name too long for its box, on a package with more
// members than fit, on an EV whose EPA panel is a different module. Each
// combination is asserted against the invariants a customer-facing
// manufacturer document has to satisfy no matter what data it carries.

const OEM_IDS = (Object.keys(THEME_REGISTRY) as OemId[]).sort();

// FNV-1a over the canonical SVG — one line per variant, so drift in any
// combination shows up without 180 separate snapshot files.
function digest(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

const texts = (m: LayoutModel) =>
  m.pages.flatMap((p) => p.primitives.filter((x) => x.kind === "text").map((x) => (x.kind === "text" ? x : null)))
    .filter((x): x is NonNullable<typeof x> => x !== null);

function assertInvariants(
  oemId: OemId,
  variant: VariantId,
  data: FactoryStickerRenderData,
  model: LayoutModel,
): void {
  const where = `${oemId}/${variant}`;

  // Registered page geometry, orientation and page count.
  const def = getTemplateDefinition(oemId, Number(data.identity.year) || null);
  const format = def?.pageFormat ?? {
    widthInches: 11, heightInches: 8.5, orientation: "landscape" as const,
    expectedPageCount: 1, continuationAllowed: true,
  };
  const geometry = validatePageGeometry(format, {
    widthPt: model.width, heightPt: model.height, pageCount: model.pages.length,
  });
  expect(geometry.reasons, where).toEqual([]);
  expect(geometry.pass, where).toBe(true);
  expect(model.width, where).toBe(PAGE_WIDTH);
  expect(model.height, where).toBe(PAGE_HEIGHT);

  // No clipping, and nothing below the registered minimum size.
  expectWithinBounds(model);
  expectMinFontRespected(model);
  for (const t of texts(model)) {
    expect(t.size, `${where}: "${t.str}"`).toBeGreaterThanOrEqual(MIN_BODY_FONT_SIZE - 1e-9);
  }

  const strings = texts(model).map((t) => t.str);

  // VIN placement: printed, and inside the barcode block's own region.
  expect(strings, where).toContain(data.vin);
  const barcode = model.pages[0].primitives.find((p) => p.kind === "barcode");
  expect(barcode, where).toBeTruthy();
  if (barcode && barcode.kind === "barcode") {
    expect(barcode.payload, where).toBe(data.vin);
    expect(barcode.x, where).toBeGreaterThanOrEqual(PAGE_MARGIN);
    expect(barcode.x + barcode.w, where).toBeLessThanOrEqual(PAGE_WIDTH - PAGE_MARGIN);
  }

  // Total MSRP placement: the largest money figure on the page is the total.
  // Where it sits depends on the profile's pricing convention — a reversed
  // band pins it to the bottom, while the factory-record convention makes it
  // the last row of the price table, which ends wherever the options end. The
  // invariant that actually matters in both is that the biggest money figure
  // IS the total, so the position check applies only to the band convention.
  if (data.pricing.totalMsrp !== null) {
    const monies = texts(model).filter((t) => /^\$[\d,]+\.\d{2}$/.test(t.str)).sort((a, b) => b.size - a.size);
    expect(monies.length, where).toBeGreaterThan(0);
    const total = data.pricing.totalMsrp.toLocaleString("en-US", {
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    });
    expect(monies[0].str, where).toBe(`$${total}`);
    const inPriceTable = texts(model).some((t) => t.str.includes("ORIGINAL TOTAL MSRP"));
    if (!inPriceTable) expect(monies[0].y, where).toBeGreaterThan(PAGE_HEIGHT * 0.75);
  }

  // QR placement: the passport QR is present and within bounds.
  const qrs = model.pages[0].primitives.filter((p) => p.kind === "qr");
  expect(qrs.length, where).toBeGreaterThanOrEqual(1);
  for (const qr of qrs) {
    if (qr.kind !== "qr") continue;
    expect(qr.x, where).toBeGreaterThanOrEqual(PAGE_MARGIN);
    expect(qr.y + qr.size, where).toBeLessThanOrEqual(PAGE_HEIGHT - PAGE_MARGIN);
  }

  // Regulatory regions appear exactly when their data does, and never
  // when it does not — an absent EPA record must not print an empty panel.
  const joined = strings.join(" ");
  if (data.epa) {
    expect(joined, `${where}: EPA`).toMatch(/MPGe?\b/);
  } else {
    expect(joined, `${where}: EPA absent`).not.toContain("Fuel Economy & Environment");
  }
  if (data.epa?.fuelType === "Electric") {
    expect(joined, `${where}: EV`).toContain("MPGe");
    expect(joined, `${where}: EV`).not.toContain("gallons per 100 miles");
  }

  // Every priced package is listed exactly once, and every member prints.
  const report = checkRenderedCompleteness(data, model);
  expect(report.miscounted, where).toEqual([]);
  expect(report.missing.map((m) => m.label), where).toEqual([]);
}

describe("OEM template matrix", () => {
  it("covers every registered template against every shape", () => {
    expect(OEM_IDS.length).toBeGreaterThan(25);
    expect(VARIANT_IDS.length).toBe(6);
  });

  for (const oemId of OEM_IDS) {
    it(`${oemId} holds up across all six shapes`, async () => {
      const fingerprints: Record<string, string> = {};
      for (const variant of VARIANT_IDS) {
        const data = buildVariant(infinitiBenchmark(), variant);
        const model = buildStickerLayout(adaptRenderData(data), getTheme(oemId));
        assertInvariants(oemId, variant, data, model);
        fingerprints[variant] = `${model.pages.length}p ${model.mode} ${digest(layoutToSvg(model))}`;
      }
      await expect(JSON.stringify(fingerprints, null, 2))
        .toMatchFileSnapshot(`./__snapshots__/matrix-${oemId.toLowerCase()}.json`);
    });
  }
});
