import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, AlertTriangle, Car, CheckCircle2, ChevronRight, FileText, Globe, Info, Route, Store, Tag, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { useViewFixture, useAdminNow } from "@/lib/admin/dataSource";
import { ADMIN_SECTIONS, adminTabHref } from "@/lib/admin/sections";
import { buildAttentionQueue, ATTENTION_STATUS_META, type AttentionItem } from "@/lib/admin/attention";
import { deriveEffectivePolicy, deriveRoutingReadiness, type EffectivePolicyRow } from "@/lib/admin/effectivePolicy";
import { classifyRunOutcome, countDisplay, deriveFeedHealth, describeAge, knownCount, type CountValue, type HealthVerdict } from "@/lib/admin/health";
import { AdminCard, AdminLinkButton, AdminTable, HealthBanner, StatTile, StatusChip, Td, Th } from "@/components/admin/v2/primitives";

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
    countOf(db.from("vehicle_listings").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).is("archived_at", null).eq("status", "pending_review")),
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

const SHORTCUTS = [
  { section: "brand", icon: Store, title: "Dealership & Brand", detail: "Store details, brand settings, legal info and logos." },
  { section: "people", icon: Users, title: "People & Access", detail: "Manage users, roles and permissions." },
  { section: "pricing", icon: Tag, title: "Pricing & Products", detail: "Price rules, products and deal structure." },
  { section: "customer-experience", icon: Route, title: "Customer Experience", detail: "Disclosure, messaging and buyer-facing settings." },
  { section: "publishing", icon: Globe, title: "Publishing", detail: "Listing rules, syndication and visibility." },
  { section: "documents", icon: FileText, title: "Documents & Service", detail: "Forms, disclosures and service settings." },
] as const;

const ATTENTION_ICON: Record<AttentionItem["status"], typeof AlertTriangle> = {
  blocked: AlertCircle,
  needs_review: AlertTriangle,
  review_required: AlertTriangle,
  incomplete: Info,
  unknown: AlertTriangle,
};

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
  const policy = useMemo(() => fixture?.policy ?? deriveEffectivePolicy({ settings }), [fixture, settings]);

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

  return (
    <div className="space-y-4">
      <div className="space-y-3.5">
        <HealthBanner
          verdict={feed}
          title={feed && feed.state !== "healthy" ? "Inventory sync needs attention" : undefined}
          action={<AdminLinkButton to={adminTabHref("inventory-feed")} variant="outline" size="sm">Review sync</AdminLinkButton>}
        />
        {failed && (
          <p role="status" className="text-[13px] text-adm-muted">Some counts could not be read for this rooftop. They show as Unavailable rather than zero.</p>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <StatTile icon={Car} label="Active inventory" value={countDisplay(activeInventory)} href="/inventory" tone="info" />
          <StatTile icon={CheckCircle2} label="Setup" value={setup ? `${setup.done} of ${setup.total}` : "Unknown"} href={adminTabHref("identity")} tone="success" />
          <StatTile icon={FileText} label="Policy reviews" value={countDisplay(policyReviews)} href="/dashboard/document-review" tone="info" />
          <StatTile icon={AlertTriangle} label="Open exceptions" value={countDisplay(openExceptions)} href="/admin/exceptions" tone="danger" />
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,2.15fr)_minmax(300px,1fr)] gap-3.5 items-stretch">
        <div className="space-y-4 min-w-0">
        <AdminCard title="What needs attention" flush inset="sm">
          {loading && !fixture ? (
            <p className="px-4 pb-4 text-[13px] text-adm-muted">Checking this rooftop…</p>
          ) : attention.length === 0 ? (
            <p className="px-4 pb-4 text-[13px] text-adm-muted">{failed ? "Attention items could not be checked." : "Nothing needs attention right now."}</p>
          ) : (
            <AdminTable caption="Ranked attention queue" dense inset>
              <thead>
                <tr>
                  <Th className="w-[44%]">Issue</Th>
                  <Th className="w-[18%]">Owner</Th>
                  <Th className="w-[19%]">Status</Th>
                  <Th className="w-[19%]">Action</Th>
                </tr>
              </thead>
              <tbody>
                {attention.map((item) => {
                  const meta = ATTENTION_STATUS_META[item.status];
                  const Icon = ATTENTION_ICON[item.status];
                  return (
                    <tr key={item.id}>
                      <Td>
                        <div className="flex items-start gap-3">
                          <Icon className={`w-7 h-7 -mt-px -ml-0.5 flex-shrink-0 fill-current stroke-white ${meta.tone === "danger" ? "text-adm-danger" : meta.tone === "warning" ? "text-[#F2A51A]" : "text-adm-muted"}`} aria-hidden="true" />
                          <div className="min-w-0">
                            <p className="text-[12.5px] leading-[18px] font-semibold text-adm-ink">{item.title}</p>
                            <p className="text-adm-muted">{item.detail}</p>
                          </div>
                        </div>
                      </Td>
                      <Td className="text-adm-ink">{item.owner ?? "—"}</Td>
                      <Td><StatusChip tone={meta.tone} className="text-[10.5px] leading-[16px] py-1">{meta.label}</StatusChip></Td>
                      <Td><Link to={item.action.href} className="font-semibold text-adm-primary hover:underline">{item.action.label}</Link></Td>
                    </tr>
                  );
                })}
              </tbody>
            </AdminTable>
          )}
        </AdminCard>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2.18fr)_minmax(260px,1fr)] gap-2.5 items-stretch">
        <AdminCard title="Administration settings" inset="sm" titleSize="sm" headerClassName="pt-2.5" bodyClassName="pt-1.5 pb-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {SHORTCUTS.map((s) => {
              const section = ADMIN_SECTIONS.find((x) => x.id === s.section)!;
              return (
                <Link key={s.section} to={adminTabHref(section.tabs[0].id)} className="flex items-center gap-2.5 rounded-[10px] border border-adm-border pl-2 pr-1.5 py-[11px] hover:border-adm-primary/60">
                  <span className="w-11 h-11 rounded-[10px] bg-adm-workspace text-adm-ink flex items-center justify-center flex-shrink-0" aria-hidden="true"><s.icon className="w-[22px] h-[22px]" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="text-[11px] leading-[14px] font-semibold text-adm-ink line-clamp-2">{s.title}</span>
                    <span className="text-[10px] leading-[13px] text-adm-muted line-clamp-2">{s.detail}</span>
                  </span>
                  <ChevronRight className="w-5 h-5 text-adm-muted flex-shrink-0" aria-hidden="true" />
                </Link>
              );
            })}
          </div>
        </AdminCard>

        <AdminCard title="Recent activity" inset="sm" titleSize="sm" headerClassName="pt-2.5" bodyClassName="pt-2 pb-3" action={<Link to={adminTabHref("activity")} className="text-[12px] font-semibold text-adm-primary hover:underline">View all</Link>}>
          {activity.length === 0 ? (
            <p className="text-[13px] text-adm-muted">No recent activity recorded for this rooftop.</p>
          ) : (
            <ul className="divide-y divide-adm-border">
              {activity.slice(0, 5).map((a) => (
                <li key={a.id} className="flex items-start gap-5 py-[5px]">
                  <span className={`mt-px w-[22px] h-[22px] flex items-center justify-center flex-shrink-0 ${a.tone === "warning" ? "text-[#F2A51A]" : a.tone === "success" ? "text-adm-success" : "text-adm-primary"}`} aria-hidden="true">
                    {a.tone === "warning" ? <AlertTriangle className="w-6 h-6 fill-current stroke-white" /> : a.tone === "success" ? <CheckCircle2 className="w-6 h-6 fill-current stroke-white" /> : a.tone === "info" ? <Users className="w-5 h-5" /> : <FileText className="w-5 h-5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[10.5px] leading-[16px] font-semibold text-adm-ink truncate">{a.action}</span>
                    <span className="block text-[10px] leading-[14px] text-adm-muted truncate">{a.detail}</span>
                  </span>
                  <span className="text-[10px] leading-[16px] text-adm-muted whitespace-nowrap">{compactAge(a.at, now)}</span>
                </li>
              ))}
            </ul>
          )}
        </AdminCard>
        </div>
        </div>

        <AdminCard title="Effective policy" inset="sm" className="h-full" headerClassName="pt-3" bodyClassName="pt-2 pb-4" action={<Link to={adminTabHref("effective-policy")} className="text-[13px] font-semibold text-adm-primary hover:underline">Edit</Link>}>
          <ul className="divide-y divide-adm-border -mt-2">
            {policy.map((row) => {
              const Icon = row.key === "price_basis" ? Tag : row.key === "publishing" ? Globe : row.key === "used_cpo" ? Car : Route;
              const ok = row.state === "ok";
              return (
                <li key={row.key} className="flex items-start gap-3 py-[14px]">
                  <span className="w-10 h-10 rounded-md bg-adm-workspace text-adm-muted flex items-center justify-center flex-shrink-0" aria-hidden="true"><Icon className="w-5 h-5" /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3">
                      {ok ? <CheckCircle2 className="w-7 h-7 -ml-0.5 text-adm-success fill-current stroke-white" aria-hidden="true" /> : <AlertCircle className="w-7 h-7 -ml-0.5 text-adm-danger fill-current stroke-white" aria-hidden="true" />}
                      <p className="text-[11px] leading-[16px] font-semibold text-adm-ink">{row.title}</p>
                    </div>
                    <Link to={row.href} className="block text-[15.5px] leading-[22px] font-medium text-adm-ink hover:underline">{row.value}</Link>
                    <p className="text-[12.5px] leading-[18px] text-adm-muted">{row.detail}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </AdminCard>
      </div>
    </div>
  );
}
