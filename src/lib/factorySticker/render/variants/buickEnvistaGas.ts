// 17x11 reproduction layout for the 2026 Buick Envista (gasoline), translated
// from the handoff geometry of "Buick_2026_Envista_Avenir" (Figma file
// sCNlNdmOzOx1C7jxt3wMBq, master 2:466). Geometry is written in the reference
// PDF's 100 dpi pixels and mapped onto the page by a Grid that keeps the
// horizontals and compresses verticals to clear the mandatory reproduction
// banner above and disclosure below.
//
// Every printed value comes from render data; nothing from the reference
// sample is used as a default. The adhesive-strip notice, the OnStar
// advertisement, the source and order-information QR codes, agency seals, the
// Smartphone QR (the 0.90in Vehicle Passport QR takes its slot), the driving-
// range bars, the sales codes and the federal-law label statement are
// intentionally not reproduced.

import type { FactoryStickerData } from "../../types.ts";
import type { LayoutModel, Painter } from "../layout.ts";
import { VARIANT_LOGOS } from "./logoArtwork.ts";
import { INK, PAPER, type VariantLayoutBuilder } from "./shared.ts";
import { R, T, wrap } from "./hyundaiTucsonGas.ts";
import {
  TABLOID_HEIGHT, TABLOID_WIDTH, assembleTabloid, buildSections, colorText, dealerLines, flow, paintPlaced, placedResult,
  priceRowsWithoutColors, toEntries, totalMsrp, warrantySection, withColumns, yearModelTrim,
  type FirstPageContext, type FirstPageResult, type FlowStyle, type TabloidSpec,
} from "./tabloidCommon.ts";
import {
  PRICE_FOOTNOTE, PX, Q, makeGrid, money, optionsTotalOf, paintCatalogEpa, paintCatalogParts, paintCatalogSafety,
  paintPriceLines, paintWarranty,
} from "./catalogBlocks.ts";

export const BUICK_ENVISTA_GAS_ID = "buick_2026_envista_avenir";

const EQ_STYLE: FlowStyle = { size: 13.2, lh: 15.2, hang: 6, inset: 0 };
const g = makeGrid(30, 58, 709, 1045);

function paintHeader(p: Painter, d: FactoryStickerData): void {
  const logo = VARIANT_LOGOS.buick;
  const w = 375 * PX;
  p.image(logo.png, logo.assetId, g.x(58), g.y(62), w, (w * logo.slot.h) / logo.slot.w);
  const v = d.vehicle;
  T(p, yearModelTrim(d, ["year", "model", "trim"], v.make), g.x(597), g.y(66), 17, "bold");
  const left: Array<[string, string | null]> = [
    ["EXTERIOR", colorText(v.exteriorColor, v.exteriorColorCode)],
    ["INTERIOR", colorText(v.interiorColor, v.interiorColorCode)],
  ];
  const right: Array<[string, string | null]> = [["ENGINE", v.engine ? v.engine.toUpperCase() : null], ["TRANSMISSION", v.transmission ? v.transmission.toUpperCase() : null]];
  const col = (rows: Array<[string, string | null]>, x: number, widthPx: number): void => {
    let y = 64;
    for (const [label, value] of rows) {
      if (!value) continue;
      for (const l of wrap(`${label}: ${value}`, "bold", 8.6, widthPx * PX).slice(0, 2)) {
        T(p, l, g.x(x), g.y(y), 8.6, "bold");
        y += 15;
      }
    }
  };
  col(left, 961, 265);
  col(right, 1236, 400);
  T(p, "Visit us at www.buick.com", g.x(1128), g.y(148), 9, "bold");
}

/** Returns false when the price panel cannot hold the option rows. */
function paintPrices(p: Painter, d: FactoryStickerData): boolean {
  const L = g.x(1398);
  const Rt = g.x(1646);
  T(p, "MANUFACTURER'S SUGGESTED RETAIL PRICE", Rt, g.y(172), 6.4, "body", { align: "right" });
  R(p, g.x(1396), g.y(188), 252 * PX, g.y(222) - g.y(188), null, 2);
  const base = d.pricing.baseMsrp;
  T(p, "STANDARD VEHICLE PRICE", L + 3, g.y(197), 7.2, "bold");
  T(p, money(base), Rt - 3, g.y(197), base !== undefined ? 8.6 : 7, "bold", { align: "right" });
  R(p, g.x(1396), g.y(238), 252 * PX, g.y(272) - g.y(238), INK);
  T(p, "OPTIONS & PRICING", L + 6, g.y(246), 10, "bold", { color: PAPER });
  wrap("OPTIONS INSTALLED BY THE MANUFACTURER (MAY REPLACE STANDARD EQUIPMENT SHOWN)", "body", 5.8, 245 * PX)
    .forEach((l, i) => T(p, l, L, g.y(280) + i * 6.6, 5.8, "body"));
  if (paintPriceLines(p, priceRowsWithoutColors(d), L, Rt, g.y(312), g.y(448), { size: 8, labelW: 122 }) === null) return false;
  if (d.pricing.gasGuzzlerTax !== undefined) {
    T(p, "GAS GUZZLER TAX", L, g.y(452), 7.4, "body");
    T(p, money(d.pricing.gasGuzzlerTax), Rt, g.y(452), 7.4, "body", { align: "right" });
  }
  const rows: Array<[string, string]> = [
    ["TOTAL OPTIONS", money(optionsTotalOf(d))],
    ["DESTINATION CHARGE", money(d.pricing.destinationCharge)],
  ];
  rows.forEach(([label, value], i) => {
    T(p, label, L, g.y(468) + i * 15, 7.6, "body");
    T(p, value, Rt, g.y(468) + i * 15, 7.6, "body", { align: "right" });
  });
  R(p, g.x(1396), g.y(515), 252 * PX, g.y(547) - g.y(515), null, 2);
  const total = totalMsrp(d);
  T(p, "TOTAL VEHICLE PRICE*", L + 3, g.y(524), 7.2, "bold");
  T(p, money(total), Rt - 3, g.y(524), total !== undefined ? 8.6 : 7, "bold", { align: "right" });
  return true;
}

const spec: TabloidSpec = {
  eqStyle: EQ_STYLE,
  paintFirst(p: Painter, ctx: FirstPageContext): FirstPageResult | null {
    const { d, input } = ctx;
    if (!paintPrices(p, d)) return null;
    paintHeader(p, d);

    R(p, g.x(45), g.y(166), 258 * PX, g.y(196) - g.y(166), INK);
    T(p, "STANDARD EQUIPMENT", g.x(54), g.y(173), 10.4, "bold", { color: PAPER });
    wrap("ITEMS FEATURED BELOW ARE INCLUDED AT NO EXTRA CHARGE IN THE STANDARD VEHICLE PRICE SHOWN", "body", 5.8, 245 * PX)
      .forEach((l, i) => T(p, l, g.x(50), g.y(202) + i * 6.6, 5.8, "body"));
    for (const x of [310, 585, 850, 1125, 1388]) R(p, g.x(x), g.y(166), 0.8, g.y(566) - g.y(166), INK);
    R(p, g.x(45), g.y(566), 1610 * PX, 1.2, INK);

    const sections = buildSections(input);
    if (!sections.length) T(p, "Standard equipment not available for this vehicle.", g.x(50), g.y(228), 8, "body");
    const entries = toEntries(sections, (s) => s.toUpperCase(), 3, undefined, input.equipmentNote);
    const colsBase = [[50, 252], [320, 258], [592, 254], [858, 262], [1134, 250]];
    const base = colsBase.map(([x, w], i) => ({ x: Q(g.x(x)), w: Q(w * PX), top: Q(g.y(i === 0 ? 232 : 172)), bottom: Q(g.y(562)) }));
    const cols = withColumns(base, ctx.extraColumns);
    const { placed, rest } = flow(entries, cols, ctx.style);
    paintPlaced(p, placed, ctx.style, { headingFont: "bold" });

    paintCatalogEpa(p, d, g, 45, 575);
    const top = g.y(575);
    paintCatalogSafety(p, d, g.x(750), top, 450 * PX, g.y(925) - top);
    paintCatalogParts(p, d, g.x(1205), top, 445 * PX, g.y(900) - top, 2);

    const w = warrantySection(d, "Warranty");
    paintWarranty(p, d, w ? w.items : null, g.x(760), g.y(940), 430 * PX);
    wrap(PRICE_FOOTNOTE, "body", 6.6, 430 * PX).forEach((l, i) => T(p, l, g.x(760), g.y(1010) + i * 7.4, 6.6, "body"));

    T(p, `VIN ${d.vehicle.vin}`, g.x(1208), g.y(912), 9.6, "bold");
    T(p, "DEALER TO WHOM DELIVERED", g.x(1208), g.y(938), 6.6, "bold");
    if (d.factory.dealerCode) T(p, d.factory.dealerCode.toUpperCase(), g.x(1208) + 100, g.y(938), 6.6, "bold");
    dealerLines(d).slice(0, 3).forEach((l, i) => T(p, l, g.x(1208), g.y(954) + i * 9.4, 8.2, "bold"));
    if (d.factory.finalAssemblyPoint) T(p, `ASSEMBLY POINT: ${d.factory.finalAssemblyPoint.toUpperCase()}`, g.x(1208), g.y(1016), 6.6, "body");
    if (input.layout.barcodePayload) p.barcode(g.x(1330), g.y(1004), 318 * PX, g.y(1040) - g.y(1004), input.layout.barcodePayload, INK);
    return placedResult(entries, rest);
  },
};

export const buildBuickEnvistaGasLayout: VariantLayoutBuilder = (input): LayoutModel | null => {
  const model = assembleTabloid(input, spec);
  if (model && (model.width !== TABLOID_WIDTH || model.height !== TABLOID_HEIGHT)) return null;
  return model;
};
