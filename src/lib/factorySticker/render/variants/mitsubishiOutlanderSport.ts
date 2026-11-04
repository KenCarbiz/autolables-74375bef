// 11x17 portrait reproduction layout for the 2026 Mitsubishi Outlander Sport,
// translated from the handoff geometry of "Mitsubishi_2026_Outlander_Sport_S"
// (Figma file VehaYwRPRnGDHVPNxrppeA, master 1:393). The reference is a
// landscape label printed rotated onto an 792x1224pt portrait sheet. The
// primitives here are axis-aligned (a rotated QR or barcode is a scanning
// risk), so the same panels are laid out upright and stacked on the same
// 792x1224 page. Coordinates are PDF points.
//
// Every printed value comes from render data; nothing from the reference
// sample (VIN, prices, ratings, QR, barcode, parts content, dealer) is used as
// a default. The logo is the packaged Mitsubishi artwork. The warranty
// graphic, the "Confidence" included-items list, agency seals, the source QR,
// the cumulative-accessory-weight line and the federal-law label statement are
// intentionally not reproduced.

import type { FactoryStickerData } from "../../types.ts";
import {
  Painter, fitOk, fuelCategoryLabel, formatMoney, measureText, validateModel, type LayoutModel,
} from "../layout.ts";
import { PASSPORT_QR_CAPTION, REPRODUCTION_BANNER, reproductionDisclosureLines } from "../../reproduction.ts";
import { VARIANT_LOGOS } from "./logoArtwork.ts";
import { EPA_BLUE, INK, PAPER, type VariantLayoutBuilder, type VariantRenderInput } from "./shared.ts";
import { PASSPORT_QR_PT, R, T, paintScale, scaleState, wrap } from "./hyundaiTucsonGas.ts";
import {
  MAX_EXTRA_COLUMNS, assemblyLabel, buildSections, colorText, dealerLines, flow, paintPlaced, paintSafetyPanel,
  partsFacts, placedResult, priceRowsWithoutColors, styleLadder, toEntries, totalMsrp, underlined, warrantySection,
  type FlowStyle,
} from "./tabloidCommon.ts";

export const MITSUBISHI_OUTLANDER_SPORT_ID = "mitsubishi_2026_outlander_sport_s";

export const PORTRAIT_WIDTH = 792;
export const PORTRAIT_HEIGHT = 1224;

const Q = (pt: number): number => pt / 0.612;
const DISPLAY_PT = 0.612;
const EQ_STYLE: FlowStyle = { size: 13.4, lh: 15.6, hang: 6, inset: 10 };
const FLOOR_PT = 5.5;

const X0 = 24;
const X1 = 768;
const W = X1 - X0;

const Tx = (
  p: Painter, s: string, x: number, top: number, size: number, font: "body" | "bold" = "body",
  o: { align?: "left" | "right" | "center"; color?: string; lh?: number } = {},
): void => T(p, s, x, top, Math.max(FLOOR_PT, size), font, o);

const fitSize = (s: string, font: "body" | "bold", size: number, maxW: number, floor: number): number => {
  let z = size;
  while (z > floor && measureText(s, font, z) > maxW) z -= 0.25;
  return z;
};

// ── Header ────────────────────────────────────────────────────────────

function paintHeader(p: Painter, d: FactoryStickerData, top: number): number {
  const logo = VARIANT_LOGOS.mitsubishi;
  const lw = 96;
  p.image(logo.png, logo.assetId, X0 + 4, top, lw, (lw * 878) / 900);
  const v = d.vehicle;
  const title = [v.year > 0 ? String(v.year) : "", v.model, v.trim ?? ""].filter(Boolean).join(" ").toUpperCase();
  const tx = X0 + 120;
  Tx(p, title, tx, top + 2, fitSize(title, "bold", 24, X1 - tx - 8, 14), "bold");
  Tx(p, "Visit us at www.mitsubishicars.com", X1 - 4, top + 34, 10.5, "body", { align: "right" });
  let y = top + 34;
  const rows: Array<[string, string | null]> = [
    ["Exterior Color:", colorText(v.exteriorColor, v.exteriorColorCode)],
    ["Interior Color:", colorText(v.interiorColor, v.interiorColorCode)],
    ["Engine:", v.engine ?? null],
    ["Transmission:", v.transmission ?? null],
    ["Drivetrain:", v.drivetrain ?? null],
    ["Emissions:", d.factory.emissionsCode ?? null],
  ];
  for (const [label, value] of rows) {
    if (!value) continue;
    Tx(p, label, tx, y, 9.5, "bold");
    const x = tx + measureText(label, "bold", 9.5) + 4;
    const w = 440 - x;
    const size = fitSize(value, "body", 9.5, w, 7);
    for (const line of measureText(value, "body", size) <= w ? [value] : wrap(value, "body", 7, w)) {
      Tx(p, line.toUpperCase(), x, y, size, "body");
      y += 11.4;
    }
  }
  return Math.max(top + 100, y + 4);
}

// ── Fuel economy and environment ──────────────────────────────────────

const EPA_H = 296;

function paintEpa(p: Painter, d: FactoryStickerData, y0: number): void {
  const r = d.regulatory;
  const x = X0;
  R(p, x, y0, W, EPA_H, INK);
  Tx(p, "EPA", x + 5, y0 + 4, 9.5, "bold", { color: PAPER, lh: 10 });
  Tx(p, "DOT", x + 5, y0 + 14, 9.5, "bold", { color: PAPER, lh: 10 });
  Tx(p, "Fuel Economy and Environment", x + 52, y0 + 9, 17, "bold", { color: PAPER });
  R(p, x + W - 196, y0 + 4, 192, 26, EPA_BLUE);
  if (d.vehicle.fuelType) Tx(p, fuelCategoryLabel(d.vehicle.fuelType), x + W - 12, y0 + 11, 11, "bold", { align: "right" });

  const topY = y0 + 36;
  const topH = 134;
  R(p, x + 3, topY, W - 6, topH, PAPER);
  const lowY = topY + topH + 4;
  const lowH = 72;
  R(p, x + 3, lowY, W - 6, lowH, PAPER);
  R(p, x + 172, lowY, 2, lowH, INK);

  const verified = r.epaStatus === "VERIFIED";
  const mpgOk = verified && r.combinedMpg !== undefined;
  Tx(p, "Fuel Economy", x + 20, topY + 8, 11.5, "bold");

  if (!mpgOk) {
    wrap("Fuel economy and environment information is not available from verified EPA records for this exact configuration.", "bold", 12, 470)
      .forEach((l, i) => Tx(p, l, x + 20, topY + 34 + i * 15, 12, "bold", { lh: 15 }));
  } else {
    p.text(String(Math.round(r.combinedMpg!)), x + 18, topY + 90, 60, "bold", INK);
    Tx(p, "combined city/hwy", x + 20, topY + 94, 8, "body");
    Tx(p, "MPG", x + 138, topY + 22, 20, "bold");
    if (r.cityMpg !== undefined) {
      Tx(p, String(Math.round(r.cityMpg)), x + 142, topY + 52, 24, "bold");
      Tx(p, "city", x + 142, topY + 80, 8, "body");
    }
    if (r.highwayMpg !== undefined) {
      Tx(p, String(Math.round(r.highwayMpg)), x + 196, topY + 52, 24, "bold");
      Tx(p, "highway", x + 196, topY + 80, 8, "body");
    }
    if (r.epaClassNote) wrap(r.epaClassNote, "body", 8, 190).slice(0, 4).forEach((l, i) => Tx(p, l, x + 262, topY + 12 + i * 9, 8, "body", { lh: 9 }));
    const gallons = r.gallonsPer100Miles ?? (r.combinedMpg! > 0 ? 100 / r.combinedMpg! : undefined);
    if (gallons !== undefined) {
      const g = gallons.toFixed(1);
      Tx(p, g, x + 20, topY + 108, 20, "bold");
      Tx(p, "gallons per 100 miles", x + 20 + measureText(g, "bold", 20) + 5, topY + 118, 8, "body");
    }
  }
  const delta = verified ? r.fiveYearCostDifference : undefined;
  const bx = x + 520;
  if (delta !== undefined && delta !== 0) {
    Tx(p, delta > 0 ? "You save" : "You spend", bx, topY + 8, 20, "bold");
    Tx(p, formatMoney(Math.abs(delta)).replace(/\.00$/, ""), bx, topY + 34, 34, "bold");
    ["in fuel costs over 5 years", "compared to the average", "new vehicle."].forEach((l, i) =>
      Tx(p, l, bx, topY + 78 + i * 12, i === 0 ? 11 : 9.5, i === 0 ? "bold" : "body", { lh: 12 }));
  } else {
    Tx(p, "5-year fuel cost comparison", bx, topY + 40, 9.5, "bold");
    Tx(p, "Not Available", bx, topY + 54, 11, "bold");
  }

  Tx(p, "Annual fuel", x + 16, lowY + 8, 13, "bold");
  Tx(p, "cost", x + 16 + measureText("Annual fuel", "bold", 13) + 4, lowY + 4, 19, "bold");
  if (verified && r.annualFuelCost !== undefined) Tx(p, formatMoney(r.annualFuelCost).replace(/\.00$/, ""), x + 16, lowY + 26, 32, "bold");
  else Tx(p, "Not Available", x + 16, lowY + 34, 11, "bold");

  const ghgHead = "Fuel Economy & Greenhouse Gas Rating";
  Tx(p, ghgHead, x + 186, lowY + 4, 9, "bold");
  Tx(p, "(tailpipe only)", x + 186 + measureText(ghgHead, "bold", 9) + 3, lowY + 5.5, 6.5, "body");
  paintScale(p, x + 190, lowY + 32, 270, scaleState(verified ? r.greenhouseGasRating : undefined), 14);
  Tx(p, "Smog Rating", x + 500, lowY + 4, 9, "bold");
  Tx(p, "(tailpipe only)", x + 500 + measureText("Smog Rating", "bold", 9) + 3, lowY + 5.5, 6.5, "body");
  paintScale(p, x + 504, lowY + 32, 220, scaleState(verified ? r.smogRating : undefined), 14);
  if (verified && r.co2TailpipeGpm !== undefined) {
    const line = `This vehicle emits ${Math.round(r.co2TailpipeGpm)} grams CO2 per mile (tailpipe only). The best emits 0 grams per mile (tailpipe only). Producing and distributing fuel also create emissions; learn more at fueleconomy.gov.`;
    wrap(line, "body", 6.2, 540).slice(0, 2).forEach((l, i) => Tx(p, l, x + 186, lowY + 56 + i * 6.8, 6.2, "body", { lh: 6.8 }));
  }

  const footY = lowY + lowH + 4;
  Tx(p, "fueleconomy.gov", x + 10, footY + 4, 21, "bold", { color: PAPER });
  Tx(p, "Calculate personalized estimates and compare vehicles", x + 10, footY + 32, 8, "bold", { color: PAPER });
  const note = "Actual results will vary for many reasons, including driving conditions and how you drive and maintain your vehicle. Cost estimates are current EPA estimates and may differ from those printed on the original label.";
  wrap(note, "bold", 7.5, 470).forEach((l, i) => Tx(p, l, x + 256, footY + 5 + i * 9, 7.5, "bold", { color: PAPER, lh: 9 }));
}

// ── Safety and parts content ──────────────────────────────────────────

const SAFETY_W = 404;
const PANEL_H = 232;

function paintSafety(p: Painter, d: FactoryStickerData, top: number): void {
  const r = d.regulatory;
  const ratings = [r.overallRating, r.frontalDriverRating, r.frontalPassengerRating, r.sideFrontRating, r.sideRearRating, r.rolloverRating, r.frontalRating, r.sideRating];
  const anyRated = r.nhtsaStatus === "VERIFIED" && ratings.some((n) => n !== undefined && n > 0);
  if (anyRated) {
    paintSafetyPanel(p, d, Q(X0), Q(top), Q(SAFETY_W), Q(PANEL_H), {
      headerH: 36, footerH: 80, subFrac: 0.29, valFrac: 0.57,
      titleSize: 21, labelSize: 16.4, noteSize: 11.2, footSize: 13, stretch: 1.04,
    });
    return;
  }
  const message = r.nhtsaStatus === "UNAVAILABLE"
    ? "Government 5-star safety ratings are not available from a verified NHTSA record for this vehicle."
    : "This vehicle has not been rated by the government for overall vehicle score, frontal crash, side crash, or rollover risk.";
  const headerH = 24;
  const msgH = 64;
  const footH = 34;
  R(p, X0, top, SAFETY_W, headerH + msgH + footH, INK);
  Tx(p, "GOVERNMENT 5-STAR SAFETY RATINGS", X0 + SAFETY_W / 2, top + 6, 13, "bold", { align: "center", color: PAPER });
  R(p, X0 + 4, top + headerH, SAFETY_W - 8, msgH, PAPER);
  wrap(message, "body", 11, SAFETY_W - 28).forEach((l, i) => Tx(p, l, X0 + 12, top + headerH + 8 + i * 13, 11, "body", { lh: 13 }));
  const foot = top + headerH + msgH;
  Tx(p, "Source: National Highway Traffic Safety Administration (NHTSA)", X0 + SAFETY_W / 2, foot + 6, 8.4, "bold", { align: "center", color: PAPER });
  Tx(p, "www.nhtsa.gov/ratings", X0 + SAFETY_W / 2, foot + 19, 8.4, "bold", { align: "center", color: PAPER });
}

function paintParts(p: Painter, d: FactoryStickerData, top: number): void {
  const px = X0 + SAFETY_W + 12;
  const pw = X1 - px;
  const bottom = top + PANEL_H;
  R(p, px, top, pw, PANEL_H, null, 2.4);
  const f = partsFacts(d);
  const hasCarline = !!f.usCan || f.other.length > 0;
  const hasVehicle = !!f.assembly || !!f.engine || !!f.trans;
  const cx = px + pw / 2;
  Tx(p, "PARTS CONTENT INFORMATION", cx, top + 6, 11, "bold", { align: "center" });
  if (!hasCarline && !hasVehicle) {
    Tx(p, "Not available for this vehicle.", cx, top + 30, 10, "body", { align: "center" });
    return;
  }
  const width = pw - 16;
  const limit = bottom - 5;
  let y = top + 24;
  const run = (draw: boolean, size: number): void => {
    y = top + 24;
    const step = size * 1.12;
    const line = (s: string): void => {
      for (const l of wrap(s.toUpperCase(), "bold", size, width)) {
        if (draw) Tx(p, l, px + 8, y, size, "bold");
        y += step;
      }
    };
    if (hasCarline) {
      line("FOR VEHICLES IN THIS CARLINE:");
      if (f.usCan) line(`U.S./CANADIAN PARTS CONTENT: ${f.usCan.value}`);
      if (f.other.length) line("MAJOR SOURCES OF FOREIGN PARTS CONTENT:");
      for (const e of f.other) line(/foreign/i.test(e.label) ? e.value : `${e.label}: ${e.value}`);
      for (const l of wrap("Note: parts content does not include final assembly, distribution, or other non-parts costs.", "body", size - 1, width)) {
        if (draw) Tx(p, l, px + 8, y, size - 1, "body");
        y += (size - 1) * 1.12;
      }
      y += 3;
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
  while (y > limit && size > FLOOR_PT + 1) {
    size -= 0.5;
    run(false, size);
  }
  if (y <= limit) run(true, size);
}

// ── Additional equipment and pricing ──────────────────────────────────

const PRICE_X = 584;
const PRICE_W = X1 - PRICE_X;

/** Returns the y below the pricing column, or null when its rows cannot fit above `limit`. */
function paintPricing(p: Painter, d: FactoryStickerData, top: number, limit: number): number | null {
  const pr = d.pricing;
  let y = top;
  Tx(p, "ADDITIONAL EQUIPMENT", PRICE_X, y, 10, "bold");
  y += 14;
  const rows = priceRowsWithoutColors(d);
  if (!rows.length) {
    Tx(p, "None listed.", PRICE_X, y, 8.5, "body");
    y += 11;
  }
  for (const row of rows) {
    const rowTop = y;
    for (const l of wrap(row.label, "body", 8.5, PRICE_W - 52)) {
      Tx(p, l, PRICE_X, y, 8.5, "body");
      y += 9.6;
    }
    if (row.amount) Tx(p, row.amount, X1, rowTop, 8.5, "body", { align: "right" });
    for (const f of row.features) {
      for (const l of wrap(f, "body", 7.5, PRICE_W - 10)) {
        Tx(p, l, PRICE_X + 8, y, 7.5, "body");
        y += 8.4;
      }
    }
  }
  if (pr.gasGuzzlerTax !== undefined) {
    Tx(p, "Gas Guzzler Tax", PRICE_X, y, 8.5, "body");
    Tx(p, formatMoney(pr.gasGuzzlerTax), X1, y, 8.5, "body", { align: "right" });
    y += 10;
  }
  y += 8;
  const money = (n: number | null | undefined): string => (n === null || n === undefined ? "NOT AVAILABLE" : formatMoney(n));
  const base = pr.baseMsrp;
  const optionsTotal = pr.factoryInstalledTotal;
  const subtotal = base !== undefined && optionsTotal !== undefined ? base + optionsTotal : undefined;
  const total = totalMsrp(d);
  const lines: Array<[string, string, boolean]> = [
    ["MSRP*:", money(base), false],
    ["Total Additional Equipment:", money(optionsTotal), false],
    ["Subtotal:", money(subtotal), false],
    ["Destination/Handling:", money(pr.destinationCharge), false],
    ["Total MSRP*:", money(total), true],
  ];
  const need = lines.length * 14 + 56;
  if (y + need > limit) return null;
  R(p, PRICE_X, y - 3, PRICE_W, 1.2, INK);
  for (const [label, value, strong] of lines) {
    const size = strong ? 11 : 9;
    Tx(p, label, PRICE_X, y, size, strong ? "bold" : "body");
    const unavailable = value === "NOT AVAILABLE";
    Tx(p, value, X1, y + (unavailable ? 1 : 0), unavailable ? 7.5 : size, "bold", { align: "right" });
    y += strong ? 17 : 13;
  }
  Tx(p, "*MSRP (Manufacturer's Suggested Retail Price)", PRICE_X, y, 6.5, "body");
  y += 14;
  Tx(p, "WARRANTY COVERAGE", PRICE_X, y, 9, "bold");
  y += 12;
  const w = warrantySection(d, "Warranty");
  for (const item of w ? w.items : ["Not available for this vehicle."]) {
    for (const l of wrap(item, "body", 7.5, PRICE_W)) {
      if (y > limit) return null;
      Tx(p, l, PRICE_X, y, 7.5, "body");
      y += 8.6;
    }
  }
  return y;
}

// ── Footer ────────────────────────────────────────────────────────────

const FOOT_H = 96;

function paintFooter(p: Painter, d: FactoryStickerData, barcodePayload: string, passportUrl: string, top: number): void {
  R(p, X0, top, W, 1.2, INK);
  const y = top + 6;
  Tx(p, "VIN:", X0 + 4, y + 1, 8.5, "bold");
  Tx(p, d.vehicle.vin, X0 + 26, y, 13, "bold");
  if (barcodePayload) p.barcode(X0 + 4, y + 18, 250, 34, barcodePayload, INK);
  const assembly = d.factory.finalAssemblyPoint;
  if (assembly) Tx(p, `Plant/Port of Entry: ${assembly.toUpperCase()}`, X0 + 4, y + 58, 7.5, "body");
  if (d.factory.transportMethod) Tx(p, `Method of Transport: ${d.factory.transportMethod.toUpperCase()}`, X0 + 4, y + 68, 7.5, "body");

  Tx(p, "SHIP TO:", 300, y, 8, "bold");
  const code = d.factory.dealerCode;
  if (code) Tx(p, code.toUpperCase(), 300 + measureText("SHIP TO:", "bold", 8) + 4, y, 8, "bold");
  dealerLines(d).slice(0, 4).forEach((l, i) => Tx(p, l, 300, y + 11 + i * 9.4, 8, "body"));
  const note = "* Original manufacturer's suggested retail prices shown. Excludes taxes, title, license, dealer-installed items and current selling price.";
  wrap(note, "body", 6.5, 260).forEach((l, i) => Tx(p, l, 300, y + 56 + i * 7.6, 6.5, "body", { lh: 7.6 }));

  if (passportUrl) {
    const qx = X1 - PASSPORT_QR_PT - 2;
    p.qr(qx, y, PASSPORT_QR_PT, passportUrl, INK);
    Tx(p, "VEHICLE PASSPORT", qx - 8, y + 20, 8.5, "bold", { align: "right" });
    Tx(p, PASSPORT_QR_CAPTION, qx - 8, y + 33, 7.5, "body", { align: "right" });
  }
}

// ── Page ──────────────────────────────────────────────────────────────

interface PortraitResult {
  rest: number;
  printed: string[];
}

function paintPage(p: Painter, input: VariantRenderInput, d: FactoryStickerData, frameBottom: number, style: FlowStyle, extra: number): PortraitResult | null {
  R(p, X0 - 8, 40, W + 16, frameBottom - 40, null, 2.4);
  const headBottom = paintHeader(p, d, 50);
  const epaTop = Math.max(headBottom + 2, 152);
  paintEpa(p, d, epaTop);
  const panelTop = epaTop + EPA_H + 8;
  paintSafety(p, d, panelTop);
  paintParts(p, d, panelTop);

  const footTop = frameBottom - FOOT_H - 4;
  paintFooter(p, d, input.layout.barcodePayload, d.document.passportUrl.trim(), footTop);

  const eqTop = panelTop + PANEL_H + 12;
  const eqBottom = footTop - 6;
  const lower = paintPricing(p, d, eqTop, eqBottom);
  if (lower === null) return null;

  const head = "STANDARD EQUIPMENT";
  underlined(p, head, Q(X0 + 2), Q(eqTop), Q(10));
  const noteText = "(UNLESS REPLACED BY ADDITIONAL EQUIPMENT)";
  Tx(p, noteText, X0 + 2 + measureText(head, "bold", 10) + 6, eqTop + 2, 7, "body");
  const sections = buildSections(input);
  if (!sections.length) Tx(p, "Standard equipment not available for this vehicle.", X0 + 2, eqTop + 16, 8.5, "body");
  const entries = toEntries(sections, (s) => s, 5, undefined, input.equipmentNote);
  const n = 3 + extra;
  const gap = 12;
  const regionW = PRICE_X - 14 - X0;
  const colW = (regionW - gap * (n - 1)) / n;
  const colsFor = (bottom: number) =>
    Array.from({ length: n }, (_, i) => ({ x: Q(X0 + i * (colW + gap)), w: Q(colW), top: Q(eqTop + 16), bottom: Q(bottom) }));
  let bottom = eqTop + 16 + 40;
  while (bottom < eqBottom && flow(entries, colsFor(bottom), style).rest.length) bottom += 4;
  const { placed, rest } = flow(entries, colsFor(Math.min(bottom, eqBottom)), style);
  paintPlaced(p, placed, style, { bullet: "square" });
  const result = placedResult(entries, rest);
  return { rest: result.rest.length, printed: result.printed };
}

function assemblePortrait(input: VariantRenderInput): LayoutModel | null {
  const d = input.layout.data;
  const paragraphs = [...reproductionDisclosureLines(input.layout.factoryBuild), ...input.layout.disclaimers];
  const discLines = paragraphs.flatMap((para) => wrap(para, "body", 8, W));
  const discHeight = 14 + discLines.length * 10.2;
  const discTop = PORTRAIT_HEIGHT - 12 - discHeight;
  const frameBottom = discTop - 8;

  for (const style of styleLadder(EQ_STYLE)) {
    for (let extra = 0; extra <= MAX_EXTRA_COLUMNS; extra++) {
      const probe = paintPage(new Painter(null), input, d, frameBottom, style, extra);
      if (probe === null) return null;
      if (probe.rest) continue;
      const drawn: string[] = [];
      const p = new Painter(drawn);
      R(p, X0 - 8, 12, W + 16, 20, null, 1.6);
      Tx(p, REPRODUCTION_BANNER, X0, 16, 11.5, "bold");
      Tx(p, "PAGE 1 OF 1", X1, 18, 8, "bold", { align: "right" });
      paintPage(p, input, d, frameBottom, style, extra);
      Tx(p, REPRODUCTION_BANNER, X0 - 8, discTop, 11.5, "bold");
      discLines.forEach((l, i) => Tx(p, l, X0 - 8, discTop + 15 + i * 10.2, 8, "body", { lh: 10.2 }));
      const model: LayoutModel = {
        width: PORTRAIT_WIDTH,
        height: PORTRAIT_HEIGHT,
        mode: style === EQ_STYLE ? "STANDARD" : "DENSE",
        pages: [{ primitives: p.primitives }],
        drawnStrings: drawn,
        printedEquipment: probe.printed,
        fontFamilies: { heading: "Helvetica-Bold", body: "Helvetica", numeric: "Courier" },
        fit: fitOk(0, style.size * DISPLAY_PT),
      };
      validateModel(model);
      return model;
    }
  }
  return null;
}

export const buildMitsubishiOutlanderSportLayout: VariantLayoutBuilder = (input): LayoutModel | null => {
  const model = assemblePortrait(input);
  if (model && (model.width !== PORTRAIT_WIDTH || model.height !== PORTRAIT_HEIGHT)) return null;
  return model;
};
