// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/render/variants/astonMartinVantageRoadsterGas.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// 17x11 reproduction layout for the 2026 Aston Martin Vantage Roadster
// (gasoline), translated from the geometry of "Aston_Martin_2026_Vantage_Roadster"
// (Figma file w4wcUofXSX020vHQIhN9zR, master 1:688). The reference PDF is stored
// rotated (Page rot 270) and holds the label as a 300 dpi bilevel scan with no
// text layer; the render is the upright 1224x792 landscape page. Geometry is
// written in the upright reference's 100 dpi pixels (1700 x 1100) and mapped by
// X() and Ym(), which keeps horizontals and compresses verticals to clear the
// mandatory banner and disclosure.
//
// Every printed value comes from render data. The wings emblem is an
// alpha-masked raster cropped from the scan. The faded car photograph, the
// engine-number line, the bumper-quality paragraph, the "Best Sports Car"
// advertisement and window tag, the social icons, agency seals and the source QR are not reproduced;
// the 0.90in Vehicle Passport QR takes the Smartphone QR slot. The scan's free
// area under the fuel-economy panel carries a third equipment column.

import type { FactoryStickerData } from "../../types.ts";
import { Painter, formatMoney, type LayoutModel } from "../layout.ts";
import { VARIANT_LOGOS } from "./logoArtwork.ts";
import { INK, PAPER, type VariantLayoutBuilder } from "./shared.ts";
import { R, T, wrap } from "./hyundaiTucsonGas.ts";
import {
  TABLOID_HEIGHT, TABLOID_WIDTH, assembleTabloid, buildSections, colorText, dealerLines, flow, paintPlaced, placedResult,
  priceRowsWithoutColors, toEntries, totalMsrp, warrantySection,
  type FirstPageContext, type FirstPageResult, type FlowEntry, type FlowStyle, type TabloidSpec,
} from "./tabloidCommon.ts";
import { PRICE_FOOTNOTE, PX, Q, makeGrid, paintCatalogEpa, paintCatalogParts, paintCatalogSafety, paintPriceLines } from "./catalogBlocks.ts";
import { fitSize } from "./fcaCommon.ts";

export const ASTON_MARTIN_VANTAGE_ROADSTER_GAS_ID = "aston_martin_2026_vantage_roadster";

const EQ_STYLE: FlowStyle = { size: 10.8, lh: 11.6, hang: 5, inset: 0 };
const REF_TOP = 35;
const REF_BOTTOM = 1040;

const X = (px: number): number => px * PX;
type Ym = (px: number) => number;

function paintHeader(p: Painter, d: FactoryStickerData, m: Ym): void {
  const v = d.vehicle;
  R(p, X(15), m(35), X(1665), m(178) - m(35), INK);
  const rows: Array<[string, string | null, number]> = [
    ["Dealer:", dealerLines(d)[0] ?? null, 69],
    ["Model:", [v.model, v.trim ?? ""].filter(Boolean).join(" ") || null, 100],
    ["Model Year:", v.year > 0 ? String(v.year) : null, 117],
    ["Exterior Colour:", colorText(v.exteriorColor, v.exteriorColorCode), 143],
    ["Interior Colour:", colorText(v.interiorColor, v.interiorColorCode), 157],
  ];
  for (const [label, value, y] of rows) {
    T(p, label, X(52), m(y), 7.6, "body", { color: PAPER });
    if (value) T(p, value, X(157), m(y), fitSize(value, "body", 7.8, X(150), 6), "body", { color: PAPER });
  }
  T(p, "VIN:", X(317), m(117), 7.6, "body", { color: PAPER });
  T(p, v.vin, X(380), m(117), 7.8, "body", { color: PAPER });
  const logo = VARIANT_LOGOS.astonmartin;
  const w = 150;
  p.image(logo.png, logo.assetId, X(1480) - w / 2, m(58), w, (w * logo.slot.h) / logo.slot.w);
  const model = v.model.toUpperCase();
  if (model) T(p, model, X(1465), m(118), fitSize(model, "bold", 30, X(300), 14), "bold", { align: "center", color: PAPER });
}

/** Returns the y below the option rows, or null when they cannot fit. */
function paintPricing(p: Painter, d: FactoryStickerData, m: Ym): number | null {
  T(p, "Suggested Retail Price", X(293), m(190), 7.6, "body");
  R(p, X(293), m(210), X(255), m(234) - m(210), null, 0.9);
  const base = d.pricing.baseMsrp;
  T(p, base !== undefined ? formatMoney(base) : "NOT AVAILABLE", X(420), m(214), base !== undefined ? 8.4 : 6.4, "body", { align: "center" });
  T(p, "OPTIONAL EQUIPMENT", X(293), m(240), 8.4, "bold");
  const end = paintPriceLines(p, priceRowsWithoutColors(d), X(293), X(600), m(262), m(420), { size: 7, labelW: X(600) - X(293) - 52, step: 8 });
  if (end === null) return null;

  const pr = d.pricing;
  const rows: Array<[string, string]> = [];
  if (pr.importCharge !== undefined) rows.push(["Import Costs", formatMoney(pr.importCharge)]);
  if (pr.gasGuzzlerTax !== undefined) rows.push(["Gas Guzzler", formatMoney(pr.gasGuzzlerTax)]);
  rows.push(["Transportation and handling", pr.destinationCharge !== undefined ? formatMoney(pr.destinationCharge) : "NOT AVAILABLE"]);
  const total = totalMsrp(d);
  rows.push(["TOTAL SUGGESTED RETAIL*", total !== undefined ? formatMoney(total) : "NOT AVAILABLE"]);
  const step = m(1000) - m(970);
  const y0 = m(1040) - rows.length * step - 14;
  rows.forEach(([label, value], i) => {
    const y = y0 + i * step;
    T(p, label, X(52), y + 5, 8.4, "body");
    R(p, X(320), y, X(248), step - 4, null, 0.9);
    T(p, value, X(444), y + 5, value === "NOT AVAILABLE" ? 6.4 : 8.4, "body", { align: "center" });
  });
  wrap(PRICE_FOOTNOTE, "body", 6, X(520)).forEach((l, i) => T(p, l, X(52), m(1040) - 16 + i * 6.8, 6, "body"));
  return end;
}

function paintRight(p: Painter, d: FactoryStickerData, input: FirstPageContext["input"], m: Ym): void {
  const g = makeGrid(m(62), 62, m(62) + 0.7 * 453, 515);
  paintCatalogEpa(p, d, g, 610, 62);
  const top = m(185);
  paintCatalogParts(p, d, X(1312), top, X(340), m(505) - top, 1);
  const epaBottom = m(62) + 0.7 * 453 + 4;
  paintCatalogSafety(p, d, X(1085), epaBottom, X(565), m(900) - epaBottom);
  const vy = m(915);
  T(p, d.vehicle.vin, X(1367), vy, 8.6, "bold", { align: "center" });
  if (input.layout.barcodePayload) p.barcode(X(1100), vy + 12, X(535), m(1040) - vy - 14, input.layout.barcodePayload, INK);
}

const spec: TabloidSpec = {
  eqStyle: EQ_STYLE,
  paintFirst(p: Painter, ctx: FirstPageContext): FirstPageResult | null {
    const { d, input } = ctx;
    const bottom = ctx.footerTop * 0.612 - 6;
    const m: Ym = (px) => 28 + (px - REF_TOP) * ((bottom - 28) / (REF_BOTTOM - REF_TOP));
    paintHeader(p, d, m);
    const optionsEnd = paintPricing(p, d, m);
    if (optionsEnd === null) return null;
    paintRight(p, d, input, m);

    const warranty = warrantySection(d, "Owner Benefits:");
    const sections = buildSections(input);
    const entries: FlowEntry[] = [];
    entries.push({ text: "Owner Benefits:", heading: true, gapBefore: 0 });
    for (const item of warranty ? warranty.items : ["Warranty terms are not available for this vehicle."]) entries.push({ text: item, heading: false, gapBefore: 0 });
    entries.push({ text: "STANDARD FEATURES", heading: true, gapBefore: 8 });
    if (!sections.length) entries.push({ text: "Standard equipment not available for this vehicle.", heading: false, gapBefore: 0, note: true });
    entries.push(...toEntries(sections, (s) => s, 5, undefined, input.equipmentNote));
    const col = (a: number, b: number, y0: number, y1: number) => ({ x: Q(X(a)), w: Q(X(b - a)), top: Q(y0), bottom: Q(y1) });
    const lowTop = optionsEnd + 12;
    const thirdTop = m(62) + 0.7 * 453 + 8;
    const n = 1 + ctx.extraColumns;
    const gap = 12;
    const w = (455 - gap * (n - 1)) / n;
    const third = Array.from({ length: n }, (_, i) => col(620 + i * (w + gap), 620 + i * (w + gap) + w, thirdTop, m(1030)));
    const cols = [col(52, 288, m(185), m(1040) - 86), col(293, 600, lowTop, m(1040) - 86), ...third];
    const { placed, rest } = flow(entries, cols, ctx.style);
    paintPlaced(p, placed, ctx.style, { headingFont: "bold" });
    return placedResult(entries, rest);
  },
};

export const buildAstonMartinVantageRoadsterGasLayout: VariantLayoutBuilder = (input): LayoutModel | null => {
  const model = assembleTabloid(input, spec);
  if (model && (model.width !== TABLOID_WIDTH || model.height !== TABLOID_HEIGHT)) return null;
  return model;
};
