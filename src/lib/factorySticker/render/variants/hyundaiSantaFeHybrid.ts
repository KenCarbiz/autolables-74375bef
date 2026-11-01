// Dedicated 17x11 reproduction layout for the 2026 Hyundai Santa Fe Hybrid
// SE AWD, translated from Figma master 25:605 (file bNby4OyBUWhkHvVTbldgy4).
// Geometry is in display units (see tabloidCommon.ts); every printed value
// comes from the render data and nothing from the Figma review sample is
// used as a default. The OEM slogan, logo artwork, agency seals and source
// QR are intentionally not reproduced.

import type { FactoryStickerData } from "../../types.ts";
import { Painter, formatMoney, wrapText } from "../layout.ts";
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
  underlined,
  warrantySection,
  wrapD,
  yearModelTrim,
  wordmark,
  type FirstPageContext,
  type FlowEntry,
  type FlowStyle,
  type TabloidSpec,
} from "./tabloidCommon.ts";

export const HYUNDAI_SANTA_FE_HYBRID_KEY = "hyundai-2026-santa-fe-hybrid-se-awd";

const EQ_STYLE: FlowStyle = { size: 11.3, lh: 12, hang: 6, inset: 0 };

function paintHeader(p: Painter, d: FactoryStickerData): void {
  wordmark(p, "HYUNDAI", 355, 124, 44, 3);
  tx(p, yearModelTrim(d, ["year", "model", "trim", "drivetrain"], ""), 608, 128, 28.1, "bold");
  tx(p, `VIN:   ${d.vehicle.vin}`, 1821, 70, 14.5, "bold", { align: "right" });
}

function paintInfoBox(p: Painter, d: FactoryStickerData): void {
  dealerLines(d).slice(0, 4).forEach((line, i) => tx(p, line, 176, 198 + i * 16, 13, "body"));
  tx(p, "VIN:", 176, 293, 13.2, "bold");
  tx(p, d.vehicle.vin, 368, 293, 13.2, "body");
  const v = d.vehicle;
  const rows: Array<[string, string | null]> = [
    ["EXTERIOR COLOR:", colorText(v.exteriorColor, v.exteriorColorCode)],
    ["INTERIOR/SEAT COLOR:", colorText(v.interiorColor, v.interiorColorCode)],
    ["TRANSPORT:", d.factory.transportMethod ? d.factory.transportMethod.toUpperCase() : null],
  ];
  let y = 345;
  for (const [label, value] of rows) {
    if (!value) continue;
    tx(p, label, 176, y, 13.2, "bold");
    tx(p, value, 368, y, 13.2, "body");
    y += 17.4;
  }
  if (d.factory.emissionsCode) {
    tx(p, "EMISSIONS:", 176, y, 13.2, "bold");
    for (const l of wrapD(d.factory.emissionsCode, "body", 13.2, 330)) {
      tx(p, l, 268, y, 13.2, "body");
      y += 16;
    }
  }
}

function ratingBar(p: Painter, x: number, y: number, w: number): void {
  bx(p, x, y, w, 17, EPA_BLUE);
  bx(p, x, y, 24, 17, INK);
  bx(p, x + w - 24, y, 24, 17, INK);
  tx(p, "1", x + 12, y + 1.5, 12.5, "bold", { align: "center", color: PAPER });
  tx(p, "10", x + w - 12, y + 1.5, 12.5, "bold", { align: "center", color: PAPER });
}

function paintEpa(p: Painter, d: FactoryStickerData): void {
  const X = 1130;
  const Y = 183;
  const W = 715;
  const r = d.regulatory;
  bx(p, X, Y, W, 460, PAPER, 4);
  bx(p, X + 4, Y + 4, W - 8, 44, INK);
  tx(p, "EPA", X + 5, Y + 10, 15.5, "bold", { color: PAPER, lh: 16 });
  tx(p, "DOT", X + 5, Y + 26, 15.5, "bold", { color: PAPER, lh: 16 });
  tx(p, "Fuel Economy and Environment", X + 52, Y + 15, 23.1, "bold", { color: PAPER });
  bx(p, X + 478, Y + 9, 232, 33, EPA_BLUE);
  fuelPump(p, X + 484, Y + 10, 30, INK);
  if (d.vehicle.fuelType) tx(p, d.vehicle.fuelType, X + 706, Y + 18, 13, "bold", { align: "right" });

  const footer = (): void => {
    bx(p, X + 4, Y + 351, 568, 105, INK);
    const note = "Actual results will vary for many reasons, including driving conditions and how you drive and maintain your vehicle. Cost estimates are current EPA estimates and may differ from those printed on the original label.";
    wrapD(note, "bold", 10.2, 545).forEach((line, i) => tx(p, line, X + 11, Y + 358 + i * 11.5, 10.2, "bold", { color: PAPER, lh: 11.5 }));
    tx(p, "fueleconomy.gov", X + 11, Y + 384, 29.5, "bold", { color: PAPER });
    tx(p, "Calculate personalized estimates and compare vehicles", X + 11, Y + 420, 10.5, "body", { color: PAPER });
    paintQrSlot(p, d.document.passportUrl.trim(), X + 574, Y + 353, 134, 101);
  };

  if (r.epaStatus !== "VERIFIED" || r.combinedMpg === undefined) {
    wrapD("Fuel economy and environment information is not available from verified EPA records for this exact configuration.", "bold", 17, 600)
      .forEach((line, i) => tx(p, line, X + 47, Y + 80 + i * 22, 17, "bold", { lh: 22 }));
    footer();
    return;
  }

  tx(p, "Fuel Economy", X + 46, Y + 55, 14.5, "bold");
  fuelPump(p, X + 10, Y + 87, 42, INK);
  tx(p, String(Math.round(r.combinedMpg)), X + 46, Y + 80, 88, "bold");
  tx(p, "MPG", X + 173, Y + 76, 29, "bold");
  if (r.cityMpg !== undefined) {
    tx(p, String(Math.round(r.cityMpg)), X + 185, Y + 132, 24, "bold", { align: "center" });
    tx(p, "city", X + 185, Y + 181, 10, "body", { align: "center" });
  }
  if (r.highwayMpg !== undefined) {
    tx(p, String(Math.round(r.highwayMpg)), X + 234, Y + 132, 24, "bold", { align: "center" });
    tx(p, "highway", X + 234, Y + 181, 10, "body", { align: "center" });
  }
  tx(p, "combined city/hwy", X + 46, Y + 187, 11.5, "body");
  const gallons = r.gallonsPer100Miles ?? (r.combinedMpg > 0 ? 100 / r.combinedMpg : undefined);
  if (gallons !== undefined) tx(p, `${gallons.toFixed(1)} gallons per 100 miles`, X + 46, Y + 202, 20.7, "bold");

  const delta = r.fiveYearCostDifference;
  if (delta !== undefined && delta !== 0) {
    const saves = delta > 0;
    tx(p, saves ? "You save" : "You spend", X + 478, Y + 56, 27, "bold");
    tx(p, formatMoney(Math.abs(delta)).replace(/\.00$/, ""), X + 478, Y + 88, 51, "bold");
    const tail = saves
      ? ["in fuel costs", "over 5 years", "compared to the", "average new vehicle."]
      : ["more in fuel costs", "over 5 years", "compared to the", "average new vehicle."];
    tail.forEach((line, i) => tx(p, line, X + 478, Y + 141 + i * 19, 17.5, "bold", { lh: 19 }));
  }

  bx(p, X + 4, Y + 231, W - 8, 4, INK);
  if (r.annualFuelCost !== undefined) {
    const bxX = X + 12;
    const bxY = Y + 243;
    p.path(roundedRectPath(u(D(194)), u(D(103)), u(D(12))), u(D(bxX)), u(D(bxY)), u(D(194)), u(D(103)), null, INK, u(D(4)));
    tx(p, "Annual fuel cost", bxX + 11, bxY + 9, 18.4, "bold");
    tx(p, formatMoney(r.annualFuelCost).replace(/\.00$/, ""), bxX + 11, bxY + 37, 44, "bold");
  }
  if (r.greenhouseGasRating !== undefined && r.greenhouseGasRating > 0) {
    tx(p, "Fuel Economy & Greenhouse Gas Rating", X + 218, Y + 243, 10.4, "bold");
    tx(p, String(r.greenhouseGasRating), X + 218, Y + 260, 22, "bold");
    ratingBar(p, X + 218, Y + 287, 309);
  }
  if (r.smogRating !== undefined && r.smogRating > 0) {
    tx(p, "Smog Rating", X + 446, Y + 243, 10.4, "bold");
    tx(p, String(r.smogRating), X + 446, Y + 260, 22, "bold");
    ratingBar(p, X + 541, Y + 287, 160);
  }
  footer();
}

/** Returns false when the content cannot be drawn inside the box. */
function paintParts(p: Painter, d: FactoryStickerData): boolean {
  const f = partsFacts(d);
  const hasCarline = !!f.usCan || f.other.length > 0;
  const hasVehicle = !!f.assembly || !!f.engine || !!f.trans;
  if (!hasCarline && !hasVehicle) return true;
  const X = 1130;
  const Y = 777;
  const W = 705;
  const BOTTOM = 1100;
  const cx = X + W / 2;
  bx(p, X, Y, W, BOTTOM - Y, null, 3);
  const noteLines = wrapD(
    "Original manufacturer's suggested retail prices shown. Excludes taxes, title, license, dealer-installed items and current selling price.",
    "body", 12.5, W - 24,
  );
  noteLines.forEach((line, i) => tx(p, line, X + 10, Y + 9 + i * 14.5, 12.5, "body", { lh: 14.5 }));
  bx(p, X, 842, W, 3, INK);

  let y = 851;
  const line = (s: string, size: number, step: number, draw: boolean): void => {
    for (const l of wrapText(s.toUpperCase(), "bold", D(size) / 2, D(W - 30) / 2)) {
      if (draw) tx(p, l, cx, y, size, "bold", { align: "center" });
      y += step;
    }
  };
  const run = (draw: boolean): void => {
    y = 851;
    if (hasCarline) {
      line("PARTS CONTENT INFORMATION", 18.2, 18.5, draw);
      line("FOR VEHICLE IN THIS CARLINE:", 17, 17.5, draw);
      if (f.usCan) line(`U.S./CANADIAN PARTS CONTENT: ${f.usCan.value}`, 17, 17.5, draw);
      for (const e of f.other) line(`${e.label}: ${e.value}`, 17, 17.5, draw);
      y += 14;
      if (draw) tx(p, "Note: Parts content does not include final assembly, distribution, or other non-parts costs.", X + 10, y, 11.5, "body");
      y += 15;
    }
    if (hasVehicle) {
      if (draw) tx(p, "FOR THIS VEHICLE:", X + 8, y, 17, "bold");
      y += 18;
      if (f.assembly) {
        line("FINAL ASSEMBLY POINT:", 17, 17.5, draw);
        line(f.assembly, 17, 17.5, draw);
      }
      if (f.engine || f.trans) {
        line("COUNTRY OF ORIGIN:", 17, 17.5, draw);
        if (f.engine) line(`ENGINE: ${f.engine.value}`, 17, 17.5, draw);
        if (f.trans) line(`TRANSMISSION: ${f.trans.value}`, 17, 17.5, draw);
      }
    }
  };
  run(false);
  if (y > BOTTOM - 6) return false;
  run(true);
  return true;
}

/** Returns false when the pricing column cannot hold every row. */
function paintPricing(p: Painter, d: FactoryStickerData): boolean {
  const L = 637;
  const R = 1080;
  const pr = d.pricing;
  tx(p, "Manufacturer's Suggested Retail Price:", L, 553, 11.4, "bold");
  tx(p, pr.baseMsrp !== undefined ? formatMoney(pr.baseMsrp) : "NOT AVAILABLE", R, 553, 11.4, "bold", { align: "right" });

  const rows = priceRows(d);
  let y = 574;
  if (rows.length) {
    underlined(p, "ADDED FEATURES:", L, y, 15);
    y += 22;
    for (const r of rows) {
      const lines = wrapD(r.label, "body", 11.3, 340);
      lines.forEach((l, i) => {
        tx(p, l, L, y, 11.3, "body");
        if (i === 0 && r.amount) tx(p, r.amount, R, y, 11.3, "body", { align: "right" });
        y += 12.2;
      });
      for (const f of r.features) {
        for (const l of wrapD(f, "body", 10.3, 330)) {
          tx(p, l, L + 12, y, 10.3, "body");
          y += 11.4;
        }
      }
    }
  }
  if (pr.gasGuzzlerTax !== undefined) {
    y += 6;
    tx(p, "Gas Guzzler Tax", L, y, 11.3, "body");
    tx(p, formatMoney(pr.gasGuzzlerTax), R, y, 11.3, "body", { align: "right" });
    y += 12.2;
  }
  if (y > 1034) return false;

  tx(p, "Inland Freight & Handling :", L, 1067, 11, "body");
  tx(p, pr.destinationCharge !== undefined ? formatMoney(pr.destinationCharge) : "NOT AVAILABLE", R - 4, 1067, 11, "body", { align: "right" });
  const total = totalMsrp(d);
  tx(p, "Total Price :", L, 1079, 17.5, "bold");
  tx(p, total !== undefined ? formatMoney(total) : "NOT AVAILABLE", R - 6, 1079, 17.5, "bold", { align: "right" });
  return true;
}

const spec: TabloidSpec = {
  contStyle: EQ_STYLE,
  contTitle: (d, make) => yearModelTrim(d, ["year", "make", "model", "trim", "drivetrain"], make),
  paintFirst(p: Painter, ctx: FirstPageContext): FlowEntry[] | null {
    const { d, input } = ctx;
    if (!paintPricing(p, d)) return null;
    if (!paintParts(p, d)) return null;
    paintHeader(p, d);
    bx(p, 167, 186, 925, 924, null, 4);
    bx(p, 167, 544, 925, 3, INK);
    paintInfoBox(p, d);
    paintSafetyPanel(p, d, 608, 188, 482, 357, {
      headerH: 32, footerH: 78, subFrac: 0.29, valFrac: 0.57,
      titleSize: 22.6, labelSize: 16.9, noteSize: 12.1, footSize: 14.2,
    });
    paintEpa(p, d);

    const warranty = warrantySection(d, "Warranty");
    const sections = [...(warranty ? [warranty] : []), ...buildSections(input)];
    underlined(p, "STANDARD FEATURES:", 176, 553, 14);
    const { placed, rest } = flow(
      toEntries(sections, (s) => s.toUpperCase(), 3),
      [{ x: 176, w: 446, top: 570, bottom: 1076 }],
      EQ_STYLE,
    );
    paintPlaced(p, placed, EQ_STYLE, { headingFont: "bold" });
    return rest;
  },
};

export const buildHyundaiSantaFeHybridLayout: VariantLayoutBuilder = (input) => assembleTabloid(input, spec);
