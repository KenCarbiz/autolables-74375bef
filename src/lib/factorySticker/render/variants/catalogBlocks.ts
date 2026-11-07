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

export const EPA_PANEL_W = 700;
export const EPA_PANEL_H = 453;

const GAL = (r: FactoryStickerData["regulatory"]): number | undefined =>
  r.gallonsPer100Miles ?? (r.combinedMpg !== undefined && r.combinedMpg > 0 ? 100 / r.combinedMpg : undefined);

/** Fuel economy and environment panel; (ox, oy) is its top-left corner in reference pixels. */
export function paintCatalogEpa(p: Painter, d: FactoryStickerData, g: Grid, ox: number, oy: number): void {
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
  if (d.vehicle.fuelType) {
    R(p, X(483), Yy(5), W(212), Yy(43) - Yy(5), EPA_BLUE);
    T(p, fuelCategoryLabel(d.vehicle.fuelType), X(690), Yy(18), 10.5, "bold", { align: "right" });
  }

  const panelTop = Yy(48);
  R(p, X(5), panelTop, W(690), Yy(229) - panelTop, PAPER);
  T(p, "Fuel Economy", X(57), Yy(54), 11, "bold");
  if (!mpgOk) {
    wrap("Fuel economy and environment information is not available from verified EPA records for this exact configuration.", "bold", 12, W(410))
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
    if (r.epaClassNote) wrap(r.epaClassNote, "body", 7.5, W(215)).slice(0, 4).forEach((l, i) => T(p, l, X(268), Yy(80) + i * 8.2, 7.5, "body", { lh: 8.2 }));
    const gallons = GAL(r);
    if (gallons !== undefined) {
      const gs = gallons.toFixed(1);
      T(p, gs, X(57), Yy(180), 20, "bold");
      T(p, "gallons per 100 miles", X(57) + measureText(gs, "bold", 20) + 4, Yy(190), 8, "body");
    }
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
  T(p, "Smog Rating", X(547), Yy(240), 9, "bold");
  T(p, "(tailpipe only)", X(547) + measureText("Smog Rating", "bold", 9) + 3, Yy(240) + 1.6, 6.5, "body");
  paintScale(p, X(549), Yy(284), W(140), scaleState(verified ? r.smogRating : undefined), 14);
  if (verified && r.co2TailpipeGpm !== undefined) {
    const line = `This vehicle emits ${Math.round(r.co2TailpipeGpm)} grams CO2 per mile (tailpipe only). The best emits 0 grams per mile (tailpipe only). Producing and distributing fuel also create emissions; learn more at fueleconomy.gov.`;
    wrap(line, "body", 6.4, W(470)).slice(0, 2).forEach((l, i) => T(p, l, X(216), Yy(318) + i * 7, 6.4, "body", { lh: 7 }));
  }

  const footTop = Yy(345);
  const footBottom = Yy(EPA_PANEL_H);
  const note = "Actual results will vary for many reasons, including driving conditions and how you drive and maintain your vehicle. Cost estimates are current EPA estimates and may differ from those printed on the original label.";
  wrap(note, "bold", 6.8, W(540)).forEach((l, i) => T(p, l, X(12), footTop + 3 + i * 7.8, 6.8, "bold", { color: PAPER, lh: 7.8 }));
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

export function paintCatalogSafety(p: Painter, d: FactoryStickerData, x: number, y: number, w: number, h: number): void {
  const r = d.regulatory;
  if (isNhtsaRated(d)) {
    const footerH = 60;
    const headerH = 30;
    const body = Q(h) - headerH - footerH;
    paintSafetyPanel(p, d, Q(x), Q(y), Q(w), Q(h), {
      headerH, footerH, subFrac: 0.29, valFrac: 0.57,
      titleSize: 19, labelSize: 14.5, noteSize: 10.2, footSize: 11.6, stretch: Math.min(1.04, body / 244),
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
  T(p, "GOVERNMENT 5-STAR SAFETY RATINGS", x + w / 2, y + 5.5, 12.4, "bold", { align: "center", color: PAPER });
  R(p, x + 4, y + headerH, w - 8, msgH, PAPER);
  wrap(message, "body", 10.5, w - 24).forEach((l, i) => T(p, l, x + 10, y + headerH + 5 + i * 12.4, 10.5, "body", { lh: 12.4 }));
  const foot = y + headerH + msgH;
  T(p, "Source: National Highway Traffic Safety Administration (NHTSA)", x + w / 2, foot + 5, 8.4, "bold", { align: "center", color: PAPER });
  T(p, "www.nhtsa.gov/ratings", x + w / 2, foot + 17, 8.4, "bold", { align: "center", color: PAPER });
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
