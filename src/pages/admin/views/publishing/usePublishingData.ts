import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useDealerSettings, type DealerSettings } from "@/contexts/DealerSettingsContext";
import { useAdminNow, useViewFixture } from "@/lib/admin/dataSource";
import { knownCount, type CountValue } from "@/lib/admin/health";
import {
  publishingDraftFrom,
  publishingPolicyVersion,
  type DescriptionPolicy,
  type ListingCounts,
  type PublishingDraftSource,
  type PublishingSettingsSlice,
  type VehicleClass,
} from "@/lib/admin/publishingPolicy";

// Data for the Publishing views. Fixture first, live second. The live reads
// are tenant-scoped SELECTs and head counts; nothing here writes.

export interface PublishingFixture {
  rooftopLabel: string;
  settings: PublishingSettingsSlice;
  description: DescriptionPolicy | null;
  counts: ListingCounts | null;
  selectedClass: VehicleClass;
  draftPending: boolean;
  policyVersion: string | number | null;
}

export const PUBLISHING_VIEW_ID = "effective-policy";

type Db = { from: (table: string) => any };
const db = () => supabase as unknown as Db;

const CLASS_CONDITIONS: Record<VehicleClass, string[]> = { new: ["new"], used: ["used"], cpo: ["cpo", "certified"] };

export const publishingSlice = (settings: DealerSettings): PublishingSettingsSlice => ({
  ingest_auto_publish: settings.ingest_auto_publish,
  require_safety_inspection: settings.require_safety_inspection,
  require_k208_licensee_certification: settings.require_k208_licensee_certification,
  require_install_verification: settings.require_install_verification,
  k208_authority_roles: settings.k208_authority_roles,
  feature_price_verification: settings.feature_price_verification,
  document_rules: settings.document_rules,
});

const headCount = async (run: () => PromiseLike<{ count: number | null; error: unknown }>): Promise<CountValue> => {
  try {
    const { count, error } = await run();
    if (error || count === null || count === undefined) return { kind: "failed" };
    return knownCount(count);
  } catch {
    return { kind: "failed" };
  }
};

export interface PublishingLive {
  description: DescriptionPolicy | null;
  counts: ListingCounts;
  loadFailed: boolean;
}

export async function loadPublishingLive(tenantId: string): Promise<PublishingLive> {
  let description: DescriptionPolicy | null = null;
  let loadFailed = false;
  try {
    const { data, error } = await db().from("description_settings").select("review_mode, review_mode_by_class, internal_publication_enabled").eq("tenant_id", tenantId).maybeSingle();
    if (error) loadFailed = true;
    else if (data) {
      const row = data as { review_mode: string | null; review_mode_by_class: Record<string, string> | null; internal_publication_enabled: boolean | null };
      description = { reviewMode: row.review_mode ?? null, reviewModeByClass: row.review_mode_by_class ?? null, internalPublicationEnabled: row.internal_publication_enabled ?? null };
    } else {
      description = { reviewMode: null, reviewModeByClass: null, internalPublicationEnabled: null };
    }
  } catch {
    loadFailed = true;
  }

  const classes: VehicleClass[] = ["new", "used", "cpo"];
  const active = await Promise.all(classes.map((c) => headCount(() => db().from("vehicle_listings").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).is("archived_at", null).in("condition", CLASS_CONDITIONS[c]))));
  const published = await Promise.all(classes.map((c) => headCount(() => db().from("vehicle_listings").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).is("archived_at", null).eq("status", "published").in("condition", CLASS_CONDITIONS[c]))));
  const counts: ListingCounts = {
    activeByClass: { new: active[0], used: active[1], cpo: active[2] },
    publishedByClass: { new: published[0], used: published[1], cpo: published[2] },
  };
  if ([...active, ...published].some((c) => c.kind === "failed")) loadFailed = true;

  return { description, counts, loadFailed };
}

export interface StoredPublishingPolicy {
  version: string;
  settings: PublishingDraftSource;
}

/** Re-reads the stored settings so Apply can refuse a review that is no longer current and merge into the current rules, not a stale copy. */
export async function readStoredPublishingPolicy(tenantId: string): Promise<StoredPublishingPolicy | null> {
  try {
    const { data, error } = await db().from("dealer_profiles").select("settings").eq("tenant_id", tenantId).maybeSingle();
    if (error) return null;
    const raw = ((data as { settings?: unknown } | null)?.settings ?? {}) as PublishingDraftSource;
    return { version: publishingPolicyVersion(publishingDraftFrom(raw)), settings: raw };
  } catch {
    return null;
  }
}

export function usePublishingData() {
  const fixture = useViewFixture<PublishingFixture>(PUBLISHING_VIEW_ID);
  const now = useAdminNow();
  const { tenant } = useTenant();
  const { settings, loading: settingsLoading } = useDealerSettings();
  const tenantId = tenant?.id ?? null;

  const live = useQuery({
    queryKey: ["admin-v2", "publishing", tenantId],
    enabled: !fixture && !!tenantId,
    queryFn: () => loadPublishingLive(tenantId as string),
    staleTime: 30_000,
  });

  const settingsSlice = useMemo<PublishingSettingsSlice>(() => fixture?.settings ?? publishingSlice(settings), [fixture, settings]);
  const policyVersion = useMemo(() => (fixture ? fixture.policyVersion : publishingPolicyVersion(publishingDraftFrom(settingsSlice))), [fixture, settingsSlice]);

  const place = [settings.dealer_city, settings.dealer_state].filter(Boolean).join(", ");
  const name = settings.dealer_name || tenant?.name || "this rooftop";
  const rooftopLabel = fixture?.rooftopLabel ?? (place ? `${name} (${place})` : name);

  return {
    fixture,
    now,
    tenantId,
    settingsSlice,
    rooftopLabel,
    policyVersion,
    loading: !fixture && (settingsLoading || live.isLoading),
    loadFailed: !fixture && (live.isError || !!live.data?.loadFailed),
    description: fixture ? fixture.description : live.data ? live.data.description : undefined,
    counts: fixture ? fixture.counts : live.data ? live.data.counts : undefined,
    refetch: live.refetch,
  };
}
