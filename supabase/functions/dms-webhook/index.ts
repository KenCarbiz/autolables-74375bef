import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { autoPreload } from "../_shared/intake-autoprovision.ts";

// ──────────────────────────────────────────────────────────────
// dms-webhook
//
// Single ingestion endpoint for DMS / inventory providers. Each
// provider maps to a different payload shape and a different shared
// secret, but the resulting upsert into vehicle_listings is the same.
//
// Contract:
//   POST /functions/v1/dms-webhook?provider=<vauto|vinsolutions|cdk|reynolds|generic>
//   Headers:
//     X-Dms-Signature: sha256=<hmac>      (HMAC-SHA-256 over raw body)
//     X-Dms-Tenant: <tenant-uuid>          (which AutoLabels tenant to write into)
//   Body: provider-specific JSON. We normalize to a shared
//   InboundVehicle shape before upserting.
//
// Returns: { provider, upserted, errors: [...] }
//
// Per-provider HMAC secret env keys:
//   DMS_SECRET_VAUTO
//   DMS_SECRET_VINSOLUTIONS
//   DMS_SECRET_CDK
//   DMS_SECRET_REYNOLDS
//   DMS_SECRET_GENERIC
//
// Security model mirrors autocurb-sync. The signature proves the
// push came from a party holding the secret. The tenant header
// scopes all writes; a leaked secret cannot inject into another
// tenant's listings.
// ──────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-dms-signature, x-dms-tenant",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const hmacSha256Hex = async (secret: string, body: string) => {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

const timingSafeEqual = (a: string, b: string) => {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
};

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

const PROVIDERS = ["vauto", "vinsolutions", "cdk", "reynolds", "generic"] as const;
type Provider = (typeof PROVIDERS)[number];

const secretEnvKey = (p: Provider) => `DMS_SECRET_${p.toUpperCase()}`;

// ── Per-provider mappers ─────────────────────────────────────────
const mapVauto = (raw: any): InboundVehicle[] => {
  const list = Array.isArray(raw?.vehicles) ? raw.vehicles : [];
  return list.map((v: any) => ({
    vin: v.vin,
    ymm: [v.year, v.make, v.model].filter(Boolean).join(" "),
    trim: v.trim,
    mileage: typeof v.odometer === "number" ? v.odometer : undefined,
    condition: v.type === "New" ? "new" : v.certified ? "cpo" : "used",
    price: typeof v.price === "number" ? v.price : undefined,
    stock_number: v.stockNumber,
    photos: Array.isArray(v.photoUrls) ? v.photoUrls : undefined,
  }));
};

const mapVinSolutions = (raw: any): InboundVehicle[] => {
  const list = Array.isArray(raw?.Inventory) ? raw.Inventory : [];
  return list.map((v: any) => ({
    vin: v.VIN,
    ymm: [v.Year, v.Make, v.Model].filter(Boolean).join(" "),
    trim: v.Trim,
    mileage: v.Mileage,
    condition: v.NewUsed === "N" ? "new" : v.Certified === "Y" ? "cpo" : "used",
    price: v.SellingPrice,
    stock_number: v.StockNumber,
    photos: typeof v.PhotoURLs === "string"
      ? v.PhotoURLs.split(",").map((s: string) => s.trim()).filter(Boolean)
      : Array.isArray(v.PhotoURLs) ? v.PhotoURLs : undefined,
  }));
};

const mapCdk = (raw: any): InboundVehicle[] => {
  // CDK Drive Inventory feed — JSON variant of ADF.
  const list = Array.isArray(raw?.inventory) ? raw.inventory : [];
  return list.map((v: any) => ({
    vin: v.vin,
    ymm: [v.modelYear, v.makeName, v.modelName].filter(Boolean).join(" "),
    trim: v.trimDescription,
    mileage: v.odometer,
    condition: v.vehicleType === "NEW" ? "new" : v.cpoFlag ? "cpo" : "used",
    price: v.askingPrice,
    stock_number: v.stockNumber,
    photos: Array.isArray(v.images) ? v.images.map((img: any) => img.url || img) : undefined,
  }));
};

const mapReynolds = (raw: any): InboundVehicle[] => {
  // ERA-IGNITE inventory feed — DealerVault-style JSON.
  const list = Array.isArray(raw?.records) ? raw.records : [];
  return list.map((v: any) => ({
    vin: v.VIN_NUMBER,
    ymm: [v.MODEL_YEAR, v.VEH_MAKE, v.VEH_MODEL].filter(Boolean).join(" "),
    trim: v.VEH_TRIM,
    mileage: v.MILEAGE,
    condition: v.NEW_USED === "N" ? "new" : v.CPO === "Y" ? "cpo" : "used",
    price: v.SALE_PRICE,
    stock_number: v.STOCK_NO,
    photos: undefined,
  }));
};

const mapGeneric = (raw: any): InboundVehicle[] => {
  const list = Array.isArray(raw?.vehicles) ? raw.vehicles : [];
  return list.filter((v: any) => v && typeof v === "object" && v.vin);
};

const MAPPERS: Record<Provider, (raw: any) => InboundVehicle[]> = {
  vauto: mapVauto,
  vinsolutions: mapVinSolutions,
  cdk: mapCdk,
  reynolds: mapReynolds,
  generic: mapGeneric,
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return json(500, { error: "supabase not configured" });

    const url = new URL(req.url);
    const provider = (url.searchParams.get("provider") || "").toLowerCase() as Provider;
    if (!PROVIDERS.includes(provider)) {
      return json(400, { error: `unknown provider; expected one of ${PROVIDERS.join(", ")}` });
    }
    const sharedSecret = Deno.env.get(secretEnvKey(provider));
    if (!sharedSecret) {
      return json(500, { error: `${secretEnvKey(provider)} not configured` });
    }

    const tenantId = req.headers.get("x-dms-tenant") || "";
    if (!tenantId) return json(400, { error: "X-Dms-Tenant header required" });

    const raw = await req.text();
    const sigHeader = req.headers.get("x-dms-signature") || "";
    const expected = "sha256=" + (await hmacSha256Hex(sharedSecret, raw));
    if (!timingSafeEqual(sigHeader, expected)) {
      return json(401, { error: "invalid signature" });
    }

    let parsed: unknown;
    try { parsed = JSON.parse(raw); }
    catch { return json(400, { error: "invalid JSON body" }); }

    const vehicles = MAPPERS[provider](parsed as Record<string, unknown>);
    if (vehicles.length === 0) return json(200, { provider, upserted: 0, errors: [] });
    if (vehicles.length > 500) return json(413, { error: "max 500 vehicles per request" });

    const admin = createClient(supabaseUrl, serviceKey);

    const { data: tenant } = await admin
      .from("tenants")
      .select("id,name,is_active")
      .eq("id", tenantId)
      .maybeSingle();
    if (!tenant) return json(404, { error: "tenant not found" });
    if (!tenant.is_active) return json(403, { error: "tenant disabled" });

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
    const updatedIds: string[] = [];
    let upserted = 0;

    for (const v of vehicles) {
      if (!v.vin || v.vin.length < 11) {
        errors.push({ vin: v.vin || "(missing)", error: "invalid VIN" });
        continue;
      }

      const { data: existing } = await admin
        .from("vehicle_listings")
        .select("id,status")
        .eq("tenant_id", tenant.id)
        .eq("vin", v.vin)
        .maybeSingle();

      const insertPatch = {
        tenant_id: tenant.id,
        vin: v.vin,
        ymm: v.ymm || null,
        trim: v.trim || null,
        mileage: typeof v.mileage === "number" ? v.mileage : null,
        condition: v.condition || null,
        price: typeof v.price === "number" ? v.price : null,
        dealer_snapshot: dealerSnapshot,
        documents: [],
        videos: [],
        value_props: [],
      } as Record<string, unknown>;

      if (existing) {
        // Update ONLY the inventory fields the feed actually carries. The feed
        // is not the source of truth for the customer packet, so it must never
        // zero dealer-curated documents / videos / value_props or null a good
        // ymm/trim/mileage/price. Mirrors autocurb-sync's narrow update patch.
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
          ...patch,
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

    await admin.from("audit_log").insert({
      action: "dms_sync",
      entity_type: "tenant",
      entity_id: tenant.id,
      store_id: tenant.id,
      details: { provider, received: vehicles.length, upserted, errors: errors.length },
    });

    return json(200, { provider, upserted, errors });
  } catch (err) {
    return json(500, { error: err instanceof Error ? err.message : "unknown error" });
  }
});
