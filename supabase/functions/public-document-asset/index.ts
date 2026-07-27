// ─────────────────────────────────────────────────────────────────────
// public-document-asset — mints a short-lived signed URL for one asset of
// one currently published vehicle document.
//
// Why this exists: signed storage URLs expire. Storing one on the
// document row made it the document's address, so a vehicle published
// longer than the URL's lifetime showed a broken PDF and a broken
// thumbnail on the customer passport, with nothing in the data to say so.
// The durable address lives in document_assets; the credential is minted
// here, per request, after re-checking that the document is still
// publishable.
//
// Hard rules:
//   * The slug is the ONLY caller-supplied key. There is no document id,
//     tenant id, vehicle id or storage path in the request, so the route
//     cannot be used to enumerate storage.
//   * get_published_document_asset returns nothing for a draft, a
//     pending-approval version or a superseded version. An unpublished
//     document is indistinguishable from a missing one to this endpoint.
//   * The signed URL is short-lived on purpose: it is a credential for
//     one viewing, and re-minting costs one request.
// ─────────────────────────────────────────────────────────────────────

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { SIGNED_URL_TTL_SECONDS } from "../_shared/factorySticker/lib/assets.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), {
    status,
    headers: { ...cors, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,120}$/i;

// Only document types a shopper is meant to reach through this route.
const PUBLIC_DOCUMENT_TYPES = new Set([
  "factory_sticker", "buyers_guide", "k208", "window", "addendum", "cpo_sheet",
]);
const ASSET_TYPES = new Set(["pdf", "thumbnail", "preview"]);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "not_configured" }, 500);

    const body = req.method === "GET"
      ? Object.fromEntries(new URL(req.url).searchParams)
      : await req.json().catch(() => ({}));

    const slug = String(body.slug || "").trim();
    const documentType = String(body.document_type || "factory_sticker").trim();
    const assetType = String(body.asset_type || "pdf").trim();

    if (!SLUG_RE.test(slug)) return json({ error: "invalid_slug" }, 400);
    if (!PUBLIC_DOCUMENT_TYPES.has(documentType)) return json({ error: "unsupported_document_type" }, 400);
    if (!ASSET_TYPES.has(assetType)) return json({ error: "unsupported_asset_type" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await admin.rpc("get_published_document_asset", {
      _slug: slug, _document_type: documentType, _asset_type: assetType,
    });
    if (error) return json({ error: "lookup_failed" }, 500);

    const row = (Array.isArray(data) ? data[0] : data) as {
      document_id?: string; document_version?: number;
      storage_bucket?: string; storage_path?: string;
      mime_type?: string; checksum?: string; published_at?: string;
    } | undefined;

    // Not published, not filed, or not this vehicle: one indistinguishable
    // answer, so the route reveals nothing about which case it was.
    if (!row?.storage_bucket || !row?.storage_path) return json({ error: "not_available" }, 404);

    const { data: signed, error: signErr } = await admin.storage
      .from(row.storage_bucket)
      .createSignedUrl(row.storage_path, SIGNED_URL_TTL_SECONDS);
    if (signErr || !signed?.signedUrl) return json({ error: "not_available" }, 404);

    return json({
      success: true,
      url: signed.signedUrl,
      expires_in: SIGNED_URL_TTL_SECONDS,
      document_version: row.document_version ?? null,
      mime_type: row.mime_type ?? null,
      checksum: row.checksum ?? null,
      published_at: row.published_at ?? null,
    });
  } catch (e) {
    console.error("public-document-asset failed", e);
    return json({ error: "unavailable" }, 500);
  }
});
