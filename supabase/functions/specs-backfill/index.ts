import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { adminClient, SERVICE_KEY, SUPABASE_URL, isServiceOrCron } from "../_shared/supabase.ts";
import { preflight, json } from "../_shared/http.ts";

// ──────────────────────────────────────────────────────────────
// specs-backfill — decode the NeoVIN equipment breakout for every published
// vehicle still missing it. The nightly enrich-sweep should keep inventory
// decoded, but a too-tight NeoVIN timeout was finalizing cars with empty
// equipment; this backfill (with the timeout fixed in marketcheck-specs) fills
// the accumulated gap in one pass. Works a ~100s budget then self-chains until
// no null-options published vehicle remains. Auth: service role or cron secret.
// ──────────────────────────────────────────────────────────────

const BUDGET_MS = 100_000;
const MAX_DEPTH = 60;

async function run(depth: number) {
  const admin = adminClient();
  const deadline = Date.now() + BUDGET_MS;
  let decoded = 0, failed = 0;
  while (Date.now() < deadline) {
    // Published vehicles whose equipment never decoded (options is null/absent).
    const { data: rows } = await admin
      .from("vehicle_listings")
      .select("tenant_id, vin")
      .eq("status", "published")
      .is("mc_attributes->options", null)
      .limit(4);
    const batch = (rows as { tenant_id: string; vin: string }[] | null) || [];
    if (batch.length === 0) { console.log(`specs-backfill: done (decoded ${decoded}, failed ${failed})`); return; }
    for (const r of batch) {
      if (Date.now() >= deadline) break;
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/marketcheck-specs`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
          body: JSON.stringify({ vin: r.vin, tenant_id: r.tenant_id }),
          signal: AbortSignal.timeout(40000),
        });
        // marketcheck-specs writes options as an array (found) or [] (NeoVIN
        // answered, none) — either way the row leaves the null pool, so the
        // next loop's `is null` query naturally advances. A row that stays null
        // (all endpoints failed) is simply retried on the next chain.
        await res.json().catch(() => ({}));
        if (res.ok) decoded++; else failed++;
      } catch { failed++; }
    }
  }
  if (depth < MAX_DEPTH) {
    const admin2 = adminClient();
    const { data: more } = await admin2.from("vehicle_listings")
      .select("vin").eq("status", "published").is("mc_attributes->options", null).limit(1);
    if (((more as unknown[]) || []).length > 0) {
      await fetch(`${SUPABASE_URL}/functions/v1/specs-backfill`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
        body: JSON.stringify({ depth: depth + 1 }),
        signal: AbortSignal.timeout(10000),
      }).catch(() => {});
    }
  }
}

serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  if (req.method !== "POST") return json(405, { error: "method not allowed" });
  if (!isServiceOrCron(req)) return json(401, { error: "unauthorized" });
  const body = await req.json().catch(() => ({})) as { depth?: number };
  const depth = typeof body.depth === "number" ? body.depth : 0;
  const work = run(depth);
  // deno-lint-ignore no-explicit-any
  const er = (globalThis as any).EdgeRuntime;
  if (er && typeof er.waitUntil === "function") er.waitUntil(work); else await work;
  return json(200, { ok: true, depth });
});
