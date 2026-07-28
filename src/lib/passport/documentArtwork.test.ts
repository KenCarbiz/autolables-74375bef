import { describe, it, expect } from "vitest";
import { canonicalDocumentType, imageCoverUrl, resolveDocumentArtwork } from "./documentArtwork";

// The OEM cover pipeline stores a one-page PDF far more often than an image,
// because the edge runtime it runs in has no PDF rasterizer. Everything below
// exists to keep that PDF out of an <img src>, where it would render as an
// empty broken-image well — strictly worse than the drawn cover it replaced.
describe("imageCoverUrl", () => {
  it("returns the url for a real extracted image cover", () => {
    expect(imageCoverUrl({
      cover_url: "https://cdn.example/signed/p1-abc.jpg",
      cover_mime: "image/jpeg",
      cover_is_image: true,
    })).toBe("https://cdn.example/signed/p1-abc.jpg");
  });

  it("returns null for a PDF cover, however valid the url is", () => {
    expect(imageCoverUrl({
      cover_url: "https://cdn.example/signed/p1-abc.pdf",
      cover_mime: "application/pdf",
      cover_is_image: false,
    })).toBeNull();
  });

  it("returns null when the flag is missing, rather than guessing from the url", () => {
    expect(imageCoverUrl({ cover_url: "https://cdn.example/p1.jpg" })).toBeNull();
    expect(imageCoverUrl({ cover_url: "https://cdn.example/p1.jpg", cover_mime: "image/jpeg" })).toBeNull();
  });

  it("distrusts a flag that disagrees with the mime", () => {
    expect(imageCoverUrl({
      cover_url: "https://cdn.example/p1.pdf",
      cover_mime: "application/pdf",
      cover_is_image: true,
    })).toBeNull();
  });

  it("handles an absent link and an empty url", () => {
    expect(imageCoverUrl(null)).toBeNull();
    expect(imageCoverUrl(undefined)).toBeNull();
    expect(imageCoverUrl({ cover_url: "   ", cover_is_image: true })).toBeNull();
  });
});

describe("a non-image cover never reaches artworkUrl", () => {
  const pdfCover = {
    cover_url: "https://cdn.example/signed/p1-abc.pdf",
    cover_mime: "application/pdf",
    cover_is_image: false,
  };

  it("leaves the brochure card on its branded fallback", () => {
    const art = resolveDocumentArtwork({
      type: "brochure",
      title: "Official Brochure",
      coverUrl: imageCoverUrl(pdfCover),
    });
    expect(art.artworkUrl).toBeNull();
    expect(art.artworkKind).toBe("branded_fallback");
  });

  it("leaves the owner's-manual card on its branded fallback", () => {
    const art = resolveDocumentArtwork({
      type: "owners_manual",
      title: "Owner's Manual",
      coverUrl: imageCoverUrl(pdfCover),
    });
    expect(art.artworkUrl).toBeNull();
    expect(art.artworkKind).toBe("branded_fallback");
  });

  it("does show the cover once the artifact really is an image", () => {
    const art = resolveDocumentArtwork({
      type: "brochure",
      title: "Official Brochure",
      coverUrl: imageCoverUrl({
        cover_url: "https://cdn.example/signed/p1-abc.jpg",
        cover_mime: "image/jpeg",
        cover_is_image: true,
      }),
    });
    expect(art.artworkUrl).toBe("https://cdn.example/signed/p1-abc.jpg");
    expect(art.artworkKind).toBe("official_cover");
  });
});

describe("a cover is held to the same sanitization rule as a thumbnail", () => {
  // A cover IS page 1 of the real file. For a repair order or a signed price
  // record that page carries the customer's name, address, payment and
  // signature, and the Documents page it would render on is public.
  const covered = (type: string) =>
    resolveDocumentArtwork({ type, title: "x", coverUrl: "https://s/p1.jpg" });

  it("refuses a cover for a repair order", () => {
    expect(covered("service_record").artworkUrl).toBeNull();
    expect(covered("service_record").artworkKind).toBe("branded_fallback");
  });

  it("refuses a cover for a signed price record", () => {
    expect(covered("signed_record").artworkUrl).toBeNull();
  });

  it("allows one once the stored derivative was sanitized before storage", () => {
    const art = resolveDocumentArtwork({
      type: "service_record", title: "x",
      coverUrl: "https://s/p1.jpg", customerSafeThumbnail: true,
    });
    expect(art.artworkUrl).toBe("https://s/p1.jpg");
  });

  it("still shows a brochure cover, which carries no customer data", () => {
    expect(covered("brochure").artworkUrl).toBe("https://s/p1.jpg");
  });
});

describe("canonicalDocumentType round-trips its own vocabulary", () => {
  // The type stored on a document is free text, but it is very often already
  // the canonical key. Those must not fall through to "other".
  for (const key of [
    "window_sticker", "factory_sticker", "build_sheet", "vehicle_history",
    "brochure", "owners_manual", "k208", "inspection", "buyers_guide",
    "warranty", "service_record", "signed_record",
  ]) {
    it(`maps ${key} to itself`, () => {
      expect(canonicalDocumentType(key)).toBe(key);
      expect(canonicalDocumentType(key.toUpperCase())).toBe(key);
    });
  }

  it("still reads prose that is not a canonical key", () => {
    expect(canonicalDocumentType("carfax")).toBe("vehicle_history");
    expect(canonicalDocumentType(null, "Repair Order #4471")).toBe("service_record");
    expect(canonicalDocumentType("something else")).toBe("other");
  });
});
