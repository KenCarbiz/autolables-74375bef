// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/render/variants/tabloidCommon.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// Helpers shared by the 17x11 (Tabloid landscape) reproduction layouts.
//
// The Figma masters are 2448 x 1584 (2x PDF points). Geometry in the variant
// files is written in "display" units: the 2000-wide render used to measure
// the masters. D() maps display units to Figma units, and u() (shared.ts)
// halves Figma units into PDF points.

import type { FactoryStickerData } from "../../types.ts";
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
import {
  INK,
  PAPER,
  box,
  pt,
  pump,
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

export const TABLOID_WIDTH = 1224;
export const TABLOID_HEIGHT = 792;

export const K = 1.224;
export const D = (n: number): number => n * K;
export const PAGE_BOTTOM = 1279;

interface TextOpts {
  align?: "left" | "right" | "center";
  color?: string;
  lh?: number;
  spacing?: number;
}

export function tx(
  p: Painter, s: string, x: number, y: number, size: number, font: LayoutFont = "body", o: TextOpts = {},
): void {
  txt(p, s, D(x), D(y), D(size), font, {
    ...(o.align ? { align: o.align } : {}),
    ...(o.color ? { color: o.color } : {}),
    ...(o.lh ? { lh: D(o.lh) } : {}),
    ...(o.spacing ? { spacing: o.spacing } : {}),
  });
}

export function bx(p: Painter, x: number, y: number, w: number, h: number, fill: string | null, stroke?: number): void {
  box(p, D(x), D(y), D(w), D(h), fill, stroke ? D(stroke) : undefined);
}

export function wrapD(s: string, font: LayoutFont, size: number, width: number): string[] {
  return wrapFigma(s, font, D(size), D(width));
}

/** Width of a string in display units. */
export function widthD(s: string, font: LayoutFont, size: number, spacing = 0): number {
  return (measureText(s, font, pt(D(size)), spacing) * 2) / K;
}

export function underlined(p: Painter, s: string, x: number, y: number, size: number, o: TextOpts = {}): void {
  tx(p, s, x, y, size, "bold", o);
  const w = widthD(s, "bold", size);
  const x0 = o.align === "center" ? x - w / 2 : o.align === "right" ? x - w : x;
  bx(p, x0, y + size * 0.98, w, Math.max(0.8, size / 15), INK);
}

export function starsAt(p: Painter, x: number, y: number, count: number, size: number): void {
  const s = u(D(size));
  for (let i = 0; i < count; i++) {
    p.path(starPath(s), u(D(x)) + i * (s + u(D(3))), u(D(y)), s, s, INK);
  }
}

export function fuelPump(p: Painter, x: number, y: number, h: number, color: string): void {
  pump(p, D(x), D(y), D(h), color);
}

// ── Banner and disclosure ─────────────────────────────────────────────

export function paintBanner(p: Painter, pageLabel: string): void {
  bx(p, 30, 15, 1940, 24, null, 1.6);
  tx(p, REPRODUCTION_BANNER, 38, 18.5, 15.4, "bold");
  tx(p, pageLabel, 1960, 21, 11, "bold", { align: "right" });
}

export function disclosureLines(input: VariantRenderInput): string[] {
  return [...reproductionDisclosureLines(input.layout.factoryBuild), ...input.layout.disclaimers];
}

export function disclosureHeight(lines: string[]): number {
  let n = 0;
  for (const para of lines) n += wrapD(para, "body", 13.2, 1940).length;
  return 24 + n * 17;
}

export function footerTopFor(lines: string[]): number {
  return Math.min(1183, PAGE_BOTTOM - disclosureHeight(lines));
}

export function paintDisclosure(p: Painter, lines: string[], top: number): void {
  tx(p, REPRODUCTION_BANNER, 30, top, 15.4, "bold");
  let y = top + 24;
  for (const para of lines) {
    for (const line of wrapD(para, "body", 13.2, 1940)) {
      tx(p, line, 30, y, 13.2, "body", { lh: 17 });
      y += 17;
    }
  }
}

// ── Identity ──────────────────────────────────────────────────────────

export function wordmark(p: Painter, text: string, cx: number, top: number, size: number, spacing: number, color = INK): void {
  const w = widthD(text, "bold", size, spacing);
  tx(p, text, cx - w / 2, top, size, "bold", { color, spacing });
}

export function yearModelTrim(d: FactoryStickerData, parts: Array<"year" | "make" | "model" | "trim" | "drivetrain">, displayMake: string): string {
  const v = d.vehicle;
  const map: Record<string, string> = {
    year: v.year > 0 ? String(v.year) : "",
    make: displayMake,
    model: v.model,
    trim: v.trim ?? "",
    drivetrain: v.drivetrain ?? "",
  };
  return parts.map((k) => map[k]).filter(Boolean).join(" ").toUpperCase();
}

export function colorText(name?: string, code?: string): string | null {
  return name ? `${name.toUpperCase()}${code ? ` (${code})` : ""}` : null;
}

export function dealerLines(d: FactoryStickerData): string[] {
  const dealer = d.dealer;
  if (!dealer.name) return [];
  return [dealer.name, dealer.address, [dealer.city, dealer.state, dealer.postalCode].filter(Boolean).join(" "), dealer.phone]
    .filter((s): s is string => !!s && !!s.trim())
    .map((s) => s.toUpperCase());
}

// ── Equipment ─────────────────────────────────────────────────────────

export interface Section {
  heading: string;
  items: string[];
}

export function prettyHint(hint: string): string {
  const h = hint.replace(/[_-]+/g, " ").trim();
  if (/^safety\s*security$/i.test(h)) return "Safety & Security";
  if (/^comfort\s*convenience$/i.test(h)) return "Comfort & Convenience";
  return h.replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

const CATEGORY_LABEL: Record<string, string> = {
  EXTERIOR: "Exterior",
  INTERIOR: "Interior",
  COMFORT_CONVENIENCE: "Comfort & Convenience",
  FUNCTIONAL: "Functional",
  POWERTRAIN: "Powertrain",
  SAFETY_SECURITY: "Safety & Security",
  TECHNOLOGY: "Technology",
  OTHER: "Other",
};

export function buildSections(input: VariantRenderInput): Section[] {
  const d = input.layout.data;
  const groups = input.equipmentGroups.length
    ? input.equipmentGroups.map((g) => ({ heading: prettyHint(g.hint), items: g.items }))
    : d.equipment.standard.map((g) => ({ heading: CATEGORY_LABEL[g.category] ?? "Other", items: g.items }));
  const seen = new Set<string>();
  const out: Section[] = [];
  for (const g of groups) {
    const items: string[] = [];
    for (const raw of g.items) {
      const item = raw.trim();
      const key = item.toUpperCase();
      if (!item || seen.has(key)) continue;
      seen.add(key);
      items.push(item);
    }
    if (items.length) out.push({ heading: g.heading, items });
  }
  return out;
}

export function warrantySection(d: FactoryStickerData, heading: string): Section | null {
  const w = d.warranty;
  if (!w || !w.sourceVerified) return null;
  const items = [w.basic, w.powertrain, w.corrosion, w.roadside, w.emissions].filter((s): s is string => !!s);
  if (!items.length) return null;
  items.push("Original new-vehicle terms; not coverage remaining.");
  return { heading, items };
}

export interface FlowEntry {
  text: string;
  heading: boolean;
  gapBefore: number;
  /** Start this entry in the next column when the current one has content. */
  columnBreak?: boolean;
}

export function toEntries(
  sections: Section[], headingCase: (s: string) => string, gap: number,
  breakBefore?: (heading: string, index: number) => boolean,
): FlowEntry[] {
  const out: FlowEntry[] = [];
  sections.forEach((s, i) => {
    out.push({
      text: headingCase(s.heading), heading: true, gapBefore: i === 0 ? 0 : gap,
      ...(i > 0 && breakBefore?.(s.heading, i) ? { columnBreak: true } : {}),
    });
    for (const item of s.items) out.push({ text: item, heading: false, gapBefore: 0 });
  });
  return out;
}

export interface ColumnSpec {
  x: number;
  w: number;
  top: number;
  bottom: number;
}

export interface FlowStyle {
  size: number;
  lh: number;
  /** Hanging indent of wrapped item lines. */
  hang: number;
  /** Left inset for item lines (room for a bullet). */
  inset: number;
}

export interface PlacedLine {
  text: string;
  x: number;
  y: number;
  heading: boolean;
  first: boolean;
}

export function flow(entries: FlowEntry[], cols: ColumnSpec[], style: FlowStyle): { placed: PlacedLine[]; rest: FlowEntry[] } {
  const placed: PlacedLine[] = [];
  let col = 0;
  let y = cols[0]?.top ?? 0;
  let i = 0;
  while (i < entries.length && col < cols.length) {
    const c = cols[col];
    const e = entries[i];
    if (e.columnBreak && y !== c.top && col < cols.length - 1) {
      col++;
      y = cols[col].top;
      continue;
    }
    const inset = e.heading ? 0 : style.inset;
    const lines = wrapD(e.text, e.heading ? "bold" : "body", style.size, c.w - inset - 2);
    const gap = y === c.top ? 0 : e.gapBefore;
    const keep = e.heading ? style.lh : 0;
    if (y + gap + lines.length * style.lh + keep > c.bottom) {
      if (y === c.top && col === cols.length - 1) break;
      col++;
      y = cols[col]?.top ?? 0;
      continue;
    }
    y += gap;
    lines.forEach((text, li) => {
      placed.push({
        text,
        x: c.x + inset + (li > 0 ? style.hang : 0),
        y,
        heading: e.heading,
        first: li === 0,
      });
      y += style.lh;
    });
    i++;
  }
  return { placed, rest: entries.slice(i) };
}

export function paintPlaced(
  p: Painter, placed: PlacedLine[], style: FlowStyle,
  o: { bullet?: "square" | "dot"; headingFont?: "underlined" | "bold" } = {},
): void {
  for (const l of placed) {
    if (l.heading) {
      if (o.headingFont === "bold") tx(p, l.text, l.x, l.y, style.size, "bold");
      else underlined(p, l.text, l.x, l.y, style.size);
      continue;
    }
    tx(p, l.text, l.x, l.y, style.size, "body");
    if (o.bullet && l.first) {
      const s = o.bullet === "square" ? style.size * 0.36 : style.size * 0.3;
      bx(p, l.x - style.inset + 1, l.y + style.size * 0.46, s, s, INK);
    }
  }
}

export interface ContinuationContext {
  title: string;
  vin: string;
  style: FlowStyle;
  bottom: number;
}

const CONT_TOP = 120;

export function continuationColumns(bottom: number): ColumnSpec[] {
  const gap = 28;
  const w = (1940 - 3 * gap) / 4;
  return [0, 1, 2, 3].map((i) => ({ x: 30 + i * (w + gap), w, top: CONT_TOP, bottom }));
}

export function paintContinuation(p: Painter, ctx: ContinuationContext, entries: FlowEntry[]): FlowEntry[] {
  tx(p, ctx.title, 30, 66, 24, "bold");
  tx(p, `VIN: ${ctx.vin}`, 1970, 70, 17, "bold", { align: "right" });
  bx(p, 30, 100, 1940, 3, INK);
  tx(p, "STANDARD EQUIPMENT CONTINUED", 30, 112, 15, "bold");
  const cols = continuationColumns(ctx.bottom).map((c) => ({ ...c, top: CONT_TOP + 44 }));
  const { placed, rest } = flow(entries, cols, ctx.style);
  tx(p, `Continuation of the reproduction window sticker for VIN ${ctx.vin}. This page belongs to the sticker on page 1 and is not valid on its own.`, 30, CONT_TOP + 20, 11, "body");
  paintPlaced(p, placed, ctx.style, { bullet: "dot" });
  return rest;
}

// ── Pricing ───────────────────────────────────────────────────────────

export interface PriceRow {
  label: string;
  amount: string | null;
  features: string[];
}

export function priceAmount(price: number | undefined, status: string, money: (n: number) => string = formatMoney): string {
  if (status === "INCLUDED") return "INCLUDED";
  if (status === "NO_CHARGE") return "NO CHARGE";
  if (price === undefined) return "N/A";
  return money(price);
}

export function priceRows(d: FactoryStickerData, money: (n: number) => string = formatMoney): PriceRow[] {
  const eq = d.equipment;
  return [
    ...eq.packages.map((k) => ({ label: k.name, amount: priceAmount(k.price, k.priceStatus, money), features: k.features })),
    ...eq.options.map((o) => ({ label: o.name, amount: priceAmount(o.price, o.priceStatus, money), features: o.features ?? [] })),
    ...(eq.portInstalled ?? []).map((o) => ({ label: o.name, amount: priceAmount(o.price, o.priceStatus, money), features: [] })),
  ];
}

export function totalMsrp(d: FactoryStickerData): number | undefined {
  return d.pricing.sourceReportedTotalMsrp ?? d.pricing.calculatedTotalMsrp;
}

export { formatMoney, formatPlain };

// ── Safety ratings panel ──────────────────────────────────────────────

export interface SafetyOpts {
  headerH: number;
  footerH: number;
  subFrac: number;
  valFrac: number;
  titleSize: number;
  labelSize: number;
  noteSize: number;
  footSize: number;
  /** Vertical stretch of the row offsets (1 = Hyundai master spacing). */
  stretch?: number;
}

export function paintSafetyPanel(p: Painter, d: FactoryStickerData, x: number, y: number, w: number, h: number, o: SafetyOpts): void {
  const r = d.regulatory;
  const s = o.stretch ?? 1;
  bx(p, x, y, w, h, INK);
  const bodyTop = y + o.headerH;
  const bodyH = h - o.headerH - o.footerH;
  bx(p, x + 4, bodyTop, w - 8, bodyH, PAPER);
  tx(p, "GOVERNMENT 5-STAR SAFETY RATINGS", x + w / 2, y + (o.headerH - o.titleSize) / 2 - 1, o.titleSize, "bold", { align: "center", color: PAPER });

  const value = (n: number | undefined): number | string => {
    if (r.nhtsaStatus === "UNAVAILABLE") return "Not Available";
    if (r.nhtsaStatus === "NOT_RATED" || n === undefined || n <= 0) return "Not Rated";
    return Math.min(5, Math.round(n));
  };
  const L = x + 9;
  const subX = x + w * o.subFrac;
  const valX = x + w * o.valFrac;
  const cell = (v: number | string, top: number): void => {
    if (typeof v === "number") starsAt(p, valX, top + 1, v, o.labelSize * 1.05);
    else tx(p, v, valX, top, o.labelSize, "bold");
  };
  const at = (off: number): number => bodyTop + off * s;
  const note = (str: string, off: number): void => tx(p, str, L, at(off), o.noteSize, "body");
  const rule = (off: number): void => bx(p, L, at(off), w - 22, 2, INK);

  tx(p, "Overall Vehicle Score", L, at(5), o.labelSize, "bold");
  cell(value(r.overallRating), at(5));
  note("Based on the combined ratings of frontal, side and rollover.", 28);
  note("Should ONLY be compared to other vehicles of similar size and weight.", 40);
  rule(67);
  tx(p, "Frontal", L, at(71), o.labelSize, "bold");
  tx(p, "Crash", L, at(95), o.labelSize, "bold");
  tx(p, "Driver", subX, at(71), o.labelSize, "body");
  tx(p, "Passenger", subX, at(95), o.labelSize, "body");
  cell(value(r.frontalDriverRating), at(71));
  cell(value(r.frontalPassengerRating), at(95));
  note("Based on the risk of injury in a frontal impact.", 113);
  note("Should ONLY be compared to other vehicles of similar size and weight.", 125);
  rule(145);
  tx(p, "Side", L, at(149), o.labelSize, "bold");
  tx(p, "Crash", L, at(173), o.labelSize, "bold");
  tx(p, "Front seat", subX, at(149), o.labelSize, "body");
  tx(p, "Rear seat", subX, at(173), o.labelSize, "body");
  cell(value(r.sideFrontRating), at(149));
  cell(value(r.sideRearRating), at(173));
  note("Based on the risk of injury in a side impact.", 189);
  rule(206);
  tx(p, "Rollover", L, at(210), o.labelSize, "bold");
  cell(value(r.rolloverRating), at(210));
  note("Based on the risk of rollover in a single-vehicle crash.", 232);

  const footTop = y + h - o.footerH;
  const lines = [
    "Star ratings range from 1 to 5 stars; 5 is the highest.",
    "Source: National Highway Traffic Safety Administration (NHTSA).",
    "www.nhtsa.gov/ratings",
  ];
  const pitch = o.footSize * 1.28;
  const first = footTop + (o.footerH - pitch * 3) / 2 + 2;
  lines.forEach((l, i) => tx(p, l, x + w / 2, first + i * pitch, o.footSize, "bold", { align: "center", color: PAPER }));
}

// ── Passport QR slot ──────────────────────────────────────────────────

export function paintQrSlot(p: Painter, url: string, x: number, y: number, w: number, h: number): void {
  if (!url) return;
  bx(p, x, y, w, h, PAPER);
  tx(p, "VEHICLE PASSPORT", x + w / 2, y + 6, 11.5, "bold", { align: "center" });
  const size = Math.min(w - 36, h - 50);
  p.qr(u(D(x + w / 2 - size / 2)), u(D(y + 24)), u(D(size)), url, INK);
  tx(p, PASSPORT_QR_CAPTION, x + w / 2, y + h - 18, 10.2, "body", { align: "center" });
}

// ── Parts content and origin ──────────────────────────────────────────

export interface PartsFacts {
  usCan?: { label: string; value: string };
  other: Array<{ label: string; value: string }>;
  engine?: { label: string; value: string };
  trans?: { label: string; value: string };
  assembly?: string;
}

export function partsFacts(d: FactoryStickerData): PartsFacts {
  const entries = (d.factory.partsContent ?? []).filter((e) => e.sourceVerified);
  const find = (re: RegExp) => entries.find((e) => re.test(e.label.toLowerCase()));
  const usCan = find(/u\.?s\.?.*canad|domestic|us\/canadian/);
  const engine = find(/engine/);
  const trans = find(/transmission/);
  const other = entries.filter((e) => e !== usCan && e !== engine && e !== trans && !/assembly/i.test(e.label));
  return {
    ...(usCan ? { usCan } : {}),
    ...(engine ? { engine } : {}),
    ...(trans ? { trans } : {}),
    other,
    ...(d.factory.finalAssemblyPoint ? { assembly: d.factory.finalAssemblyPoint } : {}),
  };
}

// ── Page assembly ─────────────────────────────────────────────────────

export interface FirstPageContext {
  input: VariantRenderInput;
  d: FactoryStickerData;
  footerTop: number;
}

export interface TabloidSpec {
  /** Paints page 1 (below the banner); returns unplaced equipment, or null when pricing cannot fit. */
  paintFirst: (p: Painter, ctx: FirstPageContext) => FlowEntry[] | null;
  contStyle: FlowStyle;
  contTitle: (d: FactoryStickerData, displayMake: string) => string;
}

export function assembleTabloid(input: VariantRenderInput, spec: TabloidSpec): LayoutModel | null {
  const d = input.layout.data;
  const disclosure = disclosureLines(input);
  const footerTop = footerTopFor(disclosure);
  const ctx: FirstPageContext = { input, d, footerTop };

  const probe = spec.paintFirst(new Painter(null), ctx);
  if (probe === null) return null;

  const contBottom = footerTop - 14;
  const cont: ContinuationContext = {
    title: spec.contTitle(d, input.displayMake),
    vin: d.vehicle.vin,
    style: spec.contStyle,
    bottom: contBottom,
  };
  const plan: FlowEntry[][] = [];
  let remaining = probe;
  while (remaining.length) {
    const next = paintContinuation(new Painter(null), cont, remaining);
    if (next.length === remaining.length) throw new Error("layout_failed: continuation entry cannot fit an empty page");
    plan.push(remaining.slice(0, remaining.length - next.length));
    remaining = next;
  }
  const pageCount = plan.length + 1;

  const drawn: string[] = [];
  const p = new Painter(drawn);
  paintBanner(p, pageCount > 1 ? `PAGE 1 OF ${pageCount} - EQUIPMENT CONTINUED ON PAGE 2` : "PAGE 1 OF 1");
  spec.paintFirst(p, ctx);
  paintDisclosure(p, disclosure, footerTop);
  const pages: LayoutPage[] = [{ primitives: p.primitives }];

  plan.forEach((entries, i) => {
    const cp = new Painter(drawn);
    paintBanner(cp, `PAGE ${i + 2} OF ${pageCount}`);
    paintContinuation(cp, cont, entries);
    paintDisclosure(cp, disclosure, footerTop);
    pages.push({ primitives: cp.primitives });
  });

  const model: LayoutModel = {
    width: TABLOID_WIDTH,
    height: TABLOID_HEIGHT,
    mode: pages.length > 1 ? "CONTINUATION_REQUIRED" : "STANDARD",
    pages,
    drawnStrings: drawn,
    fontFamilies: { heading: "Helvetica-Bold", body: "Helvetica", numeric: "Courier" },
  };
  validateModel(model);
  return model;
}
