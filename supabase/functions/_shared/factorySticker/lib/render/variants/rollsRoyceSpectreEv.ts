// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/render/variants/rollsRoyceSpectreEv.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// 17x11 reproduction layout for the 2026 Rolls-Royce Spectre (electric),
// translated from "Rolls-Royce_2026_Spectre" (Figma file
// rvEUVoSjTWaiDa6HckLQ4O, master 1:735). The reference PDF is stored rotated
// and has no text layer; it renders upright at true size. Geometry is written
// in the reference's 100 dpi pixels (1700 x 1100) and mapped by a Grid that
// keeps the horizontals and compresses verticals to clear the reproduction
// banner and disclosure.
//
// Every printed value comes from render data. The monogram artwork is not
// packaged, the source QR, agency seals, carrier and port lines are not
// reproduced, and the electric panel prints Not Available for every figure the
// verified EPA record does not carry.

import type { FactoryStickerData } from "../../types.ts";
import { Painter, type LayoutModel } from "../layout.ts";
import { INK, type VariantLayoutBuilder } from "./shared.ts";
import { R, T } from "./hyundaiTucsonGas.ts";
import {
  TABLOID_HEIGHT, TABLOID_WIDTH, assembleTabloid, colorText, dealerLines, totalMsrp, warrantySection, yearModelTrim,
  type FirstPageContext, type FirstPageResult, type FlowStyle, type TabloidSpec,
} from "./tabloidCommon.ts";
import { PX, makeGrid, money, msrpWithOptions, paintCatalogParts, paintCatalogSafety, paintWarranty } from "./catalogBlocks.ts";
import { paintEvEpa } from "./evPanels.ts";
import { flowEquipmentColumns, paintPriceList } from "./catalogPage.ts";

export const ROLLS_ROYCE_SPECTRE_EV_ID = "rolls-royce_2026_spectre";

const EQ_STYLE: FlowStyle = { size: 12.6, lh: 14.6, hang: 6, inset: 0 };
const g = makeGrid(28, 40, 709, 1066);

function paintHeader(p: Painter, d: FactoryStickerData): void {
  const sameTrim = (d.vehicle.trim ?? "").trim().toLowerCase() === d.vehicle.model.trim().toLowerCase();
  const title = yearModelTrim(d, sameTrim ? ["year", "make", "model"] : ["year", "make", "model", "trim"], d.vehicle.make);
  T(p, title, g.x(48), g.y(54), 26, "bold");
}

function paintLeft(p: Painter, d: FactoryStickerData): boolean {
  const x = g.x(45);
  const w = 405 * PX;
  const top = g.y(135);
  const bottom = g.y(965);
  R(p, x, top, w, bottom - top, null, 1.4);
  T(p, "Manufacturer's Suggested Retail Price:", x + 3, g.y(140), 8.6, "bold");
  T(p, `${money(d.pricing.baseMsrp)} USD`, x + w - 3, g.y(140), 8.6, "bold", { align: "right" });
  T(p, "Options and Additional Charges:", x + 3, g.y(160), 8.2, "bold");
  T(p, "(Optional equipment may supercede standard equipment; check with your authorized dealer.)", x + 3, g.y(176), 6.2, "body");

  const totalsTop = g.y(918);
  const end = paintPriceList(p, d, { x: x + 4, y: g.y(196), w: w - 8, limit: totalsTop - 14, amountRight: x + w - 4 });
  if (end === null) return false;
  const total = msrpWithOptions(d);
  if (total !== undefined && d.pricing.baseMsrp !== undefined && total !== d.pricing.baseMsrp) {
    T(p, "MSRP including options", x + 4, totalsTop - 12, 7.2, "body");
    T(p, money(total), x + w - 4, totalsTop - 12, 7.2, "body", { align: "right" });
  }
  T(p, "Destination & Handling", x + 4, totalsTop, 7.6, "body");
  T(p, money(d.pricing.destinationCharge), x + w - 4, totalsTop, 7.6, "body", { align: "right" });
  R(p, x + 3, totalsTop + 11, w - 6, 1, INK);
  T(p, "Total Suggested Retail Price:", x + 4, totalsTop + 15, 9.2, "bold");
  T(p, money(totalMsrp(d)), x + w - 4, totalsTop + 15, 9.2, "bold", { align: "right" });
  return true;
}

function paintSide(p: Painter, d: FactoryStickerData): void {
  const x = g.x(1375);
  const w = 265 * PX;
  const w0 = warrantySection(d, "Warranty");
  let y = paintWarranty(p, d, w0 ? w0.items : null, x, g.y(124), w, "Warranty");
  y = Math.max(y + 8, g.y(300));
  T(p, "Sold To", x, y, 9, "bold");
  dealerLines(d).slice(0, 4).forEach((l, i) => T(p, l, x, y + 12 + i * 10, 7.8, "body"));
  T(p, "Ship To", x, g.y(415), 9, "bold");
}

const spec: TabloidSpec = {
  eqStyle: EQ_STYLE,
  paintFirst(p: Painter, ctx: FirstPageContext): FirstPageResult | null {
    const { d, input } = ctx;
    if (!paintLeft(p, d)) return null;
    paintHeader(p, d);
    T(p, "VIN:", g.x(48), g.y(966), 14, "bold");
    T(p, d.vehicle.vin, g.x(48) + 38, g.y(966), 14, "bold");
    const colors: Array<[string, string | null]> = [
      ["Exterior Colour:", colorText(d.vehicle.exteriorColor, d.vehicle.exteriorColorCode)],
      ["Interior Colour:", colorText(d.vehicle.interiorColor, d.vehicle.interiorColorCode)],
      ["Motor:", d.vehicle.engine?.toUpperCase() ?? null],
      ["Transmission:", d.vehicle.transmission?.toUpperCase() ?? null],
    ];
    let cy = 992;
    for (const [label, value] of colors) {
      if (!value) continue;
      T(p, label, g.x(48), g.y(cy), 8, "bold");
      T(p, value, g.x(48) + 76, g.y(cy), 8, "body");
      cy += 14;
    }
    if (input.layout.barcodePayload) p.barcode(g.x(280), g.y(990), 170 * PX, g.y(1064) - g.y(990), input.layout.barcodePayload, INK);
    const result = flowEquipmentColumns(p, ctx, [{ x: g.x(465), w: 415 * PX, top: g.y(122), bottom: g.y(1055) }], {
      unavailableAt: [g.x(468), g.y(130)],
    });
    paintCatalogParts(p, d, g.x(910), g.y(120), 455 * PX, g.y(300) - g.y(120));
    paintCatalogSafety(p, d, g.x(908), g.y(312), 460 * PX, g.y(600) - g.y(312));
    paintEvEpa(p, d, g, 908, 612, { mode: "ev", widthPx: 697, qr: true });
    paintSide(p, d);
    return result;
  },
};

export const buildRollsRoyceSpectreEvLayout: VariantLayoutBuilder = (input): LayoutModel | null => {
  const model = assembleTabloid(input, spec);
  if (model && (model.width !== TABLOID_WIDTH || model.height !== TABLOID_HEIGHT)) return null;
  return model;
};
