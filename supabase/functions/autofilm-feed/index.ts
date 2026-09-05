import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  shapeLotRow, identityIncomplete, type LotFeedFile,
} from "../_shared/lotFeedRow.ts";

// ──────────────────────────────────────────────────────────────
// autofilm-feed
//
// Read-only vehicle list endpoint for AutoFilm.io's nightly
// ingest. One call per page walks the dealer's entire live lot
// ordered by VIN, with a total count up front, so AutoFilm can
// back its pricing block and Window Sticker button with real
// AutoLabels data.
//
// Contract:
//   GET /functions/v1/autofilm-feed?tenant_id=<uuid>[&cursor=<vin>][&limit=500]
//   Headers: x-lookup-secret: <AUTOLABELS_LOOKUP_SECRET>
//   (same shared credential vehicle-lookup already validates)
//
// Returns: {
//   total: number,           // live vehicles for the tenant
//   next_cursor: string | null, // pass back as ?cursor= to continue
//   identity_incomplete: number, // rows with no discrete make (see below)
//   vehicles: [ the listing row, minus LOT_FEED_DENY, plus discrete
//     year/make/model, trim, stock_number, body_style, msrp, market_value,
//     savings, photos[], passport_url, documents_url, window_sticker_url ]
// }
//
// The row goes out whole rather than field by field. Naming fields is what
// shipped 140 vehicles with no `make` — the consumer filters on
// make IS NOT NULL, so every one synced clean and was then invisible on every
// screen, which looks identical to the feed not working at all.
//
// Security model:
//   - Shared-secret key, timing-safe compared. Read-only; the key
//     alone can enumerate one tenant's published inventory but
//     cannot write anything.
//   - tenant_id is required and scopes every query; a leaked key
//     cannot pivot across tenants beyond enumeration by guessable
//     UUID, so treat the key as the tenant-scoped credential.
//   - Only live rows (status published/active, not archived) are
//     returned — the lot AutoFilm should mirror.
// ──────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-lookup-secret",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const timingSafeEqual = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
};

const MAX_LIMIT = 1000;
const DEFAULT_LIMIT = 500;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "GET") return json(405, { error: "method not allowed" });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const feedSecret = Deno.env.get("AUTOLABELS_LOOKUP_SECRET");
    if (!supabaseUrl || !serviceKey) return json(500, { error: "server misconfigured" });
    if (!feedSecret) return json(503, { error: "feed not enabled" });

    const key = req.headers.get("x-lookup-secret") ?? "";
    if (!timingSafeEqual(key, feedSecret)) return json(401, { error: "unauthorized" });

    const url = new URL(req.url);
    const tenantId = url.searchParams.get("tenant_id") ?? "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenantId)) {
      return json(400, { error: "tenant_id must be a uuid" });
    }
    const cursor = (url.searchParams.get("cursor") ?? "").toUpperCase();
    if (cursor && !/^[A-HJ-NPR-Z0-9]{17}$/.test(cursor)) {
      return json(400, { error: "cursor must be a 17-character VIN" });
    }
    const limitParam = Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT);
    const limit = Number.isInteger(limitParam) && limitParam > 0
      ? Math.min(limitParam, MAX_LIMIT)
      : DEFAULT_LIMIT;

    const admin = createClient(supabaseUrl, serviceKey);

    // select("*"), not a named list. The named list is what shipped 140
    // vehicles with no `make`: nothing named it, so nothing carried it, and
    // AutoFilm's screens filter on make IS NOT NULL — every car synced clean
    // and was then invisible. What may NOT go out is named instead, in
    // LOT_FEED_DENY, where withholding a field is a deliberate act.
    const base = () =>
      admin
        .from("vehicle_listings")
        .select("*")
        .eq("tenant_id", tenantId)
        .is("archived_at", null)
        .in("status", ["published", "active"]);

    const { count, error: countErr } = await admin
      .from("vehicle_listings")
      .select("vin", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .is("archived_at", null)
      .in("status", ["published", "active"]);
    if (countErr) return json(500, { error: countErr.message });

    let pageQuery = base().order("vin", { ascending: true }).limit(limit + 1);
    if (cursor) pageQuery = pageQuery.gt("vin", cursor);
    const { data, error } = await pageQuery;
    if (error) return json(500, { error: error.message });

    const rows = (data ?? []) as Record<string, unknown>[];
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);

    // vehicle_listings holds neither the discrete year/make/model nor the DMS
    // stock number as columns; vehicle_files holds both. marketcheck-sync
    // composes ymm from exactly these three and writes them here at the same
    // time, so they are read rather than parsed back out of the display string.
    const filesByVin = new Map<string, LotFeedFile>();
    const vins = page.map((r) => r.vin).filter(Boolean) as string[];
    if (vins.length) {
      const { data: files } = await admin
        .from("vehicle_files")
        .select("vin, year, make, model, trim, stock_number")
        .eq("tenant_id", tenantId)
        .in("vin", vins);
      for (const f of (files ?? []) as (LotFeedFile & { vin: string })[]) {
        if (f.vin) filesByVin.set(f.vin, f);
      }
    }

    const vehicles = page.map((r) =>
      shapeLotRow(r, filesByVin.get(String(r.vin)) ?? null)
    );

    // A vehicle with no discrete make is filtered off the consumer's screens.
    // Counted here so that shows up as a number in the response rather than as
    // an empty page nobody can explain.
    const identity_incomplete = page.filter((r) =>
      identityIncomplete(r, filesByVin.get(String(r.vin)) ?? null)
    ).length;

    return json(200, {
      total: count ?? 0,
      next_cursor: hasMore ? String(vehicles[vehicles.length - 1]?.vin ?? "") || null : null,
      identity_incomplete,
      vehicles,
    });
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : String(e) });
  }
});
