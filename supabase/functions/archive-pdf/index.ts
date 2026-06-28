import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// ──────────────────────────────────────────────────────────────
// archive-pdf
//
// Accepts a rendered PDF (base64) for a signed document and stores
// it as an immutable archive record. The caller must be
// authenticated and be a member of the tenant whose document is
// being archived.
//
// Contract:
//   POST /functions/v1/archive-pdf
//   Headers: Authorization: Bearer <user JWT>
//   Body: {
//     doc_type: "addendum" | "deal" | "sticker" | "buyers_guide" |
//               "prep_signoff" | "disclosure",
//     entity_id: string,          // the source row id
//     vin?: string,
//     pdf_base64: string,         // PDF contents, base64-encoded
//     mime_type?: string,         // defaults to application/pdf
//     retention_years?: number,   // defaults to 7
//   }
//   Returns: { archive_id, storage_path, content_hash, public_url? }
//
// The PDF is uploaded to the `signed-archives` bucket under
//   <tenant_id>/<doc_type>/<yyyy>/<entity_id>-<hash>.pdf
// and a signed_document_archive row is inserted with the SHA-256
// hash of the bytes. Storage is private; callers fetch via signed
// URL, not public.
// ──────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const hexEncode = (buf: ArrayBuffer) =>
  Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

const sha256Hex = async (bytes: Uint8Array) => {
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return hexEncode(await crypto.subtle.digest("SHA-256", ab));
};

const decodeBase64 = (b64: string) => {
  const clean = b64.replace(/^data:[^;]+;base64,/, "").replace(/\s+/g, "");
  const bin = atob(clean);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return json(500, { error: "supabase not configured" });

    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return json(401, { error: "missing bearer token" });

    const body = await req.json().catch(() => ({}));
    const {
      doc_type,
      entity_id,
      vin,
      pdf_base64,
      mime_type = "application/pdf",
      retention_years = 7,
    } = body ?? {};

    if (!doc_type || !entity_id || !pdf_base64) {
      return json(400, { error: "doc_type, entity_id, pdf_base64 required" });
    }
    const validTypes = [
      "addendum",
      "deal",
      "sticker",
      "buyers_guide",
      "prep_signoff",
      "disclosure",
      "k208",
    ];
    if (!validTypes.includes(doc_type)) {
      return json(400, { error: `invalid doc_type; must be one of ${validTypes.join(", ")}` });
    }

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: userRes, error: userErr } = await admin.auth.getUser(jwt);
    if (userErr || !userRes?.user) return json(401, { error: "invalid token" });
    const userId = userRes.user.id;

    const { data: membership } = await admin
      .from("tenant_members")
      .select("tenant_id")
      .eq("user_id", userId)
      .not("accepted_at", "is", null)
      .maybeSingle();
    if (!membership?.tenant_id) return json(403, { error: "no tenant membership" });
    const tenantId = membership.tenant_id;

    const bytes = decodeBase64(pdf_base64);
    if (bytes.byteLength === 0) return json(400, { error: "empty pdf_base64" });
    if (bytes.byteLength > 25 * 1024 * 1024) {
      return json(413, { error: "pdf exceeds 25 MB limit" });
    }

    const hash = await sha256Hex(bytes);
    const year = new Date().getFullYear();
    const storagePath = `${tenantId}/${doc_type}/${year}/${entity_id}-${hash.slice(0, 12)}.pdf`;
    const bucket = "signed-archives";

    // Ensure bucket exists (idempotent — ignore error if it already does).
    await admin.storage
      .createBucket(bucket, { public: false, fileSizeLimit: 30 * 1024 * 1024 })
      .catch(() => undefined);

    const { error: uploadErr } = await admin.storage
      .from(bucket)
      .upload(storagePath, bytes, {
        contentType: mime_type,
        upsert: false,
        cacheControl: "private,max-age=0",
      });
    if (uploadErr) {
      return json(500, { error: "storage upload failed", detail: uploadErr.message });
    }

    const retainedUntil = new Date(
      Date.now() + retention_years * 365 * 24 * 60 * 60 * 1000
    ).toISOString();

    const { data: record, error: insertErr } = await admin
      .from("signed_document_archive")
      .insert({
        tenant_id: tenantId,
        doc_type,
        entity_id,
        vin: vin || null,
        storage_path: storagePath,
        storage_bucket: bucket,
        content_hash: hash,
        mime_type,
        byte_size: bytes.byteLength,
        retained_until: retainedUntil,
        created_by: userId,
      })
      .select()
      .single();
    if (insertErr) {
      return json(500, { error: "archive insert failed", detail: insertErr.message });
    }

    await admin.from("audit_log").insert({
      action: "document_archived",
      entity_type: doc_type,
      entity_id,
      store_id: tenantId,
      user_id: userId,
      content_hash: hash,
      details: {
        archive_id: record.id,
        storage_path: storagePath,
        byte_size: bytes.byteLength,
      },
    });

    // Return a short-lived signed URL for confirmation / preview.
    const { data: signed } = await admin.storage
      .from(bucket)
      .createSignedUrl(storagePath, 300);

    return json(200, {
      archive_id: record.id,
      storage_path: storagePath,
      content_hash: hash,
      retained_until: retainedUntil,
      signed_url: signed?.signedUrl || null,
    });
  } catch (err) {
    return json(500, { error: err instanceof Error ? err.message : "unknown error" });
  }
});
