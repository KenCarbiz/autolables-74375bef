import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { shouldDecodeVin, MAX_SPEC_ATTEMPTS } from "../_shared/factorySticker/lib/sourceData.ts";
import { adminClient, SERVICE_KEY, SUPABASE_URL, isServiceOrCron } from "../_shared/supabase.ts";
import { preflight, json } from "../_shared/http.ts";

// Allow a signed-in admin user to trigger the backfill manually from the app.
// Verifies the caller's JWT, then checks user_roles for the 'admin' role.
//
// Validated with the admin client's own `getUser`, the same call every other
// function here uses. That asks the auth server whether the token is still
// good — so a deleted or signed-out user is rejected, which local claim
// verification cannot tell you — and it needs no second client, no anon key
// and no floating dependency version.
async function isAuthenticatedAdmin(req: Request): Promise<boolean> {
  try {
    const auth = req.headers.get("Authorization") || "";
    if (!auth.toLowerCase().startsWith("bearer ")) return false;
    const token = auth.slice(7).trim();
    if (!token || token === SERVICE_KEY) return false;
    const admin = adminClient();
    const { data: ures, error } = await admin.auth.getUser(token);
    const uid = ures?.user?.id;
    if (error || !uid) return false;
    const { data: roles } = await admin
      .from("user_roles").select("role").eq("user_id", uid).eq("role", "admin").limit(1);
    return !!(roles && roles.length > 0);
  } catch { return false; }
}

// ──────────────────────────────────────────────────────────────
// specs-backfill — decode the NeoVIN equipment breakout for every published
// vehicle still missing it. The nightly enrich-sweep should keep inventory
// decoded, but a too-tight NeoVIN timeout was finalizing cars with empty
// equipment; this backfill (with the timeout fixed in marketcheck-specs) fills
// the accumulated gap in one pass. Works a ~100s budget then self-chains until
// no published vehicle still needs a decode — meaning none is missing a build
// sheet and none is holding a generic sheet that was never asked for its own
// build. Auth: service role, cron secret, or a signed-in platform admin.
// Single-runner: the sweep costs money per VIN, so a service lock stops two
// chains billing the provider twice for the same answer.
// ──────────────────────────────────────────────────────────────

const BUDGET_MS = 100_000;
const MAX_DEPTH = 60;
const BATCH_LIMIT = 4;

const LOCK_KEY = "specs_backfill";

type Candidate = { tenant_id: string; vin: string; mc_attributes: Record<string, unknown> | null };

// Published vehicles that still need a decode. Two populations qualify:
// those that never decoded at all, and those holding a GENERIC sheet that
// was never asked for its own build — every sheet decoded before the
// strict-first request shipped is generic, so selecting only on "no build
// sheet" would leave them permanently stuck on typical-for-trim data with
// no real MSRP. `specs_strict_attempted` drops a VIN out of this set once
// it has been asked properly, so the retry happens once, not every sweep.
const CANDIDATE_FILTER = [
  "mc_attributes->>build_sheet.is.null",
  "and(mc_attributes->build_sheet->>generic.eq.true,mc_attributes->>specs_strict_attempted.is.null)",
].join(",");

// The single question this function asks — of the work loop and of the chain
// condition alike. The row filter above cannot express the attempt cap, so the
// cap is applied in TypeScript; any caller that skips that step is asking a
// different, laxer question and will disagree about whether work remains.
// The scan window must be much wider than the batch: the cap is applied in
// TypeScript, so selecting only BATCH_LIMIT rows lets a handful of
// cap-exhausted VINs sit at the head of the result forever and starve every
// decodable VIN behind them ("all at the attempt cap" with 90 rows waiting).
const SCAN_LIMIT = 500;

async function nextCandidates(
  admin: ReturnType<typeof adminClient>,
): Promise<{ rows: Candidate[]; batch: Candidate[] }> {
  const { data } = await admin
    .from("vehicle_listings")
    .select("tenant_id, vin, mc_attributes")
    .eq("status", "published")
    .or(CANDIDATE_FILTER)
    .limit(SCAN_LIMIT);
  const rows = ((data as Candidate[] | null) || []);
  const decodable = rows.filter((r) => shouldDecodeVin(r.mc_attributes, MAX_SPEC_ATTEMPTS).decode);
  return { rows, batch: decodable.slice(0, BATCH_LIMIT) };
}


const releaseLock = async () => {
  try { await adminClient().rpc("release_service_lock", { _key: LOCK_KEY }); }
  catch { /* the expiry is the backstop */ }
};

async function run(depth: number) {
  let more = false;
  try {
    more = await runInner();
  } finally {
    // Released even when a link throws, so a failure cannot wedge the sweep
    // until the TTL expires.
    await releaseLock();
  }
  // Chained only AFTER the lock is free, or the next link would find the
  // sweep "already running" — against itself — and the chain would stop one
  // batch in.
  if (more && depth < MAX_DEPTH) {
    await fetch(`${SUPABASE_URL}/functions/v1/specs-backfill`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ depth: depth + 1 }),
      signal: AbortSignal.timeout(10000),
    }).catch(() => {});
  }
}

async function runInner(): Promise<boolean> {
  const admin = adminClient();
  const deadline = Date.now() + BUDGET_MS;
  let decoded = 0, failed = 0;
  while (Date.now() < deadline) {
    // Same rule the nightly sweep uses. This path used to select purely on
    // "options is null" and ignore the attempt cap, so a VIN the provider
    // cannot decode was re-paid on every backfill chain.
    const { rows, batch } = await nextCandidates(admin);
    if (batch.length === 0 && rows.length > 0) {
      console.log("specs-backfill: remaining rows are all at the attempt cap; stopping");
      return false;
    }
    if (batch.length === 0) { console.log(`specs-backfill: done (decoded ${decoded}, failed ${failed})`); return false; }
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
  // Must ask the SAME question the work loop asks — and now literally does,
  // through the same helper. It used to check "options is null", which the
  // generic-retry population fails; then it checked the row filter alone,
  // which ignores the attempt cap the loop applies, so a budget that expired
  // with only cap-exhausted rows left still chained a hop that could decode
  // nothing.
  const { batch: remaining } = await nextCandidates(admin);
  return remaining.length > 0;
}

serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  if (req.method !== "POST") return json(405, { error: "method not allowed" });
  if (!isServiceOrCron(req) && !(await isAuthenticatedAdmin(req))) {
    return json(401, { error: "unauthorized" });
  }
  const body = await req.json().catch(() => ({})) as { depth?: number };
  const depth = typeof body.depth === "number" ? body.depth : 0;

  // One sweep at a time. Each link in the chain re-takes the lock and
  // extends it, so the run holds it start to finish while an expiry still
  // releases it if a link dies. Without this, two admins clicking — or a
  // click landing on the nightly cron — bill the provider twice for the
  // same VIN.
  const admin = adminClient();
  const { data: acquired } = await admin.rpc("try_acquire_service_lock", {
    _key: "specs_backfill",
    _ttl_seconds: 300,
    _holder: `depth:${depth}`,
  });
  if (acquired === false) {
    return json(200, { ok: true, skipped: "already_running", depth });
  }

  const work = run(depth);
  // deno-lint-ignore no-explicit-any
  const er = (globalThis as any).EdgeRuntime;
  if (er && typeof er.waitUntil === "function") er.waitUntil(work); else await work;
  return json(200, { ok: true, depth });
});
