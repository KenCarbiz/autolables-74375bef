import { json, preflight } from "../_shared/http.ts";
import { SUPABASE_URL, SERVICE_KEY, adminClient, isServiceOrCron } from "../_shared/supabase.ts";

// ──────────────────────────────────────────────────────────────────────
// ingest-orchestrate — the fire-once recon dispatch that runs the moment a
// vehicle is ingested. Two modes:
//
//   Single  { tenant_id, vin, listing_id, ymm? }
//     Claims the listing (atomic, fire-once), seeds a recon estimate from the
//     dealer's required canned services, and — in 'auto' dispatch mode — emails
//     the used-car manager the approve link for any over-threshold lines.
//     A re-sync of the same car is a no-op (the claim already fired).
//
//   Sweep   { sweep: true }
//     The daily self-heal backstop: finds in-stock listings that never got
//     orchestrated (orchestrated_at IS NULL) and runs the single path for each,
//     so a car that slipped past the intake hook still gets its recon estimate.
//
// Auth: service-role / cron-secret only — it fans out email.
// ──────────────────────────────────────────────────────────────────────

const SWEEP_CAP = 200;

// deno-lint-ignore no-explicit-any
async function orchestrateOne(admin: any, tenantId: string, vin: string, listingId: string, ymm: string | null): Promise<string> {
  // Atomic fire-once claim. Only the winner dispatches.
  const { data: won } = await admin.rpc("claim_listing_orchestration", { _listing_id: listingId });
  if (won !== true) return "already_orchestrated";

  // Dealer's intake dispatch preference (manual = stage for UCM, auto = send now).
  const { data: prof } = await admin.from("dealer_profiles").select("settings").eq("tenant_id", tenantId).maybeSingle();
  const settings = (prof?.settings || {}) as Record<string, unknown>;
  const mode = String(settings.ingest_recon_dispatch || "manual") === "auto" ? "auto" : "manual";

  const { data: seed } = await admin.rpc("seed_recon_estimate_for_ingest", {
    _tenant_id: tenantId, _vin: vin, _ymm: ymm, _vehicle_listing_id: listingId, _mode: mode,
  });
  const r = (seed || {}) as { ok?: boolean; approval_token?: string; needs_approval?: boolean; skipped?: string };
  if (!r.ok || r.skipped) return r.skipped || "no_estimate";

  // In auto mode, anything over the auto-approve threshold needs the UCM — email
  // the approve link now. Manual-mode estimates wait in the UCM's daily queue,
  // so we don't email on intake.
  if (mode === "auto" && r.needs_approval && r.approval_token) {
    await fetch(`${SUPABASE_URL}/functions/v1/notify-recon-approval`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ approval_token: r.approval_token }),
      signal: AbortSignal.timeout(20000),
    }).catch(() => { /* best-effort */ });
  }
  return `seeded_${mode}`;
}

Deno.serve(async (req) => {
  const pf = preflight(req);
  if (pf) return pf;
  if (req.method !== "POST") return json(405, { error: "method not allowed" });
  if (!isServiceOrCron(req)) return json(401, { error: "unauthorized" });

  const body = await req.json().catch(() => ({})) as {
    tenant_id?: string; vin?: string; listing_id?: string; ymm?: string | null; sweep?: boolean;
  };
  const admin = adminClient();

  // ── Single-vehicle dispatch (called from the intake hook) ────────────────
  if (!body.sweep) {
    const tenantId = body.tenant_id;
    const vin = (body.vin || "").toUpperCase().trim();
    const listingId = body.listing_id;
    if (!tenantId || !vin || !listingId) return json(400, { error: "tenant_id, vin, listing_id required" });
    try {
      const result = await orchestrateOne(admin, tenantId, vin, listingId, body.ymm ?? null);
      return json(200, { ok: true, result });
    } catch (e) {
      return json(500, { ok: false, error: String((e as Error)?.message || e).slice(0, 300) });
    }
  }

  // ── Self-heal sweep: orchestrate anything the intake hook missed ─────────
  const { data: pending } = await admin.from("vehicle_listings")
    .select("id, tenant_id, vin, ymm")
    .is("orchestrated_at", null)
    .in("status", ["draft", "published"])
    .limit(SWEEP_CAP);
  let done = 0;
  for (const v of (pending || []) as { id: string; tenant_id: string; vin: string; ymm: string | null }[]) {
    if (!v.tenant_id || !v.vin || !v.id) continue;
    try {
      const result = await orchestrateOne(admin, v.tenant_id, (v.vin || "").toUpperCase(), v.id, v.ymm);
      if (result.startsWith("seeded")) done++;
    } catch { /* skip one, keep sweeping */ }
  }
  return json(200, { ok: true, scanned: (pending || []).length, seeded: done });
});
