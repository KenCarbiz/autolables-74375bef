// ──────────────────────────────────────────────────────────────────────
// marketcheck-specs — on-demand VIN specs/options decode. The nightly
// inventory sync carries only a partial option set; this pulls the full
// factory build sheet (installed options + standard equipment + features)
// for a single VIN from MarketCheck's VIN Decoder, then merges the result
// into vehicle_listings.mc_attributes so the vehicle file and the window
// sticker can list every option.
//
// Body: { vin, tenant_id?, vehicle_id? }
// ──────────────────────────────────────────────────────────────────────
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const MC_KEY = Deno.env.get("MARKETCHECK_API_KEY_1") || Deno.env.get("MARKETCHECK_API_KEY") || "";
const MC_BASE = "https://api.marketcheck.com/v2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const validVin = (vin: string) => /^[A-HJ-NPR-Z0-9]{17}$/i.test(vin);
const redact = (u: string) => u.replace(/api_key=[^&]+/, "api_key=***");

// Flatten a feed value (string | {name|label|description|...}) to a clean name.
// deno-lint-ignore no-explicit-any
const flat = (x: any): string =>
  typeof x === "string" ? x.trim()
  : x && typeof x === "object" ? String(x.name ?? x.label ?? x.description ?? x.value ?? x.code ?? "").trim()
  : "";

// Pull every array that looks like an option/equipment/feature list out of a
// decode payload, wherever MarketCheck nests it (the shape varies by plan).
// deno-lint-ignore no-explicit-any
function extractLists(raw: any): { options: string[]; features: string[] } {
  const options = new Set<string>();
  const features = new Set<string>();
  const OPTION_KEYS = /(^|_)(installed_options|options|optional_equipment|installed_equipment|packages|accessories)($|_)/i;
  const FEATURE_KEYS = /(^|_)(standard_equipment|standard_features|features|high_value_features|equipment|specifications)($|_)/i;

  // deno-lint-ignore no-explicit-any
  const walk = (node: any, keyHint = "") => {
    if (node == null) return;
    if (Array.isArray(node)) {
      const isOpt = OPTION_KEYS.test(keyHint);
      const isFeat = FEATURE_KEYS.test(keyHint);
      for (const item of node) {
        const name = flat(item);
        if (name) {
          if (isOpt) options.add(name);
          else if (isFeat) features.add(name);
          else features.add(name); // unlabeled list → treat as a feature
        } else if (item && typeof item === "object") {
          walk(item, keyHint);
        }
      }
      return;
    }
    if (typeof node === "object") {
      for (const [k, v] of Object.entries(node)) {
        if (Array.isArray(v) || (v && typeof v === "object")) walk(v, k);
      }
    }
  };
  walk(raw);
  return { options: [...options], features: [...features] };
}

// Candidate MarketCheck VIN-decode endpoints — the specs/options path differs
// across API generations, so we try each until one answers.
const specEndpoints = (vin: string): string[] => {
  const k = encodeURIComponent(MC_KEY);
  const v = encodeURIComponent(vin);
  return [
    `${MC_BASE}/decode/car/${v}/specs?api_key=${k}&include=options,features,equipment`,
    `${MC_BASE}/decode/car/${v}/specs?api_key=${k}`,
    `${MC_BASE}/decode/car/${v}?api_key=${k}&include=options,features,equipment`,
    `${MC_BASE}/decode/car/${v}?api_key=${k}`,
  ];
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (!MC_KEY) return json(200, { ok: false, error: "not_configured", note: "Set MARKETCHECK_API_KEY_1" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const body = await req.json().catch(() => ({}));
  const vin = String(body.vin || "").toUpperCase().trim();
  const tenantId: string | null = body.tenant_id || null;
  const vehicleId: string | null = body.vehicle_id || null;
  if (!validVin(vin)) return json(400, { ok: false, error: "invalid_vin" });

  // ── Auth gate: service-role bypasses; otherwise require a signed-in
  // tenant member or platform admin for the requested tenant.
  const auth = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (auth !== serviceKey) {
    const { data: ures, error: uerr } = await admin.auth.getUser(auth);
    const userId = ures?.user?.id;
    if (uerr || !userId) return json(401, { ok: false, error: "authentication required" });
    if (!tenantId) return json(400, { ok: false, error: "tenant_id required" });
    const { data: isAdmin } = await admin.from("user_roles")
      .select("role").eq("user_id", userId).eq("role", "admin").maybeSingle();
    if (!isAdmin) {
      const { data: membership } = await admin.from("tenant_members")
        .select("tenant_id").eq("user_id", userId).eq("tenant_id", tenantId).maybeSingle();
      if (!membership) return json(403, { ok: false, error: "not a member of this tenant" });
    }
  }


  const tried: { url: string; status: number | string }[] = [];
  // deno-lint-ignore no-explicit-any
  let payload: any = null;
  let endpoint = "";
  for (const url of specEndpoints(vin)) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
      tried.push({ url: redact(url), status: res.status });
      if (!res.ok) continue;
      const data = await res.json().catch(() => null);
      if (data == null) continue;
      payload = data;
      endpoint = redact(url);
      break;
    } catch (_e) {
      tried.push({ url: redact(url), status: "timeout_or_network" });
    }
  }

  if (!payload) return json(200, { ok: false, error: "no_endpoint_matched", tried });

  const { options, features } = extractLists(payload);
  // deno-lint-ignore no-explicit-any
  const build = (payload.build || payload) as any;

  // Best-effort merge into mc_attributes so the file + sticker pick it up,
  // isolated so a missing column never fails the decode response.
  if (vehicleId || tenantId) {
    try {
      const admin = createClient(Deno.env.get("SUPABASE_URL") || "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "");
      let sel = admin.from("vehicle_listings").select("id, mc_attributes").eq("vin", vin);
      if (tenantId) sel = sel.eq("tenant_id", tenantId);
      const { data: rows } = await sel.limit(1);
      const row = rows && rows[0];
      if (row) {
        const prev = (row.mc_attributes || {}) as Record<string, unknown>;
        // Backfill the decoded build fields (MPG, engine, drivetrain, …) too,
        // but only when present so we never null out good sync data.
        const fill: Record<string, unknown> = {};
        const setIf = (k: string, v: unknown) => { if (v != null && v !== "") fill[k] = v; };
        setIf("city_mpg", build.city_mpg);
        setIf("highway_mpg", build.highway_mpg);
        setIf("combined_mpg", build.combined_mpg);
        setIf("engine", build.engine);
        setIf("engine_size", build.engine_size);
        setIf("cylinders", build.cylinders);
        setIf("transmission", build.transmission);
        setIf("drivetrain", build.drivetrain);
        setIf("fuel_type", build.fuel_type);
        setIf("body_type", build.body_type);
        setIf("doors", build.doors);
        setIf("std_seating", build.std_seating);
        const merged = {
          ...prev,
          ...fill,
          options: options.length ? options : prev.options ?? null,
          features: features.length ? features : prev.features ?? null,
          specs_decoded_at: new Date().toISOString(),
        };
        await admin.from("vehicle_listings").update({ mc_attributes: merged }).eq("id", row.id);
      }
    } catch { /* mc_attributes may not be migrated yet */ }
  }

  return json(200, { ok: true, vin, endpoint, options, features, optionCount: options.length + features.length, build });
});
