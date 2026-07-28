import { describe, it, expect } from "vitest";
import { imageCoverUrl, resolveDocumentArtwork } from "./documentArtwork";

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
