import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import * as pdfLib from "pdf-lib";
import { PDFDocument } from "pdf-lib";
import { buildRenderLayout } from "./contract";
import { realizePdf, type PdfLibModule } from "./toPdf";
import { infinitiBenchmark, longEquipmentFixture, qx55ClassFixture, themeFor } from "./__fixtures__/renderData";

const lib = pdfLib as unknown as PdfLibModule;
const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

describe("toPdf", () => {
  it("renders deterministic bytes: identical sha256 across two renders", async () => {
    const a = await realizePdf(buildRenderLayout(infinitiBenchmark(), themeFor("infiniti")), lib);
    const b = await realizePdf(buildRenderLayout(infinitiBenchmark(), themeFor("infiniti")), lib);
    expect(sha256(a)).toBe(sha256(b));
    expect(a.length).toBeGreaterThan(4000);
  });

  it("starts with the %PDF header", async () => {
    const bytes = await realizePdf(buildRenderLayout(infinitiBenchmark(), themeFor("infiniti")), lib);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  });

  it("produces letter-landscape 792x612 pages", async () => {
    const bytes = await realizePdf(buildRenderLayout(infinitiBenchmark(), themeFor("infiniti")), lib);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBe(792);
    expect(height).toBe(612);
  });

  it("renders a QX55-class build as exactly one page", async () => {
    const bytes = await realizePdf(buildRenderLayout(qx55ClassFixture(), themeFor("infiniti")), lib);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    const { width, height } = doc.getPage(0).getSize();
    expect(width).toBe(792);
    expect(height).toBe(612);
  });

  it("refuses to realize a review-required layout into any PDF", async () => {
    const model = buildRenderLayout(longEquipmentFixture(), themeFor("infiniti"));
    expect(model.fit.ok).toBe(false);
    await expect(realizePdf(model, lib)).rejects.toThrow(/one_page_review_required/);
  });

  it("pins metadata dates to the epoch for reproducibility", async () => {
    const bytes = await realizePdf(buildRenderLayout(infinitiBenchmark(), themeFor("infiniti")), lib);
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    expect(doc.getCreationDate()?.getTime()).toBe(0);
    expect(doc.getModificationDate()?.getTime()).toBe(0);
  });
});
