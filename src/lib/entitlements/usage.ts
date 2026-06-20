import { supabase } from "@/integrations/supabase/client";
import type { PlanTier } from "./features";

// ──────────────────────────────────────────────────────────────────────
// AutoLabels usage metering + quota interpretation. Records metered actions to
// autolabels_usage_events and interprets monthly limits by plan tier. Limits
// live in code (not billing-authoritative); Autocurb owns subscription truth.
// Best-effort: recording never blocks the action it meters.
// ──────────────────────────────────────────────────────────────────────

export type MetricKey =
  | "stickers_generated" | "documents_printed" | "documents_published"
  | "qr_scans" | "batch_jobs" | "batch_vehicles" | "evidence_exports"
  | "packets_sent" | "packets_signed" | "template_customizations";

export interface Limit { soft: number; hard: number } // -1 = unlimited

// Monthly limits per plan tier. Generous on Pro/Compliance so active dealers
// (mapped to Pro) are never blocked in normal use. -1 = unlimited.
export const USAGE_LIMITS: Record<PlanTier, Partial<Record<MetricKey, Limit>>> = {
  none: { stickers_generated: { soft: 0, hard: 0 } },
  starter: {
    stickers_generated: { soft: 150, hard: 200 },
    batch_jobs: { soft: 3, hard: 5 },
    evidence_exports: { soft: 5, hard: 10 },
  },
  pro: {
    stickers_generated: { soft: 1500, hard: 2500 },
    batch_jobs: { soft: 60, hard: 100 },
    evidence_exports: { soft: 100, hard: 200 },
  },
  compliance: {
    stickers_generated: { soft: -1, hard: -1 },
    batch_jobs: { soft: -1, hard: -1 },
    evidence_exports: { soft: -1, hard: -1 },
  },
  platform: {},
};

export function limitFor(plan: PlanTier, metric: MetricKey): Limit | null {
  return USAGE_LIMITS[plan]?.[metric] ?? null;
}

export type QuotaState = "ok" | "near" | "over_soft" | "blocked";

// Interpret a usage count against the plan limit.
export function quotaState(plan: PlanTier, metric: MetricKey, used: number): QuotaState {
  const lim = limitFor(plan, metric);
  if (!lim || lim.hard < 0) return "ok";          // no limit / unlimited
  if (used >= lim.hard) return "blocked";
  if (used >= lim.soft) return "over_soft";
  if (used >= lim.soft * 0.8) return "near";
  return "ok";
}

// deno-lint-ignore no-explicit-any
const sb = () => supabase as any;

export interface RecordUsageArgs {
  tenantId?: string | null;
  featureKey: string;
  metric: MetricKey;
  quantity?: number;
  entityType?: string;
  entityId?: string | null;
  createdBy?: string | null;
  metadata?: Record<string, unknown>;
}

// Append a usage event. Best-effort and silent — metering must never break the
// metered action or surface an error to the user.
export async function recordUsageEvent(args: RecordUsageArgs): Promise<void> {
  if (!args.tenantId) return;
  try {
    await sb().from("autolabels_usage_events").insert({
      tenant_id: args.tenantId,
      feature_key: args.featureKey,
      metric_key: args.metric,
      quantity: args.quantity ?? 1,
      entity_type: args.entityType || null,
      entity_id: args.entityId || null,
      created_by: args.createdBy || null,
      metadata: args.metadata || {},
    });
  } catch { /* metering is non-blocking */ }
}

// Current-calendar-month usage totals per metric for a tenant. Falls back to an
// empty map when the table isn't deployed.
export async function getTenantUsage(tenantId: string): Promise<Record<string, number>> {
  const monthStart = new Date();
  monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  try {
    const { data, error } = await sb()
      .from("autolabels_usage_events")
      .select("metric_key, quantity")
      .eq("tenant_id", tenantId)
      .gte("created_at", monthStart.toISOString());
    if (error || !Array.isArray(data)) return {};
    const totals: Record<string, number> = {};
    for (const r of data) totals[r.metric_key] = (totals[r.metric_key] || 0) + (r.quantity || 1);
    return totals;
  } catch { return {}; }
}
