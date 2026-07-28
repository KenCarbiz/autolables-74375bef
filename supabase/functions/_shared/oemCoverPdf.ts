// ──────────────────────────────────────────────────────────────────────
// Page-1 extraction, pdf-lib edition. Edge-only (esm.sh import); the pure
// decision logic it leans on lives in ./oemCover.ts and is unit-tested there.
//
// WHY NOT A RASTERIZER — this was investigated before settling:
//   * pdf.js needs a 2D canvas. The Supabase edge runtime (Deno, no native
//     addons, no OffscreenCanvas) has none, and @napi-rs/canvas / node-canvas
//     are native modules that cannot load there.
//   * mupdf-wasm and pdfium-wasm can rasterize, but ship 10-20 MB of wasm,
//     which blows the function bundle budget and the worker's memory ceiling
//     on the very documents we care about (200-page brochures).
//   * Rendering via an external screenshot service would mean shipping OEM
//     document bytes to a third party, which is exactly what we avoid.
// So we do NOT rasterize. We copy page 1 into a new one-page PDF with pdf-lib,
// which is already a project dependency and is pure JS. The artifact is
// application/pdf. It is a real page-1 cover, but it is NOT an image and an
// <img src> pointed at it renders nothing.
//
// One upgrade on top of that: if page 1 turns out to be a single full-bleed
// JPEG — the usual shape of a design-led OEM brochure cover — the DCTDecode
// stream IS a complete JPEG file, and we lift it out and store image/jpeg
// instead. That path is <img>-renderable. It is opportunistic, not a page
// render: vector type printed over the photo is not in the extracted image.
// ──────────────────────────────────────────────────────────────────────

import {
  PDFDocument,
  PDFName,
  PDFDict,
  PDFRawStream,
  PDFArray,
  PDFNumber,
  PDFRef,
} from "https://esm.sh/pdf-lib@1.17.1";
import {
  COVER_ARTIFACT_MAX_BYTES,
  COVER_MIME_JPEG,
  COVER_MIME_PDF,
  type CoverMime,
  looksLikeJpeg,
  qualifiesAsFullPageImage,
} from "./oemCover.ts";

export interface ExtractedCover {
  bytes: Uint8Array;
  mime: CoverMime;
  pageCount: number;
}

/** Thrown for a document we will never be able to cover (encrypted, empty). */
export class UnsupportedPdfError extends Error {}

// PDFName.asString() keeps the leading solidus ("/Image"), which is not what
// any of the comparisons below want.
const nameOf = (v: unknown): string => {
  if (v instanceof PDFName) return v.asString().replace(/^\//, "");
  return "";
};

const numberOf = (v: unknown): number => {
  if (v instanceof PDFNumber) return v.asNumber();
  return 0;
};

/** DCTDecode may appear bare or as a single-element filter array. */
function soleFilterName(dict: PDFDict): string {
  const filter = dict.lookup(PDFName.of("Filter"));
  if (filter instanceof PDFName) return nameOf(filter);
  if (filter instanceof PDFArray) {
    if (filter.size() !== 1) return "";
    return nameOf(filter.lookup(0));
  }
  return "";
}

/**
 * Only colour spaces a browser will decode correctly from a bare JPEG.
 * Adobe CMYK JPEGs pulled out of a PDF render inverted, and an /Indexed or
 * /Separation image is meaningless without its PDF-side palette, so both are
 * refused rather than stored as a wrong-looking cover.
 */
function hasBrowserSafeColorSpace(dict: PDFDict, doc: PDFDocument): boolean {
  const raw = dict.lookup(PDFName.of("ColorSpace"));
  const direct = nameOf(raw);
  if (direct === "DeviceRGB" || direct === "DeviceGray") return true;
  if (direct) return false;

  const arr = raw instanceof PDFArray
    ? raw
    : raw instanceof PDFRef
    ? doc.context.lookup(raw)
    : null;
  if (!(arr instanceof PDFArray) || arr.size() < 2) return false;
  if (nameOf(arr.lookup(0)) !== "ICCBased") return false;

  const stream = arr.lookup(1);
  const streamDict = stream instanceof PDFRawStream ? stream.dict : null;
  if (!streamDict) return false;
  const n = numberOf(streamDict.lookup(PDFName.of("N")));
  return n === 1 || n === 3;
}

interface CandidateImage {
  bytes: Uint8Array;
  width: number;
  height: number;
}

/**
 * The single page-1 image, when there is exactly one and it is safe to lift.
 * Returns null the moment anything is ambiguous — the PDF fallback is always
 * available, so there is never a reason to guess here.
 */
function soleFullPageJpeg(doc: PDFDocument): Uint8Array | null {
  const page = doc.getPage(0);
  const resources = page.node.Resources();
  if (!resources) return null;

  const xobjects = resources.lookup(PDFName.of("XObject"), PDFDict);
  if (!xobjects) return null;

  let total = 0;
  let candidate: CandidateImage | null = null;

  for (const [, value] of xobjects.entries()) {
    const stream = value instanceof PDFRef ? doc.context.lookup(value) : value;
    if (!(stream instanceof PDFRawStream)) continue;
    const dict = stream.dict;
    if (nameOf(dict.lookup(PDFName.of("Subtype"))) !== "Image") continue;

    total += 1;
    if (total > 1) return null;

    if (soleFilterName(dict) !== "DCTDecode") return null;
    // A soft mask or an explicit Decode array changes how the PDF paints the
    // JPEG; the bare file would not match what the page shows.
    if (dict.lookup(PDFName.of("SMask")) || dict.lookup(PDFName.of("Mask"))) return null;
    if (dict.lookup(PDFName.of("Decode"))) return null;
    if (!hasBrowserSafeColorSpace(dict, doc)) return null;

    const width = numberOf(dict.lookup(PDFName.of("Width")));
    const height = numberOf(dict.lookup(PDFName.of("Height")));
    const bytes = stream.getContents();
    candidate = { bytes, width, height };
  }

  if (!candidate) return null;

  const { width: pageWidth, height: pageHeight } = page.getSize();
  const ok = qualifiesAsFullPageImage({
    imageCount: total,
    imageWidth: candidate.width,
    imageHeight: candidate.height,
    pageWidth,
    pageHeight,
  });
  if (!ok) return null;
  if (!looksLikeJpeg(candidate.bytes)) return null;
  if (candidate.bytes.byteLength > COVER_ARTIFACT_MAX_BYTES) return null;
  return candidate.bytes;
}

/**
 * Page 1 of `pdfBytes` as a storable artifact.
 *
 * Throws UnsupportedPdfError for a document that can never yield a cover, and
 * a plain Error for anything the caller should be free to retry.
 */
export async function extractFirstPageCover(
  // ArrayBuffer is accepted because pdf-lib's runtime type check rejects a
  // cross-realm Uint8Array under the jsdom test environment.
  pdfBytes: Uint8Array | ArrayBuffer,
): Promise<ExtractedCover> {
  let source: PDFDocument;
  try {
    source = await PDFDocument.load(pdfBytes, { updateMetadata: false });
  } catch (e) {
    // An encrypted PDF loads only with ignoreEncryption, and its page content
    // is then undecryptable garbage — copying it produces a blank cover, so it
    // is refused outright rather than stored as a broken one.
    const msg = e instanceof Error ? e.message : String(e);
    if (/encrypt/i.test(msg)) throw new UnsupportedPdfError("encrypted_pdf");
    throw new UnsupportedPdfError(`unparseable_pdf: ${msg.slice(0, 160)}`);
  }

  const pageCount = source.getPageCount();
  if (pageCount < 1) throw new UnsupportedPdfError("empty_pdf");

  const jpeg = (() => {
    try {
      return soleFullPageJpeg(source);
    } catch {
      // Image lifting is a best-effort upgrade; any surprise in the object
      // graph just means we take the PDF path.
      return null;
    }
  })();
  if (jpeg) return { bytes: jpeg, mime: COVER_MIME_JPEG, pageCount };

  const out = await PDFDocument.create();
  const [copied] = await out.copyPages(source, [0]);
  out.addPage(copied);
  // Object streams off: the artifact is small and a plainly-structured PDF is
  // what the widest set of viewers (and pdf.js) handle without complaint.
  const bytes = await out.save({ useObjectStreams: false });
  if (bytes.byteLength > COVER_ARTIFACT_MAX_BYTES) {
    throw new UnsupportedPdfError("cover_page_too_heavy");
  }
  return { bytes, mime: COVER_MIME_PDF, pageCount };
}
