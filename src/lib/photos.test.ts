import { describe, it, expect } from "vitest";
import { photoUrls, listingGallery, listingHero, photoCount } from "./photos";

// Regression net for the "blank gallery" bug: vehicle_listings.photos arrives as
// either bare URL strings (feed) or { url } objects (DMS/VDP). Readers must
// handle both shapes or a whole gallery silently renders empty.

describe("photoUrls", () => {
  it("returns bare string URLs unchanged", () => {
    expect(photoUrls(["a.jpg", "b.jpg"])).toEqual(["a.jpg", "b.jpg"]);
  });

  it("extracts .url from object-shaped photos", () => {
    expect(photoUrls([{ url: "a.jpg" }, { url: "b.jpg", alt: "x" }])).toEqual(["a.jpg", "b.jpg"]);
  });

  it("handles a mixed array of both shapes", () => {
    expect(photoUrls(["a.jpg", { url: "b.jpg" }])).toEqual(["a.jpg", "b.jpg"]);
  });

  it("drops empty, whitespace, urlless objects, and null elements", () => {
    expect(photoUrls(["a.jpg", "", "   ", { url: "" }, { alt: "no url" }, null, 42])).toEqual(["a.jpg"]);
  });

  it("returns [] for non-array input", () => {
    expect(photoUrls(null)).toEqual([]);
    expect(photoUrls(undefined)).toEqual([]);
    expect(photoUrls("a.jpg")).toEqual([]);
    expect(photoUrls({ url: "a.jpg" })).toEqual([]);
  });
});

describe("listingGallery", () => {
  it("returns every photo when present", () => {
    expect(listingGallery({ photos: ["a.jpg", { url: "b.jpg" }] })).toEqual(["a.jpg", "b.jpg"]);
  });

  it("falls back to the hero image when photos are empty", () => {
    expect(listingGallery({ photos: [], hero_image_url: "hero.jpg" })).toEqual(["hero.jpg"]);
    expect(listingGallery({ photos: undefined, hero_image_url: "hero.jpg" })).toEqual(["hero.jpg"]);
  });

  it("returns [] when there are neither photos nor a hero", () => {
    expect(listingGallery({ photos: [], hero_image_url: null })).toEqual([]);
    expect(listingGallery({})).toEqual([]);
  });
});

describe("listingHero", () => {
  it("prefers the captured hero image", () => {
    expect(listingHero({ photos: ["a.jpg"], hero_image_url: "hero.jpg" })).toBe("hero.jpg");
  });

  it("falls back to the first photo when no hero", () => {
    expect(listingHero({ photos: [{ url: "a.jpg" }, "b.jpg"] })).toBe("a.jpg");
  });

  it("returns empty string when there is nothing", () => {
    expect(listingHero({ photos: [], hero_image_url: null })).toBe("");
    expect(listingHero({})).toBe("");
  });
});

describe("photoCount", () => {
  it("counts the resolved gallery", () => {
    expect(photoCount({ photos: ["a.jpg", { url: "b.jpg" }] })).toBe(2);
  });

  it("counts the hero fallback as one", () => {
    expect(photoCount({ photos: [], hero_image_url: "hero.jpg" })).toBe(1);
  });

  it("is zero when empty", () => {
    expect(photoCount({})).toBe(0);
  });
});
