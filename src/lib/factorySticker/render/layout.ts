// Deterministic, pdf-agnostic layout engine for the Factory Window Sticker.
// Consumes FactoryStickerData + an OemStickerTheme and produces a LayoutModel
// of drawing primitives in points on a 792x612 letter-landscape page, with
// measurement-based content fit, density fallback, and a continuation page.
//
// The page structure mirrors the OEM Monroney reference approved as the
// visual goal: a full-width factory code strip, a ~57% left column (header,
// four-column standard equipment, included/optional pricing split, spec
// grid, VIN barcode, navy total band) and a right column (EPA Fuel Economy
// & Environment panel, Government 5-Star Safety Ratings, Vehicle Passport
// QR, federal-label notice, AutoLabels verification box).

import type { FactoryStickerData, EquipmentCategory } from "../types.ts";
import type { OemStickerTheme } from "../oem/themes.ts";

export const PAGE_WIDTH = 792;
export const PAGE_HEIGHT = 612;
export const PAGE_MARGIN = 9;
export const MIN_BODY_FONT_SIZE = 4.4;

export type LayoutFont = "heading" | "body" | "numeric" | "bold";
export type LayoutAlign = "left" | "right" | "center";
export type LayoutMode = "STANDARD" | "DENSE" | "CONTINUATION_REQUIRED";

export interface TextPrimitive {
  kind: "text";
  str: string;
  x: number;
  y: number;
  size: number;
  font: LayoutFont;
  align: LayoutAlign;
  color: string;
  maxWidth?: number;
  charSpacing?: number;
}

export interface RulePrimitive {
  kind: "rule";
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}

export interface RectPrimitive {
  kind: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string | null;
  stroke?: string;
  strokeWidth?: number;
}

export interface BarcodePrimitive {
  kind: "barcode";
  x: number;
  y: number;
  w: number;
  h: number;
  payload: string;
  color: string;
}

export interface QrPrimitive {
  kind: "qr";
  x: number;
  y: number;
  size: number;
  payload: string;
  color: string;
}

// Small vector glyph (star, slider marker, icon). `d` is SVG path data in a
// local y-down coordinate space anchored at (x, y); w/h declare its bounds
// for validation.
export interface PathPrimitive {
  kind: "path";
  d: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string | null;
  stroke?: string;
  strokeWidth?: number;
}

export type LayoutPrimitive =
  | TextPrimitive
  | RulePrimitive
  | RectPrimitive
  | BarcodePrimitive
  | QrPrimitive
  | PathPrimitive;

export interface LayoutPage {
  primitives: LayoutPrimitive[];
}

export interface LayoutFontFamilies {
  heading: string;
  body: string;
  numeric: string;
}

export interface LayoutModel {
  width: number;
  height: number;
  mode: LayoutMode;
  pages: LayoutPage[];
  drawnStrings: string[];
  fontFamilies: LayoutFontFamilies;
}

export interface StickerLayoutInput {
  data: FactoryStickerData;
  title: string;
  disclaimers: string[];
  barcodePayload: string;
  generic: boolean;
}

// ── Font metrics (Helvetica / Helvetica-Bold AFM widths, units per 1000 em;
// Courier is fixed 600). Approximate but internally consistent, which is what
// the deterministic fit logic requires.

const HELV: Record<string, number> = {
  " ": 278, "!": 278, '"': 355, "#": 556, "$": 556, "%": 889, "&": 667,
  "'": 191, "(": 333, ")": 333, "*": 389, "+": 584, ",": 278, "-": 333,
  ".": 278, "/": 278, "0": 556, "1": 556, "2": 556, "3": 556, "4": 556,
  "5": 556, "6": 556, "7": 556, "8": 556, "9": 556, ":": 278, ";": 278,
  "<": 584, "=": 584, ">": 584, "?": 556, "@": 1015, A: 667, B: 667,
  C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500, K: 667,
  L: 556, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611,
  U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611, "[": 278, "\\": 278,
  "]": 278, "^": 469, _: 556, "`": 333, a: 556, b: 556, c: 500, d: 556,
  e: 556, f: 278, g: 556, h: 556, i: 222, j: 222, k: 500, l: 222, m: 833,
  n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278, u: 556, v: 500,
  w: 722, x: 500, y: 500, z: 500, "{": 334, "|": 260, "}": 334, "~": 584,
};

const HELV_BOLD: Record<string, number> = {
  " ": 278, "!": 333, '"': 474, "#": 556, "$": 556, "%": 889, "&": 722,
  "'": 238, "(": 333, ")": 333, "*": 389, "+": 584, ",": 278, "-": 333,
  ".": 278, "/": 278, "0": 556, "1": 556, "2": 556, "3": 556, "4": 556,
  "5": 556, "6": 556, "7": 556, "8": 556, "9": 556, ":": 333, ";": 333,
  "<": 584, "=": 584, ">": 584, "?": 611, "@": 975, A: 722, B: 722,
  C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 556, K: 722,
  L: 611, M: 833, N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611,
  U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611, "[": 333, "\\": 278,
  "]": 333, "^": 584, _: 556, "`": 333, a: 556, b: 611, c: 556, d: 611,
  e: 556, f: 333, g: 611, h: 611, i: 278, j: 278, k: 556, l: 278, m: 889,
  n: 611, o: 611, p: 611, q: 611, r: 389, s: 556, t: 333, u: 611, v: 556,
  w: 778, x: 556, y: 556, z: 500, "{": 389, "|": 280, "}": 389, "~": 584,
};

const DEFAULT_CHAR_WIDTH = 600;

export function charWidthUnits(ch: string, font: LayoutFont): number {
  if (font === "numeric") return 600;
  const table = font === "body" ? HELV : HELV_BOLD;
  return table[ch] ?? DEFAULT_CHAR_WIDTH;
}

export function measureText(
  str: string,
  font: LayoutFont,
  size: number,
  charSpacing = 0,
): number {
  let units = 0;
  for (const ch of str) units += charWidthUnits(ch, font);
  const spacing = str.length > 1 ? charSpacing * (str.length - 1) : 0;
  return (units / 1000) * size + spacing;
}

export function textBBox(t: TextPrimitive): { x0: number; x1: number; y0: number; y1: number } {
  const w = measureText(t.str, t.font, t.size, t.charSpacing ?? 0);
  const x0 = t.align === "right" ? t.x - w : t.align === "center" ? t.x - w / 2 : t.x;
  return { x0, x1: x0 + w, y0: t.y - t.size, y1: t.y };
}

function wrapText(str: string, font: LayoutFont, size: number, maxWidth: number): string[] {
  const words = str.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  const fits = (s: string): boolean => measureText(s, font, size) <= maxWidth;
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (fits(candidate)) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    if (fits(word)) {
      line = word;
    } else {
      let chunk = "";
      for (const ch of word) {
        if (fits(chunk + ch)) chunk += ch;
        else {
          if (chunk) lines.push(chunk);
          chunk = ch;
        }
      }
      line = chunk;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [];
}

function ellipsize(str: string, font: LayoutFont, size: number, maxWidth: number): string {
  if (measureText(str, font, size) <= maxWidth) return str;
  let out = str;
  while (out.length > 1 && measureText(`${out}...`, font, size) > maxWidth) {
    out = out.slice(0, -1).trimEnd();
  }
  return `${out}...`;
}

// WinAnsi-safe sanitation: smart punctuation to ASCII, anything beyond
// Latin-1 dropped, whitespace collapsed.
function sanitize(raw: string): string {
  return raw
    .replace(/[‘’‚]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/…/g, "...")
    .replace(/[ \s]+/g, " ")
    .split("")
    .filter((ch) => ch.charCodeAt(0) <= 255)
    .join("")
    .trim();
}

export function formatMoney(n: number): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  const [whole, frac] = abs.toFixed(2).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}$${grouped}.${frac}`;
}

// Monroney option rows carry plain amounts without a currency symbol.
export function formatPlain(n: number): string {
  return formatMoney(n).replace("$", "");
}

const parseEm = (v: string): number => {
  const m = /^(-?[\d.]+)em$/.exec(v.trim());
  return m ? Number(m[1]) : 0;
};

interface Density {
  mode: LayoutMode;
  item: number;
  itemLh: number;
  row: number;
  rowLh: number;
  head: number;
}

const DENSITY_LARGE: Density = { mode: "STANDARD", item: 6.8, itemLh: 8.6, row: 7.2, rowLh: 9.8, head: 8 };
const DENSITY_STANDARD: Density = { mode: "STANDARD", item: 6.1, itemLh: 7.6, row: 6.6, rowLh: 9, head: 7.5 };
const DENSITY_DENSE: Density = { mode: "DENSE", item: 5.5, itemLh: 6.8, row: 6.2, rowLh: 8.2, head: 7 };
const DENSITY_FLOOR: Density = { mode: "CONTINUATION_REQUIRED", item: 5, itemLh: 6.2, row: 6, rowLh: 7.8, head: 7 };

const CATEGORY_LABELS: Record<EquipmentCategory, string> = {
  EXTERIOR: "Exterior",
  INTERIOR: "Interior",
  COMFORT_CONVENIENCE: "Comfort & Convenience",
  FUNCTIONAL: "Functional",
  POWERTRAIN: "Powertrain & Mechanical",
  SAFETY_SECURITY: "Safety / Security",
  TECHNOLOGY: "Technology",
  OTHER: "Additional Equipment",
};

// Monroney column assignment: four fixed columns as on the OEM reference.
const CATEGORY_COLUMN: Record<EquipmentCategory, number> = {
  EXTERIOR: 0,
  INTERIOR: 1,
  COMFORT_CONVENIENCE: 1,
  FUNCTIONAL: 2,
  POWERTRAIN: 2,
  TECHNOLOGY: 2,
  OTHER: 2,
  SAFETY_SECURITY: 3,
};

const COLUMN_HEADS = ["EXTERIOR", "INTERIOR", "FUNCTIONAL", "SAFETY / SECURITY"];

// ── Page geometry ─────────────────────────────────────────────────────

const IX = PAGE_MARGIN + 6;                     // content inset inside the border
const IR = PAGE_WIDTH - PAGE_MARGIN - 6;
const SPLIT_X = 449;                            // left/right column divider
const LX = IX;
const LW = SPLIT_X - 7 - LX;
const RX = SPLIT_X + 7;
const RW = IR - RX;
const CONTENT_BOTTOM = PAGE_HEIGHT - PAGE_MARGIN - 5;
const SECTION_GAP = 5;

const BLACK = "#0d0d0d";
const EPA_TAG_BLUE = "#b7d9f1";

class Painter {
  primitives: LayoutPrimitive[] = [];
  constructor(private drawn: string[] | null) {}

  text(
    str: string,
    x: number,
    y: number,
    size: number,
    font: LayoutFont,
    color: string,
    opts: { align?: LayoutAlign; maxWidth?: number; charSpacing?: number } = {},
  ): void {
    const clean = sanitize(str);
    if (!clean) return;
    const prim: TextPrimitive = {
      kind: "text",
      str: clean,
      x,
      y,
      size,
      font,
      align: opts.align ?? "left",
      color,
      ...(opts.maxWidth !== undefined ? { maxWidth: opts.maxWidth } : {}),
      ...(opts.charSpacing ? { charSpacing: opts.charSpacing } : {}),
    };
    this.primitives.push(prim);
    if (this.drawn) this.drawn.push(clean);
  }

  rule(x: number, y: number, w: number, h: number, color: string): void {
    this.primitives.push({ kind: "rule", x, y, w, h, color });
  }

  rect(x: number, y: number, w: number, h: number, fill: string | null, stroke?: string, strokeWidth?: number): void {
    this.primitives.push({
      kind: "rect", x, y, w, h, fill,
      ...(stroke !== undefined ? { stroke } : {}),
      ...(strokeWidth !== undefined ? { strokeWidth } : {}),
    });
  }

  barcode(x: number, y: number, w: number, h: number, payload: string, color: string): void {
    this.primitives.push({ kind: "barcode", x, y, w, h, payload, color });
  }

  qr(x: number, y: number, size: number, payload: string, color: string): void {
    this.primitives.push({ kind: "qr", x, y, size, payload, color });
  }

  path(d: string, x: number, y: number, w: number, h: number, fill: string | null, stroke?: string, strokeWidth?: number): void {
    this.primitives.push({
      kind: "path", d, x, y, w, h, fill,
      ...(stroke !== undefined ? { stroke } : {}),
      ...(strokeWidth !== undefined ? { strokeWidth } : {}),
    });
  }
}

// ── Vector glyphs ─────────────────────────────────────────────────────

function starPath(s: number): string {
  // 5-point star in an s×s box, y-down.
  const p = (a: number, r: number): [number, number] => [
    s / 2 + r * Math.sin(a), s / 2 - r * Math.cos(a),
  ];
  const outer = s / 2;
  const inner = s / 5;
  const pts: string[] = [];
  for (let i = 0; i < 5; i++) {
    const [ox, oy] = p((i * 2 * Math.PI) / 5, outer);
    const [ix2, iy2] = p(((i * 2 + 1) * Math.PI) / 5, inner);
    pts.push(`${i === 0 ? "M" : "L"}${ox.toFixed(2)} ${oy.toFixed(2)}`);
    pts.push(`L${ix2.toFixed(2)} ${iy2.toFixed(2)}`);
  }
  return `${pts.join(" ")} Z`;
}

function drawStars(p: Painter, x: number, y: number, count: number, size: number, color: string): void {
  for (let i = 0; i < count; i++) {
    p.path(starPath(size), x + i * (size + 1.6), y, size, size, color);
  }
}

const PUMP_BODY = "M0 3 h9 v12 h-9 Z M10.5 6 l2.6 2.6 v5.2 a1.5 1.5 0 0 1 -3 0 v-3.4 h-1.1";
const PUMP_WINDOW = "M1.6 4.6 h5.8 v3.6 h-5.8 Z";
const CHECK_MARK = "M2 7.5 L5.6 11 L12 3.4";

function sliderMarkerPath(w: number, h: number): string {
  // Downward-pointing tab: rectangle with a chevron tail.
  const tail = h * 0.45;
  return `M0 0 H${w} V${h - tail} L${w / 2} ${h} L0 ${h - tail} Z`;
}

// ── Shared helpers ────────────────────────────────────────────────────

const headingCase = (theme: OemStickerTheme, s: string): string =>
  theme.typography.uppercaseSectionHeadings ? s.toUpperCase() : s;

const priceLabel = (item: { price?: number; priceStatus: string }, plain: boolean): string => {
  if (item.priceStatus === "INCLUDED") return "INCLUDED";
  if (item.priceStatus === "NO_CHARGE") return "NO CHARGE";
  if (item.price !== undefined) return plain ? formatPlain(item.price) : formatMoney(item.price);
  return "SEE DEALER";
};

function leaderRow(
  p: Painter,
  x: number,
  rowRight: number,
  y: number,
  name: string,
  price: string,
  size: number,
  nameFont: LayoutFont,
  color: string,
  dotColor: string,
): void {
  const priceW = measureText(price, "bold", size);
  const nameMax = rowRight - x - priceW - 10;
  const shown = ellipsize(name, nameFont, size, nameMax);
  p.text(shown, x, y, size, nameFont, color);
  const nameW = measureText(shown, nameFont, size);
  const dotW = measureText(".", "body", size);
  const gapStart = x + nameW + 2;
  const gapEnd = rowRight - priceW - 3;
  const dots = Math.floor((gapEnd - gapStart) / dotW);
  if (dots > 0) {
    p.text(".".repeat(dots), gapStart, y, size, "body", dotColor);
  }
  p.text(price, rowRight, y, size, nameFont === "bold" ? "bold" : "body", color, { align: "right" });
}

interface FlowEntry {
  heading?: string;
  lines: string[];
  bullet?: boolean;
}

interface BuildContext {
  input: StickerLayoutInput;
  theme: OemStickerTheme;
  density: Density;
}

// ── Top strip: factory administrative codes across the full width ─────

function paintTopStrip(p: Painter, ctx: BuildContext): number {
  const { data } = ctx.input;
  const v = data.vehicle;
  const f = data.factory;
  const size = 6;
  const baseline = PAGE_MARGIN + 10.5;

  const left: Array<[string, string]> = [];
  if (f.locationCode) left.push(["LOC", f.locationCode]);
  if (v.exteriorColorCode) left.push(["EXT", v.exteriorColorCode]);
  if (v.interiorColorCode) left.push(["INT", v.interiorColorCode]);
  if (f.emissionsCode) left.push(["EMS", f.emissionsCode]);
  if (f.sequenceNumber) left.push(["SEQ", f.sequenceNumber]);
  if (f.orderNumber) left.push(["ORDER", f.orderNumber]);
  if (f.dealerCode) left.push(["DEALER", f.dealerCode]);

  let cx = LX;
  for (const [label, value] of left) {
    p.text(`${label}:`, cx, baseline, size, "body", BLACK);
    cx += measureText(`${label}:`, "body", size) + 3;
    p.text(value, cx, baseline, size, "bold", BLACK);
    cx += measureText(value, "bold", size) + 14;
  }

  const stock = v.stockNumber ? `  ${v.stockNumber}` : "";
  p.text(`VIN: ${v.vin}`, RX + 4, baseline, 6.6, "bold", BLACK);
  if (stock.trim()) {
    p.text(stock.trim(), IR, baseline, size, "body", BLACK, { align: "right" });
  }

  const ruleY = baseline + 4.5;
  p.rule(PAGE_MARGIN, ruleY, PAGE_WIDTH - 2 * PAGE_MARGIN, 1.1, BLACK);
  return ruleY + 1.1;
}

// ── Left column: header (wordmark / model / identity block) ──────────

function paintHeader(p: Painter, y: number, ctx: BuildContext): number {
  const { theme, input } = ctx;
  const v = input.data.vehicle;
  const bandH = 46;

  const wordmarkSize = 16;
  const spacing = Math.max(parseEm(theme.logo.wordmarkLetterSpacing) * wordmarkSize, wordmarkSize * 0.34);
  p.text(theme.logo.wordmarkText, LX + 2, y + 28, wordmarkSize, "heading", BLACK, {
    charSpacing: spacing,
  });

  const centerX = LX + LW * 0.52;
  const yearModel = [v.year > 0 ? String(v.year) : "", v.model].filter(Boolean).join(" ").toUpperCase();
  p.text(ellipsize(yearModel, "bold", 20, 200), centerX, y + 24, 20, "bold", BLACK, { align: "center" });
  if (v.trim) {
    p.text(ellipsize(v.trim.toUpperCase(), "bold", 11.5, 200), centerX, y + 38, 11.5, "bold", BLACK, { align: "center" });
  }

  const bx = LX + LW;
  let by = y + 12;
  if (v.exteriorColor) {
    p.text(`EXTERIOR: ${v.exteriorColor.toUpperCase()}`, bx, by, 6.2, "bold", BLACK, { align: "right" });
    by += 8;
  }
  if (v.interiorColor) {
    p.text(`INTERIOR: ${v.interiorColor.toUpperCase()}`, bx, by, 6.2, "bold", BLACK, { align: "right" });
    by += 8;
  }
  p.text(`VIN: ${v.vin}`, bx, by, 6.2, "body", BLACK, { align: "right" });
  by += 8;
  if (ctx.input.generic) {
    p.text("TYPICAL FACTORY CONFIGURATION FOR THIS TRIM - NOT VIN-SPECIFIC", bx, by, 4.8, "bold", "#8a6d1a", { align: "right" });
  }

  const ruleY = y + bandH;
  p.rule(LX, ruleY, LW, 1.6, BLACK);
  return ruleY + 3;
}

// ── Standard equipment: four fixed Monroney columns ───────────────────

interface BucketedEquipment {
  columns: FlowEntry[][];
  flat: FlowEntry[];
  multiCategory: boolean;
}

function bucketEquipment(ctx: BuildContext, colWidth: number): BucketedEquipment {
  const { density } = ctx;
  const columns: FlowEntry[][] = [[], [], [], []];
  const flat: FlowEntry[] = [];
  const perColumnCategories = [0, 0, 0, 0];
  for (const group of ctx.input.data.equipment.standard) {
    if (!group.items.length) continue;
    perColumnCategories[CATEGORY_COLUMN[group.category]] += 1;
  }
  for (const group of ctx.input.data.equipment.standard) {
    if (!group.items.length) continue;
    const col = CATEGORY_COLUMN[group.category];
    const needsSubhead = perColumnCategories[col] > 1 &&
      !(columns[col].length === 0 && CATEGORY_LABELS[group.category].toUpperCase() === COLUMN_HEADS[col]);
    if (needsSubhead) {
      columns[col].push({ heading: CATEGORY_LABELS[group.category].toUpperCase(), lines: [] });
    }
    flat.push({ heading: CATEGORY_LABELS[group.category].toUpperCase(), lines: [] });
    for (const item of group.items) {
      const lines = wrapText(sanitize(item), "body", density.item, colWidth - 6);
      if (lines.length) {
        columns[col].push({ lines, bullet: true });
        flat.push({ lines, bullet: true });
      }
    }
  }
  return { columns, flat, multiCategory: perColumnCategories.some((n) => n > 1) };
}

// U+2022 is outside WinAnsi-safe range for the text sanitizer, so bullets
// are drawn as tiny filled circles that realize identically in SVG and PDF.
function bulletDot(p: Painter, x: number, baseline: number, size: number, color: string): void {
  const r = Math.max(0.9, size * 0.16);
  const d = `M${(r * 2).toFixed(2)} ${r.toFixed(2)} A${r.toFixed(2)} ${r.toFixed(2)} 0 1 1 0 ${r.toFixed(2)} A${r.toFixed(2)} ${r.toFixed(2)} 0 1 1 ${(r * 2).toFixed(2)} ${r.toFixed(2)} Z`;
  p.path(d, x, baseline - size * 0.55, r * 2, r * 2, color);
}

function paintEntryLines(
  p: Painter,
  entry: FlowEntry,
  x: number,
  cy: number,
  density: Density,
  color: string,
): number {
  let yy = cy;
  entry.lines.forEach((line, li) => {
    yy += density.itemLh;
    if (entry.bullet && li === 0) {
      bulletDot(p, x + 0.5, yy, density.item, color);
      p.text(line, x + 5, yy, density.item, "body", color);
    } else {
      p.text(line, x + 5, yy, density.item, "body", color);
    }
  });
  return yy;
}

function paintStandardEquipment(
  p: Painter,
  y: number,
  budget: number,
  ctx: BuildContext,
): { yEnd: number; leftover: FlowEntry[] } {
  const { density } = ctx;
  const gap = 9;
  const colW = (LW - gap * 3) / 4;
  const buckets = bucketEquipment(ctx, colW);
  const hasAny = buckets.columns.some((c) => c.length > 0);
  if (!hasAny) return { yEnd: y, leftover: [] };

  let cursor = y + 8.5;
  const h1 = "STANDARD EQUIPMENT";
  const h2 = "INCLUDED AT NO EXTRA CHARGE";
  p.text(h1, LX, cursor, 8, "bold", BLACK);
  const h1W = measureText(h1, "bold", 8);
  p.text(h2, LX + h1W + 5, cursor, 5.8, "bold", BLACK);
  const underW = h1W + 5 + measureText(h2, "bold", 5.8);
  p.rule(LX, cursor + 1.6, underW, 0.7, BLACK);
  cursor += 6;

  const colTop = cursor;
  // Reserve the footnote + closing rule (~12pt) and the pricing offset that
  // follows this section, so a full column never pushes the bottom stack out.
  const colBudget = Math.max(0, budget - (cursor - y) - 19);
  const leftover: FlowEntry[] = [];
  let usedMax = 0;

  for (let col = 0; col < 4; col++) {
    const cx = LX + col * (colW + gap);
    let cy = colTop + 7;
    p.text(COLUMN_HEADS[col], cx, cy, density.item + 0.7, "bold", BLACK);
    p.rule(cx, cy + 1.4, measureText(COLUMN_HEADS[col], "bold", density.item + 0.7), 0.6, BLACK);
    cy += 2.2;
    const entries = buckets.columns[col];
    let idx = 0;
    let pendingHead: string | null = null;
    while (idx < entries.length) {
      const entry = entries[idx];
      if (entry.heading !== undefined) {
        pendingHead = entry.heading;
        idx++;
        continue;
      }
      const needed = (pendingHead ? density.itemLh + 2 : 0) + entry.lines.length * density.itemLh;
      if (cy + needed > colTop + colBudget) break;
      if (pendingHead) {
        cy += density.itemLh + 1;
        p.text(pendingHead, cx, cy, density.item + 0.3, "bold", BLACK);
        p.rule(cx, cy + 1.2, measureText(pendingHead, "bold", density.item + 0.3), 0.5, BLACK);
        cy += 1.6;
        pendingHead = null;
      }
      cy = paintEntryLines(p, entry, cx, cy, density, BLACK);
      idx++;
    }
    if (idx < entries.length) {
      if (pendingHead) leftover.push({ heading: pendingHead, lines: [] });
      else leftover.push({ heading: COLUMN_HEADS[col], lines: [] });
      for (let i = idx; i < entries.length; i++) leftover.push(entries[i]);
    }
    usedMax = Math.max(usedMax, cy - colTop);
  }

  for (let col = 1; col < 4; col++) {
    const sx = LX + col * (colW + gap) - gap / 2;
    p.rule(sx, colTop + 1, 0.5, usedMax + 2, "#9a9da1");
  }

  let end = colTop + usedMax + 8;
  p.text(
    "* See Owner's Manual for complete details, limitations and exclusions.",
    LX + LW / 2, end, 5.2, "body", BLACK, { align: "center" },
  );
  end += 3;
  p.rule(LX, end, LW, 1.1, BLACK);
  return { yEnd: end + 1.1, leftover };
}

// ── Included / Optional pricing split ─────────────────────────────────

function paintPricingSplit(p: Painter, y: number, ctx: BuildContext): number {
  const { input } = ctx;
  const leftW = LW * 0.415;
  const rightX = LX + leftW + 10;
  const rightW = LX + LW - rightX;
  // The pricing pair reads larger than the equipment lists on the OEM
  // reference, so its sizes are fixed rather than density-driven.
  const size = 7.4;
  const lh = 11;
  const density = { ...ctx.density, item: 6.6, itemLh: 8.8 };

  // Left half: packages included on this vehicle.
  let ly = y + 9;
  p.text("INCLUDED ON THIS VEHICLE", LX, ly, 6.8, "bold", BLACK);
  p.text("(MSRP)", LX + leftW - 2, ly, 5.6, "body", BLACK, { align: "right" });
  ly += 2;
  for (const pkg of input.data.equipment.packages) {
    ly += lh + 1;
    const label = [pkg.code, pkg.name].filter(Boolean).join(" ").toUpperCase();
    p.text(ellipsize(label, "bold", size, leftW - 46), LX, ly, size, "bold", BLACK);
    p.rule(LX, ly + 1.4, Math.min(measureText(label, "bold", size), leftW - 46), 0.5, BLACK);
    p.text(priceLabel(pkg, true), LX + leftW - 2, ly, size, "bold", BLACK, { align: "right" });
    for (const feature of pkg.features) {
      const lines = wrapText(sanitize(feature), "body", density.item, leftW - 12);
      for (const [li, line] of lines.entries()) {
        ly += density.itemLh;
        if (li === 0) bulletDot(p, LX + 3.5, ly, density.item, BLACK);
        p.text(line, LX + 8, ly, density.item, "body", BLACK);
      }
    }
  }

  // Right half: optional equipment with dot leaders and the MSRP rollup.
  let ry = y + 9;
  p.text("OPTIONAL EQUIPMENT / OTHER", rightX, ry, 6.8, "bold", BLACK);
  p.rule(rightX, ry + 1.4, measureText("OPTIONAL EQUIPMENT / OTHER", "bold", 6.8), 0.5, BLACK);
  p.text("(MSRP)", rightX + rightW, ry, 5.6, "body", BLACK, { align: "right" });
  ry += 2;
  for (const opt of input.data.equipment.options) {
    ry += lh;
    const code = opt.code ? `${opt.code}` : "";
    const codeW = 20;
    if (code) p.text(code, rightX, ry, size, "body", BLACK);
    const nameX = rightX + (code ? codeW : 0);
    if (opt.features && opt.features.length) {
      // Package rows put the price leader on the contents line, as on the
      // OEM reference ("Cargo Package" / "• Cargo Net ... 250.00").
      p.text(ellipsize(opt.name, "body", size, rightW - codeW - 10), nameX, ry, size, "body", BLACK);
      ry += density.itemLh;
      let fx = nameX + 6;
      for (const feature of opt.features) {
        const shown = ellipsize(sanitize(feature), "body", density.item, rightW - codeW - 60);
        bulletDot(p, fx, ry, density.item, BLACK);
        p.text(shown, fx + 4, ry, density.item, "body", BLACK);
        fx += 4 + measureText(shown, "body", density.item) + 9;
        if (fx > rightX + rightW - 70) break;
      }
      const price = priceLabel(opt, true);
      const priceW = measureText(price, "body", density.item);
      const dotW = measureText(".", "body", density.item);
      const dotStart = fx - 6;
      const dots = Math.floor((rightX + rightW - priceW - 3 - dotStart) / dotW);
      if (dots > 0) p.text(".".repeat(dots), dotStart, ry, density.item, "body", BLACK);
      p.text(price, rightX + rightW, ry, density.item, "body", BLACK, { align: "right" });
    } else {
      leaderRow(p, nameX, rightX + rightW, ry, opt.name, priceLabel(opt, true), size, "body", BLACK, BLACK);
    }
  }
  const destination = input.data.pricing.destinationCharge;
  if (destination !== undefined) {
    ry += lh + 1.5;
    leaderRow(p, rightX, rightX + rightW, ry, "DESTINATION & HANDLING", formatPlain(destination), size, "bold", BLACK, BLACK);
  }

  ry += lh + 4;
  const pricing = input.data.pricing;
  const rollup: Array<[string, number | undefined, boolean]> = [
    ["BASE MSRP", pricing.baseMsrp, true],
    ["FACTORY OPTIONS", pricing.factoryInstalledTotal ??
      (pricing.packagesTotal !== undefined || pricing.optionsTotal !== undefined
        ? (pricing.packagesTotal ?? 0) + (pricing.optionsTotal ?? 0)
        : undefined), false],
    ["DESTINATION & HANDLING", pricing.destinationCharge, false],
  ];
  for (const [label, amount, dollar] of rollup) {
    if (amount === undefined) continue;
    ry += lh;
    leaderRow(p, rightX, rightX + rightW, ry, label, dollar ? formatMoney(amount) : formatPlain(amount), size, "body", BLACK, BLACK);
  }

  ry += lh + 3;
  const condition = input.data.vehicle.condition;
  const totalLabel = condition === "NEW" ? "TOTAL FACTORY MSRP" : "TOTAL ORIGINAL MSRP";
  const total = pricing.sourceReportedTotalMsrp ?? pricing.calculatedTotalMsrp;
  leaderRow(
    p, rightX, rightX + rightW, ry,
    totalLabel, total !== undefined ? formatMoney(total) : "SEE DEALER",
    size + 1.4, "bold", BLACK, BLACK,
  );
  ry += 3;

  const end = Math.max(ly, ry) + 4;
  p.rule(rightX - 5, y + 3, 0.5, end - y - 6, "#9a9da1");
  p.rule(LX, end, LW, 1.1, BLACK);
  return end + 1.1;
}

// ── Spec grid + VIN barcode ───────────────────────────────────────────

function specCell(
  p: Painter,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  value: string,
): void {
  p.rect(x, y, w, h, null, BLACK, 0.7);
  p.text(label, x + 3, y + 6.5, 4.9, "bold", BLACK);
  p.text(ellipsize(value.toUpperCase(), "body", 6.4, w - 6), x + 3, y + h - 4.5, 6.4, "body", BLACK);
}

function paintSpecGrid(p: Painter, y: number, ctx: BuildContext): number {
  const { input } = ctx;
  const v = input.data.vehicle;
  const f = input.data.factory;
  const rowH = 19;
  const gridW = LW * 0.72;

  const assembly = f.finalAssemblyPoint || [f.assemblyPlant, f.assemblyCountry].filter(Boolean).join(", ");
  const row1: Array<[string, string]> = [];
  if (assembly) row1.push(["FINAL ASSEMBLY POINT:", assembly]);
  if (f.transportMethod) row1.push(["METHOD OF TRANSPORT:", f.transportMethod]);
  if (v.stockNumber) row1.push(["STOCK NO.:", v.stockNumber]);

  const row2: Array<[string, string]> = [];
  if (v.exteriorColor) {
    row2.push(["EXT. COLOR:", [v.exteriorColor, v.exteriorColorCode ? `(${v.exteriorColorCode})` : ""].filter(Boolean).join(" ")]);
  }
  if (v.interiorColor) {
    row2.push(["INT. COLOR:", [v.interiorColor, v.interiorColorCode ? `(${v.interiorColorCode})` : ""].filter(Boolean).join(" ")]);
  }
  if (v.engine) row2.push(["ENGINE:", v.engine]);
  if (v.transmission) row2.push(["TRANS:", v.transmission]);

  let cursor = y;
  if (row1.length) {
    const widths = row1.length === 3 ? [0.4, 0.3, 0.3] : row1.map(() => 1 / row1.length);
    let cx = LX;
    row1.forEach(([label, value], i) => {
      const w = gridW * widths[i];
      specCell(p, cx, cursor, w, rowH, label, value);
      cx += w;
    });
    cursor += rowH;
  }
  if (row2.length) {
    const widths = row2.length === 4 ? [0.31, 0.25, 0.22, 0.22] : row2.map(() => 1 / row2.length);
    let cx = LX;
    row2.forEach(([label, value], i) => {
      const w = gridW * widths[i];
      specCell(p, cx, cursor, w, rowH, label, value);
      cx += w;
    });
    cursor += rowH;
  }
  return cursor;
}

function paintVinBarcode(p: Painter, y: number, ctx: BuildContext): number {
  const { theme, input } = ctx;
  const v = input.data.vehicle;
  const boxW = LW * 0.72;
  const showBarcode = theme.layout.barcodeVariant !== "NONE";
  const boxH = showBarcode ? 56 : 18;
  p.rect(LX, y, boxW, boxH, null, BLACK, 0.7);
  p.text(`VIN: ${v.vin}`, LX + 5, y + 9, 7, "bold", BLACK);
  if (showBarcode) {
    const barW = boxW * 0.62;
    p.barcode(LX + 5, y + 13, barW, 32, input.barcodePayload, BLACK);
    // The bare VIN under the bars is part of the render QA contract: the
    // orchestrator asserts drawnStrings contains the exact VIN.
    p.text(v.vin, LX + 5 + barW / 2, y + 52, 6, "body", BLACK, { align: "center" });
  } else {
    p.text(v.vin, LX + boxW - 5, y + 9, 7, "body", BLACK, { align: "right" });
  }
  return y + boxH;
}

// ── Navy total band ───────────────────────────────────────────────────

function paintTotalBand(p: Painter, y: number, ctx: BuildContext): number {
  const { theme, input } = ctx;
  const pricing = input.data.pricing;
  const condition = input.data.vehicle.condition;
  const label = condition === "NEW" ? "TOTAL FACTORY MSRP" : "TOTAL ORIGINAL MSRP";
  const total = pricing.sourceReportedTotalMsrp ?? pricing.calculatedTotalMsrp;
  const bandH = 34;
  p.rect(LX, y, LW, bandH, theme.colors.totalMsrpBackground);
  p.text(label, LX + 10, y + 22.5, 15, "bold", theme.colors.totalMsrpText, {
    charSpacing: 0.4,
  });
  const amount = total !== undefined ? formatMoney(total) : "SEE DEALER";
  p.text(amount, LX + LW - 10, y + 23, 16.5, "bold", theme.colors.totalMsrpText, { align: "right" });
  return y + bandH;
}

// ── Right column: EPA Fuel Economy & Environment ──────────────────────

function fuelCategoryLabel(fuelType: string | undefined): string {
  const f = (fuelType || "").toLowerCase();
  if (/electric|ev\b/.test(f)) return "Electric Vehicle";
  if (/hybrid|phev/.test(f)) return "Hybrid Vehicle";
  if (/diesel/.test(f)) return "Diesel Vehicle";
  return "Gasoline Vehicle";
}

function paintRatingSlider(
  p: Painter,
  x: number,
  y: number,
  w: number,
  label: string,
  value: number | undefined,
  theme: OemStickerTheme,
): number {
  p.text(label, x, y + 6, 5.2, "bold", BLACK);
  const barY = y + 13;
  const barH = 8.5;
  const cap = 9;
  // Reversed end caps with a continuous track filled up to the marker.
  p.rect(x, barY, cap, barH, BLACK);
  p.text("1", x + cap / 2, barY + barH - 1.5, 5, "bold", "#ffffff", { align: "center" });
  p.rect(x + cap, barY, w - cap * 2, barH, "#ffffff", BLACK, 0.7);
  p.rect(x + w - cap, barY, cap, barH, BLACK);
  p.text("10", x + w - cap / 2, barY + barH - 1.5, 5, "bold", "#ffffff", { align: "center" });
  p.text("Best", x + w, barY + barH + 6, 5, "body", BLACK, { align: "right" });
  if (value !== undefined && value >= 1 && value <= 10) {
    const track = w - cap * 2;
    const fillW = Math.max(0, track * ((value - 0.5) / 10));
    p.rect(x + cap + 0.7, barY + 0.7, Math.max(0, fillW - 0.7), barH - 1.4, "#4a4f55");
    const mw = 13.5;
    const mx = Math.min(Math.max(x + cap + fillW - mw / 2, x), x + w - mw);
    p.path(sliderMarkerPath(mw, 13.5), mx, barY - 4.5, mw, 13.5, theme.colors.totalMsrpBackground);
    p.text(String(value), mx + mw / 2, barY + 3.4, 6.8, "bold", "#ffffff", { align: "center" });
  }
  return barY + barH + 8;
}

function pumpPath(s: number): { body: string; window: string; w: number; h: number } {
  const n = (v: number): string => (v * s).toFixed(2);
  return {
    body: `M0 ${n(3)} h${n(9)} v${n(12)} h-${n(9)} Z M${n(10.5)} ${n(6)} l${n(2.6)} ${n(2.6)} v${n(5.2)} a${n(1.5)} ${n(1.5)} 0 0 1 -${n(3)} 0 v-${n(3.4)} h-${n(1.1)}`,
    window: `M${n(1.6)} ${n(4.6)} h${n(5.8)} v${n(3.6)} h-${n(5.8)} Z`,
    w: 13.5 * s,
    h: 15.5 * s,
  };
}

function paintEpaPanel(p: Painter, y: number, ctx: BuildContext): number {
  const { theme, input } = ctx;
  const reg = input.data.regulatory;
  if (reg.epaStatus !== "VERIFIED") return y;
  const header = theme.colors.headerBackground;
  const headerText = theme.colors.headerText;

  const boxTop = y;
  const headH = 24;
  const bodyTop = y + headH;

  // Header band.
  p.rect(RX, boxTop, RW, headH, header);
  p.text("EPA", RX + 6, boxTop + 11, 6.5, "bold", headerText);
  p.text("DOT", RX + 6, boxTop + 19, 6.5, "bold", headerText);
  p.rule(RX + 24, boxTop + 4.5, 0.5, headH - 9, "#8b8f94");
  p.text("Fuel Economy & Environment", RX + 30, boxTop + 16, 12, "bold", headerText);
  const tagW = 92;
  const tagX = RX + RW - tagW - 5;
  p.rect(tagX, boxTop + 4.5, tagW, headH - 9, EPA_TAG_BLUE);
  const tagPump = pumpPath(0.75);
  p.path(tagPump.body, tagX + 4, boxTop + 7, tagPump.w, tagPump.h, BLACK);
  p.text(fuelCategoryLabel(input.data.vehicle.fuelType), tagX + tagW / 2 + 6, boxTop + 14.6, 7.6, "bold", BLACK, { align: "center" });

  let cy = bodyTop + 13;
  p.text("Fuel Economy", RX + 7, cy, 10, "bold", BLACK);

  // Big combined MPG block.
  const mpgTop = cy + 6.5;
  const pump = pumpPath(1.35);
  p.path(pump.body, RX + 7, mpgTop + 5, pump.w, pump.h, BLACK);
  p.path(pump.window, RX + 7, mpgTop + 5, pump.w, pump.h, "#ffffff");
  const combined = reg.combinedMpg;
  let numW = 0;
  if (combined !== undefined) {
    p.text(String(combined), RX + 29, mpgTop + 33, 38, "bold", BLACK);
    numW = measureText(String(combined), "bold", 38);
    p.text("MPG", RX + 33 + numW, mpgTop + 17, 13, "bold", BLACK);
    p.text("combined city/hwy", RX + 29, mpgTop + 41, 5.8, "body", BLACK);
    let colX = RX + 37 + numW;
    if (reg.cityMpg !== undefined) {
      p.text(String(reg.cityMpg), colX, mpgTop + 32, 11, "bold", BLACK);
      p.text("city", colX, mpgTop + 39.5, 5.8, "body", BLACK);
      colX += 26;
    }
    if (reg.highwayMpg !== undefined) {
      p.text(String(reg.highwayMpg), colX, mpgTop + 32, 11, "bold", BLACK);
      p.text("highway", colX, mpgTop + 39.5, 5.8, "body", BLACK);
    }
  }
  if (reg.epaClassNote) {
    let ny = mpgTop + 6;
    for (const line of wrapText(reg.epaClassNote, "body", 4.8, 58)) {
      p.text(line, RX + 146, ny, 4.8, "body", BLACK);
      ny += 5.6;
    }
  }

  // Right: five-year cost comparison.
  const fiveYear = reg.fiveYearCostDifference;
  const costX = RX + RW - 98;
  p.rule(costX - 8, bodyTop + 5, 0.5, 64, "#b5b8bc");
  if (fiveYear !== undefined) {
    const spend = fiveYear < 0;
    p.text("You", costX, bodyTop + 13, 10, "body", BLACK);
    p.text(spend ? "spend" : "save", costX + measureText("You ", "body", 10), bodyTop + 13, 13.5, "bold", BLACK);
    p.text(formatMoney(Math.abs(fiveYear)).replace(/\.00$/, ""), costX, bodyTop + 34.5, 21, "bold", BLACK);
    p.text(`${spend ? "more" : ""} in fuel costs`.trim(), costX, bodyTop + 44.5, 8, "bold", BLACK);
    p.text("over 5 years", costX, bodyTop + 53.5, 8, "bold", BLACK);
    p.text("compared to the", costX, bodyTop + 62, 6.4, "body", BLACK);
    p.text("average new vehicle.", costX, bodyTop + 69.5, 6.4, "body", BLACK);
  }
  if (reg.gallonsPer100Miles !== undefined) {
    p.text(`${reg.gallonsPer100Miles}`, RX + 9, mpgTop + 56, 10, "bold", BLACK);
    p.text("gallons per 100 miles", RX + 11 + measureText(String(reg.gallonsPer100Miles), "bold", 10), mpgTop + 56, 6.4, "body", BLACK);
  }

  // Annual fuel cost sub-box + rating sliders.
  const subTop = mpgTop + 72;
  const costBoxW = 104;
  const costBoxH = 46;
  if (reg.annualFuelCost !== undefined) {
    p.rect(RX + 5, subTop, costBoxW, costBoxH, null, BLACK, 0.9);
    p.text("Annual fuel", RX + 10, subTop + 13, 9.5, "body", BLACK);
    p.text("cost", RX + 10 + measureText("Annual fuel ", "body", 9.5), subTop + 13, 10.5, "bold", BLACK);
    p.text(formatMoney(reg.annualFuelCost).replace(/\.00$/, ""), RX + 10, subTop + 34, 19, "bold", BLACK);
  }
  const sliderX = RX + costBoxW + 16;
  const sliderW = RW - costBoxW - 28;
  paintRatingSlider(p, sliderX, subTop + 3, sliderW * 0.58, "Fuel Economy & Greenhouse Gas Rating", reg.greenhouseGasRating, ctx.theme);
  paintRatingSlider(p, sliderX + sliderW * 0.66, subTop + 3, sliderW * 0.34, "Smog Rating (tailpipe only)", reg.smogRating, ctx.theme);

  // Fine print.
  let fy = subTop + costBoxH + 10;
  const finePrint =
    "Actual results will vary for many reasons, including driving conditions and how you drive and maintain your vehicle. " +
    "Cost estimates are based on 15,000 miles per year at $3.00 per gallon. MPGe is miles per gasoline gallon equivalent. " +
    "Vehicle emissions are a significant cause of climate change and smog.";
  for (const line of wrapText(finePrint, "body", 5, RW - 14)) {
    p.text(line, RX + 7, fy, 5, "body", BLACK);
    fy += 5.8;
  }
  fy += 2;

  // fueleconomy.gov band.
  const bandH = 34;
  p.rect(RX, fy, RW, bandH, header);
  p.text("fueleconomy.gov", RX + 7, fy + 15.5, 13, "bold", headerText);
  p.text("Calculate personalized estimates and compare vehicles", RX + 7, fy + 24, 6, "body", headerText);
  // Medallion glyphs: double ring + filled core reads as an agency roundel.
  const medallion = (cx: number): void => {
    p.path("M15 7.5 A7.5 7.5 0 1 1 0 7.5 A7.5 7.5 0 1 1 15 7.5 Z", cx, fy + 7.5, 15, 15, null, "#ffffff", 1);
    p.path("M11.4 5.7 A5.7 5.7 0 1 1 0 5.7 A5.7 5.7 0 1 1 11.4 5.7 Z", cx + 1.8, fy + 9.3, 11.4, 11.4, null, "#ffffff", 0.5);
    p.path("M7 3.5 A3.5 3.5 0 1 1 0 3.5 A3.5 3.5 0 1 1 7 3.5 Z", cx + 4, fy + 11.5, 7, 7, "#ffffff");
  };
  medallion(RX + RW - 84);
  medallion(RX + RW - 65);
  medallion(RX + RW - 46);
  const qrTile = 25;
  p.rect(RX + RW - qrTile - 3, fy + 2.5, qrTile, qrTile, "#ffffff");
  p.qr(RX + RW - qrTile - 1, fy + 4.5, qrTile - 4, "https://fueleconomy.gov", BLACK);

  const boxBottom = fy + bandH;
  p.rect(RX, boxTop, RW, boxBottom - boxTop, null, BLACK, 1.8);
  return boxBottom;
}

// ── Right column: Government 5-Star Safety Ratings + Vehicle Passport ─

function paintSafetyContent(
  p: Painter,
  y: number,
  safetyW: number,
  pad: number,
  ctx: BuildContext,
  boxH?: number,
): number {
  const { theme, input } = ctx;
  const reg = input.data.regulatory;
  const headH = 15;
  p.rect(RX, y, safetyW, headH, theme.colors.headerBackground);
  p.text("GOVERNMENT 5-STAR SAFETY RATINGS", RX + safetyW / 2, y + 10, 6.6, "bold", theme.colors.headerText, { align: "center" });
  let cy = y + headH + 9 + pad / 2;
  const valueX = RX + safetyW - 6;
  const rated = reg.nhtsaStatus === "VERIFIED";
  const starOrNot = (stars: number | undefined, yy: number): void => {
    if (rated && stars !== undefined && stars >= 1) {
      drawStars(p, valueX - stars * 8.6, yy - 6, stars, 7, BLACK);
    } else {
      p.text("Not Rated", valueX, yy, 6.6, "bold", BLACK, { align: "right" });
    }
  };
  const explain = (text: string, yy: number): number => {
    let ey = yy;
    for (const line of wrapText(text, "body", 4.6, safetyW - 12)) {
      p.text(line, RX + 6, ey, 4.6, "body", BLACK);
      ey += 5.2;
    }
    return ey;
  };
  const divider = (yy: number): number => {
    p.rule(RX + 4, yy - 1, safetyW - 8, 0.6, BLACK);
    return yy + 7.5 + pad;
  };

  p.text("Overall Vehicle Score", RX + 6, cy, 7, "bold", BLACK);
  starOrNot(reg.overallRating, cy);
  cy = explain("Based on the combined ratings of frontal, side and rollover. Should ONLY be compared to other vehicles of similar size and weight.", cy + 6.5);
  cy = divider(cy);

  p.text("Frontal", RX + 6, cy, 7, "bold", BLACK);
  p.text("Crash", RX + 6, cy + 7.5, 7, "bold", BLACK);
  p.text("Driver", RX + 42, cy, 6.4, "body", BLACK);
  starOrNot(reg.frontalDriverRating, cy);
  p.text("Passenger", RX + 42, cy + 7.5, 6.4, "body", BLACK);
  starOrNot(reg.frontalPassengerRating, cy + 7.5);
  cy = explain("Based on the risk of injury in a frontal impact. Should ONLY be compared to other vehicles of similar size and weight.", cy + 14);
  cy = divider(cy);

  p.text("Side", RX + 6, cy, 7, "bold", BLACK);
  p.text("Crash", RX + 6, cy + 7.5, 7, "bold", BLACK);
  p.text("Front seat", RX + 42, cy, 6.4, "body", BLACK);
  starOrNot(reg.sideFrontRating, cy);
  p.text("Rear seat", RX + 42, cy + 7.5, 6.4, "body", BLACK);
  starOrNot(reg.sideRearRating, cy + 7.5);
  cy = explain("Based on the risk of injury in a side impact.", cy + 14);
  cy = divider(cy);

  p.text("Rollover", RX + 6, cy, 7, "bold", BLACK);
  starOrNot(reg.rolloverRating, cy);
  cy = explain("Based on the risk of rollover in a single-vehicle crash.", cy + 6.5);
  if (reg.nhtsaStatus === "NOT_RATED") {
    cy += 2;
    p.text("NOT RATED", RX + 6, cy, 6.6, "bold", BLACK);
    cy = explain("This vehicle has not been rated by the National Highway Traffic Safety Administration.", cy + 6);
  }
  cy += 2 + pad / 2;

  const srcLines = [
    "Star ratings range from 1 to 5 stars, with 5 being the highest.",
    "Source: National Highway Traffic Safety Administration (NHTSA).",
    "www.safercar.gov or 1-888-327-4236",
  ];
  const srcH = srcLines.length * 5.6 + 5;
  // The source band closes the panel: anchor it to the box bottom when the
  // box is stretched taller than the flowed content.
  const srcTop = boxH !== undefined ? Math.max(cy, y + boxH - srcH) : cy;
  p.rect(RX, srcTop, safetyW, srcH, theme.colors.headerBackground);
  let sy = srcTop + 6.8;
  for (const line of srcLines) {
    p.text(line, RX + safetyW / 2, sy, 4.8, "bold", theme.colors.headerText, { align: "center" });
    sy += 5.6;
  }
  return srcTop + srcH;
}

function paintSafetyAndPassport(p: Painter, y: number, ctx: BuildContext, targetH: number): number {
  const { theme, input } = ctx;
  const reg = input.data.regulatory;
  const showSafety = reg.nhtsaStatus !== "UNAVAILABLE";
  const passportUrl = input.data.document.passportUrl.trim();
  const navy = theme.colors.totalMsrpBackground;

  const safetyW = showSafety ? RW * 0.635 : 0;
  const passX = showSafety ? RX + safetyW + 6 : RX;
  const passW = IR - passX;
  let safetyBottom = y;
  let passBottom = y;

  if (showSafety) {
    // Measure at zero padding, then spread the slack across the sections so
    // the panel fills its stretch target like the OEM reference.
    const contentH = paintSafetyContent(new Painter(null), y, safetyW, 0, ctx) - y;
    const slack = Math.max(0, Math.min(targetH, contentH + 95) - contentH);
    const pad = Math.min(16, slack / 5);
    const padded = paintSafetyContent(new Painter(null), y, safetyW, pad, ctx) - y;
    const boxH = Math.min(Math.max(padded, Math.min(targetH, contentH + 95)), Math.max(targetH, 40));
    paintSafetyContent(p, y, safetyW, pad, ctx, boxH);
    p.rect(RX, y, safetyW, boxH, null, BLACK, 1);
    safetyBottom = y + boxH;
  }

  if (passportUrl) {
    const boxH = showSafety
      ? safetyBottom - y
      : Math.min(Math.max(150, targetH), 300);
    let cy = y + 13;
    p.text("Vehicle Passport", passX + passW / 2, cy, 9.5, "heading", navy, { align: "center" });
    cy += 4;
    for (const line of wrapText("Scan this code to view your vehicle's unique features, specs, warranty and more.", "body", 5.4, passW - 14)) {
      cy += 6.2;
      p.text(line, passX + passW / 2, cy, 5.4, "body", BLACK, { align: "center" });
    }
    const tailH = 34;
    const qrSize = Math.min(passW - 22, Math.max(56, y + boxH - tailH - cy - 10));
    p.qr(passX + (passW - qrSize) / 2, cy + (y + boxH - tailH - cy - qrSize) / 2 + 2, qrSize, passportUrl, BLACK);
    let ty = y + boxH - tailH + 4;
    p.text("Or visit", passX + passW / 2, ty, 5.4, "body", BLACK, { align: "center" });
    ty += 7;
    const shortUrl = passportUrl.replace(/^https?:\/\//i, "");
    p.text(ellipsize(shortUrl, "bold", 6, passW - 10), passX + passW / 2, ty, 6, "bold", BLACK, { align: "center" });
    ty += 6.5;
    p.text("and enter your", passX + passW / 2, ty, 5.4, "body", BLACK, { align: "center" });
    ty += 6;
    p.text("17-digit VIN.", passX + passW / 2, ty, 5.4, "body", BLACK, { align: "center" });
    passBottom = y + boxH;
    p.rect(passX, y, passW, boxH, null, navy, 1.2);
  }

  return Math.max(safetyBottom, passBottom);
}

// ── Right column: federal notice + verification + footer ──────────────

function paintNoticeRow(p: Painter, y: number, ctx: BuildContext): number {
  const { theme, input } = ctx;
  const navy = theme.colors.totalMsrpBackground;
  const noticeW = RW * 0.42;
  const boxH = 32;

  const noticeLines = [
    "This label has been applied",
    "pursuant to Federal law -",
    "Do not remove prior to delivery",
    "to the ultimate purchaser.",
  ];
  p.rect(RX, y, noticeW, boxH, null, navy, 1);
  let ny = y + 8;
  for (const line of noticeLines) {
    p.text(line, RX + 4, ny, 4.9, "body", navy);
    ny += 6;
  }

  const vx = RX + noticeW + 8;
  const vw = IR - vx;
  p.rect(vx, y, vw, boxH, navy);
  const verified = !input.generic && input.data.document.confidence !== "LOW";
  p.text("FACTORY BUILD DATA", vx + 8, y + 13.5, 7.2, "bold", "#ffffff");
  p.text(verified ? "VERIFIED BY AUTOLABELS" : "COMPILED BY AUTOLABELS", vx + 8, y + 23, 7.2, "bold", "#ffffff");
  const cbSize = 16;
  const cbX = vx + vw - cbSize - 8;
  p.rect(cbX, y + (boxH - cbSize) / 2, cbSize, cbSize, "#ffffff");
  p.path(CHECK_MARK, cbX + 1.5, y + (boxH - cbSize) / 2 + 1.5, 13, 13, null, navy, 2.2);
  return y + boxH;
}

function paintRightFooter(p: Painter, y: number, ctx: BuildContext, pageLabel: string): number {
  const { input } = ctx;
  let cy = y + 8;
  for (const disclaimer of input.disclaimers) {
    for (const line of wrapText(disclaimer, "body", 5.2, RW - 8)) {
      p.text(line, RX + RW / 2, cy, 5.2, "body", BLACK, { align: "center" });
      cy += 6.2;
    }
  }
  p.text(
    `GENERATED BY AUTOLABELS - ${input.data.document.sourceProvider} BUILD DATA - TEMPLATE ${input.data.document.templateVersion} - ${pageLabel}`,
    RX + RW / 2, cy, 4.6, "body", "#6b6f76", { align: "center" },
  );
  return cy;
}

// ── Continuation page ─────────────────────────────────────────────────

function flowColumns(
  p: Painter,
  entries: FlowEntry[],
  x0: number,
  y0: number,
  totalWidth: number,
  height: number,
  columns: number,
  ctx: BuildContext,
): { leftover: FlowEntry[]; usedHeight: number } {
  const { density } = ctx;
  const gap = 10;
  const colW = (totalWidth - gap * (columns - 1)) / columns;
  const headH = density.itemLh + 2.5;
  let col = 0;
  let cy = y0;
  let usedHeight = 0;
  let pendingHeading: string | null = null;

  const colX = (): number => x0 + col * (colW + gap);
  const advanceColumn = (): boolean => {
    col++;
    cy = y0;
    return col < columns;
  };

  let idx = 0;
  while (idx < entries.length) {
    const entry = entries[idx];
    if (entry.heading !== undefined) {
      pendingHeading = entry.heading;
      idx++;
      continue;
    }
    const itemH = entry.lines.length * density.itemLh;
    const needed = (pendingHeading !== null ? headH : 0) + itemH;
    if (cy + needed > y0 + height) {
      if (!advanceColumn()) break;
      continue;
    }
    if (pendingHeading !== null) {
      cy += density.itemLh;
      p.text(pendingHeading, colX(), cy, density.item + 0.5, "bold", BLACK);
      cy += 2.5;
      pendingHeading = null;
    }
    cy = paintEntryLines(p, entry, colX(), cy, density, BLACK);
    usedHeight = Math.max(usedHeight, cy - y0);
    idx++;
  }

  const leftover: FlowEntry[] = [];
  if (idx < entries.length) {
    if (pendingHeading !== null) leftover.push({ heading: pendingHeading, lines: [] });
    for (let i = idx; i < entries.length; i++) leftover.push(entries[i]);
  }
  return { leftover, usedHeight };
}

function paintContinuationPage(
  drawn: string[],
  ctx: BuildContext,
  leftover: FlowEntry[],
): LayoutPage {
  const p = new Painter(drawn);
  const { theme, input } = ctx;
  const v = input.data.vehicle;
  const fullW = PAGE_WIDTH - 2 * PAGE_MARGIN;
  const nameParts = [v.year > 0 ? String(v.year) : "", v.make, v.model, v.trim ?? ""].filter(Boolean);
  p.text(nameParts.join(" ").toUpperCase(), PAGE_MARGIN, 21, 11, "bold", BLACK);
  p.text(`VIN: ${v.vin}`, PAGE_WIDTH - PAGE_MARGIN, 21, 7.5, "bold", BLACK, { align: "right" });
  p.rule(PAGE_MARGIN, 25, fullW, 1, BLACK);
  p.text(headingCase(theme, "Factory Equipment Continuation"), PAGE_MARGIN, 38, 9, "bold", BLACK, {
    charSpacing: parseEm(theme.typography.headingLetterSpacing) * 9,
  });
  p.text(
    `Continuation of the factory build record for VIN ${v.vin}. This page belongs to the sticker on page 1 and is not valid on its own.`,
    PAGE_MARGIN, 48, 6, "body", "#6b6f76",
  );
  const colsTop = 56;
  const colsH = PAGE_HEIGHT - PAGE_MARGIN - 14 - colsTop;
  const withContinuedHeading: FlowEntry[] =
    leftover[0] && leftover[0].heading === undefined
      ? [{ heading: headingCase(theme, "Continued"), lines: [] }, ...leftover]
      : leftover;
  flowColumns(p, withContinuedHeading, PAGE_MARGIN, colsTop, fullW, colsH, 4, ctx);
  p.text("PAGE 2 OF 2", PAGE_WIDTH - PAGE_MARGIN, PAGE_HEIGHT - PAGE_MARGIN - 2, 5.5, "bold", "#6b6f76", { align: "right" });
  return { primitives: p.primitives };
}

// ── Validation ────────────────────────────────────────────────────────

function validateModel(model: LayoutModel): void {
  const bad = (msg: string): never => {
    throw new Error(`layout invariant violated: ${msg}`);
  };
  for (const [pi, page] of model.pages.entries()) {
    for (const prim of page.primitives) {
      if (prim.kind === "text") {
        if (!prim.str || !prim.str.trim()) bad(`empty string on page ${pi + 1}`);
        if (/\b(undefined|null|NaN)\b/.test(prim.str)) bad(`placeholder artifact ${JSON.stringify(prim.str)}`);
        if (prim.size < MIN_BODY_FONT_SIZE) bad(`font size ${prim.size} below minimum`);
        const box = textBBox(prim);
        if (box.x0 < PAGE_MARGIN - 0.51 || box.x1 > PAGE_WIDTH - PAGE_MARGIN + 0.51 ||
            box.y0 < PAGE_MARGIN - prim.size || box.y1 > PAGE_HEIGHT - PAGE_MARGIN + 0.51) {
          bad(`text out of bounds on page ${pi + 1}: ${JSON.stringify(prim.str)}`);
        }
      } else {
        const w = prim.kind === "qr" ? prim.size : prim.w;
        const h = prim.kind === "qr" ? prim.size : prim.h;
        if (prim.x < PAGE_MARGIN - 0.01 || prim.y < PAGE_MARGIN - 0.01 ||
            prim.x + w > PAGE_WIDTH - PAGE_MARGIN + 0.01 || prim.y + h > PAGE_HEIGHT - PAGE_MARGIN + 0.01) {
          bad(`${prim.kind} out of bounds on page ${pi + 1}`);
        }
        if ((prim.kind === "barcode" || prim.kind === "qr") && !prim.payload) {
          bad(`${prim.kind} with empty payload`);
        }
      }
    }
  }
  if (model.pages.length < 1 || model.pages.length > 2) bad(`page count ${model.pages.length}`);
}

// ── Assembly ──────────────────────────────────────────────────────────

function measureStack(
  sections: Array<(p: Painter, y: number) => number>,
): number {
  const scratch = new Painter(null);
  let y = 0;
  for (const section of sections) y = section(scratch, y);
  return y;
}

function buildAttempt(
  input: StickerLayoutInput,
  theme: OemStickerTheme,
  density: Density,
  allowContinuation: boolean,
): LayoutModel | null {
  const ctx: BuildContext = { input, theme, density };
  const drawn: string[] = [];
  const p = new Painter(drawn);

  // Outer border + column divider.
  p.rect(PAGE_MARGIN, PAGE_MARGIN, PAGE_WIDTH - 2 * PAGE_MARGIN, PAGE_HEIGHT - 2 * PAGE_MARGIN, null, BLACK, 1.8);

  const stripBottom = paintTopStrip(p, ctx);
  p.rule(SPLIT_X, stripBottom, 1.1, PAGE_HEIGHT - PAGE_MARGIN - stripBottom, BLACK);

  let y = paintHeader(p, stripBottom + 2, ctx);

  // The pricing split follows the equipment block directly; the spec grid,
  // barcode and navy band anchor together at the page bottom, so any slack
  // lands between the optional list and the spec grid as on the reference.
  const bottomH = measureStack([
    (sp, sy) => paintSpecGrid(sp, sy, ctx),
    (sp, sy) => paintVinBarcode(sp, sy, ctx) + SECTION_GAP,
    (sp, sy) => paintTotalBand(sp, sy, ctx),
  ]);
  const pricingH = measureStack([(sp, sy) => paintPricingSplit(sp, sy, ctx) + SECTION_GAP]);

  const hasStandard = input.data.equipment.standard.some((g) => g.items.length > 0);
  const stdBudget = hasStandard
    ? Math.max(40, CONTENT_BOTTOM - y - bottomH - pricingH - SECTION_GAP)
    : 0;

  let leftover: FlowEntry[] = [];
  if (hasStandard) {
    const result = paintStandardEquipment(p, y, stdBudget, ctx);
    leftover = result.leftover;
    y = result.yEnd;
  }
  if (leftover.length && !allowContinuation) return null;

  y = paintPricingSplit(p, y + 3, ctx);
  const bottomTop = CONTENT_BOTTOM - bottomH;
  if (y + SECTION_GAP > bottomTop + 0.5) return null;
  y = paintSpecGrid(p, bottomTop, ctx);
  y = paintVinBarcode(p, y, ctx) + SECTION_GAP;
  paintTotalBand(p, y, ctx);

  // Right column: EPA panel at the top, notice row and footer pinned to the
  // bottom, and the safety/passport row stretched to fill the space between.
  const pages = leftover.length ? 2 : 1;
  const pageLabel = pages === 2 ? "PAGE 1 OF 2 - EQUIPMENT CONTINUED ON PAGE 2" : "PAGE 1 OF 1";
  const noticeH = measureStack([(sp, sy) => paintNoticeRow(sp, sy, ctx)]);
  const footerH = measureStack([(sp, sy) => paintRightFooter(sp, sy, ctx, pageLabel)]);
  const epaBottom = paintEpaPanel(p, stripBottom + 4, ctx);
  const noticeTop = CONTENT_BOTTOM - footerH - 4 - noticeH;
  const rowTop = epaBottom > stripBottom + 4 ? epaBottom + 5 : stripBottom + 4;
  paintSafetyAndPassport(p, rowTop, ctx, noticeTop - 5 - rowTop);
  const afterNotice = paintNoticeRow(p, noticeTop, ctx);
  paintRightFooter(p, afterNotice, ctx, pageLabel);

  const layoutPages: LayoutPage[] = [{ primitives: p.primitives }];
  if (leftover.length) {
    layoutPages.push(paintContinuationPage(drawn, ctx, leftover));
  }

  const model: LayoutModel = {
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT,
    mode: leftover.length ? "CONTINUATION_REQUIRED" : density.mode,
    pages: layoutPages,
    drawnStrings: drawn,
    fontFamilies: {
      heading: theme.typography.headingFont,
      body: theme.typography.bodyFont,
      numeric: theme.typography.numericFont,
    },
  };
  validateModel(model);
  return model;
}

export function buildStickerLayout(input: StickerLayoutInput, theme: OemStickerTheme): LayoutModel {
  const large = buildAttempt(input, theme, DENSITY_LARGE, false);
  if (large) return large;
  const standard = buildAttempt(input, theme, DENSITY_STANDARD, false);
  if (standard) return standard;
  const dense = buildAttempt(input, theme, DENSITY_DENSE, false);
  if (dense) return dense;
  const floor = buildAttempt(input, theme, DENSITY_FLOOR, true);
  if (!floor) throw new Error("layout_failed: content cannot fit even with continuation");
  return floor;
}
