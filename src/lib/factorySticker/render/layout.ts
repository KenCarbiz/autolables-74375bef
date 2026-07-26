// Deterministic, pdf-agnostic layout engine for the Factory Window Sticker.
// Consumes FactoryStickerData + an OemStickerTheme and produces a LayoutModel
// of drawing primitives in points on a 792x612 letter-landscape page, with
// measurement-based content fit, density fallback, and a continuation page.

import type { FactoryStickerData, EquipmentCategory } from "../types.ts";
import type { OemStickerTheme } from "../oem/themes.ts";

export const PAGE_WIDTH = 792;
export const PAGE_HEIGHT = 612;
export const PAGE_MARGIN = 9;
export const MIN_BODY_FONT_SIZE = 5.5;

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

export type LayoutPrimitive =
  | TextPrimitive
  | RulePrimitive
  | RectPrimitive
  | BarcodePrimitive
  | QrPrimitive;

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
    .replace(/[ \s]+/g, " ")
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

const parseEm = (v: string): number => {
  const m = /^(-?[\d.]+)em$/.exec(v.trim());
  return m ? Number(m[1]) : 0;
};

const parsePt = (v: string): number => {
  const m = /^(-?[\d.]+)pt$/.exec(v.trim());
  return m ? Number(m[1]) : 0.75;
};

interface Density {
  mode: LayoutMode;
  item: number;
  itemLh: number;
  row: number;
  rowLh: number;
  head: number;
}

const DENSITY_STANDARD: Density = { mode: "STANDARD", item: 6.5, itemLh: 8.2, row: 7, rowLh: 9.2, head: 7.5 };
const DENSITY_DENSE: Density = { mode: "DENSE", item: 5.9, itemLh: 7.4, row: 6.5, rowLh: 8.4, head: 7 };
const DENSITY_FLOOR: Density = { mode: "CONTINUATION_REQUIRED", item: 5.5, itemLh: 6.9, row: 6, rowLh: 7.8, head: 7 };

const CATEGORY_LABELS: Record<EquipmentCategory, string> = {
  EXTERIOR: "Exterior",
  INTERIOR: "Interior",
  COMFORT_CONVENIENCE: "Comfort & Convenience",
  FUNCTIONAL: "Functional",
  POWERTRAIN: "Powertrain & Mechanical",
  SAFETY_SECURITY: "Safety & Security",
  TECHNOLOGY: "Technology",
  OTHER: "Additional Equipment",
};

const LEFT_X = PAGE_MARGIN;
const LEFT_W = 546;
const RIGHT_X = 567;
const RIGHT_W = PAGE_WIDTH - PAGE_MARGIN - RIGHT_X;
const CONTENT_BOTTOM = PAGE_HEIGHT - PAGE_MARGIN;
const SECTION_GAP = 5;

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
}

interface FlowEntry {
  heading?: string;
  lines: string[];
}

interface BuildContext {
  input: StickerLayoutInput;
  theme: OemStickerTheme;
  density: Density;
}

const headingCase = (theme: OemStickerTheme, s: string): string =>
  theme.typography.uppercaseSectionHeadings ? s.toUpperCase() : s;

const priceLabel = (item: { price?: number; priceStatus: string }): string => {
  if (item.priceStatus === "INCLUDED") return "INCLUDED";
  if (item.priceStatus === "NO_CHARGE") return "NO CHARGE";
  if (item.price !== undefined) return formatMoney(item.price);
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
  theme: OemStickerTheme,
): void {
  const priceW = measureText(price, "numeric", size);
  const nameMax = rowRight - x - priceW - 10;
  const shown = ellipsize(name, nameFont, size, nameMax);
  p.text(shown, x, y, size, nameFont, theme.colors.bodyText);
  const nameW = measureText(shown, nameFont, size);
  const dotW = measureText(".", "body", size);
  const gapStart = x + nameW + 3;
  const gapEnd = rowRight - priceW - 4;
  const dots = Math.floor((gapEnd - gapStart) / dotW);
  if (dots > 0) {
    p.text(".".repeat(dots), gapStart, y, size, "body", theme.colors.mutedText);
  }
  p.text(price, rowRight, y, size, "numeric", theme.colors.bodyText, { align: "right" });
}

// ── Section painters. Each takes a painter and a top-y and returns the new y.
// Measurement runs the same painter code against a scratch painter, so the
// measured height is exactly the painted height.

function paintTopStrip(p: Painter, y: number, ctx: BuildContext): number {
  const { data } = ctx.input;
  const v = data.vehicle;
  const cells: Array<[string, string]> = [];
  if (v.exteriorColorCode || v.exteriorColor) {
    cells.push(["EXT", [v.exteriorColorCode, v.exteriorColor].filter(Boolean).join(" ")]);
  }
  if (v.interiorColorCode || v.interiorColor) {
    cells.push(["INT", [v.interiorColorCode, v.interiorColor].filter(Boolean).join(" ")]);
  }
  if (ctx.input.data.factory.orderNumber) cells.push(["ORDER", ctx.input.data.factory.orderNumber]);
  if (ctx.input.data.factory.dealerCode) cells.push(["DLR", ctx.input.data.factory.dealerCode]);
  if (v.stockNumber) cells.push(["STOCK", v.stockNumber]);
  cells.push(["VIN", v.vin]);
  if (!cells.length) return y;
  const size = 5.5;
  const baseline = y + size;
  const cellW = LEFT_W / cells.length;
  cells.forEach(([label, value], i) => {
    const cx = LEFT_X + i * cellW;
    p.text(`${label}:`, cx, baseline, size, "bold", ctx.theme.colors.mutedText);
    const labelW = measureText(`${label}:`, "bold", size) + 3;
    const shown = ellipsize(value, "numeric", size, cellW - labelW - 4);
    p.text(shown, cx + labelW, baseline, size, "numeric", ctx.theme.colors.bodyText);
  });
  const ruleY = baseline + 3;
  p.rule(LEFT_X, ruleY, LEFT_W, 0.5, ctx.theme.colors.divider);
  return ruleY + 3;
}

function paintHeaderBand(p: Painter, y: number, ctx: BuildContext): number {
  const { theme, input } = ctx;
  const bandH = 30;
  const banded = theme.layout.headerVariant === "BANDED" || theme.layout.headerVariant === "BLOCK";
  const textColor = banded ? theme.colors.headerText : theme.colors.bodyText;
  if (banded) {
    p.rect(LEFT_X, y, LEFT_W, bandH, theme.colors.headerBackground);
  } else {
    p.rule(LEFT_X, y + bandH, LEFT_W, parsePt(theme.layout.borderWeight) + 0.5, theme.colors.headerBackground);
  }
  const wordmarkSize = 15;
  const spacing = parseEm(theme.logo.wordmarkLetterSpacing) * wordmarkSize;
  p.text(theme.logo.wordmarkText, LEFT_X + 8, y + 20, wordmarkSize, "heading", textColor, {
    charSpacing: spacing,
  });
  p.text(headingCase(theme, input.title).toUpperCase(), LEFT_X + LEFT_W - 8, y + 13, 7, "bold", textColor, {
    align: "right",
  });
  const sub = input.generic
    ? "TYPICAL FACTORY CONFIGURATION FOR THIS TRIM - NOT VIN-SPECIFIC"
    : "COMPILED FROM VIN-SPECIFIC FACTORY BUILD DATA";
  p.text(sub, LEFT_X + LEFT_W - 8, y + 23, 5.5, "body", textColor, { align: "right" });
  return y + bandH + 4;
}

function paintIdentity(p: Painter, y: number, ctx: BuildContext): number {
  const { data } = ctx.input;
  const v = data.vehicle;
  const theme = ctx.theme;
  const nameParts = [v.year > 0 ? String(v.year) : "", v.make, v.model, v.trim ?? ""].filter(Boolean);
  const modelLine = nameParts.join(" ").toUpperCase();
  let cursor = y + 12;
  p.text(ellipsize(modelLine, "bold", 12.5, LEFT_W), LEFT_X, cursor, 12.5, "bold", theme.colors.bodyText);
  cursor += 9.5;
  const colorBits: string[] = [];
  if (v.exteriorColor) colorBits.push(`EXTERIOR: ${v.exteriorColor.toUpperCase()}`);
  if (v.interiorColor) colorBits.push(`INTERIOR: ${v.interiorColor.toUpperCase()}`);
  if (colorBits.length) {
    p.text(ellipsize(colorBits.join("   "), "body", 6.8, LEFT_W), LEFT_X, cursor, 6.8, "body", theme.colors.bodyText);
    cursor += 8.5;
  }
  const specBits = [`VIN: ${v.vin}`];
  if (v.bodyStyle) specBits.push(`BODY: ${v.bodyStyle.toUpperCase()}`);
  if (v.drivetrain) specBits.push(`DRIVE: ${v.drivetrain.toUpperCase()}`);
  if (v.fuelType) specBits.push(`FUEL: ${v.fuelType.toUpperCase()}`);
  p.text(ellipsize(specBits.join("   "), "numeric", 6.5, LEFT_W), LEFT_X, cursor, 6.5, "numeric", theme.colors.bodyText);
  cursor += 4;
  p.rule(LEFT_X, cursor, LEFT_W, parsePt(ctx.theme.layout.borderWeight), theme.colors.divider);
  return cursor + SECTION_GAP;
}

function equipmentFlowEntries(ctx: BuildContext, colWidth: number): FlowEntry[] {
  const { density } = ctx;
  const entries: FlowEntry[] = [];
  for (const group of ctx.input.data.equipment.standard) {
    if (!group.items.length) continue;
    entries.push({ heading: headingCase(ctx.theme, CATEGORY_LABELS[group.category]), lines: [] });
    for (const item of group.items) {
      const lines = wrapText(sanitize(item), "body", density.item, colWidth);
      if (lines.length) entries.push({ lines });
    }
  }
  return entries;
}

interface FlowResult {
  leftover: FlowEntry[];
  usedHeight: number;
}

function flowColumns(
  p: Painter,
  entries: FlowEntry[],
  x0: number,
  y0: number,
  totalWidth: number,
  height: number,
  columns: number,
  ctx: BuildContext,
): FlowResult {
  const { density, theme } = ctx;
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
      p.text(pendingHeading, colX(), cy, density.item + 0.5, "bold", theme.colors.sectionHeadingText);
      cy += 2.5;
      pendingHeading = null;
    }
    for (const line of entry.lines) {
      cy += density.itemLh;
      p.text(line, colX(), cy, density.item, "body", theme.colors.bodyText);
    }
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

function paintStandardEquipment(
  p: Painter,
  y: number,
  height: number,
  ctx: BuildContext,
): { yEnd: number; leftover: FlowEntry[] } {
  const { theme, density } = ctx;
  const entries = equipmentFlowEntries(ctx, (LEFT_W - 30) / 4);
  if (!entries.length) return { yEnd: y, leftover: [] };
  let cursor = y + density.head;
  p.text(headingCase(theme, "Standard Equipment"), LEFT_X, cursor, density.head, "bold", theme.colors.sectionHeadingText, {
    charSpacing: parseEm(theme.typography.headingLetterSpacing) * density.head,
  });
  cursor += 2.5;
  p.rule(LEFT_X, cursor, LEFT_W, 0.5, theme.colors.divider);
  cursor += 1;
  const colsBudget = Math.max(0, height - (cursor - y));

  // Balance across the four columns: start from the ideal per-column height
  // and grow until everything fits (or the budget is exhausted), so short
  // equipment lists spread wide instead of stacking into column one.
  const headH = density.itemLh + 2.5;
  const totalNeeded = entries.reduce(
    (a, e) => a + (e.heading !== undefined ? headH : e.lines.length * density.itemLh),
    0,
  );
  let target = Math.min(colsBudget, Math.max(headH * 2, Math.ceil(totalNeeded / 4) + headH));
  let scratch = flowColumns(new Painter(null), entries, LEFT_X, cursor, LEFT_W, target, 4, ctx);
  while (scratch.leftover.length && target < colsBudget) {
    target = Math.min(colsBudget, target * 1.2 + density.itemLh);
    scratch = flowColumns(new Painter(null), entries, LEFT_X, cursor, LEFT_W, target, 4, ctx);
  }
  const { leftover, usedHeight } = flowColumns(p, entries, LEFT_X, cursor, LEFT_W, target, 4, ctx);
  return { yEnd: cursor + usedHeight, leftover };
}

function paintIncluded(p: Painter, y: number, ctx: BuildContext): number {
  const { theme, density } = ctx;
  const packages = ctx.input.data.equipment.packages;
  if (!packages.length) return y;
  let cursor = y + density.head;
  p.text(headingCase(theme, "Included On This Vehicle"), LEFT_X, cursor, density.head, "bold", theme.colors.sectionHeadingText, {
    charSpacing: parseEm(theme.typography.headingLetterSpacing) * density.head,
  });
  cursor += 2.5;
  p.rule(LEFT_X, cursor, LEFT_W, 0.5, theme.colors.divider);
  for (const pkg of packages) {
    cursor += density.rowLh;
    const label = [pkg.code, pkg.name].filter(Boolean).join(" - ");
    leaderRow(p, LEFT_X, LEFT_X + LEFT_W, cursor, label.toUpperCase(), priceLabel(pkg), density.row, "bold", theme);
    if (pkg.features.length) {
      const colGap = 10;
      const colW = (LEFT_W - 12 - colGap) / 2;
      const lines = pkg.features.map((f) => ellipsize(`- ${f}`, "body", density.item, colW));
      const rows = Math.ceil(lines.length / 2);
      for (let r = 0; r < rows; r++) {
        cursor += density.itemLh;
        p.text(lines[r], LEFT_X + 12, cursor, density.item, "body", theme.colors.bodyText);
        const second = lines[r + rows];
        if (second !== undefined) {
          p.text(second, LEFT_X + 12 + colW + colGap, cursor, density.item, "body", theme.colors.bodyText);
        }
      }
    }
  }
  return cursor + SECTION_GAP;
}

function paintOptional(p: Painter, y: number, ctx: BuildContext): number {
  const { theme, density } = ctx;
  const options = ctx.input.data.equipment.options;
  const destination = ctx.input.data.pricing.destinationCharge;
  if (!options.length && destination === undefined) return y;
  let cursor = y;
  if (options.length) {
    cursor += density.head;
    p.text(headingCase(theme, "Optional Equipment"), LEFT_X, cursor, density.head, "bold", theme.colors.sectionHeadingText, {
      charSpacing: parseEm(theme.typography.headingLetterSpacing) * density.head,
    });
    cursor += 2.5;
    p.rule(LEFT_X, cursor, LEFT_W, 0.5, theme.colors.divider);
    for (const opt of options) {
      cursor += density.rowLh;
      const label = [opt.code, opt.name].filter(Boolean).join(" - ");
      leaderRow(p, LEFT_X, LEFT_X + LEFT_W, cursor, label.toUpperCase(), priceLabel(opt), density.row, "body", theme);
    }
  }
  if (destination !== undefined) {
    cursor += density.rowLh + 1;
    leaderRow(p, LEFT_X, LEFT_X + LEFT_W, cursor, headingCase(theme, "Destination & Handling"), formatMoney(destination), density.row, "bold", theme);
  }
  return cursor + SECTION_GAP;
}

function paintRollup(p: Painter, y: number, ctx: BuildContext): number {
  const { theme, density } = ctx;
  const pricing = ctx.input.data.pricing;
  const rows: Array<[string, string]> = [];
  if (pricing.baseMsrp !== undefined) rows.push(["BASE MSRP", formatMoney(pricing.baseMsrp)]);
  const optTotal = pricing.factoryInstalledTotal ??
    (pricing.packagesTotal !== undefined || pricing.optionsTotal !== undefined
      ? (pricing.packagesTotal ?? 0) + (pricing.optionsTotal ?? 0)
      : undefined);
  if (optTotal !== undefined) rows.push(["FACTORY OPTIONS & PACKAGES", formatMoney(optTotal)]);
  if (pricing.destinationCharge !== undefined) rows.push(["DESTINATION & HANDLING", formatMoney(pricing.destinationCharge)]);
  if (!rows.length) return y;
  const boxPad = 5;
  const rowH = density.rowLh;
  const boxH = rows.length * rowH + boxPad * 2 - 2;
  const boxed = theme.layout.pricingVariant === "BOXED";
  if (boxed) {
    p.rect(LEFT_X, y, LEFT_W, boxH, null, theme.colors.divider, parsePt(theme.layout.borderWeight));
  }
  let cursor = y + boxPad;
  const inset = boxed ? 8 : 0;
  for (const [label, amount] of rows) {
    cursor += rowH - 2;
    p.text(label, LEFT_X + inset, cursor, density.row, "bold", theme.colors.bodyText);
    p.text(amount, LEFT_X + LEFT_W - inset, cursor, density.row, "numeric", theme.colors.bodyText, { align: "right" });
    if (theme.layout.pricingVariant === "UNDERLINED") {
      p.rule(LEFT_X, cursor + 2, LEFT_W, 0.5, theme.colors.divider);
    }
    cursor += 2;
  }
  return y + boxH + 3;
}

function paintTotalBanner(p: Painter, y: number, ctx: BuildContext): number {
  const { theme } = ctx;
  const pricing = ctx.input.data.pricing;
  const condition = ctx.input.data.vehicle.condition;
  const label = condition === "NEW"
    ? "TOTAL FACTORY MSRP"
    : "TOTAL ORIGINAL MSRP WHEN NEW";
  const total = pricing.sourceReportedTotalMsrp ?? pricing.calculatedTotalMsrp;
  const bannerH = 24;
  p.rect(LEFT_X, y, LEFT_W, bannerH, theme.colors.totalMsrpBackground);
  p.text(label, LEFT_X + 10, y + 15.5, 10, "bold", theme.colors.totalMsrpText, {
    charSpacing: parseEm(theme.typography.headingLetterSpacing) * 10,
  });
  const amount = total !== undefined ? formatMoney(total) : "SEE DEALER";
  p.text(amount, LEFT_X + LEFT_W - 10, y + 17, 15, "numeric", theme.colors.totalMsrpText, { align: "right" });
  return y + bannerH + SECTION_GAP;
}

function paintFactoryStrip(p: Painter, y: number, ctx: BuildContext): number {
  const { theme } = ctx;
  const v = ctx.input.data.vehicle;
  const f = ctx.input.data.factory;
  const cells: Array<[string, string]> = [];
  const assembly = [f.assemblyPlant, f.finalAssemblyPoint ?? f.assemblyCountry].filter(Boolean).join(", ");
  if (assembly) cells.push(["FINAL ASSEMBLY", assembly]);
  if (f.transportMethod) cells.push(["TRANSPORT", f.transportMethod]);
  if (v.engine) cells.push(["ENGINE", v.engine]);
  if (v.transmission) cells.push(["TRANSMISSION", v.transmission]);
  if (v.stockNumber) cells.push(["STOCK", v.stockNumber]);
  if (!cells.length) return y;
  const stripH = 18;
  p.rule(LEFT_X, y, LEFT_W, 0.5, theme.colors.divider);
  const cellW = LEFT_W / cells.length;
  cells.forEach(([label, value], i) => {
    const cx = LEFT_X + i * cellW;
    p.text(label, cx, y + 7.5, 5.5, "bold", theme.colors.mutedText);
    p.text(ellipsize(value.toUpperCase(), "body", 6, cellW - 6), cx, y + 15, 6, "body", theme.colors.bodyText);
  });
  p.rule(LEFT_X, y + stripH, LEFT_W, 0.5, theme.colors.divider);
  return y + stripH + SECTION_GAP;
}

function paintBottomRow(p: Painter, y: number, ctx: BuildContext): number {
  const { theme, input } = ctx;
  const barcodeW = 190;
  const barcodeH = 24;
  const showBarcode = theme.layout.barcodeVariant !== "NONE";
  if (showBarcode) {
    p.barcode(LEFT_X, y, barcodeW, barcodeH, input.barcodePayload, theme.colors.bodyText);
    p.text(input.data.vehicle.vin, LEFT_X + barcodeW / 2, y + barcodeH + 7, 6.5, "numeric", theme.colors.bodyText, {
      align: "center",
    });
  } else {
    p.text(input.data.vehicle.vin, LEFT_X, y + 12, 8, "numeric", theme.colors.bodyText);
  }

  const noticeX = LEFT_X + barcodeW + 14;
  const noticeW = LEFT_X + LEFT_W - noticeX;
  const barH = 11;
  p.rect(noticeX, y, noticeW, barH, theme.colors.accent);
  const barText = input.generic || input.data.document.confidence === "LOW"
    ? "FACTORY BUILD DATA COMPILED BY AUTOLABELS"
    : "FACTORY BUILD DATA VERIFIED BY AUTOLABELS";
  p.text(barText, noticeX + noticeW / 2, y + 7.5, 6, "bold", "#ffffff", { align: "center" });
  const notice = input.data.vehicle.condition === "NEW"
    ? "This document supplements and does not replace the manufacturer's federal Monroney label required by 15 U.S.C. 1232."
    : "This is a reconstructed factory build record, not the original federal Monroney label affixed at manufacture.";
  let ny = y + barH + 2;
  for (const line of wrapText(notice, "body", 5.5, noticeW)) {
    ny += 6.6;
    p.text(line, noticeX, ny, 5.5, "body", theme.colors.mutedText);
  }
  return Math.max(y + (showBarcode ? barcodeH + 10 : 16), ny + 2) + 2;
}

function paintFooter(p: Painter, y: number, ctx: BuildContext, pageLabel: string): number {
  const { theme, input } = ctx;
  let cursor = y;
  for (const disclaimer of input.disclaimers) {
    for (const line of wrapText(disclaimer, "body", 5.5, LEFT_W)) {
      cursor += 6.6;
      p.text(line, LEFT_X, cursor, 5.5, "body", theme.colors.mutedText);
    }
  }
  cursor += 7.5;
  p.text(
    `GENERATED BY AUTOLABELS - ${input.data.document.sourceProvider} BUILD DATA - TEMPLATE ${input.data.document.templateVersion}`,
    LEFT_X,
    cursor,
    5.5,
    "body",
    theme.colors.mutedText,
  );
  p.text(pageLabel, LEFT_X + LEFT_W, cursor, 5.5, "bold", theme.colors.mutedText, { align: "right" });
  return cursor;
}

function measureStack(
  ctx: BuildContext,
  sections: Array<(p: Painter, y: number) => number>,
): number {
  const scratch = new Painter(null);
  let y = 0;
  for (const section of sections) y = section(scratch, y);
  return y;
}

function paintRightPanel(p: Painter, ctx: BuildContext): void {
  const { theme, input } = ctx;
  const reg = input.data.regulatory;
  const border = parsePt(theme.layout.borderWeight);
  let ry = PAGE_MARGIN;

  if (reg.epaStatus === "VERIFIED") {
    const rows: Array<[string, string]> = [];
    if (reg.cityMpg !== undefined) rows.push(["CITY", String(reg.cityMpg)]);
    if (reg.highwayMpg !== undefined) rows.push(["HIGHWAY", String(reg.highwayMpg)]);
    if (reg.annualFuelCost !== undefined) rows.push(["EST. ANNUAL FUEL COST", formatMoney(reg.annualFuelCost)]);
    if (reg.greenhouseGasRating !== undefined) rows.push(["GREENHOUSE GAS RATING", `${reg.greenhouseGasRating} / 10`]);
    if (reg.smogRating !== undefined) rows.push(["SMOG RATING", `${reg.smogRating} / 10`]);
    const hasCombined = reg.combinedMpg !== undefined;
    const boxH = 24 + (hasCombined ? 30 : 0) + rows.length * 9 + 16;
    p.rect(RIGHT_X, ry, RIGHT_W, boxH, null, theme.colors.divider, border);
    p.rect(RIGHT_X, ry, RIGHT_W, 14, theme.colors.headerBackground);
    p.text("EPA FUEL ECONOMY", RIGHT_X + RIGHT_W / 2, ry + 9.5, 7, "bold", theme.colors.headerText, { align: "center" });
    let cy = ry + 22;
    if (hasCombined) {
      p.text(String(reg.combinedMpg), RIGHT_X + RIGHT_W / 2, cy + 14, 20, "bold", theme.colors.bodyText, { align: "center" });
      p.text("COMBINED MPG", RIGHT_X + RIGHT_W / 2, cy + 22, 5.5, "body", theme.colors.mutedText, { align: "center" });
      cy += 30;
    }
    for (const [label, value] of rows) {
      cy += 9;
      p.text(label, RIGHT_X + 8, cy, 6, "body", theme.colors.bodyText);
      p.text(value, RIGHT_X + RIGHT_W - 8, cy, 6, "numeric", theme.colors.bodyText, { align: "right" });
    }
    cy += 9;
    p.text("Actual results will vary.", RIGHT_X + 8, cy, 5.5, "body", theme.colors.mutedText);
    ry += boxH + 7;
  }

  if (reg.nhtsaStatus !== "UNAVAILABLE") {
    const rows: Array<[string, number]> = [];
    if (reg.overallRating !== undefined) rows.push(["OVERALL VEHICLE SCORE", reg.overallRating]);
    if (reg.frontalDriverRating !== undefined) rows.push(["FRONTAL CRASH - DRIVER", reg.frontalDriverRating]);
    if (reg.frontalPassengerRating !== undefined) rows.push(["FRONTAL CRASH - PASSENGER", reg.frontalPassengerRating]);
    if (reg.sideFrontRating !== undefined) rows.push(["SIDE CRASH - FRONT SEAT", reg.sideFrontRating]);
    if (reg.sideRearRating !== undefined) rows.push(["SIDE CRASH - REAR SEAT", reg.sideRearRating]);
    if (reg.rolloverRating !== undefined) rows.push(["ROLLOVER", reg.rolloverRating]);
    const rated = reg.nhtsaStatus === "VERIFIED" && rows.length > 0;
    const notRatedLines = wrapText(
      "This vehicle has not been rated by the National Highway Traffic Safety Administration.",
      "body", 6, RIGHT_W - 16,
    );
    const boxH = 22 + (rated ? rows.length * 9 + 14 : notRatedLines.length * 7.5 + 8);
    p.rect(RIGHT_X, ry, RIGHT_W, boxH, null, theme.colors.divider, border);
    p.rect(RIGHT_X, ry, RIGHT_W, 14, theme.colors.headerBackground);
    p.text("GOVERNMENT 5-STAR SAFETY RATINGS", RIGHT_X + RIGHT_W / 2, ry + 9.5, 6, "bold", theme.colors.headerText, { align: "center" });
    let cy = ry + 20;
    if (rated) {
      for (const [label, stars] of rows) {
        cy += 9;
        p.text(label, RIGHT_X + 8, cy, 6, "body", theme.colors.bodyText);
        p.text(`${stars} OF 5 STARS`, RIGHT_X + RIGHT_W - 8, cy, 6, "numeric", theme.colors.bodyText, { align: "right" });
      }
      cy += 10;
      p.text("Source: safercar.gov", RIGHT_X + 8, cy, 5.5, "body", theme.colors.mutedText);
    } else {
      p.text("NOT RATED", RIGHT_X + 8, cy + 4, 6.5, "bold", theme.colors.bodyText);
      cy += 6;
      for (const line of notRatedLines) {
        cy += 7.5;
        p.text(line, RIGHT_X + 8, cy, 6, "body", theme.colors.mutedText);
      }
    }
    ry += boxH + 7;
  }

  const passportUrl = input.data.document.passportUrl.trim();
  if (passportUrl) {
    const qrSize = 82;
    const captionLines = ["SCAN TO VIEW THIS VEHICLE'S", "AUTOLABELS PASSPORT"];
    const shortUrl = passportUrl.replace(/^https?:\/\//i, "");
    const boxH = 10 + qrSize + 6 + captionLines.length * 8 + 9 + 8;
    p.rect(RIGHT_X, ry, RIGHT_W, boxH, null, theme.colors.divider, border);
    p.qr(RIGHT_X + (RIGHT_W - qrSize) / 2, ry + 8, qrSize, passportUrl, theme.colors.bodyText);
    let cy = ry + 8 + qrSize + 4;
    for (const line of captionLines) {
      cy += 8;
      p.text(line, RIGHT_X + RIGHT_W / 2, cy, 6.5, "bold", theme.colors.sectionHeadingText, { align: "center" });
    }
    cy += 8.5;
    p.text(ellipsize(shortUrl, "numeric", 5.5, RIGHT_W - 12), RIGHT_X + RIGHT_W / 2, cy, 5.5, "numeric", theme.colors.mutedText, { align: "center" });
    ry += boxH + 7;
  }

  const dealer = input.data.dealer;
  if (dealer.name) {
    let cy = ry + 6;
    p.text("OFFERED BY", RIGHT_X, cy, 5.5, "bold", theme.colors.mutedText);
    cy += 9;
    p.text(ellipsize(dealer.name.toUpperCase(), "bold", 7.5, RIGHT_W), RIGHT_X, cy, 7.5, "bold", theme.colors.bodyText);
    const cityLine = [dealer.city, dealer.state, dealer.postalCode].filter(Boolean).join(", ");
    for (const line of [dealer.address, cityLine, dealer.phone].filter((s): s is string => !!s)) {
      cy += 8;
      p.text(ellipsize(line, "body", 6, RIGHT_W), RIGHT_X, cy, 6, "body", theme.colors.mutedText);
    }
  }
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
  p.text(nameParts.join(" ").toUpperCase(), PAGE_MARGIN, 21, 11, "bold", theme.colors.bodyText);
  p.text(`VIN: ${v.vin}`, PAGE_WIDTH - PAGE_MARGIN, 21, 7.5, "numeric", theme.colors.bodyText, { align: "right" });
  p.rule(PAGE_MARGIN, 25, fullW, parsePt(theme.layout.borderWeight), theme.colors.divider);
  p.text(headingCase(theme, "Factory Equipment Continuation"), PAGE_MARGIN, 38, 9, "bold", theme.colors.sectionHeadingText, {
    charSpacing: parseEm(theme.typography.headingLetterSpacing) * 9,
  });
  p.text(
    `Continuation of the factory build record for VIN ${v.vin}. This page belongs to the sticker on page 1 and is not valid on its own.`,
    PAGE_MARGIN, 48, 6, "body", theme.colors.mutedText,
  );
  const colsTop = 56;
  const colsH = CONTENT_BOTTOM - 14 - colsTop;
  const withContinuedHeading: FlowEntry[] =
    leftover[0] && leftover[0].heading === undefined
      ? [{ heading: headingCase(theme, "Continued"), lines: [] }, ...leftover]
      : leftover;
  flowColumns(p, withContinuedHeading, PAGE_MARGIN, colsTop, fullW, colsH, 4, ctx);
  p.text("PAGE 2 OF 2", PAGE_WIDTH - PAGE_MARGIN, CONTENT_BOTTOM - 2, 5.5, "bold", theme.colors.mutedText, { align: "right" });
  return { primitives: p.primitives };
}

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

function buildAttempt(
  input: StickerLayoutInput,
  theme: OemStickerTheme,
  density: Density,
  allowContinuation: boolean,
): LayoutModel | null {
  const ctx: BuildContext = { input, theme, density };
  const drawn: string[] = [];
  const p = new Painter(drawn);

  let y = paintTopStrip(p, PAGE_MARGIN, ctx);
  y = paintHeaderBand(p, y, ctx);
  y = paintIdentity(p, y, ctx);

  const lowerH = measureStack(ctx, [
    (sp, sy) => paintIncluded(sp, sy, ctx),
    (sp, sy) => paintOptional(sp, sy, ctx),
    (sp, sy) => paintRollup(sp, sy, ctx),
    (sp, sy) => paintTotalBanner(sp, sy, ctx),
    (sp, sy) => paintFactoryStrip(sp, sy, ctx),
    (sp, sy) => paintBottomRow(sp, sy, ctx),
    (sp, sy) => paintFooter(sp, sy, ctx, "PAGE 1 OF 1"),
  ]);

  const hasStandard = input.data.equipment.standard.some((g) => g.items.length > 0);
  const stdBudget = hasStandard
    ? Math.max(30, CONTENT_BOTTOM - y - lowerH - SECTION_GAP)
    : 0;

  let leftover: FlowEntry[] = [];
  if (hasStandard) {
    const result = paintStandardEquipment(p, y, stdBudget, ctx);
    leftover = result.leftover;
    y = result.yEnd + SECTION_GAP;
  }
  if (leftover.length && !allowContinuation) return null;

  // Anchor the pricing stack to the page bottom (Monroney convention); the
  // measured height makes the footer land exactly on the content edge.
  y = Math.max(y, CONTENT_BOTTOM - lowerH);
  y = paintIncluded(p, y, ctx);
  y = paintOptional(p, y, ctx);
  y = paintRollup(p, y, ctx);
  y = paintTotalBanner(p, y, ctx);
  y = paintFactoryStrip(p, y, ctx);
  y = paintBottomRow(p, y, ctx);
  const pages = leftover.length ? 2 : 1;
  paintFooter(p, y, ctx, pages === 2 ? "PAGE 1 OF 2 - EQUIPMENT CONTINUED ON PAGE 2" : "PAGE 1 OF 1");

  paintRightPanel(p, ctx);

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
  const standard = buildAttempt(input, theme, DENSITY_STANDARD, false);
  if (standard) return standard;
  const dense = buildAttempt(input, theme, DENSITY_DENSE, false);
  if (dense) return dense;
  const floor = buildAttempt(input, theme, DENSITY_FLOOR, true);
  if (!floor) throw new Error("layout_failed: content cannot fit even with continuation");
  return floor;
}
