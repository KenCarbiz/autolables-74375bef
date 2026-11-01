// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/render/variants/mitsubishiOutlander.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// Dedicated 17x11 reproduction layout for the 2025 Mitsubishi Outlander SE
// S-AWC, translated from Figma master 25:1619 (file bNby4OyBUWhkHvVTbldgy4).
// Geometry is in display units (see tabloidCommon.ts). Values come only from
// the render data; the logo diamond, dealer-site bar, warranty artwork and
// agency seals are not reproduced.

import type { FactoryStickerData } from "../../types.ts";
import { Painter, formatMoney } from "../layout.ts";
import { EPA_BLUE, INK, PAPER, roundedRectPath, u, type VariantLayoutBuilder } from "./shared.ts";
import {
  D,
  assembleTabloid,
  buildSections,
  bx,
  colorText,
  dealerLines,
  flow,
  fuelPump,
  paintPlaced,
  paintQrSlot,
  paintSafetyPanel,
  partsFacts,
  priceRows,
  toEntries,
  totalMsrp,
  tx,
  widthD,
  wordmark,
  wrapD,
  yearModelTrim,
  type FirstPageContext,
  type FlowEntry,
  type FlowStyle,
  type TabloidSpec,
} from "./tabloidCommon.ts";

export const MITSUBISHI_OUTLANDER_KEY = "mitsubishi-2025-outlander-se-s-awc";

const EQ_STYLE: FlowStyle = { size: 10.6, lh: 13.1, hang: 0, inset: 10 };
const RULE_GREY = "#bdbdbd";

function paintIdentity(p: Painter, d: FactoryStickerData): void {
  wordmark(p, "MITSUBISHI", 281, 196, 17, 2.4);
  tx(p, yearModelTrim(d, ["year", "model", "trim", "drivetrain"], ""), 376, 124, 15.5, "bold");
  const v = d.vehicle;
  const colors = [v.exteriorColor, v.interiorColor].filter((s): s is string => !!s).map((s) => s.toUpperCase()).join(" / ");
  let y = 143;
  if (colors) {
    tx(p, colors, 376, y, 15.5, "bold");
    y += 20;
  }
  const small = [v.engine, v.transmission, d.factory.emissionsCode].filter((s): s is string => !!s);
  let sy = 205;
  for (const s of small) {
    for (const l of wrapD(s.toUpperCase(), "bold", 10.5, 370)) {
      tx(p, l, 376, sy, 10.5, "bold");
      sy += 14;
    }
  }
  bx(p, 198, 268, 552, 1.6, INK);
}

function ratingBar(p: Painter, x: number, y: number, w: number, rating: number): void {
  bx(p, x, y, w, 24, EPA_BLUE);
  bx(p, x, y, 36, 24, INK);
  bx(p, x + w - 36, y, 36, 24, INK);
  tx(p, "1", x + 18, y + 3, 16, "bold", { align: "center", color: PAPER });
  tx(p, "10", x + w - 18, y + 3, 16, "bold", { align: "center", color: PAPER });
  const mx = x + 18 + ((Math.min(10, Math.max(1, rating)) - 1) / 9) * (w - 36);
  bx(p, mx - 1, y - 8, 2.5, 8, INK);
  tx(p, String(rating), mx, y - 31, 21, "bold", { align: "center" });
  tx(p, "Best", x + w, y + 27, 10.5, "body", { align: "right" });
}

function paintEpa(p: Painter, d: FactoryStickerData): void {
  const X = 1055;
  const Y = 105;
  const W = 745;
  const r = d.regulatory;
  bx(p, X, Y, W, 465, INK);
  tx(p, "EPA", X + 11, Y + 9, 17, "bold", { color: PAPER, lh: 17 });
  tx(p, "DOT", X + 11, Y + 27, 17, "bold", { color: PAPER, lh: 17 });
  tx(p, "Fuel Economy and Environment", X + 68, Y + 11, 25.4, "bold", { color: PAPER });
  bx(p, X + 530, Y + 7, 213, 38, EPA_BLUE);
  fuelPump(p, X + 536, Y + 8, 34, INK);
  if (d.vehicle.fuelType) tx(p, d.vehicle.fuelType, X + 738, Y + 19, 14, "bold", { align: "right" });

  const footer = (): void => {
    const note = "Actual results will vary for many reasons, including driving conditions and how you drive and maintain your vehicle. Cost estimates are current EPA estimates and may differ from those printed on the original label.";
    wrapD(note, "bold", 10.2, 575).forEach((line, i) => tx(p, line, X + 10, Y + 359 + i * 11.6, 10.2, "bold", { color: PAPER, lh: 11.6 }));
    tx(p, "fueleconomy.gov", X + 10, Y + 408, 30, "bold", { color: PAPER });
    tx(p, "Calculate personalized estimates and compare vehicles", X + 10, Y + 443, 11, "bold", { color: PAPER });
    paintQrSlot(p, d.document.passportUrl.trim(), X + 598, Y + 358, 142, 102);
  };

  bx(p, X + 6, Y + 50, W - 12, 183, PAPER);
  if (r.epaStatus !== "VERIFIED" || r.combinedMpg === undefined) {
    wrapD("Fuel economy and environment information is not available from verified EPA records for this exact configuration.", "bold", 17, 640)
      .forEach((line, i) => tx(p, line, X + 51, Y + 80 + i * 22, 17, "bold", { lh: 22 }));
    footer();
    return;
  }

  tx(p, "Fuel Economy", X + 51, Y + 51, 14.5, "bold");
  fuelPump(p, X + 12, Y + 92, 44, INK);
  tx(p, String(Math.round(r.combinedMpg)), X + 52, Y + 76, 98, "bold");
  tx(p, "MPG", X + 187, Y + 72, 27, "bold");
  if (r.epaClassNote) {
    wrapD(r.epaClassNote, "body", 11, 240).slice(0, 3).forEach((l, i) => tx(p, l, X + 283, Y + 80 + i * 13, 11, "body"));
  }
  if (r.cityMpg !== undefined) {
    tx(p, String(Math.round(r.cityMpg)), X + 226, Y + 128, 28, "bold", { align: "center" });
    tx(p, "city", X + 226, Y + 156, 11, "body", { align: "center" });
  }
  if (r.highwayMpg !== undefined) {
    tx(p, String(Math.round(r.highwayMpg)), X + 288, Y + 128, 28, "bold", { align: "center" });
    tx(p, "highway", X + 288, Y + 156, 11, "body", { align: "center" });
  }
  tx(p, "combined city/hwy", X + 51, Y + 164, 11.5, "body");
  const gallons = r.gallonsPer100Miles ?? (r.combinedMpg > 0 ? 100 / r.combinedMpg : undefined);
  if (gallons !== undefined) {
    const g = gallons.toFixed(1);
    tx(p, g, X + 51, Y + 183, 35, "bold");
    tx(p, "gallons per 100 miles", X + 51 + widthD(g, "bold", 35) + 7, Y + 204, 12, "body");
  }

  const delta = r.fiveYearCostDifference;
  if (delta !== undefined && delta !== 0) {
    const saves = delta > 0;
    const word = saves ? "save" : "spend";
    tx(p, "You", X + 535, Y + 64, 20, "bold");
    tx(p, word, X + 535 + widthD("You", "bold", 20) + 6, Y + 50, 36, "bold");
    tx(p, formatMoney(Math.abs(delta)).replace(/\.00$/, ""), X + 535, Y + 90, 52, "bold");
    tx(p, saves ? "in fuel costs" : "more in fuel costs", X + 561, Y + 143, 18.5, "bold");
    tx(p, "over 5 years", X + 561, Y + 164, 18.5, "bold");
    tx(p, "compared to the", X + 561, Y + 187, 14.5, "body");
    tx(p, "average new vehicle.", X + 561, Y + 202, 14.5, "body");
  }

  bx(p, X + 5, Y + 238, 212, 115, PAPER);
  if (r.annualFuelCost !== undefined) {
    tx(p, "Annual fuel cost", X + 19, Y + 244, 19, "bold");
    tx(p, formatMoney(r.annualFuelCost).replace(/\.00$/, ""), X + 24, Y + 278, 50, "bold");
  }
  bx(p, X + 225, Y + 238, 515, 115, PAPER);
  const hasGhg = r.greenhouseGasRating !== undefined && r.greenhouseGasRating > 0;
  const hasSmog = r.smogRating !== undefined && r.smogRating > 0;
  if (hasGhg) {
    tx(p, "Fuel Economy & Greenhouse Gas Rating", X + 234, Y + 243, 11.5, "bold");
    ratingBar(p, X + 234, Y + 292, 321, r.greenhouseGasRating!);
  }
  if (hasSmog) {
    tx(p, "Smog Rating", X + 586, Y + 243, 11.5, "bold");
    ratingBar(p, X + 586, Y + 292, 137, r.smogRating!);
  }
  if (hasGhg || hasSmog) tx(p, "Tailpipe emissions only.", X + 234, Y + 330, 10.2, "body");
  footer();
}

function paintWarranty(p: Painter, d: FactoryStickerData): void {
  const w = d.warranty;
  if (!w || !w.sourceVerified) return;
  const lines = [w.basic, w.powertrain, w.corrosion, w.roadside, w.emissions].filter((s): s is string => !!s);
  if (!lines.length) return;
  const X = 1058;
  const Y = 577;
  const W = 269;
  const H = 170;
  p.path(roundedRectPath(u(D(W)), u(D(H)), u(D(12))), u(D(X)), u(D(Y)), u(D(W)), u(D(H)), null, INK, u(D(3)));
  tx(p, "Limited Warranty", X + W / 2, Y + 10, 16, "bold", { align: "center" });
  let y = Y + 36;
  for (const s of lines) {
    for (const l of wrapD(s, "body", 11.5, W - 24)) {
      if (y > Y + H - 40) break;
      tx(p, l, X + 12, y, 11.5, "body");
      y += 13;
    }
    y += 3;
  }
  for (const l of wrapD("Original new-vehicle terms; not coverage remaining.", "body", 9.8, W - 24)) {
    tx(p, l, X + 12, Math.min(y, Y + H - 24), 9.8, "body");
    y += 11.5;
  }
}

/** Returns false when the content cannot be drawn inside the box. */
function paintParts(p: Painter, d: FactoryStickerData): boolean {
  const f = partsFacts(d);
  const hasCarline = !!f.usCan || f.other.length > 0;
  const hasVehicle = !!f.assembly || !!f.engine || !!f.trans;
  if (!hasCarline && !hasVehicle) return true;
  const X = 1058;
  const Y = 758;
  const W = 269;
  const BOTTOM = 967;
  const cx = X + W / 2;
  const half = (W - 20) / 2;

  const run = (draw: boolean): number => {
    let y = Y + 25;
    const centered = (s: string, size: number, font: "body" | "bold", step: number): void => {
      for (const l of wrapD(s, font, size, W - 16)) {
        if (draw) tx(p, l, cx, y, size, font, { align: "center" });
        y += step;
      }
    };
    if (hasCarline) {
      centered("For vehicles in this carline:", 11.5, "body", 14);
      const left = f.usCan ? [{ label: f.usCan.label, value: f.usCan.value }] : [];
      const right = f.other;
      const block = (e: { label: string; value: string }, x: number, top: number): number => {
        let yy = top;
        for (const l of wrapD(`${e.label}:`, "body", 11.5, half)) {
          if (draw) tx(p, l, x + half / 2, yy, 11.5, "body", { align: "center" });
          yy += 13;
        }
        for (const l of wrapD(e.value, "bold", 11.5, half)) {
          if (draw) tx(p, l, x + half / 2, yy, 11.5, "bold", { align: "center" });
          yy += 13;
        }
        return yy;
      };
      let ly = y;
      let ry = y;
      for (const e of left) ly = block(e, X + 8, ly);
      for (const e of right) ry = block(e, X + 12 + half, ry);
      y = Math.max(ly, ry) + 10;
    }
    if (hasVehicle) {
      centered("For this vehicle:", 11.5, "body", 15);
      if (f.assembly) {
        if (draw) tx(p, "Final Assembly Point:", X + 10, y, 11.5, "body");
        const lines = wrapD(f.assembly.toUpperCase(), "bold", 11.5, half);
        lines.forEach((l, i) => {
          if (draw) tx(p, l, X + W - 10, y + i * 13, 11.5, "bold", { align: "right" });
        });
        y += Math.max(13, lines.length * 13) + 8;
      }
      if (f.engine || f.trans) {
        if (draw) tx(p, "Country of Origin:", X + 10, y, 11.5, "body");
        if (f.engine) {
          if (draw) tx(p, `Engine: ${f.engine.value}`, X + W - 10, y, 11.5, "bold", { align: "right" });
          y += 14;
        }
        if (f.trans) {
          if (draw) tx(p, `Transmission: ${f.trans.value}`, X + W - 10, y, 11.5, "bold", { align: "right" });
          y += 14;
        }
        y += 6;
      }
    }
    for (const l of wrapD("Note: Parts content does not include final assembly, distribution, or other non-parts costs.", "body", 9.8, W - 16)) {
      if (draw) tx(p, l, cx, y, 9.8, "body", { align: "center" });
      y += 11.5;
    }
    return y;
  };
  if (run(false) > BOTTOM - 4) return false;
  p.path(roundedRectPath(u(D(W)), u(D(BOTTOM - Y)), u(D(10))), u(D(X)), u(D(Y)), u(D(W)), u(D(BOTTOM - Y)), null, INK, u(D(3)));
  bx(p, X + 4, Y + 4, W - 8, 21, INK);
  tx(p, "Parts Content Information", cx, Y + 8, 14, "bold", { align: "center", color: PAPER });
  run(true);
  return true;
}

function paintBottomBox(p: Painter, d: FactoryStickerData): void {
  const X = 1058;
  const Y = 976;
  const W = 744;
  const H = 126;
  p.path(roundedRectPath(u(D(W)), u(D(H)), u(D(12))), u(D(X)), u(D(Y)), u(D(W)), u(D(H)), null, INK, u(D(3)));
  dealerLines(d).slice(0, 4).forEach((l, i) => tx(p, l, X + 12, Y + 12 + i * 15, 12, "body"));
  let y = Y + 56;
  if (d.factory.transportMethod) {
    tx(p, "Method of Transport:", X + 268, y, 11, "body");
    tx(p, d.factory.transportMethod.toUpperCase(), X + 386, y, 11, "body");
    y += 14;
  }
  const origin = d.factory.finalAssemblyPoint ?? [d.factory.assemblyPlant, d.factory.assemblyCountry].filter(Boolean).join(", ");
  if (origin) {
    tx(p, "Plant/Port of Entry:", X + 268, y, 11, "body");
    tx(p, origin.toUpperCase(), X + 386, y, 11, "body");
  }
  tx(p, "VIN", X + 483, Y + 56, 13, "bold");
  tx(p, `: ${d.vehicle.vin}`, X + 521, Y + 56, 13, "bold");
  const lic = "Taxes, title, license and dealer-installed options and accessories are not included in the MSRP shown.";
  tx(p, lic, X + 8, Y + H - 22, 10.8, "body");
}

function paintTotals(p: Painter, d: FactoryStickerData, rows: ReturnType<typeof priceRows>): void {
  const pr = d.pricing;
  const R = 1037;
  const L = 942;
  const dash = "NOT AVAILABLE";
  const sum = (): number | undefined => {
    if (pr.factoryInstalledTotal !== undefined) return pr.factoryInstalledTotal + (pr.portOptionsTotal ?? 0);
    const eq = d.equipment;
    const all = [...eq.packages, ...eq.options, ...(eq.portInstalled ?? [])];
    if (all.some((r) => r.priceStatus === "UNAVAILABLE")) return undefined;
    return all.reduce((a, r) => a + (r.price ?? 0), 0);
  };
  const addl = rows.length || pr.factoryInstalledTotal !== undefined ? sum() : 0;
  const subtotal = pr.baseMsrp !== undefined && addl !== undefined ? pr.baseMsrp + addl : undefined;
  const money = (n: number | undefined): string => (n === undefined ? dash : formatMoney(n));
  const total = totalMsrp(d);
  const line = (label: string, value: string, y: number, size: number): void => {
    tx(p, label, L, y, size - 1.5, "bold", { align: "right" });
    tx(p, value, R, y, size - 2, "numeric", { align: "right" });
  };
  line("MSRP*:", money(pr.baseMsrp), 972, 14);
  line("Total Additional Equipment:", money(addl), 990, 14);
  bx(p, 953, 1008, 84, 1.2, INK);
  line("Subtotal:", money(subtotal), 1011, 14);
  line("Destination/Handling:", money(pr.destinationCharge), 1029, 14);
  bx(p, 953, 1046, 84, 1.2, INK);
  line("Total MSRP*:", money(total), 1050, 15);
  tx(p, "*MSRP (Manufacturer's Suggested Retail Price)", R, 1071, 8.6, "bold", { align: "right" });
}

/** Returns false when the additional-equipment column cannot hold every row. */
function paintAdditional(p: Painter, d: FactoryStickerData, rows: ReturnType<typeof priceRows>): boolean {
  const L = 761;
  const R = 1034;
  let y = 150;
  if (rows.length) {
    tx(p, "Additional Equipment", L, 121, 13.5, "bold");
    for (const r of rows) {
      const lines = wrapD(r.label, "bold", 10.6, 200);
      lines.forEach((l, i) => {
        tx(p, l, L, y, 10.6, "bold");
        if (i === 0 && r.amount) tx(p, r.amount, R, y, 10.6, "bold", { align: "right" });
        y += 13.1;
      });
      for (const f of r.features) {
        const fl = wrapD(f, "body", 10.3, 250);
        fl.forEach((l, i) => {
          tx(p, l, L + 10, y, 10.3, "body");
          if (i === 0) bx(p, L + 1, y + 4.5, 3.8, 3.8, INK);
          y += 13.1;
        });
      }
      y += 5;
    }
  }
  return y <= 958;
}

const spec: TabloidSpec = {
  contStyle: EQ_STYLE,
  contTitle: (d, make) => yearModelTrim(d, ["year", "make", "model", "trim", "drivetrain"], make),
  paintFirst(p: Painter, ctx: FirstPageContext): FlowEntry[] | null {
    const { d, input } = ctx;
    const rows = priceRows(d);
    if (!paintAdditional(p, d, rows)) return null;
    if (!paintParts(p, d)) return null;
    p.path(roundedRectPath(u(D(856)), u(D(997)), u(D(14))), u(D(189)), u(D(105)), u(D(856)), u(D(997)), null, INK, u(D(3)));
    paintIdentity(p, d);
    bx(p, 475, 278, 1, 772, RULE_GREY);
    bx(p, 757, 120, 1, 930, RULE_GREY);
    paintTotals(p, d, rows);
    paintEpa(p, d);
    paintWarranty(p, d);
    paintSafetyPanel(p, d, 1340, 578, 462, 387, {
      headerH: 24, footerH: 67, subFrac: 0.37, valFrac: 0.7,
      titleSize: 19, labelSize: 14.5, noteSize: 11.2, footSize: 13.2,
    });
    paintBottomBox(p, d);

    const { placed, rest } = flow(
      toEntries(buildSections(input), (s) => s, 9, (h) => /safety/i.test(h)),
      [
        { x: 198, w: 272, top: 291, bottom: 1040 },
        { x: 482, w: 270, top: 291, bottom: 1040 },
      ],
      EQ_STYLE,
    );
    paintPlaced(p, placed, EQ_STYLE, { bullet: "square", headingFont: "bold" });
    return rest;
  },
};

export const buildMitsubishiOutlanderLayout: VariantLayoutBuilder = (input) => assembleTabloid(input, spec);
