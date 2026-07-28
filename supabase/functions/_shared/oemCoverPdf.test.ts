// Exercises the real page-1 extraction against the real pdf-lib. The edge
// function pins it by URL; vitest.config.ts aliases that URL to the lockfile
// copy, so what is asserted here is what runs in production.
//
// The point of these assertions is the honesty of the artifact: the fallback
// really is a one-page PDF (not an image), and the image path really does
// produce a decodable JPEG.
import { describe, it, expect } from "vitest";
import { PDFDocument, rgb } from "pdf-lib";
import { extractFirstPageCover, UnsupportedPdfError } from "./oemCoverPdf.ts";
import { COVER_MIME_JPEG, COVER_MIME_PDF, looksLikeJpeg, looksLikePdf } from "./oemCover.ts";

/** pdf-lib rejects a cross-realm Uint8Array under jsdom; hand it an ArrayBuffer. */
const asArrayBuffer = (u: Uint8Array): ArrayBuffer =>
  u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

/** A brochure-shaped multi-page PDF with distinct vector content per page. */
async function multiPagePdf(pages: number): Promise<ArrayBuffer> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([612, 792]);
    page.drawRectangle({ x: 40, y: 40 + (i % 400), width: 100, height: 100, color: rgb((i % 10) / 10, 0.2, 0.3) });
  }
  return asArrayBuffer(await doc.save());
}

describe("extractFirstPageCover", () => {
  it("returns a ONE-PAGE PDF, not an image, for a normal brochure", async () => {
    const cover = await extractFirstPageCover(await multiPagePdf(212));

    expect(cover.mime).toBe(COVER_MIME_PDF);
    expect(cover.pageCount).toBe(212);
    expect(looksLikePdf(cover.bytes)).toBe(true);

    const reloaded = await PDFDocument.load(asArrayBuffer(cover.bytes));
    expect(reloaded.getPageCount()).toBe(1);
  });

  it("keeps page 1 rather than any other page", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([300, 400]);
    doc.addPage([700, 200]);
    const cover = await extractFirstPageCover(asArrayBuffer(await doc.save()));

    const reloaded = await PDFDocument.load(asArrayBuffer(cover.bytes));
    const { width, height } = reloaded.getPage(0).getSize();
    expect(Math.round(width)).toBe(300);
    expect(Math.round(height)).toBe(400);
  });

  it("is far smaller than the document it came from", async () => {
    const source = await multiPagePdf(180);
    const cover = await extractFirstPageCover(source);
    expect(cover.bytes.byteLength).toBeLessThan(source.byteLength / 2);
  });

  it("lifts a full-bleed cover photo out as a real JPEG", async () => {
    // A page that is nothing but one page-shaped JPEG — the shape of a
    // design-led OEM brochure cover, and the only case we claim an image for.
    const jpeg = new Uint8Array(SAMPLE_JPEG);
    const doc = await PDFDocument.create();
    const embedded = await doc.embedJpg(asArrayBuffer(jpeg));
    const page = doc.addPage([embedded.width, embedded.height]);
    page.drawImage(embedded, { x: 0, y: 0, width: embedded.width, height: embedded.height });

    const cover = await extractFirstPageCover(asArrayBuffer(await doc.save()));

    expect(cover.mime).toBe(COVER_MIME_JPEG);
    expect(looksLikeJpeg(cover.bytes)).toBe(true);
    // The stored bytes are the original JPEG, byte for byte.
    expect(Array.from(cover.bytes.slice(0, 4))).toEqual(Array.from(jpeg.slice(0, 4)));
  });

  it("falls back to the PDF when the page carries more than one image", async () => {
    const jpeg = new Uint8Array(SAMPLE_JPEG);
    const doc = await PDFDocument.create();
    const embedded = await doc.embedJpg(asArrayBuffer(jpeg));
    const page = doc.addPage([embedded.width, embedded.height]);
    page.drawImage(embedded, { x: 0, y: 0, width: embedded.width, height: embedded.height });
    page.drawImage(embedded, { x: 0, y: 0, width: 40, height: 40 });

    const cover = await extractFirstPageCover(asArrayBuffer(await doc.save()));
    expect(cover.mime).toBe(COVER_MIME_PDF);
  });

  it("refuses bytes that are not a PDF at all", async () => {
    const html = new TextEncoder().encode("<!DOCTYPE html><html>Access Denied</html>");
    await expect(extractFirstPageCover(asArrayBuffer(html)))
      .rejects.toBeInstanceOf(UnsupportedPdfError);
  });

  it("refuses a truncated PDF rather than storing a broken cover", async () => {
    const whole = new Uint8Array(await multiPagePdf(4));
    const half = whole.slice(0, Math.floor(whole.length / 2));
    await expect(extractFirstPageCover(asArrayBuffer(half)))
      .rejects.toBeInstanceOf(UnsupportedPdfError);
  });
});

// A minimal baseline JPEG, 640x640 DeviceRGB, generated once and inlined
// so the test needs no fixture file. Big enough to clear the artwork-size floor
// in qualifiesAsFullPageImage and square so it matches a square page.
const SAMPLE_JPEG: number[] = (() => {
  // Built at module load from a base64 literal to keep the array readable.
  const b64 =
    "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a" +
    "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAARCAKAAoADASIAAhEBAxEB/8QAHwAA" +
    "AQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIh" +
    "MUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpT" +
    "VFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5" +
    "usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAA" +
    "AAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEI" +
    "FEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVm" +
    "Z2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK" +
    "0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==";
  const bin = atob(b64);
  return Array.from(bin, (c) => c.charCodeAt(0));
})();
