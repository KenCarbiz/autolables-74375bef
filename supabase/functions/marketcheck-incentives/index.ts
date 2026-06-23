import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// marketcheck-incentives — OEM incentive lookup via MarketCheck's
// /v2/search/car/incentive/oem endpoint (the only incentive route enabled
// on the plan). Two modes:
//   { tenant_id, vin, zip }  → on-demand single-vehicle lookup for a customer
//                              ZIP (called from the public Vehicle Passport).
//   { batch: true }          → nightly pull: for every tenant that turned
//                              incentives ON, fetch offers for the dealer ZIP
//                              and write the matches onto marketcheck_vehicle_cache.
//
// MarketCheck offers are make/model/year + region programs (not per-VIN), so
// we match a vehicle by make+model+year against each offer's offer.vehicles[].

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MC_BASE = "https://api.marketcheck.com/v2";
const KEY = Deno.env.get("MARKETCHECK_API_KEY_1") || Deno.env.get("MARKETCHECK_API_KEY") || "";

// deno-lint-ignore no-explicit-any
type Json = any;

interface Incentive {
  type: string;
  amount?: number;
  rate?: string;
  description: string;
  expiration?: string | null;
  eligibility?: string | null;
  scope?: string | null;
}

// Map MarketCheck's raw offer row to our compact display shape (verified
// against a live INFINITI lease offer).
const normalizeOffer = (row: Json): Incentive & { _vehicles: Json[] } => {
  const o = row?.offer || {};
  const kind = String(o.offer_type || "").toLowerCase();
  const amt = Array.isArray(o.amounts) ? o.amounts[0] : undefined;
  const cashback = typeof o.cashback_amount === "number" ? o.cashback_amount : undefined;

  let rate: string | undefined;
  if ((kind === "lease" || kind === "finance") && amt) {
    if (typeof amt.apr === "number") rate = `${amt.apr}% APR for ${amt.term} ${amt.term_unit || "months"}`;
    else if (typeof amt.monthly === "number") rate = `$${amt.monthly}/mo for ${amt.term} ${amt.term_unit || "months"}`;
  }
  const typeLabel =
    kind === "lease" ? "Lease Offer" :
    kind === "finance" ? "Finance Offer" :
    (cashback ? "Customer Cash" : (o.offer_type || "Offer"));

  const description = [...(o.titles || []), ...(o.offers || [])].filter(Boolean).join(" — ") || String(o.titles?.[0] || "");
  const eligibility = o.cashback_target_group || (Array.isArray(o.disclaimers) && o.disclaimers[0] ? String(o.disclaimers[0]).slice(0, 160) : null);

  return {
    type: typeLabel,
    amount: cashback,
    rate,
    description,
    expiration: o.valid_through || null,
    eligibility,
    scope: row?.state || row?.zip || null,
    _vehicles: Array.isArray(o.vehicles) ? o.vehicles : [],
  };
};

const fetchOffers = async (opts: { zip: string; radius?: number; make?: string; model?: string; year?: string | number; rows?: number }): Promise<{ offers: (Incentive & { _vehicles: Json[] })[]; error?: string }> => {
  if (!KEY) return { offers: [], error: "not_configured" };
  const p = new URLSearchParams({ api_key: KEY, zip: opts.zip, radius: String(opts.radius ?? 100), rows: String(opts.rows ?? 25) });
  if (opts.make) p.set("make", opts.make);
  if (opts.model) p.set("model", opts.model);
  if (opts.year) p.set("year", String(opts.year));
  try {
    const res = await fetch(`${MC_BASE}/search/car/incentive/oem?${p.toString()}`);
    if (!res.ok) return { offers: [], error: `http_${res.status}` };
    const j = await res.json();
    const list: Json[] = Array.isArray(j?.listings) ? j.listings : Array.isArray(j?.incentives) ? j.incentives : [];
    return { offers: list.map(normalizeOffer) };
  } catch (e) {
    return { offers: [], error: e instanceof Error ? e.message : "fetch_failed" };
  }
};

// "2025 INFINITI QX80 Sensory" → { year, make, model }
const parseYmm = (ymm: string | null | undefined): { year?: string; make?: string; model?: string } => {
  const parts = String(ymm || "").trim().split(/\s+/);
  if (parts.length < 3) return {};
  return { year: /^\d{4}$/.test(parts[0]) ? parts[0] : undefined, make: parts[1], model: parts[2] };
};

const stripPublic = (offers: (Incentive & { _vehicles: Json[] })[]): Incentive[] =>
  offers.map(({ _vehicles, ...rest }) => rest);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (body: Json, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  let body: { tenant_id?: string; vin?: string; zip?: string; batch?: boolean } = {};
  try { body = await req.json(); } catch { /* empty */ }

  const admin = createClient(Deno.env.get("SUPABASE_URL") || "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "");

  // ── On-demand customer-ZIP lookup ───────────────────────────────
  if (body.vin && body.zip && body.tenant_id) {
    const { data: v } = await admin.from("vehicle_listings").select("ymm").eq("tenant_id", body.tenant_id).eq("vin", body.vin).maybeSingle();
    const ymm = parseYmm(v?.ymm);
    const { offers, error } = await fetchOffers({ zip: body.zip, make: ymm.make, model: ymm.model, year: ymm.year });
    if (error === "not_configured") return json({ error: "not_configured", incentives: [] });
    // MarketCheck's model filter is loose (a QX80 query can return QX60 offers),
    // so keep only offers that actually list this vehicle's make + model.
    const matched = ymm.make && ymm.model
      ? offers.filter((o) => o._vehicles.some((veh) =>
          String(veh.make || "").toUpperCase() === ymm.make!.toUpperCase() &&
          String(veh.model || "").toUpperCase() === ymm.model!.toUpperCase()))
      : offers;
    const incentives = stripPublic(matched);
    // Best-effort cache (24h) for repeat views of the same VIN + ZIP.
    await admin.from("incentive_customer_zip_cache").upsert({
      tenant_id: body.tenant_id, vin: body.vin, customer_zip: body.zip,
      incentives_data: incentives, pulled_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    }, { onConflict: "tenant_id,vin,customer_zip" }).then(() => undefined, () => undefined);
    return json({ incentives, count: incentives.length });
  }

  // ── Nightly dealer-ZIP batch ─────────────────────────────────────
  if (body.batch) {
    if (!KEY) return json({ error: "not_configured" }, 200);
    const { data: enabled } = await admin
      .from("tenant_incentive_settings")
      .select("tenant_id, dealer_zip_override")
      .eq("incentives_enabled", true);
    let tenantsProcessed = 0, vehiclesWritten = 0;
    for (const t of (enabled || []) as { tenant_id: string; dealer_zip_override: string | null }[]) {
      const zip = (t.dealer_zip_override || "").trim();
      if (!/^\d{5}$/.test(zip)) continue;
      const { offers } = await fetchOffers({ zip, rows: 500 });
      // Index offers by make|model|year for quick per-vehicle matching.
      const idx = new Map<string, Incentive[]>();
      for (const off of offers) {
        for (const veh of off._vehicles) {
          const k = `${String(veh.make || "").toUpperCase()}|${String(veh.model || "").toUpperCase()}|${veh.year || ""}`;
          const list = idx.get(k) || [];
          const { _vehicles, ...pub } = off;
          list.push(pub);
          idx.set(k, list);
        }
      }
      const { data: vehicles } = await admin.from("vehicle_listings").select("vin, ymm").eq("tenant_id", t.tenant_id).limit(2000);
      for (const veh of (vehicles || []) as { vin: string; ymm: string | null }[]) {
        const y = parseYmm(veh.ymm);
        const k = `${String(y.make || "").toUpperCase()}|${String(y.model || "").toUpperCase()}|${y.year || ""}`;
        const match = idx.get(k) || [];
        await admin.from("marketcheck_vehicle_cache").upsert({
          tenant_id: t.tenant_id, vin: veh.vin, incentives_dealer_zip: match, updated_at: new Date().toISOString(),
        }, { onConflict: "tenant_id,vin" }).then(() => { vehiclesWritten++; }, () => undefined);
      }
      tenantsProcessed++;
    }
    return json({ ok: true, tenantsProcessed, vehiclesWritten });
  }

  return json({ error: "bad_request", hint: "Provide { tenant_id, vin, zip } or { batch: true }" }, 400);
});
