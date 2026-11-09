// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/render/variants/hondaOdysseyGas.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// Letter-landscape reproduction layout for the 2026 Honda Odyssey (gasoline),
// translated from "Honda_2026_Odyssey_Touring" (Figma file bYlV3mnBv5YlIpZauBSaib,
// master 2:821). The reference PDF is a 612x792 portrait page that holds a scan
// of a landscape label stored sideways (Page rot 0, no text layer); the label is
// landscape, so the render is upright at 792x612pt (reference_stored_rotated).
//
// Every printed value comes from render data. The Honda logo is damaged in the
// scan, so a wordmark prints (missing_source_artwork). The fuel-economy panel is
// the shared 17x11 panel drawn at 87% so every line stays at or above 5.5pt.
// The engine number, MOB code, full-tank statement, agency seals, source QR and
// the second barcode are not reproduced.

import type { FactoryStickerData } from "../../types.ts";
import { Painter, measureText } from "../layout.ts";
import { INK, type VariantLayoutBuilder } from "./shared.ts";
import { R, T, wrap } from "./hyundaiTucsonGas.ts";
import {
  buildSections, colorText, dealerLines, flow, paintPlaced, placedResult, priceRowsWithoutColors, toEntries, totalMsrp, warrantySection,
  type ColumnSpec, type FirstPageContext, type FirstPageResult, type FlowStyle, type TabloidSpec,
} from "./tabloidCommon.ts";
import {
  EPA_PANEL_H, PRICE_FOOTNOTE, Q, makeGrid, money, paintCatalogEpa, paintCatalogParts, paintCatalogSafety, paintPriceLines, paintWarranty,
} from "./catalogBlocks.ts";
import { catalogPageBuilder } from "./catalogPage.ts";
import { paintScaled } from "./scaledPanel.ts";
import { fitSize } from "./fcaCommon.ts";

export const HONDA_ODYSSEY_GAS_ID = "honda_2026_odyssey_touring";

export const HONDA_PAGE = { widthPt: 792, heightPt: 612 } as const;

const EQ_STYLE: FlowStyle = { size: 11.4, lh: 13, hang: 5, inset: 0 };

const LEFT = 22;
const EQ_W = 246;
const PRICE_X = 278;
const PRICE_W = 120;
const BOTTOM_W = PRICE_X + PRICE_W - LEFT;
const RIGHT = 408;
const RIGHT_W = 364;
const EPA_SCALE = RIGHT_W / (700 * 0.72);

function paintTitle(p: Painter, d: FactoryStickerData): void {
  const v = d.vehicle;
  T(p, "HONDA", LEFT, 32, 28, "bold");
  const x = 128;
  const w = PRICE_X + PRICE_W - x;
  R(p, x, 30, w, 42, null, 1);
  const title = [v.year > 0 ? String(v.year) : "", v.model, v.trim ?? ""].filter(Boolean).join(" ").toUpperCase();
  if (title) T(p, title, x + 5, 34, fitSize(title, "bold", 12, w - 10, 8), "bold");
  const ext = colorText(v.exteriorColor, v.exteriorColorCode);
  const int = colorText(v.interiorColor, v.interiorColorCode);
  if (ext) T(p, `EXT: ${ext}`, x + 5, 50, 6.6, "bold");
  if (int) T(p, `INT: ${int}`, x + 5, 60, 6.6, "bold");
}

/** The price list is its own column, as on the reference; returns the y below it, or null when the option rows cannot fit. */
function paintPrices(p: Painter, d: FactoryStickerData, top: number, optionsLimit: number): number | null {
  const left = PRICE_X;
  const right = PRICE_X + PRICE_W;
  let y = top;
  wrap("Manufacturer's Suggested Retail Price", "bold", 7.2, PRICE_W - 4).forEach((l, i) => T(p, l, left, y + i * 8.4, 7.2, "bold"));
  y += 2 * 8.4 + 1;
  T(p, money(d.pricing.baseMsrp), right, y, 8.6, "bold", { align: "right" });
  y += 14;
  R(p, left, y - 3, PRICE_W, 1, INK);
  const end = paintPriceLines(p, priceRowsWithoutColors(d), left, right, y + 1, optionsLimit, { size: 6.8, labelW: PRICE_W - 40 });
  if (end === null) return null;
  y = end + 4;
  const warranty = warrantySection(d, "Warranty");
  y = paintWarranty(p, d, warranty ? warranty.items.slice(0, 1) : null, left, y, PRICE_W, "WARRANTY") + 6;
  const destination = money(d.pricing.destinationCharge);
  T(p, "Destination and Handling", left, y, 7, "body");
  if (measureText("Destination and Handling", "body", 7) + measureText(destination, "body", 7) + 6 > PRICE_W) y += 8.4;
  T(p, destination, right, y, 7, "body", { align: "right" });
  y += 12;
  R(p, left, y - 2, PRICE_W, 1, INK);
  T(p, "TOTAL VEHICLE PRICE", left, y + 1, 7.4, "bold");
  y += 11;
  T(p, money(totalMsrp(d)), right, y + 1, 9.4, "bold", { align: "right" });
  y += 16;
  const note = wrap(PRICE_FOOTNOTE, "body", 5.8, PRICE_W);
  note.forEach((l, i) => T(p, l, left, y + i * 6.8, 5.8, "body"));
  return y + note.length * 6.8;
}

function paintBottomLeft(p: Painter, d: FactoryStickerData, top: number, barcode: string): void {
  const v = d.vehicle;
  T(p, "DELIVERED TO:", LEFT, top, 6.2, "bold");
  if (d.factory.dealerCode) T(p, d.factory.dealerCode.toUpperCase(), LEFT + BOTTOM_W, top, 6.2, "bold", { align: "right" });
  dealerLines(d).slice(0, 3).forEach((l, i) => T(p, l, LEFT + 6, top + 8 + i * 7.4, 6.4, "body"));
  const facts = [d.factory.transportMethod ? `TRANS. METHOD: ${d.factory.transportMethod.toUpperCase()}` : "", d.factory.emissionsCode ? `EMISSION: ${d.factory.emissionsCode.toUpperCase()}` : ""].filter(Boolean);
  facts.forEach((l, i) => T(p, l, LEFT + 150, top + 8 + i * 7.4, 6.2, "body"));
  T(p, `VIN: ${v.vin}`, LEFT, top + 31, 8, "bold");
  if (barcode) p.barcode(LEFT, top + 42, BOTTOM_W, 22, barcode, INK);
}

const spec: TabloidSpec = {
  eqStyle: EQ_STYLE,
  paintFirst(p: Painter, ctx: FirstPageContext): FirstPageResult | null {
    const { d, input } = ctx;
    paintTitle(p, d);
    T(p, "STANDARD EQUIPMENT AT NO EXTRA COST", LEFT, 78, 8, "bold");

    const priceEnd = paintPrices(p, d, 78, 300);
    if (priceEnd === null || priceEnd > 462) return null;
    paintBottomLeft(p, d, 470, input.layout.barcodePayload);

    const sections = buildSections(input);
    if (!sections.length) T(p, "Standard equipment not available for this vehicle.", LEFT, 92, 7, "body");
    const entries = toEntries(sections, (s) => s.toUpperCase(), 3, undefined, input.equipmentNote);
    const split = ctx.extraColumns + 2;
    const gap = 10;
    const colW = (Q(EQ_W) - gap * (split - 1)) / split;
    const cols: ColumnSpec[] = Array.from({ length: split }, (_, i) => ({ x: Q(LEFT) + i * (colW + gap), w: colW, top: Q(90), bottom: Q(462) }));
    const { placed, rest } = flow(entries, cols, ctx.style);
    paintPlaced(p, placed, ctx.style, { headingFont: "bold" });

    const g = makeGrid(0, 0, EPA_PANEL_H * 0.78, EPA_PANEL_H);
    paintScaled(p, EPA_SCALE, RIGHT, 30, (q) => paintCatalogEpa(q, d, g, 0, 0, { scale: EPA_SCALE }));
    // Reference order under the fuel-economy panel: the parts-content box on
    // the left and the safety ratings beside it, sharing one band.
    const bandTop = 30 + EPA_PANEL_H * 0.78 * EPA_SCALE + 5;
    const partsW = 116;
    const safetyX = RIGHT + partsW + 6;
    paintCatalogParts(p, d, RIGHT, bandTop, partsW, 540 - bandTop, 1);
    paintCatalogSafety(p, d, safetyX, bandTop, RIGHT + RIGHT_W - safetyX, 540 - bandTop);
    return placedResult(entries, rest);
  },
};

export const buildHondaOdysseyGasLayout: VariantLayoutBuilder = catalogPageBuilder(spec, HONDA_PAGE as { widthPt: number; heightPt: number });
