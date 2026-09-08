// ──────────────────────────────────────────────────────────────────────
// Used-vehicle window sticker — the print artifact.
//
// One page of 8.5x11 paper (PAPER.window in src/lib/stickerStudio/printConfig
// .ts) with a 0.25in safe margin. The sheet is PAPER: the background is
// literal white and the ink is literal black, not theme tokens. A printed
// sticker has no dark mode.
//
// The content model and the prohibited-content rules live in the pure,
// unit-tested src/lib/documents/usedVehicleWindowSticker.ts (mirrored here by
// `bun run sync:edge-sticker`). This module only draws it.
// ──────────────────────────────────────────────────────────────────────

import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";
import { encodeQrMatrix } from "./factorySticker/lib/render/qrMatrix.ts";
import { encodeCode128 } from "./factorySticker/lib/render/code128.ts";
import type { UsedVehicleWindowStickerContent } from "./factorySticker/lib/documents/usedVehicleWindowSticker.ts";

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 18;
const WHITE = rgb(1, 1, 1);
const BLACK = rgb(0, 0, 0);
const RULE = rgb(0.72, 0.72, 0.72);
const MUTED = rgb(0.35, 0.35, 0.35);

// deno-lint-ignore no-explicit-any
type Font = any;
// deno-lint-ignore no-explicit-any
type Page = any;

const widthOf = (font: Font, s: string, size: number): number => font.widthOfTextAtSize(s, size);

/** Hard-truncate to a pixel width with an ellipsis; never wraps a sticker line. */
function clip(font: Font, s: string, size: number, max: number): string {
  if (widthOf(font, s, size) <= max) return s;
  let out = s;
  while (out.length > 1 && widthOf(font, `${out}...`, size) > max) out = out.slice(0, -1);
  return `${out}...`;
}

function wrap(font: Font, s: string, size: number, max: number, maxLines: number): string[] {
  const words = s.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (widthOf(font, next, size) <= max) { line = next; continue; }
    if (line) lines.push(line);
    line = w;
    if (lines.length === maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines.slice(0, maxLines);
}

function drawQr(page: Page, payload: string, x: number, y: number, box: number): void {
  const enc = encodeQrMatrix(payload);
  const module = box / enc.size;
  page.drawRectangle({ x, y, width: box, height: box, color: WHITE });
  for (let r = 0; r < enc.size; r++) {
    for (let c = 0; c < enc.size; c++) {
      if (!enc.matrix[r][c]) continue;
      page.drawRectangle({
        x: x + c * module,
        y: y + box - (r + 1) * module,
        width: module,
        height: module,
        color: BLACK,
      });
    }
  }
}

function drawBarcode(page: Page, payload: string, x: number, y: number, width: number, height: number): void {
  const enc = encodeCode128(payload);
  const unit = width / enc.totalModules;
  let cursor = x;
  let dark = true;
  for (const w of enc.widths) {
    const w0 = w * unit;
    if (dark) page.drawRectangle({ x: cursor, y, width: w0, height, color: BLACK });
    cursor += w0;
    dark = !dark;
  }
}

export async function renderUsedCarStickerPdf(content: UsedVehicleWindowStickerContent): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  // Deterministic document metadata. pdf-lib stamps CreationDate/ModDate with
  // the current clock on a created document, which changes the bytes on every
  // run — and fileForm decides "is this the same sticker" by SHA-256 of the
  // bytes. Left as-is, a published sticker would be superseded by a brand-new
  // version every single night for a vehicle nobody touched. The two filled
  // government forms do not hit this because they are LOADED from a template
  // and keep its Info dict.
  const EPOCH = new Date(0);
  pdf.setCreationDate(EPOCH);
  pdf.setModificationDate(EPOCH);
  pdf.setProducer("AutoLabels");
  pdf.setCreator("AutoLabels");
  pdf.setTitle(`Used Vehicle Window Sticker - ${content.vin}`);
  const page = pdf.addPage([PAGE_W, PAGE_H]);
  const body = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  // The sheet is paper. Paint it white explicitly rather than relying on the
  // viewer's page background, so a print driver never renders it transparent.
  page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: WHITE });

  const left = MARGIN;
  const right = PAGE_W - MARGIN;
  const inner = right - left;
  let y = PAGE_H - MARGIN;

  const dealerName = content.dealerLines[0] || "";
  if (dealerName) {
    y -= 16;
    page.drawText(clip(bold, dealerName.toUpperCase(), 14, inner), { x: left, y, size: 14, font: bold, color: BLACK });
  }
  y -= 8;
  page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 1.4, color: BLACK });

  // ── Identity + price ────────────────────────────────────────────────
  const priceW = content.priceText ? Math.max(150, widthOf(bold, content.priceText, 30) + 16) : 0;
  const titleW = inner - priceW - 12;
  y -= 30;
  page.drawText(clip(bold, content.title, 24, titleW), { x: left, y, size: 24, font: bold, color: BLACK });
  if (content.priceText) {
    page.drawText(content.priceLabel, {
      x: right - widthOf(body, content.priceLabel, 9),
      y: y + 16,
      size: 9,
      font: body,
      color: MUTED,
    });
    page.drawText(content.priceText, {
      x: right - widthOf(bold, content.priceText, 30),
      y,
      size: 30,
      font: bold,
      color: BLACK,
    });
  }
  if (content.subtitle) {
    y -= 15;
    page.drawText(clip(body, content.subtitle, 12, titleW), { x: left, y, size: 12, font: body, color: MUTED });
  }

  y -= 20;
  const facts = [
    ["VIN", content.vin],
    ["Stock", content.stockNumber || "-"],
    ["Odometer", content.mileageText || "Not recorded"],
  ] as const;
  const factW = inner / facts.length;
  facts.forEach(([label, value], i) => {
    const fx = left + i * factW;
    page.drawText(label.toUpperCase(), { x: fx, y, size: 7.5, font: body, color: MUTED });
    page.drawText(clip(bold, value, 11, factW - 10), { x: fx, y: y - 13, size: 11, font: bold, color: BLACK });
  });
  y -= 24;
  page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 0.7, color: RULE });

  // ── Specifications ──────────────────────────────────────────────────
  if (content.specs.length) {
    y -= 18;
    page.drawText("SPECIFICATIONS", { x: left, y, size: 9, font: bold, color: BLACK });
    y -= 14;
    const colW = inner / 2;
    const rows = Math.ceil(content.specs.length / 2);
    content.specs.forEach((row, i) => {
      const col = Math.floor(i / rows);
      const rowIndex = i % rows;
      const sx = left + col * colW;
      const sy = y - rowIndex * 13;
      page.drawText(clip(body, row.label, 9, 90), { x: sx, y: sy, size: 9, font: body, color: MUTED });
      page.drawText(clip(bold, row.value, 9, colW - 100), { x: sx + 92, y: sy, size: 9, font: bold, color: BLACK });
    });
    y -= rows * 13 + 6;
    page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 0.7, color: RULE });
  }

  // ── Equipment (names only; never priced) ────────────────────────────
  const QR_BOX = 96;
  const footerReserve = 118;
  if (content.equipment.length) {
    y -= 18;
    page.drawText("EQUIPMENT & FEATURES", { x: left, y, size: 9, font: bold, color: BLACK });
    y -= 14;
    const cols = 3;
    const colW = inner / cols;
    const available = y - (MARGIN + footerReserve);
    const perCol = Math.max(1, Math.floor(available / 11));
    const shown = content.equipment.slice(0, perCol * cols);
    shown.forEach((name, i) => {
      const col = Math.floor(i / perCol);
      const rowIndex = i % perCol;
      const ex = left + col * colW;
      const ey = y - rowIndex * 11;
      page.drawText(clip(body, `- ${name}`, 8.5, colW - 8), { x: ex, y: ey, size: 8.5, font: body, color: BLACK });
    });
    const usedRows = Math.min(perCol, Math.ceil(shown.length / cols) || 1);
    y -= usedRows * 11 + 6;
    const hidden = content.equipmentTruncated + (content.equipment.length - shown.length);
    if (hidden > 0) {
      page.drawText(`+ ${hidden} additional equipment items listed on the vehicle detail page.`, {
        x: left, y, size: 7.5, font: body, color: MUTED,
      });
      y -= 10;
    }
  }

  // ── Footer: QR, barcode, disclosures, dealer ────────────────────────
  let fy = MARGIN + footerReserve;
  page.drawLine({ start: { x: left, y: fy }, end: { x: right, y: fy }, thickness: 0.7, color: RULE });

  const textRight = content.qrPayload ? right - QR_BOX - 14 : right;
  if (content.qrPayload) {
    drawQr(page, content.qrPayload, right - QR_BOX, fy - QR_BOX - 4, QR_BOX);
    const cap = "Scan for full details";
    page.drawText(clip(body, cap, 7, QR_BOX), {
      x: right - QR_BOX, y: fy - QR_BOX - 14, size: 7, font: body, color: MUTED,
    });
  }

  fy -= 14;
  for (const line of content.disclosures) {
    for (const l of wrap(body, line, 7.2, textRight - left, 3)) {
      page.drawText(l, { x: left, y: fy, size: 7.2, font: body, color: MUTED });
      fy -= 8.6;
    }
    fy -= 1.5;
  }
  if (content.docFeeNote) {
    for (const l of wrap(body, content.docFeeNote, 7.2, textRight - left, 2)) {
      page.drawText(l, { x: left, y: fy, size: 7.2, font: body, color: MUTED });
      fy -= 8.6;
    }
  }

  if (content.dealerLines.length) {
    const dealer = content.dealerLines.join("  ·  ");
    page.drawText(clip(body, dealer, 8, textRight - left), {
      x: left, y: MARGIN + 30, size: 8, font: body, color: BLACK,
    });
  }

  drawBarcode(page, content.barcodePayload, left, MARGIN + 8, Math.min(200, textRight - left), 16);
  page.drawText(content.vin, { x: left, y: MARGIN, size: 6.5, font: body, color: BLACK });

  return await pdf.save();
}
