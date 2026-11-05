// 17x11 reproduction layout for the 2026 Maserati GranTurismo (gasoline),
// translated from the geometry of "Maserati_2026_GranTurismo_Trofeo" (Figma file
// r7OzwGrxQWEyF5GA5sJKYH, master 1:323). The reference is a scan of a label with
// a white equipment half on the left and a light-blue regulatory half on the
// right; Maserati's own family, so none of the FCA, Ford or GM modules apply
// (Stellantis owns the brand but not the label). Geometry is written in the
// reference's 100 dpi pixels (1700 x 1100) and mapped by X() and Ym(), which
// keeps horizontals and compresses verticals to clear the mandatory banner and
// disclosure.
//
// Every printed value comes from render data. The trident and wordmark are an
// alpha-masked raster extracted from the reference PDF (the PDF holds the whole
// label as a raster scan). The model description paragraph, the importer
// address, the preparation-and-delivery charge, agency seals, the source QR,
// the "Best Sports Car" style advertising and the federal-law statement are not
// reproduced; the 0.90in Vehicle Passport QR takes the Smartphone QR slot.

import type { FactoryStickerData } from "../../types.ts";
import { Painter, formatMoney, type LayoutModel } from "../layout.ts";
import { VARIANT_LOGOS } from "./logoArtwork.ts";
import { INK, PAPER, type VariantLayoutBuilder } from "./shared.ts";
import { R, T, wrap } from "./hyundaiTucsonGas.ts";
import {
  TABLOID_HEIGHT, TABLOID_WIDTH, assembleTabloid, buildSections, colorText, dealerLines, flow, paintPlaced, placedResult,
  priceRowsWithoutColors, toEntries, totalMsrp, warrantySection, yearModelTrim,
  type FirstPageContext, type FirstPageResult, type FlowStyle, type TabloidSpec,
} from "./tabloidCommon.ts";
import {
  PRICE_FOOTNOTE, PX, Q, makeGrid, paintCatalogEpa, paintCatalogParts, paintCatalogSafety, paintPriceLines,
} from "./catalogBlocks.ts";
import { fitSize } from "./fcaCommon.ts";

export const MASERATI_GRANTURISMO_GAS_ID = "maserati_2026_granturismo_trofeo";

const NAVY = "#272f42";
const SKY = "#bdd7ee";
const PALE = "#d8e6f3";
const EQ_STYLE: FlowStyle = { size: 11.2, lh: 12.2, hang: 5, inset: 0 };
const REF_H = 1100;

const X = (px: number): number => px * PX;
type Ym = (px: number) => number;

function bar(p: Painter, x0: number, x1: number, y: number, h: number, label: string, m: Ym): void {
  R(p, X(x0), m(y), X(x1 - x0), m(y + h) - m(y), NAVY);
  T(p, label, X(x0 + 16), m(y) + (m(y + h) - m(y) - 9) / 2, 9, "bold", { color: PAPER });
}

function paintHeader(p: Painter, d: FactoryStickerData, m: Ym): void {
  const logo = VARIANT_LOGOS.maserati;
  const w = 150;
  p.image(logo.png, logo.assetId, X(487) - w / 2, m(40), w, (w * logo.slot.h) / logo.slot.w);
  const v = d.vehicle;
  const model = v.model.toUpperCase();
  if (model) T(p, model, X(487), m(160), fitSize(model, "bold", 20, 300, 12), "bold", { align: "center" });
  R(p, X(80), m(203), X(815), 0.9, INK);
  const y = m(222);
  const ext = colorText(v.exteriorColor, v.exteriorColorCode);
  const int = colorText(v.interiorColor, v.interiorColorCode);
  const room = X(445) - X(180);
  T(p, "Color Exterior", X(80), y + 2, 7.2, "body");
  if (ext) T(p, ext.toUpperCase(), X(180), y, fitSize(ext.toUpperCase(), "bold", 8.6, room - 4, 6), "bold");
  T(p, "Interior", X(455), y + 2, 7.2, "body");
  if (int) T(p, int.toUpperCase(), X(522), y, fitSize(int.toUpperCase(), "bold", 8.6, X(745) - X(522), 6), "bold");
  T(p, "/ MSRP", X(770), y + 2, 7.2, "body");
  const base = d.pricing.baseMsrp;
  T(p, base !== undefined ? formatMoney(base) : "NOT AVAILABLE", X(898), y, base !== undefined ? 8.6 : 6.4, "bold", { align: "right" });

  R(p, X(80), m(281), X(815), m(370) - m(281), SKY);
  const title = yearModelTrim(d, ["year", "model", "trim"], v.make).toUpperCase();
  if (title) T(p, title, X(88), m(286), fitSize(title, "bold", 11.5, X(790), 8), "bold");
  const spec = [v.engine, v.transmission, v.drivetrain].filter((s): s is string => !!s).join("  |  ");
  if (spec) wrap(spec, "body", 8, X(790)).slice(0, 3).forEach((l, i) => T(p, l, X(98), m(312) + i * 10.4, 8, "body"));
}

/** Returns false when the option rows cannot fit. */
function paintOptions(p: Painter, d: FactoryStickerData, m: Ym): boolean {
  bar(p, 632, 895, 397, 26, "Additional Options:", m);
  const rows = priceRowsWithoutColors(d);
  const end = paintPriceLines(p, rows, X(642), X(892), m(436), m(938), { size: 7.4, labelW: X(892) - X(642) - 52, step: 8.2 });
  return end !== null;
}

function paintWarrantyAndTotal(p: Painter, d: FactoryStickerData, m: Ym): void {
  bar(p, 342, 613, 853, 27, "Warranty & Maintenance:", m);
  const w = warrantySection(d, "Warranty");
  let y = m(894);
  for (const item of w ? w.items : ["Warranty terms are not available for this vehicle."]) {
    for (const l of wrap(item, "body", 7.2, X(262))) {
      T(p, l, X(348), y, 7.2, "body");
      y += 8;
    }
  }

  const top = m(955);
  const bottom = m(1050);
  R(p, X(342), top, X(548), bottom - top, null, 1.2);
  R(p, X(630), top, X(262), m(990) - top, NAVY);
  T(p, "Suggested Price (as equipped):", X(642), top + (m(990) - top - 9) / 2, 9, "bold", { color: PAPER });
  const pr = d.pricing;
  const right = X(884);
  const rows: Array<[string, string]> = [["Destination Charges", pr.destinationCharge !== undefined ? formatMoney(pr.destinationCharge) : "NOT AVAILABLE"]];
  if (pr.gasGuzzlerTax !== undefined) rows.push(["Gas Guzzler Tax", formatMoney(pr.gasGuzzlerTax)]);
  rows.forEach(([label, value], i) => {
    const y2 = m(996) + i * 11;
    T(p, label, X(372), y2, 8, "body");
    T(p, value, X(620), y2, value === "NOT AVAILABLE" ? 6.4 : 8, "body", { align: "right" });
  });
  const total = totalMsrp(d);
  const ty = m(1022);
  T(p, "*Total", X(642), ty + 1, 9, "body");
  T(p, total !== undefined ? formatMoney(total) : "NOT AVAILABLE", right, ty, total !== undefined ? 11 : 8, "bold", { align: "right" });
  wrap(PRICE_FOOTNOTE, "body", 6, X(535)).forEach((l, i) => T(p, l, X(348), m(1054) + i * 6.8, 6, "body"));
}

function paintRight(p: Painter, d: FactoryStickerData, input: FirstPageContext["input"], m: Ym): void {
  R(p, X(920), m(0), X(1700) - X(920) - 12, m(1100) - m(0), PALE);
  R(p, X(925), m(58), X(747), m(125) - m(58), SKY);
  R(p, X(925), m(58), X(747), 2.4, NAVY);
  R(p, X(925), m(125) - 2.4, X(747), 2.4, NAVY);
  R(p, X(925), m(58), 2.4, m(125) - m(58), NAVY);
  R(p, X(925) + X(747) - 2.4, m(58), 2.4, m(125) - m(58), NAVY);
  const title = yearModelTrim(d, ["year", "model", "trim"], d.vehicle.make).toUpperCase();
  if (title) T(p, title, X(980), m(91) - 8, fitSize(title, "bold", 18, X(640), 10), "bold");

  const top = m(145);
  const h = m(510) - top;
  R(p, X(925), top, X(260), h, PAPER);
  paintCatalogParts(p, d, X(925), top, X(260), h, 1);
  paintCatalogSafety(p, d, X(1195), top, X(470), Math.min(h, 270));

  const g = makeGrid(m(520), 520, m(520) + 0.7 * 490, 1010);
  paintCatalogEpa(p, d, g, 925, 520);

  const f = d.factory;
  const vy = m(520) + 0.7 * 453 + 4;
  T(p, "V.I.N.:", X(937), vy, 6.4, "body");
  T(p, d.vehicle.vin, X(1010), vy - 1, 8.6, "bold");
  if (f.transportMethod) {
    T(p, "Importation:", X(937), vy + 10, 6.4, "body");
    T(p, f.transportMethod.toUpperCase(), X(1010), vy + 10, 7.4, "body");
  }
  T(p, "Ship to:", X(937), vy + 20, 6.4, "body");
  if (f.dealerCode) T(p, f.dealerCode.toUpperCase(), X(1010), vy + 20, 7.4, "bold");
  dealerLines(d).slice(0, 2).forEach((l, i) => T(p, l, X(1010), vy + 20 + i * 8.4, 7.4, "body"));
  T(p, "Maserati.com", X(1660), m(1037), 13, "bold", { align: "right", color: NAVY });
  if (input.layout.barcodePayload) p.barcode(X(1290), m(1056), X(260), Math.max(14, m(1092) - m(1056)), input.layout.barcodePayload, INK);
}

const spec: TabloidSpec = {
  eqStyle: EQ_STYLE,
  paintFirst(p: Painter, ctx: FirstPageContext): FirstPageResult | null {
    const { d, input } = ctx;
    const top = 28;
    const bottom = ctx.footerTop * 0.612 - 6;
    const m: Ym = (px) => top + px * ((bottom - top) / REF_H);
    R(p, 10, m(0), 1204, m(1100) - m(0), PAPER);
    R(p, 10, m(0), X(42) - 10, m(1100) - m(0), NAVY);
    p.path("M0 0 L18 18 L0 36 Z", X(42), m(225), 18, 36, NAVY);
    if (!paintOptions(p, d, m)) return null;
    paintHeader(p, d, m);
    paintWarrantyAndTotal(p, d, m);
    paintRight(p, d, input, m);
    bar(p, 80, 612, 397, 26, "Exclusive Standard Equipment (unless replaced by options):", m);

    const sections = buildSections(input);
    if (!sections.length) T(p, "Standard equipment not available for this vehicle.", X(88), m(440), 7.4, "body");
    const entries = toEntries(sections, (s) => s.toUpperCase(), 5, undefined, input.equipmentNote);
    const col = (a: number, b: number, y0: number, y1: number) => ({ x: Q(X(a)), w: Q(X(b - a)), top: Q(m(y0)), bottom: Q(m(y1)) });
    const n = 2 + ctx.extraColumns;
    const gap = 10;
    const w = (522 - gap * (n - 1)) / n;
    const wide = Array.from({ length: n }, (_, i) => col(88 + i * (w + gap), 88 + i * (w + gap) + w, 436, i === 0 ? 1060 : 836));
    const { placed, rest } = flow(entries, wide, ctx.style);
    paintPlaced(p, placed, ctx.style, { headingFont: "bold" });
    return placedResult(entries, rest);
  },
};

export const buildMaseratiGranTurismoGasLayout: VariantLayoutBuilder = (input): LayoutModel | null => {
  const model = assembleTabloid(input, spec);
  if (model && (model.width !== TABLOID_WIDTH || model.height !== TABLOID_HEIGHT)) return null;
  return model;
};
