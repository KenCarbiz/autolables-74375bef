// ──────────────────────────────────────────────────────────────────────
// passport-lead-escalation — SLA sweep for routed Customer Passport leads.
//
// Runs on a schedule (pg_cron, every 5 minutes) or by manual invocation.
// For every tenant with escalation enabled it finds routed leads still
// unanswered past each tier's window and notifies the tier's destination:
//   level 1 → BDC desk       (escalateToBdcAfterMinutes)
//   level 2 → sales manager  (escalateToManagerAfterMinutes)
// The rules live in _shared/escalation.ts. A lead advances a level only when
// the sender accepts the request; a refusal or a network failure is recorded
// and the lead stays eligible for the next sweep. Every store of a tenant is
// covered because leads are read by tenant, in pages, up to a per-run cap.
// ──────────────────────────────────────────────────────────────────────
import { json, preflight } from "../_shared/http.ts";
import { adminClient, SERVICE_KEY, isServiceOrCron } from "../_shared/supabase.ts";
import { normalizeContactRouting } from "../_shared/passport-routing.ts";
import {
  AUDIT_ACTION_ESCALATED,
  AUDIT_ACTION_ESCALATION_FAILED,
  LEAD_PAGE_SIZE,
  MAX_LEADS_PER_TENANT_PER_RUN,
  PROFILE_PAGE_SIZE,
  auditDetails,
  buildTierPlan,
  classifySendResponse,
  cutoffIso,
  escalationHtml,
  escalationSubject,
  readyTiers,
  shouldAdvance,
  unansweredMinutes,
  unseenIds,
  type EscalationTier,
} from "../_shared/escalation.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";

interface LeadRow {
  id: string;
  store_id: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  vehicle_interest: string | null;
  vehicle_vin: string | null;
  created_at: string;
  escalation_level: number | null;
}

interface Summary {
  tenants: number;
  escalated: number;
  failed: number;
  skipped_no_method: number;
  skipped_no_tier: number;
}

const sendEmail = async (to: string, subject: string, html: string): Promise<{ ok: boolean; status: number } | null> => {
  try {
    const res = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ to: [to], subject, html }),
    });
    return { ok: res.ok, status: res.status };
  } catch {
    return null;
  }
};

async function sweepTier(
  admin: ReturnType<typeof adminClient>,
  tenantId: string,
  tier: EscalationTier,
  nowMs: number,
  summary: Summary,
): Promise<void> {
  const cutoff = cutoffIso(tier.afterMinutes, nowMs);
  const seen = new Set<string>();
  let handled = 0;
  while (handled < MAX_LEADS_PER_TENANT_PER_RUN) {
    const { data, error } = await admin
      .from("leads")
      .select("id, store_id, name, phone, email, vehicle_interest, vehicle_vin, created_at, escalation_level")
      .eq("tenant_id", tenantId)
      .eq("status", "new")
      .is("first_response_at", null)
      .not("routing", "is", null)
      .lt("created_at", cutoff)
      .or(`escalation_level.is.null,escalation_level.lt.${tier.level}`)
      .order("created_at", { ascending: true })
      .range(0, LEAD_PAGE_SIZE - 1);
    if (error) return;
    const page = (data ?? []) as LeadRow[];
    const fresh = unseenIds(page.map((l) => l.id), seen);
    if (fresh.length === 0) return;

    for (const lead of page) {
      if (seen.has(lead.id) || handled >= MAX_LEADS_PER_TENANT_PER_RUN) continue;
      seen.add(lead.id);
      handled += 1;
      const minutes = unansweredMinutes(lead.created_at, nowMs);
      const res = await sendEmail(tier.to as string, escalationSubject(lead, minutes), escalationHtml(lead, tier, minutes));
      const outcome = classifySendResponse(res);
      const details = auditDetails({
        level: tier.level,
        label: tier.label,
        unansweredMinutes: minutes,
        outcome,
        method: "email",
        httpStatus: res?.status ?? null,
        storeId: lead.store_id,
      });
      if (shouldAdvance(outcome)) {
        await admin.from("leads").update({ escalation_level: tier.level, escalated_at: new Date(nowMs).toISOString() }).eq("id", lead.id);
        await admin.from("audit_log").insert({ action: AUDIT_ACTION_ESCALATED, entity_type: "lead", entity_id: lead.id, store_id: tenantId, details });
        summary.escalated += 1;
      } else {
        await admin.from("audit_log").insert({ action: AUDIT_ACTION_ESCALATION_FAILED, entity_type: "lead", entity_id: lead.id, store_id: tenantId, details });
        summary.failed += 1;
      }
    }
  }
}

Deno.serve(async (req) => {
  const pf = preflight(req); if (pf) return pf;
  // Cross-tenant sweep that sends mail: service role or the shared cron secret only.
  if (!isServiceOrCron(req)) return json(401, { error: "unauthorized" });
  const summary: Summary = { tenants: 0, escalated: 0, failed: 0, skipped_no_method: 0, skipped_no_tier: 0 };
  try {
    const admin = adminClient();
    const nowMs = Date.now();
    for (let from = 0; ; from += PROFILE_PAGE_SIZE) {
      const { data: profiles, error } = await admin
        .from("dealer_profiles")
        .select("tenant_id, settings")
        .not("settings->passport_contact_routing", "is", null)
        .order("tenant_id", { ascending: true })
        .range(from, from + PROFILE_PAGE_SIZE - 1);
      if (error) break;
      const rows = profiles ?? [];
      for (const prof of rows) {
        const s = (prof.settings ?? {}) as Record<string, unknown>;
        const routing = normalizeContactRouting(s.passport_contact_routing);
        const plan = buildTierPlan(routing);
        if (!plan.enabled) continue;
        summary.tenants += 1;
        if (!plan.methods.includes("email")) { summary.skipped_no_method += 1; continue; }
        const tiers = readyTiers(plan);
        if (tiers.length === 0) { summary.skipped_no_tier += 1; continue; }
        for (const tier of tiers) await sweepTier(admin, prof.tenant_id as string, tier, nowMs, summary);
      }
      if (rows.length < PROFILE_PAGE_SIZE) break;
    }
    return json(200, { ok: true, ...summary });
  } catch (err) {
    return json(200, { ok: false, error: String((err as Error)?.message || err), ...summary });
  }
});
