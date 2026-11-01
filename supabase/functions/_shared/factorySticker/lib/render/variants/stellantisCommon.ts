// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/render/variants/stellantisCommon.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// Shared drawing for the Stellantis 17 x 11 plug-in hybrid reproduction
// layouts (Jeep 2024 Grand Cherokee 4xe, Chrysler 2024 Pacifica Select PHEV).
//
// Geometry is translated from the owner's Figma masters (file
// bNby4OyBUWhkHvVTbldgy4, masters 25:3070 and 25:4667), drawn at 2x on a
// 2448 x 1584 canvas. Coordinates below are "inner" Figma units: relative to
// the masters' label frame, which sits at (INNER_X, INNER_Y) on the canvas.
//
// Handoff rules carried here:
//   * every value comes from the render data; the review sample text is
//     never a default, and an absent fact omits its line or prints an
//     explicit "not available" state, never a zero
//   * manufacturer logo artwork, agency seals, the Mopar advertisement and
//     the source QR are not reproduced; the OEM phone/website, legal-entity
//     line, VON, ship-to/sold-to and barcode are omitted as unverified or
//     source-only
//   * the EPA PHEV values the data model lacks (kWh per 100 miles, charge
//     time, total driving range, second CO2 score) are omitted, never invented
//   * equipment that does not fit continues onto further pages, each with the
//     reproduction banner and disclosure

import type { FactoryStickerData, StandardEquipmentGroup } from "../../types.ts";
import {
  Painter,
  formatMoney,
  formatPlain,
  measureText,
  starPath,
  validateModel,
  type LayoutFont,
  type LayoutModel,
  type LayoutPage,
} from "../layout.ts";
import { INK, PAPER, pt, roundedRectPath, txt, u, wrapFigma, type VariantRenderInput } from "./shared.ts";
import {
  PASSPORT_QR_CAPTION,
  REPRODUCTION_BANNER,
  reproductionDisclosureLines,
} from "../../reproduction.ts";

export const STELLANTIS_PHEV_LAYOUT_VERSION = "1.0.0";

export const CANVAS_W = 2448;
export const CANVAS_H = 1584;
export const INNER_X = 162.27;
export const INNER_Y = 58;

export interface StellantisVariantConfig {
  variantKey: string;
  frameColor: string;
  /** Paints the logo wordmark and model-year/model title block. */
  paintHeader: (p: Painter, d: FactoryStickerData, displayMake: string) => void;
  /** First bold line of the vehicle spec block. */
  specTitle: (d: FactoryStickerData, displayMake: string) => string;
}

// ── Inner-coordinate drawing helpers ───────────────────────────────────

export function T(
  p: Painter, s: string, x: number, y: number, size: number, font: LayoutFont,
  opts: { align?: "left" | "right" | "center"; color?: string; lh?: number; spacing?: number } = {},
): void {
  const { spacing, ...rest } = opts;
  txt(p, s, x + INNER_X, y + INNER_Y, size, font, { lh: size, ...rest, ...(spacing ? { spacing: spacing / 2 } : {}) });
}

/** Letter-spaced text wordmark stretched to a target width (Figma units). */
export function wordmark(p: Painter, s: string, x: number, y: number, sizePx: number, targetW: number): void {
  const base = measureText(s, "bold", pt(sizePx));
  const spacing = s.length > 1 ? Math.max(0, (targetW / 2 - base) / (s.length - 1)) : 0;
  p.text(s, u(x + INNER_X), u(y + INNER_Y + sizePx * 0.8465), pt(sizePx), "bold", INK, spacing ? { charSpacing: spacing } : {});
}

export function R(p: Painter, x: number, y: number, w: number, h: number, fill: string | null, strokePx?: number): void {
  const X = x + INNER_X;
  const Y = y + INNER_Y;
  if (strokePx) {
    const s = u(strokePx);
    p.rect(u(X) + s / 2, u(Y) + s / 2, u(w) - s, u(h) - s, fill, INK, s);
  } else {
    p.rect(u(X), u(Y), u(w), u(h), fill);
  }
}

/** Rounded rectangle; a stroke is drawn inside the given bounds. */
export function RR(
  p: Painter, x: number, y: number, w: number, h: number, r: number, fill: string | null, strokePx?: number,
): void {
  const s = strokePx ? u(strokePx) : 0;
  const wp = u(w) - s;
  const hp = u(h) - s;
  p.path(
    roundedRectPath(wp, hp, Math.min(u(r), wp / 2, hp / 2)),
    u(x + INNER_X) + s / 2, u(y + INNER_Y) + s / 2, wp, hp, fill, strokePx ? INK : undefined, strokePx ? s : undefined,
  );
}

export function poly(p: Painter, x: number, y: number, pts: Array<[number, number]>, fill: string | null, strokePx?: number): void {
  const xs = pts.map((q) => q[0]);
  const ys = pts.map((q) => q[1]);
  const w = Math.max(...xs);
  const h = Math.max(...ys);
  const d = `${pts.map((q, i) => `${i ? "L" : "M"}${u(q[0])} ${u(q[1])}`).join(" ")} Z`;
  p.path(d, u(x + INNER_X), u(y + INNER_Y), u(w), u(h), fill, strokePx ? INK : undefined, strokePx ? u(strokePx) : undefined);
}

export function widthFig(s: string, font: LayoutFont, sizePx: number, spacing = 0): number {
  return measureText(s, font, pt(sizePx), spacing) * 2;
}

/** Shrinks a font size so the string fits maxW; the floor is pt()'s minimum. */
export function fitSize(s: string, font: LayoutFont, sizePx: number, maxW: number, minRatio = 0.55): number {
  const w = widthFig(s, font, sizePx);
  if (w <= maxW) return sizePx;
  return Math.max(sizePx * minRatio, (sizePx * maxW) / w);
}

export function Tfit(
  p: Painter, s: string, x: number, y: number, size: number, font: LayoutFont, maxW: number,
  opts: { align?: "left" | "right" | "center"; color?: string; spacing?: number } = {},
): void {
  T(p, s, x, y, fitSize(s, font, size, maxW), font, opts);
}

const money0 = (n: number): string => formatMoney(n).replace(/\.00$/, "");

// ── Equipment sections ─────────────────────────────────────────────────

interface FlowLine {
  text: string;
  font: LayoutFont;
  indent: number;
  heading: boolean;
}

const SECTION_ORDER = ["functional", "interior", "exterior"] as const;
type SectionId = (typeof SECTION_ORDER)[number];
const SECTION_HEADING: Record<SectionId, string> = {
  functional: "FUNCTIONAL/SAFETY FEATURES",
  interior: "INTERIOR FEATURES",
  exterior: "EXTERIOR FEATURES",
};
const EXTERIOR_RE = /exterior|wheel|body|light|roof|glass|mirror/;
const FUNCTIONAL_RE = /mechanical|performance|engine|powertrain|drivetrain|chassis|suspension|functional|safety|security|airbag|driver|assist|adas|towing|capacit/;

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

function sectionFor(hint: string): SectionId {
  const h = hint.toLowerCase();
  if (EXTERIOR_RE.test(h)) return "exterior";
  if (FUNCTIONAL_RE.test(h)) return "functional";
  return "interior";
}

function assignSections(groups: Array<{ hint: string; items: string[] }>): Array<{ id: SectionId; items: string[] }> {
  const byId = new Map<SectionId, string[]>();
  const seen = new Set<string>();
  for (const g of groups) {
    const id = sectionFor(g.hint);
    for (const raw of g.items) {
      const item = raw.trim();
      const key = item.toUpperCase();
      if (!item || seen.has(key)) continue;
      seen.add(key);
      byId.set(id, [...(byId.get(id) ?? []), item]);
    }
  }
  return SECTION_ORDER.filter((id) => (byId.get(id) ?? []).length > 0).map((id) => ({ id, items: byId.get(id)! }));
}

const ITEM_PX = 15.614;
const HEAD_INDENT = 62.45;
const COL1_X = 106.07;
const COL1_W = 440;
const COL2_X = 598.57;
const COL2_W = 420;
const COL2_TOP = 243.35;
const COL_BOTTOM = 1160.5;
const PITCHES = [20.99, 19.24, 17.49];

function flowLines(sections: Array<{ id: SectionId; items: string[] }>, width: number): FlowLine[] {
  const lines: FlowLine[] = [];
  for (const s of sections) {
    lines.push({ text: SECTION_HEADING[s.id], font: "body", indent: HEAD_INDENT, heading: true });
    for (const item of s.items) {
      wrapFigma(item, "body", ITEM_PX, width).forEach((text, i) =>
        lines.push({ text, font: "body", indent: i === 0 ? 0 : 10, heading: false }));
    }
  }
  return lines;
}

interface PlacedLine extends FlowLine {
  x: number;
  top: number;
}

/** Column 1 then column 2; a heading never ends a column. */
function placeStd(
  lines: FlowLine[], pitch: number, col1Top: number, col2Limit: number,
): { placed: PlacedLine[]; rest: FlowLine[]; col2End: number } {
  const placed: PlacedLine[] = [];
  const cols = [
    { x: COL1_X, top: col1Top, bottom: COL_BOTTOM },
    { x: COL2_X, top: COL2_TOP, bottom: col2Limit },
  ];
  let col = 0;
  let y = cols[0].top;
  let i = 0;
  let col2End = COL2_TOP;
  while (i < lines.length) {
    const line = lines[i];
    const need = pitch * (line.heading ? 2 : 1) - (pitch - ITEM_PX * 1.3);
    if (y + need > cols[col].bottom) {
      if (col === 0) { col = 1; y = cols[1].top; continue; }
      break;
    }
    placed.push({ ...line, x: cols[col].x + line.indent, top: y });
    y += pitch;
    if (col === 1) col2End = y - pitch + 22.02;
    i++;
  }
  return { placed, rest: lines.slice(i), col2End };
}

// ── Right-hand price stack ─────────────────────────────────────────────

interface PriceRow {
  name: string;
  amount: string | null;
  isPackage: boolean;
  contents: string[];
}

function priceAmount(price: number | undefined, status: string): string | null {
  if (status === "INCLUDED") return "INCLUDED";
  if (status === "NO_CHARGE") return "NO CHARGE";
  if (price === undefined) return "N/A";
  return `$${formatPlain(price).replace(/\.00$/, "")}`;
}

function priceRows(d: FactoryStickerData): PriceRow[] {
  const eq = d.equipment;
  return [
    ...eq.packages.map((k) => ({ name: k.name, amount: priceAmount(k.price, k.priceStatus), isPackage: true, contents: k.features })),
    ...eq.options.map((o) => ({ name: o.name, amount: priceAmount(o.price, o.priceStatus), isPackage: false, contents: o.features ?? [] })),
    ...(eq.portInstalled ?? []).map((o) => ({ name: o.name, amount: priceAmount(o.price, o.priceStatus), isPackage: false, contents: [] })),
  ];
}

interface WarrantyLabels {
  powertrain: string[] | null;
  hybrid: string[] | null;
}

function termLine(text: string): string | null {
  const m = /(\d+)[\s-]*(?:year|yr)s?\D{0,12}?([\d,]+)[\s-]*(?:mile|mi)/i.exec(text);
  return m ? `${m[1]} year / ${m[2]} mile` : null;
}

function warrantyInfo(d: FactoryStickerData): { lines: string[]; labels: WarrantyLabels } {
  const w = d.warranty;
  if (!w || !w.sourceVerified) return { lines: [], labels: { powertrain: null, hybrid: null } };
  const lines = [w.powertrain, w.basic, w.corrosion, w.roadside, w.emissions].filter((s): s is string => !!s && !!s.trim());
  const pt1 = w.powertrain ? termLine(w.powertrain) : null;
  const hybridSrc = [w.basic, w.corrosion, w.roadside, w.emissions].find((s) => s && /battery|hybrid|high.?voltage/i.test(s));
  const hy = hybridSrc ? termLine(hybridSrc) : null;
  return {
    lines,
    labels: {
      powertrain: pt1 ? [pt1, "POWERTRAIN", "WARRANTY"] : null,
      hybrid: hy ? [hy, "HIGH VOLTAGE BATTERY", "HYBRID SYSTEM", "WARRANTY"] : null,
    },
  };
}

const WARRANTY_NOTE =
  "Ask Dealer for a copy of the limited warranties or see your owner's manual for details. Warranty details may differ in Zero Emission States. See Dealer for details.";

/** Paints (or only measures, when p is null) the options/total/warranty stack. Returns its bottom. */
function paintStack(p: Painter | null, d: FactoryStickerData, pitch: number, startY: number): number {
  const rows = priceRows(d);
  const pr = d.pricing;
  const right = 1025.5;
  const lineW = 330;
  const say = (s: string, x: number, y: number, size: number, font: LayoutFont, align?: "right"): void => {
    if (p) T(p, s, x, y, size, font, align ? { align } : {});
  };
  let y = startY;

  if (rows.length) {
    say("OPTIONAL EQUIPMENT", COL2_X, y, 17.348, "bold");
    say("(May Replace Standard Equipment)", COL2_X + widthFig("OPTIONAL EQUIPMENT", "bold", 17.348) + 8, y + 3.2, 13.879, "body");
    y += 17.33;
    let lastTop = y;
    rows.forEach((r) => {
      const font: LayoutFont = r.isPackage ? "bold" : "body";
      const lines = wrapFigma(r.name, font, ITEM_PX, lineW);
      lines.forEach((line, i) => {
        say(line, COL2_X + (i ? 6 : 0), y, ITEM_PX, font);
        if (i === 0 && r.amount) say(r.amount, right, y, ITEM_PX, font, "right");
        lastTop = y;
        y += pitch;
      });
      for (const c of r.contents) {
        for (const line of wrapFigma(c, "body", ITEM_PX, lineW - 12)) {
          say(line, COL2_X + 6.25, y, ITEM_PX, "body");
          lastTop = y;
          y += pitch;
        }
      }
    });
    y = lastTop + 39.36;
  }

  say("Destination Charge", COL2_X, y, 17.348, "bold");
  say(pr.destinationCharge !== undefined ? money0(pr.destinationCharge) : "NOT AVAILABLE", right, y, 17.348, "bold", "right");
  y += 28.1;

  const totalTop = y;
  if (p) {
    poly(p, 584.6, totalTop, [[0, 0], [15, 25], [0, 50]], INK);
    poly(p, 1024.3, totalTop, [[15, 0], [0, 25], [15, 50]], INK);
    R(p, 606.4, totalTop, 412, 55, null, 5);
    const total = pr.sourceReportedTotalMsrp ?? pr.calculatedTotalMsrp;
    const label = "TOTAL PRICE: *";
    const amount = total !== undefined ? money0(total) : "NOT AVAILABLE";
    const size = 24.288;
    const gap = 26;
    const full = widthFig(label, "bold", size) + gap + widthFig(amount, "bold", size);
    const fs = full > 380 ? size * (380 / full) : size;
    const w = widthFig(label, "bold", fs) + gap + widthFig(amount, "bold", fs);
    const x0 = 812.4 - w / 2;
    T(p, label, x0, totalTop + 14.8, fs, "bold");
    T(p, amount, x0 + w, totalTop + 14.8, fs, "bold", { align: "right" });
  }
  y = totalTop + 55;

  const wi = warrantyInfo(d);
  if (wi.lines.length) {
    y = totalTop + 63.3;
    say("WARRANTY COVERAGE", 601.68, y, ITEM_PX, "bold");
    y += 15;
    let lastTop = y;
    for (const s of [...wi.lines, WARRANTY_NOTE]) {
      for (const line of wrapFigma(s, "body", ITEM_PX, 415)) {
        say(line, 601.68, y, ITEM_PX, "body");
        lastTop = y;
        y += pitch;
      }
    }
    y = lastTop + 20.3;
    if (wi.labels.powertrain || wi.labels.hybrid) {
      const top = lastTop + 66.4;
      const paintLabel = (lines: string[], x: number, size: number, maxW: number): number => {
        const fs = Math.min(...lines.map((l) => fitSize(l, "bold", size, maxW)));
        lines.forEach((l, i) => say(l, x, top + i * fs, fs, "bold"));
        return lines.length * fs;
      };
      const h1 = wi.labels.powertrain ? paintLabel(wi.labels.powertrain, 600.26, 19.083, 230) : 0;
      const h2 = wi.labels.hybrid ? paintLabel(wi.labels.hybrid, 837.93, 17.348, 245) : 0;
      y = top + Math.max(h1, h2);
    }
  }
  return y;
}

// ── Left block: spec lines, base price ─────────────────────────────────

function paintBasePrice(p: Painter, d: FactoryStickerData): void {
  const size = 17.348;
  T(p, "MANUFACTURER'S SUGGESTED RETAIL PRICE OF", 99.32, 232.28, size, "bold", { spacing: 0.25 });
  T(p, "THIS MODEL INCLUDING DEALER PREPARATION", 99.32, 249.63, size, "bold", { spacing: 0.1 });
  poly(p, 104.5, 271, [[0, 0], [15, 22.5], [0, 45]], INK);
  poly(p, 472, 271, [[15, 0], [0, 22.5], [15, 45]], INK);
  R(p, 125, 271, 343, 45, null, 5);
  const label = "Base Price:";
  const amount = d.pricing.baseMsrp !== undefined ? money0(d.pricing.baseMsrp) : "NOT AVAILABLE";
  const s0 = 24.288;
  const gap = 26;
  const full = widthFig(label, "bold", s0) + gap + widthFig(amount, "bold", s0);
  const fs = full > 310 ? s0 * (310 / full) : s0;
  const w = widthFig(label, "bold", fs) + gap + widthFig(amount, "bold", fs);
  const x0 = 296.5 - w / 2;
  T(p, label, x0, 279.07, fs, "bold");
  T(p, amount, x0 + w, 279.07, fs, "bold", { align: "right" });
}

interface SpecLine {
  label: string | null;
  value: string;
  bold: boolean;
}

function specLines(d: FactoryStickerData, title: string): SpecLine[] {
  const v = d.vehicle;
  const out: SpecLine[] = [{ label: null, value: title, bold: true }];
  if (v.exteriorColor) out.push({ label: "Exterior Color:", value: v.exteriorColor, bold: false });
  if (v.interiorColor) out.push({ label: "Interior Color:", value: v.interiorColor, bold: false });
  if (v.engine) out.push({ label: "Engine:", value: v.engine, bold: false });
  if (v.transmission) out.push({ label: "Transmission:", value: v.transmission, bold: false });
  return out;
}

const SPEC_PITCH = 16.3;
const SPEC_PX = 16;
const SPEC_TOP = 317.03;

function paintSpec(p: Painter, lines: SpecLine[]): void {
  lines.forEach((l, i) => {
    const y = SPEC_TOP + i * SPEC_PITCH;
    const size = SPEC_PX;
    if (!l.label) {
      T(p, l.value, 104.89, y, fitSize(l.value, "bold", size, 440), "bold", { spacing: 0.3 });
      return;
    }
    const lw = widthFig(l.label, "bold", size);
    const full = lw + 4 + widthFig(l.value, "body", size);
    const fs = full > 450 ? Math.max(size * 0.6, size * (450 / full)) : size;
    const lw2 = widthFig(l.label, "bold", fs);
    T(p, l.label, 104.89, y, fs, "bold");
    T(p, l.value, 104.89 + lw2 + 4, y, fs, "body");
  });
}

// ── EPA plug-in hybrid panel ───────────────────────────────────────────

function gradientBar(p: Painter, x: number, y: number, w: number, h: number, capW: number, r: number): void {
  RR(p, x, y, w, h, r, INK);
  const n = 36;
  const inner = w - 2 * capW;
  const c0 = [0x8f, 0xc3, 0xea];
  const c1 = [0xf7, 0xf9, 0xfc];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const hex = c0.map((a, k) => Math.round(a + (c1[k] - a) * t).toString(16).padStart(2, "0")).join("");
    const x0 = x + capW + (inner * i) / n;
    R(p, x0, y, inner / n + 0.8, h, `#${hex}`);
  }
}

function scoreScale(
  p: Painter, x: number, y: number, w: number, h: number, capW: number, score: number | undefined,
  digitPx: number, bestPx: number, markPx: number,
): void {
  gradientBar(p, x, y, w, h, capW, h * 0.32);
  T(p, "1", x + capW / 2, y + (h - digitPx) / 2 + 1, digitPx, "bold", { align: "center", color: PAPER });
  T(p, "10", x + w - capW / 2, y + (h - digitPx) / 2 + 1, digitPx, "bold", { align: "center", color: PAPER });
  T(p, "Best", x + w - capW / 2, y + h + 1, bestPx, "body", { align: "center" });
  if (score !== undefined) {
    const t = (Math.min(10, Math.max(1, score)) - 1) / 9;
    const cx = x + capW + 6 + t * (w - 2 * capW - 12);
    T(p, String(Math.round(score)), cx, y - markPx - 2, markPx, "bold", { align: "center" });
  }
}

function pumpIcon(p: Painter, x: number, y: number, h: number): void {
  const X = x + INNER_X;
  const Y = y + INNER_Y;
  const hp = u(h);
  p.rect(u(X), u(Y) + hp * 0.06, hp * 0.62, hp * 0.88, INK);
  p.rect(u(X) + hp * 0.1, u(Y) + hp * 0.16, hp * 0.42, hp * 0.26, PAPER);
  p.rect(u(X) + hp * 0.7, u(Y) + hp * 0.26, hp * 0.1, hp * 0.52, INK);
  p.rect(u(X) + hp * 0.62, u(Y) + hp * 0.22, hp * 0.18, hp * 0.08, INK);
}

function plugIcon(p: Painter, x: number, y: number): void {
  const X = u(x + INNER_X);
  const Y = u(y + INNER_Y);
  p.rect(X + 5, Y, 6, 3.5, INK);
  p.rect(X + 11, Y + 0.6, 2, 0.8, INK);
  p.rect(X + 11, Y + 2.2, 2, 0.8, INK);
  p.rect(X, Y + 1.5, 5, 0.9, INK);
}

function drawRangeBar(p: Painter, rangeMiles: number): void {
  const bx = 1130;
  const by = 417;
  const bw = 232;
  const bh = 15;
  T(p, "Driving Range", 1129.28, 397.71, 15.614, "bold", { spacing: -0.2 });
  poly(p, 1318, 394, [[0, 23], [15.5, 0], [31, 23], [0, 23]], null, 2);
  poly(p, 1375, 394, [[0, 23], [16, 0], [32, 23]], INK);
  R(p, bx, by, bw, bh, PAPER, 2);
  poly(p, bx + bw, by, [[0, 0], [148, 0], [141, bh], [0, bh]], INK);
  poly(p, bx + bw + 152, by, [[6, 0], [46, 0], [46, bh], [0, bh]], INK);
  // simple car silhouette
  p.rect(u(1546 + INNER_X), u(409 + INNER_Y), u(50), u(12), INK);
  poly(p, 1556, 396, [[0, 14], [8, 0], [30, 0], [40, 14]], INK);
  RR(p, 1552, 423, 14, 14, 7, INK);
  RR(p, 1580, 423, 14, 14, 7, INK);
  T(p, "Electricity + Gasoline", 1138.53, by + 1.4, 11.277, "bold", { spacing: -0.07 });
  T(p, "Gasoline only", 1370.74, by + 1.4, 11.277, "bold", { color: PAPER });
  const step = rangeMiles > 60 ? 20 : 10;
  for (let m = 0; m <= rangeMiles * 0.75; m += step) {
    T(p, String(m), bx + (m / rangeMiles) * bw, 431.34 + 4, 10.409, "body");
  }
  const rangeText = String(Math.round(rangeMiles));
  T(p, rangeText, bx + bw, 428.79 + 4, 20.818, "bold", { align: "center", spacing: 1.5 });
  T(p, "miles", bx + bw + widthFig(rangeText, "bold", 20.818, 3) / 2 + 8, 437.47 + 4, 11.277, "body");
  T(p, `All electric range =   0 - ${rangeText} miles`, 1130.36, 443.54 + 4, 11.277, "body");
}

function paintEpa(p: Painter, d: FactoryStickerData): void {
  const r = d.regulatory;
  RR(p, 1083.4, 177, 949, 562, 22, INK);
  T(p, "EPA", 1089.94, 180.9, 27.064, "bold", { color: PAPER });
  T(p, "DOT", 1089.57, 208.14, 25.329, "bold", { color: PAPER });
  R(p, 1091, 207, 52, 2, PAPER);
  T(p, "Fuel Economy and Environment", 1187.36, 190.64, 31.227, "bold", { color: PAPER });
  R(p, 1739, 185, 293, 46, "#8fd4f5");
  T(p, "Plug-In Hybrid Vehicle", 2032.5, 189.6, 19.083, "bold", { align: "right" });
  T(p, "Electricity-Gasoline", 2032.5, 208.7, 19.083, "bold", { align: "right" });
  RR(p, 1091, 240, 929, 219, 26, PAPER);

  const verified = r.epaStatus === "VERIFIED" && (r.combinedMpg !== undefined || r.gasolineCombinedMpg !== undefined);
  if (!verified) {
    wrapFigma("Fuel economy and environment information is not available from verified EPA records for this exact configuration.", "bold", 24, 800)
      .forEach((line, i) => T(p, line, 1130, 300 + i * 30, 24, "bold"));
  } else {
    T(p, "Fuel Economy", 1123.44, 249.85, 19.083, "bold", { spacing: -0.3 });
    if (r.epaClassNote) {
      const note = r.epaClassNote;
      const fs = fitSize(note, "body", 13.879, 540, 0.8);
      if (widthFig(note, "body", fs) <= 540) {
        T(p, note, 1254.02, 253.58, fs, "body");
      } else {
        wrapFigma(note, "body", 12, 760).slice(0, 2).forEach((line, i) => T(p, line, 1254.02, 243 + i * 13, 12, "body"));
      }
    }
    epaBoxes(p, d);
  }

  // You save / spend
  const delta = r.fiveYearCostDifference;
  if (verified && delta !== undefined && delta !== 0) {
    const saves = delta > 0;
    T(p, "You", 1772.37, 256.12, 24.288, "bold", { spacing: 0.4 });
    T(p, saves ? "save" : "spend", 1825.01, 237.17, 45.106, "bold", { spacing: -0.9 });
    const amt = money0(Math.abs(delta));
    Tfit(p, amt, 1769.77, 287.24, 65.924, "bold", 245);
    const tail = saves ? ["in fuel costs", "over 5 years"] : ["more in fuel costs", "over 5 years"];
    tail.forEach((line, i) => Tfit(p, line, 1793.49, 354.81 + i * 24.3, 24.288, "bold", 225));
    ["compared to the", "average new vehicle."].forEach((line, i) => T(p, line, 1793.49, 402.76 + i * 17.35, 17.348, "body"));
  }

  // Annual cost + ratings
  RR(p, 1091, 466, 258, 141, 26, PAPER);
  RR(p, 1357, 466, 663, 141, 26, PAPER);
  T(p, "Annual fuel", 1108.55, 485.38, 22.553, "bold");
  T(p, "cost", 1237.62, 464.85, 45.106, "bold", { spacing: -1.1 });
  if (r.annualFuelCost !== undefined) {
    Tfit(p, money0(r.annualFuelCost), 1124.74, 517.42, 65.924, "bold", 215);
  } else {
    T(p, "Not Available", 1124.74, 530, 24, "bold");
  }

  T(p, "Fuel Economy & Greenhouse Gas Rating", 1373.97, 472.62, 17.348, "bold");
  T(p, "(tailpipe only)", 1714.26, 477.36, 12.144, "body");
  T(p, "Smog Rating", 1821.42, 472.95, 17.348, "bold");
  T(p, "(tailpipe only)", 1932.76, 477.69, 12.144, "body");
  const ghg = r.greenhouseGasRating !== undefined && r.greenhouseGasRating > 0 ? r.greenhouseGasRating : undefined;
  const smog = r.smogRating !== undefined && r.smogRating > 0 ? r.smogRating : undefined;
  if (ghg !== undefined) scoreScale(p, 1381.7, 528, 383, 30, 40, ghg, 24.288, 12.144, 26);
  else T(p, "Not Rated", 1381.7, 532, 24, "bold");
  if (smog !== undefined) scoreScale(p, 1816, 528, 185, 26, 40, smog, 19.083, 13.879, 26);
  else T(p, "Not Rated", 1816, 532, 24, "bold");
  const co2 = "The best emits 0 grams per mile (tailpipe only). Producing and distributing fuel also creates emissions; learn more at fueleconomy.gov.";
  wrapFigma(co2, "body", 12.144, 560).forEach((line, i) => T(p, line, 1379.41, 577.83 + i * 12.2, 12.144, "body"));

  const note = "Actual results will vary for many reasons, including driving conditions and how you drive and maintain your vehicle. Cost estimates are current EPA estimates and may differ from those printed on the original label. This is a dual fueled automobile. MPGe is miles per gasoline gallon equivalent. Vehicle emissions are a significant cause of climate change and smog.";
  wrapFigma(note, "bold", 13.011, 700).slice(0, 4).forEach((line, i) =>
    T(p, line, 1096.77, 619.21 + i * 13.02, 13.011, "bold", { color: PAPER }));
  T(p, "fueleconomy.gov", 1093.06, 677, 38.167, "bold", { color: PAPER });
  T(p, "Calculate personalized estimates and compare vehicles", 1093.06, 716.5, 13.879, "bold", { color: PAPER });

  const url = d.document.passportUrl.trim();
  if (url) {
    const X = 1857;
    const Y = 614;
    R(p, X, Y, 164, 117, PAPER);
    T(p, "VEHICLE PASSPORT", X + 82, Y + 5, 12.5, "bold", { align: "center" });
    const qr = 70;
    p.qr(u(X + 82 - qr / 2 + INNER_X), u(Y + 21 + INNER_Y), u(qr), url, INK);
    T(p, PASSPORT_QR_CAPTION, X + 82, Y + 98, 11, "body", { align: "center" });
  }
}

function epaBoxes(p: Painter, d: FactoryStickerData): void {
  const r = d.regulatory;
  // Electricity + gasoline
  RR(p, 1124, 272, 236, 120, 18, PAPER, 3);
  T(p, "Electricity + Gasoline", 1130.7, 271.45, 15.614, "bold", { spacing: -0.14 });
  plugIcon(p, 1127, 308);
  pumpIcon(p, 1127, 326, 26);
  if (r.combinedMpg !== undefined) {
    T(p, String(Math.round(r.combinedMpg)), 1148, 298, 86, "bold", { spacing: -0.5 });
    T(p, "MPGe", 1272.27, 296.07, 24.288, "bold", { spacing: 0.26 });
    if (r.cityMpg !== undefined) {
      T(p, String(Math.round(r.cityMpg)), 1272.56, 322, 26, "bold", { spacing: -0.85 });
      T(p, "city", 1324.19, 330, 11.277, "body");
    }
    if (r.highwayMpg !== undefined) {
      T(p, String(Math.round(r.highwayMpg)), 1272.56, 349, 26, "bold", { spacing: -0.85 });
      T(p, "hwy", 1324.24, 357, 11.277, "body");
    }
    T(p, "combined city/highway", 1155.81, 375.42, 13.879, "body", { spacing: 0.6 });
  } else {
    T(p, "Not Available", 1242, 330, 24, "bold", { align: "center" });
  }
  // Gasoline only
  RR(p, 1365, 272, 236, 120, 18, PAPER, 3);
  T(p, "Gasoline Only", 1368.05, 271.63, 15.614, "bold", { spacing: -0.14 });
  pumpIcon(p, 1371, 303, 26);
  if (r.gasolineCombinedMpg !== undefined && r.gasolineCombinedMpg > 0) {
    const mpg = r.gasolineCombinedMpg;
    T(p, String(Math.round(mpg)), 1388, 298, 86, "bold", { spacing: -0.5 });
    T(p, "MPG", 1535.76, 296.24, 24.288, "bold", { spacing: 0.57 });
    T(p, (100 / mpg).toFixed(1), 1549.03, 324, 26, "bold", { spacing: -0.85 });
    T(p, "gallons per", 1532.89, 353, 11.277, "body");
    T(p, "100 miles", 1541.67, 365, 11.277, "body");
    T(p, "combined city/highway", 1389.72, 375.28, 13.879, "body", { spacing: 0.6 });
  } else {
    T(p, "Not Available", 1483, 330, 24, "bold", { align: "center" });
  }
  if (r.evRangeMiles !== undefined && r.evRangeMiles > 0) drawRangeBar(p, r.evRangeMiles);
  else T(p, "Electric range not available", 1129.28, 410, 15.614, "bold");
}

// ── Safety ─────────────────────────────────────────────────────────────

function bigStars(p: Painter, x: number, y: number, count: number): void {
  const s = u(22);
  for (let i = 0; i < count; i++) {
    p.path(starPath(s), u(x + INNER_X) + i * u(23.6), u(y + INNER_Y), s, s, INK);
  }
}

function paintSafety(p: Painter, d: FactoryStickerData): void {
  const r = d.regulatory;
  R(p, 1084, 767, 564, 35, INK);
  R(p, 1084, 802, 564, 332, null, 3);
  R(p, 1084, 1134, 564, 73, INK);
  T(p, "GOVERNMENT 5-STAR SAFETY RATINGS", 1366, 771.33, 24.288, "bold", { align: "center", color: PAPER });
  const cell = (n: number | undefined, top: number): void => {
    if (r.nhtsaStatus === "UNAVAILABLE") { T(p, "Not Available", 1470, top + 5, 20.818, "bold"); return; }
    if (r.nhtsaStatus === "NOT_RATED" || n === undefined || n <= 0) { T(p, "Not Rated", 1470, top + 5, 20.818, "bold"); return; }
    bigStars(p, 1470, top + 6, Math.min(5, Math.round(n)));
  };
  T(p, "Overall Vehicle Score", 1109.99, 811.34, 20.818, "bold");
  cell(r.overallRating, 810.73);
  T(p, "Based on the combined ratings of frontal, side and rollover.", 1109.99, 839.41, 13.879, "body");
  T(p, "Compare only to vehicles of similar size and weight.", 1109.99, 853.29, 13.879, "body");
  R(p, 1110, 893, 512, 4, INK);
  T(p, "Frontal", 1109.99, 901.22, 20.818, "bold");
  T(p, "Crash", 1109.99, 922.04, 20.818, "bold");
  T(p, "Driver", 1291.11, 901.22, 20.818, "body");
  T(p, "Passenger", 1291.11, 922.04, 20.818, "body");
  cell(r.frontalDriverRating, 900.26);
  cell(r.frontalPassengerRating, 925.44);
  T(p, "Based on the risk of injury in a frontal impact.", 1109.99, 947.99, 13.879, "body");
  R(p, 1110, 984, 512, 4, INK);
  T(p, "Side", 1109.99, 1001.86, 20.818, "bold");
  T(p, "Crash", 1109.99, 1022.69, 20.818, "bold");
  T(p, "Front seat", 1291.11, 1001.86, 20.818, "body");
  T(p, "Rear seat", 1291.11, 1022.69, 20.818, "body");
  cell(r.sideFrontRating, 1000.28);
  cell(r.sideRearRating, 1026.16);
  T(p, "Based on the risk of injury in a side impact.", 1109.99, 1050.49, 13.879, "body");
  R(p, 1110, 1073, 512, 4, INK);
  T(p, "Rollover", 1109.99, 1089.02, 20.818, "bold");
  cell(r.rolloverRating, 1089.12);
  T(p, "Based on the risk of rollover in a single-vehicle crash.", 1109.99, 1112.87, 13.879, "body");
  ["Star ratings range from 1 to 5; 5 is highest.", "Source: National Highway Traffic Safety Administration", "www.nhtsa.gov/ratings"]
    .forEach((line, i) => T(p, line, 1366, 1143.68 + i * 17.35, 17.175, "bold", { align: "center", color: PAPER }));
  wrapFigma("The safety ratings above are based on Federal Government tests of particular vehicles equipped with certain features and options. The performance of this vehicle may differ.", "body", 13.879, 560)
    .forEach((line, i) => T(p, line, 1085.69, 1214.08 + i * 13.88, 13.879, "body"));
}

// ── Parts content / origin ─────────────────────────────────────────────

function paintOrigin(p: Painter, d: FactoryStickerData): void {
  const X = 1660;
  const Y = 770;
  R(p, X, Y, 375, 343, PAPER, 5);
  T(p, "PARTS CONTENT INFORMATION", X + 187.5, 775.08, 20.818, "bold", { align: "center" });
  const entries = (d.factory.partsContent ?? []).filter((e) => e.sourceVerified);
  const find = (re: RegExp) => entries.find((e) => re.test(e.label.toLowerCase()));
  const usCan = find(/u\.?s\.?.*canad|domestic|us\/canadian/);
  const engine = find(/engine/);
  const trans = find(/transmission/);
  const foreign = entries.filter((e) => e !== usCan && e !== engine && e !== trans && !/assembly/i.test(e.label));
  const assembly = d.factory.finalAssemblyPoint;

  interface OLine { text: string; bold: boolean; x: number; size: number; gapBefore: number }
  const lines: OLine[] = [];
  const add = (text: string, x = 1673.24, bold = true, size = 17.5, gap = 0): void => {
    for (const l of wrapFigma(text.toUpperCase(), "bold", size, 340 - (x - 1673.24))) lines.push({ text: l, bold, x, size, gapBefore: gap });
  };
  if (usCan || foreign.length) {
    add("FOR VEHICLES IN THIS CARLINE:");
    if (usCan) add(`U.S./CANADIAN PARTS CONTENT: ${usCan.value}`, 1678);
    if (foreign.length) {
      add("MAJOR SOURCES OF FOREIGN PARTS CONTENT:");
      for (const e of foreign) add(`${e.label}: ${e.value}`);
    }
    for (const l of wrapFigma("NOTE: PARTS CONTENT DOES NOT INCLUDE FINAL ASSEMBLY, DISTRIBUTION, OR OTHER NON-PARTS COSTS.", "body", 17.348, 340)) {
      lines.push({ text: l, bold: false, x: 1673.24, size: 17.348, gapBefore: 0 });
    }
  }
  if (assembly || engine || trans) {
    add("FOR THIS VEHICLE:");
    if (assembly) { add("FINAL ASSEMBLY POINT:", 1682.73); add(assembly, 1682.73); }
    if (engine || trans) {
      add("COUNTRY OF ORIGIN:");
      if (engine) add(`ENGINE: ${engine.value}`);
      if (trans) add(`TRANSMISSION: ${trans.value}`);
    }
  }
  if (!lines.length) return;
  const avail = Y + 343 - 12 - 806;
  const natural = lines.reduce((s, l) => s + (l.bold ? 20.82 : 17.35), 0);
  const k = Math.min(1, avail / natural);
  let y = 806;
  for (const l of lines) {
    const size = l.size * Math.max(0.8, k);
    const fs = l.bold ? fitSize(l.text, "bold", size, 345 - (l.x - 1673.24), 0.55) : size;
    T(p, l.text, l.x, y, fs, l.bold ? "bold" : "body");
    y += (l.bold ? 20.82 : 17.35) * k;
  }
}

function paintDealer(p: Painter, d: FactoryStickerData): void {
  const dl = d.dealer;
  if (!dl.name || !dl.name.trim()) return;
  R(p, 1660, 1124, 375, 123, PAPER, 5);
  const parts = [
    dl.address,
    [dl.city, dl.state, dl.postalCode].filter(Boolean).join(" "),
    dl.phone,
  ].filter((s): s is string => !!s && !!s.trim());
  const nameLines = wrapFigma(dl.name.toUpperCase(), "bold", 22, 340).slice(0, 2);
  const total = nameLines.length * 25 + parts.length * 20;
  let y = 1124 + (123 - total) / 2;
  for (const l of nameLines) { T(p, l, 1847.5, y, 22, "bold", { align: "center" }); y += 25; }
  for (const s of parts) { Tfit(p, s.toUpperCase(), 1847.5, y, 17.348, "body", 340, { align: "center" }); y += 20; }
}

// ── Page furniture ─────────────────────────────────────────────────────

const BANNER_X = 36;
const BANNER_Y = 20;
const BODY_W = 2376;

function paintBanner(p: Painter, pageLabel: string): void {
  p.rect(u(BANNER_X) + 1, u(BANNER_Y) + 1, u(BODY_W) - 2, u(34) - 2, null, INK, 2);
  txt(p, REPRODUCTION_BANNER, BANNER_X + 9, BANNER_Y + 5, 20, "bold", { lh: 20 });
  txt(p, pageLabel, BANNER_X + BODY_W - 9, BANNER_Y + 7, 15, "bold", { align: "right", lh: 15 });
}

function disclosureHeight(lines: string[]): number {
  let n = 0;
  for (const para of lines) n += wrapFigma(para, "body", 17, BODY_W).length;
  return 27 + n * 20;
}

function paintDisclosureAt(p: Painter, lines: string[], top: number): void {
  txt(p, REPRODUCTION_BANNER, BANNER_X, top, 19, "bold", { lh: 19 });
  let y = top + 27;
  for (const para of lines) {
    for (const line of wrapFigma(para, "body", 17, BODY_W)) {
      txt(p, line, BANNER_X, y, 17, "body", { lh: 17 });
      y += 20;
    }
  }
}

function paintFrame(p: Painter, color: string): void {
  p.rect(u(30.49 + INNER_X), u(26 + INNER_Y), u(2075), u(1325), color);
  const w = u(2024);
  const h = u(1275);
  p.path(roundedRectPath(w, h, u(36)), u(55.7 + INNER_X), u(52 + INNER_Y), w, h, PAPER);
}

function titleLine(d: FactoryStickerData, displayMake: string): string {
  const v = d.vehicle;
  return [v.year > 0 ? String(v.year) : "", displayMake, v.model, v.trim ?? ""].filter(Boolean).join(" ").toUpperCase();
}

const CONT_COL_W = 470;
const CONT_COL_GAP = 20;
const CONT_TOP = 175;

function paintContinuation(
  p: Painter, d: FactoryStickerData, config: StellantisVariantConfig, displayMake: string,
  lines: FlowLine[], pitch: number,
): FlowLine[] {
  paintFrame(p, config.frameColor);
  T(p, titleLine(d, displayMake), 106, 92, 34, "bold", { spacing: 0.5 });
  T(p, `VIN: ${d.vehicle.vin}`, 2030, 100, 20, "bold", { align: "right" });
  R(p, 106, 140, 1924, 3, INK);
  T(p, "STANDARD EQUIPMENT CONTINUED", 106, 150, 17.348, "bold");
  let col = 0;
  let y = CONT_TOP;
  let i = 0;
  while (i < lines.length && col < 4) {
    const line = lines[i];
    const need = pitch * (line.heading ? 2 : 1) - (pitch - ITEM_PX * 1.3);
    if (y + need > COL_BOTTOM) { col++; y = CONT_TOP; continue; }
    T(p, line.text, 106 + col * (CONT_COL_W + CONT_COL_GAP) + line.indent, y, ITEM_PX, line.font);
    y += pitch;
    i++;
  }
  return lines.slice(i);
}

/**
 * Builds the dedicated layout, or returns null when the pricing stack cannot
 * fit the right-hand column so the caller falls back to the generic layout.
 */
export function buildStellantisPhevLayout(
  config: StellantisVariantConfig,
  input: VariantRenderInput,
): LayoutModel | null {
  const d = input.layout.data;
  const minPitch = PITCHES[PITCHES.length - 1];
  if (paintStack(null, d, minPitch, COL2_TOP) > COL_BOTTOM) return null;

  const groups = input.equipmentGroups.length
    ? input.equipmentGroups
    : d.equipment.standard.map((g) => ({ hint: CATEGORY_HINT[g.category], items: g.items }));
  const lines = flowLines(assignSections(groups), COL1_W);
  const spec = specLines(d, config.specTitle(d, input.displayMake));
  const stdHeadTop = SPEC_TOP + spec.length * SPEC_PITCH + 3;
  const col1Top = stdHeadTop + 18.45;

  let chosen = { pitch: minPitch, ...placeStd(lines, minPitch, col1Top, COL_BOTTOM - paintStack(null, d, minPitch, COL2_TOP) + COL2_TOP) };
  for (const pitch of PITCHES) {
    const stackH = paintStack(null, d, pitch, COL2_TOP) - COL2_TOP;
    if (stackH > COL_BOTTOM - COL2_TOP) continue;
    const trial = placeStd(lines, pitch, col1Top, COL_BOTTOM - stackH);
    chosen = { pitch, ...trial };
    if (!trial.rest.length) break;
  }
  const { pitch, placed, rest, col2End } = chosen;
  const stackTop = placed.some((l) => l.x >= COL2_X) ? col2End : COL2_TOP;
  if (paintStack(null, d, pitch, stackTop) > COL_BOTTOM + 4) return null;

  const disclosure = [...reproductionDisclosureLines(input.layout.factoryBuild), ...input.layout.disclaimers];
  const footerTop = Math.min(1446, CANVAS_H - 36 - disclosureHeight(disclosure));

  const plan: FlowLine[][] = [];
  let remaining = rest;
  while (remaining.length) {
    const next = paintContinuation(new Painter(null), d, config, input.displayMake, remaining, pitch);
    if (next.length === remaining.length) throw new Error("layout_failed: continuation entry cannot fit an empty page");
    plan.push(remaining.slice(0, remaining.length - next.length));
    remaining = next;
  }
  const pageCount = plan.length + 1;

  const drawn: string[] = [];
  const p = new Painter(drawn);
  paintBanner(p, pageCount > 1 ? `PAGE 1 OF ${pageCount} - EQUIPMENT CONTINUED ON PAGE 2` : "PAGE 1 OF 1");
  paintFrame(p, config.frameColor);
  config.paintHeader(p, d, input.displayMake);
  R(p, 570.4, 234, 2, 921, INK);
  R(p, 93.7, 1162, 962, 2, INK);
  paintBasePrice(p, d);
  paintSpec(p, spec);
  T(p, "STANDARD EQUIPMENT", 106.07, stdHeadTop, 17.348, "bold");
  const seW = widthFig("STANDARD EQUIPMENT", "bold", 17.348) + 6;
  Tfit(p, "(UNLESS REPLACED BY OPTIONAL EQUIPMENT)", 106.07 + seW, stdHeadTop + 3.1, 13.879, "body", 555 - 106.07 - seW);
  for (const l of placed) T(p, l.text, l.x, l.top, ITEM_PX, l.font);
  paintStack(p, d, pitch, stackTop);
  T(p, "THIS VEHICLE IS MANUFACTURED TO MEET SPECIFIC UNITED STATES REQUIREMENTS. THIS", 99.93, 198.43, 13.879, "bold");
  T(p, "VEHICLE IS NOT MANUFACTURED FOR SALE OR REGISTRATION OUTSIDE OF THE UNITED STATES.", 99.93, 212.31, 13.879, "bold");
  paintEpa(p, d);
  paintSafety(p, d);
  paintOrigin(p, d);
  paintDealer(p, d);
  paintFooterLeft(p, d);
  paintDisclosureAt(p, disclosure, footerTop);

  const pages: LayoutPage[] = [{ primitives: p.primitives }];
  plan.forEach((pageLines, i) => {
    const cp = new Painter(drawn);
    paintBanner(cp, `PAGE ${i + 2} OF ${pageCount}`);
    paintContinuation(cp, d, config, input.displayMake, pageLines, pitch);
    paintDisclosureAt(cp, disclosure, footerTop);
    pages.push({ primitives: cp.primitives });
  });

  const model: LayoutModel = {
    width: CANVAS_W / 2,
    height: CANVAS_H / 2,
    mode: pages.length > 1 ? "CONTINUATION_REQUIRED" : "STANDARD",
    pages,
    drawnStrings: drawn,
    fontFamilies: { heading: "Helvetica-Bold", body: "Helvetica", numeric: "Courier" },
  };
  validateModel(model);
  return model;
}

function paintFooterLeft(p: Painter, d: FactoryStickerData): void {
  const assembly = d.factory.finalAssemblyPoint;
  if (assembly) T(p, `Assembly Point/Port of Entry: ${assembly}`, 93.68, 1170.4, 13.879, "body", { spacing: -0.2 });
  T(p, `VIN: ${d.vehicle.vin}`, 95.94, 1189.97, 17.348, "body");
  ["* STATE AND/OR LOCAL TAXES IF ANY, LICENSE AND TITLE FEES AND DEALER SUPPLIED AND",
    "INSTALLED OPTIONS AND ACCESSORIES ARE NOT INCLUDED IN THIS PRICE. DISCOUNT, IF ANY,",
    "IS BASED ON PRICE OF OPTIONS IF PURCHASED SEPARATELY."]
    .forEach((line, i) => T(p, line, 543.6, 1261.72 + i * 10.41, 10.409, "body"));
}

