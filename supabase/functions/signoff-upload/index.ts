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
const MAX_BYTES = 10 * 1024 * 1024;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const safeName = (name: string) => (name || "file").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-80);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  const body = await req.json().catch(() => ({})) as {
    token?: string; filename?: string; contentType?: string; dataBase64?: string;
  };
  const token = (body.token || "").trim();
  if (!token || !body.dataBase64) return json(400, { error: "token and dataBase64 required" });

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

  const stamp = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const path = `${tok.tenant_id}/${tok.vin}/${stamp}-${rand}-${safeName(body.filename || "upload")}`;

  const { error: upErr } = await admin.storage.from(BUCKET).upload(path, bytes, {
    contentType: body.contentType || "application/octet-stream", upsert: false,
  });
  if (upErr) return json(500, { error: upErr.message || "upload failed" });

  const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path);
  return json(200, { ok: true, url: pub?.publicUrl || "", path });
});
