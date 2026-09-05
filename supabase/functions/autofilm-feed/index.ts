import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  shapeLotRow, identityIncomplete, detailVersion,
  type LotFeedFile, type DetailVersionSnapshot,
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
//   LIST   GET ?tenant_id=<uuid>[&cursor=<vin>][&limit=500][&updated_since=<iso>]
//          Every row carries detail_version — a content hash of the deep
//          record. Re-fetch a detail only when it moves.
//   DETAIL GET /vehicle/<17-char VIN>?tenant_id=<uuid>   (or ?vin=)
//          One vehicle plus its verified-fact ledger — the call that backs
//          generated talking points.
//          { vin, vehicle, facts[], fact_count, verified_fact_count, truth }
//   Headers: x-lookup-secret: <AUTOLABELS_LOOKUP_SECRET>
//            (x-autofilm-key is accepted as an alias for the same value)
//
// Returns: {
//   total: number,           // live vehicles for the tenant
//   limit: number,
//   has_more: boolean,
//   next_cursor: string | null, // pass back as ?cursor= to continue
//   identity_incomplete: number, // rows with no discrete make (see below)
//   vehicles: [ the listing row, minus LOT_FEED_DENY, plus discrete
//     year/make/model, trim, stock_number, body_style, msrp, market_value,
//     savings, photos[], passport_url, documents_url, window_sticker_url,
//     window_sticker_kind ]
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
    "authorization, x-client-info, apikey, content-type, x-lookup-secret, x-autofilm-key",
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

    // x-autofilm-key is accepted as an alias for x-lookup-secret. Same value,
    // same credential — AutoFilm's config named the header after itself and a
    // 401 over which of two names carried the identical secret is a wasted
    // round trip, not a security boundary.
    const key = req.headers.get("x-lookup-secret")
      ?? req.headers.get("x-autofilm-key")
      ?? "";
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
    // AutoFilm addresses this as {base}/vehicle/{vin}. Supabase routes on the
    // function name and hands the remaining path through, so the segment form
    // and ?vin= are the same call; both are accepted rather than making the
    // caller care which.
    const pathVin = (/\/vehicle\/([^/?#]+)/i.exec(url.pathname)?.[1] ?? "").toUpperCase();
    const detailVin = (pathVin || url.searchParams.get("vin") || "").toUpperCase();
    if (detailVin && !/^[A-HJ-NPR-Z0-9]{17}$/.test(detailVin)) {
      return json(400, { error: "vin must be a 17-character VIN" });
    }
    const updatedSinceRaw = url.searchParams.get("updated_since") ?? "";
    let updatedSince: string | null = null;
    if (updatedSinceRaw) {
      const t = Date.parse(updatedSinceRaw);
      if (Number.isNaN(t)) return json(400, { error: "updated_since must be ISO-8601" });
      updatedSince = new Date(t).toISOString();
    }
    const limitParam = Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT);
    const limit = Number.isInteger(limitParam) && limitParam > 0
      ? Math.min(limitParam, MAX_LIMIT)
      : DEFAULT_LIMIT;

    const admin = createClient(supabaseUrl, serviceKey);

    // ── Detail: one vehicle, everything we hold ───────────────────────
    //
    // The list answers "what is on the lot". This answers "tell me everything
    // about the one the salesperson just picked", and it is the call that backs
    // generated talking points.
    //
    // The facts block is the point. vehicle_facts is a ledger of individually
    // sourced claims — each one carries where it came from, how confident we
    // are, whose authority it rests on, and whether it may appear in copy at
    // all. Generating a talking point from THAT rather than from a prose blob
    // is the difference between a claim that can be traced and a sentence a
    // salesperson has to defend on the lot.
    if (detailVin) {
      const { data: rowData, error: rowErr } = await admin
        .from("vehicle_listings")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("vin", detailVin)
        .is("archived_at", null)
        .maybeSingle();
      if (rowErr) return json(500, { error: rowErr.message });
      if (!rowData) return json(404, { error: "not_found", vin: detailVin });
      const row = rowData as Record<string, unknown>;

      const [fileRes, docRes, factRes, snapRes] = await Promise.all([
        admin.from("vehicle_files")
          .select("vin, year, make, model, trim, stock_number")
          .eq("tenant_id", tenantId).eq("vin", detailVin).maybeSingle(),
        admin.from("generated_documents")
          .select("id")
          .eq("tenant_id", tenantId).eq("vehicle_id", String(row.id))
          .eq("document_type", "factory_sticker").eq("document_status", "published")
          .limit(1),
        // usable_in_copy is the gate the ledger already carries; a fact flagged
        // off is one somebody decided must not be repeated, and no consumer
        // gets to reverse that.
        admin.from("vehicle_facts")
          .select("fact_key, fact_value, source_kind, confidence, authority, evidence, observed_at")
          .eq("tenant_id", tenantId).eq("vehicle_id", String(row.id))
          .eq("usable_in_copy", true),
        admin.from("vehicle_snapshots")
          .select("snapshot_version, content_checksum, has_unresolved_conflicts, created_at")
          .eq("tenant_id", tenantId).eq("vehicle_id", String(row.id))
          .order("snapshot_version", { ascending: false }).limit(1).maybeSingle(),
      ]);

      const vehicle = shapeLotRow(row, (fileRes.data as LotFeedFile | null) ?? null, {
        supabaseUrl,
        hasFactorySticker: ((docRes.data as unknown[]) ?? []).length > 0,
      });

      // Confidence travels with every fact rather than being filtered here.
      // VERIFIED-only would drop engine, drivetrain, transmission and trim —
      // all HIGH from the provider — and a talking-point writer that cannot see
      // the engine is not much of one. Labelled, so the consumer decides what
      // it is willing to assert.
      const facts = ((factRes.data as Record<string, unknown>[]) ?? []).map((f) => ({
        key: f.fact_key,
        value: (f.fact_value as { v?: unknown } | null)?.v ?? f.fact_value,
        source: f.source_kind,
        confidence: f.confidence,
        authority: f.authority,
        observed_at: f.observed_at,
      }));

      const snap = snapRes.data as Record<string, unknown> | null;
      // Same value the list carried, computed from the same inputs, so a caller
      // can confirm what it just stored matches what it was told to expect.
      vehicle.detail_version = await detailVersion(row, snap as DetailVersionSnapshot | null);
      return json(200, {
        vin: detailVin,
        detail_version: vehicle.detail_version,
        vehicle,
        facts,
        fact_count: facts.length,
        verified_fact_count: facts.filter((f) => f.confidence === "VERIFIED").length,
        // A vehicle whose truth record still has an unresolved conflict is one
        // where two sources disagree. Stated, not hidden: a consumer generating
        // copy should know before it writes a sentence.
        truth: snap
          ? {
            snapshot_version: snap.snapshot_version,
            content_checksum: snap.content_checksum,
            has_unresolved_conflicts: snap.has_unresolved_conflicts === true,
            created_at: snap.created_at,
          }
          : null,
      });
    }

    // select("*"), not a named list. The named list is what shipped 140
    // vehicles with no `make`: nothing named it, so nothing carried it, and
    // AutoFilm's screens filter on make IS NOT NULL — every car synced clean
    // and was then invisible. What may NOT go out is named instead, in
    // LOT_FEED_DENY, where withholding a field is a deliberate act.
    // updated_since narrows the count as well as the page. A total that counted
    // the whole lot while the rows carried only the changed ones would make the
    // caller's "rows must equal total" check fail every incremental pull.
    const scoped = (q: any) => (updatedSince ? q.gte("updated_at", updatedSince) : q);

    const base = () =>
      scoped(
        admin
          .from("vehicle_listings")
          .select("*")
          .eq("tenant_id", tenantId)
          .is("archived_at", null)
          .in("status", ["published", "active"]),
      );

    const { count, error: countErr } = await scoped(
      admin
        .from("vehicle_listings")
        .select("vin", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .is("archived_at", null)
        .in("status", ["published", "active"]),
    );
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

    // Which of these vehicles actually have a published factory sticker on
    // file. The oem_sticker_url column is empty on every row of this lot while
    // 102 of 140 have a filed, published PDF — reading the column alone
    // reported "no window sticker" for three quarters of the cars that have
    // one.
    const stickerVehicleIds = new Set<string>();
    const ids = page.map((r) => r.id).filter(Boolean) as string[];
    if (ids.length) {
      const { data: docs } = await admin
        .from("generated_documents")
        .select("vehicle_id")
        .eq("tenant_id", tenantId)
        .eq("document_type", "factory_sticker")
        .eq("document_status", "published")
        .in("vehicle_id", ids);
      for (const d of (docs ?? []) as { vehicle_id: string | null }[]) {
        if (d.vehicle_id) stickerVehicleIds.add(d.vehicle_id);
      }
    }

    // The truth snapshot feeds detail_version, so a change in the fact ledger
    // moves it even when the listing row itself did not change. One query for
    // the page, not one per row.
    const snapByVehicle = new Map<string, DetailVersionSnapshot>();
    if (ids.length) {
      const { data: snaps } = await admin
        .from("vehicle_snapshots")
        .select("vehicle_id, snapshot_version, content_checksum")
        .eq("tenant_id", tenantId)
        .in("vehicle_id", ids)
        .order("snapshot_version", { ascending: false });
      for (const sn of (snaps ?? []) as Record<string, unknown>[]) {
        const k = String(sn.vehicle_id);
        // Ordered newest-first, so the first one seen per vehicle is current.
        if (!snapByVehicle.has(k)) {
          snapByVehicle.set(k, {
            snapshot_version: sn.snapshot_version as number,
            content_checksum: sn.content_checksum as string,
          });
        }
      }
    }

    const vehicles = await Promise.all(page.map(async (r) => {
      const shaped = shapeLotRow(r, filesByVin.get(String(r.vin)) ?? null, {
        supabaseUrl,
        hasFactorySticker: stickerVehicleIds.has(String(r.id)),
      });
      shaped.detail_version = await detailVersion(r, snapByVehicle.get(String(r.id)) ?? null);
      return shaped;
    }));

    // A vehicle with no discrete make is filtered off the consumer's screens.
    // Counted here so that shows up as a number in the response rather than as
    // an empty page nobody can explain.
    const identity_incomplete = page.filter((r) =>
      identityIncomplete(r, filesByVin.get(String(r.vin)) ?? null)
    ).length;

    return json(200, {
      total: count ?? 0,
      limit,
      // Both, so a caller can stop on whichever it already reads. next_cursor
      // is the one to page with; has_more only says whether another page
      // exists.
      has_more: hasMore,
      next_cursor: hasMore ? String(vehicles[vehicles.length - 1]?.vin ?? "") || null : null,
      identity_incomplete,
      vehicles,
    });
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : String(e) });
  }
});
