// ──────────────────────────────────────────────────────────────────────
// Photo normalization. vehicle_listings.photos is written in two shapes:
//   • bare URL strings  — the MarketCheck / inventory-feed path
//   • { url, alt, ... }  — the DMS / VDP-ingest path
// Readers must not assume one shape, or a whole gallery silently renders
// empty. These helpers return clean URL strings from either shape.
// ──────────────────────────────────────────────────────────────────────

export function photoUrls(photos: unknown): string[] {
  if (!Array.isArray(photos)) return [];
  return photos
    .map((p) => {
      if (typeof p === "string") return p;
      if (p && typeof p === "object") {
        const u = (p as { url?: unknown }).url;
        return typeof u === "string" ? u : null;
      }
      return null;
    })
    .filter((u): u is string => typeof u === "string" && u.trim().length > 0);
}

// The full gallery for a listing: every real photo, falling back to the hero
// image when the photo array is empty so a single image still shows.
export function listingGallery(listing: { photos?: unknown; hero_image_url?: string | null }): string[] {
  const urls = photoUrls(listing.photos);
  if (urls.length) return urls;
  return listing.hero_image_url ? [listing.hero_image_url] : [];
}

// The single hero image: prefer the captured hero, else the first photo.
export function listingHero(listing: { photos?: unknown; hero_image_url?: string | null }): string {
  return listing.hero_image_url || photoUrls(listing.photos)[0] || "";
}

export function photoCount(listing: { photos?: unknown; hero_image_url?: string | null }): number {
  return listingGallery(listing).length;
}
