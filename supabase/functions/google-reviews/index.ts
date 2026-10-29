// ──────────────────────────────────────────────────────────────────────
// google-reviews — pulls the dealership's ACTUAL Google rating and review
// count from the Google Places API and persists them into
// dealer_profiles.settings (dealer_google_rating / dealer_google_count), so
// passport trust surfaces show real review data instead of hand-typed
// numbers. The matched place id is cached in settings.google_place_id so
// refreshes skip the text search.
//
// Body: { tenant_id }
// Auth: service-role/cron bearer, or a member of the tenant (JWT).
// ──────────────────────────────────────────────────────────────────────
import { json, preflight } from "../_shared/http.ts";
import { adminClient, isServiceOrCron } from "../_shared/supabase.ts";
import { admitProviderCall, recordProviderCall } from "../_shared/providerBudget.ts";

// GOOGLE_SEARCH_CONSOLE_API_KEY is the only Google key on this project today;
// if it's an unrestricted Google Cloud key with Places enabled it works here
// too, otherwise Places returns 403 and the caller sees places_search_failed.
const API_KEY = Deno.env.get("GOOGLE_PLACES_API_KEY") ||
  Deno.env.get("GOOGLE_MAPS_API_KEY") ||
  Deno.env.get("GOOGLE_API_KEY") ||
  Deno.env.get("GOOGLE_SEARCH_CONSOLE_API_KEY") || "";

const PLACES_BASE = "https://places.googleapis.com/v1";

// Every Places request passes the provider budget first; a refusal (or a
// budget that cannot be read) sends nothing to Google.
class PlacesBudgetRefused extends Error {}
async function gatedPlaces(
  admin: ReturnType<typeof adminClient>, tenantId: string, product: string, url: string, init: RequestInit,
): Promise<Response> {
  const gate = await admitProviderCall(admin, { url, caller: "google-reviews", provider: "google_places", product, tenantId });
  if (!gate.admitted) throw new PlacesBudgetRefused(gate.reason);
  try {
    const r = await fetch(url, init);
    await recordProviderCall(admin, gate.eventId, r.status, null);
    return r;
  } catch (err) {
    await recordProviderCall(admin, gate.eventId, null, err instanceof Error ? err.message : String(err));
    throw err;
  }
}

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;
  if (!API_KEY) return json(500, { error: "google_key_missing" });

  const body = await req.json().catch(() => ({}));
  const tenantId = String(body.tenant_id || "");
  if (!tenantId) return json(400, { error: "tenant_id required" });

  const admin = adminClient();

  if (!isServiceOrCron(req)) {
    const auth = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    const { data: ures } = await admin.auth.getUser(auth);
    const uid = ures?.user?.id;
    if (!uid) return json(401, { error: "unauthorized" });
    const { data: membership } = await admin.from("tenant_members")
      .select("id").eq("tenant_id", tenantId).eq("user_id", uid).maybeSingle();
    if (!membership) return json(403, { error: "forbidden" });
  }

  const { data: profile } = await admin.from("dealer_profiles")
    .select("settings").eq("tenant_id", tenantId).maybeSingle();
  if (!profile) return json(404, { error: "dealer_profile_not_found" });
  const s = (profile.settings ?? {}) as Record<string, unknown>;
  const name = String(s.dealer_name || "").trim();
  const address = String(s.dealer_address || "").trim();
  if (!name) return json(422, { error: "dealer_name_missing" });

  try {
    return await refresh(admin, tenantId, s, name, address);
  } catch (err) {
    if (err instanceof PlacesBudgetRefused) return json(429, { error: "budget_refused", reason: err.message });
    throw err;
  }
});

async function refresh(
  admin: ReturnType<typeof adminClient>, tenantId: string, s: Record<string, unknown>, name: string, address: string,
): Promise<Response> {
  let placeId = String(s.google_place_id || "");
  let rating: number | null = null;
  let count: number | null = null;
  let matched = "";
  let matchedAddress = "";

  if (placeId) {
    const r = await gatedPlaces(admin, tenantId, "place_details", `${PLACES_BASE}/places/${placeId}`, {
      headers: { "X-Goog-Api-Key": API_KEY, "X-Goog-FieldMask": "rating,userRatingCount,displayName,formattedAddress" },
    });
    if (r.ok) {
      const p = await r.json();
      rating = typeof p.rating === "number" ? p.rating : null;
      count = typeof p.userRatingCount === "number" ? p.userRatingCount : null;
      matched = p.displayName?.text || "";
      matchedAddress = p.formattedAddress || "";
    } else {
      placeId = ""; // stale id — fall back to a fresh text search
    }
  }

  if (!placeId) {
    const r = await gatedPlaces(admin, tenantId, "text_search", `${PLACES_BASE}/places:searchText`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": API_KEY,
        "X-Goog-FieldMask": "places.id,places.rating,places.userRatingCount,places.displayName,places.formattedAddress",
      },
      body: JSON.stringify({ textQuery: [name, address].filter(Boolean).join(", "), maxResultCount: 1 }),
    });
    if (!r.ok) {
      return json(502, { error: "places_search_failed", status: r.status, detail: (await r.text()).slice(0, 300) });
    }
    const place = (await r.json())?.places?.[0];
    if (!place) return json(404, { error: "place_not_found", query: name });
    placeId = String(place.id || "");
    rating = typeof place.rating === "number" ? place.rating : null;
    count = typeof place.userRatingCount === "number" ? place.userRatingCount : null;
    matched = place.displayName?.text || "";
    matchedAddress = place.formattedAddress || "";
  }

  if (rating == null || !count) {
    return json(404, { error: "no_rating_on_place", matched, matchedAddress });
  }

  const patch = {
    dealer_google_rating: rating.toFixed(1),
    dealer_google_count: String(count),
    google_place_id: placeId,
    google_rating_synced_at: new Date().toISOString(),
  };
  const { error: uerr } = await admin.from("dealer_profiles")
    .update({ settings: { ...s, ...patch } }).eq("tenant_id", tenantId);
  if (uerr) return json(500, { error: "settings_update_failed", detail: uerr.message });

  return json(200, { ok: true, matched, matchedAddress, rating: patch.dealer_google_rating, count });
}
