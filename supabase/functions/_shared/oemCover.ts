// ──────────────────────────────────────────────────────────────────────
// Pure decision logic for the OEM document cover pipeline.
//
// Everything here is runtime-free (no Deno, no pdf-lib, no network) so it can
// be unit-tested by vitest alongside the app. The pdf-lib half lives in
// ./oemCoverPdf.ts, which imports from esm.sh and is edge-only.
//
// Read the header of 20260728210000_oem_document_covers.sql for what the
// artifact actually is. Short version: usually a one-page PDF, occasionally a
// JPEG. `coverMime` is not decoration.
// ──────────────────────────────────────────────────────────────────────

export type CoverStatus = "pending" | "ready" | "unsupported" | "failed";
export type CoverKind = "brochure" | "owners_manual";
export type CoverMime = "application/pdf" | "image/jpeg";

export const COVER_BUCKET = "oem-covers";
export const COVER_MIME_PDF: CoverMime = "application/pdf";
export const COVER_MIME_JPEG: CoverMime = "image/jpeg";

/**
 * Hard ceiling on the source document we are willing to pull into memory.
 * An OEM brochure can be 200+ pages and tens of megabytes, and pdf-lib parses
 * in-process — a 60 MB brochure will OOM an edge worker long before it
 * produces a cover. 24 MB covers the overwhelming majority of brochures and
 * most owner's manuals; anything bigger is recorded as unsupported rather
 * than crashing the worker.
 */
export const COVER_SOURCE_MAX_BYTES = 24 * 1024 * 1024;

/** Wall-clock budget for pulling the source PDF. */
export const COVER_FETCH_TIMEOUT_MS = 25_000;

/** Ceiling on what we will store. A page-1 extract far exceeds this only if
 * the page embeds the whole document's resources, which is not worth keeping. */
export const COVER_ARTIFACT_MAX_BYTES = 6 * 1024 * 1024;

export const COVER_SIGNED_URL_TTL_SECONDS = 60 * 60 * 6;

export const COVER_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/**
 * Short, stable token derived from the source URL (FNV-1a, 32-bit, hex).
 *
 * This is a cache-busting version key, NOT a security digest — it exists so a
 * re-harvest that changes the URL writes to a different object instead of
 * overwriting the previous one, and so `shouldGenerateCover` can tell whether
 * the stored artifact still belongs to the URL we now hold.
 */
export function urlToken(url: string): string {
  let h = 0x811c9dc5;
  const s = String(url ?? "");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  // Length is mixed in so two same-hash URLs of different length still differ.
  const len = (s.length & 0xffff).toString(16).padStart(4, "0");
  return `${(h >>> 0).toString(16).padStart(8, "0")}${len}`;
}

export function coverExtension(mime: string): string {
  return mime === COVER_MIME_JPEG ? "jpg" : "pdf";
}

/**
 * Storage key for one link row's cover.
 *
 * Two independent guarantees against clobbering another make/model/year:
 *   1. the row id is in the path, and the link tables are uniquely keyed on
 *      (lower(make), lower(model), year) — so two different vehicles can never
 *      share a directory;
 *   2. the URL token is in the filename, so re-harvesting the SAME row with a
 *      NEW url writes a new object instead of replacing the old one.
 * Uploads are always made with upsert:false, so even a token collision fails
 * loudly instead of silently replacing someone else's cover.
 */
export function coverStoragePath(
  kind: CoverKind,
  rowId: string,
  sourceUrl: string,
  mime: string,
): string {
  const id = safeSegment(rowId);
  return `${kind}/${id}/p1-${urlToken(sourceUrl)}.${coverExtension(mime)}`;
}

/**
 * Path segment with anything that could escape the prefix stripped out.
 * Dots are dropped rather than kept: the ids in play are UUIDs, and allowing
 * them is all it takes to turn "../.." into a traversal once slashes have been
 * rewritten to dashes.
 */
export function safeSegment(raw: string): string {
  const s = String(raw ?? "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return s.slice(0, 80) || "unknown";
}

export interface CoverRowState {
  url?: string | null;
  cover_status?: string | null;
  cover_storage_path?: string | null;
}

/**
 * Idempotency gate. A cover is regenerated only when we do not already hold a
 * ready artifact for THIS url.
 *
 * `unsupported` is deliberately sticky for an unchanged url: an OEM "manuals
 * and guides" portal page will not become a PDF on the next sweep, and
 * re-fetching it every harvest is pure waste. `failed` is retried, because a
 * timeout or a 502 is transient. `force` overrides everything.
 */
export function shouldGenerateCover(row: CoverRowState, opts: { force?: boolean } = {}): boolean {
  const url = String(row.url ?? "").trim();
  if (!url) return false;
  if (opts.force) return true;

  const status = String(row.cover_status ?? "");
  const path = String(row.cover_storage_path ?? "");

  if (status === "ready") return !pathMatchesUrl(path, url);
  if (status === "unsupported") return !pathMatchesUrl(path, url);
  return true;
}

/** True when a stored path was generated from this exact url. */
export function pathMatchesUrl(path: string, url: string): boolean {
  if (!path) return false;
  const file = path.split("/").pop() || "";
  return file.startsWith(`p1-${urlToken(url)}.`);
}

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // %PDF

/**
 * A PDF may carry leading junk before %PDF (readers tolerate it), so scan a
 * short prefix rather than only offset 0. Content-Type is not trusted on its
 * own — OEM CDNs serve PDFs as application/octet-stream and serve bot-wall
 * HTML as application/pdf.
 */
export function looksLikePdf(bytes: Uint8Array): boolean {
  const limit = Math.min(bytes.length, 1024);
  for (let i = 0; i + 4 <= limit; i++) {
    if (
      bytes[i] === PDF_MAGIC[0] && bytes[i + 1] === PDF_MAGIC[1] &&
      bytes[i + 2] === PDF_MAGIC[2] && bytes[i + 3] === PDF_MAGIC[3]
    ) return true;
  }
  return false;
}

/**
 * SOI at the front and EOI at the back. A DCTDecode stream lifted out of a PDF
 * is a complete JPEG file, but a damaged or truncated one is not — and a
 * truncated JPEG renders as a half-grey box in the browser, which is worse
 * than the drawn fallback. Trailing stream padding after EOI is tolerated.
 */
export function looksLikeJpeg(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  if (!(bytes[0] === 0xff && bytes[1] === 0xd8)) return false;
  for (let i = bytes.length - 2; i >= Math.max(2, bytes.length - 16); i--) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0xd9) return true;
  }
  return false;
}

/**
 * Cheap pre-filter so we do not download an OEM portal landing page just to
 * discover it is HTML. Returns false only when the URL is *known* not to be a
 * document; an extensionless URL is still worth a fetch (many OEM CDNs serve
 * PDFs from extensionless paths).
 */
export function urlCouldBePdf(url: string): boolean {
  let path: string;
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    return false;
  }
  if (path.endsWith(".pdf")) return true;
  return !/\.(html?|aspx?|php|jsp|json|xml|png|jpe?g|gif|webp|svg|mp4|zip)$/.test(path);
}

/**
 * Should the single image found on page 1 be lifted out as the cover, instead
 * of falling back to the one-page PDF?
 *
 * Only when it is plausibly the whole printed cover: exactly one image on the
 * page, big enough to look like artwork rather than a logo, and shaped like
 * the page it sits on. A brochure whose cover is a photo plus vector type will
 * still pass this test and the extracted JPEG will be missing the type — which
 * is why this is an opportunistic upgrade over the PDF, not a page render.
 */
export function qualifiesAsFullPageImage(input: {
  imageCount: number;
  imageWidth: number;
  imageHeight: number;
  pageWidth: number;
  pageHeight: number;
}): boolean {
  const { imageCount, imageWidth, imageHeight, pageWidth, pageHeight } = input;
  if (imageCount !== 1) return false;
  if (!(imageWidth > 0 && imageHeight > 0 && pageWidth > 0 && pageHeight > 0)) return false;
  if (Math.min(imageWidth, imageHeight) < 600) return false;

  const imageRatio = imageWidth / imageHeight;
  const pageRatio = pageWidth / pageHeight;
  if (!Number.isFinite(imageRatio) || !Number.isFinite(pageRatio)) return false;
  return Math.abs(imageRatio - pageRatio) / pageRatio <= 0.12;
}

export interface CoverColumns {
  cover_storage_path: string | null;
  cover_storage_bucket: string | null;
  cover_generated_at: string | null;
  cover_page_count: number | null;
  cover_status: CoverStatus;
  cover_mime: string | null;
}

export function readyCoverColumns(input: {
  path: string;
  mime: string;
  pageCount: number;
  bucket?: string;
  now?: string;
}): CoverColumns {
  return {
    cover_storage_path: input.path,
    cover_storage_bucket: input.bucket ?? COVER_BUCKET,
    cover_generated_at: input.now ?? new Date().toISOString(),
    cover_page_count: Number.isFinite(input.pageCount) && input.pageCount > 0 ? input.pageCount : null,
    cover_status: "ready",
    cover_mime: input.mime,
  };
}

/**
 * Terminal columns for a cover we could not produce. The path is cleared so a
 * later reader never serves a stale artifact next to a non-ready status, and
 * so `shouldGenerateCover` cannot mistake an old path for a current one.
 */
export function unresolvedCoverColumns(status: "unsupported" | "failed", now?: string): CoverColumns {
  return {
    cover_storage_path: null,
    cover_storage_bucket: null,
    cover_generated_at: now ?? new Date().toISOString(),
    cover_page_count: null,
    cover_status: status,
    cover_mime: null,
  };
}

export interface PublicCover {
  cover_url: string;
  cover_mime: string;
  cover_page_count: number | null;
  /** False for a PDF artifact — the consumer must not put it in an <img>. */
  cover_is_image: boolean;
}

/**
 * Shape handed to the customer passport. `cover_is_image` is computed here, on
 * the server, precisely so the page never has to guess: a false value means an
 * <img src> will render nothing and an <object>/<embed>/pdf.js path is needed.
 */
export function publicCoverPayload(input: {
  signedUrl: string | null | undefined;
  mime: string | null | undefined;
  pageCount: number | null | undefined;
}): PublicCover | null {
  const url = String(input.signedUrl ?? "").trim();
  if (!url) return null;
  const mime = String(input.mime ?? COVER_MIME_PDF);
  return {
    cover_url: url,
    cover_mime: mime,
    cover_page_count: typeof input.pageCount === "number" && input.pageCount > 0 ? input.pageCount : null,
    cover_is_image: mime.startsWith("image/"),
  };
}
