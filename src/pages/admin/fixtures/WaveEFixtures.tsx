import { DEFAULT_SETTINGS } from "@/contexts/DealerSettingsContext";
import { knownCount } from "@/lib/admin/health";
import type { ExceptionRow } from "@/pages/admin/views/overview/overviewModel";
import { summarizeExceptions } from "@/pages/admin/views/overview/overviewModel";
import { FAILED_OVERVIEW, type ActivityEvent, type OverviewData, type OverviewFixture } from "@/pages/admin/views/overview/useOverviewData";
import type { PlanFixture } from "@/pages/admin/views/plan/usePlanData";
import type { UsageSnapshot, UsageState } from "@/pages/admin/views/plan/planModel";
import type { AdminScreenFixture } from "./index";

// Design fixtures for Wave E: the Administration overview (v3-overview) and Plan & Usage (v3-plan-usage). Every name,
// count and date is invented, no value is read from or written to any service, and nothing here feeds a production
// default. ?state= selects a variant: default, empty, error, readonly, stale, trial, suspended, unlimited.

const NOW = Date.parse("2026-11-08T15:00:00Z");
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();
const daysFromNow = (d: number) => new Date(NOW + d * 86_400_000).toISOString();

const SEVERITIES = ["critical", "high", "medium", "medium", "low", "low", "info"] as const;
const TYPES = ["price_changed", "missing_field", "duplicate_stock", "mileage_changed"] as const;
const TITLES: Record<(typeof TYPES)[number], string> = {
  price_changed: "Price changed since the last import",
  missing_field: "Required field is missing",
  duplicate_stock: "Stock number appears twice",
  mileage_changed: "Mileage dropped between imports",
};

const exceptionRows: ExceptionRow[] = Array.from({ length: 14 }, (_, i) => {
  const type = TYPES[i % TYPES.length];
  return { id: `fx-exc-${i + 1}`, vehicleKey: `fx-veh-${(i % 9) + 1}`, vin: `EXAMPLE-VIN-${String(i + 1).padStart(4, "0")}`, severity: SEVERITIES[i % SEVERITIES.length], type, title: TITLES[type] };
});

const EVENTS: Array<[string, string, ActivityEvent["tone"]]> = [
  ["Price rule updated", "Price rule", "success"],
  ["Member invited", "Team member", "neutral"],
  ["Publishing policy changed", "Policy", "neutral"],
  ["Inventory sync rate limited", "Sync run", "warning"],
  ["Template published", "Template", "success"],
];
const allActivity: ActivityEvent[] = Array.from({ length: 42 }, (_, i) => {
  const [action, kind, tone] = EVENTS[i % EVENTS.length];
  return { id: `fx-evt-${i + 1}`, action, kind, actor: i % 5 === 3 ? "System" : `person${(i % 4) + 1}@example.test`, at: minutesAgo(24 + i * 95), tone };
});

const baseData: OverviewData = {
  feed: { state: "degraded", headline: "Provider rate limited (HTTP 429)", detail: "Inventory preserved. Last successful pull 26 h ago.", affectedOutput: "Inventory freshness and availability", inventoryPreserved: true },
  lastSuccessAt: minutesAgo(26 * 60),
  activeInventory: knownCount(128),
  policyReviews: knownCount(3),
  exceptions: summarizeExceptions(exceptionRows, exceptionRows.length),
  priceMissing: knownCount(3),
  priceMismatched: knownCount(0),
  descriptionsBlocked: knownCount(12),
  description: { reviewMode: "EXCEPTION_REVIEW", reviewModeByClass: { used: "REQUIRE_APPROVAL_ALL" }, internalPublicationEnabled: true },
  activity: allActivity.slice(0, 5),
  activityAll: allActivity,
  checkedAt: minutesAgo(2),
};

const fixtureSettings = {
  ...DEFAULT_SETTINGS,
  dealer_name: "Example Motors",
  dealer_city: "Example City",
  dealer_state: "ST",
  dealer_logo_url: "fixture-logo",
  dealer_phone: "Fixture phone",
  doc_fee_enabled: true,
  doc_fee_state: "ST",
  passport_agents: [],
  new_inventory_url: "fixture-inventory-page",
  used_inventory_url: "",
  dealer_timezone: "America/New_York",
};

const emptyData: OverviewData = {
  ...baseData,
  feed: { state: "healthy", headline: "Inventory feed healthy", detail: "Last successful pull 3 h ago.", affectedOutput: "Inventory freshness and availability", inventoryPreserved: true },
  lastSuccessAt: minutesAgo(180),
  activeInventory: knownCount(0),
  policyReviews: knownCount(0),
  exceptions: summarizeExceptions([], 0),
  priceMissing: knownCount(0),
  descriptionsBlocked: knownCount(0),
  activity: [],
  activityAll: [],
};

const overview: OverviewFixture = {
  data: baseData,
  settings: fixtureSettings,
  rooftopLabel: "Example Motors",
  groupLabel: null,
  visibleCategoryIds: null,
  seeds: {
    empty: { data: emptyData, settings: { ...DEFAULT_SETTINGS, dealer_name: "Your Dealership" } },
    error: { data: FAILED_OVERVIEW(minutesAgo(2)) },
    readonly: { visibleCategoryIds: ["brand", "customer", "documents", "billing"] },
    stale: { data: { ...baseData, feed: { state: "stale", headline: "Inventory feed stale", detail: "Last successful pull 4 days ago. That is older than the expected cadence allows.", affectedOutput: "Inventory freshness and availability", inventoryPreserved: true }, lastSuccessAt: minutesAgo(4 * 24 * 60) } },
  },
};

const settingsForPlan = {
  passport_contact_routing: fixtureSettings.passport_contact_routing,
  passport_agents: [],
  feature_custom_branding: false,
  dealer_timezone: "America/New_York",
  dealer_name: "Example Motors",
  dealer_city: "Example City",
  dealer_state: "ST",
};

const readyUsage = (over: Partial<UsageSnapshot> = {}): UsageState => ({
  kind: "ready",
  snapshot: {
    monthLabel: "November 2026",
    timeZone: "America/New_York",
    scope: "All rooftops in this account",
    updatedAt: minutesAgo(3),
    metrics: {
      stickers_generated: { value: 412, events: 38, lastEventAt: minutesAgo(95) },
      documents_published: { value: 96, events: 96, lastEventAt: minutesAgo(40) },
      template_customizations: { value: 7, events: 7, lastEventAt: minutesAgo(60 * 30) },
    },
    ...over,
  },
});

const plan: PlanFixture = {
  entitlement: { planTier: "pro", status: "active", trialEndsAt: "2026-02-01T00:00:00Z", expiresAt: daysFromNow(23), activatedAt: "2026-02-15T00:00:00Z", hasSubscription: true, seatLimit: null },
  entitlementUnreadable: false,
  usage: readyUsage(),
  settings: settingsForPlan,
  rooftopLabel: "Example Motors",
  groupLabel: null,
  canManageBilling: true,
  canManageInvoices: true,
  isPlatformAdmin: false,
  seeds: {
    empty: {
      entitlement: { planTier: "starter", status: "active", trialEndsAt: null, expiresAt: daysFromNow(23), activatedAt: "2026-10-30T00:00:00Z", hasSubscription: true, seatLimit: null },
      usage: readyUsage({ metrics: {} }),
    },
    error: { entitlement: null, entitlementUnreadable: true, usage: { kind: "failed", reason: "Usage could not be read, so no count is shown. That is not the same as zero." } },
    readonly: { canManageBilling: false, canManageInvoices: false },
    stale: { usage: readyUsage({ updatedAt: minutesAgo(3 * 24 * 60) }) },
    trial: {
      entitlement: { planTier: "starter", status: "trial", trialEndsAt: daysFromNow(9), expiresAt: null, activatedAt: daysFromNow(-5), hasSubscription: false, seatLimit: null },
      usage: readyUsage({ metrics: { stickers_generated: { value: 142, events: 30, lastEventAt: minutesAgo(200) }, documents_published: { value: 12, events: 12, lastEventAt: minutesAgo(500) } } }),
    },
    suspended: {
      entitlement: { planTier: "pro", status: "paused", trialEndsAt: null, expiresAt: null, activatedAt: "2026-02-15T00:00:00Z", hasSubscription: true, seatLimit: null },
    },
    unlimited: {
      entitlement: { planTier: "compliance_pro", status: "active", trialEndsAt: null, expiresAt: daysFromNow(200), activatedAt: "2026-06-01T00:00:00Z", hasSubscription: true, seatLimit: null },
      usage: readyUsage({ metrics: { stickers_generated: { value: 3921, events: 410, lastEventAt: minutesAgo(12) }, documents_published: { value: 640, events: 640, lastEventAt: minutesAgo(20) }, template_customizations: { value: 31, events: 31, lastEventAt: minutesAgo(900) } } }),
      isPlatformAdmin: false,
    },
  },
};

export const WAVE_E_FIXTURES: Record<string, AdminScreenFixture> = {
  "v3-overview": { tabId: "overview", fixture: { label: "Wave E Administration overview", now: NOW, views: { overview } } },
  "v3-plan-usage": { tabId: "plan-features", fixture: { label: "Wave E Plan and usage", now: NOW, views: { "plan-usage": plan } } },
};
