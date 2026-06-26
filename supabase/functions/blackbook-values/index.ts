import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// ──────────────────────────────────────────────────────────────
// blackbook-values — VIN + mileage → Black Book UsedCar values.
//
// Server-side only. Returns normalized trade-in / retail / wholesale values
// by condition (xclean / clean / average / rough) plus the mileage, region,
// and option adjustments and a residual/forecast estimate. Defensive parsing:
// Black Book's field names vary by plan, so every value is read through a
// list of candidate keys and falls back to null rather than throwing.
//
// Auth: service-role bearer or the shared MARKETCHECK_CRON_SECRET header
// (this is an internal enrichment endpoint, called by vehicle-enrich).
//
// Config (Supabase secrets):
//   BLACKBOOK_API_BASE   e.g. https://api.blackbookcloud.com   (no trailing slash)
//   BLACKBOOK_API_KEY    issued API key / token
//   BLACKBOOK_USERNAME   (optional, if the account uses user/pass)
//   BLACKBOOK_PASSWORD   (optional)
// When unset, returns { available:false, reason:"not_configured" } so the
// caller degrades gracefully.
// ──────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BB_BASE = (Deno.env.get("BLACKBOOK_API_BASE") || "").replace(/\/$/, "");
const BB_KEY = Deno.env.get("BLACKBOOK_API_KEY") || "";
const BB_USER = Deno.env.get("BLACKBOOK_USERNAME") || "";
const BB_PASS = Deno.env.get("BLACKBOOK_PASSWORD") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CRON_SECRET = Deno.env.get("MARKETCHECK_CRON_SECRET") || "";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// deno-lint-ignore no-explicit-any
const num = (v: any): number | null => { if (v == null) return null; const n = Number(String(v).replace(/[^0-9.\-]/g, "")); return Number.isFinite(n) ? n : null; };
// First present numeric value across candidate keys (case-insensitive, nested-safe).
// deno-lint-ignore no-explicit-any
const pick = (o: any, keys: string[]): number | null => {
  if (!o || typeof o !== "object") return null;
  const lower: Record<string, unknown> = {};
  for (const k of Object.keys(o)) lower[k.toLowerCase()] = o[k];
  for (const k of keys) { const v = lower[k.toLowerCase()]; const n = num(v); if (n != null) return n; }
  return null;
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  // Internal auth — service-role bearer or cron secret.
  const auth = req.headers.get("authorization") || "";
  const secret = req.headers.get("x-cron-secret") || "";
  const ok = (SERVICE_KEY && auth === `Bearer ${SERVICE_KEY}`) || (CRON_SECRET && secret === CRON_SECRET);
  if (!ok) return json(401, { error: "unauthorized" });

  if (!BB_BASE || (!BB_KEY && !(BB_USER && BB_PASS))) return json(200, { available: false, reason: "not_configured" });

  const body = await req.json().catch(() => ({})) as { vin?: string; mileage?: number; zip?: string; state?: string };
  const vin = (body.vin || "").trim().toUpperCase();
  const mileage = num(body.mileage) ?? 0;
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(vin)) return json(400, { error: "valid vin required" });

  try {
    // Black Book UsedCar VIN value lookup. Path + query are kept flexible via
    // env base; auth is sent as both a bearer and api_key param to cover the
    // common account styles. Region/zip refine the regional adjustment.
    const params = new URLSearchParams({ vin, mileage: String(mileage) });
    if (body.zip) params.set("zip", String(body.zip));
    if (body.state) params.set("state", String(body.state));
    if (BB_KEY) params.set("api_key", BB_KEY);
    const url = `${BB_BASE}/UsedCarWS/UsedCarVin/${vin}/${mileage}?${params.toString()}`;
    const headers: Record<string, string> = { Accept: "application/json" };
    if (BB_KEY) headers["Authorization"] = `Bearer ${BB_KEY}`;
    else if (BB_USER && BB_PASS) headers["Authorization"] = `Basic ${btoa(`${BB_USER}:${BB_PASS}`)}`;

    const res = await fetch(url, { headers, signal: AbortSignal.timeout(12000) });
    if (!res.ok) return json(200, { available: false, reason: `provider_${res.status}` });
    // deno-lint-ignore no-explicit-any
    const raw: any = await res.json().catch(() => ({}));

    // Black Book nests the vehicle under used_vehicles.used_vehicle_list[0] in
    // most plans; fall back to the root object.
    const v = raw?.used_vehicles?.used_vehicle_list?.[0] ?? raw?.used_vehicle_list?.[0] ?? raw?.vehicle ?? raw ?? {};

    const cond = (prefix: string) => ({
      xclean: pick(v, [`${prefix}_xclean`, `${prefix}_extraclean`, `xclean_${prefix}`]),
      clean: pick(v, [`${prefix}_clean`, `clean_${prefix}`]),
      average: pick(v, [`${prefix}_avg`, `${prefix}_average`, `avg_${prefix}`]),
      rough: pick(v, [`${prefix}_rough`, `rough_${prefix}`]),
    });

    const normalized = {
      tradein: cond("tradein"),       // adjusted_tradein_* / tradein_clean …
      retail: cond("retail"),
      wholesale: cond("whole"),        // Black Book labels wholesale "whole"
      mileage_adjustment: pick(v, ["mileage_adj", "mileage_adjustment", "adjusted_mileage"]),
      region_adjustment: pick(v, ["region_adj", "regional_adj", "geo_adjustment"]),
      option_adjustment: pick(v, ["option_adj", "options_adjustment", "add_deduct"]),
      residual_12: pick(v, ["residual_12", "res_12", "residual_value_12"]),
      residual_36: pick(v, ["residual_36", "res_36", "residual_value_36"]),
      residual_60: pick(v, ["residual_60", "res_60", "residual_value_60"]),
      bb_uvc: v?.uvc ?? v?.UVC ?? null,
      bb_model_year: v?.model_year ?? v?.year ?? null,
      segment: v?.segment ?? v?.body_type ?? null,
      mileage,
      checked_at: new Date().toISOString(),
    };

    const hasAny = [normalized.tradein.clean, normalized.retail.clean, normalized.wholesale.clean].some((n) => n != null);
    return json(200, { available: hasAny, ...normalized, raw });
  } catch (err) {
    return json(200, { available: false, reason: err instanceof Error ? err.message : "unknown" });
  }
});
