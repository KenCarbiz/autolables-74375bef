import { supabase } from "@/integrations/supabase/client";

// ──────────────────────────────────────────────────────────────
// Supabase Storage helpers. Upload photos to public buckets
// defined in migration 20260417020000_storage_buckets.sql
// (prep-photos, listing-photos) and return the public URL so
// the caller can store it in a JSONB column.
// ──────────────────────────────────────────────────────────────

export type PhotoBucket = "prep-photos" | "listing-photos" | "dealer-logos" | "product-docs";

export interface UploadedPhoto {
  url: string;       // public URL
  path: string;      // path within bucket (for delete)
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

  const { data: pub } = supabase.storage.from(bucket).getPublicUrl(path);
  return {
    url: pub?.publicUrl || "",
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
