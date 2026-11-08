import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { DEFAULT_SETTINGS, useDealerSettings, type DealerSettings } from "@/contexts/DealerSettingsContext";
import { useAdminNow, useViewFixture } from "@/lib/admin/dataSource";
import { realTenantId } from "@/lib/tenant/realTenantId";
import { buildAttentionQueue, type AttentionItem } from "@/lib/admin/attention";
import { activityLabel, activityTone, actorLabel, entityKindLabel } from "@/lib/admin/integrations/activity";
import { deriveFeedHealth, knownCount, type CountValue, type HealthVerdict } from "@/lib/admin/health";
import { deriveRoutingReadiness } from "@/lib/admin/effectivePolicy";
import type { DescriptionPolicy } from "@/lib/admin/publishingPolicy";
import { publishingSlice } from "../publishing/usePublishingData";
import { useWaveEVariant, type WaveEVariant } from "../waveEVariant";
import { ADMIN_EVENT_EXCLUDE, FAILED_EXCEPTIONS, setupItems, setupProgress, summarizeExceptions, type ExceptionRow, type ExceptionStats, type SetupItem, type SetupProgress } from "./overviewModel";

export interface ActivityEvent {
  id: string;
  action: string;
  kind: string;
  actor: string;
  at: string;
  tone: "warning" | "success" | "neutral";
}

export interface OverviewData {
  feed: HealthVerdict | null;
  lastSuccessAt: string | null;
  activeInventory: CountValue;
  policyReviews: CountValue;
  exceptions: ExceptionStats;
  priceMissing: CountValue;
  priceMismatched: CountValue;
  descriptionsBlocked: CountValue;
  description: DescriptionPolicy | null;
  activity: ActivityEvent[] | null;
  activityAll?: ActivityEvent[] | null;
  checkedAt: string;
}

export interface OverviewFixture {
  data: OverviewData;
  settings: DealerSettings;
  rooftopLabel: string;
  groupLabel: string | null;
  visibleCategoryIds: string[] | null;
  seeds: Partial<Record<WaveEVariant, Partial<Omit<OverviewFixture, "seeds">>>>;
}

const FAILED: CountValue = { kind: "failed" };

export const FAILED_OVERVIEW = (checkedAt: string): OverviewData => ({
  feed: null,
  lastSuccessAt: null,
  activeInventory: FAILED,
  policyReviews: FAILED,
  exceptions: FAILED_EXCEPTIONS,
  priceMissing: FAILED,
  priceMismatched: FAILED,
  descriptionsBlocked: FAILED,
  description: null,
  activity: null,
  checkedAt,
});

const countOf = async (q: PromiseLike<{ count: number | null; error: unknown }>): Promise<CountValue> => {
  try {
    const { count, error } = await q;
    if (error || count === null || count === undefined) return FAILED;
    return knownCount(count);
  } catch {
    return FAILED;
  }
};

type AuditLike = { id: string; action: string; entity_type: string | null; user_id: string | null; user_email: string | null; created_at: string };

export const toActivityEvent = (r: AuditLike): ActivityEvent => {
  const tone = activityTone(r.action);
  return {
    id: r.id,
    action: activityLabel(r.action),
    kind: entityKindLabel(r.entity_type),
    actor: actorLabel(r),
    at: r.created_at,
    tone: tone === "warning" || tone === "success" ? tone : "neutral",
  };
};

const AUDIT_COLUMNS = "id, action, entity_type, user_id, user_email, created_at";

export async function loadAdminEvents(tenantId: string, limit: number): Promise<ActivityEvent[] | null> {
  try {
    const db = supabase as unknown as { from: (t: string) => any };
    const { data, error } = await db.from("audit_log").select(AUDIT_COLUMNS).eq("store_id", tenantId).not("action", "ilike", ADMIN_EVENT_EXCLUDE).order("created_at", { ascending: false }).limit(limit);
    if (error) return null;
    return ((data as AuditLike[]) ?? []).map(toActivityEvent);
  } catch {
    return null;
  }
}

async function loadOverview(tenantId: string, now: number): Promise<OverviewData> {
  const db = supabase as unknown as { from: (t: string) => any };
  const [cfgRes, latestRes, realRes, successRes] = await Promise.all([
    db.from("marketcheck_sync_config").select("enabled, source, frequency").eq("tenant_id", tenantId).maybeSingle(),
    db.from("inventory_sync_runs").select("status, http_status, error_summary, started_at").eq("tenant_id", tenantId).order("started_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("inventory_sync_runs").select("status, http_status, error_summary, started_at").eq("tenant_id", tenantId).neq("status", "skipped").order("started_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("inventory_sync_runs").select("started_at").eq("tenant_id", tenantId).in("status", ["success", "partial"]).order("started_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const loadFailed = !!(cfgRes.error || latestRes.error || realRes.error || successRes.error);
  const cfg = cfgRes.data as { enabled: boolean; source: string | null; frequency: string | null } | null;
  const cadence = cfg?.frequency === "weekly" ? 24 * 7 : cfg?.frequency === "biweekly" ? 24 * 14 : cfg?.frequency === "monthly" ? 24 * 30 : 24;
  const lastSuccessAt = (successRes.data as { started_at: string } | null)?.started_at ?? null;
  const feed = deriveFeedHealth({
    configured: cfg ? !!cfg.source : loadFailed ? null : !!realRes.data,
    enabled: cfg ? cfg.enabled : null,
    latestRun: latestRes.data ?? null,
    latestRealRun: realRes.data ?? null,
    lastSuccessAt,
    cadenceHours: cadence,
    now,
    loadFailed,
  });

  const listings = () => db.from("vehicle_listings").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).is("archived_at", null);
  const exceptionsQuery = async (): Promise<ExceptionStats> => {
    try {
      const { data, count, error } = await db
        .from("vehicle_exceptions")
        .select("id, vehicle_listing_id, vin, severity, exception_type, title", { count: "exact" })
        .eq("tenant_id", tenantId)
        .in("status", ["open", "in_progress"])
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error || count === null || count === undefined) return FAILED_EXCEPTIONS;
      const rows: ExceptionRow[] = ((data as Array<{ id: string; vehicle_listing_id: string | null; vin: string; severity: string; exception_type: string; title: string }>) ?? []).map((r) => ({
        id: r.id,
        vehicleKey: r.vehicle_listing_id ?? r.vin,
        vin: r.vin,
        severity: r.severity,
        type: r.exception_type,
        title: r.title,
      }));
      return summarizeExceptions(rows, count);
    } catch {
      return FAILED_EXCEPTIONS;
    }
  };
  const descriptionQuery = async (): Promise<DescriptionPolicy | null> => {
    try {
      const { data, error } = await db.from("description_settings").select("review_mode, review_mode_by_class, internal_publication_enabled").eq("tenant_id", tenantId).maybeSingle();
      if (error) return null;
      const row = data as { review_mode: string | null; review_mode_by_class: Record<string, string> | null; internal_publication_enabled: boolean | null } | null;
      return { reviewMode: row?.review_mode ?? null, reviewModeByClass: row?.review_mode_by_class ?? null, internalPublicationEnabled: row?.internal_publication_enabled ?? null };
    } catch {
      return null;
    }
  };

  const [activeInventory, exceptions, priceMissing, priceMismatched, descriptionsBlocked, policyReviews, description, activity] = await Promise.all([
    countOf(listings()),
    exceptionsQuery(),
    countOf(listings().is("advertised_price_before_doc", null).not("price", "is", null)),
    countOf(listings().eq("price_parse_status", "warning")),
    countOf(db.from("description_jobs").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("status", "failed")),
    countOf(db.from("stale_document_flags").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("status", "open")),
    descriptionQuery(),
    loadAdminEvents(tenantId, 5),
  ]);

  return { feed, lastSuccessAt, activeInventory, policyReviews, exceptions, priceMissing, priceMismatched, descriptionsBlocked, description, activity, checkedAt: new Date(now).toISOString() };
}

export interface OverviewState {
  fixture: boolean;
  variant: WaveEVariant;
  loading: boolean;
  failed: boolean;
  data: OverviewData | null;
  settings: DealerSettings;
  rooftopLabel: string;
  groupLabel: string | null;
  tenantId: string | null;
  visibleCategoryIds: string[] | null;
  setup: SetupItem[];
  progress: SetupProgress;
  attention: AttentionItem[];
  now: number;
}

export function useOverviewData(): OverviewState {
  const fx = useViewFixture<OverviewFixture>("overview");
  const variant = useWaveEVariant(!!fx);
  const now = useAdminNow();
  const { tenant } = useTenant();
  const { settings: liveSettings } = useDealerSettings();
  const tenantId = realTenantId(tenant);

  const live = useQuery({
    queryKey: ["admin-v3", "overview", tenantId],
    enabled: !fx && !!tenantId,
    queryFn: () => loadOverview(tenantId as string, now),
    staleTime: 30_000,
  });

  const seeded = useMemo(() => (fx ? { ...fx, ...(fx.seeds[variant] ?? {}) } : null), [fx, variant]);
  const settings = seeded?.settings ?? liveSettings ?? DEFAULT_SETTINGS;
  const data = seeded ? seeded.data : live.data ?? null;
  const failed = seeded ? variant === "error" : live.isError;
  const loading = !seeded && (live.isLoading || !tenantId);

  const place = [settings.dealer_city, settings.dealer_state].filter(Boolean).join(", ");
  const name = settings.dealer_name && settings.dealer_name !== "Your Dealership" ? settings.dealer_name : tenant?.name || "this rooftop";
  const rooftopLabel = seeded?.rooftopLabel ?? (place ? `${name} (${place})` : name);
  const groupLabel = seeded ? seeded.groupLabel : tenant?.name && tenant.id !== "house" && tenant.name !== name ? tenant.name : null;

  const setup = useMemo(() => setupItems(settings), [settings]);
  const progress = useMemo(() => setupProgress(setup), [setup]);
  const routing = useMemo(() => deriveRoutingReadiness(settings.passport_contact_routing, settings.passport_agents), [settings.passport_contact_routing, settings.passport_agents]);

  const attention = useMemo<AttentionItem[]>(() => {
    if (!data) return [];
    return buildAttentionQueue({
      feed: data.feed,
      priceEvidence: { missing: data.priceMissing, mismatched: data.priceMismatched },
      descriptions: { blocked: data.descriptionsBlocked },
      routing,
      recall: null,
      publishing: null,
      documents: null,
      exceptions: { instances: data.exceptions.instances, vehicles: data.exceptions.vehicles },
    });
  }, [data, routing]);

  return { fixture: !!seeded, variant, loading, failed, data, settings, rooftopLabel, groupLabel, tenantId, visibleCategoryIds: seeded?.visibleCategoryIds ?? null, setup, progress, attention, now };
}

export { publishingSlice };
