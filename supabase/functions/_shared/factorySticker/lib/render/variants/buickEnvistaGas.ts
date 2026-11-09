// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/render/variants/buickEnvistaGas.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
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
  TABLOID_HEIGHT, TABLOID_WIDTH, assembleTabloid, priceRowsWithoutColors, totalMsrp, warrantySection, yearModelTrim,
  type FirstPageContext, type FirstPageResult, type TabloidSpec,
} from "./tabloidCommon.ts";
import {
  PRICE_FOOTNOTE, PX, money, optionsTotalOf, paintCatalogEpa, paintCatalogParts, paintCatalogSafety,
  paintPriceLines, paintWarranty,
} from "./catalogBlocks.ts";
import { GM_EQ_STYLE, flowGmEquipment, gmGrid, paintGmEquipmentFrame, paintGmSpecColumns, paintGmVinDealer } from "./gmCommon.ts";

export const BUICK_ENVISTA_GAS_ID = "buick_2026_envista_avenir";

const g = gmGrid();

function paintHeader(p: Painter, d: FactoryStickerData): void {
  const logo = VARIANT_LOGOS.buick;
  const w = 375 * PX;
  p.image(logo.png, logo.assetId, g.x(58), g.y(62), w, (w * logo.slot.h) / logo.slot.w);
  T(p, yearModelTrim(d, ["year", "model", "trim"], d.vehicle.make), g.x(597), g.y(66), 17, "bold");
  paintGmSpecColumns(p, d, g, { leftX: 961, rightX: 1236, leftW: 265, rightW: 400 });
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
  eqStyle: GM_EQ_STYLE,
  paintFirst(p: Painter, ctx: FirstPageContext): FirstPageResult | null {
    const { d, input } = ctx;
    if (!paintPrices(p, d)) return null;
    paintHeader(p, d);

    paintGmEquipmentFrame(p, g, ctx.extraColumns ? [] : [310, 585, 850, 1125, 1388]);
    const equipment = flowGmEquipment(p, ctx, g, [[50, 252], [320, 258], [592, 254], [858, 262], [1134, 250]]);

    paintCatalogEpa(p, d, g, 45, 575, { flexFuel: true });
    const top = g.y(575);
    paintCatalogSafety(p, d, g.x(750), top, 450 * PX, g.y(925) - top);
    paintCatalogParts(p, d, g.x(1205), top, 445 * PX, g.y(900) - top, 2);

    const w = warrantySection(d, "Warranty");
    paintWarranty(p, d, w ? w.items : null, g.x(760), g.y(940), 430 * PX);
    wrap(PRICE_FOOTNOTE, "body", 6.6, 430 * PX).forEach((l, i) => T(p, l, g.x(760), g.y(1010) + i * 7.4, 6.6, "body"));

    paintGmVinDealer(p, d, input.layout.barcodePayload, g, { x: 1208, vinY: 912, dealerY: 938, dealerLinesY: 954, assemblyY: 1016, barcodeY: 1004, barcodeX: 1330 });
    return equipment;
  },
};

export const buildBuickEnvistaGasLayout: VariantLayoutBuilder = (input): LayoutModel | null => {
  const model = assembleTabloid(input, spec);
  if (model && (model.width !== TABLOID_WIDTH || model.height !== TABLOID_HEIGHT)) return null;
  return model;
};
