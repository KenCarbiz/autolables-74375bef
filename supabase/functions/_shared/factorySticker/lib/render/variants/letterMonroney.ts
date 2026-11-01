// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/render/variants/letterMonroney.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// Dedicated reproduction layouts for the US Letter reference variants
// (INFINITI 2026 QX60 SPORT AWD, Nissan 2026 Pathfinder Platinum 4WD).
//
// Geometry is translated from the owner's Figma masters (file
// bNby4OyBUWhkHvVTbldgy4, masters 2:12 and 24:167). Those masters are
// drawn at 2x on a 1584 x 1224 canvas, so every coordinate below is
// written in Figma units and halved into PDF points by u(). Figma is the
// design source only; nothing here is fetched at render time.
//
// Rules carried from the handoff:
//   * every value comes from the render data; reference sample text is
//     never a default, and an absent fact omits its line or prints an
//     explicit "not available" state, never a zero
//   * manufacturer logo artwork is not authorized, so the logo slot
//     carries the text wordmark
//   * EPA agency seals and the source QR are not reproduced; the QR slot
//     carries a new Vehicle Passport QR only when a Passport URL exists
//   * the OEM publication/phone footer is omitted until verified per OEM
//   * equipment that does not fit continues onto as many pages as needed,
//     each carrying the reproduction banner and disclosure

import type { FactoryStickerData, StandardEquipmentGroup } from "../../types.ts";
import {
  PAGE_HEIGHT,
  PAGE_WIDTH,
  Painter,
  formatMoney,
  formatPlain,
  measureText,
  validateModel,
  wrapText,
  type LayoutFont,
  type LayoutModel,
  type LayoutPage,
} from "../layout.ts";
import {
  EPA_BLUE,
  INK,
  PAPER,
  baseline,
  box,
  pt,
  pump,
  roundedRectPath,
  scale,
  stars,
  txt,
  u,
  wrapFigma,
  type VariantRenderInput,
} from "./shared.ts";
import {
  PASSPORT_QR_CAPTION,
  REPRODUCTION_BANNER,
  reproductionDisclosureLines,
} from "../../reproduction.ts";

export const LETTER_VARIANT_LAYOUT_VERSION = "1.0.0";



interface SectionSpec {
  id: string;
  heading: string;
  column: 1 | 2;
  /** Matched against the source's equipment-group name, lower-cased. */
  match: RegExp;
}

export interface LetterVariantConfig {
  variantKey: string;
  wordmark: string;
  wordmarkSpacing: number;
  sections: SectionSpec[];
  /** Section that receives groups no other section claims. */
  fallbackSection: string;
  ownershipHeading: string;
}

const MECHANICAL = /mechanical|performance|engine|powertrain|drivetrain|chassis|suspension|functional|towing|capacit/;
const AUDIO = /audio|infotainment|entertainment|technolog|connect|multimedia|navigation/;

export const INFINITI_QX60_CONFIG: LetterVariantConfig = {
  variantKey: "infiniti-2026-qx60-sport-awd",
  wordmark: "INFINITI",
  wordmarkSpacing: 4.2,
  sections: [
    { id: "mechanical", heading: "MECHANICAL AND PERFORMANCE:", column: 1, match: MECHANICAL },
    { id: "driver", heading: "DRIVER ASSISTANCE:", column: 1, match: /driver|assist|adas|propilot/ },
    { id: "comfort", heading: "COMFORT & CONVENIENCE:", column: 1, match: /comfort|convenience|interior|exterior|seat|climate/ },
    { id: "audio", heading: "AUDIO & INFOTAINMENT:", column: 2, match: AUDIO },
    { id: "safety", heading: "SAFETY:", column: 2, match: /safety|security|airbag/ },
  ],
  fallbackSection: "comfort",
  ownershipHeading: "TOTAL OWNERSHIP EXPERIENCE",
};

// Nissan's master inherits INFINITI's slot names positionally: its
// "comfort" slot prints Safety & Security, "driver" prints Comfort &
// Convenience and "safety" prints Exterior (see the binding crosswalk).
export const NISSAN_PATHFINDER_CONFIG: LetterVariantConfig = {
  variantKey: "nissan-2026-pathfinder-platinum-4wd",
  wordmark: "NISSAN",
  wordmarkSpacing: 2.4,
  sections: [
    { id: "mechanical", heading: "MECHANICAL AND PERFORMANCE:", column: 1, match: MECHANICAL },
    { id: "safetySecurity", heading: "SAFETY & SECURITY:", column: 1, match: /safety|security|airbag|driver|assist|adas|propilot/ },
    { id: "exterior", heading: "EXTERIOR:", column: 2, match: /exterior|wheel|body|light|roof|glass|mirror/ },
    { id: "comfortConvenience", heading: "COMFORT & CONVENIENCE:", column: 1, match: /comfort|convenience|interior|seat|climate/ },
    { id: "audio", heading: "AUDIO & INFOTAINMENT:", column: 2, match: AUDIO },
  ],
  fallbackSection: "comfortConvenience",
  ownershipHeading: "NISSAN OWNERSHIP INFORMATION",
};

// Print order inside each column, matching the masters.
const COLUMN_ORDER: Record<string, string[]> = {
  "infiniti-2026-qx60-sport-awd": ["mechanical", "comfort", "driver", "audio", "safety"],
  "nissan-2026-pathfinder-platinum-4wd": ["mechanical", "safetySecurity", "comfortConvenience", "audio", "exterior"],
};

export const LETTER_VARIANT_CONFIGS: Record<string, LetterVariantConfig> = {
  [INFINITI_QX60_CONFIG.variantKey]: INFINITI_QX60_CONFIG,
  [NISSAN_PATHFINDER_CONFIG.variantKey]: NISSAN_PATHFINDER_CONFIG,
};

// ── Geometry (Figma units, absolute on the 1584 x 1224 master) ─────────

const BODY_X = 44;
const BODY_Y = 158;
const BODY_W = 1488;
const COLS_TOP = BODY_Y + 111;
const COL1_X = BODY_X + 10;
const COL1_W = 248;
const COL2_X = BODY_X + 268.5 + 5;
const COL2_W = 246;
const COL_BOTTOM = COLS_TOP + 775 - 8;
const PRICE_X = BODY_X + 526 + 4;
const PRICE_W = 298;
const PRICE_BOTTOM = COLS_TOP + 750;
const RIGHT_X = BODY_X + 836;
const ITEM_PX = 11.4;
const ITEM_LH = 12.2;
const DISCLOSURE_Y = 1100;

interface Section {
  spec: SectionSpec;
  items: string[];
}

function assignSections(
  config: LetterVariantConfig,
  groups: Array<{ hint: string; items: string[] }>,
): Section[] {
  const byId = new Map<string, string[]>();
  const seen = new Set<string>();
  for (const g of groups) {
    const hint = g.hint.toLowerCase();
    const spec = config.sections.find((s) => s.match.test(hint))
      ?? config.sections.find((s) => s.id === config.fallbackSection)!;
    for (const raw of g.items) {
      const item = raw.trim();
      const key = item.toUpperCase();
      if (!item || seen.has(key)) continue;
      seen.add(key);
      const list = byId.get(spec.id) ?? [];
      list.push(item);
      byId.set(spec.id, list);
    }
  }
  return COLUMN_ORDER[config.variantKey]
    .map((id) => config.sections.find((s) => s.id === id)!)
    .filter((spec) => (byId.get(spec.id) ?? []).length > 0)
    .map((spec) => ({ spec, items: byId.get(spec.id)! }));
}

const CATEGORY_HINT: Record<StandardEquipmentGroup["category"], string> = {
  EXTERIOR: "exterior",
  INTERIOR: "interior",
  COMFORT_CONVENIENCE: "comfort convenience",
  FUNCTIONAL: "functional",
  POWERTRAIN: "mechanical",
  SAFETY_SECURITY: "safety",
  TECHNOLOGY: "technology",
  OTHER: "other",
};

/** Lines a flowed equipment entry occupies: heading or wrapped item. */
interface FlowLine {
  text: string;
  font: LayoutFont;
  indent: number;
  gapBefore: number;
  heading: boolean;
}

function flowLines(sections: Section[], width: number): Array<{ column: 1 | 2; lines: FlowLine[] }> {
  const size = pt(ITEM_PX);
  return sections.map((s, si) => {
    const lines: FlowLine[] = [{
      text: s.spec.heading, font: "bold", indent: 0, gapBefore: si === 0 ? 0 : 12, heading: true,
    }];
    for (const item of s.items) {
      const wrapped = wrapText(item, "body", size, u(width - 8));
      wrapped.forEach((text, i) => lines.push({ text, font: "body", indent: i === 0 ? 0 : 8, gapBefore: 0, heading: false }));
    }
    return { column: s.spec.column, lines };
  });
}

interface PlacedLine extends FlowLine {
  x: number;
  top: number;
}

/**
 * Places section lines into the two equipment columns. Column 2 sections
 * start at their master position; if column 1 overflows, its remainder
 * runs into column 2 ahead of them. Anything left continues on later pages.
 */
function placeEquipment(blocks: Array<{ column: 1 | 2; lines: FlowLine[] }>): { placed: PlacedLine[]; rest: FlowLine[] } {
  const placed: PlacedLine[] = [];
  const cols = [
    { x: COL1_X, top: COLS_TOP + 109, w: COL1_W },
    { x: COL2_X, top: COLS_TOP + 98, w: COL2_W },
  ];
  let col = 0;
  let y = cols[0].top;
  const queue: FlowLine[] = [];
  let firstCol2 = blocks.findIndex((b) => b.column === 2);
  if (firstCol2 < 0) firstCol2 = blocks.length;
  blocks.forEach((b, i) => {
    if (i === firstCol2) queue.push({ text: "", font: "body", indent: 0, gapBefore: 0, heading: false });
    queue.push(...b.lines);
  });
  let i = 0;
  while (i < queue.length) {
    const line = queue[i];
    if (line.text === "") {
      if (col === 0) { col = 1; y = cols[1].top; }
      i++;
      continue;
    }
    const gap = y === cols[col].top ? 0 : line.gapBefore;
    // Keep a heading with its first item.
    const need = gap + ITEM_LH * (line.heading ? 2 : 1);
    if (y + need > COL_BOTTOM) {
      if (col === 0) { col = 1; y = cols[1].top; continue; }
      break;
    }
    y += gap;
    placed.push({ ...line, x: cols[col].x + line.indent, top: y });
    y += ITEM_LH;
    i++;
  }
  const rest = queue.slice(i).filter((l) => l.text !== "");
  return { placed, rest };
}

// ── Painting helpers ──────────────────────────────────────────────────






// ── Sections ──────────────────────────────────────────────────────────

function paintBanner(p: Painter, pageLabel: string): void {
  box(p, BODY_X, 111, BODY_W, 31, null, 2);
  txt(p, REPRODUCTION_BANNER, BODY_X + 11, 115, 23, "bold");
  txt(p, pageLabel, BODY_X + BODY_W - 11, 119, 13, "bold", { align: "right" });
}

function disclosureHeight(lines: string[]): number {
  let n = 0;
  for (const para of lines) n += wrapFigma(para, "body", 15, BODY_W).length;
  return 28 + n * 17;
}

function titleLines(d: FactoryStickerData, displayMake: string): [string, string] {
  const v = d.vehicle;
  const first = [v.year > 0 ? String(v.year) : "", displayMake, v.model].filter(Boolean).join(" ");
  const second = [v.trim ?? "", v.drivetrain ?? ""].filter(Boolean).join(" ").toUpperCase();
  return [first, second];
}

function paintHeader(p: Painter, d: FactoryStickerData, config: LetterVariantConfig, displayMake: string): void {
  const markSize = 18;
  const markW = measureText(config.wordmark, "bold", pt(markSize), config.wordmarkSpacing);
  p.text(config.wordmark, u(BODY_X + 85) - markW / 2, u(baseline(BODY_Y + 28, markSize)), pt(markSize), "bold", INK, {
    charSpacing: config.wordmarkSpacing,
  });
  const [l1, l2] = titleLines(d, displayMake);
  txt(p, l1, BODY_X + 182 + 275, BODY_Y + 18.5, 30, "bold", { align: "center", lh: 35 });
  if (l2) txt(p, l2, BODY_X + 182 + 275, BODY_Y + 18.5 + 35, 30, "bold", { align: "center", lh: 35 });
  box(p, BODY_X, BODY_Y + 108, 834, 3, INK);
}

function paintEquipment(p: Painter, placed: PlacedLine[]): void {
  box(p, BODY_X + 267, COLS_TOP, 1.5, 775, INK);
  box(p, BODY_X + 524.5, COLS_TOP, 1.5, 805, INK);
  txt(p, "Standard Equipment Included at No Extra Charge", COL1_X, COLS_TOP + 76, 11, "body", { lh: ITEM_LH });
  for (const line of placed) {
    txt(p, line.text, line.x, line.top, ITEM_PX, line.font, { lh: ITEM_LH });
  }
}

interface PriceRow {
  label: string[];
  amount: string | null;
  bold: boolean;
  contents: string[];
}

function priceAmount(price: number | undefined, status: string): string | null {
  if (status === "INCLUDED") return "INCLUDED";
  if (status === "NO_CHARGE") return "NO CHARGE";
  if (price === undefined) return "N/A";
  return formatPlain(price);
}

/** Returns false when the pricing column cannot hold every row. */
function paintPricing(p: Painter | null, d: FactoryStickerData): boolean {
  const eq = d.equipment;
  const pr = d.pricing;
  const rows: PriceRow[] = [
    ...eq.packages.map((k) => ({
      label: [k.code ? `${k.name}` : k.name], amount: priceAmount(k.price, k.priceStatus), bold: true, contents: k.features,
    })),
    ...eq.options.map((o) => ({
      label: [o.name], amount: priceAmount(o.price, o.priceStatus), bold: true, contents: o.features ?? [],
    })),
    ...(eq.portInstalled ?? []).map((o) => ({
      label: [o.name], amount: priceAmount(o.price, o.priceStatus), bold: true, contents: [],
    })),
  ];
  let top = COLS_TOP + 11;
  const amountX = PRICE_X + PRICE_W;
  const labelW = 236;
  const size = ITEM_PX;
  const draw = (s: string, x: number, t: number, font: LayoutFont, align?: "right"): void => {
    if (p) txt(p, s, x, t, size, font, { lh: ITEM_LH, ...(align ? { align } : {}) });
  };

  draw("Manufacturer's Suggested", PRICE_X, top, "bold");
  draw(pr.baseMsrp !== undefined ? formatMoney(pr.baseMsrp) : "NOT AVAILABLE", amountX, top, "bold", "right");
  top += ITEM_LH;
  draw("Retail Base Price:", PRICE_X, top, "bold");
  top += ITEM_LH + 16;

  if (rows.length) {
    draw("Options Included by Manufacturer", PRICE_X, top, "bold");
    top += ITEM_LH;
    for (const r of rows) {
      const wrapped = wrapFigma(r.label.join(" "), "bold", size, labelW);
      wrapped.forEach((line, i) => {
        draw(line, PRICE_X, top, "bold");
        if (i === 0 && r.amount) draw(r.amount, amountX, top, "bold", "right");
        top += ITEM_LH;
      });
      for (const c of r.contents) {
        for (const line of wrapFigma(c, "body", 11, labelW - 10)) {
          if (p) txt(p, line, PRICE_X + 10, top, 11, "body", { lh: 11.8 });
          top += 11.8;
        }
      }
    }
  }
  top += 8;
  if (p) box(p, PRICE_X, top, PRICE_W, 1, INK);
  top += 13;
  draw("DESTINATION CHARGES", PRICE_X, top, "body");
  draw(pr.destinationCharge !== undefined ? formatPlain(pr.destinationCharge) : "NOT AVAILABLE", amountX, top, "body", "right");
  top += ITEM_LH + 11;
  if (p) box(p, PRICE_X, top, PRICE_W, 1, INK);
  top += 20;
  const total = pr.sourceReportedTotalMsrp ?? pr.calculatedTotalMsrp;
  draw("Total*", PRICE_X, top, "bold");
  draw(total !== undefined ? formatMoney(total) : "NOT AVAILABLE", amountX, top, "bold", "right");
  top += ITEM_LH + 6;
  if (p) {
    for (const line of wrapFigma("*Total of the original manufacturer's suggested retail prices shown. Excludes taxes, title, license, dealer-installed items and current selling price.", "body", 10, PRICE_W)) {
      txt(p, line, PRICE_X, top, 10, "body", { lh: 11.5 });
      top += 11.5;
    }
  }
  return top <= PRICE_BOTTOM;
}

function paintEpa(p: Painter, d: FactoryStickerData): void {
  const r = d.regulatory;
  const X = RIGHT_X;
  const Y = BODY_Y;
  box(p, X, Y, 650, 418, PAPER, 4);
  box(p, X + 4, Y + 4, 642, 40, INK);
  txt(p, "EPA", X + 4, Y + 8, 16, "bold", { color: PAPER, lh: 16 });
  txt(p, "DOT", X + 4, Y + 24, 16, "bold", { color: PAPER, lh: 16 });
  txt(p, "Fuel Economy and Environment", X + 47, Y + 12, 21, "bold", { color: PAPER });
  box(p, X + 435, Y + 8, 211, 32, EPA_BLUE);
  pump(p, X + 440, Y + 9, 30, INK);
  txt(p, "Gasoline Vehicle", X + 435 + 208, Y + 17, 13, "bold", { align: "right" });

  if (r.epaStatus !== "VERIFIED" || r.combinedMpg === undefined) {
    for (const [i, line] of wrapFigma(
      "Fuel economy and environment information is not available from verified EPA records for this exact configuration.",
      "bold", 16, 560,
    ).entries()) {
      txt(p, line, X + 44, Y + 80 + i * 20, 16, "bold", { lh: 20 });
    }
    paintEpaFooter(p, d.document.passportUrl.trim());
    return;
  }

  pump(p, X + 7, Y + 77, 38, INK);
  txt(p, "Fuel Economy", X + 42, Y + 52, 14, "bold");
  txt(p, String(Math.round(r.combinedMpg)), X + 42, Y + 76, 86, "bold");
  txt(p, "MPG", X + 157, Y + 68, 28, "bold");
  if (r.cityMpg !== undefined) {
    txt(p, String(Math.round(r.cityMpg)), X + 157, Y + 118, 23, "bold");
    txt(p, "city", X + 160, Y + 160, 11, "body");
  }
  if (r.highwayMpg !== undefined) {
    txt(p, String(Math.round(r.highwayMpg)), X + 205, Y + 118, 23, "bold");
    txt(p, "highway", X + 202, Y + 160, 11, "body");
  }
  txt(p, "combined city/hwy", X + 42, Y + 169, 11, "body");
  const gallons = r.gallonsPer100Miles ?? (r.combinedMpg > 0 ? 100 / r.combinedMpg : undefined);
  if (gallons !== undefined) txt(p, `${gallons.toFixed(1)} gallons per 100 miles`, X + 42, Y + 182, 22, "bold", { lh: 24 });

  const delta = r.fiveYearCostDifference;
  if (delta !== undefined && delta !== 0) {
    const saves = delta > 0;
    txt(p, saves ? "You save" : "You spend", X + 434, Y + 52, 25, "bold");
    txt(p, formatMoney(Math.abs(delta)).replace(/\.00$/, ""), X + 434, Y + 84, 44, "bold");
    const tail = saves
      ? ["in fuel costs", "over 5 years", "compared to the", "average new vehicle."]
      : ["more in fuel costs", "over 5 years", "compared to the", "average new vehicle."];
    tail.forEach((line, i) => txt(p, line, X + 434, Y + 131 + i * 17, 16, "bold", { lh: 17 }));
  }

  box(p, X + 4, Y + 211, 636, 4, INK);
  if (r.annualFuelCost !== undefined) {
    const b = { x: X + 10, y: Y + 219 };
    p.path(roundedRectPath(u(178), u(96), u(10)), u(b.x), u(b.y), u(178), u(96), null, INK, u(4));
    txt(p, "Annual fuel cost", b.x + 10, b.y + 8, 20, "bold");
    txt(p, formatMoney(r.annualFuelCost).replace(/\.00$/, ""), b.x + 10, b.y + 32, 45, "bold");
  }
  const rx = X + 198;
  const ry = Y + 219;
  const hasGhg = r.greenhouseGasRating !== undefined && r.greenhouseGasRating > 0;
  const hasSmog = r.smogRating !== undefined && r.smogRating > 0;
  if (hasGhg) {
    txt(p, "Fuel Economy & Greenhouse Gas Rating", rx, ry, 12, "bold");
    txt(p, String(r.greenhouseGasRating), rx, ry + 16, 22, "bold");
    scale(p, rx, ry + 42, 282);
  }
  if (hasSmog) {
    txt(p, "Smog Rating", rx + 294, ry, 12, "bold");
    txt(p, String(r.smogRating), rx + 294, ry + 16, 22, "bold");
    scale(p, rx + 294, ry + 42, 146);
  }
  paintEpaFooter(p, d.document.passportUrl.trim());
}



function paintEpaFooter(p: Painter, passportUrl: string): void {
  const X = RIGHT_X + 4;
  const Y = BODY_Y + 319;
  box(p, X, Y, 642, 95, INK);
  const note = "Actual results will vary for many reasons, including driving conditions and how you drive and maintain your vehicle. Cost estimates are current EPA estimates and may differ from those printed on the original label.";
  wrapFigma(note, "bold", 10.4, 500).forEach((line, i) => txt(p, line, X + 6, Y + 4 + i * 11, 10.4, "bold", { color: PAPER, lh: 11 }));
  txt(p, "fueleconomy.gov", X + 6, Y + 40, 27, "bold", { color: PAPER });
  txt(p, "Calculate personalized estimates and compare vehicles", X + 6, Y + 72, 10.4, "body", { color: PAPER });
  if (passportUrl) {
    const slotX = X + 512;
    box(p, slotX, Y, 130, 95, PAPER);
    txt(p, "VEHICLE PASSPORT", slotX + 65, Y + 3, 10.4, "bold", { align: "center" });
    const qr = 64;
    p.qr(u(slotX + 65 - qr / 2), u(Y + 16), u(qr), passportUrl, INK);
    txt(p, PASSPORT_QR_CAPTION, slotX + 65, Y + 82, 10.4, "body", { align: "center" });
  }
}

function paintSafety(p: Painter, d: FactoryStickerData): void {
  const r = d.regulatory;
  const X = RIGHT_X;
  const Y = BODY_Y + 421;
  box(p, X, Y, 423, 322, PAPER, 4);
  box(p, X + 8, Y + 4, 409, 21, INK);
  txt(p, "GOVERNMENT 5-STAR SAFETY RATINGS", X + 14, Y + 6, 16, "bold", { color: PAPER });
  const value = (n: number | undefined): number | string => {
    if (r.nhtsaStatus === "UNAVAILABLE") return "Not Available";
    if (r.nhtsaStatus === "NOT_RATED" || n === undefined || n <= 0) return "Not Rated";
    return Math.min(5, Math.round(n));
  };
  const cell = (v: number | string, top: number): void => {
    if (typeof v === "number") stars(p, X + 222, top + 1, v);
    else txt(p, v, X + 222, top, 15, "bold");
  };
  const S = X + 8;
  txt(p, "Overall Vehicle Score", S, Y + 30, 18, "bold");
  cell(value(r.overallRating), Y + 30);
  txt(p, "Based on the combined ratings of frontal, side and rollover.", S, Y + 52, 10.4, "body", { lh: 11 });
  txt(p, "Compare only to vehicles of similar size and weight.", S, Y + 63, 10.4, "body", { lh: 11 });
  box(p, S, Y + 78, 405, 3, INK);
  txt(p, "Frontal Crash", S, Y + 86, 17, "bold");
  txt(p, "Driver", X + 214 - 10, Y + 86, 17, "bold", { align: "right" });
  cell(value(r.frontalDriverRating), Y + 86);
  txt(p, "Passenger", X + 214 - 10, Y + 104, 17, "bold", { align: "right" });
  cell(value(r.frontalPassengerRating), Y + 104);
  txt(p, "Based on the risk of injury in a frontal impact.", S, Y + 125, 10.4, "body");
  box(p, S, Y + 140, 405, 3, INK);
  txt(p, "Side Crash", S, Y + 148, 17, "bold");
  txt(p, "Front seat", X + 214 - 10, Y + 148, 17, "bold", { align: "right" });
  cell(value(r.sideFrontRating), Y + 148);
  txt(p, "Rear seat", X + 214 - 10, Y + 166, 17, "bold", { align: "right" });
  cell(value(r.sideRearRating), Y + 166);
  txt(p, "Based on the risk of injury in a side impact.", S, Y + 187, 10.4, "body");
  box(p, S, Y + 202, 405, 3, INK);
  txt(p, "Rollover", S, Y + 210, 17, "bold");
  cell(value(r.rolloverRating), Y + 210);
  box(p, X + 8, Y + 246, 407, 62, INK);
  [
    "Star ratings range from 1 to 5; 5 is highest.",
    "Source: National Highway Traffic Safety Administration",
    "www.nhtsa.gov/ratings",
  ].forEach((line, i) => txt(p, line, X + 8 + 203, Y + 250 + i * 17, 13, "bold", { align: "center", color: PAPER, lh: 17 }));
}

function paintOrigin(p: Painter, d: FactoryStickerData): void {
  const X = RIGHT_X + 426;
  const Y = BODY_Y + 421;
  box(p, X, Y, 224, 322, PAPER, 4);
  const cx = X + 112;
  const entries = (d.factory.partsContent ?? []).filter((e) => e.sourceVerified);
  const origin = (re: RegExp) => entries.find((e) => re.test(e.label.toLowerCase()));
  const usCan = origin(/u\.?s\.?.*canad|domestic|us\/canadian/);
  const engine = origin(/engine/);
  const trans = origin(/transmission/);
  const other = entries.filter((e) => e !== usCan && e !== engine && e !== trans && !/assembly/i.test(e.label));
  let top = Y + 12;
  const line = (s: string, sizePx: number, step: number): void => {
    for (const l of wrapFigma(s.toUpperCase(), "bold", sizePx, 206)) {
      txt(p, l, cx, top, sizePx, "bold", { align: "center" });
      top += step;
    }
  };
  if (usCan || other.length) {
    line("PARTS CONTENT INFORMATION", 12.6, 15.5);
    line("FOR VEHICLES IN THIS CARLINE:", 12.6, 15.5);
    if (usCan) line(`U.S./CANADIAN PARTS CONTENT: ${usCan.value}`, 12.6, 15.5);
    for (const e of other) line(`${e.label}: ${e.value}`, 12, 14);
    top += 8;
    for (const l of ["NOTE: PARTS CONTENT DOES NOT", "INCLUDE FINAL ASSEMBLY,", "DISTRIBUTION, OR OTHER", "NON-PARTS COSTS."]) {
      txt(p, l, cx, top, 11, "bold", { align: "center" });
      top += 12;
    }
    top += 14;
  }
  const assembly = d.factory.finalAssemblyPoint;
  if (assembly || engine || trans) {
    line("FOR THIS VEHICLE:", 12.6, 15.5);
    if (assembly) {
      line("FINAL ASSEMBLY POINT:", 12.6, 15.5);
      line(assembly, 12.6, 15.5);
    }
    if (engine || trans) {
      line("COUNTRY OF ORIGIN:", 12.6, 15.5);
      if (engine) line(`ENGINE: ${engine.value}`, 12.6, 15.5);
      if (trans) line(`TRANSMISSION: ${trans.value}`, 12.6, 15.5);
    }
  }
}

function paintOwnership(p: Painter, d: FactoryStickerData, config: LetterVariantConfig): void {
  const w = d.warranty;
  const lines = w && w.sourceVerified
    ? [w.basic, w.powertrain, w.corrosion, w.roadside, w.emissions].filter((s): s is string => !!s)
    : [];
  const X = RIGHT_X;
  const Y = BODY_Y + 746;
  if (!lines.length) return;
  box(p, X, Y, 332, 177, PAPER, 4);
  txt(p, config.ownershipHeading, X + 11, Y + 10, 17, "bold");
  let top = Y + 33;
  for (const s of lines) {
    for (const l of wrapFigma(s, "body", 10.4, 314)) {
      if (top > Y + 120) break;
      txt(p, l, X + 11, top, 10.4, "body", { lh: 11 });
      top += 11;
    }
  }
  top += 6;
  for (const l of wrapFigma("Original new-vehicle terms shown; this does not state coverage remaining. Eligibility, exclusions and in-service date must be verified.", "body", 10.4, 314)) {
    txt(p, l, X + 11, top, 10.4, "body", { lh: 11 });
    top += 11;
  }
}

function paintIdentity(p: Painter, d: FactoryStickerData): void {
  const X = RIGHT_X + 338;
  const Y = BODY_Y + 746;
  const dealer = d.dealer;
  let top = Y;
  if (dealer.name) {
    const parts = [dealer.name, dealer.address, [dealer.city, dealer.state, dealer.postalCode].filter(Boolean).join(" ")]
      .filter((s): s is string => !!s && !!s.trim());
    for (const s of parts) {
      txt(p, s.toUpperCase(), X, top, 11, "body");
      top += 12;
    }
  }
  top = Math.max(top + 4, Y + 43);
  txt(p, `VIN:  ${d.vehicle.vin}`, X, top, 15, "bold");
  top += 22;
  const v = d.vehicle;
  const color = (label: string, name?: string, code?: string): string | null =>
    name ? `${label}: ${name.toUpperCase()}${code ? ` (${code})` : ""}` : null;
  const config = [
    color("EXT", v.exteriorColor, v.exteriorColorCode),
    color("INT", v.interiorColor, v.interiorColorCode),
    d.factory.emissionsCode ? `EMS: ${d.factory.emissionsCode}` : null,
    d.factory.transportMethod ? `Transport Method: ${d.factory.transportMethod}` : null,
  ].filter((s): s is string => !!s);
  for (const s of config) {
    for (const l of wrapFigma(s, "body", 10.4, 300)) {
      txt(p, l, X, top, 10.4, "body", { lh: 11 });
      top += 11;
    }
  }
}

function paintContinuation(
  p: Painter, d: FactoryStickerData, displayMake: string, lines: FlowLine[], bottom: number,
): FlowLine[] {
  const [l1, l2] = titleLines(d, displayMake);
  txt(p, `${l1} ${l2}`.trim().toUpperCase(), BODY_X, BODY_Y, 22, "bold");
  txt(p, `VIN: ${d.vehicle.vin}`, BODY_X + BODY_W, BODY_Y + 4, 15, "bold", { align: "right" });
  box(p, BODY_X, BODY_Y + 30, BODY_W, 3, INK);
  txt(p, "STANDARD EQUIPMENT CONTINUED", BODY_X, BODY_Y + 42, 16, "bold");
  txt(p, `Continuation of the reproduction window sticker for VIN ${d.vehicle.vin}. This page belongs to the sticker on page 1 and is not valid on its own.`, BODY_X, BODY_Y + 62, 11, "body");
  const colW = (BODY_W - 3 * 24) / 4;
  let col = 0;
  let y = BODY_Y + 86;
  let i = 0;
  while (i < lines.length && col < 4) {
    const line = lines[i];
    const gap = y === BODY_Y + 86 ? 0 : line.gapBefore;
    if (y + gap + ITEM_LH * (line.heading ? 2 : 1) > bottom) {
      col++;
      y = BODY_Y + 86;
      continue;
    }
    y += gap;
    txt(p, line.text, BODY_X + col * (colW + 24) + line.indent, y, ITEM_PX, line.font, { lh: ITEM_LH });
    y += ITEM_LH;
    i++;
  }
  return lines.slice(i);
}


/**
 * Builds the dedicated reference layout, or returns null when the content
 * cannot be represented faithfully (for example a price list longer than
 * the pricing column), so the caller falls back to the generic layout.
 */
export function buildLetterVariantLayout(
  variantKey: string,
  input: VariantRenderInput,
): LayoutModel | null {
  const config = LETTER_VARIANT_CONFIGS[variantKey];
  if (!config) return null;
  const d = input.layout.data;
  if (!paintPricing(null, d)) return null;

  const groups = input.equipmentGroups.length
    ? input.equipmentGroups
    : d.equipment.standard.map((g) => ({ hint: CATEGORY_HINT[g.category], items: g.items }));
  const sections = assignSections(config, groups);
  const { placed, rest } = placeEquipment(flowLines(sections, COL1_W));
  const disclosure = [...reproductionDisclosureLines(input.layout.factoryBuild), ...input.layout.disclaimers];
  const footerTop = Math.min(DISCLOSURE_Y, 1224 - 18 - disclosureHeight(disclosure));

  // Plan continuation pages first so every page can say "PAGE n OF m".
  const contBottom = footerTop - 12;
  const plan: FlowLine[][] = [];
  let remaining = rest;
  while (remaining.length) {
    const before = remaining.length;
    const next = paintContinuation(new Painter(null), d, input.displayMake, remaining, contBottom);
    if (next.length === before) throw new Error("layout_failed: continuation entry cannot fit an empty page");
    plan.push(remaining.slice(0, before - next.length));
    remaining = next;
  }
  const pageCount = plan.length + 1;

  const drawn: string[] = [];
  const p = new Painter(drawn);
  paintBanner(p, pageCount > 1 ? `PAGE 1 OF ${pageCount} - EQUIPMENT CONTINUED ON PAGE 2` : "PAGE 1 OF 1");
  paintHeader(p, d, config, input.displayMake);
  paintEquipment(p, placed);
  paintPricing(p, d);
  paintEpa(p, d);
  paintSafety(p, d);
  paintOrigin(p, d);
  paintOwnership(p, d, config);
  paintIdentity(p, d);
  paintDisclosureAt(p, disclosure, footerTop);

  const pages: LayoutPage[] = [{ primitives: p.primitives }];
  plan.forEach((lines, i) => {
    const cp = new Painter(drawn);
    const label = `PAGE ${i + 2} OF ${pageCount}`;
    paintBanner(cp, label);
    paintContinuation(cp, d, input.displayMake, lines, contBottom);
    paintDisclosureAt(cp, disclosure, footerTop);
    pages.push({ primitives: cp.primitives });
  });

  const model: LayoutModel = {
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT,
    mode: pages.length > 1 ? "CONTINUATION_REQUIRED" : "STANDARD",
    pages,
    drawnStrings: drawn,
    fontFamilies: { heading: "Helvetica-Bold", body: "Helvetica", numeric: "Courier" },
  };
  validateModel(model);
  return model;
}

function paintDisclosureAt(p: Painter, lines: string[], top: number): void {
  txt(p, REPRODUCTION_BANNER, BODY_X, top, 23, "bold");
  let y = top + 28;
  for (const para of lines) {
    for (const line of wrapFigma(para, "body", 15, BODY_W)) {
      txt(p, line, BODY_X, y, 15, "body", { lh: 17 });
      y += 17;
    }
  }
}

