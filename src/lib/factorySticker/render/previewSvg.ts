// LayoutModel -> standalone SVG string for the stored preview and admin UI.
// Pages stack vertically; barcode and QR are realized as vector rects from
// the same encoders the PDF path uses, so preview and PDF stay in lockstep.

import { encodeCode128 } from "./code128.ts";
import { encodeQrMatrix } from "./qrMatrix.ts";
import type { LayoutFont, LayoutModel } from "./layout.ts";

const PAGE_GAP = 12;

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const num = (n: number): string => String(Math.round(n * 100) / 100);

export function layoutToSvg(model: LayoutModel): string {
  const totalH = model.pages.length * model.height + (model.pages.length - 1) * PAGE_GAP;
  const family = (font: LayoutFont): string =>
    font === "numeric" ? model.fontFamilies.numeric : font === "body" ? model.fontFamilies.body : model.fontFamilies.heading;
  const weight = (font: LayoutFont): string => (font === "bold" || font === "heading" ? "700" : "400");

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${model.width}" height="${num(totalH)}" viewBox="0 0 ${model.width} ${num(totalH)}">`,
  );

  model.pages.forEach((page, pi) => {
    const oy = pi * (model.height + PAGE_GAP);
    parts.push(`<g data-page="${pi + 1}">`);
    parts.push(
      `<rect x="0" y="${num(oy)}" width="${model.width}" height="${model.height}" fill="#ffffff" stroke="#d0d3d8" stroke-width="0.5"/>`,
    );
    for (const prim of page.primitives) {
      if (prim.kind === "text") {
        const anchor = prim.align === "right" ? "end" : prim.align === "center" ? "middle" : "start";
        const spacing = prim.charSpacing ? ` letter-spacing="${num(prim.charSpacing)}"` : "";
        parts.push(
          `<text x="${num(prim.x)}" y="${num(oy + prim.y)}" font-size="${num(prim.size)}" ` +
            `font-family="${esc(family(prim.font))}" font-weight="${weight(prim.font)}" ` +
            `fill="${esc(prim.color)}" text-anchor="${anchor}"${spacing}>${esc(prim.str)}</text>`,
        );
      } else if (prim.kind === "rule") {
        parts.push(
          `<rect x="${num(prim.x)}" y="${num(oy + prim.y)}" width="${num(prim.w)}" height="${num(prim.h)}" fill="${esc(prim.color)}"/>`,
        );
      } else if (prim.kind === "rect") {
        const fill = prim.fill !== null ? esc(prim.fill) : "none";
        const stroke = prim.stroke !== undefined
          ? ` stroke="${esc(prim.stroke)}" stroke-width="${num(prim.strokeWidth ?? 0.75)}"`
          : "";
        parts.push(
          `<rect x="${num(prim.x)}" y="${num(oy + prim.y)}" width="${num(prim.w)}" height="${num(prim.h)}" fill="${fill}"${stroke}/>`,
        );
      } else if (prim.kind === "barcode") {
        const encoding = encodeCode128(prim.payload);
        const quiet = 10;
        const moduleW = prim.w / (encoding.totalModules + quiet * 2);
        let mx = prim.x + quiet * moduleW;
        const bars: string[] = [];
        encoding.widths.forEach((w, i) => {
          const width = w * moduleW;
          if (i % 2 === 0) {
            bars.push(
              `<rect x="${num(mx)}" y="${num(oy + prim.y)}" width="${num(width)}" height="${num(prim.h)}" fill="${esc(prim.color)}"/>`,
            );
          }
          mx += width;
        });
        parts.push(`<g data-barcode="code128">${bars.join("")}</g>`);
      } else {
        const encoding = encodeQrMatrix(prim.payload);
        const cell = prim.size / encoding.size;
        const cells: string[] = [];
        for (let r = 0; r < encoding.size; r++) {
          for (let c = 0; c < encoding.size; c++) {
            if (!encoding.matrix[r][c]) continue;
            cells.push(
              `<rect x="${num(prim.x + c * cell)}" y="${num(oy + prim.y + r * cell)}" width="${num(cell)}" height="${num(cell)}" fill="${esc(prim.color)}"/>`,
            );
          }
        }
        parts.push(
          `<g data-qr="1"><rect x="${num(prim.x)}" y="${num(oy + prim.y)}" width="${num(prim.size)}" height="${num(prim.size)}" fill="#ffffff"/>${cells.join("")}</g>`,
        );
      }
    }
    parts.push("</g>");
  });

  parts.push("</svg>");
  return parts.join("");
}
