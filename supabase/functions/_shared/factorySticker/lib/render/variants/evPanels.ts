// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/render/variants/evPanels.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// Electric-vehicle and plug-in-hybrid fuel-economy panel shared by the catalog
// templates 14-18 (Fiat 500e, Rolls-Royce Spectre, Bentley Continental GT,
// Lamborghini Urus). Geometry is written in the 700 x 453 px panel of the
// references (100 dpi) and mapped through a Grid; the horizontal scale can be
// stretched to the panel's own width.
//
// Semantics ported from the handoff (refinement_pass4 range-specs.json,
// gauge-specs.json, indicator-model.cjs):
//   * EPA 1-10 scores move the pointer with the score; anything else, or an
//     absent score, prints Not Available. EPA numbers are never converted.
//   * a range chart is drawn only from the record's range figures. Printed
//     axis breaks are not a continuous scale, so no intermediate tick value
//     is invented: the chart carries 0 and the figures the record holds.
//   * an electric vehicle's saved range is its total range; a plug-in
//     hybrid's saved range is its all-electric range, and its total range is
//     printed only when the record carries one.
//   * MPGe, kWh per 100 miles, charge time and gas-mode figures print only
//     when the verified EPA record carries them; each absent figure prints
//     Not Available, never a zero and never a sample value.

import type { FactoryStickerData } from "../../types.ts";
import { Painter, formatMoney, measureText } from "../layout.ts";
import { PASSPORT_QR_CAPTION } from "../../reproduction.ts";
import { INK, PAPER, EPA_BLUE } from "./shared.ts";
import { PASSPORT_QR_PT, R, T, paintScale, scaleState, wrap } from "./hyundaiTucsonGas.ts";
import { EPA_PANEL_H, EPA_PANEL_W, PX, type Grid } from "./catalogBlocks.ts";

export type EvMode = "ev" | "phev";

export interface EvRangeFacts {
  /** Electric vehicles: the total range. Plug-in hybrids: the all-electric range. */
  electric?: number;
  /** Plug-in hybrids only: total range with gasoline. */
  total?: number;
  chargeHours?: number;
}

const positive = (n: number | undefined): number | undefined => (n !== undefined && Number.isFinite(n) && n > 0 ? n : undefined);

export function evRangeFacts(r: FactoryStickerData["regulatory"], mode: EvMode): EvRangeFacts {
  const electric = positive(mode === "ev" ? r.totalRangeMiles ?? r.evRangeMiles : r.electricRangeMiles ?? r.evRangeMiles);
  const total = mode === "phev" ? positive(r.totalRangeMiles) : undefined;
  const chargeHours = positive(r.chargeTimeHours);
  return {
    ...(electric !== undefined ? { electric } : {}),
    ...(total !== undefined && electric !== undefined && total > electric ? { total } : {}),
    ...(chargeHours !== undefined ? { chargeHours } : {}),
  };
}

const miles = (n: number): string => String(Math.round(n));
const hours = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function plug(p: Painter, x: number, y: number, s: number): void {
  R(p, x + s * 0.3, y + s * 0.35, s * 0.55, s * 0.5, INK);
  R(p, x + s * 0.42, y, s * 0.08, s * 0.38, INK);
  R(p, x + s * 0.66, y, s * 0.08, s * 0.38, INK);
  R(p, x + s * 0.5, y + s * 0.85, s * 0.08, s * 0.15, INK);
}

function pumpGlyph(p: Painter, x: number, y: number, s: number): void {
  R(p, x, y, s * 0.6, s, INK);
  R(p, x + s * 0.08, y + s * 0.12, s * 0.44, s * 0.28, PAPER);
  R(p, x + s * 0.7, y + s * 0.2, s * 0.1, s * 0.6, INK);
}

/** Driving-range chart; (x, y, w) in points. Draws only what the record holds. */
export function paintRangeChart(p: Painter, x: number, y: number, w: number, r: EvRangeFacts, mode: EvMode, scale = 1): void {
  const s = (n: number): number => n * scale;
  T(p, "Driving Range", x, y, s(10), "bold");
  const barY = y + s(14);
  const barH = s(12);
  const trackW = w - s(78);
  const stateY = barY + barH + s(3);
  if (r.electric === undefined) {
    R(p, x, barY, trackW, barH, PAPER, 1);
    T(p, "Range Not Available", x + trackW / 2, barY + s(1.6), s(8.4), "bold", { align: "center" });
  } else if (mode === "ev") {
    R(p, x, barY, trackW, barH, INK);
    T(p, "Vehicle Range", x + s(4), barY + s(1.8), s(8), "bold", { color: PAPER });
    T(p, "0", x, stateY, s(7), "body");
    T(p, miles(r.electric), x + trackW + s(8), barY - s(3), s(17), "bold");
    T(p, "miles", x + trackW + s(8), barY + s(14), s(8), "body");
  } else if (r.total !== undefined) {
    const electricW = trackW * (r.electric / r.total);
    R(p, x, barY, trackW, barH, PAPER, 1);
    R(p, x, barY, electricW, barH, INK);
    R(p, x + electricW, barY, trackW - electricW, barH, "#8f8f8f");
    T(p, "Electric + Gasoline", x + s(3), barY + s(1.8), s(7), "bold", { color: PAPER });
    T(p, "Gasoline only", x + electricW + s(4), barY + s(1.8), s(7), "bold", { color: PAPER });
    T(p, "0", x, stateY, s(7), "body");
    T(p, miles(r.electric), x + electricW, stateY, s(7), "bold", { align: "center" });
    T(p, miles(r.total), x + trackW + s(8), barY - s(3), s(17), "bold");
    T(p, "miles", x + trackW + s(8), barY + s(14), s(8), "body");
  } else {
    R(p, x, barY, trackW, barH, INK);
    T(p, "Electric", x + s(4), barY + s(1.8), s(8), "bold", { color: PAPER });
    T(p, "0", x, stateY, s(7), "body");
    T(p, miles(r.electric), x + trackW + s(8), barY - s(3), s(17), "bold");
    T(p, "miles", x + trackW + s(8), barY + s(14), s(8), "body");
    T(p, "Total range: Not Available", x + trackW, stateY, s(7), "bold", { align: "right" });
  }
  const charge = mode === "ev" || r.electric !== undefined ? (r.chargeHours !== undefined ? `Charge Time: ${hours(r.chargeHours)} hours (240V)` : "Charge Time: Not Available") : "";
  if (charge) T(p, charge, x, stateY + s(10), s(8), "bold");
  if (mode === "phev" && r.electric !== undefined) T(p, `All electric range = 0 to ${miles(r.electric)} miles`, x + w - s(2), stateY + s(10), s(7), "body", { align: "right" });
}

export interface EvEpaOptions {
  mode: EvMode;
  /** Panel width in reference pixels; defaults to the 700 px reference panel. */
  widthPx?: number;
  /** Print the Vehicle Passport QR in the footer (the FCA layouts place it elsewhere). */
  qr?: boolean;
}

/** (ox, oy) is the panel's top-left corner in reference pixels. */
export function paintEvEpa(p: Painter, d: FactoryStickerData, g: Grid, ox: number, oy: number, o: EvEpaOptions): void {
  const r = d.regulatory;
  const f = (o.widthPx ?? EPA_PANEL_W) / EPA_PANEL_W;
  const X = (lx: number): number => g.x(ox + lx * f);
  const Yy = (ly: number): number => g.y(oy + ly);
  const W = (px: number): number => px * f * PX;
  const verified = r.epaStatus === "VERIFIED";
  const mode = o.mode;
  const range = evRangeFacts(r, mode);
  const left = X(0);

  R(p, left, Yy(0), W(EPA_PANEL_W), Yy(EPA_PANEL_H) - Yy(0), INK);
  T(p, "EPA", X(6), Yy(6), 9.5, "bold", { color: PAPER, lh: 10 });
  T(p, "DOT", X(6), Yy(6) + 10.2, 9.5, "bold", { color: PAPER, lh: 10 });
  T(p, "Fuel Economy and Environment", X(58), Yy(14), 16, "bold", { color: PAPER });
  if (d.vehicle.fuelType) {
    R(p, X(483), Yy(5), W(212), Yy(43) - Yy(5), EPA_BLUE);
    if (mode === "ev") T(p, "Electric Vehicle", X(690), Yy(18), 10.5, "bold", { align: "right" });
    else {
      T(p, "Plug-In Hybrid Vehicle", X(690), Yy(8), 8.6, "bold", { align: "right" });
      T(p, "Electricity-Gasoline", X(690), Yy(24), 8.6, "bold", { align: "right" });
    }
  }

  R(p, X(5), Yy(48), W(690), Yy(229) - Yy(48), PAPER);
  T(p, "Fuel Economy", X(12), Yy(52), 10, "bold");
  const unavailable = (x: number, y: number, size = 10): void => T(p, "Not Available", x, y, size, "bold");

  if (mode === "ev") {
    const mpge = verified ? r.combinedMpg : undefined;
    if (mpge !== undefined) p.text(String(Math.round(mpge)), X(12), Yy(128), 52, "bold", INK);
    else unavailable(X(14), Yy(92), 12);
    T(p, "MPGe", X(mpge !== undefined ? 150 : 14), Yy(mpge !== undefined ? 80 : 112), 16, "bold");
    T(p, "combined city/hwy", X(12), Yy(134), 8, "body");
    const city = verified ? r.cityMpg : undefined;
    const hwy = verified ? r.highwayMpg : undefined;
    T(p, city !== undefined ? String(Math.round(city)) : "N/A", X(150), Yy(100), 18, "bold");
    T(p, "city", X(150), Yy(124), 8, "body");
    T(p, hwy !== undefined ? String(Math.round(hwy)) : "N/A", X(205), Yy(100), 18, "bold");
    T(p, "highway", X(205), Yy(124), 8, "body");
    const kwh = verified ? r.kwhPer100Miles : undefined;
    T(p, kwh !== undefined ? kwh.toFixed(1) : "N/A", X(262), Yy(100), 18, "bold");
    T(p, "kW-hrs per 100 miles", X(262), Yy(124), 8, "body");
    paintRangeChart(p, X(12), Yy(146), W(440), range, mode, 0.86);
  } else {
    const box = (title: string, x: number, rows: () => void): void => {
      R(p, X(x), Yy(66), W(222), Yy(150) - Yy(66), PAPER, 1.4);
      T(p, title, X(x + 6), Yy(68), 9, "bold");
      rows();
    };
    box("Electricity + Gasoline", 10, () => {
      const mpge = verified ? r.combinedMpge : undefined;
      plug(p, X(14), Yy(96), 14);
      if (mpge !== undefined) p.text(String(Math.round(mpge)), X(30), Yy(124), 40, "bold", INK);
      else unavailable(X(34), Yy(100), 10);
      T(p, "MPGe", X(mpge !== undefined ? 122 : 34), Yy(mpge !== undefined ? 84 : 114), 11, "bold");
      const kwh = verified ? r.kwhPer100Miles : undefined;
      T(p, kwh !== undefined ? kwh.toFixed(1) : "N/A", X(124), Yy(104), 12, "bold");
      T(p, "kW-hrs per 100 mi", X(124), Yy(120), 6.6, "body");
      T(p, "combined city/highway", X(14), Yy(132), 6.6, "body");
    });
    box("Gasoline Only", 240, () => {
      const mpg = verified ? r.gasolineCombinedMpg ?? r.combinedMpg : undefined;
      pumpGlyph(p, X(244), Yy(92), 14);
      if (mpg !== undefined) p.text(String(Math.round(mpg)), X(264), Yy(124), 40, "bold", INK);
      else unavailable(X(264), Yy(100), 10);
      T(p, "MPG", X(mpg !== undefined ? 352 : 264), Yy(mpg !== undefined ? 84 : 114), 11, "bold");
      if (mpg !== undefined) {
        T(p, (100 / mpg).toFixed(1), X(354), Yy(104), 12, "bold");
        T(p, "gallons per 100 mi", X(354), Yy(120), 6.6, "body");
      }
      T(p, "combined city/highway", X(244), Yy(132), 6.6, "body");
    });
    paintRangeChart(p, X(10), Yy(152), W(450), range, mode, 0.78);
  }

  const delta = verified ? r.fiveYearCostDifference : undefined;
  if (delta !== undefined && delta !== 0) {
    T(p, delta > 0 ? "You save" : "You spend", X(483), Yy(52), 18, "bold");
    T(p, formatMoney(Math.abs(delta)).replace(/\.00$/, ""), X(483), Yy(86), 28, "bold");
    (delta > 0 ? ["in fuel costs", "over 5 years"] : ["more in fuel costs", "over 5 years"])
      .forEach((l, i) => T(p, l, X(503), Yy(132) + i * 13, 11, "bold", { lh: 13 }));
    ["compared to the", "average new vehicle."].forEach((l, i) => T(p, l, X(503), Yy(176) + i * 10, 9, "body", { lh: 10 }));
  } else {
    T(p, "5-year fuel cost comparison", X(483), Yy(96), 9, "bold");
    unavailable(X(483), Yy(96) + 12, 11);
  }

  R(p, X(5), Yy(233), W(200), Yy(340) - Yy(233), PAPER);
  T(p, "Annual fuel", X(14), Yy(244), 13, "bold");
  T(p, "cost", X(14) + measureText("Annual fuel", "bold", 13) + 4, Yy(238), 19, "bold");
  if (verified && r.annualFuelCost !== undefined) T(p, formatMoney(r.annualFuelCost).replace(/\.00$/, ""), X(22), Yy(284), 32, "bold");
  else unavailable(X(22), Yy(292), 11);

  R(p, X(210), Yy(233), W(485), Yy(340) - Yy(233), PAPER);
  const ghgHead = "Fuel Economy & Greenhouse Gas Rating";
  T(p, ghgHead, X(218), Yy(240), 9, "bold");
  T(p, "(tailpipe only)", X(218) + measureText(ghgHead, "bold", 9) + 3, Yy(240) + 1.6, 6.5, "body");
  paintScale(p, X(216), Yy(284), W(292), scaleState(verified ? r.greenhouseGasRating : undefined), 14);
  T(p, "Smog Rating", X(547), Yy(240), 9, "bold");
  T(p, "(tailpipe only)", X(547) + measureText("Smog Rating", "bold", 9) + 3, Yy(240) + 1.6, 6.5, "body");
  paintScale(p, X(549), Yy(284), W(140), scaleState(verified ? r.smogRating : undefined), 14);
  const co2 = verified && r.co2TailpipeGpm !== undefined ? `This vehicle emits ${Math.round(r.co2TailpipeGpm)} grams CO2 per mile (tailpipe only). ` : "";
  wrap(`${co2}The best emits 0 grams per mile (tailpipe only). Producing and distributing fuel or electricity also create emissions; learn more at fueleconomy.gov.`, "body", 6.4, W(470))
    .slice(0, 2).forEach((l, i) => T(p, l, X(216), Yy(318) + i * 7, 6.4, "body", { lh: 7 }));

  const footTop = Yy(345);
  const footBottom = Yy(EPA_PANEL_H);
  const note = `Actual results will vary for many reasons, including driving conditions and how you drive and maintain your vehicle. Cost estimates are current EPA estimates and may differ from those printed on the original label.${mode === "phev" ? " This is a dual fueled automobile." : ""} MPGe is miles per gasoline gallon equivalent. Vehicle emissions are a significant cause of climate change and smog.`;
  wrap(note, "bold", 6.4, W(540)).slice(0, 5).forEach((l, i) => T(p, l, X(12), footTop + 3 + i * 7.4, 6.4, "bold", { color: PAPER, lh: 7.4 }));
  T(p, "fueleconomy.gov", X(12), footBottom - 34, 19, "bold", { color: PAPER });
  T(p, "Calculate personalized estimates and compare vehicles", X(12), footBottom - 12, 7.5, "bold", { color: PAPER });
  const url = d.document.passportUrl.trim();
  if (url && o.qr !== false) {
    const qx = X(EPA_PANEL_W) - 4 - PASSPORT_QR_PT;
    const qy = footBottom - 3 - PASSPORT_QR_PT;
    R(p, qx, qy, PASSPORT_QR_PT, PASSPORT_QR_PT, PAPER);
    p.qr(qx, qy, PASSPORT_QR_PT, url, INK);
    T(p, "VEHICLE PASSPORT", qx - 6, qy + 22, 8.5, "bold", { align: "right", color: PAPER });
    T(p, PASSPORT_QR_CAPTION, qx - 6, qy + 34, 7.5, "body", { align: "right", color: PAPER });
  }
}

/** Neutral wordmark in place of artwork that is not packaged (blocker missing_source_artwork). */
export function paintWordmark(p: Painter, text: string, x: number, y: number, size: number, o: { align?: "left" | "right" | "center"; color?: string } = {}): void {
  T(p, text.toUpperCase(), x, y, size, "bold", o);
}
