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
import { getLogoAsset } from "../oem/logoAssets.ts";

export const PAGE_WIDTH = 792;
export const PAGE_HEIGHT = 612;
export const PAGE_MARGIN = 9;
export const MIN_BODY_FONT_SIZE = 5.2;

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

// Print-legibility floor per the approved document standard: equipment body
// never drops below 6.5pt — overflow goes to a deliberate continuation page
// instead of shrinking.
const DENSITY_LARGE: Density = { mode: "STANDARD", item: 7.2, itemLh: 9.2, row: 7.6, rowLh: 10.4, head: 9 };
const DENSITY_STANDARD: Density = { mode: "STANDARD", item: 6.8, itemLh: 8.6, row: 7.2, rowLh: 9.8, head: 8.5 };
const DENSITY_DENSE: Density = { mode: "DENSE", item: 6.5, itemLh: 7.9, row: 7, rowLh: 9.4, head: 8.5 };
const DENSITY_FLOOR: Density = { mode: "DENSE", item: 6.5, itemLh: 7.6, row: 7, rowLh: 9.4, head: 8.5 };

const CATEGORY_LABELS: Record<EquipmentCategory, string> = {
  EXTERIOR: "Exterior",
  INTERIOR: "Interior & Comfort",
  COMFORT_CONVENIENCE: "Convenience & Utility",
  FUNCTIONAL: "Performance & Mechanical",
  POWERTRAIN: "Performance & Mechanical",
  SAFETY_SECURITY: "Safety & Driver Assistance",
  TECHNOLOGY: "Technology & Connectivity",
  OTHER: "Additional Equipment",
};

// ── Page geometry ─────────────────────────────────────────────────────

const IX = PAGE_MARGIN + 6;                     // content inset inside the border
const IR = PAGE_WIDTH - PAGE_MARGIN - 6;
const SPLIT_X = 500;                            // left/right column divider (~63/37)
const LX = IX;
const LW = SPLIT_X - 7 - LX;
const RX = SPLIT_X + 7;
const RW = IR - RX;
const CONTENT_BOTTOM = PAGE_HEIGHT - PAGE_MARGIN - 5;
const SECTION_GAP = 5;

const BLACK = "#0d0d0d";
const EPA_TAG_BLUE = "#b7d9f1";

// ── Layout families ───────────────────────────────────────────────────
// Behavioral differences per family — one engine, several controlled
// presentations. Families change composition; they never change data,
// arithmetic, machine-readables, or publication behavior.

interface FamilyStyle {
  /** WORDMARK_RULE: black wordmark on white over a heavy rule (premium).
   *  BANDED: filled manufacturer band with reversed wordmark + accent keyline.
   *  IDENTITY_BLOCK: white OEM identity block beside a filled band that
   *  carries model, trim and the compact vehicle-detail block. */
  headerComposition: "WORDMARK_RULE" | "BANDED" | "IDENTITY_BLOCK";
  /** Filled bar behind equipment category headings (mainstream/utility). */
  sectionHeadingBar: boolean;
  /** Heading bars fill with the brand accent + reversed text (adventure). */
  headingBarAccent: boolean;
  /** Premium families: letterspaced headings over a hairline rule. */
  trackedHeadings: boolean;
  /** German-technical: thin boxed rules around equipment and pricing zones. */
  boxedZones: boolean;
  /** Brand-accent keyline under the header band and above the total band. */
  accentKeyline: boolean;
  equipmentColumns: number;
  /** Overrides the neutral gray fill behind sectionHeadingBar headings. */
  headingBarFill?: string;
  /** Structural rules stay ink-black even when the header band is paper-white. */
  inkStructure?: boolean;
  /** Ship-to dealer block beside the VIN barcode (factory allocation style). */
  shipToBlock?: boolean;
  /** Factory footnote under the MSRP rollup (taxes/title/license exclusion). */
  msrpFootnote?: boolean;
  /** Emblem block carries the filled masthead; the model band stays paper. */
  emblemBlockFilled?: boolean;
  /** Verified warranty renders as "MSRP INCLUDES" inside the pricing column. */
  msrpIncludes?: boolean;
  /** Parts content renders in the left column's slack zone, not the right rail. */
  leftPartsPanel?: boolean;
  /** Compact Passport panel: "VEHICLE PASSPORT" + Powered by AutoLabels line. */
  passportBrandLine?: boolean;
}

const FAMILY_STYLES: Record<string, FamilyStyle> = {
  KOREAN_PREMIUM: { headerComposition: "BANDED", sectionHeadingBar: false, headingBarAccent: false, trackedHeadings: true, boxedZones: true, accentKeyline: true, equipmentColumns: 3 },
  KOREAN_MAINSTREAM: { headerComposition: "BANDED", sectionHeadingBar: true, headingBarAccent: false, trackedHeadings: false, boxedZones: false, accentKeyline: true, equipmentColumns: 3, headingBarFill: "#f1f1f1", inkStructure: true },
  JAPANESE_FACTORY: { headerComposition: "IDENTITY_BLOCK", sectionHeadingBar: false, headingBarAccent: false, trackedHeadings: false, boxedZones: false, accentKeyline: true, equipmentColumns: 3, inkStructure: true, shipToBlock: true, msrpFootnote: true },
  PREMIUM_FACTORY: { headerComposition: "IDENTITY_BLOCK", sectionHeadingBar: false, headingBarAccent: false, trackedHeadings: false, boxedZones: false, accentKeyline: true, equipmentColumns: 3, inkStructure: true, shipToBlock: true, msrpFootnote: true, emblemBlockFilled: true, msrpIncludes: true, leftPartsPanel: true, passportBrandLine: true },
  LUXURY_FACTORY: { headerComposition: "IDENTITY_BLOCK", sectionHeadingBar: false, headingBarAccent: false, trackedHeadings: false, boxedZones: false, accentKeyline: true, equipmentColumns: 3, inkStructure: true, shipToBlock: true, msrpFootnote: true, msrpIncludes: true, leftPartsPanel: true, passportBrandLine: true },
  PREMIUM_LUXURY: { headerComposition: "WORDMARK_RULE", sectionHeadingBar: false, headingBarAccent: false, accentKeyline: false, trackedHeadings: true, boxedZones: false, equipmentColumns: 3 },
  MODERN_LUXURY: { headerComposition: "WORDMARK_RULE", sectionHeadingBar: false, headingBarAccent: false, accentKeyline: false, trackedHeadings: true, boxedZones: false, equipmentColumns: 3 },
  EUROPEAN_TECHNICAL: { headerComposition: "WORDMARK_RULE", sectionHeadingBar: false, headingBarAccent: false, accentKeyline: false, trackedHeadings: false, boxedZones: true, equipmentColumns: 3 },
  JAPANESE_MAINSTREAM: { headerComposition: "BANDED", sectionHeadingBar: true, headingBarAccent: false, accentKeyline: true, trackedHeadings: false, boxedZones: false, equipmentColumns: 3 },
  AMERICAN_MAINSTREAM: { headerComposition: "BANDED", sectionHeadingBar: true, headingBarAccent: false, accentKeyline: true, trackedHeadings: false, boxedZones: false, equipmentColumns: 2 },
  PERFORMANCE: { headerComposition: "BANDED", sectionHeadingBar: true, headingBarAccent: true, accentKeyline: true, trackedHeadings: false, boxedZones: false, equipmentColumns: 3 },
  COMMERCIAL: { headerComposition: "BANDED", sectionHeadingBar: true, headingBarAccent: true, accentKeyline: true, trackedHeadings: false, boxedZones: false, equipmentColumns: 3 },
  EV_TECHNICAL: { headerComposition: "WORDMARK_RULE", sectionHeadingBar: false, headingBarAccent: false, accentKeyline: true, trackedHeadings: false, boxedZones: true, equipmentColumns: 3 },
  AUTOLABELS_FALLBACK: { headerComposition: "WORDMARK_RULE", sectionHeadingBar: false, headingBarAccent: false, accentKeyline: false, trackedHeadings: true, boxedZones: false, equipmentColumns: 3 },
};

function familyStyle(theme: OemStickerTheme): FamilyStyle {
  return FAMILY_STYLES[theme.templateFamilyId] ?? FAMILY_STYLES.AUTOLABELS_FALLBACK;
}

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

  // The bare VIN is its own drawn string: the orchestrator QA contract
  // asserts drawnStrings contains the exact VIN with no prefix.
  p.text("VIN:", RX + 4, baseline, 6.6, "bold", BLACK);
  p.text(v.vin, RX + 4 + measureText("VIN: ", "bold", 6.6), baseline, 6.6, "bold", BLACK);
  if (v.stockNumber) {
    p.text(v.stockNumber, IR, baseline, size, "body", BLACK, { align: "right" });
  }

  const ruleY = baseline + 4.5;
  p.rule(PAGE_MARGIN, ruleY, PAGE_WIDTH - 2 * PAGE_MARGIN, 1.1, BLACK);
  return ruleY + 1.1;
}

// ── Left column: header (wordmark / model / identity block) ──────────

function paintHeader(p: Painter, y: number, ctx: BuildContext): number {
  const { theme, input } = ctx;
  const v = input.data.vehicle;
  const style = familyStyle(theme);

  // Row 1 — manufacturer identity with the document title block beside it.
  // Premium families run the wordmark dark on white over a heavy rule;
  // mainstream/utility families reverse it out of a manufacturer band with
  // a brand-accent keyline.
  const banded = style.headerComposition === "BANDED";
  const wordmarkSize = banded ? 20 : 26;
  const spacing = Math.max(parseEm(theme.logo.wordmarkLetterSpacing) * wordmarkSize, wordmarkSize * (banded ? 0.18 : 0.3));
  const bx = LX + LW;
  // Governed emblem asset (vector recreation until brand-authorized
  // artwork replaces it): drawn beside the wordmark with its clear space.
  const emblem = getLogoAsset(theme.oemId);
  const drawEmblem = (x: number, top: number, h: number): number => {
    if (!emblem) return x;
    const m = emblem.render(Math.max(h, emblem.minHeightPt));
    for (const path of m.paths) {
      p.path(path.d, x, top, m.width, m.height, path.fill,
        path.stroke, path.strokeWidth);
    }
    for (const t of m.texts ?? []) {
      p.text(t.str, x + t.x, top + t.y, Math.max(t.size, MIN_BODY_FONT_SIZE), "bold", t.color, {
        align: "center",
        ...(t.charSpacing ? { charSpacing: t.charSpacing } : {}),
      });
    }
    return x + m.width + m.height * emblem.clearSpaceRatio;
  };
  if (style.headerComposition === "IDENTITY_BLOCK") {
    // Factory allocation-style header: white OEM identity block on the
    // left, filled band carrying model + trim + compact detail block, and
    // the brand accent rule across the full width below.
    p.text(input.title.toUpperCase(), LX + LW, y + 6.5, 6.5, "bold", BLACK, { align: "right" });
    const subtitleI = v.condition === "NEW"
      ? "FACTORY CONFIGURATION & MSRP"
      : "VIN-SPECIFIC FACTORY CONFIGURATION WHEN NEW";
    p.text(subtitleI, LX + LW, y + 13, 5.2, "body", "#4c5157", { align: "right" });
    const bandTop = y + 15;
    const bandH = 50;
    const blockW = 92;
    const bandX = LX + blockW;
    // Masthead polarity: JAPANESE_FACTORY fills the model band; the premium
    // variant fills the emblem block instead and keeps the band on paper.
    const blockFilled = !!style.emblemBlockFilled;
    const bandFill = blockFilled ? theme.colors.background : theme.colors.headerBackground;
    const bandInk = blockFilled ? BLACK : theme.colors.headerText;
    const blockInk = blockFilled ? theme.colors.headerText : BLACK;
    if (blockFilled) p.rect(LX, bandTop, blockW, bandH, theme.colors.headerBackground);
    p.rect(bandX, bandTop, LX + LW - bandX, bandH, bandFill);
    // Identity block: governed emblem (when a recreated asset exists)
    // stacked over the wordmark; otherwise the wordmark treatment alone.
    // No fabricated emblem artwork.
    if (emblem && !blockFilled) {
      const m0 = emblem.render(Math.max(20, emblem.minHeightPt));
      drawEmblem(LX + Math.max(4, (blockW - m0.width) / 2), bandTop + 5, 20);
      p.text(theme.logo.wordmarkText, LX + blockW / 2, bandTop + bandH - 9, 7.5, "heading", blockInk, {
        align: "center",
        charSpacing: 1.6,
      });
    } else {
      p.text(theme.logo.wordmarkText, LX + blockW / 2, bandTop + bandH / 2 + 4.5, 13, "heading", blockInk, {
        align: "center",
        charSpacing: Math.max(parseEm(theme.logo.wordmarkLetterSpacing) * 13, 2.2),
      });
    }
    // Compact vehicle-detail block on the band's right side.
    const detailW = 172;
    const dx = LX + LW - detailW;
    const detail: Array<[string, string | undefined]> = [
      ["EXTERIOR COLOR:", v.exteriorColor],
      ["INTERIOR COLOR:", v.interiorColor],
      ["VIN:", v.vin],
      ["STOCK #:", v.stockNumber],
    ];
    let dy = bandTop + 12.5;
    for (const [label, value] of detail) {
      if (!value) continue;
      p.text(label, dx, dy, 5.4, "bold", bandInk);
      p.text(
        ellipsize(value.toUpperCase(), "body", 6, detailW - measureText(`${label} `, "bold", 5.4) - 12),
        dx + measureText(`${label} `, "bold", 5.4) + 2, dy, 6, "body", bandInk,
      );
      dy += 10.4;
    }
    // Model + trim inside the band; auto-fit, never truncated.
    const primaryI = [v.year > 0 ? String(v.year) : "", v.make, v.model].filter(Boolean).join(" ").toUpperCase();
    const modelMax = dx - bandX - 24;
    let primaryISize = 17;
    while (primaryISize > 11 && measureText(primaryI, "bold", primaryISize) > modelMax) primaryISize -= 0.5;
    p.text(ellipsize(primaryI, "bold", primaryISize, modelMax), bandX + 12, bandTop + 24.5, primaryISize, "bold", bandInk);
    if (v.trim) {
      p.text(ellipsize(v.trim.toUpperCase(), "bold", 8.5, modelMax), bandX + 12, bandTop + 38.5, 8.5, "bold", bandInk, { charSpacing: 0.5 });
    }
    const keylineY = bandTop + bandH + 1.5;
    p.rule(LX, keylineY, LW, 2.5, theme.colors.accent);
    if (ctx.input.generic) {
      p.text("TYPICAL FACTORY CONFIGURATION FOR THIS TRIM - NOT VIN-SPECIFIC", LX + LW, keylineY + 9, 5.5, "bold", "#7a5c10", { align: "right" });
      return keylineY + 13;
    }
    return keylineY + 5.5;
  }
  if (banded) {
    const bandH = 30;
    p.rect(LX, y + 1, LW, bandH, theme.colors.headerBackground);
    if (style.accentKeyline) {
      p.rule(LX, y + 1 + bandH, LW, 2.2, theme.colors.accent);
    }
    const wmX = drawEmblem(LX + 8, y + 6.5, 19);
    p.text(theme.logo.wordmarkText, wmX, y + 22, wordmarkSize, "heading", theme.colors.headerText, {
      charSpacing: spacing,
    });
    p.text(input.title.toUpperCase(), bx - 8, y + 14.5, 7.5, "bold", theme.colors.headerText, { align: "right" });
    const subtitleB = v.condition === "NEW"
      ? "FACTORY CONFIGURATION & MSRP"
      : "VIN-SPECIFIC FACTORY CONFIGURATION WHEN NEW";
    p.text(subtitleB, bx - 8, y + 23.5, 5.5, "body", theme.colors.headerText, { align: "right" });
    if (ctx.input.generic) {
      p.text("TYPICAL FACTORY CONFIGURATION FOR THIS TRIM - NOT VIN-SPECIFIC", bx, y + 40.5, 5.5, "bold", "#7a5c10", { align: "right" });
    }
  } else {
    const wmX = drawEmblem(LX, y + 3, 27);
    p.text(theme.logo.wordmarkText, wmX, y + 27, wordmarkSize, "heading", BLACK, {
      charSpacing: spacing,
    });
    p.text(input.title.toUpperCase(), bx, y + 16, 8.5, "bold", BLACK, { align: "right" });
    const subtitle = v.condition === "NEW"
      ? "FACTORY CONFIGURATION & MSRP"
      : "VIN-SPECIFIC FACTORY CONFIGURATION WHEN NEW";
    p.text(subtitle, bx, y + 25, 6, "body", BLACK, { align: "right" });
    if (ctx.input.generic) {
      p.text("TYPICAL FACTORY CONFIGURATION FOR THIS TRIM - NOT VIN-SPECIFIC", bx, y + 33.5, 5.5, "bold", "#7a5c10", { align: "right" });
    }
  }

  // Row 2 — primary vehicle identity with a deliberate identification block.
  // The model name never truncates: the size steps down (to a floor) to fit.
  const modelTop = y + 33;
  const primary = [v.year > 0 ? String(v.year) : "", v.make, v.model].filter(Boolean).join(" ").toUpperCase();
  let primarySize = 21;
  while (primarySize > 14 && measureText(primary, "bold", primarySize) > LW * 0.55) primarySize -= 0.5;
  p.text(ellipsize(primary, "bold", primarySize, LW * 0.55), LX, modelTop + 20, primarySize, "bold", BLACK);
  if (v.trim) {
    p.text(ellipsize(v.trim.toUpperCase(), "bold", 11, LW * 0.5), LX, modelTop + 34, 11, "bold", BLACK, { charSpacing: 0.6 });
  }

  const idX = LX + LW * 0.56;
  const idColW = (LW * 0.44) / 2;
  const idRows: Array<Array<[string, string]>> = [[], []];
  const pushId = (col: number, label: string, value: string | undefined): void => {
    if (value) idRows[col].push([label, value.toUpperCase()]);
  };
  pushId(0, "VIN", v.vin);
  pushId(0, "EXTERIOR", v.exteriorColor);
  pushId(0, "INTERIOR", v.interiorColor);
  pushId(1, "ENGINE", v.engine);
  pushId(1, "TRANSMISSION", v.transmission);
  pushId(1, "DRIVETRAIN", v.drivetrain);
  idRows.forEach((rows, col) => {
    let iy = modelTop + 6;
    for (const [label, value] of rows) {
      p.text(`${label}:`, idX + col * idColW, iy, 5.5, "bold", "#4c5157");
      p.text(
        ellipsize(value, "body", 6.8, idColW - measureText(`${label}: `, "bold", 5.5) - 8),
        idX + col * idColW + measureText(`${label}: `, "bold", 5.5) + 2,
        iy, 6.8, "body", BLACK,
      );
      iy += 8.4;
    }
  });

  const ruleY = modelTop + 34;
  p.rule(LX, ruleY, LW, 2, banded && !style.inkStructure ? theme.colors.headerBackground : BLACK);
  return ruleY + 5;
}

// ── Standard equipment: four fixed Monroney columns ───────────────────

function equipmentEntries(ctx: BuildContext, colWidth: number): FlowEntry[] {
  const { density } = ctx;
  const entries: FlowEntry[] = [];
  for (const group of ctx.input.data.equipment.standard) {
    if (!group.items.length) continue;
    entries.push({ heading: CATEGORY_LABELS[group.category].toUpperCase(), lines: [] });
    for (const item of group.items) {
      const lines = wrapText(sanitize(item), "body", density.item, colWidth - 7);
      if (lines.length) entries.push({ lines, bullet: true });
    }
  }
  return entries;
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
  const gap = 13;
  const columns = familyStyle(ctx.theme).equipmentColumns;
  const colW = (LW - gap * (columns - 1)) / columns;
  const entries = equipmentEntries(ctx, colW);
  if (!entries.length) return { yEnd: y, leftover: [] };

  let cursor = y + 9;
  const h1 = "STANDARD EQUIPMENT";
  const h2 = "INCLUDED AT NO EXTRA CHARGE";
  p.text(h1, LX, cursor, density.head + 0.5, "bold", BLACK, { charSpacing: 0.5 });
  const h1W = measureText(h1, "bold", density.head + 0.5, 0.5);
  p.text(h2, LX + h1W + 7, cursor, 6, "bold", "#4c5157");
  cursor += 4;

  const colTop = cursor;
  // Reserve the footnote + closing rule (~14pt) that follow this section.
  const colBudget = Math.max(0, budget - (cursor - y) - (familyStyle(ctx.theme).boxedZones ? 21 : 14));
  const { leftover, usedHeight } = flowColumns(p, entries, LX, colTop, LW, colBudget, columns, ctx);

  for (let col = 1; col < columns; col++) {
    const sx = LX + col * (colW + gap) - gap / 2;
    p.rule(sx, colTop + 3, 0.5, Math.max(0, usedHeight - 2), "#b6b9bd");
  }

  const boxed = familyStyle(ctx.theme).boxedZones;
  if (boxed) {
    p.rect(LX - 3, colTop - 2, LW + 6, usedHeight + 6, null, "#3a3d42", 0.75);
  }
  let end = colTop + usedHeight + (boxed ? 13 : 7);
  p.text(
    "* See Owner's Manual for complete details, limitations and exclusions.",
    LX + LW / 2, end, 5.5, "body", "#4c5157", { align: "center" },
  );
  end += 4;
  p.rule(LX, end, LW, 1.4, BLACK);
  return { yEnd: end + 1.4, leftover };
}

// ── Included / Optional pricing split ─────────────────────────────────

function paintPricingSplit(p: Painter, y: number, ctx: BuildContext): number {
  const { input } = ctx;
  const leftW = LW * 0.415;
  const rightX = LX + leftW + 10;
  const rightW = LX + LW - rightX;
  // The pricing pair reads larger than the equipment lists on the OEM
  // reference, so its sizes are fixed rather than density-driven.
  const size = 7.6;
  const lh = 9.8;
  const density = { ...ctx.density, item: 6.8, itemLh: 8.1 };

  // Left half: factory packages included on this vehicle. A priced package
  // whose value is already inside Base MSRP is labeled so the visible rows
  // can never read as double-counted against the reconciliation.
  let ly = y + 10;
  if (input.data.equipment.packages.length) {
    p.text("INCLUDED FACTORY PACKAGES", LX, ly, 8, "bold", BLACK, { charSpacing: 0.4 });
    p.text("(MSRP)", LX + leftW - 2, ly, 6, "body", "#4c5157", { align: "right" });
  }
  ly += 2;
  const pricing0 = input.data.pricing;
  const optTotal = pricing0.factoryInstalledTotal ??
    (pricing0.packagesTotal !== undefined || pricing0.optionsTotal !== undefined
      ? (pricing0.packagesTotal ?? 0) + (pricing0.optionsTotal ?? 0)
      : undefined);
  const optionsSum = input.data.equipment.options.reduce((a, o) => a + (o.price ?? 0), 0);
  for (const pkg of input.data.equipment.packages) {
    ly += lh + 1;
    const label = [pkg.code, pkg.name].filter(Boolean).join(" ").toUpperCase();
    p.text(ellipsize(label, "bold", size, leftW - 50), LX, ly, size, "bold", BLACK);
    p.text(priceLabel(pkg, true), LX + leftW - 2, ly, size, "bold", BLACK, { align: "right" });
    // If the priced packages are not part of the factory-options total, they
    // are already inside Base MSRP — say so explicitly.
    if (pkg.price !== undefined && optTotal !== undefined && Math.abs(optionsSum - optTotal) < 1) {
      ly += 7.5;
      p.text("INCLUDED IN BASE MSRP", LX + leftW - 2, ly, 5.5, "body", "#4c5157", { align: "right" });
    }
    for (const feature of pkg.features) {
      const lines = wrapText(sanitize(feature), "body", density.item, leftW - 14);
      for (const [li, line] of lines.entries()) {
        ly += density.itemLh;
        if (li === 0) bulletDot(p, LX + 4, ly, density.item, BLACK);
        p.text(line, LX + 9, ly, density.item, "body", BLACK);
      }
    }
  }
  // Premium-factory variant: verified warranty summarizes what the MSRP
  // includes, inside the pricing column rather than a right-rail panel.
  const fsSplit = familyStyle(ctx.theme);
  if (fsSplit.msrpIncludes && !input.data.equipment.packages.length) {
    const w = input.data.warranty;
    const includeLines = w && w.sourceVerified
      ? [w.basic, w.powertrain, w.corrosion, w.roadside, w.emissions].filter((s): s is string => Boolean(s && s.trim()))
      : [];
    if (includeLines.length) {
      ly += 2;
      p.text("MSRP INCLUDES", LX, ly, 8, "bold", BLACK, { charSpacing: 0.4 });
      for (const line of includeLines) {
        const wrapped = wrapText(line.toUpperCase(), "body", 6.8, leftW - 12);
        wrapped.forEach((seg, si) => {
          ly += si === 0 ? 9 : 7.6;
          if (si === 0) bulletDot(p, LX + 1.5, ly, 6.8, BLACK);
          p.text(seg, LX + 6, ly, 6.8, "body", BLACK);
        });
      }
    }
  }

  // Right half: optional equipment with dot leaders and the MSRP rollup.
  // Accessory-only builds (port items, no factory options) skip the empty
  // FACTORY OPTIONS heading rather than printing a vacant section.
  const hasPortOnly = !input.data.equipment.options.length &&
    (input.data.equipment.portInstalled?.length ?? 0) > 0;
  let ry = y + 10;
  if (!hasPortOnly) {
    p.text("FACTORY OPTIONS", rightX, ry, 8, "bold", BLACK, { charSpacing: 0.4 });
  }
  p.text("(MSRP)", rightX + rightW, ry, 6, "body", "#4c5157", { align: "right" });
  ry += 2;
  if (hasPortOnly) ry -= lh + 2;
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
      const fxLimit = rightX + rightW - 78;
      for (const feature of opt.features) {
        const shown = ellipsize(sanitize(feature), "body", density.item, rightW - codeW - 60);
        const w = 4 + measureText(shown, "body", density.item) + 9;
        if (fx + w > fxLimit) break;
        bulletDot(p, fx, ry, density.item, BLACK);
        p.text(shown, fx + 4, ry, density.item, "body", BLACK);
        fx += w;
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
  // Port-installed accessories stay a separate subsection: they are never
  // presented as factory-installed options or dealer-installed accessories.
  const portInstalled = input.data.equipment.portInstalled ?? [];
  if (portInstalled.length) {
    ry += lh + 2;
    p.text("PORT OF ENTRY OPTIONS", rightX, ry, 8, "bold", BLACK, { charSpacing: 0.4 });
    ry += 2;
    for (const opt of portInstalled) {
      ry += lh;
      leaderRow(p, rightX, rightX + rightW, ry, opt.name, priceLabel(opt, true), size, "body", BLACK, BLACK);
    }
  }
  const destination = input.data.pricing.destinationCharge;
  if (destination !== undefined) {
    ry += lh;
    leaderRow(p, rightX, rightX + rightW, ry, "DESTINATION & HANDLING", formatPlain(destination), size, "bold", BLACK, BLACK);
  }

  ry += lh + 1;
  const pricing = input.data.pricing;
  const rollup: Array<[string, number | undefined, boolean]> = [
    ["BASE MSRP", pricing.baseMsrp, true],
    ["FACTORY OPTIONS", pricing.factoryInstalledTotal ??
      (pricing.packagesTotal !== undefined || pricing.optionsTotal !== undefined
        ? (pricing.packagesTotal ?? 0) + (pricing.optionsTotal ?? 0)
        : undefined), false],
    ...(portInstalled.length || pricing.portOptionsTotal !== undefined
      ? [["PORT OF ENTRY OPTIONS", pricing.portOptionsTotal ?? 0, false] as [string, number | undefined, boolean]]
      : []),
    ["DESTINATION & HANDLING", pricing.destinationCharge, false],
  ];
  for (const [label, amount, dollar] of rollup) {
    if (amount === undefined) continue;
    ry += lh;
    leaderRow(p, rightX, rightX + rightW, ry, label, dollar ? formatMoney(amount) : formatPlain(amount), size, "body", BLACK, BLACK);
  }
  // The taxes/title/license footnote belongs to new-vehicle MSRP documents;
  // the used reconstruction record states its provenance in the footer.
  if (familyStyle(ctx.theme).msrpFootnote && input.data.vehicle.condition === "NEW") {
    ry += lh;
    p.text("MSRP does not include taxes, title, license fees, or options", rightX, ry, 5.5, "body", "#4c5157");
    ry += 6.3;
    p.text("selected by the customer.", rightX, ry, 5.5, "body", "#4c5157");
  }

  const end = Math.max(ly, ry) + 5;
  p.rule(rightX - 6, y + 4, 0.5, end - y - 8, "#b6b9bd");
  return end;
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
  p.text(label, x + 3, y + 6.3, 5.4, "bold", BLACK);
  p.text(ellipsize(value.toUpperCase(), "body", 6.4, w - 6), x + 3, y + h - 3.5, 6.4, "body", BLACK);
}

function paintSpecGrid(p: Painter, y: number, ctx: BuildContext): number {
  const { input } = ctx;
  const v = input.data.vehicle;
  const f = input.data.factory;
  const rowH = 17;
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
  const boxH = showBarcode ? 48 : 22;
  p.rect(LX, y, boxW, boxH, null, BLACK, 0.9);
  p.text("VIN", LX + 6, y + 11, 6, "bold", "#4c5157");
  p.text(v.vin, LX + 6 + measureText("VIN  ", "bold", 6), y + 11.5, 8.5, "bold", BLACK, { charSpacing: 0.5 });
  if (showBarcode) {
    p.barcode(LX + 6, y + 15, boxW * 0.66, 23, input.barcodePayload, BLACK);
  }
  // Factory allocation families show the ship-to dealer beside the barcode.
  if (familyStyle(theme).shipToBlock && input.data.dealer.name) {
    const d = input.data.dealer;
    const f = input.data.factory;
    const sx = LX + boxW - 6;
    const shipMax = boxW * 0.31;
    const cityLine = [d.city, [d.state, d.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    p.text(`SHIP TO: ${f.dealerCode ?? ""}`.trim(), sx, y + 12, 5.4, "bold", BLACK, { align: "right" });
    p.text(ellipsize(d.name.toUpperCase(), "body", 5.4, shipMax), sx, y + 19, 5.4, "body", BLACK, { align: "right" });
    let sy2 = y + 26;
    if (d.address) {
      p.text(ellipsize(d.address.toUpperCase(), "body", 5.4, shipMax), sx, sy2, 5.4, "body", BLACK, { align: "right" });
      sy2 += 7;
    }
    if (cityLine) {
      p.text(ellipsize(cityLine.toUpperCase(), "body", 5.4, shipMax), sx, sy2, 5.4, "body", BLACK, { align: "right" });
    }
  }
  const meta = [
    v.stockNumber ? `STOCK ${v.stockNumber.toUpperCase()}` : null,
    `DOCUMENT v${input.data.document.templateVersion}`,
  ].filter(Boolean).join("   -   ");
  p.text(meta, LX + 6, y + boxH - 5.5, 5.5, "body", "#4c5157");
  return y + boxH;
}

// ── Navy total band ───────────────────────────────────────────────────

function paintTotalBand(p: Painter, y: number, ctx: BuildContext): number {
  const { theme, input } = ctx;
  const pricing = input.data.pricing;
  const condition = input.data.vehicle.condition;
  const label = condition === "NEW" ? "TOTAL FACTORY MSRP" : "TOTAL ORIGINAL MSRP";
  const total = pricing.sourceReportedTotalMsrp ?? pricing.calculatedTotalMsrp;
  // The total concludes the factory-pricing section: a strong upper rule
  // (brand accent for keyline families) and a restrained band.
  const style = familyStyle(theme);
  p.rule(LX, y, LW, 2, style.accentKeyline ? theme.colors.accent : BLACK);
  const bandH = 40;
  const bandTop = y + 2.5;
  p.rect(LX, bandTop, LW, bandH, theme.colors.totalMsrpBackground);
  p.text(label, LX + 12, bandTop + 26, 13.5, "bold", theme.colors.totalMsrpText, {
    charSpacing: 1.1,
  });
  const amount = total !== undefined ? formatMoney(total) : "SEE DEALER";
  p.text(amount, LX + LW - 12, bandTop + 27, 18, "bold", theme.colors.totalMsrpText, { align: "right" });
  return bandTop + bandH;
}

// ── Right column: EPA Fuel Economy & Environment ──────────────────────

function fuelCategoryLabel(fuelType: string | undefined): string {
  const f = (fuelType || "").toLowerCase();
  if (/phev|plug/.test(f)) return "Plug-In Hybrid";
  if (/hybrid/.test(f)) return "Hybrid Vehicle";
  if (/electric|\bev\b/.test(f)) return "Electric Vehicle";
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
  p.text(label, x, y + 6, 5.5, "bold", BLACK);
  const barY = y + 13;
  const barH = 8.5;
  const cap = 9;
  // Reversed end caps with a continuous track filled up to the marker.
  p.rect(x, barY, cap, barH, BLACK);
  p.text("1", x + cap / 2, barY + barH - 1.5, 5.4, "bold", "#ffffff", { align: "center" });
  p.rect(x + cap, barY, w - cap * 2, barH, "#ffffff", BLACK, 0.7);
  p.rect(x + w - cap, barY, cap, barH, BLACK);
  p.text("10", x + w - cap / 2, barY + barH - 1.5, 5.4, "bold", "#ffffff", { align: "center" });
  p.text("Best", x + w, barY + barH + 6, 5.4, "body", BLACK, { align: "right" });
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
  // Regulatory modules stay neutral: the OEM profile never restyles them.
  const header = "#141414";
  const headerText = "#ffffff";

  const boxTop = y;
  const headH = 20;
  const bodyTop = y + headH;

  // Header band.
  p.rect(RX, boxTop, RW, headH, header);
  p.text("EPA", RX + 5, boxTop + 9, 5.5, "bold", headerText);
  p.text("DOT", RX + 5, boxTop + 16, 5.5, "bold", headerText);
  p.rule(RX + 21, boxTop + 4, 0.5, headH - 8, "#8b8f94");
  p.text("Fuel Economy & Environment", RX + 26, boxTop + 13.5, 10, "bold", headerText);

  // Powertrain-aware module: electric vehicles use MPGe/range language and
  // never inherit gasoline-only structures; hybrids keep the gasoline shape
  // under a Hybrid Vehicle tag. Only verified fields are drawn.
  const fuel = (input.data.vehicle.fuelType || "").toLowerCase();
  const isPhev = /phev|plug/.test(fuel);
  const isEv = /electric|\bev\b/.test(fuel) && !/hybrid|phev/.test(fuel) && !isPhev;
  const tagW = 70;
  let cy = bodyTop + 12;
  p.text("Fuel Economy", RX + 6, cy, 8.5, "bold", BLACK);
  p.rect(RX + RW - tagW - 5, cy - 8, tagW, 11, EPA_TAG_BLUE);
  p.text(fuelCategoryLabel(input.data.vehicle.fuelType), RX + RW - tagW / 2 - 5, cy, 6.2, "bold", BLACK, { align: "center" });

  // MPG/MPGe block: number, city/highway, class note.
  const mpgTop = cy + 5;
  const combined = reg.combinedMpg;
  let numW = 0;
  if (combined !== undefined) {
    p.text(String(combined), RX + 6, mpgTop + 24, 27, "bold", BLACK);
    numW = measureText(String(combined), "bold", 27);
    p.text(isEv || isPhev ? "MPGe" : "MPG", RX + 10 + numW, mpgTop + 12, 10, "bold", BLACK);
    p.text("combined city/hwy", RX + 6, mpgTop + 31, 5.5, "body", BLACK);
    let colX = RX + 62;
    if (reg.cityMpg !== undefined) {
      p.text(String(reg.cityMpg), colX, mpgTop + 24, 9.5, "bold", BLACK);
      p.text("city", colX, mpgTop + 31, 5.5, "body", BLACK);
      colX += 24;
    }
    if (reg.highwayMpg !== undefined) {
      p.text(String(reg.highwayMpg), colX, mpgTop + 24, 9.5, "bold", BLACK);
      p.text("highway", colX, mpgTop + 31, 5.5, "body", BLACK);
    }
    if (isEv || isPhev) {
      if (reg.evRangeMiles !== undefined) {
        p.text(String(reg.evRangeMiles), RX + 6, mpgTop + 42, 8, "bold", BLACK);
        p.text(isPhev ? "miles electric range" : "miles driving range", RX + 9 + measureText(String(reg.evRangeMiles), "bold", 8), mpgTop + 42, 5.5, "body", BLACK);
      }
      if (isPhev && reg.gasolineCombinedMpg !== undefined) {
        const gx = RX + 92;
        p.text(String(reg.gasolineCombinedMpg), gx, mpgTop + 42, 8, "bold", BLACK);
        p.text("MPG gasoline only", gx + 3 + measureText(String(reg.gasolineCombinedMpg), "bold", 8), mpgTop + 42, 5.5, "body", BLACK);
      }
    } else if (reg.gallonsPer100Miles !== undefined) {
      p.text(String(reg.gallonsPer100Miles), RX + 6, mpgTop + 42, 8, "bold", BLACK);
      p.text("gallons per 100 miles", RX + 9 + measureText(String(reg.gallonsPer100Miles), "bold", 8), mpgTop + 42, 5.5, "body", BLACK);
    }
  }

  // Right side: five-year comparison stacked beside the MPG block.
  const fiveYear = reg.fiveYearCostDifference;
  const costX = RX + RW - 88;
  p.rule(costX - 7, mpgTop, 0.5, 44, "#c3c6c9");
  if (fiveYear !== undefined) {
    const spend = fiveYear < 0;
    p.text("You", costX, mpgTop + 8, 8, "body", BLACK);
    p.text(spend ? "spend" : "save", costX + measureText("You ", "body", 8), mpgTop + 8, 10.5, "bold", BLACK);
    p.text(formatMoney(Math.abs(fiveYear)).replace(/\.00$/, ""), costX, mpgTop + 24, 16, "bold", BLACK);
    p.text(`${spend ? "more" : ""} in fuel costs over 5 years`.trim(), costX, mpgTop + 32, 5.5, "bold", BLACK, { maxWidth: 84 });
    p.text("vs. the average new vehicle.", costX, mpgTop + 39, 5.5, "body", BLACK);
  }

  // Annual fuel cost + rating sliders.
  const subTop = mpgTop + 50;
  const costBoxW = 86;
  const costBoxH = 40;
  if (reg.annualFuelCost !== undefined) {
    p.rect(RX + 5, subTop, costBoxW, costBoxH, null, BLACK, 0.9);
    const costLabel = isEv || isPhev ? "Annual energy" : "Annual fuel";
    p.text(costLabel, RX + 10, subTop + 12, 8, "body", BLACK);
    p.text("cost", RX + 10 + measureText(`${costLabel} `, "body", 8), subTop + 12, 9, "bold", BLACK);
    p.text(formatMoney(reg.annualFuelCost).replace(/\.00$/, ""), RX + 10, subTop + 32, 17, "bold", BLACK);
  }
  const sliderX = RX + costBoxW + 15;
  const sliderW = RW - costBoxW - 26;
  let sy = subTop - 3;
  sy = paintRatingSlider(p, sliderX, sy, sliderW, "Fuel Economy & Greenhouse Gas Rating", reg.greenhouseGasRating, ctx.theme);
  paintRatingSlider(p, sliderX, sy - 3, sliderW, "Smog Rating (tailpipe only)", reg.smogRating, ctx.theme);

  // Fine print with the computed CO2 line (8,887 g CO2 per gallon of
  // gasoline at the verified combined MPG — derived, never asserted).
  let fy = subTop + 62;
  const isGas = !isEv && !isPhev;
  const co2 = combined !== undefined && combined > 0 && isGas ? Math.round(8887 / combined) : null;
  const finePrint =
    (co2 !== null ? `This vehicle emits ${co2} grams CO2 per mile (tailpipe only). ` : "") +
    (reg.epaClassNote ? `${reg.epaClassNote} ` : "") +
    "Actual results will vary. Cost estimates are based on 15,000 miles per year at $3.00 per gallon.";
  for (const line of wrapText(finePrint, "body", 5.5, RW - 12)) {
    p.text(line, RX + 6, fy, 5.5, "body", BLACK);
    fy += 6.4;
  }
  fy += 2;

  // fueleconomy.gov band.
  const bandH = 24;
  p.rect(RX, fy, RW, bandH, header);
  p.text("fueleconomy.gov", RX + 6, fy + 12.5, 10.5, "bold", headerText);
  p.text("Calculate personalized estimates and compare vehicles", RX + 6, fy + 19.5, 5.5, "body", headerText);
  const qrTile = 20;
  p.rect(RX + RW - qrTile - 3, fy + 2, qrTile, qrTile, "#ffffff");
  p.qr(RX + RW - qrTile - 1.5, fy + 3.5, qrTile - 3, "https://fueleconomy.gov", BLACK);

  const boxBottom = fy + bandH;
  p.rect(RX, boxTop, RW, boxBottom - boxTop, null, BLACK, 1.4);
  return boxBottom;
}

// ── Right column: Government 5-Star Safety Ratings ────────────────────

function paintSafetyPanel(p: Painter, y: number, ctx: BuildContext): number {
  const { theme, input } = ctx;
  const reg = input.data.regulatory;
  if (reg.nhtsaStatus === "UNAVAILABLE") return y;
  const rated = reg.nhtsaStatus === "VERIFIED";
  const headH = 15;
  p.rect(RX, y, RW, headH, "#141414");
  p.text("GOVERNMENT 5-STAR SAFETY RATINGS", RX + RW / 2, y + 10, 7, "bold", "#ffffff", { align: "center" });
  let cy = y + headH + 11;
  const valueX = RX + RW - 7;
  const anyRating = [reg.overallRating, reg.frontalDriverRating, reg.frontalPassengerRating,
    reg.sideFrontRating, reg.sideRearRating, reg.rolloverRating].some((r) => r !== undefined);

  const row = (label: string, sub: string | null, stars: number | undefined): void => {
    p.text(label, RX + 7, cy, 7.5, "bold", BLACK);
    if (sub) p.text(sub, RX + 92, cy, 6.8, "body", BLACK);
    if (rated && stars !== undefined && stars >= 1) {
      drawStars(p, valueX - stars * 9.4, cy - 6.5, stars, 7.6, BLACK);
    } else {
      p.text(rated ? "No Rating Available" : "Not Rated", valueX, cy, 6.8, "bold", "#4c5157", { align: "right" });
    }
    cy += 11.5;
  };

  row("Overall Score", null, reg.overallRating);
  row("Frontal Crash", "Driver", reg.frontalDriverRating);
  row("", "Passenger", reg.frontalPassengerRating);
  row("Side Crash", "Front seat", reg.sideFrontRating);
  row("", "Rear seat", reg.sideRearRating);
  row("Rollover", null, reg.rolloverRating);

  if (!anyRating || reg.nhtsaStatus === "NOT_RATED") {
    p.text("This vehicle has not been rated by the National Highway Traffic", RX + 7, cy, 5.5, "body", "#4c5157");
    cy += 6.4;
    p.text("Safety Administration.", RX + 7, cy, 5.5, "body", "#4c5157");
    cy += 6;
  }
  cy += 1;
  const srcH = 16;
  p.rect(RX, cy, RW, srcH, "#141414");
  p.text("Star ratings range from 1 to 5 stars, with 5 being the highest.", RX + RW / 2, cy + 6.8, 5.2, "bold", "#ffffff", { align: "center" });
  p.text("Source: NHTSA - www.safercar.gov or 1-888-327-4236", RX + RW / 2, cy + 12.8, 5.2, "bold", "#ffffff", { align: "center" });
  const bottom = cy + srcH;
  p.rect(RX, y, RW, bottom - y, null, BLACK, 1.4);
  return bottom;
}

// ── Right column: AALA parts content + factory warranty (data-gated) ──

function paintPartsContentPanel(p: Painter, y: number, ctx: BuildContext, x: number = RX, w: number = RW): number {
  const entries = ctx.input.data.factory.partsContent;
  if (!entries || !entries.length || !entries.every((e) => e.sourceVerified)) return y;
  const headH = 14;
  p.text("PARTS CONTENT INFORMATION", x + w / 2, y + 10, 7.2, "bold", BLACK, { align: "center", charSpacing: 0.4 });
  p.rule(x, y + headH, w, 0.7, BLACK);
  let cy = y + headH + 8.5;
  for (const e of entries) {
    const value = e.value.toUpperCase();
    const valueW = measureText(value, "bold", 6);
    p.text(
      ellipsize(e.label.toUpperCase(), "bold", 5.2, w - 12 - valueW - 8),
      x + 6, cy, 5.2, "bold", BLACK,
    );
    p.text(value, x + w - 6, cy, 6, "bold", BLACK, { align: "right" });
    cy += 7.4;
  }
  let ny = cy + 1.5;
  for (const line of wrapText(
    "NOTE: Parts content does not include final assembly, distribution, or other non-parts costs.",
    "body", 5.2, w - 12,
  )) {
    p.text(line, x + 6, ny, 5.2, "body", "#4c5157");
    ny += 5.8;
  }
  const bottom = ny;
  p.rect(x, y, w, bottom - y, null, BLACK, 1.2);
  return bottom;
}

function paintWarrantyPanel(p: Painter, y: number, ctx: BuildContext): number {
  const w = ctx.input.data.warranty;
  if (!w || !w.sourceVerified) return y;
  const lines = [w.basic, w.powertrain, w.corrosion, w.roadside, w.emissions].filter(
    (v): v is string => Boolean(v && v.trim()),
  );
  if (!lines.length) return y;
  let cy = y + 10.5;
  const warrantyTitle = ctx.input.data.vehicle.condition === "NEW"
    ? "NEW VEHICLE LIMITED WARRANTY"
    : "ORIGINAL FACTORY WARRANTY WHEN NEW";
  p.text(warrantyTitle, RX + 7, cy, 7.2, "bold", BLACK, { charSpacing: 0.5 });
  cy += 2.5;
  for (const line of lines) {
    cy += 7.4;
    p.text(ellipsize(line.toUpperCase(), "bold", 5.8, RW - 14), RX + 7, cy, 5.8, "bold", BLACK);
  }
  cy += 7;
  p.text("Details on warranties covered by this vehicle are available at your dealer.", RX + 7, cy, 5.2, "body", "#4c5157");
  const bottom = cy + 4;
  p.rect(RX, y, RW, bottom - y, null, BLACK, 1.2);
  return bottom;
}

// ── Right column: AutoLabels Vehicle Passport ─────────────────────────

function paintPassportPanel(p: Painter, y: number, ctx: BuildContext, targetH: number): number {
  const { theme, input } = ctx;
  const passportUrl = input.data.document.passportUrl.trim();
  if (!passportUrl) return y;
  const navy = "#0b1f3a";
  const boxH = Math.max(118, Math.min(targetH, 190));
  const brandLine = !!familyStyle(ctx.theme).passportBrandLine;

  let cy = y + 15;
  p.text(brandLine ? "VEHICLE PASSPORT" : "AUTOLABELS VEHICLE PASSPORT", RX + RW / 2, cy, 8.5, "bold", navy, { align: "center", charSpacing: 0.5 });
  cy += 9;
  p.text(
    brandLine
      ? "Scan for verified vehicle details, documents & history"
      : "Scan to view this exact vehicle's verified Passport",
    RX + RW / 2, cy, 6.2, "body", BLACK, { align: "center" },
  );

  const tailH = 26;
  const qrSize = Math.min(96, Math.max(48, y + boxH - tailH - cy - 14));
  const qrTop = cy + (y + boxH - tailH - cy - qrSize) / 2 + 1;
  p.qr(RX + (RW - qrSize) / 2, qrTop, qrSize, passportUrl, BLACK);

  let ty = y + boxH - tailH + 6;
  if (brandLine) {
    ty += 2;
    p.text(passportUrl.replace(/^https?:\/\//i, ""), RX + RW / 2, ty, 6.8, "bold", BLACK, { align: "center" });
    ty += 9;
    const t1 = "Powered by ";
    const t2 = "auto";
    const t3 = "(LABELS)";
    const total = measureText(t1, "body", 5.6) + measureText(t2, "bold", 5.8) + measureText(t3, "bold", 5.8);
    let bx2 = RX + (RW - total) / 2;
    p.text(t1, bx2, ty, 5.6, "body", "#55595e");
    bx2 += measureText(t1, "body", 5.6);
    p.text(t2, bx2, ty, 5.8, "bold", "#2563eb");
    bx2 += measureText(t2, "bold", 5.8);
    p.text(t3, bx2, ty, 5.8, "bold", navy);
  } else {
    p.text("Factory build information, verified vehicle data and available", RX + RW / 2, ty, 5.5, "body", "#4c5157", { align: "center" });
    ty += 6.2;
    p.text("documents for this VIN.", RX + RW / 2, ty, 5.5, "body", "#4c5157", { align: "center" });
    ty += 7.5;
    p.text(passportUrl.replace(/^https?:\/\//i, ""), RX + RW / 2, ty, 6.8, "bold", BLACK, { align: "center" });
  }
  p.rect(RX, y, RW, boxH, null, navy, 1.2);
  return y + boxH;
}

// ── Right column: verification block, federal notice, disclosure ──────

function paintVerificationBlock(p: Painter, y: number, ctx: BuildContext): number {
  const { input } = ctx;
  const doc = input.data.document;
  let cy = y + 9;
  p.text("AUTOLABELS VIN-SPECIFIC FACTORY BUILD RECORD", RX, cy, 6.6, "bold", BLACK, { charSpacing: 0.3 });
  cy += 7.5;
  const sourceLine = input.generic
    ? "Generated from typical factory-configuration data for this trim."
    : "Generated from saved VIN-specific factory-build data.";
  p.text(sourceLine, RX, cy, 5.5, "body", "#4c5157");
  cy += 6.4;
  p.text("MSRP independently reconciled from factory component values.", RX, cy, 5.5, "body", "#4c5157");
  cy += 6.4;
  const idBits = [
    doc.documentId ? `Document ${doc.documentId.slice(0, 8).toUpperCase()}` : null,
    `Template v${doc.templateVersion}`,
    `Renderer v${doc.rendererVersion}`,
  ].filter(Boolean).join("  -  ");
  p.text(idBits, RX, cy, 5.5, "body", "#4c5157");
  return cy + 2;
}

function paintNoticeRow(p: Painter, y: number, ctx: BuildContext): number {
  // The federal-application notice belongs only on NEW-vehicle documents.
  if (ctx.input.data.vehicle.condition !== "NEW") return y;
  const boxH = 24;
  p.rect(RX, y, RW, boxH, null, BLACK, 0.9);
  p.text("This label has been applied pursuant to Federal law.", RX + 6, y + 10, 5.5, "body", BLACK);
  p.text("Do not remove prior to delivery to the ultimate purchaser.", RX + 6, y + 17.5, 5.5, "body", BLACK);
  return y + boxH;
}

function paintRightFooter(p: Painter, y: number, ctx: BuildContext, pageLabel: string): number {
  const { input } = ctx;
  let cy = y + 8;
  for (const disclaimer of input.disclaimers) {
    for (const line of wrapText(disclaimer, "body", 5.5, RW)) {
      p.text(line, RX, cy, 5.5, "body", "#4c5157");
      cy += 6.3;
    }
  }
  p.text(pageLabel, RX + RW, cy, 5.5, "bold", "#4c5157", { align: "right" });
  cy += 1;
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
  const headH = density.itemLh + 3.5;
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
      cy += density.itemLh + 0.5;
      const fs = familyStyle(ctx.theme);
      let headColor = BLACK;
      if (fs.sectionHeadingBar) {
        const fill = fs.headingBarAccent ? ctx.theme.colors.accent : (fs.headingBarFill ?? "#e8e9ea");
        p.rect(colX(), cy - density.item - 1.5, colW, density.item + 4.5, fill);
        if (fs.headingBarAccent) headColor = "#ffffff";
      }
      if (fs.trackedHeadings) {
        p.text(pendingHeading, colX(), cy, density.item + 0.3, "bold", headColor, { charSpacing: 1.1 });
        p.rule(colX(), cy + 2, colW, 0.5, "#9a9da1");
        cy += 4;
      } else {
        p.text(pendingHeading, colX() + (fs.sectionHeadingBar ? 3 : 0), cy, density.item + 1, "bold", headColor, { charSpacing: 0.35 });
        cy += 3;
      }
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
  // The left parts panel reserves its height out of the equipment budget so
  // it always fits between the pricing split and the spec grid.
  const fsAll = familyStyle(theme);
  const leftPartsW = LW * 0.62;
  const leftPartsH = fsAll.leftPartsPanel
    ? measureStack([(sp, sy) => paintPartsContentPanel(sp, sy, ctx, LX, leftPartsW)])
    : 0;

  const hasStandard = input.data.equipment.standard.some((g) => g.items.length > 0);
  const stdBudget = hasStandard
    ? Math.max(40, CONTENT_BOTTOM - y - bottomH - pricingH - (leftPartsH > 0 ? leftPartsH + 6 : 0) - SECTION_GAP)
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
  // Premium-factory variant: verified parts content occupies the reserved
  // zone between the pricing split and the spec grid.
  if (leftPartsH > 0 && y + 6 + leftPartsH <= bottomTop - 2) {
    paintPartsContentPanel(p, y + 6, ctx, LX, leftPartsW);
  }
  y = paintSpecGrid(p, bottomTop, ctx);
  y = paintVinBarcode(p, y, ctx) + SECTION_GAP;
  paintTotalBand(p, y, ctx);

  // Right column, top to bottom: regulatory panels (supporting), then the
  // Passport panel stretched over the middle, with the verification block,
  // federal notice (new vehicles only) and disclosure pinned to the bottom.
  const pages = leftover.length ? 2 : 1;
  const pageLabel = pages === 2 ? "PAGE 1 OF 2 - EQUIPMENT CONTINUED ON PAGE 2" : "PAGE 1 OF 1";
  const noticeH = measureStack([(sp, sy) => paintNoticeRow(sp, sy, ctx)]);
  const footerH = measureStack([(sp, sy) => paintRightFooter(sp, sy, ctx, pageLabel)]);
  const verifyH = measureStack([(sp, sy) => paintVerificationBlock(sp, sy, ctx)]);
  let ry = paintEpaPanel(p, stripBottom + 6, ctx);
  ry = ry > stripBottom + 6 ? ry + 7 : stripBottom + 6;
  ry = paintSafetyPanel(p, ry, ctx);
  ry = ry > stripBottom + 6 ? ry + 7 : ry;
  const bottomBlockTop = CONTENT_BOTTOM - footerH - noticeH - verifyH - 8;
  // Verified parts-content and warranty panels render only when their data
  // exists AND the Passport panel keeps its minimum height below them.
  // Families that place parts on the left or warranty in the pricing
  // column skip the corresponding rail panel.
  const railPanels = [
    ...(fsAll.leftPartsPanel ? [] : [paintPartsContentPanel]),
    ...(fsAll.msrpIncludes ? [] : [paintWarrantyPanel]),
  ];
  for (const panel of railPanels) {
    const panelH = measureStack([(sp, sy) => panel(sp, sy, ctx)]);
    if (panelH > 0 && ry + panelH + 7 + 118 <= bottomBlockTop - 6) {
      ry = panel(p, ry, ctx) + 7;
    }
  }
  paintPassportPanel(p, ry, ctx, bottomBlockTop - 6 - ry);
  let by = paintVerificationBlock(p, bottomBlockTop, ctx);
  by = paintNoticeRow(p, by + 4, ctx);
  paintRightFooter(p, by, ctx, pageLabel);

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
