import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { artifactPostsIdle, autoPreload } from "../_shared/intake-autoprovision.ts";
import { authenticateLegacyFeed } from "../_shared/legacyFeeds/auth.ts";
import { planListingWrite, type HeldVehicle } from "../_shared/legacyFeeds/archivedGuard.ts";
import { runFeedWrite } from "../_shared/legacyFeeds/idempotency.ts";
import { supabaseLegacyFeedStore } from "../_shared/legacyFeeds/supabaseStore.ts";

// Artifact posts are queued and paced, so they can still be in flight when the
// handler returns. Without this the isolate is torn down mid-queue and the
// last vehicles of a feed silently lose their documents — serialising the
// posts makes that MORE likely, not less, so the two changes belong together.
function drainArtifactPosts(): void {
  // deno-lint-ignore no-explicit-any
  const er = (globalThis as any).EdgeRuntime;
  if (er && typeof er.waitUntil === "function") er.waitUntil(artifactPostsIdle());
}


// ──────────────────────────────────────────────────────────────
// autocurb-sync
//
// Accepts a signed vehicle-inventory push from Autocurb.io and
// upserts a draft `vehicle_listings` row so the AutoLabels dealer
// sees the VIN ready to sticker without manual entry.
//
// Contract:
//   POST /functions/v1/autocurb-sync
//   Headers: X-Autocurb-Signature: sha256=<hmac>
//   Signed (preferred): X-Rooftop-Key-Id / X-Rooftop-Timestamp / X-Rooftop-Signature over the
//            raw body, plus Idempotency-Key. The tenant is the key's connection;
//            autocurb_tenant_id, when sent, must resolve to it. See
//            docs/vehicle-history/04-legacy-feed-transition.md.
//   Body: {
//     autocurb_tenant_id: string,
//     vehicles: [{
//       vin, ymm, trim, mileage, condition, price,
//       stock_number, photos: string[], source_url?
//     }, ...]
//   }
//
// Returns: { upserted: N, errors: [...], held: [{ vin, reason, review_id }] }
// held: VINs whose existing listing is archived (or otherwise retired). They are not
// updated; a vehicle reappearance review is opened instead.
//
// HMAC shared secret is AUTOCURB_SYNC_SECRET (env). Autocurb computes
// HMAC-SHA256 over the raw body and prefixes "sha256=". We recompute
// and timing-safe compare.
//
// Security model:
//   - The signature alone proves the push came from a party that
//     holds the shared secret. It does NOT authenticate a user.
//   - We scope all upserts to the tenant matching
//     autocurb_tenant_id, so a leaked secret cannot inject rows
//     into an unrelated tenant.
//   - Upserts are idempotent on (tenant_id, vin) — re-pushing the
//     same VIN updates the draft rather than creating duplicates.
//   - We never flip status to 'published'; dealer must still
//     complete prep sign-off and explicitly publish.
// ──────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-autocurb-signature, x-rooftop-key-id, x-rooftop-timestamp, x-rooftop-signature, idempotency-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", ...extra },
  });

const makeSlug = (vin: string, ymm: string | undefined) => {
  const seed = `${(ymm || "veh").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${vin
    .slice(-6)
    .toLowerCase()}`;
  const rand = Math.random().toString(36).slice(2, 6);
  return `${seed}-${rand}`;
};

interface InboundVehicle {
  vin: string;
  ymm?: string;
  trim?: string;
  mileage?: number;
  condition?: "new" | "used" | "cpo";
  price?: number;
  stock_number?: string;
  photos?: string[];
  source_url?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) {
      return json(500, { error: "supabase env not configured" });
    }

    const raw = await req.text();
    const admin = createClient(supabaseUrl, serviceKey);
    const feedStore = supabaseLegacyFeedStore(admin);
    let namedTenant = "";
    try {
      const named = (JSON.parse(raw) as { autocurb_tenant_id?: unknown })?.autocurb_tenant_id;
      if (typeof named === "string") namedTenant = named;
    } catch { /* the body is validated after authentication */ }
    const auth = await authenticateLegacyFeed({
      feed: "autocurb_sync",
      method: "POST",
      pathAndQuery: "",
      rawBody: raw,
      headers: req.headers,
      nowSeconds: Math.floor(Date.now() / 1000),
      claimedTenant: namedTenant ? { kind: "autocurb_tenant_id", value: namedTenant } : null,
    }, feedStore);
    if (!auth.ok) return json(auth.status, { error: auth.error });
    const reply = (status: number, body: unknown) =>
      json(status, body, auth.mode === "legacy" ? { "X-AutoLabels-Auth-Deprecated": "legacy-shared-secret" } : {});

    let body: {
      autocurb_tenant_id?: string;
      vehicles?: InboundVehicle[];
    };
    try {
      body = JSON.parse(raw);
    } catch {
      return json(400, { error: "invalid JSON body" });
    }
    if ((auth.mode === "legacy" && !body.autocurb_tenant_id) || !Array.isArray(body.vehicles)) {
      return reply(400, { error: "autocurb_tenant_id and vehicles[] required" });
    }
    if (body.vehicles.length === 0) return reply(200, { upserted: 0, errors: [], held: [] });
    if (body.vehicles.length > 500) {
      return reply(413, { error: "max 500 vehicles per request" });
    }

    const tenantQuery = admin.from("tenants").select("id,name,slug,is_active");
    const { data: tenant } = await (auth.mode === "signed"
      ? tenantQuery.eq("id", auth.tenantId)
      : tenantQuery.eq("autocurb_tenant_id", body.autocurb_tenant_id)
    ).maybeSingle();

    if (!tenant) {
      return reply(404, {
        error: "no autolabels tenant linked to this autocurb_tenant_id",
      });
    }
    if (!tenant.is_active) return reply(403, { error: "tenant is disabled" });

    const inbound = body.vehicles;
    const outcome = await runFeedWrite(feedStore, auth, "autocurb_sync", async () => {

    const { data: profile } = await admin
      .from("onboarding_profiles")
      .select("display_name,logo_url,phone")
      .eq("tenant_id", tenant.id)
      .maybeSingle();

    const dealerSnapshot = {
      name: profile?.display_name || tenant.name,
      logo_url: profile?.logo_url || null,
      phone: profile?.phone || null,
    };

    // Title/MCO intake email opt-out lives in dealer settings (default on),
    // mirroring the marketcheck-sync intake path.
    const { data: dprof } = await admin
      .from("dealer_profiles")
      .select("settings")
      .eq("tenant_id", tenant.id)
      .maybeSingle();
    const emailTitle =
      String((dprof?.settings as Record<string, unknown> | null)?.title_email_on_intake) !== "false";

    const errors: Array<{ vin: string; error: string }> = [];
    const held: HeldVehicle[] = [];
    const updatedIds: string[] = [];
    let upserted = 0;

    for (const v of inbound) {
      if (!v.vin || v.vin.length < 11) {
        errors.push({ vin: v.vin || "(missing)", error: "invalid VIN" });
        continue;
      }

      const { data: existing } = await admin
        .from("vehicle_listings")
        .select("id,slug,status,archived_at,archive_reason")
        .eq("tenant_id", tenant.id)
        .eq("vin", v.vin)
        .maybeSingle();

      if (planListingWrite(existing) === "hold_archived") {
        held.push(await feedStore.holdArchived(
          tenant.id, v.vin, existing, "autocurb_sync", auth.mode === "signed" ? auth.connectionId : "legacy",
        ));
        continue;
      }

      if (existing) {
        // Update ONLY the inventory fields the feed actually carries. The feed
        // is not the source of truth for the customer packet, so it must never
        // zero the dealer-curated documents / videos / value_props (or null a
        // good ymm/trim/mileage/price). Never demote a published listing either.
        const updatePatch: Record<string, unknown> = { tenant_id: tenant.id, vin: v.vin, dealer_snapshot: dealerSnapshot };
        if (v.ymm) updatePatch.ymm = v.ymm;
        if (v.trim) updatePatch.trim = v.trim;
        if (typeof v.mileage === "number") updatePatch.mileage = v.mileage;
        if (v.condition) updatePatch.condition = v.condition;
        if (typeof v.price === "number") updatePatch.price = v.price;
        const { error } = await admin
          .from("vehicle_listings")
          .update(updatePatch)
          .eq("id", existing.id);
        if (error) errors.push({ vin: v.vin, error: error.message });
        else { upserted++; updatedIds.push(existing.id); }
      } else {
        const slug = makeSlug(v.vin, v.ymm);
        const { data: inserted, error } = await admin.from("vehicle_listings").insert({
          tenant_id: tenant.id,
          vin: v.vin,
          ymm: v.ymm || null,
          trim: v.trim || null,
          mileage: typeof v.mileage === "number" ? v.mileage : null,
          condition: v.condition || null,
          price: typeof v.price === "number" ? v.price : null,
          dealer_snapshot: dealerSnapshot,
          documents: v.source_url ? [{ name: "Autocurb record", url: v.source_url, type: "external" }] : [],
          videos: [],
          value_props: [],
          slug,
          status: "draft",
          sticker_snapshot: {},
        }).select("id").single();
        if (error) errors.push({ vin: v.vin, error: error.message });
        else {
          upserted++;
          // New VIN → shared intake auto-provisioning (hub token, draft docs,
          // orchestration, description). Never throws back into this loop;
          // failures land in vehicle_exceptions.
          await autoPreload(admin, supabaseUrl, serviceKey, {
            tenantId: tenant.id, vin: v.vin, ymm: v.ymm || null,
            listingId: inserted?.id ?? null, emailTitle,
          });
        }
      }
    }

    // Description Intelligence for UPDATED vehicles (new inserts are covered by
    // autoPreload above). Fire-and-forget by design — a description failure must
    // never block or slow inventory ingestion. The orchestrator is idempotent
    // on (tenant, vehicle, source_data_version, config_version), and anything
    // missed here is picked up by the nightly reconcile sweep.
    if (supabaseUrl && serviceKey) {
      for (const vehicleId of updatedIds.slice(0, 200)) {
        try {
          fetch(`${supabaseUrl}/functions/v1/description-orchestrate`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
            body: JSON.stringify({ action: "orchestrate", tenant_id: tenant.id, vehicle_id: vehicleId, reason: "ingest" }),
            signal: AbortSignal.timeout(20000),
          }).catch(() => { /* best-effort */ });
        } catch { /* description best-effort */ }
      }
    }

    await admin.from("audit_log").insert({
      action: "autocurb_sync",
      entity_type: "tenant",
      entity_id: tenant.id,
      details: {
        autocurb_tenant_id: body.autocurb_tenant_id,
        received: inbound.length,
        upserted,
        held: held.length,
        errors: errors.length,
      },
    });

    drainArtifactPosts();
    return { status: 200, body: { upserted, errors, held } };
    });
    return json(outcome.status, outcome.body, outcome.headers);
  } catch (err) {
    return json(500, {
      error: err instanceof Error ? err.message : "unknown error",
    });
  }
});
