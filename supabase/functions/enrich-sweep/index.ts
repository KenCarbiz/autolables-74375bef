import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// ──────────────────────────────────────────────────────────────
// enrich-sweep — the nightly self-chaining enrichment sweep.
//
// Enriches EVERY incomplete vehicle (across all tenants) one VIN at a time, so
// the single shared MarketCheck key is never hit concurrently (respects its
// per-account rate limit + quota, and inherently staggers dealers). One
// invocation works a ~100s budget then, if work remains, re-invokes itself with
// the same sweep_start — chaining until the inventory is fully enriched. The
// next_enrich_batch cursor (enriched_at < sweep_start) guarantees termination.
//
// Acks immediately and does the work in EdgeRuntime.waitUntil so each hop stays
// well under the wall-clock limit. Auth: service-role bearer or x-cron-secret.
// ──────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CRON_SECRET = Deno.env.get("MARKETCHECK_CRON_SECRET") || "";
const BUDGET_MS = 100_000;
const MAX_DEPTH = 80; // backstop against runaway chaining

const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function runSweep(sweepStart: string, depth: number) {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const deadline = Date.now() + BUDGET_MS;
  let failures = 0;
  while (Date.now() < deadline) {
    const { data: batch } = await admin.rpc("next_enrich_batch", { p_sweep_start: sweepStart, p_limit: 5 });
    // deno-lint-ignore no-explicit-any
    const rows = (batch as any[]) || [];
    if (rows.length === 0) { if (failures) console.warn(`enrich-sweep: ${failures} enrich call(s) failed this sweep`); return; } // done
    for (const r of rows) {
      if (Date.now() >= deadline) break;
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/vehicle-enrich`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}`, "x-cron-secret": CRON_SECRET },
          body: JSON.stringify({ tenant_id: r.tenant_id, vin: r.vin }),
          signal: AbortSignal.timeout(45000),
        });
        if (!res.ok) failures++;
      } catch { failures++; /* a failed enrich is retried next sweep, not this one */ }
      // Full build sheet: vehicle-enrich covers market/recall/value but NOT the
      // VIN options/features decode — that's marketcheck-specs, historically
      // on-demand only, which left most inventory with an empty equipment list
      // (and the passport's Equipment factor stuck on Pending). Decode any VIN
      // still missing both lists; skipped once populated, so each VIN costs one
      // decode ever, not one per sweep.
      try {
        const { data: lrow } = await admin
          .from("vehicle_listings").select("mc_attributes")
          .eq("tenant_id", r.tenant_id).eq("vin", r.vin).maybeSingle();
        // deno-lint-ignore no-explicit-any
        const mc = (lrow?.mc_attributes ?? {}) as Record<string, any>;
        const hasSpecs = (Array.isArray(mc.options) && mc.options.length > 0) ||
          (Array.isArray(mc.features) && mc.features.length > 0);
        if (!hasSpecs && Date.now() < deadline) {
          const sres = await fetch(`${SUPABASE_URL}/functions/v1/marketcheck-specs`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
            body: JSON.stringify({ tenant_id: r.tenant_id, vin: r.vin }),
            signal: AbortSignal.timeout(45000),
          });
          if (!sres.ok) failures++;
        }
      } catch { failures++; /* specs retried next sweep */ }
      // Liveness guard: stamp enriched_at no matter the outcome so this VIN drops
      // out of next_enrich_batch FOR THIS SWEEP. vehicle-enrich already stamps on
      // its normal path, but its early returns (no MarketCheck key, invalid VIN,
      // missing row) and hard errors don't — without this, those VINs sort NULLS
      // FIRST and get re-hammered for the whole budget, then re-chained 80×. A
      // genuinely incomplete car is simply re-attempted on the next sweep
      // (new sweep_start), never in a tight loop.
      await admin.from("vehicle_listings").update({ enriched_at: new Date().toISOString() })
        .eq("tenant_id", r.tenant_id).eq("vin", r.vin);
    }
  }
  // Budget hit — anything left? If so, chain another hop with the same cursor.
  if (depth < MAX_DEPTH) {
    const admin2 = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data: more } = await admin2.rpc("next_enrich_batch", { p_sweep_start: sweepStart, p_limit: 1 });
    if (((more as unknown[]) || []).length > 0) {
      await fetch(`${SUPABASE_URL}/functions/v1/enrich-sweep`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}`, "x-cron-secret": CRON_SECRET },
        body: JSON.stringify({ sweep_start: sweepStart, depth: depth + 1 }),
        signal: AbortSignal.timeout(15000),
      }).catch(() => { /* best-effort */ });
    }
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  const auth = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const secret = req.headers.get("x-cron-secret") || "";
  if (!(SERVICE_KEY && auth === SERVICE_KEY) && !(CRON_SECRET && secret === CRON_SECRET)) {
    return json(401, { error: "unauthorized" });
  }

  const body = await req.json().catch(() => ({})) as { sweep_start?: string; depth?: number };
  const sweepStart = body.sweep_start || new Date().toISOString();
  const depth = typeof body.depth === "number" ? body.depth : 0;

  const work = runSweep(sweepStart, depth);
  // deno-lint-ignore no-explicit-any
  const er = (globalThis as any).EdgeRuntime;
  if (er && typeof er.waitUntil === "function") er.waitUntil(work);
  else await work;

  return json(200, { ok: true, sweep_start: sweepStart, depth });
});
