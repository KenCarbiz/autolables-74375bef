import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ──────────────────────────────────────────────────────────────────────
// title-reminders-sweep — for each tenant with reminders enabled, re-email the
// office an upload link for any in-stock vehicle that still has no complete
// Title (used) / MCO (new) on file, paced by the tenant's reminder cadence.
// Runs daily via cron. Service-role only.
// ──────────────────────────────────────────────────────────────────────

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const PER_TENANT_CAP = 60;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  // Service-role or the cron secret only — this fans out emails, so it must not
  // be publicly triggerable.
  const auth = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const cronSecret = Deno.env.get("MARKETCHECK_CRON_SECRET") || "";
  const hasCron = !!cronSecret && (req.headers.get("x-cron-secret") || "") === cronSecret;
  if (auth !== SERVICE_KEY && !hasCron) return json(401, { error: "unauthorized" });

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: profiles } = await admin.from("dealer_profiles").select("tenant_id, settings");
  let emailed = 0, scanned = 0;

  for (const prof of (profiles || []) as { tenant_id: string; settings: Record<string, unknown> }[]) {
    const s = prof.settings || {};
    if (String(s.title_reminders_enabled) === "false") continue;
    const freqDays = Math.max(1, Number(s.title_reminder_days) || 3);
    const cutoff = new Date(Date.now() - freqDays * 864e5).toISOString();

    const { data: vehicles } = await admin.from("vehicle_listings")
      .select("vin, condition").eq("tenant_id", prof.tenant_id).in("status", ["draft", "published"]).limit(2000);
    if (!vehicles?.length) continue;

    const { data: docs } = await admin.from("vehicle_documents")
      .select("vin, doc_type").eq("tenant_id", prof.tenant_id)
      .in("doc_type", ["title_front", "title_back", "mco_front", "mco_back"]).limit(5000);
    const haveByVin = new Map<string, Set<string>>();
    for (const d of (docs || []) as { vin: string; doc_type: string }[]) {
      const k = (d.vin || "").toUpperCase();
      if (!haveByVin.has(k)) haveByVin.set(k, new Set());
      haveByVin.get(k)!.add(d.doc_type);
    }

    // Last reminder per VIN (from the audit trail email-title-request writes).
    const { data: sends } = await admin.from("audit_log")
      .select("entity_id, created_at").eq("store_id", prof.tenant_id).eq("action", "title_request_emailed")
      .order("created_at", { ascending: false }).limit(5000);
    const lastSent = new Map<string, string>();
    for (const a of (sends || []) as { entity_id: string; created_at: string }[]) {
      const k = (a.entity_id || "").toUpperCase();
      if (!lastSent.has(k)) lastSent.set(k, a.created_at);
    }

    let tenantEmailed = 0;
    for (const v of vehicles as { vin: string; condition: string }[]) {
      if (tenantEmailed >= PER_TENANT_CAP) break;
      const vin = (v.vin || "").toUpperCase();
      if (!vin) continue;
      scanned++;
      const kind = String(v.condition || "").toLowerCase() === "new" ? "mco" : "title";
      const have = haveByVin.get(vin) || new Set();
      if (have.has(`${kind}_front`) && have.has(`${kind}_back`)) continue; // complete
      const last = lastSent.get(vin);
      if (last && last > cutoff) continue; // reminded recently
      try {
        await fetch(`${SUPABASE_URL}/functions/v1/email-title-request`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
          body: JSON.stringify({ tenant_id: prof.tenant_id, vin }),
        });
        tenantEmailed++; emailed++;
      } catch { /* skip */ }
    }
  }

  return json(200, { ok: true, scanned, emailed });
});
