import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/contexts/TenantContext";
import { DEFAULT_SETTINGS, useDealerSettings, type DealerSettings } from "@/contexts/DealerSettingsContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { useAdminNow, useViewFixture } from "@/lib/admin/dataSource";
import { hasDealerCapability } from "@/lib/permissions/dealerRoleCapabilities";
import { realTenantId } from "@/lib/tenant/realTenantId";
import type { MetricKey } from "@/lib/entitlements/usage";
import { useWaveEVariant, type WaveEVariant } from "../waveEVariant";
import { buildFeatureGroups, buildMetrics, describePlan, factsFromRow, viewerTimeZone, zonedMonthStart, type EntitlementFacts, type FeatureGroup, type MetricModel, type MetricReading, type PlanSummary, type UsageSnapshot, type UsageState } from "./planModel";

export type PlanSettings = Pick<DealerSettings, "passport_contact_routing" | "passport_agents" | "feature_custom_branding" | "dealer_timezone" | "dealer_name" | "dealer_city" | "dealer_state">;

export interface PlanFixture {
  entitlement: EntitlementFacts | null;
  entitlementUnreadable: boolean;
  usage: UsageState;
  settings: PlanSettings;
  rooftopLabel: string;
  groupLabel: string | null;
  canManageBilling: boolean;
  canManageInvoices?: boolean;
  isPlatformAdmin: boolean;
  seeds: Partial<Record<WaveEVariant, Partial<Omit<PlanFixture, "seeds">>>>;
}

const PAGE = 1000;
const MAX_PAGES = 10;

export async function loadUsage(tenantId: string, now: number, timeZone: string): Promise<UsageSnapshot> {
  const { start, end, label } = zonedMonthStart(now, timeZone);
  const db = supabase as unknown as { from: (t: string) => any };
  const metrics: Partial<Record<MetricKey, MetricReading>> = {};
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const { data, error } = await db
      .from("autolabels_usage_events")
      .select("metric_key, quantity, created_at")
      .eq("tenant_id", tenantId)
      .gte("created_at", start.toISOString())
      .lt("created_at", end.toISOString())
      .order("created_at", { ascending: false })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw new Error("usage events unreadable");
    const rows = (data as Array<{ metric_key: string; quantity: number | null; created_at: string }>) ?? [];
    for (const r of rows) {
      const key = r.metric_key as MetricKey;
      const cur = metrics[key] ?? { value: 0, events: 0, lastEventAt: null };
      cur.value += r.quantity ?? 1;
      cur.events += 1;
      if (!cur.lastEventAt || r.created_at > cur.lastEventAt) cur.lastEventAt = r.created_at;
      metrics[key] = cur;
    }
    if (rows.length < PAGE) return { monthLabel: label, timeZone, scope: "All rooftops in this account", updatedAt: new Date(now).toISOString(), metrics };
  }
  throw new Error("too many usage events to total here");
}

export interface PlanState {
  fixture: boolean;
  variant: WaveEVariant;
  loading: boolean;
  entitlementUnreadable: boolean;
  plan: PlanSummary;
  usage: UsageState;
  metrics: MetricModel[];
  features: FeatureGroup[];
  rooftopLabel: string;
  groupLabel: string | null;
  canManageBilling: boolean;
  canManageInvoices: boolean;
  timeZone: string;
  now: number;
  retryUsage: () => void;
}

export function usePlanData(): PlanState {
  const fx = useViewFixture<PlanFixture>("plan-usage");
  const variant = useWaveEVariant(!!fx);
  const now = useAdminNow();
  const { tenant } = useTenant();
  const { isAdmin } = useAuth();
  const { entitlementFor, member, loading: entLoading, error: entError } = useEntitlements();
  const { settings: liveSettings } = useDealerSettings();
  const tenantId = realTenantId(tenant);

  const seeded = useMemo(() => (fx ? { ...fx, ...(fx.seeds[variant] ?? {}) } : null), [fx, variant]);
  const settings: PlanSettings = seeded?.settings ?? liveSettings ?? DEFAULT_SETTINGS;
  const timeZone = viewerTimeZone(settings.dealer_timezone);

  const usageQ = useQuery({
    queryKey: ["admin-v3", "plan-usage", tenantId, timeZone, new Date(now).toISOString().slice(0, 7)],
    enabled: !seeded && !!tenantId,
    staleTime: 60_000,
    retry: false,
    queryFn: () => loadUsage(tenantId as string, now, timeZone),
  });

  const entitlement = seeded ? seeded.entitlement : factsFromRow(entitlementFor("autolabels"));
  const unreadable = seeded ? seeded.entitlementUnreadable : !!entError && !entitlement;
  const loading = !seeded && entLoading;
  const plan = useMemo(() => describePlan(entitlement, now, settings.dealer_timezone || null), [entitlement, now, settings.dealer_timezone]);

  const usage: UsageState = seeded
    ? seeded.usage
    : usageQ.isError
      ? { kind: "failed", reason: "Usage could not be read, so no count is shown. That is not the same as zero." }
      : usageQ.data
        ? { kind: "ready", snapshot: { ...usageQ.data, updatedAt: new Date(usageQ.dataUpdatedAt || now).toISOString() } }
        : { kind: "loading" };

  const isPlatformAdmin = seeded ? seeded.isPlatformAdmin : isAdmin;
  const canManageBilling = seeded ? seeded.canManageBilling : hasDealerCapability(member?.role, "can_manage_billing", isAdmin);
  const canManageInvoices = seeded ? seeded.canManageInvoices ?? seeded.canManageBilling : hasDealerCapability(member?.role, "can_manage_invoices", isAdmin);
  const metrics = useMemo(() => buildMetrics(usage, plan.tier), [usage, plan.tier]);
  const features = useMemo(() => buildFeatureGroups({ tier: plan.tier, accessActive: plan.accessActive, isPlatformAdmin, settings }), [plan.tier, plan.accessActive, isPlatformAdmin, settings]);

  const place = [settings.dealer_city, settings.dealer_state].filter(Boolean).join(", ");
  const name = settings.dealer_name && settings.dealer_name !== "Your Dealership" ? settings.dealer_name : tenant?.name || "this account";
  const rooftopLabel = seeded?.rooftopLabel ?? (place ? `${name} (${place})` : name);
  const groupLabel = seeded ? seeded.groupLabel : tenant?.name && tenant.id !== "house" && tenant.name !== name ? tenant.name : null;

  return { fixture: !!seeded, variant, loading, entitlementUnreadable: unreadable, plan, usage, metrics, features, rooftopLabel, groupLabel, canManageBilling, canManageInvoices, timeZone, now, retryUsage: () => void usageQ.refetch() };
}
