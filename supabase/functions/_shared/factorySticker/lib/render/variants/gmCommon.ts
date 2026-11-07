// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/render/variants/gmCommon.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// Pieces shared by the General Motors catalog layouts (Buick Envista,
// Chevrolet Silverado 2500, GMC Sierra 3500). Geometry is written in the
// reference PDFs' 100 dpi pixels and mapped onto the page by a Grid that keeps
// horizontals and compresses verticals to clear the mandatory banner and
// disclosure. Only fixed labels and logo artwork are literals; every vehicle
// value comes from render data.

import type { FactoryStickerData } from "../../types.ts";
import type { Painter } from "../layout.ts";
import { INK, PAPER } from "./shared.ts";
import { R, T, wrap } from "./hyundaiTucsonGas.ts";
import {
  buildSections, colorText, dealerLines, flow, paintPlaced, placedResult, toEntries, withColumns,
  type FirstPageContext, type FirstPageResult, type FlowStyle,
} from "./tabloidCommon.ts";
import { PX, Q, makeGrid, type Grid } from "./catalogBlocks.ts";

/** The OEM prints upper-case bulleted items on a 17px (about 12pt) line pitch; the ladder tightens from here. */
export const GM_EQ_STYLE: FlowStyle = { size: 15, lh: 19.1, hang: 7, inset: 9 };

export const gmGrid = (): Grid => makeGrid(30, 58, 709, 1045);

/** Exterior / interior (left) and engine / transmission (right) rows under the logo band. */
export function paintGmSpecColumns(p: Painter, d: FactoryStickerData, g: Grid, o: { leftX: number; rightX: number; leftW: number; rightW: number; engineLabel?: string; transmissionLabel?: string }): void {
  const v = d.vehicle;
  const left: Array<[string, string | null]> = [
    ["EXTERIOR", colorText(v.exteriorColor, v.exteriorColorCode)],
    ["INTERIOR", colorText(v.interiorColor, v.interiorColorCode)],
  ];
  const right: Array<[string, string | null]> = [[o.engineLabel ?? "ENGINE", v.engine ? v.engine.toUpperCase() : null], [o.transmissionLabel ?? "TRANSMISSION", v.transmission ? v.transmission.toUpperCase() : null]];
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
  col(left, o.leftX, o.leftW);
  col(right, o.rightX, o.rightW);
}

/** Black "STANDARD EQUIPMENT" tab, its note, the column dividers and the bottom rule. */
export function paintGmEquipmentFrame(p: Painter, g: Grid, dividers: number[]): void {
  R(p, g.x(45), g.y(166), 258 * PX, g.y(196) - g.y(166), INK);
  T(p, "STANDARD EQUIPMENT", g.x(54), g.y(173), 10.4, "bold", { color: PAPER });
  wrap("ITEMS FEATURED BELOW ARE INCLUDED AT NO EXTRA CHARGE IN THE STANDARD VEHICLE PRICE SHOWN", "body", 5.8, 245 * PX)
    .forEach((l, i) => T(p, l, g.x(50), g.y(202) + i * 6.6, 5.8, "body"));
  for (const x of dividers) R(p, g.x(x), g.y(166), 0.8, g.y(566) - g.y(166), INK);
  R(p, g.x(45), g.y(566), 1610 * PX, 1.2, INK);
}

/** Flows the standard equipment through the OEM's columns: [x, width] in px, the first column starting below the tab. */
export function flowGmEquipment(p: Painter, ctx: FirstPageContext, g: Grid, columns: Array<[number, number]>): FirstPageResult {
  const sections = buildSections(ctx.input);
  if (!sections.length) T(p, "Standard equipment not available for this vehicle.", g.x(50), g.y(228), 8, "body");
  const entries = toEntries(sections, (s) => s.toUpperCase(), 4, undefined, ctx.input.equipmentNote)
    .map((e) => (e.heading || e.note ? e : { ...e, text: e.text.toUpperCase() }));
  const base = columns.map(([x, w], i) => ({ x: Q(g.x(x)), w: Q(w * PX), top: Q(g.y(i === 0 ? 232 : 172)), bottom: Q(g.y(562)) }));
  const { placed, rest } = flow(entries, withColumns(base, ctx.extraColumns), ctx.style);
  paintPlaced(p, placed, ctx.style, { headingFont: "bold", bullet: "dot" });
  return placedResult(entries, rest);
}

/** VIN, original delivering dealer (blank when unproven), assembly point and the regenerated barcode. */
export function paintGmVinDealer(
  p: Painter, d: FactoryStickerData, barcodePayload: string, g: Grid,
  o: { x: number; vinY: number; dealerY: number; dealerLinesY: number; assemblyY: number; barcodeY: number; barcodeX: number; barcodeW?: number },
): void {
  T(p, `VIN ${d.vehicle.vin}`, g.x(o.x), g.y(o.vinY), 9.6, "bold");
  T(p, "DEALER TO WHOM DELIVERED", g.x(o.x), g.y(o.dealerY), 6.6, "bold");
  if (d.factory.dealerCode) T(p, d.factory.dealerCode.toUpperCase(), g.x(o.x) + 100, g.y(o.dealerY), 6.6, "bold");
  dealerLines(d).slice(0, 3).forEach((l, i) => T(p, l, g.x(o.x), g.y(o.dealerLinesY) + i * 9.4, 8.2, "bold"));
  if (d.factory.finalAssemblyPoint) T(p, `ASSEMBLY POINT: ${d.factory.finalAssemblyPoint.toUpperCase()}`, g.x(o.x), g.y(o.assemblyY), 6.6, "body");
  if (barcodePayload) p.barcode(g.x(o.barcodeX), g.y(o.barcodeY), (o.barcodeW ?? 318) * PX, g.y(o.barcodeY + 36) - g.y(o.barcodeY), barcodePayload, INK);
}
