import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Building2, ChevronRight, FileText, Globe, Link2, MessageSquare, ShieldCheck, Tag, Users, type LucideIcon } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { useViewFixture, useAdminNow } from "@/lib/admin/dataSource";
import { ADMIN_SECTIONS, adminTabHref } from "@/lib/admin/sections";
import { buildAttentionQueue, ATTENTION_STATUS_META, type AttentionItem } from "@/lib/admin/attention";
import { deriveRoutingReadiness, type EffectivePolicyRow } from "@/lib/admin/effectivePolicy";
import { countDisplay, deriveFeedHealth, describeAge, HEALTH_META, knownCount, needsAttention, type CountValue, type HealthVerdict } from "@/lib/admin/health";
import { AdminCard, AdminTable, ICON_BOX, StatusChip, Td, Th } from "@/components/admin/v2/primitives";
import { MetricStrip } from "@/components/product";

// Overview: the operational control center. Everything here is derived from
// evidence the app already holds; opening the page calls no provider.

export interface OverviewFixture {
  feed: HealthVerdict | null;
  activeInventory: CountValue;
  setup: { done: number; total: number } | null;
  policyReviews: CountValue;
  openExceptions: CountValue;
  attention: AttentionItem[];
  policy: EffectivePolicyRow[];
  activity: ActivityRow[];
}

export interface ActivityRow {
  id: string;
  action: string;
  detail: string;
  at: string;
  tone: "warning" | "success" | "neutral" | "info";
}

interface LiveOverview {
  feed: HealthVerdict;
  activeInventory: CountValue;
  policyReviews: CountValue;
  openExceptions: CountValue;
  priceMissing: CountValue;
  priceMismatched: CountValue;
  descriptionsBlocked: CountValue;
  activity: ActivityRow[];
}

const countOf = async (q: PromiseLike<{ count: number | null; error: unknown }>): Promise<CountValue> => {
  try {
    const { count, error } = await q;
    if (error || count === null) return { kind: "failed" };
    return knownCount(count);
  } catch {
    return { kind: "failed" };
  }
};

const ACTIVITY_TONE: Record<string, ActivityRow["tone"]> = {
  provider_refused: "warning",
  price: "success",
  member: "info",
  policy: "info",
};

const toneForAction = (action: string): ActivityRow["tone"] => {
  if (/refus|fail|rate|error/.test(action)) return "warning";
  if (/price|fee|publish/.test(action)) return ACTIVITY_TONE.price;
  if (/member|invite|role/.test(action)) return ACTIVITY_TONE.member;
  return "neutral";
};

const humanize = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

/** The activity list's short relative time: 24m ago, 2h ago, 1d ago. */
const compactAge = (iso: string, now: number): string => {
  const ms = now - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return describeAge(iso, now);
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${Math.max(minutes, 1)}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
};

async function loadOverview(tenantId: string, now: number): Promise<LiveOverview> {
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
  const feed = deriveFeedHealth({
    configured: cfg ? !!cfg.source : loadFailed ? null : false,
    enabled: cfg ? cfg.enabled : null,
    latestRun: latestRes.data ?? null,
    latestRealRun: realRes.data ?? null,
    lastSuccessAt: (successRes.data as { started_at: string } | null)?.started_at ?? null,
    cadenceHours: cadence,
    now,
    loadFailed,
  });

  const [activeInventory, openExceptions, priceMissing, priceMismatched, descriptionsBlocked, policyReviews] = await Promise.all([
    countOf(db.from("vehicle_listings").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).is("archived_at", null)),
    countOf(db.from("vehicle_exceptions").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).in("status", ["open", "in_progress"])),
    countOf(db.from("vehicle_listings").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).is("archived_at", null).is("advertised_price_before_doc", null).not("price", "is", null)),
    countOf(db.from("vehicle_listings").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).is("archived_at", null).eq("price_parse_status", "warning")),
    countOf(db.from("description_jobs").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("status", "failed")),
    // The same population the Policy reviews tile opens: open stale-document flags.
    countOf(db.from("stale_document_flags").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).eq("status", "open")),
  ]);

  let activity: ActivityRow[] = [];
  try {
    const { data } = await db.from("audit_log").select("id, action, entity_type, entity_id, created_at, details").eq("store_id", tenantId).order("created_at", { ascending: false }).limit(5);
    activity = ((data as Array<{ id: string; action: string; entity_type: string | null; entity_id: string | null; created_at: string }>) ?? []).map((r) => ({
      id: r.id,
      action: humanize(r.action),
      detail: [r.entity_type, r.entity_id ? r.entity_id.slice(0, 8) : null].filter(Boolean).join(" · "),
      at: r.created_at,
      tone: toneForAction(r.action),
    }));
  } catch {
    activity = [];
  }

  return { feed, activeInventory, policyReviews, openExceptions, priceMissing, priceMismatched, descriptionsBlocked, activity };
}

const SETUP_CHECKS = (s: ReturnType<typeof useDealerSettings>["settings"]) => [
  !!s.dealer_name && s.dealer_name !== "Your Dealership",
  !!s.dealer_logo_url,
  !!s.doc_fee_enabled && !!s.doc_fee_state,
  !!s.dealer_phone || !!s.passport_contact_routing?.dealershipDefaultContact?.salesPhone,
  (s.passport_agents ?? []).length > 0 || !!s.passport_contact_routing?.bdcSettings?.enabled,
  !!s.new_inventory_url || !!s.used_inventory_url,
];

interface Shortcut {
  section: string;
  tab: string;
  icon: LucideIcon;
  title: string;
  detail: string;
}

const SHORTCUTS: Shortcut[] = [
  { section: "brand", tab: "identity", icon: Building2, title: "Dealership & Brand", detail: "Identity, appearance, hours and public information" },
  { section: "people", tab: "team", icon: Users, title: "People & Access", detail: "Manage team members, roles and permissions" },
  { section: "pricing", tab: "price-rules", icon: Tag, title: "Pricing & Products", detail: "Label pricing, products, warranties and incentives" },
  { section: "customer-experience", tab: "routing", icon: MessageSquare, title: "Customer Experience", detail: "Routing, modules and calls to action" },
  { section: "publishing", tab: "effective-policy", icon: Globe, title: "Publishing", detail: "Control what goes live and when" },
  { section: "documents", tab: "templates", icon: FileText, title: "Documents & Service", detail: "Document approval, retail readiness and service settings" },
  { section: "integrations", tab: "inventory-feed", icon: Link2, title: "Integrations & Data", detail: "System integrations and feed health" },
  { section: "publishing", tab: "approvals", icon: ShieldCheck, title: "Approvals", detail: "Review listing, document and signing approvals" },
];

const ACTIVITY_DATE = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

export default function OverviewView() {
  const fixture = useViewFixture<OverviewFixture>("overview");
  const now = useAdminNow();
  const { tenant } = useTenant();
  const { settings } = useDealerSettings();
  const tenantId = tenant?.id && tenant.id !== "house" ? tenant.id : null;

  const live = useQuery({
    queryKey: ["admin-v2", "overview", tenantId],
    enabled: !fixture && !!tenantId,
    queryFn: () => loadOverview(tenantId as string, now),
    staleTime: 30_000,
  });

  const routing = useMemo(() => deriveRoutingReadiness(settings.passport_contact_routing, settings.passport_agents), [settings.passport_contact_routing, settings.passport_agents]);

  const feed = fixture ? fixture.feed : live.data?.feed ?? null;
  const loading = !fixture && (live.isLoading || !tenantId);
  const failed = !fixture && live.isError;

  const attention = useMemo<AttentionItem[]>(() => {
    if (fixture) return fixture.attention;
    if (!live.data) return [];
    return buildAttentionQueue({
      feed: live.data.feed,
      priceEvidence: { missing: live.data.priceMissing, mismatched: live.data.priceMismatched },
      descriptions: { blocked: live.data.descriptionsBlocked },
      routing,
      recall: null,
      publishing: null,
      documents: null,
    });
  }, [fixture, live.data, routing]);

  const setup = fixture ? fixture.setup : (() => { const c = SETUP_CHECKS(settings); return { done: c.filter(Boolean).length, total: c.length }; })();
  const activeInventory: CountValue | null = fixture ? fixture.activeInventory : failed ? { kind: "failed" } : loading ? { kind: "loading" } : live.data?.activeInventory ?? null;
  const policyReviews: CountValue | null = fixture ? fixture.policyReviews : failed ? { kind: "failed" } : loading ? { kind: "loading" } : live.data?.policyReviews ?? null;
  const openExceptions: CountValue | null = fixture ? fixture.openExceptions : failed ? { kind: "failed" } : loading ? { kind: "loading" } : live.data?.openExceptions ?? null;
  const activity = fixture ? fixture.activity : live.data?.activity ?? [];

  const feedAttention = feed && needsAttention(feed.state);
  const feedTone = feed ? HEALTH_META[feed.state].tone : "neutral";

  return (
    <div className="flex flex-col gap-4">
      {feed && (
        <div className="flex flex-wrap items-center justify-end gap-x-3 text-[13px] leading-[18px]">
          <span className={`h-2.5 w-2.5 rounded-full ${feedAttention ? (feedTone === "danger" ? "bg-adm-danger" : "bg-[#F29C09]") : "bg-adm-success"}`} aria-hidden="true" />
          <span className="font-semibold text-adm-ink">Feed health: {feedAttention ? feed.headline : "Healthy"}</span>
          <Link to={adminTabHref("inventory-feed")} className="font-semibold text-adm-primary hover:underline">View feed health</Link>
        </div>
      )}
      {failed && <p role="status" className="text-[13px] text-adm-muted">Some counts could not be read for this rooftop. They show as Unavailable rather than zero.</p>}

      <MetricStrip
        label="Administration summary"
        metrics={[
          { label: "Active inventory", value: countDisplay(activeInventory), href: "/inventory", loading },
          { label: "Policy reviews", value: countDisplay(policyReviews), href: "/dashboard/document-review", loading },
          { label: "Open exceptions", value: countDisplay(openExceptions), href: "/admin/exceptions", tone: openExceptions?.kind === "known" && openExceptions.value > 0 ? "danger" : "neutral", loading },
          { label: "Setup complete", value: setup ? `${setup.done} of ${setup.total}` : null, href: adminTabHref("identity"), tone: "success" },
        ]}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {SHORTCUTS.map((s) => {
          const section = ADMIN_SECTIONS.find((x) => x.id === s.section)!;
          const tab = section.tabs.find((t) => t.id === s.tab) ?? section.tabs[0];
          return (
            <Link key={s.title} to={adminTabHref(tab.id)} className="flex min-h-[72px] items-center gap-3 rounded-[6px] border border-adm-border bg-adm-surface px-3 py-3 hover:border-adm-primary/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-adm-primary">
              <span className={`${ICON_BOX.square} flex flex-shrink-0 items-center justify-center bg-adm-selected text-adm-primary`} aria-hidden="true"><s.icon className="h-6 w-6" /></span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] leading-[20px] font-semibold text-adm-ink">{s.title}</span>
                <span className="block text-[12px] leading-[16px] text-adm-muted line-clamp-2">{s.detail}</span>
              </span>
              <ChevronRight className="h-5 w-5 flex-shrink-0 text-adm-muted" aria-hidden="true" />
            </Link>
          );
        })}
      </div>

      <AdminCard title="Administration activity (recent)" flush inset="sm" action={<Link to={adminTabHref("activity")} className="text-[14px] font-semibold text-adm-primary hover:underline">View all</Link>}>
        {activity.length === 0 ? (
          <p className="px-4 pb-4 text-[13px] text-adm-muted">No recent activity recorded for this rooftop.</p>
        ) : (
          <AdminTable caption="Recent activity" minWidth={640}>
            <thead>
              <tr>
                <Th>Date / Time</Th>
                <Th>Action</Th>
                <Th>Details</Th>
                <Th>Age</Th>
              </tr>
            </thead>
            <tbody>
              {activity.slice(0, 5).map((a) => (
                <tr key={a.id}>
                  <Td className="whitespace-nowrap">{ACTIVITY_DATE(a.at)}</Td>
                  <Td>{a.action}</Td>
                  <Td className="max-w-[320px] truncate text-adm-muted">{a.detail}</Td>
                  <Td className="whitespace-nowrap text-adm-muted">{compactAge(a.at, now)}</Td>
                </tr>
              ))}
            </tbody>
          </AdminTable>
        )}
      </AdminCard>

      <AdminCard title="What needs attention" flush inset="sm">
        {loading && !fixture ? (
          <p className="px-4 pb-4 text-[13px] text-adm-muted">Checking this rooftop</p>
        ) : attention.length === 0 ? (
          <p className="px-4 pb-4 text-[13px] text-adm-muted">{failed ? "Attention items could not be checked." : "Nothing needs attention right now."}</p>
        ) : (
          <AdminTable caption="Ranked attention queue" minWidth={680}>
            <thead>
              <tr>
                <Th>Issue</Th>
                <Th>Owner</Th>
                <Th>Status</Th>
                <Th>Action</Th>
              </tr>
            </thead>
            <tbody>
              {attention.map((item) => {
                const meta = ATTENTION_STATUS_META[item.status];
                return (
                  <tr key={item.id}>
                    <Td>
                      <p className="text-[14px] leading-[20px] font-semibold text-adm-ink">{item.title}</p>
                      <p className="max-w-[420px] truncate text-[12px] leading-[18px] text-adm-muted">{item.detail}</p>
                    </Td>
                    <Td>{item.owner ?? "Unknown"}</Td>
                    <Td><StatusChip tone={meta.tone}>{meta.label}</StatusChip></Td>
                    <Td><Link to={item.action.href} className="font-semibold text-adm-primary hover:underline">{item.action.label}</Link></Td>
                  </tr>
                );
              })}
            </tbody>
          </AdminTable>
        )}
      </AdminCard>
    </div>
  );
}
