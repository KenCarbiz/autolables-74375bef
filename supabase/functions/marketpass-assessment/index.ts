import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { decideMarketPassResponse, type MarketPassCaller } from "../_shared/factorySticker/lib/intelligence/marketPass/handler.ts";
import type { MarketPassRow } from "../_shared/factorySticker/lib/intelligence/marketPass/rowEvidence.ts";
import { decidePageViewResponse, pickWindowSticker, type PublishedDocumentRow } from "../_shared/factorySticker/lib/marketPass/pageViewHandler.ts";

// ──────────────────────────────────────────────────────────────
// marketpass-assessment  ·  MarketPass V2 (PROPOSED rules, NOT deployed)
//
//   GET /functions/v1/marketpass-assessment?slug=<slug>[&tenant_id=<uuid>][&audience=dealer]
//   GET /functions/v1/marketpass-assessment?slug=<slug>&view=page[&tenant_id=<uuid>]
//
// view=page returns { ok, page, marketpass }: everything the customer Passport
// renders, built server-side by the same functions the page calls
// (src/lib/marketPass/pageView.ts), plus the public MarketPass contract while
// the tenant's marketpass_v2 flag is on (null otherwise). It is public-only;
// audience=dealer with view=page is refused. The row it renders is the one
// public-listing-view ships to the Passport, read internally so the read is
// not counted as a shopper view and cannot notify the dealer.
//
// tenant_id is a binding check, not a credential: AutoFilm passes the tenant
// its rooftop is mapped to, and a listing of another tenant is not found.
//
// Reads only what is already stored on the listing and the dealer profile.
// It calls no provider: no MarketCheck, NeoVIN or Black Book request can
// start here, so serving it costs nothing against the provider budget.
//
// Every rule about who sees what lives in decideMarketPassResponse, a pure
// function tested in vitest. This file only gathers its three inputs: the
// row, the dealer settings (for the marketpass_v2 flag) and the caller's
// verified tenant memberships. A caller's own claim about its tenant is never
// read; membership comes from tenant_members under the service role.
// ──────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET") return json(405, { error: "method_not_allowed" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json(500, { error: "supabase_not_configured" });

  const url = new URL(req.url);
  const slug = (url.searchParams.get("slug") ?? "").trim();
  if (!slug || slug.length > 120) return json(400, { error: "slug_required" });
  const audience = url.searchParams.get("audience") === "dealer" ? "dealer" : "public";
  const viewPage = url.searchParams.get("view") === "page";
  if (viewPage && audience === "dealer") return json(400, { error: "view_page_is_public" });
  const expectedTenantId = (url.searchParams.get("tenant_id") ?? "").trim() || null;
  if (expectedTenantId && !/^[0-9a-f-]{36}$/i.test(expectedTenantId)) return json(400, { error: "tenant_id_invalid" });

  try {
    const admin = createClient(supabaseUrl, serviceKey);

    const { data, error } = await admin.rpc("get_vehicle_listing_by_slug", { _slug: slug });
    if (error) return json(500, { error: "lookup_failed" });
    const row = ((Array.isArray(data) ? data[0] : data) ?? null) as MarketPassRow | null;

    let settings: unknown = {};
    if (row?.tenant_id) {
      const { data: prof } = await admin.from("dealer_profiles").select("settings").eq("tenant_id", row.tenant_id).maybeSingle();
      settings = prof?.settings ?? {};
    }

    const caller: MarketPassCaller = { userId: null, memberTenantIds: [] };
    const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    if (bearer && bearer !== anonKey && bearer !== serviceKey) {
      const { data: who } = await admin.auth.getUser(bearer).catch(() => ({ data: null }));
      const userId = who?.user?.id ?? null;
      if (userId) {
        caller.userId = userId;
        if (row?.tenant_id) {
          const { data: member } = await admin.from("tenant_members")
            .select("tenant_id").eq("user_id", userId).eq("tenant_id", row.tenant_id).maybeSingle();
          if (member?.tenant_id) caller.memberTenantIds = [member.tenant_id as string];
        }
      }
    }

    if (viewPage) {
      if (!row || !row.vin || (expectedTenantId && row.tenant_id !== expectedTenantId)) return json(404, { error: "not_found" });

      const viewRes = await fetch(`${supabaseUrl}/functions/v1/public-listing-view`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}`, apikey: serviceKey },
        body: JSON.stringify({ slug, internal: true }),
      });
      if (viewRes.status === 404) return json(404, { error: "not_found" });
      if (!viewRes.ok) return json(502, { error: "public_view_unavailable" });
      const publicRow = ((await viewRes.json().catch(() => null)) as { listing?: Record<string, unknown> } | null)?.listing ?? null;
      if (!publicRow) return json(502, { error: "public_view_unavailable" });

      const listingSlug = String(row.slug ?? slug);
      let docs: PublishedDocumentRow[] = [];
      let hasPdf = false;
      let hasThumbnail = false;
      try {
        let res = await admin.rpc("get_published_documents_public", { p_slug: listingSlug });
        if (res.error) res = await admin.rpc("get_published_documents_public", { _slug: listingSlug });
        docs = (Array.isArray(res.data) ? res.data : []) as PublishedDocumentRow[];
        if (docs.some((r) => r.document_type === "factory_sticker")) {
          const asset = async (assetType: string): Promise<boolean> => {
            const { data: a } = await admin.rpc("get_published_document_asset", { _slug: listingSlug, _document_type: "factory_sticker", _asset_type: assetType });
            const r = (Array.isArray(a) ? a[0] : a) as { storage_bucket?: string; storage_path?: string } | undefined;
            return !!(r?.storage_bucket && r?.storage_path);
          };
          [hasPdf, hasThumbnail] = await Promise.all([asset("pdf"), asset("thumbnail")]);
        }
      } catch { /* no sticker card rather than a broken one */ }
      const windowSticker = pickWindowSticker(docs, { functionsBase: `${supabaseUrl}/functions/v1`, slug: listingSlug, hasPdf, hasThumbnail });

      const page = decidePageViewResponse({ row, publicRow, settings, caller, nowMs: Date.now(), expectedTenantId, windowSticker });
      return json(page.status, page.body);
    }

    const decision = decideMarketPassResponse({ row, settings, caller, audience, nowMs: Date.now(), expectedTenantId });
    return json(decision.status, decision.body);
  } catch (_e) {
    return json(500, { error: "assessment_failed" });
  }
});
