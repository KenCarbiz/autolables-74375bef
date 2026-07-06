// ──────────────────────────────────────────────────────────────────────
// passport-lead-escalation — SLA sweep for routed Customer Passport leads.
//
// Run on a schedule (Supabase cron, e.g. every 5 minutes) or invoke
// manually. For every tenant with escalation enabled, finds routed leads
// still unanswered (status 'new', first_response_at null) past the SLA
// windows and escalates:
//   level 1 → BDC inbox   (escalateToBdcAfterMinutes)
//   level 2 → sales manager (escalateToManagerAfterMinutes)
// Each escalation emails the next tier, bumps escalation_level, stamps
// escalated_at, and writes an audit_log row. Idempotent per level.
// ──────────────────────────────────────────────────────────────────────
import { json, preflight } from "../_shared/http.ts";
import { adminClient, SERVICE_KEY, isServiceOrCron } from "../_shared/supabase.ts";
import { normalizeContactRouting } from "../_shared/passport-routing.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";

const esc = (s: unknown) =>
  String(s ?? "").slice(0, 200).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  // Cross-tenant SLA sweep sends escalation emails — gate to service role / cron secret
  // so an anon caller can't force premature escalations or drain the email budget.
  if (!isServiceOrCron(req)) return json(401, { error: "unauthorized" });
  try {
    const admin = adminClient();
    // Tenants that have any routing config saved.
    const { data: profiles } = await admin
      .from("dealer_profiles")
      .select("tenant_id, settings")
      .not("settings->passport_contact_routing", "is", null)
      .limit(500);

    let escalated = 0;
    for (const prof of profiles || []) {
      const s = (prof.settings ?? {}) as Record<string, unknown>;
      const routing = normalizeContactRouting(s.passport_contact_routing);
      const rules = routing.escalationRules;
      if (!rules.enabled) continue;

      const bdcEmail = routing.bdcSettings?.bdcEmail || "";
      const mgrEmail = routing.managerFallback?.managerEmail || "";
      const tiers: { level: number; afterMin: number | undefined; to: string; label: string }[] = [
        { level: 1, afterMin: rules.escalateToBdcAfterMinutes ?? rules.firstResponseSlaMinutes, to: bdcEmail, label: "BDC" },
        { level: 2, afterMin: rules.escalateToManagerAfterMinutes, to: mgrEmail, label: "Sales Manager" },
      ].filter((t) => t.afterMin != null && t.afterMin > 0 && t.to.includes("@"));
      if (tiers.length === 0) continue;

      // Stores under this tenant come from the listing rows the leads point at;
      // leads carry store_id directly, so sweep by the tenant's stores.
      const { data: stores } = await admin
        .from("vehicle_listings").select("store_id").eq("tenant_id", prof.tenant_id).limit(1);
      const storeId = stores?.[0]?.store_id;
      if (!storeId) continue;

      for (const tier of tiers) {
        const cutoff = new Date(Date.now() - (tier.afterMin as number) * 60_000).toISOString();
        const { data: overdue } = await admin
          .from("leads")
          .select("id, name, phone, email, vehicle_interest, vehicle_vin, created_at, escalation_level")
          .eq("store_id", storeId)
          .eq("status", "new")
          .is("first_response_at", null)
          .not("routing", "is", null)
          .lt("created_at", cutoff)
          .lt("escalation_level", tier.level)
          .order("created_at", { ascending: true })
          .limit(20);

        for (const lead of overdue || []) {
          const ageMin = Math.round((Date.now() - new Date(lead.created_at as string).getTime()) / 60_000);
          const html = `
            <div style="font-family:Inter,Arial,sans-serif;max-width:520px;margin:0 auto;color:#0F172A">
              <p style="font-size:13px;font-weight:700;color:#DC2626;margin:0 0 6px;text-transform:uppercase;letter-spacing:.04em">Unanswered lead — ${ageMin} min</p>
              <h2 style="font-size:20px;margin:0 0 2px">${esc(lead.name)}</h2>
              <p style="font-size:14px;margin:2px 0 10px">${[lead.phone ? `<a href="tel:${esc(lead.phone)}">${esc(lead.phone)}</a>` : "", esc(lead.email)].filter(Boolean).join(" &middot; ")}</p>
              <p style="font-size:15px;margin:0 0 2px">${esc(lead.vehicle_interest)}</p>
              <p style="font-size:13px;color:#475569;margin:0 0 16px">VIN ${esc(lead.vehicle_vin)}</p>
              <p style="font-size:13px;color:#475569;margin:0">This passport lead has not been responded to within the store's SLA and was escalated to you (${esc(tier.label)}).</p>
            </div>`;
          await fetch(`${supabaseUrl}/functions/v1/send-email`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_KEY}` },
            body: JSON.stringify({ to: [tier.to], subject: `Escalated lead (${ageMin} min unanswered): ${lead.name}`, html }),
          }).catch(() => {});
          await admin.from("leads").update({ escalation_level: tier.level, escalated_at: new Date().toISOString() }).eq("id", lead.id);
          await admin.from("audit_log").insert({
            action: "customer_passport_escalated", entity_type: "lead", entity_id: lead.id,
            store_id: storeId, details: { level: tier.level, to: tier.label, unanswered_minutes: ageMin },
          });
          escalated++;
        }
      }
    }
    return json(200, { ok: true, escalated });
  } catch (err) {
    return json(200, { ok: false, error: String((err as Error)?.message || err) });
  }
});
