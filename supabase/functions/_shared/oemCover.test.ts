import { describe, it, expect } from "vitest";
import {
  COVER_BUCKET,
  COVER_MIME_JPEG,
  COVER_MIME_PDF,
  coverExtension,
  coverStoragePath,
  looksLikeJpeg,
  looksLikePdf,
  pathMatchesUrl,
  publicCoverPayload,
  qualifiesAsFullPageImage,
  readyCoverColumns,
  safeSegment,
  shouldGenerateCover,
  unresolvedCoverColumns,
  urlCouldBePdf,
  urlToken,
} from "./oemCover.ts";

const BROCHURE_URL = "https://www.mazdausa.com/siteassets/vehicles/2026/cx-90/brochure.pdf";
const MANUAL_URL = "https://owners.infinitiusa.com/manuals/2026/qx60.pdf";

describe("urlToken", () => {
  it("is stable for the same url and different for a different one", () => {
    expect(urlToken(BROCHURE_URL)).toBe(urlToken(BROCHURE_URL));
    expect(urlToken(BROCHURE_URL)).not.toBe(urlToken(MANUAL_URL));
  });

  it("changes when only the query string changes", () => {
    expect(urlToken(`${BROCHURE_URL}?v=2`)).not.toBe(urlToken(BROCHURE_URL));
  });

  it("is url-safe and fixed width", () => {
    for (const u of [BROCHURE_URL, MANUAL_URL, "", "https://x.io/a b/c?d=e&f=g#h"]) {
      expect(urlToken(u)).toMatch(/^[0-9a-f]{12}$/);
    }
  });
});

describe("coverStoragePath", () => {
  it("keys on the row id so two vehicles can never share an object", () => {
    const a = coverStoragePath("brochure", "11111111-1111-1111-1111-111111111111", BROCHURE_URL, COVER_MIME_PDF);
    const b = coverStoragePath("brochure", "22222222-2222-2222-2222-222222222222", BROCHURE_URL, COVER_MIME_PDF);
    expect(a).not.toBe(b);
    expect(a.startsWith("brochure/11111111-1111-1111-1111-111111111111/")).toBe(true);
  });

  it("versions on the url so a re-harvest cannot clobber the previous cover", () => {
    const before = coverStoragePath("brochure", "row-1", BROCHURE_URL, COVER_MIME_PDF);
    const after = coverStoragePath("brochure", "row-1", `${BROCHURE_URL}?rev=2`, COVER_MIME_PDF);
    expect(before).not.toBe(after);
  });

  it("separates the two kinds", () => {
    expect(coverStoragePath("owners_manual", "row-1", MANUAL_URL, COVER_MIME_PDF).startsWith("owners_manual/")).toBe(true);
  });

  it("uses the extension the mime implies", () => {
    expect(coverStoragePath("brochure", "row-1", BROCHURE_URL, COVER_MIME_JPEG).endsWith(".jpg")).toBe(true);
    expect(coverStoragePath("brochure", "row-1", BROCHURE_URL, COVER_MIME_PDF).endsWith(".pdf")).toBe(true);
  });

  it("cannot be walked out of its prefix by a hostile id", () => {
    const p = coverStoragePath("brochure", "../../../etc/passwd", BROCHURE_URL, COVER_MIME_PDF);
    expect(p.includes("..")).toBe(false);
    expect(p.startsWith("brochure/")).toBe(true);
    expect(p.split("/")).toHaveLength(3);
  });
});

describe("safeSegment", () => {
  it("collapses unsafe characters and never returns empty", () => {
    expect(safeSegment("Mercedes-Benz/GLE 450")).toBe("mercedes-benz-gle-450");
    expect(safeSegment("///")).toBe("unknown");
    expect(safeSegment("")).toBe("unknown");
  });
});

describe("coverExtension", () => {
  it("maps jpeg to jpg and everything else to pdf", () => {
    expect(coverExtension(COVER_MIME_JPEG)).toBe("jpg");
    expect(coverExtension(COVER_MIME_PDF)).toBe("pdf");
    expect(coverExtension("application/octet-stream")).toBe("pdf");
  });
});

describe("pathMatchesUrl", () => {
  it("recognises its own path", () => {
    const p = coverStoragePath("brochure", "row-1", BROCHURE_URL, COVER_MIME_PDF);
    expect(pathMatchesUrl(p, BROCHURE_URL)).toBe(true);
    expect(pathMatchesUrl(p, MANUAL_URL)).toBe(false);
  });

  it("is false for an empty path", () => {
    expect(pathMatchesUrl("", BROCHURE_URL)).toBe(false);
  });
});

describe("shouldGenerateCover", () => {
  const readyPath = coverStoragePath("brochure", "row-1", BROCHURE_URL, COVER_MIME_PDF);

  it("never re-fetches a ready cover for an unchanged url", () => {
    expect(shouldGenerateCover({
      url: BROCHURE_URL, cover_status: "ready", cover_storage_path: readyPath,
    })).toBe(false);
  });

  it("regenerates when the url changed under a ready cover", () => {
    expect(shouldGenerateCover({
      url: `${BROCHURE_URL}?rev=2`, cover_status: "ready", cover_storage_path: readyPath,
    })).toBe(true);
  });

  it("generates for a pending or missing status", () => {
    expect(shouldGenerateCover({ url: BROCHURE_URL, cover_status: "pending" })).toBe(true);
    expect(shouldGenerateCover({ url: BROCHURE_URL, cover_status: null })).toBe(true);
  });

  it("retries a failure but not an unsupported url", () => {
    expect(shouldGenerateCover({ url: BROCHURE_URL, cover_status: "failed" })).toBe(true);
    expect(shouldGenerateCover({
      url: BROCHURE_URL, cover_status: "unsupported", cover_storage_path: readyPath,
    })).toBe(false);
  });

  it("re-attempts an unsupported row once its url changes", () => {
    expect(shouldGenerateCover({
      url: MANUAL_URL, cover_status: "unsupported", cover_storage_path: readyPath,
    })).toBe(true);
  });

  it("force overrides a ready cover", () => {
    expect(shouldGenerateCover(
      { url: BROCHURE_URL, cover_status: "ready", cover_storage_path: readyPath },
      { force: true },
    )).toBe(true);
  });

  it("does nothing without a url, even with force", () => {
    expect(shouldGenerateCover({ url: "", cover_status: "pending" })).toBe(false);
    expect(shouldGenerateCover({ url: null }, { force: true })).toBe(false);
  });
});

describe("looksLikePdf", () => {
  const bytes = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)));

  it("accepts a normal pdf header", () => {
    expect(looksLikePdf(bytes("%PDF-1.7\n..."))).toBe(true);
  });

  it("accepts a header preceded by junk, as readers do", () => {
    expect(looksLikePdf(bytes(`${"\n".repeat(40)}%PDF-1.4`))).toBe(true);
  });

  it("rejects the bot-wall html an OEM CDN serves as application/pdf", () => {
    expect(looksLikePdf(bytes("<!DOCTYPE html><html><head><title>Access Denied"))).toBe(false);
  });

  it("rejects an empty body", () => {
    expect(looksLikePdf(new Uint8Array())).toBe(false);
  });
});

describe("looksLikeJpeg", () => {
  it("needs both SOI and EOI", () => {
    expect(looksLikeJpeg(new Uint8Array([0xff, 0xd8, 0x00, 0x01, 0xff, 0xd9]))).toBe(true);
    expect(looksLikeJpeg(new Uint8Array([0xff, 0xd8, 0x00, 0x01, 0x00, 0x00]))).toBe(false);
    expect(looksLikeJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0xff, 0xd9]))).toBe(false);
  });

  it("tolerates a little padding after EOI", () => {
    expect(looksLikeJpeg(new Uint8Array([0xff, 0xd8, 0x01, 0xff, 0xd9, 0, 0, 0]))).toBe(true);
  });

  it("rejects a truncated stream", () => {
    expect(looksLikeJpeg(new Uint8Array([0xff, 0xd8]))).toBe(false);
  });
});

describe("urlCouldBePdf", () => {
  it("accepts a pdf and an extensionless CDN path", () => {
    expect(urlCouldBePdf(BROCHURE_URL)).toBe(true);
    expect(urlCouldBePdf("https://www.bmwusa.com/content/dam/brochure/x5")).toBe(true);
  });

  it("rejects an OEM manuals portal page", () => {
    expect(urlCouldBePdf("https://www.kia.com/us/en/owners/resources/manuals-guides.html")).toBe(false);
    expect(urlCouldBePdf("https://www.chevrolet.com/support/manuals.aspx")).toBe(false);
  });

  it("rejects a malformed url outright", () => {
    expect(urlCouldBePdf("not a url")).toBe(false);
  });
});

describe("qualifiesAsFullPageImage", () => {
  const page = { pageWidth: 612, pageHeight: 792 };

  it("accepts one page-shaped, print-sized image", () => {
    expect(qualifiesAsFullPageImage({ imageCount: 1, imageWidth: 1700, imageHeight: 2200, ...page })).toBe(true);
  });

  it("refuses when the page holds more than one image", () => {
    expect(qualifiesAsFullPageImage({ imageCount: 2, imageWidth: 1700, imageHeight: 2200, ...page })).toBe(false);
  });

  it("refuses a logo-sized image", () => {
    expect(qualifiesAsFullPageImage({ imageCount: 1, imageWidth: 240, imageHeight: 310, ...page })).toBe(false);
  });

  it("refuses an image whose shape does not match the page", () => {
    expect(qualifiesAsFullPageImage({ imageCount: 1, imageWidth: 2200, imageHeight: 1700, ...page })).toBe(false);
  });

  it("refuses degenerate dimensions instead of dividing by zero", () => {
    expect(qualifiesAsFullPageImage({ imageCount: 1, imageWidth: 0, imageHeight: 2200, ...page })).toBe(false);
    expect(qualifiesAsFullPageImage({ imageCount: 1, imageWidth: 1700, imageHeight: 2200, pageWidth: 612, pageHeight: 0 })).toBe(false);
  });
});

describe("cover column builders", () => {
  it("records a ready cover with its bucket and mime", () => {
    const cols = readyCoverColumns({ path: "brochure/row-1/p1-abc.pdf", mime: COVER_MIME_PDF, pageCount: 24, now: "2026-07-28T00:00:00.000Z" });
    expect(cols).toEqual({
      cover_storage_path: "brochure/row-1/p1-abc.pdf",
      cover_storage_bucket: COVER_BUCKET,
      cover_generated_at: "2026-07-28T00:00:00.000Z",
      cover_page_count: 24,
      cover_status: "ready",
      cover_mime: COVER_MIME_PDF,
    });
  });

  it("does not record a nonsense page count", () => {
    expect(readyCoverColumns({ path: "p", mime: COVER_MIME_PDF, pageCount: 0 }).cover_page_count).toBeNull();
  });

  it("clears the path on a non-ready outcome so nothing stale is ever served", () => {
    for (const status of ["unsupported", "failed"] as const) {
      const cols = unresolvedCoverColumns(status, "2026-07-28T00:00:00.000Z");
      expect(cols.cover_status).toBe(status);
      expect(cols.cover_storage_path).toBeNull();
      expect(cols.cover_storage_bucket).toBeNull();
      expect(cols.cover_mime).toBeNull();
    }
  });
});

describe("publicCoverPayload", () => {
  it("flags a pdf artifact as not an image", () => {
    const p = publicCoverPayload({ signedUrl: "https://x/signed.pdf", mime: COVER_MIME_PDF, pageCount: 88 });
    expect(p).toEqual({
      cover_url: "https://x/signed.pdf",
      cover_mime: COVER_MIME_PDF,
      cover_page_count: 88,
      cover_is_image: false,
    });
  });

  it("flags an extracted jpeg as an image", () => {
    expect(publicCoverPayload({ signedUrl: "https://x/signed.jpg", mime: COVER_MIME_JPEG, pageCount: 12 })?.cover_is_image).toBe(true);
  });

  it("defaults an unknown mime to pdf rather than claiming an image", () => {
    const p = publicCoverPayload({ signedUrl: "https://x/s", mime: null, pageCount: null });
    expect(p?.cover_mime).toBe(COVER_MIME_PDF);
    expect(p?.cover_is_image).toBe(false);
  });

  it("is null without a signed url", () => {
    expect(publicCoverPayload({ signedUrl: null, mime: COVER_MIME_PDF, pageCount: 1 })).toBeNull();
    expect(publicCoverPayload({ signedUrl: "  ", mime: COVER_MIME_PDF, pageCount: 1 })).toBeNull();
  });
});
