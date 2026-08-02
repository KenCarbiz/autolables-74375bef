import { supabase } from "@/integrations/supabase/client";

// ──────────────────────────────────────────────────────────────
// Supabase Storage helpers. Buckets are defined in migration
// 20260417020000_storage_buckets.sql. Shopper-facing buckets
// (listing-photos, dealer-logos) stay public; internal buckets
// (prep-photos, product-docs) are private and are read through
// short-lived signed URLs minted for tenant members by RLS.
// ──────────────────────────────────────────────────────────────

export type PhotoBucket = "prep-photos" | "listing-photos" | "dealer-logos" | "product-docs";

// Buckets that are NOT public: reads require a signed URL.
const PRIVATE_BUCKETS = new Set<PhotoBucket>(["prep-photos", "product-docs"]);

export const SIGNED_PHOTO_TTL_SECONDS = 60 * 60 * 24 * 7;

export const isPrivateBucket = (bucket: PhotoBucket) => PRIVATE_BUCKETS.has(bucket);

// Mint a fresh signed URL for a stored object path in a private bucket.
export const signPhotoUrl = async (
  bucket: PhotoBucket,
  path: string,
  ttlSeconds = SIGNED_PHOTO_TTL_SECONDS
): Promise<string> => {
  const { data } = await supabase.storage.from(bucket).createSignedUrl(path, ttlSeconds);
  return data?.signedUrl || "";
};

// Stored rows hold URLs, not paths. A URL that points at a private bucket has
// either an expired signature or a now-dead /public/ address, so re-sign it
// from the object path embedded in the URL.
export const resolveStoredPhotoUrl = async (
  bucket: PhotoBucket,
  urlOrPath: string
): Promise<string> => {
  if (!urlOrPath) return "";
  if (!isPrivateBucket(bucket)) return urlOrPath;
  const marker = `/${bucket}/`;
  const idx = urlOrPath.indexOf(marker);
  const path = idx >= 0
    ? urlOrPath.slice(idx + marker.length).split("?")[0]
    : urlOrPath;
  return (await signPhotoUrl(bucket, decodeURIComponent(path))) || "";
};

export interface UploadedPhoto {
  url: string;       // public URL, or signed URL for private buckets
  path: string;      // path within bucket (for delete / re-signing)
  bucket: PhotoBucket;
  size: number;
  mimeType: string;
}


const safeName = (name: string) =>
  name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);

// Storage RLS on these buckets requires the FIRST path segment to be a
// tenant_id the caller is a member of. Callers must pass tenantId — uploads
// without one will be rejected by the policy.
export const uploadPhoto = async (
  bucket: PhotoBucket,
  file: File,
  opts: { tenantId?: string | null; storeId?: string; vin?: string } = {}
): Promise<UploadedPhoto | null> => {
  if (!opts.tenantId) {
    throw new Error("Missing tenant for upload.");
  }
  const scope = [opts.tenantId, opts.storeId || "any", opts.vin || "misc"].join("/");
  const stamp = Date.now();
  const random = Math.random().toString(36).slice(2, 8);
  const path = `${scope}/${stamp}-${random}-${safeName(file.name)}`;

  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    cacheControl: "3600",
    upsert: false,
    contentType: file.type || undefined,
  });
  if (error) {
    throw new Error(error.message || "Upload failed.");
  }

  const url = isPrivateBucket(bucket)
    ? await signPhotoUrl(bucket, path)
    : supabase.storage.from(bucket).getPublicUrl(path).data?.publicUrl || "";
  return {
    url,

    path,
    bucket,
    size: file.size,
    mimeType: file.type,
  };
};

export const uploadPhotos = async (
  bucket: PhotoBucket,
  files: File[],
  opts: { tenantId?: string | null; storeId?: string; vin?: string } = {}
): Promise<UploadedPhoto[]> => {
  const results = await Promise.all(files.map(async (f) => {
    try {
      return await uploadPhoto(bucket, f, opts);
    } catch {
      return null;
    }
  }));
  return results.filter((r): r is UploadedPhoto => r !== null);
};

export const deletePhoto = async (bucket: PhotoBucket, path: string): Promise<boolean> => {
  const { error } = await supabase.storage.from(bucket).remove([path]);
  return !error;
};
