// pdf-lib realization of a LayoutModel. Written against a structural
// PdfLibModule so the identical code runs with the npm package (vitest /
// browser) and the esm.sh build (Deno edge). Output is deterministic:
// fixed metadata dates, vector-only drawing, no randomness.

import { encodeCode128 } from "./code128.ts";
import { encodeQrMatrix } from "./qrMatrix.ts";
import {
  charWidthUnits,
  measureText,
  type LayoutFont,
  type LayoutModel,
  type TextPrimitive,
} from "./layout.ts";

export interface PdfColor {
  type: unknown;
}

export interface PdfFontLike {
  widthOfTextAtSize?(text: string, size: number): number;
}

export interface PdfPageLike {
  drawText(
    text: string,
    options: { x: number; y: number; size: number; font: PdfFontLike; color: PdfColor },
  ): void;
  drawRectangle(options: {
    x: number;
    y: number;
    width: number;
    height: number;
    color?: PdfColor;
    borderColor?: PdfColor;
    borderWidth?: number;
  }): void;
}

export interface PdfDocumentLike {
  addPage(size: [number, number]): PdfPageLike;
  embedFont(font: string): Promise<PdfFontLike>;
  setTitle(title: string): void;
  setProducer(producer: string): void;
  setCreator(creator: string): void;
  setCreationDate(date: Date): void;
  setModificationDate(date: Date): void;
  save(): Promise<Uint8Array>;
}

export interface PdfLibModule {
  PDFDocument: { create(): Promise<PdfDocumentLike> };
  StandardFonts: { Helvetica: string; HelveticaBold: string; Courier: string };
  rgb(r: number, g: number, b: number): PdfColor;
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}

export async function realizePdf(model: LayoutModel, lib: PdfLibModule): Promise<Uint8Array> {
  const doc = await lib.PDFDocument.create();
  const fonts: Record<LayoutFont, PdfFontLike> = {
    body: await doc.embedFont(lib.StandardFonts.Helvetica),
    heading: await doc.embedFont(lib.StandardFonts.HelveticaBold),
    bold: await doc.embedFont(lib.StandardFonts.HelveticaBold),
    numeric: await doc.embedFont(lib.StandardFonts.Courier),
  };
  const color = (hex: string): PdfColor => {
    const [r, g, b] = hexToRgb(hex);
    return lib.rgb(r, g, b);
  };

  const drawTextPrim = (page: PdfPageLike, t: TextPrimitive): void => {
    const font = fonts[t.font];
    const spacing = t.charSpacing ?? 0;
    const width = measureText(t.str, t.font, t.size, spacing);
    const x0 = t.align === "right" ? t.x - width : t.align === "center" ? t.x - width / 2 : t.x;
    const y = model.height - t.y;
    const fill = color(t.color);
    if (spacing > 0) {
      let cx = x0;
      for (const ch of t.str) {
        page.drawText(ch, { x: cx, y, size: t.size, font, color: fill });
        cx += (charWidthUnits(ch, t.font) / 1000) * t.size + spacing;
      }
    } else {
      page.drawText(t.str, { x: x0, y, size: t.size, font, color: fill });
    }
  };

  for (const layoutPage of model.pages) {
    const page = doc.addPage([model.width, model.height]);
    for (const prim of layoutPage.primitives) {
      if (prim.kind === "text") {
        drawTextPrim(page, prim);
      } else if (prim.kind === "rule") {
        page.drawRectangle({
          x: prim.x,
          y: model.height - prim.y - prim.h,
          width: prim.w,
          height: prim.h,
          color: color(prim.color),
        });
      } else if (prim.kind === "rect") {
        page.drawRectangle({
          x: prim.x,
          y: model.height - prim.y - prim.h,
          width: prim.w,
          height: prim.h,
          ...(prim.fill !== null ? { color: color(prim.fill) } : {}),
          ...(prim.stroke !== undefined
            ? { borderColor: color(prim.stroke), borderWidth: prim.strokeWidth ?? 0.75 }
            : {}),
        });
      } else if (prim.kind === "barcode") {
        const encoding = encodeCode128(prim.payload);
        const quiet = 10;
        const moduleW = prim.w / (encoding.totalModules + quiet * 2);
        let mx = prim.x + quiet * moduleW;
        const barColor = color(prim.color);
        encoding.widths.forEach((w, i) => {
          const width = w * moduleW;
          if (i % 2 === 0) {
            page.drawRectangle({
              x: mx,
              y: model.height - prim.y - prim.h,
              width,
              height: prim.h,
              color: barColor,
            });
          }
          mx += width;
        });
      } else {
        const encoding = encodeQrMatrix(prim.payload);
        const cell = prim.size / encoding.size;
        const dark = color(prim.color);
        for (let r = 0; r < encoding.size; r++) {
          for (let c = 0; c < encoding.size; c++) {
            if (!encoding.matrix[r][c]) continue;
            page.drawRectangle({
              x: prim.x + c * cell,
              y: model.height - prim.y - (r + 1) * cell,
              width: cell,
              height: cell,
              color: dark,
            });
          }
        }
      }
    }
  }

  doc.setTitle("Factory Window Sticker");
  doc.setProducer("AutoLabels Factory Sticker Renderer");
  doc.setCreator("AutoLabels");
  doc.setCreationDate(new Date(0));
  doc.setModificationDate(new Date(0));
  return doc.save();
}
