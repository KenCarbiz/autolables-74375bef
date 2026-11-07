// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/render/variants/bentleyContinentalGtPhev.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// Reproduction layout for the 2026 Bentley Continental GT Azure (plug-in
// hybrid) on the reference's own 1159.29 x 697.01 pt page, translated from
// "Bentley_2026_Continental_GT_Azure" (Figma file z4BdUP0OCHnaktjScEcCNG,
// master 1:429). Geometry is written in the reference's 100 dpi pixels
// (1611 x 969) and mapped by a Grid that keeps the horizontals and compresses
// verticals to clear the mandatory banner and disclosure strips.
//
// Every printed value comes from render data. The winged emblem and BENTLEY
// wordmark are taken from the reference label PDF (logoArtwork.ts); the tagline, the source QR, agency
// seals and the "affixed pursuant to" legal wording are not reproduced, and
// the plug-in panel prints Not Available for every figure the verified EPA
// record does not carry.

import type { FactoryStickerData } from "../../types.ts";
import { Painter, type LayoutModel } from "../layout.ts";
import { PAPER, type VariantLayoutBuilder } from "./shared.ts";
import { R, T, wrap } from "./hyundaiTucsonGas.ts";
import { colorText, dealerLines, type FirstPageContext, type FirstPageResult, type FlowStyle, type TabloidSpec } from "./tabloidCommon.ts";
import { PRICE_FOOTNOTE, PX, isNhtsaRated, makeGrid, money, paintCatalogParts, paintCatalogSafety } from "./catalogBlocks.ts";
import { paintEvEpa } from "./evPanels.ts";
import { VARIANT_LOGOS } from "./logoArtwork.ts";
import { catalogPageBuilder, flowEquipmentColumns, paintPriceList, paintTotals } from "./catalogPage.ts";

export const BENTLEY_CONTINENTAL_GT_PHEV_ID = "bentley_2026_continental_gt_azure";

export const BENTLEY_PAGE = { widthPt: 1159.29, heightPt: 697.01, frame: "#27493a" } as const;

const EQ_STYLE: FlowStyle = { size: 12.8, lh: 14.8, hang: 6, inset: 0 };

function paintDealerBox(p: Painter, g: ReturnType<typeof makeGrid>, x: number, label: string, lines: string[], extra: string[]): void {
  R(p, g.x(x), g.y(30), 300 * PX, g.y(112) - g.y(30), PAPER);
  T(p, label, g.x(x + 8), g.y(36), 7.4, "bold");
  [...lines, ...extra].slice(0, 6).forEach((l, i) => T(p, l, g.x(x + 8), g.y(52) + i * 8.6, 6.8, "body"));
}

const spec: TabloidSpec = {
  eqStyle: EQ_STYLE,
  paintFirst(p: Painter, ctx: FirstPageContext): FirstPageResult | null {
    const { d, input } = ctx;
    const g = makeGrid(32, 30, ctx.footerTop * 0.612 - 8, 935);
    const v = d.vehicle;
    R(p, g.x(30), g.y(30), 850 * PX, g.y(935) - g.y(30), PAPER);

    const title = [v.year > 0 ? String(v.year) : "", v.model, v.trim ?? ""].filter(Boolean).join(" ");
    T(p, title, g.x(40), g.y(40), 22, "bold");
    const logo = VARIANT_LOGOS.bentley;
    p.image(logo.png, logo.assetId, g.x(logo.slot.x), g.y(logo.slot.y), logo.slot.w * PX, g.y(logo.slot.y + logo.slot.h) - g.y(logo.slot.y));
    const facts: Array<[string, string | null]> = [
      ["Exterior:", colorText(v.exteriorColor, v.exteriorColorCode)],
      ["Main Hide:", colorText(v.interiorColor, v.interiorColorCode)],
      ["VIN:", v.vin],
    ];
    const drive: Array<[string, string | null]> = [
      ["Engine:", v.engine ?? null],
      ["Transmission:", v.transmission ?? null],
    ];
    let fx = g.x(40);
    for (const [label, value] of facts) {
      if (!value) continue;
      T(p, label, fx, g.y(134), 7.2, "bold");
      const lw = label.length * 4.2 + 3;
      T(p, value, fx + lw, g.y(134), 7.2, "body");
      fx += lw + value.length * 4 + 18;
    }

    fx = g.x(40);
    for (const [label, value] of drive) {
      if (!value) continue;
      T(p, label, fx, g.y(148), 7.2, "bold");
      const lw = label.length * 4.2 + 3;
      T(p, value, fx + lw, g.y(148), 7.2, "body");
      fx += lw + value.length * 4 + 18;
    }

    T(p, "MANUFACTURER'S SUGGESTED RETAIL PRICE", g.x(40), g.y(166), 9, "bold");
    const left = g.x(40);
    const right = g.x(463);
    T(p, [v.year > 0 ? String(v.year) : "", v.model, v.trim ?? ""].filter(Boolean).join(" "), left, g.y(190), 7.8, "body");
    T(p, money(d.pricing.baseMsrp), right, g.y(190), 7.8, "body", { align: "right" });
    const end = paintPriceList(p, d, { x: left, y: g.y(208), w: right - left, limit: g.y(560), amountRight: right });
    if (end === null) return null;
    const totalsY = end + 10;
    paintTotals(p, d, { x: left, right, y: totalsY, destinationLabel: "Destination Charge", totalLabel: "Total Suggested Retail Price", size: 7.8 });
    const noteY = totalsY + 34;
    const noteLines = wrap(PRICE_FOOTNOTE, "body", 6.2, right - left);
    noteLines.forEach((l, i) => T(p, l, left, noteY + i * 7.2, 6.2, "body"));
    const tailTop = noteY + noteLines.length * 7.2 + 8;
    const barcodeTop = g.y(884);
    if (tailTop > barcodeTop - 20) return null;
    const rated = isNhtsaRated(d);
    const leftPartsTop = Math.max(tailTop + 4, g.y(742));
    if (rated && leftPartsTop > barcodeTop - 40) return null;

    const result = flowEquipmentColumns(p, ctx, [{ x: g.x(478), w: 385 * PX, top: g.y(152), bottom: g.y(925) }], {
      tail: [{ x: left, w: right - left, top: tailTop, bottom: (rated ? leftPartsTop : barcodeTop) - 6 }],
      unavailableAt: [g.x(478), g.y(158)],
    });
    if (input.layout.barcodePayload) p.barcode(left, barcodeTop, 300 * PX, g.y(930) - barcodeTop, input.layout.barcodePayload, "#000000");

    const dealer = dealerLines(d);
    paintDealerBox(p, g, 938, "SOLD TO", dealer, []);
    paintDealerBox(p, g, 1293, "SHIP TO", [], d.factory.transportMethod ? [`Transportation Method: ${d.factory.transportMethod.toUpperCase()}`] : []);

    const epaTop = g.y(118);
    const gr = makeGrid(epaTop, 118, epaTop + 453 * PX, 571);
    paintEvEpa(p, d, gr, 885, 118, { mode: "phev", widthPx: 700, qr: true });
    // As on the reference, an unrated vehicle stacks safety then parts content
    // in the right column. A rated vehicle needs the full star panel there, so
    // parts content moves to the foot of the price column.
    const safetyTop = gr.y(571) + 8;
    const columnBottom = g.y(935);
    if (rated) {
      paintCatalogSafety(p, d, g.x(885), safetyTop, 700 * PX, columnBottom - safetyTop);
      paintCatalogParts(p, d, left, leftPartsTop, right - left, barcodeTop - 8 - leftPartsTop, 2);
    } else {
      const safetyH = Math.min(110, (columnBottom - safetyTop) * 0.55);
      paintCatalogSafety(p, d, g.x(885), safetyTop, 700 * PX, safetyH);
      const partsTop = safetyTop + safetyH + 6;
      R(p, g.x(885), partsTop, 700 * PX, columnBottom - partsTop, PAPER);
      paintCatalogParts(p, d, g.x(885), partsTop, 700 * PX, columnBottom - partsTop, 2);
    }
    return result;
  },
};

export const buildBentleyContinentalGtPhevLayout: VariantLayoutBuilder = (input): LayoutModel | null => catalogPageBuilder(spec, BENTLEY_PAGE)(input);
