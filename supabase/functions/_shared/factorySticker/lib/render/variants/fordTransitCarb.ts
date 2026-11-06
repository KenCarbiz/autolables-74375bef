// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/render/variants/fordTransitCarb.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
import { paintVariantLogo } from "./shared.ts";
// Dedicated 17x11 reproduction layout for the 2025 Ford Transit-250 Cargo
// RWD E85 with the California Air Resources Board environmental panel
// (no parts-content panel), translated from Figma master 25:7587 (file
// bNby4OyBUWhkHvVTbldgy4). Geometry is in display units (tabloidCommon.ts).
//
// The data model carries no CARB letter grades, so the Greenhouse Gas and
// Smog scales are drawn with an explicit "Not Available" in place of the
// grade. The Ford oval, FordPass, Ford Protect and Ford Credit artwork and
// copy, order-barcode strip codes and source QR are not reproduced.

import type { FactoryStickerData } from "../../types.ts";
import { Painter, formatPlain } from "../layout.ts";
import { INK, PAPER, u, type VariantLayoutBuilder } from "./shared.ts";
import {
  D,
  assembleTabloid,
  buildSections,
  bx,
  colorText,
  dealerLines,
  flow,
  paintPlaced,
  paintQrSlot,
  paintSafetyPanel,
  priceRows,
  toEntries,
  totalMsrp,
  tx,
  underlined,
  widthD,
  warrantySection,
  wrapD,
  yearModelTrim,
  type FirstPageContext,
  type FlowEntry,
  type FlowStyle,
  type TabloidSpec,
} from "./tabloidCommon.ts";

export const FORD_TRANSIT_CARB_KEY = "ford-2025-transit-250-cargo-rwd-e85-carb";

const BLUE = "#005a9c";
const EQ_STYLE: FlowStyle = { size: 8.6, lh: 13, hang: 0, inset: 9 };

function paintFrame(p: Painter): void {
  bx(p, 158, 83, 1684, 1049, BLUE);
  bx(p, 178, 228, 910, 697, PAPER);
  bx(p, 388, 926, 383, 186, PAPER);
  bx(p, 178, 926, 208, 186, PAPER);
  bx(p, 1090, 104, 730, 1010, PAPER);
  bx(p, 1088, 228, 2, 697, BLUE);
}

function paintHeader(p: Painter, d: FactoryStickerData): void {
  bx(p, 178, 103, 182, 122, PAPER);
  paintVariantLogo(p, "ford");
  const v = d.vehicle;
  tx(p, "VEHICLE DESCRIPTION", 366, 104, 11, "body", { color: PAPER });
  const model = v.model.toUpperCase();
  const size = Math.min(40.9, 40.9 * (480 / Math.max(480, widthModel(model))));
  tx(p, model, 388, 119, size, "body", { color: PAPER });
  const lines = [
    [v.year > 0 ? String(v.year) : "", v.trim ?? "", v.drivetrain ?? ""].filter(Boolean).join(" ").toUpperCase(),
    v.engine?.toUpperCase() ?? "",
    v.transmission?.toUpperCase() ?? "",
  ].filter(Boolean);
  lines.forEach((l, i) => tx(p, l, 437, 160 + i * 14.5, 13.2, "body", { color: PAPER }));
  const ext = colorText(v.exteriorColor, v.exteriorColorCode);
  const int = colorText(v.interiorColor, v.interiorColorCode);
  let y = 160;
  if (ext) {
    tx(p, "EXTERIOR", 746, y, 13.2, "body", { color: PAPER });
    tx(p, ext, 766, y + 15, 13.2, "body", { color: PAPER });
    y += 31;
  }
  if (int) {
    tx(p, "INTERIOR", 746, y, 13.2, "body", { color: PAPER });
    tx(p, int, 766, y + 15, 13.2, "body", { color: PAPER });
  }
}

function widthModel(s: string): number {
  return s.length * 40.9 * 0.68;
}

function paintTopStrip(p: Painter, d: FactoryStickerData): void {
  const f = d.factory;
  const parts = [f.orderNumber, f.sequenceNumber, f.dealerCode, f.locationCode, f.emissionsCode].filter((s): s is string => !!s);
  let x = 183;
  for (const s of parts) {
    tx(p, s, x, 56, 14, "body");
    x += Math.max(120, s.length * 10 + 24);
  }
  tx(p, "VIN", 1512, 58, 12, "bold");
  tx(p, d.vehicle.vin, 1548, 54, 20, "body");
}

function paintCarb(p: Painter, d: FactoryStickerData): void {
  const X = 1100;
  const W = 712;
  bx(p, X, 110, W, 43, PAPER, 3);
  tx(p, "California Air Resources Board", X + 3, 113, 19.8, "bold");
  if (d.vehicle.fuelType) tx(p, d.vehicle.fuelType, X + W - 20, 114, 11.8, "bold", { align: "right" });

  bx(p, X, 155, W, 130, PAPER, 3);
  tx(p, "Environmental Performance", X + W / 2, 172, 32.6, "bold", { align: "center" });
  tx(p, "These ratings are not directly comparable to the U.S. EPA/DOT light-duty vehicle label ratings.", X + W / 2, 220, 14, "body", { align: "center" });
  tx(p, "For information on how to compare, please see www.arb.ca.gov/ep_label.", X + W / 2, 236, 14, "body", { align: "center" });

  bx(p, X, 288, W, 197, PAPER, 3);
  tx(p, "Protect the environment. Choose vehicles with higher ratings:", X + W / 2, 299, 18.4, "bold", { align: "center" });
  tx(p, "Greenhouse Gas Rating", X + 14, 337, 19.8, "bold");
  tx(p, "Smog Rating", X + 378, 337, 19.8, "bold");
  tx(p, "Not Available", X + 14, 385, 20, "bold");
  tx(p, "Not Available", X + 378, 385, 20, "bold");
  ["A+", "A", "B", "C", "D"].forEach((l, i) => tx(p, l, X + 14 + [0, 56, 97, 138, 180][i], 431, 14, "bold"));
  ["A", "B", "C", "D"].forEach((l, i) => tx(p, l, X + 378 + [0, 42, 83, 125][i] - 0, 431, 14, "bold"));
  tx(p, "Using alternative fuels may change scores.", X + W / 2, 465, 14, "body", { align: "center" });

  bx(p, X, 487, W, 58, INK);
  tx(p, "Vehicle emissions contribute to climate change and smog. Ratings are determined by the", X + 3, 497, 11.5, "body", { color: PAPER });
  tx(p, "California Air Resources Board based on this vehicle's measured emissions.", X + 3, 512, 11.5, "body", { color: PAPER });
  tx(p, "CALIFORNIA AIR RESOURCES BOARD", X + W - 12, 525, 14.5, "bold", { align: "right", color: PAPER });
}

function paintWarning(p: Painter): void {
  bx(p, 1096, 993, 556, 114, PAPER, 2);
  const tri = "M10 0 L20 18 L0 18 Z";
  p.path(tri, u(D(1106)), u(D(1003)), u(D(28)), u(D(26)), null, INK, u(D(2.5)));
  tx(p, "!", 1120, 1008, 15, "bold", { align: "center" });
  const text = "WARNING: Operating, servicing and maintaining a passenger vehicle, pickup truck, van, or off-road vehicle can expose you to chemicals including engine exhaust, carbon monoxide, phthalates, and lead, which are known to the State of California to cause cancer and birth defects or other reproductive harm. To minimize exposure, avoid breathing exhaust, do not idle the engine except as necessary, service your vehicle in a well-ventilated area and wear gloves or wash your hands frequently when servicing your vehicle. For more information go to www.P65Warnings.ca.gov/passenger-vehicle.";
  wrapD(text, "body", 11.5, 496).forEach((l, i) => tx(p, l, 1148, 1000 + i * 12.6, 11.5, "body", { lh: 12.6 }));
}

function paintBottom(p: Painter, d: FactoryStickerData): void {
  dealerLines(d).slice(0, 5).forEach((l, i) => tx(p, l, 186, 934 + i * 15, 12, "body"));
  const f = d.factory;
  const origin = f.finalAssemblyPoint ?? f.assemblyPlant;
  let y = 931;
  if (origin) {
    tx(p, "FINAL ASSEMBLY PLANT", 597, y, 8.6, "body", { color: BLUE });
    tx(p, origin.toUpperCase(), 597, y + 15, 13.5, "body");
    bx(p, 392, 964, 379, 1.6, BLUE);
    y = 972;
  }
  if (f.transportMethod) {
    tx(p, "METHOD OF TRANSP.", 597, y, 8.6, "body", { color: BLUE });
    tx(p, f.transportMethod.toUpperCase(), 597, y + 15, 13.5, "body");
  }
  tx(p, "TOTAL MSRP", 789, 938, 20.7, "body", { color: PAPER });
  const total = totalMsrp(d);
  tx(p, total !== undefined ? formatPlain(total).replace(/^/, "$") : "NOT AVAILABLE", 1063, 938, 20.7, "body", { align: "right", color: PAPER });
}

/** Returns false when the options list or price block cannot fit. */
function paintPricing(p: Painter, d: FactoryStickerData): boolean {
  const rows = priceRows(d, formatPlain);
  const L = 183;
  const R = 480;
  let y = 502;
  tx(p, "INCLUDED ON THIS VEHICLE", L, y, 10.5, "body");
  tx(p, "(MSRP)", R, y, 10.5, "body", { align: "right" });
  y = 527;
  if (rows.length) {
    underlined(p, "OPTIONAL EQUIPMENT/OTHER", L, y, 10.2);
    y = 543;
    for (const r of rows) {
      wrapD(r.label.toUpperCase(), "body", 8.6, 215).forEach((l, i) => {
        tx(p, l, L, y, 8.6, "body");
        if (i === 0 && r.amount) tx(p, r.amount, R, y, 8.6, "body", { align: "right" });
        y += 13;
      });
      for (const f of r.features) {
        for (const l of wrapD(f.toUpperCase(), "body", 8.6, 205)) {
          tx(p, l, L + 10, y, 8.6, "body");
          y += 13;
        }
      }
    }
  }
  if (y > 918) return false;

  const pr = d.pricing;
  const PL = 786;
  const PR = 1081;
  const options = ((): number | undefined => {
    if (pr.factoryInstalledTotal !== undefined) return pr.factoryInstalledTotal + (pr.portOptionsTotal ?? 0);
    const eq = d.equipment;
    const all = [...eq.packages, ...eq.options, ...(eq.portInstalled ?? [])];
    if (all.some((r) => r.priceStatus === "UNAVAILABLE")) return undefined;
    return all.reduce((a, r) => a + (r.price ?? 0), 0);
  })();
  const money = (n: number | undefined): string => (n === undefined ? "NOT AVAILABLE" : formatPlain(n));
  tx(p, "(MSRP)", PR, 502, 10.5, "body", { align: "right" });
  underlined(p, "PRICE INFORMATION", PL, 522, 10.2);
  tx(p, "BASE PRICE", PL, 535, 10, "body");
  tx(p, money(pr.baseMsrp), PR, 535, 10, "body", { align: "right" });
  tx(p, "TOTAL OPTIONS/OTHER", PL, 548, 10, "body");
  tx(p, money(options), PR, 548, 10, "body", { align: "right" });
  bx(p, 980, 565, 101, 1, INK);
  tx(p, "TOTAL VEHICLE & OPTIONS/OTHER", PL, 575, 10, "body");
  tx(p, money(pr.baseMsrp !== undefined && options !== undefined ? pr.baseMsrp + options : undefined), PR, 575, 10, "body", { align: "right" });
  tx(p, "DESTINATION & DELIVERY", PL, 588, 10, "body");
  tx(p, money(pr.destinationCharge), PR, 588, 10, "body", { align: "right" });
  if (pr.gasGuzzlerTax !== undefined) {
    tx(p, "GAS GUZZLER TAX", PL, 601, 10, "body");
    tx(p, money(pr.gasGuzzlerTax), PR, 601, 10, "body", { align: "right" });
  }
  return true;
}

const spec: TabloidSpec = {
  contStyle: { size: 10.4, lh: 13, hang: 0, inset: 9 },
  contTitle: (d, make) => yearModelTrim(d, ["year", "make", "model", "trim", "drivetrain"], make),
  paintFirst(p: Painter, ctx: FirstPageContext): FlowEntry[] | null {
    const { d, input } = ctx;
    paintFrame(p);
    if (!paintPricing(p, d)) return null;
    paintTopStrip(p, d);
    paintHeader(p, d);
    tx(p, "STANDARD EQUIPMENT", 183, 240, 11, "body");
    underlined(p, "INCLUDED AT NO EXTRA CHARGE", 183 + widthD("STANDARD EQUIPMENT ", "body", 11), 240, 11);
    bx(p, 178, 492, 910, 1.6, BLUE);
    paintCarb(p, d);
    paintSafetyPanel(p, d, 1097, 573, 458, 355, {
      headerH: 27, footerH: 63, subFrac: 0.28, valFrac: 0.57,
      titleSize: 16.9, labelSize: 15.6, noteSize: 10.6, footSize: 13.8, stretch: 1.02,
    });
    paintWarning(p);
    paintQrSlot(p, d.document.passportUrl.trim(), 1664, 990, 150, 118);
    paintBottom(p, d);

    const warranty = warrantySection(d, "Warranty");
    const sections = [...buildSections(input), ...(warranty ? [warranty] : [])];
    const entries = toEntries(sections, (s) => s.toUpperCase(), 14, (h) => h !== "Warranty");
    const style: FlowStyle = { ...EQ_STYLE, size: 8.6 };
    const upper = entries.map((e) => (e.heading ? e : { ...e, text: e.text.toUpperCase() }));
    const { placed, rest } = flow(
      upper,
      [
        { x: 183, w: 232, top: 279, bottom: 490 },
        { x: 420, w: 230, top: 279, bottom: 490 },
        { x: 656, w: 217, top: 279, bottom: 490 },
        { x: 879, w: 206, top: 279, bottom: 490 },
      ],
      style,
    );
    paintPlaced(p, placed, style, { bullet: "dot" });
    return rest;
  },
};

export const buildFordTransitCarbLayout: VariantLayoutBuilder = (input) => assembleTabloid(input, spec);
