// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/render/variants/volvoXc60B5.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// 17x11 reproduction layout for the 2025 Volvo XC60 B5 (mild hybrid gasoline),
// translated from "Volvo_2025_XC60_B5_AWD_Plus" (Figma file ZSb0xcK1N6bcFnqlM5jevY,
// master 1:393). Geometry is written in the reference's 100 dpi pixels and
// mapped by a Grid that keeps the horizontals and compresses verticals to clear
// the mandatory reproduction banner and disclosure.
//
// Every printed value comes from render data. The reference prints no logo
// artwork (a "2025 VOLVO" line and the model logotype, which prints as the
// record's own model and trim); the category icons, the accessories QR, agency
// seals and the source barcode are not reproduced. The maintenance programme
// has no record field and prints its unavailable state. Free columns of the
// reference carry overflow standard equipment.

import type { FactoryStickerData } from "../../types.ts";
import { Painter, type LayoutModel } from "../layout.ts";
import { INK, type VariantLayoutBuilder } from "./shared.ts";
import { R, T, wrap } from "./hyundaiTucsonGas.ts";
import {
  TABLOID_HEIGHT, TABLOID_WIDTH, assembleTabloid, buildSections, colorText, dealerLines, flow, paintPlaced, placedResult, priceRowsWithoutColors,
  toEntries, totalMsrp, warrantySection,
  type ColumnSpec, type FirstPageContext, type FirstPageResult, type FlowStyle, type TabloidSpec,
} from "./tabloidCommon.ts";
import { PX, Q, makeGrid, money, paintCatalogEpa, paintCatalogParts, paintCatalogSafety, paintPriceLines } from "./catalogBlocks.ts";
import { fitSize } from "./fcaCommon.ts";

export const VOLVO_XC60_B5_ID = "volvo_2025_xc60_b5_awd_plus";

const EQ_STYLE: FlowStyle = { size: 13, lh: 15, hang: 6, inset: 0 };
const g = makeGrid(30, 52, 709, 1027);

const PRICE_NOTE = "The price shown does not include License and Title Fees, State and Local Taxes and Dealer Installed Options and Accessories. The factory reserves the right to modify price, designs and equipment without previous notice.";

function heading(p: Painter, s: string, x: number, top: number, w: number): number {
  T(p, s, x, top, 11.6, "bold");
  R(p, x, top + 15, w, 1.4, INK);
  return top + 21;
}

function lines(p: Painter, text: string[], x: number, top: number, w: number, size = 6.8): number {
  let y = top;
  for (const t of text) {
    for (const l of wrap(t, "body", size, w)) {
      T(p, l, x, y, size, "body");
      y += size + 2.2;
    }
  }
  return y;
}

function paintIdentity(p: Painter, d: FactoryStickerData): void {
  const v = d.vehicle;
  const year = [v.year > 0 ? String(v.year) : "", v.make].filter(Boolean).join(" ").toUpperCase();
  if (year) T(p, year, g.x(64), g.y(52), 8.4, "body");
  const title = [v.model, v.trim ?? ""].filter(Boolean).join(" ").toUpperCase();
  if (title) T(p, title, g.x(64), g.y(80), fitSize(title, "bold", 30, 560 * PX, 16), "bold");
  T(p, "Volvo Cars USA LLC", g.x(835), g.y(122), 6.2, "body", { align: "right" });
  T(p, "www.volvocars.com/us", g.x(835), g.y(132), 6.2, "body", { align: "right" });
}

function paintMiddle(p: Painter, d: FactoryStickerData): number {
  const x = g.x(359);
  const w = 282 * PX;
  let y = heading(p, "AUTHORIZED RETAILER", x, g.y(151), w);
  const dealer = dealerLines(d);
  y = lines(p, dealer.length ? dealer : [], x, y, w, 7.2) + 8;
  y = heading(p, "ACCESSORIES", x, y, w);
  y = lines(p, ["Enhance the driving pleasure with Volvo accessories. Enrich the styling, integrate technology, boost performance, or simply carry more cargo - from function to fun, there's something for everyone.", "To view the full accessory line visit https://accessories.volvocars.com/en-us"], x, y, w) + 8;
  y = heading(p, "JOIN THE CONVERSATION", x, y, w);
  y = lines(p, ["See what our fans are saying about Volvo and join in!", "Have a question?", "Instagram: @VolvoCarUSA", "Facebook: Volvo Car USA", "YouTube: Volvo Car USA"], x, y, w) + 8;
  y = heading(p, "WARRANTY", x, y, w);
  const warranty = warrantySection(d, "Warranty");
  y = lines(p, warranty ? warranty.items : ["Not available for this vehicle."], x, y, w) + 8;
  y = heading(p, "MAINTENANCE", x, y, w);
  return lines(p, ["Not available for this vehicle."], x, y, w) + 8;
}

/** Returns the y below the pricing block, or null when the option rows cannot fit. */
function paintPricing(p: Painter, d: FactoryStickerData): number | null {
  const x = g.x(651);
  const right = g.x(937);
  const w = 289 * PX;
  let y = heading(p, "PRICING", x, g.y(151), w);
  const msrpLines = wrap("Manufacturer's Suggested Retail Price:", "bold", 8, 135);
  msrpLines.forEach((l, i) => T(p, l, x, y + i * 10, 8, "bold"));
  T(p, money(d.pricing.baseMsrp), right, y, 8, "bold", { align: "right" });
  y += msrpLines.length * 10 + 6;
  const end = paintPriceLines(p, priceRowsWithoutColors(d), x, right, y, g.y(900), { size: 7.6, labelW: 200 * PX });
  if (end === null) return null;
  y = end + 4;
  T(p, "Destination Charge", x, y, 8, "bold");
  T(p, money(d.pricing.destinationCharge), right, y, 8, "bold", { align: "right" });
  y += 14;
  T(p, "Total Suggested Retail Price:", x, y, 8.4, "bold");
  T(p, money(totalMsrp(d)), right, y, 8.4, "bold", { align: "right" });
  return y + 16;
}

function paintRight(p: Painter, d: FactoryStickerData, barcode: string): void {
  const v = d.vehicle;
  paintCatalogEpa(p, d, g, 950, 50);
  paintCatalogParts(p, d, g.x(950), g.y(508), 242 * PX, g.y(1025) - g.y(508), 1);
  paintCatalogSafety(p, d, g.x(1197), g.y(510), 453 * PX, g.y(855) - g.y(510));

  const top = g.y(860);
  const h = g.y(955) - top;
  R(p, g.x(1197), top, 175 * PX, h, null, 1);
  T(p, "VEHICLE IDENTIFICATION", g.x(1204), top + 3, 6.2, "bold");
  const ident: Array<[string, string | null]> = [
    ["Model Year:", v.year > 0 ? String(v.year) : null],
    ["Ext:", colorText(v.exteriorColor, v.exteriorColorCode)],
    ["Int:", colorText(v.interiorColor, v.interiorColorCode)],
    ["VIN:", v.vin],
  ];
  ident.filter(([, val]) => val).forEach(([k, val], i) => T(p, `${k}${val}`, g.x(1204), top + 14 + i * 9.4, 6.2, "body"));
  R(p, g.x(1377), top, 273 * PX, h, null, 1);
  T(p, "DELIVERY", g.x(1385), top + 3, 6.2, "bold");
  let y = top + 14;
  if (d.factory.transportMethod) {
    T(p, `Delivered By: ${d.factory.transportMethod}`, g.x(1385), y, 6.2, "body");
    y += 9.4;
  }
  T(p, "DELIVERY ADDRESS", g.x(1385), y, 6.2, "bold");
  dealerLines(d).slice(0, 3).forEach((l, i) => T(p, l, g.x(1385), y + 9.4 + i * 9.4, 6.2, "body"));

  const bTop = g.y(958);
  const bH = g.y(1025) - bTop;
  R(p, g.x(1197), bTop, 453 * PX, bH, null, 1);
  if (barcode) {
    p.barcode(g.x(1215), bTop + 4, 417 * PX, bH - 16, barcode, INK);
    T(p, barcode, g.x(1423), bTop + bH - 11, 6.4, "body", { align: "center" });
  }
}

const spec: TabloidSpec = {
  eqStyle: EQ_STYLE,
  paintFirst(p: Painter, ctx: FirstPageContext): FirstPageResult | null {
    const { d, input } = ctx;
    paintIdentity(p, d);
    const midEnd = paintMiddle(p, d);
    const priceEnd = paintPricing(p, d);
    if (priceEnd === null) return null;

    R(p, g.x(359), g.y(958), 278 * PX, g.y(1025) - g.y(958), null, 1);
    wrap(PRICE_NOTE, "body", 6.4, 266 * PX).forEach((l, i) => T(p, l, g.x(365), g.y(963) + i * 7.4, 6.4, "body"));

    const sections = buildSections(input);
    if (!sections.length) T(p, "Standard equipment not available for this vehicle.", g.x(66), g.y(160), 8, "body");
    const entries = toEntries(sections, (s) => s.toUpperCase(), 4, undefined, input.equipmentNote);
    const mainX = Q(g.x(66));
    const mainW = Q(282 * PX);
    const split = ctx.extraColumns + 1;
    const gap = 10;
    const colW = (mainW - gap * (split - 1)) / split;
    const cols: ColumnSpec[] = Array.from({ length: split }, (_, i) => ({ x: mainX + i * (colW + gap), w: colW, top: Q(g.y(160)), bottom: Q(g.y(1018)) }));
    cols.push({ x: Q(g.x(359)), w: Q(282 * PX), top: Q(midEnd), bottom: Q(g.y(950)) });
    cols.push({ x: Q(g.x(651)), w: Q(289 * PX), top: Q(priceEnd), bottom: Q(g.y(950)) });
    const { placed, rest } = flow(entries, cols, ctx.style);
    paintPlaced(p, placed, ctx.style, { headingFont: "bold" });
    paintRight(p, d, input.layout.barcodePayload);
    return placedResult(entries, rest);
  },
};

export const buildVolvoXc60B5Layout: VariantLayoutBuilder = (input): LayoutModel | null => {
  const model = assembleTabloid(input, spec);
  if (model && (model.width !== TABLOID_WIDTH || model.height !== TABLOID_HEIGHT)) return null;
  return model;
};
