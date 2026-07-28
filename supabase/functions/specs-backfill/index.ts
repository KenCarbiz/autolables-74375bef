import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { shouldDecodeVin, MAX_SPEC_ATTEMPTS } from "../_shared/factorySticker/lib/sourceData.ts";
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
    // Published vehicles that still need a decode. Two populations qualify:
    // those that never decoded at all, and those holding a GENERIC sheet that
    // was never asked for its own build — every sheet decoded before the
    // strict-first request shipped is generic, so selecting only on "no build
    // sheet" would leave them permanently stuck on typical-for-trim data with
    // no real MSRP. `specs_strict_attempted` drops a VIN out of this set once
    // it has been asked properly, so the retry happens once, not every sweep.
    const { data: rows } = await admin
      .from("vehicle_listings")
      .select("tenant_id, vin, mc_attributes")
      .eq("status", "published")
      .or([
        "mc_attributes->>build_sheet.is.null",
        "and(mc_attributes->build_sheet->>generic.eq.true,mc_attributes->>specs_strict_attempted.is.null)",
      ].join(","))
      .limit(4);
    // Same rule the nightly sweep uses. This path used to select purely on
    // "options is null" and ignore the attempt cap, so a VIN the provider
    // cannot decode was re-paid on every backfill chain.
    const batch = ((rows as { tenant_id: string; vin: string; mc_attributes: Record<string, unknown> | null }[] | null) || [])
      .filter((r) => shouldDecodeVin(r.mc_attributes, MAX_SPEC_ATTEMPTS).decode);
    if (batch.length === 0 && (rows || []).length > 0) {
      console.log("specs-backfill: remaining rows are all at the attempt cap; stopping");
      return;
    }
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
        // Stamp the attempt from here: marketcheck-specs returns early
        // without writing on a no-match, which is exactly the case the cap
        // exists for.
        try {
          const { data: after } = await admin.from("vehicle_listings")
            .select("mc_attributes").eq("tenant_id", r.tenant_id).eq("vin", r.vin).maybeSingle();
          const fresh = ((after?.mc_attributes ?? r.mc_attributes) || {}) as Record<string, unknown>;
          await admin.from("vehicle_listings").update({
            mc_attributes: {
              ...fresh,
              specs_attempts: (Number(fresh.specs_attempts) || 0) + 1,
              specs_attempted_at: new Date().toISOString(),
            },
          }).eq("tenant_id", r.tenant_id).eq("vin", r.vin);
        } catch { /* the cap is the backstop */ }
      } catch { failed++; }
    }
  }
  if (depth < MAX_DEPTH) {
    const admin2 = adminClient();
    const { data: more } = await admin2.from("vehicle_listings")
      .select("vin").eq("status", "published").is("mc_attributes->>options", null).limit(1);
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
  if (!isServiceOrCron(req) && !(await isAuthenticatedAdmin(req))) {
    return json(401, { error: "unauthorized" });
  }
  const body = await req.json().catch(() => ({})) as { depth?: number };
  const depth = typeof body.depth === "number" ? body.depth : 0;
  const work = run(depth);
  // deno-lint-ignore no-explicit-any
  const er = (globalThis as any).EdgeRuntime;
  if (er && typeof er.waitUntil === "function") er.waitUntil(work); else await work;
  return json(200, { ok: true, depth });
});
