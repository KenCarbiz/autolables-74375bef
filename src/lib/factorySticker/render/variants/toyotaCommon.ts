// Shared 17x11 layout for the Toyota-family catalog templates (Lexus RX 350 and
// Toyota 4Runner). Both references carry the same blocks: a logo and identity
// header, the standard equipment list, base price plus installed options, the
// MSRP / delivery / total lines, the NHTSA panel, the EPA panel and a VIN
// barcode. A config places each block in the reference's 100 dpi pixels; a Grid
// keeps the horizontals and compresses verticals to clear the mandatory
// reproduction banner and disclosure.
//
// Every printed value comes from render data. The source Smartphone QR (the
// 0.90in Vehicle Passport QR takes its slot), agency seals, the dealer-owner
// support offers and the source barcode are not reproduced. The sample's empty
// frames print nothing; the parts-content box takes the free slot.

import type { FactoryStickerData } from "../../types.ts";
import { Painter, type LayoutModel } from "../layout.ts";
import { VARIANT_LOGOS } from "./logoArtwork.ts";
import { INK, baseline, type VariantLayoutBuilder } from "./shared.ts";
import { R, T, wrap } from "./hyundaiTucsonGas.ts";
import {
  TABLOID_HEIGHT, TABLOID_WIDTH, assembleTabloid, buildSections, dealerLines, flow, paintPlaced, placedResult, priceRowsWithoutColors,
  toEntries, totalMsrp, withColumns,
  type ColumnSpec, type FirstPageContext, type FirstPageResult, type FlowStyle, type TabloidSpec,
} from "./tabloidCommon.ts";
import {
  PRICE_FOOTNOTE, PX, Q, makeGrid, money, msrpWithOptions, paintCatalogEpa, paintCatalogParts, paintCatalogSafety, paintPriceLines,
  type Grid,
} from "./catalogBlocks.ts";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ToyotaFamilyConfig {
  eqStyle: FlowStyle;
  grid: Grid;
  logo: { key: "lexus" | "toyota"; x: number; y: number; w: number };
  /** Outer label border in reference px (x1, y1, x2, y2), drawn where the reference has one. */
  frame?: [number, number, number, number];
  header: (p: Painter, d: FactoryStickerData, g: Grid) => void;
  eqHeading: { text: string; x: number; y: number; size: number; align?: "left" | "center"; spacing?: number; note?: { text: string; x: number; y: number; size: number } };
  /** Equipment columns in reference pixels; `extra` re-splits the leading region. */
  eqColumns: (g: Grid, extra: number, priceEnd: number) => ColumnSpec[];
  options: {
    heading?: { text: string; x: number; y: number; size: number; align?: "left" | "center"; spacing?: number };
    baseLabel: { text: string; x: number; y: number; size: number };
    right: number;
    rowsX: number;
    rowsTop: number;
    rowsLimit: number;
    labelW: number;
    size: number;
  };
  totals: {
    msrp: { label: string; labelX: number; labelAlign: "left" | "right"; y: number; size: number };
    delivery: { label: string; labelX: number; labelAlign: "left" | "right"; y: number; size: number };
    total: { label: string; labelX: number; labelAlign: "left" | "right"; y: number; size: number };
    amountRight: number;
    footnote: { x: number; y: number; w: number };
  };
  safety: Box;
  epa: { x: number; y: number };
  parts: Box;
  partsColumns: 1 | 2;
  delivered: { x: number; y: number; w: number; h: number; framed: boolean };
  barcode: Box;
}

function spaced(p: Painter, s: string, x: number, top: number, size: number, spacing: number, align: "left" | "center"): void {
  const sz = Math.max(5.5, size);
  p.text(s, x, baseline(top, sz), sz, "bold", INK, { align, ...(spacing ? { charSpacing: spacing } : {}) });
}

function paintLogo(p: Painter, cfg: ToyotaFamilyConfig): void {
  const logo = VARIANT_LOGOS[cfg.logo.key];
  const g = cfg.grid;
  const w = cfg.logo.w * PX;
  p.image(logo.png, logo.assetId, g.x(cfg.logo.x), g.y(cfg.logo.y), w, (w * logo.slot.h) / logo.slot.w);
}

function paintOptions(p: Painter, d: FactoryStickerData, cfg: ToyotaFamilyConfig): number | null {
  const g = cfg.grid;
  const o = cfg.options;
  const Rt = g.x(o.right);
  if (o.heading) {
    const h = o.heading;
    spaced(p, h.text, g.x(h.x), g.y(h.y), h.size, h.spacing ?? 0, h.align ?? "left");
  }
  T(p, o.baseLabel.text, g.x(o.baseLabel.x), g.y(o.baseLabel.y), o.baseLabel.size, "bold");
  T(p, money(d.pricing.baseMsrp), Rt, g.y(o.baseLabel.y), o.baseLabel.size + 1.4, "bold", { align: "right" });
  return paintPriceLines(p, priceRowsWithoutColors(d), g.x(o.rowsX), Rt, g.y(o.rowsTop), g.y(o.rowsLimit), { size: o.size, labelW: o.labelW * PX });
}

function paintTotals(p: Painter, d: FactoryStickerData, cfg: ToyotaFamilyConfig): void {
  const g = cfg.grid;
  const t = cfg.totals;
  const Rt = g.x(t.amountRight);
  const row = (spec: { label: string; labelX: number; labelAlign: "left" | "right"; y: number; size: number }, amount: string, bold: boolean): void => {
    T(p, spec.label, g.x(spec.labelX), g.y(spec.y), spec.size, bold ? "bold" : "body", { align: spec.labelAlign });
    T(p, amount, Rt, g.y(spec.y), spec.size + (bold ? 1.2 : 0), "bold", { align: "right" });
  };
  row(t.msrp, money(msrpWithOptions(d)), false);
  row(t.delivery, money(d.pricing.destinationCharge), false);
  row(t.total, money(totalMsrp(d)), true);
  wrap(PRICE_FOOTNOTE, "body", 6.2, t.footnote.w * PX).forEach((l, i) => T(p, l, g.x(t.footnote.x), g.y(t.footnote.y) + i * 7.2, 6.2, "body"));
}

function paintDelivered(p: Painter, d: FactoryStickerData, cfg: ToyotaFamilyConfig): void {
  const g = cfg.grid;
  const b = cfg.delivered;
  if (b.framed) R(p, g.x(b.x), g.y(b.y), b.w * PX, g.y(b.y + b.h) - g.y(b.y), null, 1);
  const label = d.factory.transportMethod ? `Delivered by ${d.factory.transportMethod} to:` : "Delivered to:";
  T(p, label, g.x(b.x) + 6, g.y(b.y) + 3, 6.6, "bold");
  if (d.factory.dealerCode) T(p, d.factory.dealerCode.toUpperCase(), g.x(b.x + b.w) - 6, g.y(b.y) + 3, 6.6, "bold", { align: "right" });
  dealerLines(d).slice(0, 3).forEach((l, i) => T(p, l, g.x(b.x) + 14, g.y(b.y) + 14 + i * 9.4, 7.6, "body"));
}

export function toyotaFamilySpec(cfg: ToyotaFamilyConfig): TabloidSpec {
  const g = cfg.grid;
  return {
    eqStyle: cfg.eqStyle,
    paintFirst(p: Painter, ctx: FirstPageContext): FirstPageResult | null {
      const { d, input } = ctx;
      if (cfg.frame) {
        const [x1, y1, x2, y2] = cfg.frame;
        R(p, g.x(x1), g.y(y1), g.x(x2) - g.x(x1), g.y(y2) - g.y(y1), null, 2.4);
      }
      paintLogo(p, cfg);
      cfg.header(p, d, g);
      const priceEnd = paintOptions(p, d, cfg);
      if (priceEnd === null) return null;
      paintTotals(p, d, cfg);
      paintDelivered(p, d, cfg);

      const eh = cfg.eqHeading;
      spaced(p, eh.text, g.x(eh.x), g.y(eh.y), eh.size, eh.spacing ?? 0, eh.align ?? "left");
      if (eh.note) T(p, eh.note.text, g.x(eh.note.x), g.y(eh.note.y), eh.note.size, "body");
      const sections = buildSections(input);
      const entries = toEntries(sections, (s) => s.toUpperCase(), 3, undefined, input.equipmentNote);
      const cols = cfg.eqColumns(g, ctx.extraColumns, priceEnd);
      if (!sections.length) T(p, "Standard equipment not available for this vehicle.", cols[0].x * 0.612, cols[0].top * 0.612 + 3, 8, "body");
      const { placed, rest } = flow(entries, cols, ctx.style);
      paintPlaced(p, placed, ctx.style, { headingFont: "bold" });

      paintCatalogSafety(p, d, g.x(cfg.safety.x), g.y(cfg.safety.y), cfg.safety.w * PX, g.y(cfg.safety.y + cfg.safety.h) - g.y(cfg.safety.y));
      paintCatalogEpa(p, d, g, cfg.epa.x, cfg.epa.y);
      paintCatalogParts(p, d, g.x(cfg.parts.x), g.y(cfg.parts.y), cfg.parts.w * PX, g.y(cfg.parts.y + cfg.parts.h) - g.y(cfg.parts.y), cfg.partsColumns);
      if (input.layout.barcodePayload) {
        p.barcode(g.x(cfg.barcode.x), g.y(cfg.barcode.y), cfg.barcode.w * PX, g.y(cfg.barcode.y + cfg.barcode.h) - g.y(cfg.barcode.y), input.layout.barcodePayload, INK);
      }
      return placedResult(entries, rest);
    },
  };
}

export const buildToyotaFamilyLayout = (cfg: ToyotaFamilyConfig): VariantLayoutBuilder => {
  const spec = toyotaFamilySpec(cfg);
  return (input): LayoutModel | null => {
    const model = assembleTabloid(input, spec);
    if (model && (model.width !== TABLOID_WIDTH || model.height !== TABLOID_HEIGHT)) return null;
    return model;
  };
};

/** One equipment column in reference pixels, converted to display units. */
export const eqCol = (g: Grid, x: number, w: number, top: number, bottom: number): ColumnSpec => ({ x: Q(g.x(x)), w: Q(w * PX), top: Q(g.y(top)), bottom: Q(g.y(bottom)) });

export const splitColumns = (cols: ColumnSpec[], extra: number): ColumnSpec[] => withColumns(cols, extra);
