import {
  MIN_BODY_FONT_SIZE,
  PAGE_HEIGHT,
  PAGE_MARGIN,
  PAGE_WIDTH,
  textBBox,
  type LayoutModel,
  type TextPrimitive,
} from "../layout.ts";

export const pageTexts = (model: LayoutModel, page: number): TextPrimitive[] =>
  model.pages[page].primitives.filter((p): p is TextPrimitive => p.kind === "text");

export const pageStrings = (model: LayoutModel, page: number): string[] =>
  pageTexts(model, page).map((t) => t.str);

export function expectWithinBounds(model: LayoutModel): void {
  for (const [pi, page] of model.pages.entries()) {
    for (const prim of page.primitives) {
      if (prim.kind === "text") {
        const box = textBBox(prim);
        if (
          box.x0 < PAGE_MARGIN - 0.51 ||
          box.x1 > PAGE_WIDTH - PAGE_MARGIN + 0.51 ||
          box.y1 > PAGE_HEIGHT - PAGE_MARGIN + 0.51 ||
          box.y0 < 0
        ) {
          throw new Error(`text out of bounds on page ${pi + 1}: ${JSON.stringify(prim.str)}`);
        }
      } else {
        const w = prim.kind === "qr" ? prim.size : prim.w;
        const h = prim.kind === "qr" ? prim.size : prim.h;
        if (
          prim.x < PAGE_MARGIN - 0.01 ||
          prim.y < PAGE_MARGIN - 0.01 ||
          prim.x + w > PAGE_WIDTH - PAGE_MARGIN + 0.01 ||
          prim.y + h > PAGE_HEIGHT - PAGE_MARGIN + 0.01
        ) {
          throw new Error(`${prim.kind} out of bounds on page ${pi + 1}`);
        }
      }
    }
  }
}

export function expectMinFontRespected(model: LayoutModel): void {
  for (const page of model.pages) {
    for (const prim of page.primitives) {
      if (prim.kind === "text" && prim.size < MIN_BODY_FONT_SIZE) {
        throw new Error(`font size ${prim.size} below ${MIN_BODY_FONT_SIZE}: ${prim.str}`);
      }
    }
  }
}

export function expectNoTextOverlap(model: LayoutModel, page: number): void {
  const texts = pageTexts(model, page);
  const boxes = texts.map((t) => ({ t, box: textBBox(t) }));
  const EPS = 0.35;
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i].box;
      const b = boxes[j].box;
      const xOverlap = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
      const yOverlap = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
      if (xOverlap > EPS && yOverlap > EPS) {
        throw new Error(
          `overlapping text on page ${page + 1}: ${JSON.stringify(boxes[i].t.str)} vs ${JSON.stringify(boxes[j].t.str)}`,
        );
      }
    }
  }
}

export function expectNoPlaceholderArtifacts(model: LayoutModel): void {
  for (const page of model.pages) {
    for (const prim of page.primitives) {
      if (prim.kind !== "text") continue;
      if (!prim.str.trim()) throw new Error("empty drawn string");
      if (/\b(undefined|null|NaN)\b/.test(prim.str)) {
        throw new Error(`placeholder artifact: ${prim.str}`);
      }
    }
  }
}
