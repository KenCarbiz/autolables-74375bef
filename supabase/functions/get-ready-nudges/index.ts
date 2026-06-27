import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// ──────────────────────────────────────────────────────────────
// get-ready-nudges — daily digest that chases unfinished safety inspections.
//
// For every dealer who turned on require_safety_inspection, emails the service/
// manager/admin members a list of used cars (in inventory > 12h) with no signed
// K-208, each with a one-tap Get-Ready link. Throttled to once/day per tenant.
// Cron-triggered; auth = service-role bearer or x-cron-secret.
// ──────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CRON_SECRET = Deno.env.get("MARKETCHECK_CRON_SECRET") || "";
const APP_URL = Deno.env.get("APP_PUBLIC_URL") || "https://autolabels.io";

const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const esc = (s: string) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  const auth = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const secret = req.headers.get("x-cron-secret") || "";
  if (!(SERVICE_KEY && auth === SERVICE_KEY) && !(CRON_SECRET && secret === CRON_SECRET)) {
    return json(401, { error: "unauthorized" });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  // Opted-in tenants only.
  const { data: profs } = await admin.from("dealer_profiles").select("tenant_id, settings");
  // deno-lint-ignore no-explicit-any
  const tenants = ((profs as any[]) || []).filter((p) => p?.settings?.require_safety_inspection === true).map((p) => p.tenant_id);

  let sent = 0, skipped = 0;
  for (const tenantId of tenants) {
    try {
      // Throttle: one digest per tenant per ~20h.
      const { data: last } = await admin.from("get_ready_nudge_log")
        .select("sent_at").eq("tenant_id", tenantId).order("sent_at", { ascending: false }).limit(1).maybeSingle();
      if (last && Date.now() - new Date(last.sent_at as string).getTime() < 20 * 3600 * 1000) { skipped++; continue; }

      const { data: payload } = await admin.rpc("get_ready_nudge_payload", { p_tenant_id: tenantId });
      const recipients: string[] = (payload as { recipients?: string[] })?.recipients || [];
      // deno-lint-ignore no-explicit-any
      const stuck: any[] = (payload as { stuck?: any[] })?.stuck || [];
      if (!recipients.length || !stuck.length) { skipped++; continue; }

      const rows = stuck.map((c) => {
        const link = c.ready_token ? `${APP_URL}/ready/${c.ready_token}` : `${APP_URL}/service`;
        return `<tr><td style="padding:6px 10px;border-bottom:1px solid #eee">${esc(c.ymm || "Vehicle")}<br><span style="font:11px monospace;color:#777">${esc(c.vin)}</span></td><td style="padding:6px 10px;border-bottom:1px solid #eee"><a href="${link}" style="color:#0f172a;font-weight:600">Open Get-Ready →</a></td></tr>`;
      }).join("");
      const html = `
        <p><strong>${stuck.length}</strong> used vehicle${stuck.length === 1 ? "" : "s"} still need a signed CT K-208 safety inspection before the deal can be finalized.</p>
        <table style="border-collapse:collapse;width:100%;max-width:560px">${rows}</table>
        <p style="font-size:12px;color:#777">Scan the windshield QR or tap a link above to complete the inspection. This is a daily reminder until each one is signed.</p>`;

      for (const to of recipients) {
        await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
          body: JSON.stringify({ to, subject: `${stuck.length} vehicle${stuck.length === 1 ? "" : "s"} need a safety inspection`, html }),
        }).catch(() => { /* best-effort per recipient */ });
      }
      await admin.from("get_ready_nudge_log").insert({ tenant_id: tenantId, stuck_count: stuck.length, recipient_count: recipients.length });
      sent++;
    } catch { /* per-tenant best-effort */ }
  }

  return json(200, { ok: true, tenants: tenants.length, sent, skipped });
});
