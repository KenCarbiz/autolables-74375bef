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
import { json, preflight } from "../_shared/http.ts";
import { adminClient, SERVICE_KEY } from "../_shared/supabase.ts";

const MC_KEY = Deno.env.get("MARKETCHECK_API_KEY_1") || Deno.env.get("MARKETCHECK_API_KEY") || "";
const MC_BASE = "https://api.marketcheck.com/v2";

const validVin = (vin: string) => /^[A-HJ-NPR-Z0-9]{17}$/i.test(vin);
const redact = (u: string) => u.replace(/api_key=[^&]+/, "api_key=***");

// Flatten a feed value (string | {name|label|description|...}) to a clean name.
// deno-lint-ignore no-explicit-any
// NeoVIN shapes: InstalledOption/AvailableOption use `name`; Feature/
// HighValueFeature use `description`; InstalledEquipment uses `item`.
const flat = (x: any): string =>
  typeof x === "string" ? x.trim()
  : x && typeof x === "object" ? String(x.name ?? x.label ?? x.item ?? x.description ?? x.value ?? x.code ?? "").trim()
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
        // Options/equipment sometimes arrive as a single delimited string
        // (e.g. "Heated Seats, Sunroof, …") rather than an array — split those.
        if (typeof v === "string" && v.trim() && (OPTION_KEYS.test(k) || FEATURE_KEYS.test(k))) {
          const isOpt = OPTION_KEYS.test(k);
          v.split(/[,;|]/).map((s) => s.trim()).filter(Boolean).forEach((s) => (isOpt ? options : features).add(s));
        } else if (Array.isArray(v) || (v && typeof v === "object")) walk(v, k);
      }
    }
  };
  walk(raw);
  return { options: [...options], features: [...features] };
}

// ── Structured build sheet ───────────────────────────────────────────────────
// NeoVIN returns five distinct layers (packages / installed options / high-value
// features / standard features / granular installed_equipment). The flat
// options+features arrays keep back-compat; this preserves the tiers so the
// passport can show packages as packages instead of a 633-row info dump.
// installed_equipment (engineering rows) is deliberately NOT captured — it is
// noise for shoppers.
// deno-lint-ignore no-explicit-any
function structuredSheet(payload: any): Record<string, unknown> | null {
  const src = payload || {};
  const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : undefined; };

  const packages: { name: string; msrp?: number; contents: string[] }[] = [];
  const pkgSrc = Array.isArray(src.options_packages) ? src.options_packages : [];
  for (const p of pkgSrc) {
    const name = flat(p);
    if (!name) continue;
    const contents = ([] as unknown[])
      .concat(p?.options ?? p?.contents ?? p?.items ?? p?.features ?? [])
      .map(flat).filter(Boolean);
    packages.push({ name, msrp: num(p?.msrp ?? p?.price), contents });
  }

  const options: { name: string; msrp?: number }[] = [];
  const optSrc = Array.isArray(src.installed_options_details) ? src.installed_options_details : [];
  for (const o of optSrc) {
    const name = flat(o);
    if (!name) continue;
    // Some feeds list packages inside installed options — route them by type or
    // by the presence of sub-contents.
    const subs = ([] as unknown[]).concat(o?.options ?? o?.contents ?? []).map(flat).filter(Boolean);
    if (/package/i.test(String(o?.type ?? o?.category ?? "")) || subs.length) {
      if (!packages.some((p) => p.name === name)) packages.push({ name, msrp: num(o?.msrp ?? o?.price), contents: subs });
    } else {
      options.push({ name, msrp: num(o?.msrp ?? o?.price) });
    }
  }

  // Category map {category: [{description}|string]} → {category: [names]}.
  const catMap = (obj: unknown): Record<string, string[]> => {
    const out: Record<string, string[]> = {};
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      for (const [cat, arr] of Object.entries(obj as Record<string, unknown>)) {
        const names = (Array.isArray(arr) ? arr : [arr]).map(flat).filter(Boolean);
        if (names.length) out[cat] = names;
      }
    }
    return out;
  };
  const key_features = catMap(src.high_value_features);
  const standard = catMap(src.features);

  // include_generic=true falls back to typical-for-trim specs when the VIN
  // can't be fully decoded — the passport must label those, never assert them.
  const generic = Boolean(src.is_generic ?? src.generic ?? /generic/i.test(String(src.decode_mode ?? src.decode ?? "")));

  if (!packages.length && !options.length && !Object.keys(key_features).length && !Object.keys(standard).length) return null;
  return { packages, options, key_features, standard, generic, decoded_at: new Date().toISOString(), source: "neovin" };
}

// Candidate MarketCheck VIN-decode endpoints — the specs/options path differs
// across API generations, so we try each until one answers.
const specEndpoints = (vin: string): string[] => {
  const k = encodeURIComponent(MC_KEY);
  const v = encodeURIComponent(vin);
  return [
    // NeoVIN carries the full installed options / equipment / features list —
    // the basic decoder returns core specs but no per-vehicle equipment.
    // include_generic falls back to generic specs when a VIN can't be fully
    // decoded. Try NeoVIN first; if the plan doesn't include it the call 4xx's
    // and we fall through to the basic decoder.
    `${MC_BASE}/decode/car/neovin/${v}/specs?api_key=${k}&include_generic=true`,
    `${MC_BASE}/decode/car/${v}/specs?api_key=${k}`,
    `${MC_BASE}/decode/car/${v}?api_key=${k}`,
  ];
};

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  if (!MC_KEY) return json(200, { ok: false, error: "not_configured", note: "Set MARKETCHECK_API_KEY_1" });

  const admin = adminClient();

  const body = await req.json().catch(() => ({}));
  const vin = String(body.vin || "").toUpperCase().trim();
  const tenantId: string | null = body.tenant_id || null;
  const vehicleId: string | null = body.vehicle_id || null;
  if (!validVin(vin)) return json(400, { ok: false, error: "invalid_vin" });

  // ── Auth gate: service-role bypasses; otherwise require a signed-in
  // tenant member or platform admin for the requested tenant.
  const auth = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (auth !== SERVICE_KEY) {
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
  const sheet = structuredSheet(payload);
  // deno-lint-ignore no-explicit-any
  const build = (payload.build || payload) as any;

  // Best-effort merge into mc_attributes so the file + sticker pick it up,
  // isolated so a missing column never fails the decode response.
  if (vehicleId || tenantId) {
    try {
      const admin = adminClient();
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
        setIf("transmission", build.transmission_description ?? build.transmission);
        setIf("drivetrain", build.drivetrain);
        setIf("fuel_type", build.fuel_type);
        setIf("body_type", build.body_type);
        setIf("doors", build.doors);
        // NeoVIN exposes seating_capacity at the top level (basic decoder uses std_seating).
        setIf("std_seating", build.std_seating ?? build.seating_capacity);
        setIf("seating_capacity", build.seating_capacity);
        const merged = {
          ...prev,
          ...fill,
          options: options.length ? options : prev.options ?? null,
          features: features.length ? features : prev.features ?? null,
          build_sheet: sheet ?? prev.build_sheet ?? null,
          specs_decoded_at: new Date().toISOString(),
        };
        await admin.from("vehicle_listings").update({ mc_attributes: merged }).eq("id", row.id);
      }
    } catch { /* mc_attributes may not be migrated yet */ }
  }

  // Diagnostics: surface what the decoder actually returned so an empty result
  // can be told apart from an extraction miss (payloadKeys/buildKeys show the
  // shape; if these are rich but options/features are empty, the decode plan
  // simply doesn't include per-vehicle equipment for this VIN).
  return json(200, {
    ok: true, vin, endpoint, options, features,
    buildSheet: sheet ? {
      packages: (sheet.packages as unknown[]).length,
      options: (sheet.options as unknown[]).length,
      keyFeatureCategories: Object.keys(sheet.key_features as Record<string, unknown>).length,
      generic: sheet.generic,
    } : null,
    optionCount: options.length + features.length, build,
    payloadKeys: payload && typeof payload === "object" ? Object.keys(payload) : [],
    buildKeys: build && typeof build === "object" ? Object.keys(build) : [],
  });
});
