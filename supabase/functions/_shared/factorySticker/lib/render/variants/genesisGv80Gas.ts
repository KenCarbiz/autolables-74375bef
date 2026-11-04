// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/render/variants/genesisGv80Gas.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// 17x11 reproduction layout for the 2026 Genesis GV80 (gasoline), translated
// from the handoff geometry of "Genesis_2026_GV80_3.5T_Prestige" (Figma file
// bJilnmW6l2DfhGYWz2nbpU, master 1:320). Geometry is written in the reference
// PDF's 100 dpi pixels and mapped onto the page by a Grid that keeps the
// horizontals and compresses verticals to clear the mandatory reproduction
// banner above and disclosure below.
//
// Every printed value comes from render data; nothing from the reference
// sample is used as a default. "The Genesis Experience" program terms, agency
// seals, the source Smartphone QR (the 0.90in Vehicle Passport QR takes its
// slot), the model code, accessory weight, production strip and the
// federal-law label statement are intentionally not reproduced. The header's
// program panel carries the record's verified warranty terms instead.

import type { FactoryStickerData } from "../../types.ts";
import type { LayoutModel, Painter } from "../layout.ts";
import { VARIANT_LOGOS } from "./logoArtwork.ts";
import { INK, PAPER, type VariantLayoutBuilder } from "./shared.ts";
import { R, T, wrap } from "./hyundaiTucsonGas.ts";
import {
  TABLOID_HEIGHT, TABLOID_WIDTH, assembleTabloid, buildSections, colorText, dealerLines, flow, paintPlaced, placedResult,
  priceRowsWithoutColors, toEntries, totalMsrp, warrantySection, withColumns, yearModelTrim,
  type ColumnSpec, type FirstPageContext, type FirstPageResult, type FlowStyle, type TabloidSpec,
} from "./tabloidCommon.ts";
import {
  PRICE_FOOTNOTE, PX, Q, makeGrid, money, paintCatalogEpa, paintCatalogParts, paintCatalogSafety, paintPriceLines,
} from "./catalogBlocks.ts";

export const GENESIS_GV80_GAS_ID = "genesis_2026_gv80_3.5t_prestige";

const EQ_STYLE: FlowStyle = { size: 13, lh: 15.2, hang: 6, inset: 0 };
const BROWN = "#a8694b";
const g = makeGrid(30, 22, 709, 1040);

function paintFrames(p: Painter): void {
  const x0 = g.x(24);
  const x1 = g.x(952);
  const y0 = g.y(72);
  const y1 = g.y(1038);
  const t = 4.4;
  R(p, x0, y0, x1 - x0, t, BROWN);
  R(p, x0, y1 - t, x1 - x0, t, BROWN);
  R(p, x0, y0, t, y1 - y0, BROWN);
  R(p, x1 - t, y0, t, y1 - y0, BROWN);
  R(p, g.x(603), g.y(236), t, y1 - g.y(236), BROWN);
  R(p, x0, g.y(236), g.x(603) - x0, t, BROWN);
  R(p, x0, g.y(815), g.x(603) - x0, t, BROWN);
  R(p, x0, g.y(897), g.x(603) - x0, t, BROWN);
  R(p, x0, g.y(975), g.x(603) - x0, t, BROWN);
  for (const cx of [182, 300, 437]) R(p, g.x(cx), g.y(897), t, g.y(975) - g.y(897), BROWN);
  R(p, g.x(300), g.y(975), t, g.y(1038) - g.y(975), BROWN);
  R(p, g.x(603), g.y(897), g.x(952) - g.x(603), t, BROWN);
  R(p, g.x(603), g.y(937), g.x(952) - g.x(603), t, BROWN);
}

function paintHeader(p: Painter, d: FactoryStickerData): void {
  const vin = d.vehicle.vin;
  T(p, `VIN:   ${vin}`, g.x(42), g.y(22), 9, "bold");
  T(p, `VIN:   ${vin}`, g.x(1660), g.y(22), 9, "bold", { align: "right" });
  R(p, g.x(31), g.y(78), g.x(945) - g.x(31), g.y(235) - g.y(78), INK);
  const logo = VARIANT_LOGOS.genesis;
  const lw = 250 * PX;
  p.image(logo.png, logo.assetId, g.x(36), g.y(132), lw, (lw * logo.slot.h) / logo.slot.w);
  const title = yearModelTrim(d, ["year", "model", "trim", "drivetrain"], d.vehicle.make);
  wrap(title, "bold", 17, 270 * PX).slice(0, 3).forEach((l, i) => T(p, l, g.x(322), g.y(118) + i * 21, 17, "bold", { color: PAPER, lh: 21 }));
  T(p, "GENESIS WARRANTY", g.x(608), g.y(92), 10.5, "body", { color: PAPER });
  const w = warrantySection(d, "Warranty");
  let y = g.y(116);
  for (const item of w ? w.items : ["Not available for this vehicle."]) {
    for (const l of wrap(item, "body", 8.6, 330 * PX)) {
      T(p, l, g.x(608), y, 8.6, "body", { color: PAPER });
      y += 10;
    }
  }
}

function cell(p: Painter, x: number, y: number, label: string, value: string | null, w: number): void {
  T(p, label, g.x(x), g.y(y), 7.6, "bold");
  const v = value ?? "Not available";
  wrap(v, "body", 7.6, w * PX).slice(0, 2).forEach((l, i) => T(p, l, g.x(x), g.y(y + 17) + i * 8.6, 7.6, "body"));
}

function paintLeftLower(p: Painter, d: FactoryStickerData): void {
  T(p, "SOLD TO:", g.x(36), g.y(826), 8, "bold");
  if (d.factory.dealerCode) T(p, d.factory.dealerCode.toUpperCase(), g.x(36) + 44, g.y(826), 8, "bold");
  dealerLines(d).slice(0, 3).forEach((l, i) => T(p, l, g.x(36), g.y(846) + i * 9.5, 7.6, "body"));
  T(p, "SHIPPED TO:", g.x(311), g.y(826), 8, "bold");
  const v = d.vehicle;
  cell(p, 36, 906, "VIN:", v.vin, 140);
  cell(p, 190, 906, "EXTERIOR COLOR:", colorText(v.exteriorColor, v.exteriorColorCode), 100);
  cell(p, 308, 906, "INTERIOR/SEAT COLOR:", colorText(v.interiorColor, v.interiorColorCode), 125);
  cell(p, 446, 906, "TRANSPORT:", d.factory.transportMethod ? d.factory.transportMethod.toUpperCase() : null, 150);
  cell(p, 36, 984, "ASSEMBLY POINT:", d.factory.finalAssemblyPoint ? d.factory.finalAssemblyPoint.toUpperCase() : null, 250);
  cell(p, 308, 984, "EMISSIONS:", d.factory.emissionsCode ?? null, 285);
}

/** Returns the y below the option rows, or null when they cannot fit above the freight line. */
function paintPrices(p: Painter, d: FactoryStickerData): number | null {
  const L = g.x(613);
  const Rt = g.x(940);
  T(p, "Manufacturer's Suggested Retail Price:", L, g.y(247), 8.6, "body");
  T(p, money(d.pricing.baseMsrp), Rt, g.y(247), 8.6, "body", { align: "right" });
  const head = "ADDED FEATURES:";
  T(p, head, L, g.y(270), 11, "body");
  const after = paintPriceLines(p, priceRowsWithoutColors(d), L, Rt, g.y(298), g.y(860), { size: 8.4, labelW: 245 });
  if (after === null) return null;
  if (d.pricing.gasGuzzlerTax !== undefined) {
    T(p, "Gas Guzzler Tax", L, g.y(862), 8.4, "body");
    T(p, money(d.pricing.gasGuzzlerTax), Rt, g.y(862), 8.4, "body", { align: "right" });
  }
  T(p, "Inland Freight & Handling :", L, g.y(878), 8.4, "body");
  T(p, money(d.pricing.destinationCharge), Rt, g.y(878), 8.4, "body", { align: "right" });
  T(p, "TOTAL PRICE:", L, g.y(906), 14, "body");
  T(p, money(totalMsrp(d)), Rt, g.y(906), 14, "bold", { align: "right" });
  return after;
}

const spec: TabloidSpec = {
  eqStyle: EQ_STYLE,
  paintFirst(p: Painter, ctx: FirstPageContext): FirstPageResult | null {
    const { d, input } = ctx;
    const priceEnd = paintPrices(p, d);
    if (priceEnd === null) return null;
    paintFrames(p);
    paintHeader(p, d);
    paintLeftLower(p, d);
    if (input.layout.barcodePayload) p.barcode(g.x(618), g.y(950), 318 * PX, g.y(1026) - g.y(950), input.layout.barcodePayload, INK);

    T(p, "STANDARD FEATURES:", g.x(36), g.y(244), 11, "body");
    const sections = buildSections(input);
    if (!sections.length) T(p, "Standard equipment not available for this vehicle.", g.x(36), g.y(272), 8, "body");
    const entries = toEntries(sections, (s) => s.toUpperCase(), 3, undefined, input.equipmentNote);
    const base: ColumnSpec[] = [
      { x: Q(g.x(36)), w: Q(272 * PX), top: Q(g.y(268)), bottom: Q(g.y(810)) },
      { x: Q(g.x(323)), w: Q(272 * PX), top: Q(g.y(268)), bottom: Q(g.y(810)) },
    ];
    const cols = [
      ...withColumns(base, ctx.extraColumns),
      { x: Q(g.x(613)), w: Q(325 * PX), top: Q(priceEnd + 6), bottom: Q(g.y(858)) },
    ];
    const { placed, rest } = flow(entries, cols, ctx.style);
    paintPlaced(p, placed, ctx.style, { headingFont: "bold" });

    paintCatalogEpa(p, d, g, 980, 72);
    const sTop = g.y(528);
    paintCatalogSafety(p, d, g.x(980), sTop, 470 * PX, g.y(880) - sTop);
    wrap(PRICE_FOOTNOTE, "body", 7.2, 200 * PX).forEach((l, i) => T(p, l, g.x(1464), g.y(542) + i * 8.2, 7.2, "body"));
    paintCatalogParts(p, d, g.x(980), g.y(893), 695 * PX, g.y(1038) - g.y(893), 2);
    return placedResult(entries, rest);
  },
};

export const buildGenesisGv80GasLayout: VariantLayoutBuilder = (input): LayoutModel | null => {
  const model = assembleTabloid(input, spec);
  if (model && (model.width !== TABLOID_WIDTH || model.height !== TABLOID_HEIGHT)) return null;
  return model;
};
