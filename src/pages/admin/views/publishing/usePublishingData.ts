import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useDealerSettings, type DealerSettings } from "@/contexts/DealerSettingsContext";
import { useAdminNow, useViewFixture } from "@/lib/admin/dataSource";
import { realTenantId } from "@/lib/tenant/realTenantId";
import { PUBLISHING_AUDIT_ACTION } from "@/lib/admin/publishingPolicy";
import { useWaveCVariant, type WaveCVariant } from "./waveCVariant";
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

export interface PolicyHistoryEntry {
  id: string;
  at: string;
  actor: string | null;
  keys: string[];
  prev: Record<string, unknown> | null;
  next: Record<string, unknown> | null;
  version: string | number | null;
}

export interface PublishingFixture {
  rooftopLabel: string;
  groupLabel?: string;
  history?: PolicyHistoryEntry[];
  seeds?: Partial<Record<WaveCVariant, Partial<Omit<PublishingFixture, "seeds">>>>;
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

type AuditRow = { id: string; created_at: string; user_id: string | null; user_email: string | null; details: Record<string, unknown> | null };

const asRecord = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/**
 * The settings writer and the review dialog each record a row for one apply, seconds apart. The dialog's row carries
 * the idempotency key and the readable rule names, so it wins when two rows from one user fall within ten seconds.
 */
export function toPolicyHistory(rows: AuditRow[]): PolicyHistoryEntry[] {
  const sorted = [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const out: AuditRow[] = [];
  for (const r of sorted) {
    const near = out.findIndex((o) => o.user_id === r.user_id && Math.abs(Date.parse(o.created_at) - Date.parse(r.created_at)) < 10_000);
    if (near === -1) out.push(r);
    else if (!asRecord(out[near].details)?.idempotency_key && asRecord(r.details)?.idempotency_key) out[near] = r;
  }
  return out.map((r) => {
    const d = asRecord(r.details) ?? {};
    return { id: r.id, at: r.created_at, actor: r.user_email, keys: Array.isArray(d.keys) ? d.keys.map(String) : [], prev: asRecord(d.prev), next: asRecord(d.next), version: (d.policy_version as string | number | undefined) ?? null };
  });
}

export async function loadPolicyHistory(tenantId: string): Promise<PolicyHistoryEntry[]> {
  const { data, error } = await db().from("audit_log").select("id, created_at, user_id, user_email, details").eq("store_id", tenantId).eq("action", PUBLISHING_AUDIT_ACTION).order("created_at", { ascending: false }).limit(20);
  if (error) throw new Error("history read failed");
  return toPolicyHistory((data as AuditRow[] | null) ?? []);
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
  const variant = useWaveCVariant(!!fixture);

  const live = useQuery({
    queryKey: ["admin-v2", "publishing", tenantId],
    enabled: !fixture && !!tenantId,
    queryFn: () => loadPublishingLive(tenantId as string),
    staleTime: 30_000,
  });

  const historyQ = useQuery({
    queryKey: ["admin-v2", "publishing-policy-history", tenantId],
    enabled: !fixture && !!realTenantId(tenant),
    queryFn: () => loadPolicyHistory(tenantId as string),
    staleTime: 30_000,
    retry: false,
  });

  const seeded = fixture ? { ...fixture, ...(fixture.seeds?.[variant] ?? {}) } : null;
  const settingsSlice = useMemo<PublishingSettingsSlice>(() => seeded?.settings ?? publishingSlice(settings), [seeded, settings]);
  const policyVersion = useMemo(() => (seeded ? seeded.policyVersion : publishingPolicyVersion(publishingDraftFrom(settingsSlice))), [seeded, settingsSlice]);

  const place = [settings.dealer_city, settings.dealer_state].filter(Boolean).join(", ");
  const name = settings.dealer_name || tenant?.name || "this rooftop";
  const rooftopLabel = seeded?.rooftopLabel ?? (place ? `${name} (${place})` : name);
  const groupLabel = seeded?.groupLabel ?? (tenant?.name && tenant.id !== "house" ? tenant.name : null);
  const history: { state: "loading" | "ok" | "unavailable"; entries: PolicyHistoryEntry[] } = seeded
    ? { state: variant === "error" ? "unavailable" : "ok", entries: variant === "error" || variant === "empty" ? [] : seeded.history ?? [] }
    : historyQ.isError ? { state: "unavailable", entries: [] }
    : historyQ.isLoading ? { state: "loading", entries: [] }
    : { state: "ok", entries: historyQ.data ?? [] };

  return {
    fixture: seeded,
    variant,
    groupLabel,
    history,
    now,
    tenantId,
    settingsSlice,
    rooftopLabel,
    policyVersion,
    loading: !fixture && (settingsLoading || live.isLoading),
    loadFailed: seeded ? variant === "error" : live.isError || !!live.data?.loadFailed,
    description: seeded ? seeded.description : live.data ? live.data.description : undefined,
    counts: seeded ? seeded.counts : live.data ? live.data.counts : undefined,
    refetch: live.refetch,
  };
}
