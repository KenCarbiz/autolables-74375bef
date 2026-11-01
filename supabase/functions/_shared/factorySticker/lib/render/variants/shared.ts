// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/render/variants/shared.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// Drawing helpers shared by the reference-variant layouts. Coordinates are
// in Figma units (the masters are drawn at 2x) and halved into PDF points.

import { MIN_BODY_FONT_SIZE, Painter, starPath, wrapText, type LayoutFont, type LayoutModel, type StickerLayoutInput } from "../layout.ts";

export const u = (figma: number): number => figma / 2;
export const INK = "#000000";
export const PAPER = "#ffffff";
export const EPA_BLUE = "#8cc4e3";

/** Font size: Figma px halved, floored at the engine's readable minimum. */
export const pt = (figmaPx: number): number => Math.max(MIN_BODY_FONT_SIZE, figmaPx / 2);

/** Baseline for a text box whose top edge is `top` (Figma units). */
export const baseline = (top: number, sizePx: number, lineHeightPx = sizePx * 1.05): number =>
  top + (lineHeightPx - 1.117 * sizePx) / 2 + 0.905 * sizePx;

export interface VariantRenderInput {
  layout: StickerLayoutInput;
  /** Source equipment groups by their original group names. */
  equipmentGroups: Array<{ hint: string; items: string[] }>;
  displayMake: string;
}

/** Returns null when the content cannot be represented faithfully. */
export type VariantLayoutBuilder = (input: VariantRenderInput) => LayoutModel | null;

export function txt(
  p: Painter, s: string, xFigma: number, topFigma: number, sizePx: number, font: LayoutFont,
  opts: { align?: "left" | "right" | "center"; color?: string; lh?: number; spacing?: number } = {},
): void {
  p.text(s, u(xFigma), u(baseline(topFigma, sizePx, opts.lh)), pt(sizePx), font, opts.color ?? INK, {
    ...(opts.align ? { align: opts.align } : {}),
    ...(opts.spacing ? { charSpacing: opts.spacing } : {}),
  });
}

export function box(p: Painter, x: number, y: number, w: number, h: number, fill: string | null, strokePx?: number): void {
  if (strokePx) {
    const s = u(strokePx);
    p.rect(u(x) + s / 2, u(y) + s / 2, u(w) - s, u(h) - s, fill, INK, s);
  } else {
    p.rect(u(x), u(y), u(w), u(h), fill);
  }
}

export function stars(p: Painter, xFigma: number, topFigma: number, count: number): void {
  const size = u(15);
  for (let i = 0; i < count; i++) {
    p.path(starPath(size), u(xFigma) + i * (size + 1.2), u(topFigma), size, size, INK);
  }
}

export function pump(p: Painter, xFigma: number, yFigma: number, hFigma: number, color: string): void {
  // Plain fuel-pump glyph built from rectangles (no source artwork).
  const h = u(hFigma);
  const x = u(xFigma);
  const y = u(yFigma);
  p.rect(x, y + h * 0.08, h * 0.5, h * 0.84, color);
  p.rect(x + h * 0.08, y + h * 0.18, h * 0.34, h * 0.22, color === INK ? PAPER : INK);
  p.rect(x + h * 0.56, y + h * 0.28, h * 0.08, h * 0.5, color);
  p.rect(x + h * 0.5, y + h * 0.24, h * 0.14, h * 0.07, color);
}

export function wrapFigma(s: string, font: LayoutFont, sizePx: number, widthFigma: number): string[] {
  return wrapText(s, font, pt(sizePx), u(widthFigma));
}

export function roundedRectPath(w: number, h: number, r: number): string {
  return [
    `M${r} 0`, `L${w - r} 0`, `Q${w} 0 ${w} ${r}`, `L${w} ${h - r}`, `Q${w} ${h} ${w - r} ${h}`,
    `L${r} ${h}`, `Q0 ${h} 0 ${h - r}`, `L0 ${r}`, `Q0 0 ${r} 0`, "Z",
  ].join(" ");
}

export function scale(p: Painter, x: number, y: number, w: number): void {
  box(p, x, y, w, 16, EPA_BLUE);
  box(p, x, y, 20, 16, INK);
  box(p, x + w - 20, y, 20, 16, INK);
  txt(p, "1", x + 10, y + 1, 13, "bold", { align: "center", color: PAPER, lh: 16 });
  txt(p, "10", x + w - 10, y + 1, 13, "bold", { align: "center", color: PAPER, lh: 16 });
}
