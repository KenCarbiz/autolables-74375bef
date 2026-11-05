// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/render/variants/fcaCommon.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// Shared 17x11 reproduction layout for the FCA label family (Jeep Wrangler, Chrysler
// Voyager, Dodge Durango). The reference geometry is written in the reference
// PDF's own points and mapped onto the page by Y(); a brand supplies only its
// frame colour, header artwork, specification title and optional-equipment rows.
//
// Every printed value comes from render data; nothing from a reference sample is
// used as a default. The FlexCare advertisement, powertrain-warranty graphic,
// agency seals, the source QR, the "affixed by law" and U.S.-specification
// statements and the Monroney certification wording are intentionally not
// reproduced.

import type { FactoryStickerData } from "../../types.ts";
import { Painter, fuelCategoryLabel, formatMoney, measureText, type LayoutModel } from "../layout.ts";
import { PASSPORT_QR_CAPTION } from "../../reproduction.ts";
import { INK, PAPER } from "./shared.ts";
import { PASSPORT_QR_PT, R, T, Y, paintScale, scaleState, wrap } from "./hyundaiTucsonGas.ts";
import {
  TABLOID_HEIGHT, TABLOID_WIDTH, assembleTabloid, buildSections, colorText, dealerLines, flow, paintPlaced,
  assemblyLabel, paintSafetyPanel, partsFacts, placedResult, toEntries, totalMsrp, underlined, warrantySection,
  type ColumnSpec, type PriceRow, type FirstPageContext, type FirstPageResult, type FlowStyle, type TabloidSpec,
} from "./tabloidCommon.ts";
import type { VariantLayoutBuilder } from "./shared.ts";

const Q = (pt: number): number => pt / 0.612;
const EQ_STYLE: FlowStyle = { size: 14.7, lh: 17.2, hang: 6, inset: 0 };
export const EPA_X = 625;
export const EPA_W = 547;
const COL2_X = 345;
const COL2_W = 245;
const COL2_R = 589;

export const fitSize = (s: string, font: "body" | "bold", size: number, maxW: number, floor: number): number => {
  let z = size;
  while (z > floor && measureText(s, font, z) > maxW) z -= 0.25;
  return z;
};

export const wedge = (p: Painter, x: number, y: number, h: number, dir: "left" | "right"): void => {
  const w = 13;
  const d = dir === "left" ? `M0 0 L${w} ${h / 2} L0 ${h} Z` : `M${w} 0 L0 ${h / 2} L${w} ${h} Z`;
  p.path(d, dir === "left" ? x - w : x, y, w, h, INK);
};

function paintFrame(p: Painter, bottom: number, color: string): void {
  const x0 = 17;
  const x1 = 1207;
  const y0 = 27;
  R(p, x0, y0, x1 - x0, 9, color);
  R(p, x0, bottom - 9, x1 - x0, 9, color);
  R(p, x0, y0 + 9, 14, bottom - y0 - 18, color);
  R(p, x1 - 14, y0 + 9, 14, bottom - y0 - 18, color);
}

export function paintPriceBox(p: Painter, x: number, y: number, w: number, h: number): void {
  R(p, x, y, w, h, null, 2.4);
  wedge(p, x, y, h, "left");
  wedge(p, x + w, y, h, "right");
}

/** Returns the y below the specification rows. */
function paintSpec(p: Painter, d: FactoryStickerData, title: string): number {
  const v = d.vehicle;
  T(p, "MANUFACTURER'S SUGGESTED RETAIL PRICE OF", 57.3, Y(135.3), 9.6, "bold");
  T(p, "THIS MODEL INCLUDING DEALER PREPARATION", 57.3, Y(145.3), 9.6, "bold");
  const boxY = Y(156);
  paintPriceBox(p, 72, boxY, 198, 26);
  T(p, "Base Price:", 80, boxY + 6, 12, "bold");
  const base = d.pricing.baseMsrp;
  T(p, base !== undefined ? formatMoney(base) : "NOT AVAILABLE", 262, boxY + (base !== undefined ? 6 : 8), base !== undefined ? 12 : 9, "bold", { align: "right" });

  let y = Y(188);
  T(p, title, 60.5, y, fitSize(title, "bold", 10, 268, 7), "bold");
  y += 10.6;
  const rows: Array<[string, string | null]> = [
    ["Exterior Color:", colorText(v.exteriorColor, v.exteriorColorCode)],
    ["Interior Color:", colorText(v.interiorColor, v.interiorColorCode)],
    ["Engine:", v.engine ?? null],
    ["Transmission:", v.transmission ?? null],
  ];
  for (const [label, value] of rows) {
    if (!value) continue;
    T(p, label, 60.5, y, 9.2, "bold");
    const x = 60.5 + measureText(label, "bold", 9.2) + 3;
    const w = 326 - x;
    const size = fitSize(value, "body", 9.2, w, 7);
    for (const line of measureText(value, "body", size) <= w ? [value] : wrap(value, "body", 7, w)) {
      T(p, line, x, y, size, "body");
      y += 10.2;
    }
  }
  return y;
}

// ── Fuel economy and environment ──────────────────────────────────────

function paintEpa(p: Painter, d: FactoryStickerData): void {
  const r = d.regulatory;
  const top = Y(101);
  const bottom = Y(426);
  const panelBottom = Y(350);
  R(p, EPA_X, top, EPA_W, bottom - top, INK);
  R(p, EPA_X + 3, Y(138), EPA_W - 6, panelBottom - Y(138), PAPER);
  T(p, "EPA", EPA_X + 4, Y(106), 9.5, "bold", { color: PAPER, lh: 10 });
  T(p, "DOT", EPA_X + 4, Y(106) + 10.2, 9.5, "bold", { color: PAPER, lh: 10 });
  T(p, "Fuel Economy and Environment", 684.4, Y(112), 16, "bold", { color: PAPER });
  if (d.vehicle.fuelType) {
    R(p, 1003, Y(106), 166, Y(134) - Y(106), "#8cc4e3");
    T(p, fuelCategoryLabel(d.vehicle.fuelType), 1163, Y(114), 10.5, "bold", { align: "right" });
  }

  const footerTop = panelBottom;
  const note = "Actual results will vary for many reasons, including driving conditions and how you drive and maintain your vehicle. Cost estimates are current EPA estimates and may differ from those printed on the original label.";
  wrap(note, "bold", 7.5, 500).forEach((l, i) => T(p, l, 632.2, footerTop + 4 + i * 8.6, 7.5, "bold", { color: PAPER, lh: 8.6 }));
  T(p, "fueleconomy.gov", 630.1, Y(382), 22, "bold", { color: PAPER });
  T(p, "Calculate personalized estimates and compare vehicles", 630.1, Y(414), 8, "bold", { color: PAPER });

  const rule = Y(265);
  R(p, EPA_X + 3, rule, EPA_W - 6, 2.2, INK);
  R(p, 779, rule, 2.2, panelBottom - rule, INK);
  const verified = r.epaStatus === "VERIFIED";
  const mpgOk = verified && r.combinedMpg !== undefined;

  T(p, "Annual fuel", 639, Y(281.4), 13, "bold");
  T(p, "cost", 639 + measureText("Annual fuel", "bold", 13) + 4, Y(274), 20, "bold");
  if (verified && r.annualFuelCost !== undefined) T(p, formatMoney(r.annualFuelCost).replace(/\.00$/, ""), 648.3, Y(303), 36, "bold");
  else T(p, "Not Available", 648.3, Y(312), 11, "bold");

  const ghgHead = "Fuel Economy & Greenhouse Gas Rating";
  T(p, ghgHead, 792, Y(273.7), 9, "bold");
  T(p, "(tailpipe only)", 792 + measureText(ghgHead, "bold", 9) + 3, Y(275.5), 6.5, "body");
  paintScale(p, 796, Y(308), 220, scaleState(verified ? r.greenhouseGasRating : undefined), 14);
  T(p, "Smog Rating", 1049.9, Y(273.7), 9, "bold");
  T(p, "(tailpipe only)", 1049.9 + measureText("Smog Rating", "bold", 9) + 3, Y(275.5), 6.5, "body");
  paintScale(p, 1052, Y(308), 112, scaleState(verified ? r.smogRating : undefined), 14);
  if (verified && r.co2TailpipeGpm !== undefined) {
    const line = `This vehicle emits ${Math.round(r.co2TailpipeGpm)} grams CO2 per mile (tailpipe only). The best emits 0 grams per mile (tailpipe only). Producing and distributing fuel also create emissions; learn more at fueleconomy.gov.`;
    wrap(line, "body", 6.6, 360).slice(0, 3).forEach((l, i) => T(p, l, 795, Y(334) + i * 7.2, 6.6, "body", { lh: 7.2 }));
  }

  T(p, "Fuel Economy", 667.8, Y(148), 11, "bold");
  if (!mpgOk) {
    wrap("Fuel economy and environment information is not available from verified EPA records for this exact configuration.", "bold", 12, 480)
      .forEach((l, i) => T(p, l, 667.8, Y(172) + i * 15, 12, "bold", { lh: 15 }));
    return;
  }
  const combined = String(Math.round(r.combinedMpg!));
  p.text(combined, 664.3, Y(224), 60, "bold", INK);
  T(p, "MPG", 752.2, Y(173), 18, "bold");
  T(p, "combined city/hwy", 664.3, Y(225.5), 8, "body");
  if (r.cityMpg !== undefined) {
    T(p, String(Math.round(r.cityMpg)), 760.1, Y(198.4), 20, "bold");
    T(p, "city", 760.1, Y(220), 8, "body");
  }
  if (r.highwayMpg !== undefined) {
    T(p, String(Math.round(r.highwayMpg)), 805, Y(198.4), 20, "bold");
    T(p, "highway", 805, Y(220), 8, "body");
  }
  if (r.epaClassNote) wrap(r.epaClassNote, "body", 8, 175).slice(0, 3).forEach((l, i) => T(p, l, 833.5, Y(170) + i * 8.4, 8, "body", { lh: 8.4 }));
  const gallons = r.gallonsPer100Miles ?? (r.combinedMpg! > 0 ? 100 / r.combinedMpg! : undefined);
  if (gallons !== undefined) {
    const g = gallons.toFixed(1);
    T(p, g, 662.2, Y(241.5), 20, "bold");
    T(p, "gallons per 100 miles", 662.2 + measureText(g, "bold", 20) + 4, Y(250.9), 8, "body");
  }
  const delta = r.fiveYearCostDifference;
  if (delta !== undefined && delta !== 0) {
    const saves = delta > 0;
    T(p, saves ? "You save" : "You spend", 1021.6, Y(142), 20, "bold");
    T(p, formatMoney(Math.abs(delta)).replace(/\.00$/, ""), 1021.6, Y(170), 34, "bold");
    ["in fuel costs", "over 5 years"].forEach((l, i) => T(p, l, 1030, Y(211) + i * 13, 12.5, "bold", { lh: 13 }));
    ["compared to the", "average new vehicle."].forEach((l, i) => T(p, l, 1030, Y(238) + i * 10, 9.5, "body", { lh: 10 }));
  } else {
    T(p, "5-year fuel cost comparison", 1021.6, Y(180), 9, "bold");
    T(p, "Not Available", 1021.6, Y(194), 11, "bold");
  }
}

// ── Safety ────────────────────────────────────────────────────────────

export const SAFETY_X = 625;
const SAFETY_W = 322;

export function paintSafety(p: Painter, d: FactoryStickerData): void {
  const r = d.regulatory;
  const top = Y(442);
  const ratings = [r.overallRating, r.frontalDriverRating, r.frontalPassengerRating, r.sideFrontRating, r.sideRearRating, r.rolloverRating];
  ratings.push(r.frontalRating, r.sideRating);
  const anyRated = r.nhtsaStatus === "VERIFIED" && ratings.some((n) => n !== undefined && n > 0);
  if (anyRated) {
    paintSafetyPanel(p, d, Q(SAFETY_X), Q(top), Q(SAFETY_W), Q(235), {
      headerH: 36, footerH: 80, subFrac: 0.29, valFrac: 0.57,
      titleSize: 21, labelSize: 16.4, noteSize: 11.2, footSize: 13, stretch: 1.04,
    });
    return;
  }
  const message = r.nhtsaStatus === "UNAVAILABLE"
    ? "Government 5-star safety ratings are not available from a verified NHTSA record for this vehicle."
    : "This vehicle has not been rated by the government for overall vehicle score, frontal crash, side crash, or rollover risk.";
  const headerH = 22;
  const msgH = 46;
  const footH = 32;
  R(p, SAFETY_X, top, SAFETY_W, headerH + msgH + footH, INK);
  T(p, "GOVERNMENT 5-STAR SAFETY RATINGS", SAFETY_X + SAFETY_W / 2, top + 5.5, 12.4, "bold", { align: "center", color: PAPER });
  R(p, SAFETY_X + 4, top + headerH, SAFETY_W - 8, msgH, PAPER);
  wrap(message, "body", 10.5, SAFETY_W - 24).forEach((l, i) => T(p, l, SAFETY_X + 10, top + headerH + 5 + i * 12.4, 10.5, "body", { lh: 12.4 }));
  const foot = top + headerH + msgH;
  T(p, "Source: National Highway Traffic Safety Administration (NHTSA)", SAFETY_X + SAFETY_W / 2, foot + 5, 8.4, "bold", { align: "center", color: PAPER });
  T(p, "www.nhtsa.gov/ratings", SAFETY_X + SAFETY_W / 2, foot + 17, 8.4, "bold", { align: "center", color: PAPER });
}

// ── Parts content ─────────────────────────────────────────────────────

export const PARTS_X = 956;
const PARTS_W = 218;

function paintParts(p: Painter, d: FactoryStickerData): void {
  const top = Y(442);
  const bottom = Y(641);
  R(p, PARTS_X, top, PARTS_W, bottom - top, null, 2.4);
  const f = partsFacts(d);
  const hasCarline = !!f.usCan || f.other.length > 0;
  const hasVehicle = !!f.assembly || !!f.engine || !!f.trans;
  const cx = PARTS_X + PARTS_W / 2;
  T(p, "PARTS CONTENT INFORMATION", cx, top + 5, 10.4, "bold", { align: "center" });
  if (!hasCarline && !hasVehicle) {
    T(p, "Not available for this vehicle.", cx, top + 26, 10, "body", { align: "center" });
    return;
  }
  const width = PARTS_W - 14;
  const limit = bottom - 4;
  let y = top + 20;
  const run = (draw: boolean, size: number): void => {
    y = top + 20;
    const step = size * 1.1;
    const line = (s: string): void => {
      for (const l of wrap(s.toUpperCase(), "bold", size, width)) {
        if (draw) T(p, l, PARTS_X + 7, y, size, "bold");
        y += step;
      }
    };
    if (hasCarline) {
      line("FOR VEHICLES IN THIS CARLINE:");
      if (f.usCan) line(`U.S./CANADIAN PARTS CONTENT: ${f.usCan.value}`);
      if (f.other.length) line("MAJOR SOURCES OF FOREIGN PARTS CONTENT:");
      for (const e of f.other) line(/foreign/i.test(e.label) ? e.value : `${e.label}: ${e.value}`);
      for (const l of wrap("Note: parts content does not include final assembly, distribution, or other non-parts costs.", "body", size - 1, width)) {
        if (draw) T(p, l, PARTS_X + 7, y, size - 1, "body");
        y += (size - 1) * 1.1;
      }
      y += 2;
    }
    if (hasVehicle) {
      line("FOR THIS VEHICLE:");
      if (f.assembly) line(`${assemblyLabel(d)}: ${f.assembly}`);
      if (f.engine || f.trans) {
        line("COUNTRY OF ORIGIN:");
        if (f.engine) line(`ENGINE: ${f.engine.value}`);
        if (f.trans) line(`TRANSMISSION: ${f.trans.value}`);
      }
    }
  };
  let size = 10;
  run(false, size);
  while (y > limit && size > 6) {
    size -= 0.5;
    run(false, size);
  }
  if (y <= limit) run(true, size);
}

export function paintPassport(p: Painter, url: string): void {
  if (!url) return;
  const y = Y(649);
  p.qr(PARTS_X + 2, y, PASSPORT_QR_PT, url, INK);
  T(p, "VEHICLE PASSPORT", PARTS_X + PASSPORT_QR_PT + 10, y + 20, 9, "bold");
  T(p, PASSPORT_QR_CAPTION, PARTS_X + PASSPORT_QR_PT + 10, y + 33, 8, "body");
}

// ── Pricing, warranty, footer ─────────────────────────────────────────

/** Returns the y below the warranty block, or null when the pricing column cannot hold every row. */
function paintPricing(p: Painter, d: FactoryStickerData, rows: PriceRow[]): number | null {
  const pr = d.pricing;
  const head = "OPTIONAL EQUIPMENT";
  let y = Y(217);
  T(p, head, COL2_X, y, 10, "bold");
  T(p, "(May Replace Standard Equipment)", COL2_X + measureText(head, "bold", 10) + 4, y + 1.6, 7, "body");
  y = Y(228);
  for (const row of rows) {
    const top = y;
    for (const l of wrap(row.label, "body", 8.5, 205)) {
      T(p, l, COL2_X, y, 8.5, "body");
      y += 9;
    }
    if (row.amount) T(p, row.amount, COL2_R, top, 8.5, "body", { align: "right" });
    for (const f of row.features) {
      for (const l of wrap(f, "body", 7.5, 215)) {
        T(p, l, COL2_X + 6, y, 7.5, "body");
        y += 8;
      }
    }
  }
  if (pr.gasGuzzlerTax !== undefined) {
    y += 3;
    T(p, "Gas Guzzler Tax", COL2_X, y, 8.5, "body");
    T(p, formatMoney(pr.gasGuzzlerTax), COL2_R, y, 8.5, "body", { align: "right" });
    y += 9;
  }
  y += 5;
  T(p, "Destination Charge", COL2_X, y, 9.5, "bold");
  T(p, pr.destinationCharge !== undefined ? formatMoney(pr.destinationCharge) : "NOT AVAILABLE", COL2_R, y, 9.5, "bold", { align: "right" });
  y += 18;
  if (y > Y(560)) return null;
  paintPriceBox(p, 358, y, 222, 30);
  const total = totalMsrp(d);
  T(p, "TOTAL PRICE: *", 366, y + 8, 11.5, "bold");
  T(p, total !== undefined ? formatMoney(total) : "NOT AVAILABLE", 572, y + (total !== undefined ? 7.5 : 9), total !== undefined ? 13 : 9.5, "bold", { align: "right" });
  y += 40;
  T(p, "WARRANTY COVERAGE", 346.8, y, 9, "bold");
  y += 11;
  const w = warrantySection(d, "Warranty");
  for (const item of w ? w.items : ["Not available for this vehicle."]) {
    for (const l of wrap(item, "body", 8, 240)) {
      T(p, l, 346.8, y, 8, "body");
      y += 8.8;
    }
  }
  return y + 4;
}

function paintFooter(p: Painter, d: FactoryStickerData, barcodePayload: string, limit: number): void {
  R(p, 54, Y(669), 791, 0.8, INK);
  const assembly = d.factory.finalAssemblyPoint;
  if (assembly) T(p, `Assembly Point/Port of Entry: ${assembly.toUpperCase()}`, 54, Y(676), 7.5, "body");
  T(p, "SOLD TO:", 436, Y(676), 6.5, "bold");
  const code = d.factory.dealerCode;
  if (code) T(p, code.toUpperCase(), 436 + measureText("SOLD TO:", "bold", 6.5) + 3, Y(676), 6.5, "bold");
  dealerLines(d).slice(0, 3).forEach((l, i) => T(p, l, 436, Y(684) + i * 7.8, 7, "body"));
  T(p, "VIN:", 55.3, Y(690.4), 7, "bold");
  T(p, d.vehicle.vin, 74, Y(687.5), 10, "bold");
  if (barcodePayload) p.barcode(54, Y(699), 250, Math.min(40, limit - Y(699)), barcodePayload, INK);
  const note = "* Original manufacturer's suggested retail prices shown. Excludes taxes, title, license, dealer-installed items and current selling price.";
  wrap(note, "body", 6.5, 280).forEach((l, i) => T(p, l, 313.3, Y(716) + i * 7.4, 6.5, "body", { lh: 7.4 }));
}

// ── Page ──────────────────────────────────────────────────────────────

function equipmentColumns(first: ColumnSpec, upper: ColumnSpec, lower: ColumnSpec, extra: number): ColumnSpec[] {
  const n = 1 + extra;
  const gap = 12;
  const w = (first.w - gap * (n - 1)) / n;
  const split = Array.from({ length: n }, (_, i) => ({ ...first, x: first.x + i * (w + gap), w }));
  return [...split, upper, lower];
}

export interface FcaBrand {
  frameColor: string;
  paintHeader: (p: Painter, d: FactoryStickerData) => void;
  specTitle: (d: FactoryStickerData) => string;
  priceRows: (d: FactoryStickerData) => PriceRow[];
  /** Replaces the fuel-economy, safety, parts-content and Passport panels on the right (a brand whose reference prints other panels there). */
  paintRight?: (p: Painter, d: FactoryStickerData) => void;
}

const makeSpec = (brand: FcaBrand): TabloidSpec => ({
  eqStyle: EQ_STYLE,
  paintFirst(p: Painter, ctx: FirstPageContext): FirstPageResult | null {
    const { d, input } = ctx;
    const bottomLimit = Math.min(711, ctx.footerTop * 0.612 - 13);
    const lower = paintPricing(p, d, brand.priceRows(d));
    if (lower === null) return null;
    paintFrame(p, bottomLimit + 9, brand.frameColor);
    brand.paintHeader(p, d);
    const specBottom = paintSpec(p, d, brand.specTitle(d));
    paintFooter(p, d, input.layout.barcodePayload, bottomLimit - 2);
    if (brand.paintRight) {
      brand.paintRight(p, d);
    } else {
      paintEpa(p, d);
      paintSafety(p, d);
      paintParts(p, d);
      paintPassport(p, d.document.passportUrl.trim());
    }

    const headY = Math.max(Y(236), specBottom + 2);
    const head = "STANDARD EQUIPMENT";
    underlined(p, head, Q(61.1), Q(headY), Q(10));
    const noteX = 61.1 + measureText(head, "bold", 10) + 5;
    const noteText = "(UNLESS REPLACED BY OPTIONAL EQUIPMENT)";
    T(p, noteText, noteX, headY + 1.6, fitSize(noteText, "body", 7, 330 - noteX, 5.5), "body");
    const sections = buildSections(input);
    if (!sections.length) T(p, "Standard equipment not available for this vehicle.", 61.1, headY + 14, 8, "body");
    const entries = toEntries(sections, (s) => s.toUpperCase(), 3, undefined, input.equipmentNote);
    const cols = equipmentColumns(
      { x: Q(57), w: Q(272), top: Q(headY + 13), bottom: Q(Y(668)) },
      { x: Q(COL2_X), w: Q(COL2_W), top: Q(Y(141)), bottom: Q(Y(214)) },
      { x: Q(COL2_X), w: Q(COL2_W), top: Q(lower), bottom: Q(Y(668)) },
      ctx.extraColumns,
    );
    const { placed, rest } = flow(entries, cols, ctx.style);
    paintPlaced(p, placed, ctx.style, { headingFont: "bold" });
    return placedResult(entries, rest);
  },
});

export const buildFcaLayout = (brand: FcaBrand): VariantLayoutBuilder => {
  const spec = makeSpec(brand);
  return (input): LayoutModel | null => {
    const model = assembleTabloid(input, spec);
    if (model && (model.width !== TABLOID_WIDTH || model.height !== TABLOID_HEIGHT)) return null;
    return model;
  };
};
