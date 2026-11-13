// GENERATED — do not edit.
// Mirror of src/lib/photos.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
export function photoUrls(photos: unknown): string[] {
    if (!Array.isArray(photos))
        return [];
    return photos
        .map((p) => {
        if (typeof p === "string")
            return p;
        if (p && typeof p === "object") {
            const u = (p as {
                url?: unknown;
            }).url;
            return typeof u === "string" ? u : null;
        }
        return null;
    })
        .filter((u): u is string => typeof u === "string" && u.trim().length > 0);
}
export function listingGallery(listing: {
    photos?: unknown;
    hero_image_url?: string | null;
}): string[] {
    const urls = photoUrls(listing.photos);
    if (urls.length)
        return urls;
    return listing.hero_image_url ? [listing.hero_image_url] : [];
}
export function listingHero(listing: {
    photos?: unknown;
    hero_image_url?: string | null;
}): string {
    return listing.hero_image_url || photoUrls(listing.photos)[0] || "";
}
export function photoCount(listing: {
    photos?: unknown;
    hero_image_url?: string | null;
}): number {
    return listingGallery(listing).length;
}
