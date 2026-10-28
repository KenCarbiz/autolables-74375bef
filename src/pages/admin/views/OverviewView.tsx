import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, AlertTriangle, ArrowLeftRight, Building2, CarFront, CheckCircle2, ChevronRight, FileSpreadsheet, FileText, Globe, Info, Smile, SquareCheckBig, Tag, User, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "@/contexts/TenantContext";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { useViewFixture, useAdminNow } from "@/lib/admin/dataSource";
import { ADMIN_SECTIONS, adminTabHref } from "@/lib/admin/sections";
import { buildAttentionQueue, ATTENTION_STATUS_META, type AttentionItem } from "@/lib/admin/attention";
import { deriveEffectivePolicy, deriveRoutingReadiness, type EffectivePolicyRow } from "@/lib/admin/effectivePolicy";
import { classifyRunOutcome, countDisplay, deriveFeedHealth, describeAge, HEALTH_META, knownCount, needsAttention, type CountValue, type HealthVerdict, type HealthTone } from "@/lib/admin/health";
import { AdminCard, AdminLinkButton, AdminTable, InlineNote, StatTile, StatusChip, Td, Th } from "@/components/admin/v2/primitives";

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
  { section: "brand", icon: Building2, glyph: "text-adm-ink", title: "Dealership & Brand", detail: "Store details, brand settings, legal info and logos." },
  { section: "people", icon: Users, glyph: "text-adm-primary", title: "People & Access", detail: "Manage users, roles and permissions." },
  { section: "pricing", icon: Tag, glyph: "text-adm-primary", title: "Pricing & Products", detail: "Price rules, products and deal structure." },
  { section: "customer-experience", icon: Smile, glyph: "text-adm-primary", title: "Customer Experience", detail: "Disclosure, messaging and buyer-facing settings." },
  { section: "publishing", icon: Globe, glyph: "text-adm-primary", title: "Publishing", detail: "Listing rules, syndication and visibility." },
  { section: "documents", icon: FileText, glyph: "text-adm-primary", title: "Documents & Service", detail: "Forms, disclosures and service settings." },
] as const;

const ATTENTION_ICON: Record<AttentionItem["status"], typeof AlertTriangle> = {
  blocked: AlertCircle,
  needs_review: AlertTriangle,
  review_required: AlertTriangle,
  incomplete: Info,
  unknown: AlertTriangle,
};

// The reference draws status marks as filled glyphs in these hues; the
// lighter success green is the mark colour, not the chip text token.
const MARK = { warning: "text-[#F29C09]", success: "text-[#3F9C50]", danger: "text-adm-danger", neutral: "text-[#6B7585]", info: "text-adm-primary" } as const satisfies Record<HealthTone, string>;

// The reference banner edge is a soft 2px amber stroke from y 253 to 312.
const BANNER_MARK: Record<HealthTone, string> = {
  warning: "[&>svg]:text-[#F29C09] border-[#FCDC9A]",
  success: "[&>svg]:text-[#3F9C50]",
  danger: "[&>svg]:text-adm-danger",
  neutral: "[&>svg]:text-[#6B7585]",
  info: "[&>svg]:text-adm-primary",
};

// Chip fills measured on the reference queue: deeper than the banner tints. The
// warning label is darkened from the token (4.3:1 on this fill) to keep 4.5:1.
const QUEUE_CHIP: Record<HealthTone, string> = {
  warning: "bg-[#FDE4B4] text-[#8A5900]",
  danger: "bg-[#FDD5D7]",
  neutral: "border-0 bg-[#E3E7EC] text-adm-ink",
  success: "",
  info: "",
};

const POLICY_ICON: Record<string, typeof Tag> = { price_basis: Tag, publishing: Globe, used_cpo: CarFront };

// Summary tiles, measured on the reference: 52px icon circle on a 14px inset,
// 81px tall, the value 5px under the label, and the Policy reviews tile in
// violet. StatTile takes no className, so the geometry is set from here.
const TILE_GRID = [
  "grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-[311fr_315fr_320fr_327fr] gap-3",
  "[&>a]:min-h-[81px] [&>a]:px-3.5",
  "[&>a>span:first-child]:w-[52px] [&>a>span:first-child]:h-[52px]",
  "[&_.tabular-nums]:mt-[5px]",
  "[&>a:first-child>span:first-child>svg]:w-[30px] [&>a:first-child>span:first-child>svg]:h-[30px]",
  "[&>a:nth-child(2)>span:first-child>svg]:w-6 [&>a:nth-child(2)>span:first-child>svg]:h-6",
  "[&>a:nth-child(3)>span:first-child]:bg-[#F1ECFE] [&>a:nth-child(3)>span:first-child]:text-[#6A3DE8]",
].join(" ");

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

  const bannerTone = feed && needsAttention(feed.state) ? HEALTH_META[feed.state].tone : null;

  return (
    <div className="space-y-3.5">
      <div className="space-y-3.5">
        {feed && bannerTone && (
          <InlineNote
            tone={bannerTone}
            className={`-mt-px -mb-px border-2 py-[10.5px] pl-[15px] pr-[12px] text-adm-ink [&>svg]:w-[34px] [&>svg]:h-[34px] [&>svg]:-ml-0.5 [&>svg]:fill-current [&>svg]:stroke-white ${BANNER_MARK[bannerTone]}`}
            title={<span className="text-[16px]">{feed.state !== "healthy" ? "Inventory sync needs attention" : feed.headline}</span>}
            action={<AdminLinkButton to={adminTabHref("inventory-feed")} variant="outline" size="sm" className="min-h-[35px] px-3">Review sync</AdminLinkButton>}
          >
            <span className="text-[12.5px] text-[#3E5169]">{feed.detail}</span>
          </InlineNote>
        )}
        {failed && (
          <p role="status" className="text-[13px] text-adm-muted">Some counts could not be read for this rooftop. They show as Unavailable rather than zero.</p>
        )}

        <div className={TILE_GRID}>
          <StatTile icon={CarFront} label="Active inventory" value={countDisplay(activeInventory)} href="/inventory" tone="info" />
          <StatTile icon={SquareCheckBig} label="Setup" value={setup ? `${setup.done} of ${setup.total}` : "Unknown"} href={adminTabHref("identity")} tone="success" />
          <StatTile icon={FileText} label="Policy reviews" value={countDisplay(policyReviews)} href="/dashboard/document-review" tone="info" />
          <StatTile icon={AlertTriangle} label="Open exceptions" value={countDisplay(openExceptions)} href="/admin/exceptions" tone="danger" />
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,2.156fr)_minmax(300px,1fr)] gap-3 items-stretch">
        <div className="space-y-3.5 min-w-0">
        <AdminCard title="What needs attention" flush inset="sm" headerClassName="pt-3 pb-3 [&_h3]:text-[17px] [&_h3]:leading-[24px]">
          {loading && !fixture ? (
            <p className="px-4 pb-4 text-[13px] text-adm-muted">Checking this rooftop…</p>
          ) : attention.length === 0 ? (
            <p className="px-4 pb-4 text-[13px] text-adm-muted">{failed ? "Attention items could not be checked." : "Nothing needs attention right now."}</p>
          ) : (
            // Row rhythm measured on the reference: 52, 53, 53 and 56px under a 35px header.
            <AdminTable caption="Ranked attention queue" inset className="mb-[14px] [&_tbody_tr:first-child>td]:pt-[5px] [&_tbody_tr:last-child>td]:border-b-0 [&_tbody_tr:last-child>td]:pt-2 [&_tbody_tr:last-child>td]:pb-[11px]">
              <thead>
                <tr>
                  <Th className="w-[43.2%] py-2 text-[12.5px] leading-[18px] text-adm-ink">Issue</Th>
                  <Th className="w-[18.4%] py-2 text-[12.5px] leading-[18px] text-adm-ink">Owner</Th>
                  <Th className="w-[18.6%] py-2 text-[12.5px] leading-[18px] text-adm-ink">Status</Th>
                  <Th className="w-[19.8%] py-2 text-[12.5px] leading-[18px] text-adm-ink">Action</Th>
                </tr>
              </thead>
              <tbody>
                {attention.map((item) => {
                  const meta = ATTENTION_STATUS_META[item.status];
                  const Icon = ATTENTION_ICON[item.status];
                  return (
                    <tr key={item.id}>
                      <Td className="pt-1.5 pb-[9px]">
                        <div className="flex items-center gap-[22px]">
                          <Icon className={`w-7 h-7 -ml-[3px] flex-shrink-0 fill-current stroke-white ${MARK[meta.tone]}`} aria-hidden="true" />
                          <div className="min-w-0">
                            <p className="text-[13px] leading-[18px] font-semibold text-adm-ink">{item.title}</p>
                            <p className="mt-px text-[12px] leading-[18px] text-adm-muted">{item.detail}</p>
                          </div>
                        </div>
                      </Td>
                      <Td className="pt-1.5 pb-[9px] text-[13px] leading-[18px] text-adm-ink">{item.owner ?? "—"}</Td>
                      <Td className="pt-1.5 pb-[9px]"><StatusChip tone={meta.tone} className={`px-3 py-[3.5px] text-[12.5px] leading-[18px] ${QUEUE_CHIP[meta.tone]}`}>{meta.label}</StatusChip></Td>
                      <Td className="pt-1.5 pb-[9px]"><Link to={item.action.href} className="text-[13px] leading-[18px] font-semibold text-adm-primary hover:underline">{item.action.label}</Link></Td>
                    </tr>
                  );
                })}
              </tbody>
            </AdminTable>
          )}
        </AdminCard>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2.16fr)_minmax(260px,1fr)] gap-[11px] items-stretch">
        <AdminCard title="Administration settings" inset="sm" headerClassName="pt-[9px] [&_h3]:text-[15px] [&_h3]:leading-[20px]" bodyClassName="pt-2 pb-[10px] pl-3 pr-[11px]">
          <div className="grid grid-cols-1 sm:grid-cols-2 min-[1440px]:grid-cols-3 min-[1440px]:grid-rows-[minmax(74px,auto)_minmax(76px,auto)] gap-1.5">
            {SHORTCUTS.map((s) => {
              const section = ADMIN_SECTIONS.find((x) => x.id === s.section)!;
              return (
                <Link key={s.section} to={adminTabHref(section.tabs[0].id)} className="relative flex items-start rounded-[10px] border border-adm-border pl-2 pr-0.5 pt-1.5 pb-[5px] hover:border-adm-primary/60">
                  <span className="w-10 h-10 rounded-[10px] bg-adm-workspace flex items-center justify-center flex-shrink-0" aria-hidden="true"><s.icon className={`w-[22px] h-[22px] ${s.glyph}`} /></span>
                  <span className="ml-2.5 min-w-0 flex-1 pt-[1.5px] pr-[22px] min-[1440px]:pr-0">
                    {/* From 1440px the chevron floats one title line down, so a one-line title runs above it as the
                        reference draws; narrower tiles keep it in its own lane so a wrapped word never drops under it. */}
                    <span className="hidden min-[1440px]:block float-right w-0 h-4" aria-hidden="true" />
                    <ChevronRight className="absolute right-0.5 top-[23.5px] min-[1440px]:static min-[1440px]:float-right min-[1440px]:clear-right w-5 h-5 text-adm-muted" aria-hidden="true" />
                    <span className="block text-[12.5px] leading-[16px] font-semibold text-adm-ink">{s.title}</span>
                    <span className="mt-[1.5px] text-[11px] leading-[13px] text-adm-muted">{s.detail}</span>
                  </span>
                </Link>
              );
            })}
          </div>
        </AdminCard>

        <AdminCard
          title="Recent activity"
          inset="sm"
          headerClassName="pt-[9px] [&_h3]:text-[15px] [&_h3]:leading-[20px]"
          bodyClassName="pt-2 pb-[6px] pl-3.5 pr-3.5"
          action={<Link to={adminTabHref("activity")} className="text-[12.5px] leading-[20px] font-semibold text-adm-primary hover:underline">View all</Link>}
        >
          {activity.length === 0 ? (
            <p className="text-[13px] text-adm-muted">No recent activity recorded for this rooftop.</p>
          ) : (
            <ul className="border-t border-adm-border divide-y divide-adm-border">
              {activity.slice(0, 5).map((a) => (
                <li key={a.id} className="flex items-start gap-4 pt-[3px] pb-[6px]">
                  <span className={`mt-px w-6 h-6 flex items-center justify-center flex-shrink-0 ${a.tone === "warning" ? MARK.warning : a.tone === "success" ? MARK.success : "text-adm-primary"}`} aria-hidden="true">
                    {a.tone === "warning" ? <AlertTriangle className="w-6 h-6 fill-current stroke-white" /> : a.tone === "success" ? <CheckCircle2 className="w-[22px] h-[22px] fill-current stroke-white" /> : a.tone === "info" ? <User className="w-6 h-6" /> : <FileSpreadsheet className="w-5 h-5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 text-[11px] leading-[16px] font-semibold text-adm-ink break-words">{a.action}</span>
                      <span className="text-[11px] leading-[16px] text-adm-muted whitespace-nowrap">{compactAge(a.at, now)}</span>
                    </span>
                    <span data-parity="activity-detail" className="block text-[11px] leading-[14px] text-adm-muted break-words">{a.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </AdminCard>
        </div>
        </div>

        <AdminCard
          title="Effective policy"
          inset="sm"
          className="h-full"
          headerClassName="pt-3 [&_h3]:text-[17px] [&_h3]:leading-[24px]"
          bodyClassName="pt-[2.5px] pb-3"
          action={<Link to={adminTabHref("effective-policy")} className="text-[12.5px] leading-[24px] font-semibold text-adm-primary hover:underline">Edit</Link>}
        >
          <ul className="divide-y divide-adm-border">
            {policy.map((row) => {
              const Icon = POLICY_ICON[row.key] ?? ArrowLeftRight;
              const ok = row.state === "ok";
              return (
                <li key={row.key} className="flex items-start py-3">
                  <span className="mt-[3px] -ml-0.5 w-9 h-9 rounded-md bg-adm-workspace text-adm-ink flex items-center justify-center flex-shrink-0" aria-hidden="true"><Icon className="w-5 h-5" /></span>
                  {ok ? <CheckCircle2 className={`-mt-[1.5px] ml-[6.5px] w-[25px] h-[25px] flex-shrink-0 fill-current stroke-white ${MARK.success}`} aria-hidden="true" /> : <AlertCircle className={`-mt-[1.5px] ml-[6.5px] w-[25px] h-[25px] flex-shrink-0 fill-current stroke-white ${MARK.danger}`} aria-hidden="true" />}
                  <div className="ml-[11.5px] min-w-0 flex-1">
                    <p className="text-[15px] leading-[20px] font-semibold text-adm-ink">{row.title}</p>
                    <Link to={row.href} className="block mt-[3px] text-[15px] leading-[20px] font-medium text-adm-ink hover:underline">{row.value}</Link>
                    <p className="mt-[1.5px] text-[12.5px] leading-[18px] text-adm-muted">{row.detail}</p>
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
