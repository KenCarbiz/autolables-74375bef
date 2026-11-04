// 17x11 reproduction layout for the 2026 Mitsubishi Outlander Sport, translated
// from the handoff geometry of "Mitsubishi_2026_Outlander_Sport_S" (Figma file
// VehaYwRPRnGDHVPNxrppeA, master 1:393). The reference PDF stores a landscape
// label rotated 90 degrees on a 792x1224pt page (reference_stored_rotated); the
// geometry below is the upright landscape arrangement, written in the upright
// label's own points and mapped onto the 1224x792 page by Y(), which keeps the
// horizontals and compresses verticals so the content clears the mandatory
// reproduction banner above and disclosure below.
//
// Every printed value comes from render data; nothing from the reference
// sample (VIN, prices, ratings, QR, barcode, parts content, dealer) is used as
// a default. The 10-year powertrain warranty graphic, the "Confidence"
// included-items list, agency seals, the source QR, the cumulative-accessory
// weight line, route code, location and the federal-law label statement are
// intentionally not reproduced.

import type { FactoryStickerData } from "../../types.ts";
import { Painter, fuelCategoryLabel, formatMoney, measureText, type LayoutModel } from "../layout.ts";
import { PASSPORT_QR_CAPTION } from "../../reproduction.ts";
import { VARIANT_LOGOS } from "./logoArtwork.ts";
import { EPA_BLUE, INK, PAPER, type VariantLayoutBuilder } from "./shared.ts";
import { PASSPORT_QR_PT, R, T, Y, paintScale, scaleState, wrap } from "./hyundaiTucsonGas.ts";
import {
  TABLOID_HEIGHT, TABLOID_WIDTH, assembleTabloid, assemblyLabel, buildSections, colorText, dealerLines, flow, paintPlaced,
  paintSafetyPanel, partsFacts, placedResult, priceRowsWithoutColors, toEntries, totalMsrp, warrantySection,
  type ColumnSpec, type FirstPageContext, type FirstPageResult, type FlowStyle, type TabloidSpec,
} from "./tabloidCommon.ts";

export const MITSUBISHI_OUTLANDER_SPORT_ID = "mitsubishi_2026_outlander_sport_s";

const Q = (pt: number): number => pt / 0.612;
const EQ_STYLE: FlowStyle = { size: 12.4, lh: 14.2, hang: 6, inset: 9 };
const FLOOR_PT = 5.5;

const Tx = (
  p: Painter, s: string, x: number, top: number, size: number, font: "body" | "bold" = "body",
  o: { align?: "left" | "right" | "center"; color?: string; lh?: number } = {},
): void => T(p, s, x, top, Math.max(FLOOR_PT, size), font, o);

const fitSize = (s: string, font: "body" | "bold", size: number, maxW: number, floor: number): number => {
  let z = size;
  while (z > floor && measureText(s, font, z) > maxW) z -= 0.25;
  return z;
};

// Left box, middle column and right column, in upright-label points.
const BOX_X = 40;
const BOX_W = 604;
const MID_X = 443;
const MID_R = 640;
const RIGHT_X = 652;
const RIGHT_W = 526;
const SAFETY_X = 851;
const SAFETY_W = 327;

// ── Header ────────────────────────────────────────────────────────────

function paintHeader(p: Painter, d: FactoryStickerData): void {
  const logo = VARIANT_LOGOS.mitsubishi;
  p.image(logo.png, logo.assetId, 72, Y(58), 66, (66 * 878) / 900);
  const v = d.vehicle;
  const title = [v.year > 0 ? String(v.year) : "", v.model, v.trim ?? ""].filter(Boolean).join(" ").toUpperCase();
  Tx(p, title, 172, Y(56), fitSize(title, "body", 10.5, 262, 7), "body");
  let y = Y(84);
  const colors = [colorText(v.exteriorColor, v.exteriorColorCode), colorText(v.interiorColor, v.interiorColorCode)].filter((s): s is string => !!s);
  if (colors.length) {
    const c = colors.join(" / ");
    Tx(p, c, 172, y, fitSize(c, "body", 10, 262, 6.5), "body");
  }
  y = Y(112);
  for (const s of [v.engine, v.transmission, d.factory.emissionsCode, v.drivetrain]) {
    if (!s) continue;
    const line = s.toUpperCase();
    Tx(p, line, 172, y, fitSize(line, "body", 7.5, 262, 6), "body");
    y += 10.4;
  }
}

// ── Fuel economy and environment (native rebuild of the label's panel) ──


const EPA_BOTTOM = 384;
const DX = (x: number): number => RIGHT_X + (x - 625) * 0.956;
const EY = (ref: number): number => Y(ref - 60);

function paintEpa(p: Painter, d: FactoryStickerData): void {
  const r = d.regulatory;
  const top = EY(101);
  const bottom = Y(EPA_BOTTOM);
  const panelBottom = EY(350);
  const left = RIGHT_X;
  const width = RIGHT_W;
  R(p, left, top, width, bottom - top, INK);
  R(p, left + 3, EY(138), width - 6, panelBottom - EY(138), PAPER);
  Tx(p, "EPA", left + 4, EY(106), 9.5, "bold", { color: PAPER, lh: 10 });
  Tx(p, "DOT", left + 4, EY(106) + 10.2, 9.5, "bold", { color: PAPER, lh: 10 });
  Tx(p, "Fuel Economy and Environment", DX(684), EY(112), 16, "bold", { color: PAPER });
  if (d.vehicle.fuelType) {
    R(p, DX(1003), EY(106), 160, EY(134) - EY(106), EPA_BLUE);
    Tx(p, fuelCategoryLabel(d.vehicle.fuelType), left + width - 11, EY(114), 10.5, "bold", { align: "right" });
  }

  const rule = EY(265);
  R(p, left + 3, rule, width - 6, 2.2, INK);
  R(p, DX(779), rule, 2.2, panelBottom - rule, INK);
  const verified = r.epaStatus === "VERIFIED";
  const mpgOk = verified && r.combinedMpg !== undefined;

  Tx(p, "Annual fuel", DX(639), EY(281.4), 12, "bold");
  Tx(p, "cost", DX(639) + measureText("Annual fuel", "bold", 12) + 4, EY(274), 18, "bold");
  if (verified && r.annualFuelCost !== undefined) Tx(p, formatMoney(r.annualFuelCost).replace(/\.00$/, ""), DX(645), EY(303), 34, "bold");
  else Tx(p, "Not Available", DX(645), EY(312), 11, "bold");

  const ghgHead = "Fuel Economy & Greenhouse Gas Rating";
  const gx = DX(792);
  Tx(p, ghgHead, gx, EY(273.7), 8.6, "bold");
  Tx(p, "(tailpipe only)", gx + measureText(ghgHead, "bold", 8.6) + 3, EY(275.5), 6, "body");
  paintScale(p, gx + 2, EY(308), 214, scaleState(verified ? r.greenhouseGasRating : undefined), 13);
  const sx = DX(1045);
  Tx(p, "Smog Rating", sx, EY(273.7), 8.6, "bold");
  Tx(p, "(tailpipe only)", sx + measureText("Smog Rating", "bold", 8.6) + 3, EY(275.5), 6, "body");
  paintScale(p, sx + 2, EY(308), 105, scaleState(verified ? r.smogRating : undefined), 13);
  if (verified && r.co2TailpipeGpm !== undefined) {
    const line = `This vehicle emits ${Math.round(r.co2TailpipeGpm)} grams CO2 per mile (tailpipe only). The best emits 0 grams per mile (tailpipe only). Producing and distributing fuel also create emissions; learn more at fueleconomy.gov.`;
    wrap(line, "body", 5.8, 340).slice(0, 2).forEach((l, i) => Tx(p, l, gx + 2, EY(334) + i * 6.6, 5.8, "body", { lh: 6.6 }));
  }

  Tx(p, "Fuel Economy", DX(667), EY(148), 11, "bold");
  if (!mpgOk) {
    wrap("Fuel economy and environment information is not available from verified EPA records for this exact configuration.", "bold", 12, 330)
      .forEach((l, i) => Tx(p, l, DX(667), EY(172) + i * 15, 12, "bold", { lh: 15 }));
  } else {
    p.text(String(Math.round(r.combinedMpg!)), DX(664), EY(224), 60, "bold", INK);
    Tx(p, "MPG", DX(752), EY(173), 18, "bold");
    Tx(p, "combined city/hwy", DX(664), EY(225.5), 8, "body");
    if (r.cityMpg !== undefined) {
      Tx(p, String(Math.round(r.cityMpg)), DX(760), EY(198.4), 20, "bold");
      Tx(p, "city", DX(760), EY(220), 8, "body");
    }
    if (r.highwayMpg !== undefined) {
      Tx(p, String(Math.round(r.highwayMpg)), DX(805), EY(198.4), 20, "bold");
      Tx(p, "highway", DX(805), EY(220), 8, "body");
    }
    if (r.epaClassNote) wrap(r.epaClassNote, "body", 7.5, 150).slice(0, 3).forEach((l, i) => Tx(p, l, DX(838), EY(170) + i * 8.4, 7.5, "body", { lh: 8.4 }));
    const gallons = r.gallonsPer100Miles ?? (r.combinedMpg! > 0 ? 100 / r.combinedMpg! : undefined);
    if (gallons !== undefined) {
      const g = gallons.toFixed(1);
      Tx(p, g, DX(662), EY(241.5), 20, "bold");
      Tx(p, "gallons per 100 miles", DX(662) + measureText(g, "bold", 20) + 4, EY(250.9), 8, "body");
    }
  }
  const delta = verified ? r.fiveYearCostDifference : undefined;
  const bx = DX(1018);
  if (delta !== undefined && delta !== 0) {
    Tx(p, delta > 0 ? "You save" : "You spend", bx, EY(142), 19, "bold");
    Tx(p, formatMoney(Math.abs(delta)).replace(/\.00$/, ""), bx, EY(170), 32, "bold");
    ["in fuel costs over 5 years", "compared to the average", "new vehicle."].forEach((l, i) =>
      Tx(p, l, bx + 4, EY(211) + i * 12, i === 0 ? 10 : 9, i === 0 ? "bold" : "body", { lh: 12 }));
  } else {
    Tx(p, "5-year fuel cost comparison", bx, EY(180), 9, "bold");
    Tx(p, "Not Available", bx, EY(194), 11, "bold");
  }

  const foot = panelBottom + 4;
  Tx(p, "fueleconomy.gov", DX(632), foot + 30, 21, "bold", { color: PAPER });
  Tx(p, "Calculate personalized estimates and compare vehicles", DX(632), foot + 58, 7.6, "bold", { color: PAPER });
  const note = "Actual results will vary for many reasons, including driving conditions and how you drive and maintain your vehicle. Cost estimates are current EPA estimates and may differ from those printed on the original label.";
  wrap(note, "bold", 6.6, 400).forEach((l, i) => Tx(p, l, DX(632), foot + 3 + i * 7.4, 6.6, "bold", { color: PAPER, lh: 7.4 }));
}

function paintPassport(p: Painter, url: string): void {
  if (!url) return;
  const size = PASSPORT_QR_PT;
  const x = RIGHT_X + RIGHT_W - size - 8;
  const y = EY(350) + 5;
  p.rect(x, y, size, size, PAPER);
  p.qr(x, y, size, url, INK);
  Tx(p, PASSPORT_QR_CAPTION, x + size / 2, y + size + 1.5, 6, "bold", { align: "center", color: PAPER });
}

// ── Warranty, parts content ───────────────────────────────────────────

function paintWarranty(p: Painter, d: FactoryStickerData): void {
  const top = Y(392);
  const bottom = Y(504);
  const w = 190;
  R(p, RIGHT_X, top, w, bottom - top, null, 2.4);
  Tx(p, "WARRANTY COVERAGE", RIGHT_X + w / 2, top + 5, 9.5, "bold", { align: "center" });
  const section = warrantySection(d, "Warranty");
  if (!section) {
    Tx(p, "Not available for this vehicle.", RIGHT_X + w / 2, top + 26, 9.5, "body", { align: "center" });
    return;
  }
  const width = w - 16;
  const lines = (size: number): string[] => section.items.flatMap((i) => wrap(i, "body", size, width));
  let size = 8.5;
  while (size > FLOOR_PT && 20 + lines(size).length * size * 1.15 > bottom - top - 4) size -= 0.25;
  lines(size).forEach((l, i) => Tx(p, l, RIGHT_X + 8, top + 20 + i * size * 1.15, size, "body"));
}

function paintParts(p: Painter, d: FactoryStickerData): void {
  const top = Y(510);
  const bottom = Y(658);
  const w = 190;
  R(p, RIGHT_X, top, w, bottom - top, null, 2.4);
  const f = partsFacts(d);
  const hasCarline = !!f.usCan || f.other.length > 0;
  const hasVehicle = !!f.assembly || !!f.engine || !!f.trans;
  const cx = RIGHT_X + w / 2;
  Tx(p, "PARTS CONTENT INFORMATION", cx, top + 5, 9, "bold", { align: "center" });
  if (!hasCarline && !hasVehicle) {
    Tx(p, "Not available for this vehicle.", cx, top + 24, 9.5, "body", { align: "center" });
    return;
  }
  const width = w - 14;
  const limit = bottom - 4;
  let y = top + 18;
  const run = (draw: boolean, size: number): void => {
    y = top + 18;
    const step = size * 1.1;
    const line = (s: string): void => {
      for (const l of wrap(s.toUpperCase(), "bold", size, width)) {
        if (draw) Tx(p, l, RIGHT_X + 7, y, size, "bold");
        y += step;
      }
    };
    if (hasCarline) {
      line("FOR VEHICLES IN THIS CARLINE:");
      if (f.usCan) line(`U.S./CANADIAN PARTS CONTENT: ${f.usCan.value}`);
      if (f.other.length) line("MAJOR SOURCES OF FOREIGN PARTS CONTENT:");
      for (const e of f.other) line(/foreign/i.test(e.label) ? e.value : `${e.label}: ${e.value}`);
      for (const l of wrap("Note: parts content does not include final assembly, distribution, or other non-parts costs.", "body", Math.max(FLOOR_PT, size - 1), width)) {
        if (draw) Tx(p, l, RIGHT_X + 7, y, Math.max(FLOOR_PT, size - 1), "body");
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
  let size = 9;
  run(false, size);
  while (y > limit && size > FLOOR_PT + 0.5) {
    size -= 0.25;
    run(false, size);
  }
  if (y <= limit) run(true, size);
}

// ── Safety ────────────────────────────────────────────────────────────

function paintSafety(p: Painter, d: FactoryStickerData): void {
  const r = d.regulatory;
  const top = Y(392);
  const h = Y(658) - top;
  const ratings = [r.overallRating, r.frontalDriverRating, r.frontalPassengerRating, r.sideFrontRating, r.sideRearRating, r.rolloverRating, r.frontalRating, r.sideRating];
  const anyRated = r.nhtsaStatus === "VERIFIED" && ratings.some((n) => n !== undefined && n > 0);
  if (anyRated) {
    paintSafetyPanel(p, d, Q(SAFETY_X), Q(top), Q(SAFETY_W), Q(h), {
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
  Tx(p, "GOVERNMENT 5-STAR SAFETY RATINGS", SAFETY_X + SAFETY_W / 2, top + 5.5, 12.4, "bold", { align: "center", color: PAPER });
  R(p, SAFETY_X + 4, top + headerH, SAFETY_W - 8, msgH, PAPER);
  wrap(message, "body", 10.5, SAFETY_W - 24).forEach((l, i) => Tx(p, l, SAFETY_X + 10, top + headerH + 5 + i * 12.4, 10.5, "body", { lh: 12.4 }));
  const foot = top + headerH + msgH;
  Tx(p, "Source: National Highway Traffic Safety Administration (NHTSA)", SAFETY_X + SAFETY_W / 2, foot + 5, 8.4, "bold", { align: "center", color: PAPER });
  Tx(p, "www.nhtsa.gov/ratings", SAFETY_X + SAFETY_W / 2, foot + 17, 8.4, "bold", { align: "center", color: PAPER });
}

// ── Additional equipment and pricing ──────────────────────────────────

/** Returns the y below the additional-equipment rows, or null when the totals stack cannot fit. */
function paintPricing(p: Painter, d: FactoryStickerData, totalsTop: number): number | null {
  const pr = d.pricing;
  let y = Y(58);
  Tx(p, "Additional Equipment", MID_X, y, 9.5, "bold");
  y = Y(76);
  const rows = priceRowsWithoutColors(d);
  if (!rows.length) {
    Tx(p, "None listed.", MID_X, y, 8, "body");
    y += 10;
  }
  for (const row of rows) {
    const rowTop = y;
    for (const l of wrap(row.label, "body", 7.8, 150)) {
      Tx(p, l, MID_X, y, 7.8, "body");
      y += 8.8;
    }
    if (row.amount) Tx(p, row.amount, MID_R, rowTop, 7.8, "body", { align: "right" });
    for (const f of row.features) {
      for (const l of wrap(f, "body", 6.8, 175)) {
        Tx(p, l, MID_X + 8, y, 6.8, "body");
        y += 7.8;
      }
    }
    y += 2;
  }
  if (pr.gasGuzzlerTax !== undefined) {
    Tx(p, "Gas Guzzler Tax", MID_X, y, 7.8, "body");
    Tx(p, formatMoney(pr.gasGuzzlerTax), MID_R, y, 7.8, "body", { align: "right" });
    y += 9;
  }
  const money = (n: number | undefined): string => (n === undefined ? "NOT AVAILABLE" : formatMoney(n));
  const base = pr.baseMsrp;
  const options = pr.factoryInstalledTotal;
  const subtotal = base !== undefined && options !== undefined ? base + options : undefined;
  const lines: Array<[string, string, boolean]> = [
    ["MSRP*:", money(base), false],
    ["Total Additional Equipment:", money(options), false],
    ["Subtotal:", money(subtotal), false],
    ["Destination/Handling:", money(pr.destinationCharge), false],
    ["Total MSRP*:", money(totalMsrp(d)), true],
  ];
  const need = lines.length * 13 + 10;
  if (y + 4 > totalsTop - need) return null;
  let ty = totalsTop - need;
  for (const [label, value, strong] of lines) {
    const size = strong ? 10.5 : 8.8;
    const unavailable = value === "NOT AVAILABLE";
    Tx(p, label, MID_R - 66, ty, size, strong ? "bold" : "body", { align: "right" });
    Tx(p, value, MID_R, ty + (unavailable ? 1 : 0), unavailable ? 7 : size, "bold", { align: "right" });
    ty += strong ? 15 : 12.5;
  }
  Tx(p, "*MSRP (Manufacturer's Suggested Retail Price)", MID_R, ty - 1, 5.6, "body", { align: "right" });
  return y;
}

// ── Footer ────────────────────────────────────────────────────────────

function paintFooter(p: Painter, d: FactoryStickerData, barcodePayload: string, bottom: number): void {
  const top = Y(667);
  R(p, RIGHT_X, top, RIGHT_W, bottom - top, null, 2.4);
  if (barcodePayload) p.barcode(RIGHT_X + 330, top + 5, 186, 26, barcodePayload, INK);
  Tx(p, "VIN:", RIGHT_X + 330, top + 36, 8, "bold");
  Tx(p, d.vehicle.vin, RIGHT_X + 350, top + 34, 10.5, "bold");
  let y = top + 5;
  Tx(p, "SHIP TO:", RIGHT_X + 8, y, 7.5, "bold");
  const code = d.factory.dealerCode;
  if (code) Tx(p, code.toUpperCase(), RIGHT_X + 8 + measureText("SHIP TO:", "bold", 7.5) + 4, y, 7.5, "bold");
  dealerLines(d).slice(0, 3).forEach((l, i) => Tx(p, l, RIGHT_X + 8, y + 9 + i * 8.4, 7, "body"));
  y = top + 37;
  if (d.factory.transportMethod) Tx(p, `Method of Transport: ${d.factory.transportMethod.toUpperCase()}`, RIGHT_X + 8, y, 6.8, "body");
  const assembly = d.factory.finalAssemblyPoint;
  if (assembly) Tx(p, `Plant/Port of Entry: ${assembly.toUpperCase()}`, RIGHT_X + 8, y + 8.4, 6.8, "body");
  const note = "* Original manufacturer's suggested retail prices shown. Excludes taxes, title, license, dealer-installed items and current selling price.";
  wrap(note, "body", 6, RIGHT_W - 20).forEach((l, i) => Tx(p, l, RIGHT_X + 8, top + 56 + i * 7, 6, "body", { lh: 7 }));
}

// ── Page ──────────────────────────────────────────────────────────────

function equipmentColumns(first: ColumnSpec, second: ColumnSpec, third: ColumnSpec, extra: number): ColumnSpec[] {
  const n = 2 + extra;
  const gap = 10;
  const x0 = first.x;
  const w = (second.x + second.w - x0 - gap * (n - 1)) / n;
  const split = Array.from({ length: n }, (_, i) => ({ ...first, x: x0 + i * (w + gap), w }));
  return [...split, third];
}

const spec: TabloidSpec = {
  eqStyle: EQ_STYLE,
  paintFirst(p: Painter, ctx: FirstPageContext): FirstPageResult | null {
    const { d, input } = ctx;
    const bottomLimit = Math.min(Y(745), ctx.footerTop * 0.612 - 9);
    const barH = 15;
    const totalsTop = bottomLimit - barH - 2;
    const pricingBottom = paintPricing(p, d, totalsTop);
    if (pricingBottom === null) return null;

    R(p, BOX_X, Y(40), BOX_W, bottomLimit - Y(40), null, 2.4);
    R(p, BOX_X, bottomLimit - barH, BOX_W, barH, INK);
    Tx(p, "Visit us at www.mitsubishicars.com", BOX_X + BOX_W / 2, bottomLimit - barH + 2.5, 10.5, "bold", { align: "center", color: PAPER });
    paintHeader(p, d);
    paintEpa(p, d);
    paintPassport(p, d.document.passportUrl.trim());
    paintWarranty(p, d);
    paintParts(p, d);
    paintSafety(p, d);
    paintFooter(p, d, input.layout.barcodePayload, bottomLimit);

    const sections = buildSections(input);
    const eqTop = Y(163);
    if (!sections.length) Tx(p, "Standard equipment not available for this vehicle.", 47, eqTop, 8, "body");
    const entries = toEntries(sections, (s) => s, 5, undefined, input.equipmentNote);
    const cols = equipmentColumns(
      { x: Q(47), w: Q(185), top: Q(eqTop), bottom: Q(totalsTop - 4) },
      { x: Q(245), w: Q(191), top: Q(eqTop), bottom: Q(totalsTop - 4) },
      { x: Q(MID_X), w: Q(200), top: Q(pricingBottom + 6), bottom: Q(totalsTop - 70) },
      ctx.extraColumns,
    );
    const { placed, rest } = flow(entries, cols, ctx.style);
    paintPlaced(p, placed, ctx.style, { bullet: "square", headingFont: "bold" });
    return placedResult(entries, rest);
  },
};

export const buildMitsubishiOutlanderSportLayout: VariantLayoutBuilder = (input): LayoutModel | null => {
  const model = assembleTabloid(input, spec);
  if (model && (model.width !== TABLOID_WIDTH || model.height !== TABLOID_HEIGHT)) return null;
  return model;
};
