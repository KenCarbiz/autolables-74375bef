import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// ──────────────────────────────────────────────────────────────
// signoff-upload — let a no-login service tech attach a document/photo
// (the K-208 inspection sheet, a defect photo) from the QR sign-off page.
//
// Anon callers can't use Storage RLS, so this validates the dept_signoff
// token server-side, then uploads with the service role into the public
// `service-docs` bucket scoped by tenant/vin. Returns the public URL the
// client stores in safety_inspections.documents.
//
// Body: { token, filename, contentType, dataBase64 }  (dataBase64 = raw
// base64, no data: prefix). 10MB cap.
// ──────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const BUCKET = "service-docs";
// Title/MCO scans are PII — they go to the PRIVATE vehicle-docs bucket and the
// caller gets the storage path (dealer signs it on read), never a public URL.
const BUCKET_PRIVATE = "vehicle-docs";
const MAX_BYTES = 10 * 1024 * 1024;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const safeName = (name: string) => (name || "file").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);

// Only images and PDFs may land in the public bucket. Without this allowlist an
// attacker holding a (long-lived, shareable) token could upload text/html and
// get a same-origin stored-XSS URL off the public bucket.
const ALLOWED_TYPES = new Set([
  "image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif", "image/heic", "image/heif", "application/pdf",
]);
const EXT_TYPE: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp",
  gif: "image/gif", heic: "image/heic", heif: "image/heif", pdf: "application/pdf",
};
const resolveType = (contentType?: string, filename?: string): string | null => {
  const ct = (contentType || "").toLowerCase().split(";")[0].trim();
  if (ALLOWED_TYPES.has(ct)) return ct;
  const ext = (filename || "").toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  const fromExt = ext ? EXT_TYPE[ext] : undefined;
  return fromExt && ALLOWED_TYPES.has(fromExt) ? fromExt : null;
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  const body = await req.json().catch(() => ({})) as {
    token?: string; filename?: string; contentType?: string; dataBase64?: string; private?: boolean;
  };
  const token = (body.token || "").trim();
  if (!token || !body.dataBase64) return json(400, { error: "token and dataBase64 required" });

  const contentType = resolveType(body.contentType, body.filename);
  if (!contentType) return json(415, { error: "unsupported file type (images and PDF only)" });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  // Validate the token the same way the sign-off RPC does: must be pending + unexpired.
  const { data: tok } = await admin.from("dept_signoff_tokens")
    .select("tenant_id, vin, status, expires_at").eq("token", token).maybeSingle();
  if (!tok) return json(404, { error: "invalid token" });
  if (tok.status !== "pending" || new Date(tok.expires_at as string) <= new Date()) {
    return json(403, { error: "token not active" });
  }

  // Decode base64 → bytes.
  let bytes: Uint8Array;
  try {
    const raw = (body.dataBase64 || "").replace(/^data:[^;]+;base64,/, "");
    const bin = atob(raw);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch {
    return json(400, { error: "bad base64" });
  }
  if (bytes.byteLength > MAX_BYTES) return json(413, { error: "file too large (max 10MB)" });

  const isPrivate = body.private === true;
  const bucket = isPrivate ? BUCKET_PRIVATE : BUCKET;
  const stamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const path = `${tok.tenant_id}/${tok.vin}/${stamp}-${rand}-${safeName(body.filename || "upload")}`;

  // Ensure the private bucket exists (idempotent) so title uploads never 404.
  if (isPrivate) {
    try { await admin.storage.createBucket(BUCKET_PRIVATE, { public: false }); } catch { /* exists */ }
  }

  const { error: upErr } = await admin.storage.from(bucket).upload(path, bytes, {
    contentType, upsert: false,
  });
  if (upErr) return json(500, { error: upErr.message || "upload failed" });

  // Private files return only the path (PII — no public URL). Public bucket
  // (service-docs) keeps returning the public URL for the existing callers.
  if (isPrivate) return json(200, { ok: true, path, private: true });
  const { data: pub } = admin.storage.from(bucket).getPublicUrl(path);
  return json(200, { ok: true, url: pub?.publicUrl || "", path });
});
