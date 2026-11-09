// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/render/variants/catalogBlocks.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// Regulatory panels shared by the catalog layouts that follow the common OEM
// label block: the 700 x 453 px fuel-economy panel (annual fuel cost box and
// 1-10 scales under the mileage panel, Smartphone QR slot in the footer), the
// NHTSA safety panel and the parts-content box. Geometry is written in the
// reference's 100 dpi pixels relative to the panel origin and mapped through a
// Grid, so each template keeps its own horizontal scale and compresses
// verticals to clear the mandatory banner and disclosure.
//
// Nothing here carries a vehicle value: every number comes from render data,
// and each unavailable value prints an explicit state.

import type { FactoryStickerData } from "../../types.ts";
import { Painter, fuelCategoryLabel, formatMoney, measureText } from "../layout.ts";
import { PASSPORT_QR_CAPTION } from "../../reproduction.ts";
import { INK, PAPER, EPA_BLUE } from "./shared.ts";
import { PASSPORT_QR_PT, R, T, paintScale, scaleState, wrap } from "./hyundaiTucsonGas.ts";
import { fitSize } from "./fcaCommon.ts";
import { assemblyLabel, paintSafetyPanel, partsFacts } from "./tabloidCommon.ts";

export const PX = 0.72;

export interface Grid {
  x: (px: number) => number;
  y: (px: number) => number;
  /** Points per vertical pixel. */
  k: number;
}

export const makeGrid = (topPt: number, topPx: number, bottomPt: number, bottomPx: number): Grid => {
  const k = (bottomPt - topPt) / (bottomPx - topPx);
  return { x: (px) => px * PX, y: (px) => topPt + (px - topPx) * k, k };
};

export const Q = (pt: number): number => pt / 0.612;

const CAR_PATH = "M18.15 6.81L18.1 6.76C18.07 6.73 18.04 6.7 18.01 6.67L13.21 1.86C12.02 0.75 9.7 0 7.02 0C3.14 0 0 1.58 0 3.54V7.96C0 8.94 0.79 9.73 1.77 9.73C1.77 8.26 2.96 7.08 4.43 7.08C5.89 7.08 7.08 8.26 7.08 9.73H11.51C11.51 9.71 11.5 9.69 11.5 9.67C11.5 8.21 12.69 7.02 14.16 7.02C15.62 7.02 16.81 8.21 16.81 9.67C16.81 9.69 16.81 9.71 16.81 9.73C17.79 9.73 18.58 8.94 18.58 7.96C18.58 7.52 18.41 7.12 18.15 6.81ZM5.86 4.42L0.89 4.41V3.14C1.27 2.02 3.29 1.14 5.86 0.93V4.42ZM14.51 4.42H6.64V0.89C6.76 0.89 6.89 0.88 7.02 0.88C10.13 0.88 11.95 1.73 13.34 3.14L14.51 4.42ZM2.66 9.73C2.66 10.71 3.45 11.5 4.43 11.5C5.4 11.5 6.19 10.71 6.19 9.73C6.19 8.75 5.4 7.96 4.43 7.96C3.45 7.96 2.66 8.75 2.66 9.73ZM3.54 9.73C3.54 9.24 3.93 8.85 4.43 8.85C4.91 8.85 5.31 9.24 5.31 9.73C5.31 10.22 4.91 10.61 4.43 10.61C3.93 10.61 3.54 10.22 3.54 9.73ZM12.39 9.67C12.39 10.65 13.18 11.44 14.16 11.44C15.13 11.44 15.93 10.65 15.93 9.67C15.93 8.7 15.13 7.9 14.16 7.9C13.18 7.9 12.39 8.7 12.39 9.67ZM13.27 9.67C13.27 9.19 13.67 8.79 14.16 8.79C14.65 8.79 15.04 9.19 15.04 9.67C15.04 10.16 14.65 10.56 14.16 10.56C13.67 10.56 13.27 10.16 13.27 9.67Z";
const CAR_W = 18.58;
const CAR_H = 11.5;
const PUMP_BODY = "M1 0H14Q15 0 15 1V26.5H0V1Q0 0 1 0ZM2.2 2V9.6H12.8V2Z";
const PUMP_HOSE = "M15 4.5L18.5 7.5C20.5 9.5 20.7 12 20.7 15V21.5C20.7 24 19.7 25.5 18.5 25.5C17.3 25.5 16.5 24 16.5 21.5V14";
const PUMP_W = 21.5;
const PUMP_H = 26.5;

const scalePath = (d: string, s: number): string => d.replace(/-?\d*\.?\d+/g, (n) => String(Math.round(Number(n) * s * 1000) / 1000));

/** Fuel pump glyph with its top-left at (x, y); `h` is its printed height in points. */
export function paintFuelPump(p: Painter, x: number, y: number, h: number): void {
  const s = h / PUMP_H;
  p.path(scalePath(PUMP_BODY, s), x, y, 15 * s, h, INK);
  p.path(scalePath(PUMP_HOSE, s), x, y, PUMP_W * s, h, null, INK, Math.max(0.7, 1.3 * s));
}

/** Driving-range bar: ink bar from the panel edge with a car at its end; no value prints a white frame and "Not Available". */
function paintRangeBar(p: Painter, label: string, miles: number | undefined, x0: number, x1: number, top: number, h: number): void {
  const size = Math.max(5.8, Math.min(6.4, h * 0.62));
  const textTop = top + (h - size) / 2 - 0.4;
  if (miles === undefined) {
    R(p, x0, top, x1 - x0, h, PAPER, 1);
    T(p, `${label}: Not Available`, x0 + 38, textTop, size, "bold");
  } else {
    R(p, x0, top, x1 - x0, h, INK);
    T(p, `${label}: ${Math.round(miles)} miles`, x0 + 38, textTop, size, "bold", { color: PAPER });
  }
  const s = Math.min(1, (h * 1.25) / CAR_H);
  p.path(scalePath(CAR_PATH, s), x1, top + h / 2 - (CAR_H * s) / 2, CAR_W * s, CAR_H * s, INK);
}

export const EPA_PANEL_W = 700;
export const EPA_PANEL_H = 453;

const RANGE_BAR_END = 366.7;

const GAL = (r: FactoryStickerData["regulatory"]): number | undefined =>
  r.gallonsPer100Miles ?? (r.combinedMpg !== undefined && r.combinedMpg > 0 ? 100 / r.combinedMpg : undefined);

/** Fuel economy and environment panel; (ox, oy) is its top-left corner in reference pixels. */
export function paintCatalogEpa(p: Painter, d: FactoryStickerData, g: Grid, ox: number, oy: number, opts: { flexFuel?: boolean; scale?: number } = {}): void {
  const grow = (size: number): number => (opts.scale ? Math.max(1, 5.5 / (size * opts.scale)) : 1);
  const flex = opts.flexFuel === true && d.regulatory.flexFuel === true;
  const r = d.regulatory;
  const X = (lx: number): number => g.x(ox + lx);
  const Yy = (ly: number): number => g.y(oy + ly);
  const W = (px: number): number => px * PX;
  const verified = r.epaStatus === "VERIFIED";
  const mpgOk = verified && r.combinedMpg !== undefined;

  R(p, X(0), Yy(0), W(EPA_PANEL_W), Yy(EPA_PANEL_H) - Yy(0), INK);
  T(p, "EPA", X(6), Yy(6), 9.5, "bold", { color: PAPER, lh: 10 });
  T(p, "DOT", X(6), Yy(6) + 10.2, 9.5, "bold", { color: PAPER, lh: 10 });
  T(p, "Fuel Economy and Environment", X(58), Yy(14), 16, "bold", { color: PAPER });
  if (flex) {
    R(p, X(469), Yy(5), W(225), Yy(43) - Yy(5), EPA_BLUE);
    T(p, "E85", X(482), Yy(6), 9, "bold");
    paintFuelPump(p, X(483), Yy(20), Math.min(14.7, (Yy(41) - Yy(20)) * 0.95));
    T(p, "Flexible-Fuel Vehicle", X(690), Yy(10), 9.5, "bold", { align: "right" });
    T(p, "Gasoline-Ethanol (E85)", X(690), Yy(10) + 11, 9.5, "bold", { align: "right" });
  } else if (d.vehicle.fuelType) {
    R(p, X(483), Yy(5), W(212), Yy(43) - Yy(5), EPA_BLUE);
    T(p, fuelCategoryLabel(d.vehicle.fuelType), X(690), Yy(18), 10.5, "bold", { align: "right" });
  }

  const panelTop = Yy(48);
  R(p, X(5), panelTop, W(690), Yy(229) - panelTop, PAPER);
  T(p, "Fuel Economy", X(57), Yy(54), 11, "bold");
  if (!mpgOk) {
    wrap("Fuel economy and environment information is not available from verified EPA records for this exact configuration.", "bold", 12, W(410) / grow(12))
      .forEach((l, i) => T(p, l, X(57), Yy(84) + i * 15, 12, "bold", { lh: 15 }));
  } else {
    p.text(String(Math.round(r.combinedMpg!)), X(53), Yy(158), 58, "bold", INK);
    T(p, "MPG", X(188), Yy(80), 18, "bold");
    T(p, "combined city/hwy", X(57), Yy(163), 8, "body");
    if (r.cityMpg !== undefined) {
      T(p, String(Math.round(r.cityMpg)), X(188), Yy(122), 20, "bold");
      T(p, "city", X(188), Yy(150), 8, "body");
    }
    if (r.highwayMpg !== undefined) {
      T(p, String(Math.round(r.highwayMpg)), X(250), Yy(122), 20, "bold");
      T(p, "highway", X(250), Yy(150), 8, "body");
    }
    if (r.epaClassNote) {
      const noteX = flex ? 300 : 268;
      const noteW = flex ? 180 : 215;
      const noteSize = flex ? 6.6 : 7.5;
      const noteLh = flex ? 6.9 : 8.2;
      wrap(r.epaClassNote, "body", noteSize, W(noteW) / grow(noteSize)).slice(0, flex ? 5 : 4).forEach((l, i) => T(p, l, X(noteX), Yy(flex ? 56 : 80) + i * noteLh, noteSize, "body", { lh: noteLh }));
    }
    const gallons = GAL(r);
    if (gallons !== undefined && flex) {
      T(p, gallons.toFixed(1), X(322), Yy(122), 20, "bold");
      T(p, "gallons per 100 miles", X(322), Yy(150), 8, "body");
    } else if (gallons !== undefined) {
      const gs = gallons.toFixed(1);
      T(p, gs, X(57), Yy(180), 20, "bold");
      T(p, "gallons per 100 miles", X(57) + measureText(gs, "bold", 20) + 4, Yy(190), 8, "body");
    }
  }
  if (flex) {
    const known = [r.gasolineRangeMiles, r.e85RangeMiles].filter((m): m is number => m !== undefined && m > 0);
    const longest = Math.max(...known, 0);
    const reach = (m: number | undefined): number => (m !== undefined && m > 0 && longest > 0 ? Math.max(150, (RANGE_BAR_END * m) / longest) : RANGE_BAR_END);
    const barH = (Yy(214.2 + 12.5) - Yy(214.2));
    T(p, "Driving Range", X(57), Yy(189), 7, "bold");
    ([["Gasoline", r.gasolineRangeMiles, 199], ["Ethanol (E85)", r.e85RangeMiles, 214.2]] as const).forEach(([label, miles, top]) => {
      const m = miles !== undefined && miles > 0 ? miles : undefined;
      paintRangeBar(p, label, m, X(0), X(reach(m)), Yy(top), barH);
    });
    if (mpgOk) paintFuelPump(p, X(7), Yy(92), Math.min(26.5, (Yy(129) - Yy(92))));
  }
  const delta = verified ? r.fiveYearCostDifference : undefined;
  if (delta !== undefined && delta !== 0) {
    T(p, delta > 0 ? "You save" : "You spend", X(483), Yy(52), 19, "bold");
    T(p, formatMoney(Math.abs(delta)).replace(/\.00$/, ""), X(483), Yy(90), 30, "bold");
    (delta > 0 ? ["in fuel costs", "over 5 years"] : ["more in fuel costs", "over 5 years"])
      .forEach((l, i) => T(p, l, X(503), Yy(142) + i * 13, 11.5, "bold", { lh: 13 }));
    ["compared to the", "average new vehicle."].forEach((l, i) => T(p, l, X(503), Yy(184) + i * 10, 9, "body", { lh: 10 }));
  } else {
    T(p, "5-year fuel cost comparison", X(483), Yy(96), 9, "bold");
    T(p, "Not Available", X(483), Yy(96) + 12, 11, "bold");
  }

  R(p, X(5), Yy(233), W(200), Yy(340) - Yy(233), PAPER);
  T(p, "Annual fuel", X(14), Yy(244), 13, "bold");
  T(p, "cost", X(14) + measureText("Annual fuel", "bold", 13) + 4, Yy(238), 19, "bold");
  if (verified && r.annualFuelCost !== undefined) T(p, formatMoney(r.annualFuelCost).replace(/\.00$/, ""), X(22), Yy(284), 32, "bold");
  else T(p, "Not Available", X(22), Yy(292), 11, "bold");

  R(p, X(210), Yy(233), W(485), Yy(340) - Yy(233), PAPER);
  const ghgHead = "Fuel Economy & Greenhouse Gas Rating";
  T(p, ghgHead, X(218), Yy(240), 9, "bold");
  T(p, "(tailpipe only)", X(218) + measureText(ghgHead, "bold", 9) + 3, Yy(240) + 1.6, 6.5, "body");
  paintScale(p, X(216), Yy(284), W(292), scaleState(verified ? r.greenhouseGasRating : undefined), 14);
  const smogX = opts.scale ? 538 : 547;
  T(p, "Smog Rating", X(smogX), Yy(240), 9, "bold");
  T(p, "(tailpipe only)", X(smogX) + measureText("Smog Rating", "bold", 9) + 3, Yy(240) + 1.6, 6.5, "body");
  paintScale(p, X(smogX + 2), Yy(284), W(opts.scale ? 151 : 140), scaleState(verified ? r.smogRating : undefined), 14);
  if (verified && r.co2TailpipeGpm !== undefined) {
    const line = `This vehicle emits ${Math.round(r.co2TailpipeGpm)} grams CO2 per mile (tailpipe only). The best emits 0 grams per mile (tailpipe only). Producing and distributing fuel also create emissions; learn more at fueleconomy.gov.`;
    wrap(line, "body", 6.4, W(470) / grow(6.4)).slice(0, opts.scale ? 3 : 2).forEach((l, i) => T(p, l, X(216), Yy(opts.scale ? 311 : 318) + i * 7 * grow(6.4), 6.4, "body", { lh: 7 }));
  }

  const footTop = Yy(345);
  const footBottom = Yy(EPA_PANEL_H);
  const note = "Actual results will vary for many reasons, including driving conditions and how you drive and maintain your vehicle. Cost estimates are current EPA estimates and may differ from those printed on the original label.";
  wrap(note, "bold", 6.8, W(540) / grow(6.8)).forEach((l, i) => T(p, l, X(12), footTop + 3 + i * 7.8 * grow(6.8), 6.8, "bold", { color: PAPER, lh: 7.8 }));
  T(p, "fueleconomy.gov", X(12), footBottom - 36, 20, "bold", { color: PAPER });
  T(p, "Calculate personalized estimates and compare vehicles", X(12), footBottom - 12, 7.5, "bold", { color: PAPER });
  const url = d.document.passportUrl.trim();
  if (url) {
    const qx = X(EPA_PANEL_W) - 4 - PASSPORT_QR_PT;
    const qy = footBottom - 3 - PASSPORT_QR_PT;
    R(p, qx, qy, PASSPORT_QR_PT, PASSPORT_QR_PT, PAPER);
    p.qr(qx, qy, PASSPORT_QR_PT, url, INK);
    T(p, "VEHICLE PASSPORT", qx - 6, qy + 22, 8.5, "bold", { align: "right", color: PAPER });
    T(p, PASSPORT_QR_CAPTION, qx - 6, qy + 34, 7.5, "body", { align: "right", color: PAPER });
  }
}

/** NHTSA panel (points); a not-rated or unavailable record prints the explicit message panel. */
export function isNhtsaRated(d: FactoryStickerData): boolean {
  const r = d.regulatory;
  const ratings = [r.overallRating, r.frontalDriverRating, r.frontalPassengerRating, r.sideFrontRating, r.sideRearRating, r.rolloverRating, r.frontalRating, r.sideRating];
  return r.nhtsaStatus === "VERIFIED" && ratings.some((n) => n !== undefined && n > 0);
}

export function paintCatalogSafety(p: Painter, d: FactoryStickerData, x: number, y: number, w: number, h: number, opts: { footSize?: number } = {}): void {
  const r = d.regulatory;
  if (isNhtsaRated(d)) {
    const footerH = 60;
    const headerH = 30;
    const body = Q(h) - headerH - footerH;
    paintSafetyPanel(p, d, Q(x), Q(y), Q(w), Q(h), {
      headerH, footerH, subFrac: 0.29, valFrac: 0.57,
      titleSize: opts.footSize !== undefined ? 16.6 : 19, labelSize: 14.5, noteSize: 10.2, footSize: opts.footSize ?? 11.6, stretch: Math.min(1.04, body / 244),
    });
    return;
  }
  const message = r.nhtsaStatus === "UNAVAILABLE"
    ? "Government 5-star safety ratings are not available from a verified NHTSA record for this vehicle."
    : "This vehicle has not been rated by the government for overall vehicle score, frontal crash, side crash, or rollover risk.";
  const headerH = 22;
  const footH = 32;
  const msgH = Math.min(52, h - headerH - footH);
  R(p, x, y, w, headerH + msgH + footH, INK);
  T(p, "GOVERNMENT 5-STAR SAFETY RATINGS", x + w / 2, y + 5.5, opts.footSize !== undefined ? fitSize("GOVERNMENT 5-STAR SAFETY RATINGS", "bold", 12.4, w - 8, 8) : 12.4, "bold", { align: "center", color: PAPER });
  R(p, x + 4, y + headerH, w - 8, msgH, PAPER);
  wrap(message, "body", 10.5, w - 24).forEach((l, i) => T(p, l, x + 10, y + headerH + 5 + i * 12.4, 10.5, "body", { lh: 12.4 }));
  const foot = y + headerH + msgH;
  const sourceLine = "Source: National Highway Traffic Safety Administration (NHTSA)";
  const footPt = opts.footSize !== undefined ? fitSize(sourceLine, "bold", 8.4, w - 6, 5.8) : 8.4;
  T(p, sourceLine, x + w / 2, foot + 5, footPt, "bold", { align: "center", color: PAPER });
  T(p, "www.nhtsa.gov/ratings", x + w / 2, foot + 17, footPt, "bold", { align: "center", color: PAPER });
}

/** Parts-content box (points). `columns: 2` prints the carline group left and the vehicle group right. */
export function paintCatalogParts(p: Painter, d: FactoryStickerData, x: number, y: number, w: number, h: number, columns: 1 | 2 = 1): void {
  R(p, x, y, w, h, null, 2.4);
  const f = partsFacts(d);
  const hasCarline = !!f.usCan || f.other.length > 0;
  const hasVehicle = !!f.assembly || !!f.engine || !!f.trans;
  T(p, "PARTS CONTENT INFORMATION", x + w / 2, y + 5, fitSize("PARTS CONTENT INFORMATION", "bold", 10.4, w - 8, 7), "bold", { align: "center" });
  if (!hasCarline && !hasVehicle) {
    T(p, "Not available for this vehicle.", x + w / 2, y + 26, 10, "body", { align: "center" });
    return;
  }
  const limit = y + h - 4;
  const colW = columns === 2 ? (w - 21) / 2 : w - 14;
  let cy = y + 20;
  let cx = x + 7;
  let endY = cy;
  const run = (draw: boolean, size: number): void => {
    const step = size * 1.1;
    cy = y + 20;
    cx = x + 7;
    const line = (s: string): void => {
      for (const l of wrap(s.toUpperCase(), "bold", size, colW)) {
        if (draw) T(p, l, cx, cy, size, "bold");
        cy += step;
      }
    };
    if (hasCarline) {
      line("FOR VEHICLES IN THIS CARLINE:");
      if (f.usCan) line(`U.S./CANADIAN PARTS CONTENT: ${f.usCan.value}`);
      if (f.other.length) line("MAJOR SOURCES OF FOREIGN PARTS CONTENT:");
      for (const e of f.other) line(/foreign/i.test(e.label) ? e.value : `${e.label}: ${e.value}`);
      for (const l of wrap("Note: parts content does not include final assembly, distribution, or other non-parts costs.", "body", size - 1, colW)) {
        if (draw) T(p, l, cx, cy, size - 1, "body");
        cy += (size - 1) * 1.1;
      }
      cy += 2;
    }
    endY = Math.max(endY, cy);
    if (hasVehicle) {
      if (columns === 2) {
        endY = Math.max(endY, cy);
        cx = x + 14 + colW;
        cy = y + 20;
      }
      line("FOR THIS VEHICLE:");
      if (f.assembly) line(`${assemblyLabel(d)}: ${f.assembly}`);
      if (f.engine || f.trans) {
        line("COUNTRY OF ORIGIN:");
        if (f.engine) line(`ENGINE: ${f.engine.value}`);
        if (f.trans) line(`TRANSMISSION: ${f.trans.value}`);
      }
    }
    endY = Math.max(endY, cy);
  };
  let size = 10;
  endY = 0;
  run(false, size);
  while (endY > limit && size > 6) {
    size -= 0.5;
    endY = 0;
    run(false, size);
  }
  if (endY <= limit) run(true, size);
}

export interface PriceLine {
  label: string;
  amount: string | null;
  features: string[];
}

/**
 * Draws option rows; returns the y after them, or null when they cannot fit above `limit`. Feature lines are
 * dropped first, then the type steps down to 6pt, before giving up.
 */
export function paintPriceLines(
  p: Painter, rows: PriceLine[], x: number, right: number, y: number, limit: number,
  o: { size?: number; labelW?: number; step?: number } = {},
): number | null {
  const base = o.size ?? 8.5;
  for (let size = base; size >= 6; size -= 0.8) {
    const labelW = o.labelW ?? right - x - 52;
    const step = o.step ?? size + 0.8;
    for (const withFeatures of [true, false]) {
      const draw = (live: boolean): number => {
        let cy = y;
        for (const row of rows) {
          const top = cy;
          for (const l of wrap(row.label, "body", size, labelW)) {
            if (live) T(p, l, x, cy, size, "body");
            cy += step;
          }
          if (live && row.amount) T(p, row.amount, right, top, size, "body", { align: "right" });
          if (withFeatures) {
            for (const f of row.features) {
              for (const l of wrap(f, "body", size - 1, labelW - 6)) {
                if (live) T(p, l, x + 6, cy, size - 1, "body");
                cy += step - 0.8;
              }
            }
          }
        }
        return cy;
      };
      if (draw(false) <= limit) return draw(true);
    }
  }
  return null;
}

export const optionsTotalOf = (d: FactoryStickerData): number | undefined => {
  const pr = d.pricing;
  if (pr.factoryInstalledTotal !== undefined) return pr.factoryInstalledTotal;
  if (pr.optionsTotal !== undefined || pr.packagesTotal !== undefined) return (pr.optionsTotal ?? 0) + (pr.packagesTotal ?? 0);
  return undefined;
};

export const money = (n: number | undefined): string => (n !== undefined ? formatMoney(n) : "NOT AVAILABLE");

export const msrpWithOptions = (d: FactoryStickerData): number | undefined => {
  const base = d.pricing.baseMsrp;
  if (base === undefined) return undefined;
  const opts = optionsTotalOf(d);
  if (opts !== undefined) return base + opts;
  return d.equipment.packages.length + d.equipment.options.length === 0 ? base : undefined;
};

/** Four solid bands forming a frame (points). */
export function paintBands(p: Painter, x0: number, y0: number, x1: number, y1: number, t: number, color: string): void {
  R(p, x0, y0, x1 - x0, t, color);
  R(p, x0, y1 - t, x1 - x0, t, color);
  R(p, x0, y0 + t, t, y1 - y0 - 2 * t, color);
  R(p, x1 - t, y0 + t, t, y1 - y0 - 2 * t, color);
}

export const PRICE_FOOTNOTE = "Original manufacturer's suggested retail prices shown. Excludes taxes, title, license, dealer-installed items and current selling price.";

export function paintWarranty(
  p: Painter, d: FactoryStickerData, items: string[] | null, x: number, y: number, width: number, heading = "WARRANTY",
): number {
  T(p, heading, x, y, 9, "bold");
  let cy = y + 12;
  for (const item of items ?? ["Not available for this vehicle."]) {
    for (const l of wrap(item, "body", 8, width)) {
      T(p, l, x, cy, 8, "body");
      cy += 9;
    }
  }
  return cy;
}
