import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { shouldDecodeVin, MAX_SPEC_ATTEMPTS } from "../_shared/factorySticker/lib/sourceData.ts";
import { invokeFunction } from "../_shared/invoke.ts";

// Allow a signed-in platform admin to trigger the sweep from the app,
// mirroring specs-backfill's pattern. Verifies via admin.auth.getUser then
// checks user_roles for role='admin'.
async function isAuthenticatedAdmin(req: Request): Promise<boolean> {
  try {
    const auth = req.headers.get("Authorization") || "";
    if (!auth.toLowerCase().startsWith("bearer ")) return false;
    const token = auth.slice(7).trim();
    if (!token || token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) return false;
    const admin = createClient(
      Deno.env.get("SUPABASE_URL") || "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data: ures, error } = await admin.auth.getUser(token);
    const uid = ures?.user?.id;
    if (error || !uid) return false;
    const { data: roles } = await admin
      .from("user_roles").select("role").eq("user_id", uid).eq("role", "admin").limit(1);
    return !!(roles && roles.length > 0);
  } catch { return false; }
}

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
//
// Single-runner: three independent triggers can start a chain (the nightly
// cron, marketcheck-sync's once-a-day opportunistic kick, and the admin
// button), and a chain can run for hours — so without a lock a second chain
// starts on top of a live one and doubles the invocation rate against the
// shared MarketCheck key. Same service lock, and the same release-before-chain
// ordering, as specs-backfill.
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
const LOCK_KEY = "enrich_sweep";
const LOCK_TTL_SECONDS = 300;
// Pacing between VINs. Working one at a time is not by itself gentle: each VIN
// fans two sibling invocations at the platform's per-function rate limit and
// two calls at the single shared provider key, back to back with no gap.
const VIN_GAP_MS = 250;

const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Admin = ReturnType<typeof createClient>;

const newAdmin = (): Admin =>
  createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const releaseLock = async (admin: Admin) => {
  try { await admin.rpc("release_service_lock", { _key: LOCK_KEY }); }
  catch { /* the expiry is the backstop */ }
};

async function run(sweepStart: string, depth: number) {
  const admin = newAdmin();
  let more = false;
  try {
    more = await runSweep(admin, sweepStart);
  } finally {
    // Released even when a hop throws, so a failure cannot wedge the sweep
    // until the TTL expires.
    await releaseLock(admin);
  }
  // Chained only AFTER the lock is free, or the next hop would find the sweep
  // "already running" — against itself — and the chain would stop one batch in.
  if (more && depth < MAX_DEPTH) {
    await fetch(`${SUPABASE_URL}/functions/v1/enrich-sweep`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}`, "x-cron-secret": CRON_SECRET },
      body: JSON.stringify({ sweep_start: sweepStart, depth: depth + 1 }),
      signal: AbortSignal.timeout(15000),
    }).catch(() => { /* best-effort */ });
  }
}

async function runSweep(admin: Admin, sweepStart: string): Promise<boolean> {
  const deadline = Date.now() + BUDGET_MS;
  let failures = 0;
  let throttled = 0;
  while (Date.now() < deadline) {
    const { data: batch } = await admin.rpc("next_enrich_batch", { p_sweep_start: sweepStart, p_limit: 5 });
    // deno-lint-ignore no-explicit-any
    const rows = (batch as any[]) || [];
    if (rows.length === 0) {
      if (failures || throttled) console.warn(`enrich-sweep: ${failures} call(s) failed, ${throttled} throttled this hop`);
      return false; // done
    }
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
        // What "decoded" means, precisely. The equipment lists alone are not
        // enough: the OEM window sticker needs the structured build sheet
        // (packages, option codes, factory pricing, colors, assembly), and a
        // VIN decoded before that extractor existed has options/features but
        // no build_sheet. Testing only the lists marked those vehicles done
        // forever and left their stickers permanently unbuildable.
        // One VIN, one decode. shouldDecodeVin is the single tested rule:
        // a vehicle that keeps its build sheet is never re-pulled on a later
        // scrape, and a VIN the provider cannot decode stops costing money
        // after the attempt cap.
        const decision = shouldDecodeVin(mc, MAX_SPEC_ATTEMPTS);
        const attempts = decision.attempts;
        if (decision.decode && Date.now() < deadline) {
          const sres = await invokeFunction(`${SUPABASE_URL}/functions/v1/marketcheck-specs`, SERVICE_KEY, {
            body: { tenant_id: r.tenant_id, vin: r.vin },
            timeoutMs: 45_000, maxRetries: 1, maxWaitMs: 5_000,
            // Never more of the hop's remaining budget than one VIN is worth:
            // a throttled decode must not eat the whole batch's time.
            deadlineMs: Math.max(1_000, Math.min(50_000, deadline - Date.now())),
          });
          const ok = sres.ok;
          // The provider answering 200 with "monthly quota exhausted" is the
          // same class of non-answer as a throttle: nobody could decode right
          // now, so charging this VIN an attempt would retire decodable VINs
          // fleet-wide after three quota days.
          const quotaExhausted =
            (sres.data as { error?: string } | null)?.error === "provider_quota_exhausted";

          if (sres.rateLimited) throttled++;
          else if (!ok) failures++;
          // Stamp the attempt from here, not from the decoder: the decoder
          // returns early on a no-match without writing anything, so a
          // stamp written there would never land for exactly the VINs that
          // need the cap.
          //
          // A throttle is the exception: the platform asked us to slow down,
          // it is not this VIN failing to decode. Counting it would spend one
          // of only MAX_SPEC_ATTEMPTS paid attempts on an answer we never
          // received, and three throttles would retire a perfectly decodable
          // VIN forever. Leave the counter alone and let the next sweep ask.
          if (!sres.rateLimited) {
            try {
              const { data: after } = await admin
                .from("vehicle_listings").select("mc_attributes")
                .eq("tenant_id", r.tenant_id).eq("vin", r.vin).maybeSingle();
              // deno-lint-ignore no-explicit-any
              const fresh = (after?.mc_attributes ?? mc) as Record<string, any>;
              await admin.from("vehicle_listings").update({
                mc_attributes: {
                  ...fresh,
                  specs_attempts: attempts + 1,
                  specs_attempted_at: new Date().toISOString(),
                  ...(ok && !fresh.build_sheet ? { specs_no_build_sheet: true } : {}),
                },
              }).eq("tenant_id", r.tenant_id).eq("vin", r.vin);
            } catch { /* stamping is best-effort; the cap is the backstop */ }
          }
        }
      } catch { failures++; /* specs retried next sweep, within the cap */ }
      // Liveness guard: stamp enriched_at no matter the outcome so this VIN drops
      // out of next_enrich_batch FOR THIS SWEEP. vehicle-enrich already stamps on
      // its normal path, but its early returns (no MarketCheck key, invalid VIN,
      // missing row) and hard errors don't — without this, those VINs sort NULLS
      // FIRST and get re-hammered for the whole budget, then re-chained 80×. A
      // genuinely incomplete car is simply re-attempted on the next sweep
      // (new sweep_start), never in a tight loop.
      await admin.from("vehicle_listings").update({ enriched_at: new Date().toISOString() })
        .eq("tenant_id", r.tenant_id).eq("vin", r.vin);
      if (Date.now() + VIN_GAP_MS < deadline) await sleep(VIN_GAP_MS);
    }
  }
  // Budget hit — anything left? If so the caller chains another hop with the
  // same cursor, once it has let the lock go.
  const { data: more } = await admin.rpc("next_enrich_batch", { p_sweep_start: sweepStart, p_limit: 1 });
  return ((more as unknown[]) || []).length > 0;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  const auth = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const secret = req.headers.get("x-cron-secret") || "";
  const serviceOrCron = (SERVICE_KEY && auth === SERVICE_KEY) || (CRON_SECRET && secret === CRON_SECRET);
  if (!serviceOrCron && !(await isAuthenticatedAdmin(req))) {
    return json(401, { error: "unauthorized" });
  }

  const body = await req.json().catch(() => ({})) as { sweep_start?: string; depth?: number };
  const sweepStart = body.sweep_start || new Date().toISOString();
  const depth = typeof body.depth === "number" ? body.depth : 0;

  // One sweep at a time. Each hop re-takes the lock and extends it, so the run
  // holds it start to finish while an expiry still releases it if a hop dies.
  // Without this, the cron, marketcheck-sync's daily kick and the admin button
  // each start their own multi-hour chain over the same inventory.
  const { data: acquired } = await newAdmin().rpc("try_acquire_service_lock", {
    _key: LOCK_KEY,
    _ttl_seconds: LOCK_TTL_SECONDS,
    _holder: `depth:${depth}`,
  });
  if (acquired === false) {
    return json(200, { ok: true, skipped: "already_running", sweep_start: sweepStart, depth });
  }

  const work = run(sweepStart, depth);
  // deno-lint-ignore no-explicit-any
  const er = (globalThis as any).EdgeRuntime;
  if (er && typeof er.waitUntil === "function") er.waitUntil(work);
  else await work;

  return json(200, { ok: true, sweep_start: sweepStart, depth });
});
