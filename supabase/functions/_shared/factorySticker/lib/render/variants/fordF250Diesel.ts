// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/render/variants/fordF250Diesel.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// 17x11 reproduction layout for the 2026 Ford F-250 Super Duty (diesel),
// translated from the geometry of "Ford_2026_F250" (Figma file
// 2g3UZx8tx8OFgwft6XAssG, master 1:824). Geometry is written in the reference
// PDF's own points; Ym() keeps the horizontals and compresses verticals so the
// content clears the mandatory banner above and disclosure below. The label
// follows the Ford CARB family of the approved Transit master (blue frame,
// standard equipment over an options-and-price panel, California Air
// Resources Board panel at the right) with its own geometry. Heavy-duty
// pickups are exempt from the EPA label, and the reference has no fuel-economy
// or safety panel, so none is drawn.
//
// Every printed value comes from render data. The "Built Ford Tough" watermark,
// FordPass, Ford Protect and Ford Credit advertisements, the source QR, the
// ramp, rail, order and production codes, the ship-to and ship-through blocks,
// the federal-law label statement and the CARB emblem are not reproduced.

import type { FactoryStickerData } from "../../types.ts";
import { PASSPORT_QR_CAPTION } from "../../reproduction.ts";
import { Painter, formatPlain, type LayoutModel } from "../layout.ts";
import { VARIANT_LOGOS } from "./logoArtwork.ts";
import { INK, PAPER, type VariantLayoutBuilder } from "./shared.ts";
import { PASSPORT_QR_PT, R, T, wrap } from "./hyundaiTucsonGas.ts";
import {
  TABLOID_HEIGHT, TABLOID_WIDTH, assembleTabloid, buildSections, colorText, dealerLines, flow, paintPlaced, placedResult,
  priceRowsWithoutColors, toEntries, totalMsrp, warrantySection, withColumns, type FirstPageContext, type FirstPageResult,
  type FlowStyle, type TabloidSpec,
} from "./tabloidCommon.ts";
import { fitSize } from "./fcaCommon.ts";
import { paintCarbPanel } from "./carbPanel.ts";
import { placeRows } from "./priceColumns.ts";
import { msrpWithOptions, optionsTotalOf } from "./catalogBlocks.ts";

export const FORD_F250_DIESEL_ID = "ford_2026_f250";

const BLUE = "#135698";
const Q = (pt: number): number => pt / 0.612;
const EQ_STYLE: FlowStyle = { size: 14.2, lh: 15.4, hang: 6, inset: 9 };
const FRAME_TOP = 25;
const FRAME_BOTTOM = 765;

const plain = (n: number | undefined): string => (n === undefined ? "NOT AVAILABLE" : formatPlain(n));

type Ym = (refY: number) => number;

function paintHeader(p: Painter, d: FactoryStickerData, m: Ym): void {
  const v = d.vehicle;
  R(p, 32, m(40), 129, m(126) - m(40), PAPER);
  const logo = VARIANT_LOGOS.ford;
  const w = 104;
  p.image(logo.png, logo.assetId, 44, m(52), w, (w * logo.slot.h) / logo.slot.w);
  T(p, "VEHICLE DESCRIPTION", 165, m(31), 8, "bold", { color: PAPER });
  const model = v.model.toUpperCase();
  T(p, model, 180, m(46), fitSize(model, "bold", 32, 300, 18), "bold", { color: PAPER });
  const lines = [
    [v.year > 0 ? String(v.year) : "", v.trim ?? "", v.drivetrain ?? ""].filter(Boolean).join(" ").toUpperCase(),
    v.engine?.toUpperCase() ?? "",
    v.transmission?.toUpperCase() ?? "",
  ].filter(Boolean);
  lines.forEach((l, i) => T(p, l, 215, m(80) + i * 9.4, 9.2, "bold", { color: PAPER }));
  let y = 80;
  for (const [label, value] of [["EXTERIOR", colorText(v.exteriorColor, v.exteriorColorCode)], ["INTERIOR", colorText(v.interiorColor, v.interiorColorCode)]] as const) {
    if (!value) continue;
    T(p, label, 433, m(y), 9.2, "bold", { color: PAPER });
    T(p, value, 447, m(y) + 10.4, fitSize(value, "bold", 9.2, 225, 6), "bold", { color: PAPER });
    y += 23;
  }
}

/** Returns false when the option rows cannot fit. */
function paintPricing(p: Painter, d: FactoryStickerData, m: Ym): boolean {
  const rows = priceRowsWithoutColors(d, formatPlain).map((r) => ({
    label: r.label.toUpperCase(), amount: r.amount, features: r.features.map((f) => `• ${f.toUpperCase()}`),
  }));
  const top = m(348);
  const limit = m(612);
  const placed = placeRows(rows, [
    { x: 36, right: 246, top, limit },
    { x: 262, right: 448, top, limit },
  ], 8.6, 0.6);
  if (!placed) return false;
  T(p, "INCLUDED ON THIS VEHICLE", 36, m(316), 9, "bold");
  T(p, "(MSRP)", 246, m(316), 9, "bold", { align: "right" });
  T(p, "(MSRP)", 670, m(316), 9, "bold", { align: "right" });
  T(p, "OPTIONAL EQUIPMENT/OTHER", 36, m(334), 9, "bold");
  R(p, 36, m(334) + 9.4, 118, 0.8, INK);
  for (const t of placed.placed) T(p, t.text, t.right ?? t.x, t.y, t.size, "body", t.right !== undefined ? { align: "right" } : {});

  const pr = d.pricing;
  const L = 461;
  const Rt = 670;
  T(p, "PRICE INFORMATION", L, m(330), 9, "bold");
  R(p, L, m(330) + 9.4, 86, 0.8, INK);
  const row = (label: string, value: string, i: number): void => {
    const y = m(340) + i * 10.4 + (i >= 2 ? 6 : 0);
    T(p, label, L, y, 9, "body");
    T(p, value, Rt, y, value === "NOT AVAILABLE" ? 6.5 : 9, "body", { align: "right" });
  };
  row("BASE PRICE", plain(pr.baseMsrp), 0);
  row("TOTAL OPTIONS/OTHER", plain(optionsTotalOf(d)), 1);
  R(p, 598, m(340) + 2 * 10.4 + 1, 72, 0.8, INK);
  row("TOTAL VEHICLE & OPTIONS/OTHER", plain(msrpWithOptions(d)), 2);
  row("DESTINATION & DELIVERY", plain(pr.destinationCharge), 3);
  if (pr.gasGuzzlerTax !== undefined) row("GAS GUZZLER TAX", plain(pr.gasGuzzlerTax), 4);
  return true;
}

function paintBottom(p: Painter, d: FactoryStickerData, input: FirstPageContext["input"], m: Ym): void {
  const f = d.factory;
  T(p, "SOLD TO", 36, m(624), 8.6, "bold");
  if (f.dealerCode) T(p, f.dealerCode.toUpperCase(), 36 + 46, m(624), 8.6, "bold");
  dealerLines(d).slice(0, 4).forEach((l, i) => T(p, l, 40, m(634) + i * 9, 8.6, "body"));

  const origin = f.finalAssemblyPoint ?? f.assemblyPlant;
  if (origin) {
    T(p, "FINAL ASSEMBLY PLANT", 331, m(624), 6.6, "body", { color: BLUE });
    T(p, origin.toUpperCase(), 331, m(634), 9.5, "body");
  }
  if (f.transportMethod) {
    T(p, "METHOD OF TRANSP.", 331, m(649), 6.6, "body", { color: BLUE });
    T(p, f.transportMethod.toUpperCase(), 331, m(659), 9.5, "body");
  }

  T(p, "TOTAL MSRP", 462, m(629), 15, "bold", { color: PAPER });
  const total = totalMsrp(d);
  T(p, total !== undefined ? `$${formatPlain(total)}` : "NOT AVAILABLE", 670, m(629), total !== undefined ? 15 : 12, "bold", { align: "right", color: PAPER });

  R(p, 680, m(625), 323, m(661) - m(625), PAPER);
  T(p, d.vehicle.vin, 841, m(627), 9.5, "bold", { align: "center" });
  if (input.layout.barcodePayload) p.barcode(690, m(640), 303, m(659) - m(640), input.layout.barcodePayload, INK);

  R(p, 680, m(666), 393, m(747) - m(666), PAPER, 1.4);
  p.path("M10 0 L20 18 L0 18 Z", 690, m(676), 20, 18, null, INK, 1.6);
  T(p, "!", 700, m(682), 10, "bold", { align: "center" });
  const warning = "WARNING: Operating, servicing and maintaining a passenger vehicle, pickup truck, van, or off-road vehicle can expose you to chemicals including engine exhaust, carbon monoxide, phthalates, and lead, which are known to the State of California to cause cancer and birth defects or other reproductive harm. To minimize exposure, avoid breathing exhaust, do not idle the engine except as necessary, service your vehicle in a well-ventilated area and wear gloves or wash your hands frequently when servicing your vehicle. For more information go to www.P65Warnings.ca.gov/passenger-vehicle.";
  wrap(warning, "body", 7.2, 340).forEach((l, i) => T(p, l, 720, m(670) + i * 8, 7.2, "body"));

  const url = d.document.passportUrl.trim();
  if (url) {
    const qx = 1098;
    const qy = m(386);
    R(p, qx - 8, qy - 8, PASSPORT_QR_PT + 16, PASSPORT_QR_PT + 40, PAPER);
    p.qr(qx, qy, PASSPORT_QR_PT, url, INK);
    T(p, "VEHICLE PASSPORT", qx + PASSPORT_QR_PT / 2, qy + PASSPORT_QR_PT + 2, 7.5, "bold", { align: "center" });
    T(p, PASSPORT_QR_CAPTION, qx + PASSPORT_QR_PT / 2, qy + PASSPORT_QR_PT + 12, 6.4, "body", { align: "center" });
  }
}

const spec: TabloidSpec = {
  eqStyle: EQ_STYLE,
  paintFirst(p: Painter, ctx: FirstPageContext): FirstPageResult | null {
    const { d, input } = ctx;
    const bottom = ctx.footerTop * 0.612 - 6;
    const m: Ym = (y) => 28 + (y - FRAME_TOP) * ((bottom - 28) / (FRAME_BOTTOM - FRAME_TOP));
    R(p, 18, m(FRAME_TOP), 1188, m(FRAME_BOTTOM) - m(FRAME_TOP), BLUE);
    R(p, 32, m(128), 641, m(313) - m(128), PAPER);
    R(p, 32, m(315), 641, m(616) - m(315), PAPER);
    R(p, 32, m(621), 216, m(751) - m(621), PAPER);
    R(p, 325, m(621), 126, m(751) - m(621), PAPER);
    if (!paintPricing(p, d, m)) return null;
    paintHeader(p, d, m);
    T(p, "STANDARD EQUIPMENT", 36, m(131), 9, "bold");
    T(p, "INCLUDED AT NO EXTRA CHARGE", 36 + 108, m(131), 9, "bold");
    R(p, 36 + 108, m(131) + 9.4, 128, 0.8, INK);
    paintCarbPanel(p, d, 680, m(43), 508, m(367) - m(43));
    paintBottom(p, d, input, m);

    const warranty = warrantySection(d, "Warranty");
    const sections = [...buildSections(input), ...(warranty ? [warranty] : [])];
    const entries = toEntries(sections, (s) => s.toUpperCase(), 8, (h) => h !== "Warranty", input.equipmentNote)
      .map((e) => (e.heading || e.note ? e : { ...e, text: e.text.toUpperCase() }));
    if (!sections.length) entries.unshift({ text: "Standard equipment not available for this vehicle.", heading: false, gapBefore: 0, note: true });
    if (!warranty) {
      const at = entries.length && entries[entries.length - 1].note ? entries.length - 1 : entries.length;
      entries.splice(at, 0, { text: "WARRANTY", heading: true, gapBefore: 8 }, { text: "Not available for this vehicle.", heading: false, gapBefore: 0, note: true });
    }
    const col = (x: number, w: number) => ({ x: Q(x), w: Q(w), top: Q(m(151)), bottom: Q(m(309)) });
    const { placed, rest } = flow(entries, withColumns([col(36, 160), col(202, 160), col(369, 150), col(526, 140)], ctx.extraColumns), ctx.style);
    paintPlaced(p, placed, ctx.style, { bullet: "dot" });
    return placedResult(entries, rest);
  },
};

export const buildFordF250DieselLayout: VariantLayoutBuilder = (input): LayoutModel | null => {
  const model = assembleTabloid(input, spec);
  if (model && (model.width !== TABLOID_WIDTH || model.height !== TABLOID_HEIGHT)) return null;
  return model;
};
