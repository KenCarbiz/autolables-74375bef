import { TAB_CAPS, type AdminTab } from "@/lib/permissions/adminTabAccess";
import { hasAnyDealerCapability, type DealerCapability, type DealerRole } from "@/lib/permissions/dealerRoleCapabilities";

// The Administration V2 information architecture: eight parent sections, each
// with one row of child tabs. Every legacy `?tab=` id either resolves to a
// child tab here (an alias) or to a standalone screen (a redirect), so no
// bookmark, command-palette entry or operational link is stranded.
//
// A child tab that still renders its pre-V2 body names that body in
// `legacyTab`; the page embeds the legacy renderer for it until a V2 view
// takes over. Capabilities default to the union of the legacy tabs a child
// absorbs, so reorganising the navigation never widens who can see what.

export type AdminSectionId =
  | "overview"
  | "brand"
  | "people"
  | "pricing"
  | "customer-experience"
  | "publishing"
  | "documents"
  | "integrations";

export type AdminFeatureKey = "feature_product_rules" | "feature_invoicing" | "feature_warranty";

export interface AdminChildTab {
  /** Canonical `?tab=` value. */
  id: string;
  label: string;
  /** Legacy `?tab=` ids that resolve to this tab. */
  aliases?: AdminTab[];
  /** Pre-V2 body this tab renders until a V2 view replaces it. */
  legacyTab?: AdminTab;
  /** Any-of capability set; derived from the legacy tabs when absent. */
  capabilities?: DealerCapability[];
  /** Dealer feature toggle that must be on for the tab to appear. */
  featureKey?: AdminFeatureKey;
  /** Not in the reference screen set; kept so nothing disappears. */
  unpictured?: boolean;
  /** Platform admins only (never shown to dealer roles). */
  platformOnly?: boolean;
}

export interface AdminSection {
  id: AdminSectionId;
  label: string;
  description: string;
  /** Page title when the approved mock does not title the page "Administration". */
  heading?: string;
  /** Second heading the mock draws between the section row and the child tabs. */
  subheading?: string;
  /** Header lines the approved mock draws above the section row; the h1 is always shown. */
  intro?: { breadcrumb?: boolean; description?: boolean };
  tabs: AdminChildTab[];
}

export const ADMIN_SECTIONS: readonly AdminSection[] = [
  {
    id: "overview",
    label: "Overview",
    description: "Setup, policies and operational health for this rooftop.",
    intro: { breadcrumb: true, description: true },
    tabs: [{ id: "overview", label: "Overview", aliases: ["home"], legacyTab: "home" }],
  },
  {
    id: "brand",
    label: "Dealership & Brand",
    heading: "Dealership & Brand",
    description: "Dealer identity and public brand configuration.",
    tabs: [
      { id: "identity", label: "Identity", aliases: ["branding"], legacyTab: "branding" },
      { id: "appearance", label: "Appearance", capabilities: ["can_manage_settings"] },
      { id: "hours-contact", label: "Hours & Contact", capabilities: ["can_manage_settings"] },
      { id: "why-buy", label: "Why Buy", aliases: ["passport-trust"], legacyTab: "passport-trust" },
      { id: "websites-feeds", label: "Websites & feeds", capabilities: ["can_manage_settings"], unpictured: true },
      { id: "document-defaults", label: "Document defaults", capabilities: ["can_manage_settings"], unpictured: true },
      { id: "store-settings", label: "Store settings", aliases: ["settings"], legacyTab: "settings", unpictured: true },
    ],
  },
  {
    id: "people",
    label: "People & Access",
    heading: "People & Access",
    description: "Team membership, roles, scope and readiness.",
    tabs: [
      { id: "team", label: "Team", aliases: ["team"], legacyTab: "team" },
      { id: "roles", label: "Roles", capabilities: ["can_manage_settings", "can_manage_team"] },
      { id: "invitations", label: "Invitations", capabilities: ["can_manage_settings", "can_manage_team"] },
      { id: "access-activity", label: "Access activity", capabilities: ["can_manage_settings", "can_manage_team"] },
    ],
  },
  {
    id: "pricing",
    label: "Pricing & Products",
    description: "Price policy, products and evidence integrity.",
    tabs: [
      { id: "price-rules", label: "Price rules", aliases: ["incentives"], legacyTab: "incentives" },
      { id: "products", label: "Products", aliases: ["products"], legacyTab: "products" },
      { id: "applicability", label: "Applicability", aliases: ["rules"], legacyTab: "rules", featureKey: "feature_product_rules", unpictured: true },
      { id: "benefits", label: "Benefits", aliases: ["programs"], legacyTab: "programs" },
      { id: "warranty-programs", label: "Warranty programs", aliases: ["factory-warranty"], legacyTab: "factory-warranty" },
      { id: "warranty-records", label: "Warranty records", aliases: ["warranty"], legacyTab: "warranty", featureKey: "feature_warranty", unpictured: true },
      { id: "incentive-programs", label: "Incentives", capabilities: ["can_manage_settings", "can_manage_deals"], unpictured: true },
    ],
  },
  {
    id: "customer-experience",
    label: "Customer Experience",
    description: "Routing, fallback, response and customer contact policy.",
    tabs: [
      { id: "routing", label: "Contact & Routing", aliases: ["passport-routing"], legacyTab: "passport-routing" },
      { id: "passport-modules", label: "Passport modules", aliases: ["passport-ctas"], legacyTab: "passport-ctas" },
      { id: "calls-to-action", label: "Calls to action", capabilities: ["can_manage_settings"] },
      { id: "customer-previews", label: "Customer previews", capabilities: ["can_manage_settings", "can_manage_deals"] },
    ],
  },
  {
    id: "publishing",
    label: "Publishing",
    heading: "Publishing policy",
    description: "Effective listing, document and signing policies.",
    intro: { breadcrumb: true, description: true },
    tabs: [
      { id: "effective-policy", label: "Effective policy", capabilities: ["can_manage_settings", "can_view_compliance"] },
      { id: "approvals", label: "Approvals", capabilities: ["can_manage_settings", "can_view_compliance"] },
      { id: "destinations", label: "Destinations", aliases: ["merchandising-seo"], legacyTab: "merchandising-seo" },
      { id: "change-history", label: "Change history", capabilities: ["can_manage_settings", "can_view_compliance"] },
    ],
  },
  {
    id: "documents",
    label: "Documents & Service",
    heading: "Documents & Service",
    description: "Document, service, approval and version policy.",
    intro: { breadcrumb: true },
    tabs: [
      { id: "templates", label: "Templates", aliases: ["labels"], legacyTab: "labels" },
      { id: "approval-rules", label: "Approval rules", aliases: ["document-rules"], legacyTab: "document-rules" },
      { id: "print-calibration", label: "Print & Calibration", aliases: ["print-settings"], legacyTab: "print-settings" },
      { id: "service-policy", label: "Service policy", aliases: ["getready"], legacyTab: "getready" },
    ],
  },
  {
    id: "integrations",
    label: "Integrations",
    subheading: "Integrations & Data",
    description: "System, provider, feed and job health center.",
    tabs: [
      { id: "inventory-feed", label: "Inventory feed", aliases: ["inventory"], capabilities: ["can_manage_settings"] },
      { id: "providers", label: "Providers", capabilities: ["can_manage_settings"] },
      { id: "data-quality", label: "Data quality", capabilities: ["can_manage_settings", "can_view_compliance"] },
      { id: "jobs", label: "Jobs & Pipelines", capabilities: ["can_manage_settings"], unpictured: true },
      { id: "activity", label: "Activity", aliases: ["audit"], legacyTab: "audit" },
      { id: "vehicle-files", label: "Vehicle files", aliases: ["files"], legacyTab: "files", unpictured: true },
      { id: "plan-features", label: "Plan & features", aliases: ["features"], legacyTab: "features", unpictured: true },
      { id: "invoices", label: "Invoices", aliases: ["invoices"], legacyTab: "invoices", featureKey: "feature_invoicing", unpictured: true },
    ],
  },
];

/** Legacy tab ids whose content moved to a standalone screen. */
export const LEGACY_TAB_REDIRECTS: Readonly<Record<string, string>> = {
  analytics: "/dashboard/reports?tab=analytics",
  funnel: "/dashboard/reports?tab=signings",
  leads: "/leads",
  queue: "/queue",
};

export const ADMIN_CHILD_ROUTES = {
  memberRole: (memberId: string) => `/admin/people/${encodeURIComponent(memberId)}`,
  feeReview: "/admin/pricing/fee-review",
  pricingIntegrity: "/admin/pricing/integrity",
  vehicleFiles: "/admin/integrations/vehicle-files",
  jobs: "/admin/integrations/jobs",
  accessActivity: "/admin/access/activity",
  permissionVerification: "/admin/access/permission-verification",
  contactRouting: "/admin/customer-experience/contact-routing",
  legacyAssignments: "/admin/brand/legacy-store-assignments",
  connections: "/admin/integrations/connections",
  workerSetup: "/admin/integrations/worker-setup",
  productApplicability: (productId: string) => `/admin/products/${encodeURIComponent(productId)}/applicability`,
  escalation: "/admin/customer-experience/escalation",
  customerPreview: "/admin/customer-experience/preview",
  printCalibration: "/admin/documents/print-calibration",
  paymentEstimator: "/admin/brand/payment-estimator",
  paymentAssumptions: "/admin/brand/payment-assumptions",
  syncRun: (runId: string) => `/admin/integrations/runs/${encodeURIComponent(runId)}`,
  providerDetail: (providerId: string) => `/admin/integrations/providers/${encodeURIComponent(providerId)}`,
  jobDetail: (jobId: string) => `/admin/integrations/jobs/${encodeURIComponent(jobId)}`,
} as const;

export const adminTabHref = (tabId: string, panel?: string | null): string =>
  `/admin?tab=${encodeURIComponent(tabId)}${panel ? `&panel=${encodeURIComponent(panel)}` : ""}`;

const unique = <T,>(xs: T[]): T[] => Array.from(new Set(xs));

export const capabilitiesForTab = (tab: AdminChildTab): DealerCapability[] => {
  if (tab.capabilities?.length) return tab.capabilities;
  const legacy = unique([...(tab.aliases ?? []), ...(tab.legacyTab ? [tab.legacyTab] : [])]);
  return unique(legacy.flatMap((id) => TAB_CAPS[id] ?? []));
};

export type AdminFeatureFlags = Partial<Record<AdminFeatureKey, boolean>>;

export interface AdminVisibilityContext {
  role: DealerRole;
  isAdmin: boolean;
  features?: AdminFeatureFlags;
}

export const canSeeTab = (tab: AdminChildTab, ctx: AdminVisibilityContext): boolean => {
  if (tab.platformOnly && !ctx.isAdmin) return false;
  if (tab.featureKey && ctx.features && ctx.features[tab.featureKey] === false) return false;
  const caps = capabilitiesForTab(tab);
  if (caps.length === 0) return ctx.isAdmin;
  return hasAnyDealerCapability(ctx.role, caps, ctx.isAdmin);
};

export const visibleTabs = (section: AdminSection, ctx: AdminVisibilityContext): AdminChildTab[] =>
  section.tabs.filter((t) => canSeeTab(t, ctx));

export const canSeeSection = (section: AdminSection, ctx: AdminVisibilityContext): boolean =>
  visibleTabs(section, ctx).length > 0;

export const visibleSections = (ctx: AdminVisibilityContext): AdminSection[] =>
  ADMIN_SECTIONS.filter((s) => canSeeSection(s, ctx));

export interface ResolvedAdminTab {
  section: AdminSection;
  tab: AdminChildTab;
  /** The id came in as a legacy alias and was translated. */
  viaAlias: boolean;
}

/** Find a tab by its canonical id or any legacy alias. */
export function resolveAdminTab(id: string | null | undefined): ResolvedAdminTab | null {
  if (!id) return null;
  for (const section of ADMIN_SECTIONS) {
    for (const tab of section.tabs) {
      if (tab.id === id) return { section, tab, viaAlias: false };
    }
  }
  for (const section of ADMIN_SECTIONS) {
    for (const tab of section.tabs) {
      if (tab.aliases?.includes(id as AdminTab)) return { section, tab, viaAlias: true };
    }
  }
  return null;
}

export const findSection = (id: AdminSectionId): AdminSection =>
  ADMIN_SECTIONS.find((s) => s.id === id) as AdminSection;

export const sectionForTab = (tabId: string): AdminSection | null => resolveAdminTab(tabId)?.section ?? null;

/** The first tab of a section the viewer may open, or null when none. */
export const firstVisibleTab = (section: AdminSection, ctx: AdminVisibilityContext): AdminChildTab | null =>
  visibleTabs(section, ctx)[0] ?? null;

/** Where `/admin` lands with no tab: Overview when permitted, else the first visible tab anywhere. */
export function defaultAdminTab(ctx: AdminVisibilityContext): AdminChildTab | null {
  for (const section of ADMIN_SECTIONS) {
    const tab = firstVisibleTab(section, ctx);
    if (tab) return tab;
  }
  return null;
}

/**
 * Resolve a `?tab=` parameter into what the page should show. Unknown ids and
 * ids the viewer may not open fall back to the default, never to a blank page.
 */
export function resolveAdminLocation(
  param: string | null | undefined,
  ctx: AdminVisibilityContext,
): { kind: "redirect"; to: string } | { kind: "tab"; resolved: ResolvedAdminTab; fallback: boolean } | { kind: "none" } {
  if (param && LEGACY_TAB_REDIRECTS[param]) return { kind: "redirect", to: LEGACY_TAB_REDIRECTS[param] };
  const direct = resolveAdminTab(param);
  if (direct && canSeeTab(direct.tab, ctx)) return { kind: "tab", resolved: direct, fallback: false };
  const fallbackTab = defaultAdminTab(ctx);
  if (!fallbackTab) return { kind: "none" };
  const resolved = resolveAdminTab(fallbackTab.id) as ResolvedAdminTab;
  return { kind: "tab", resolved, fallback: true };
}

/** Every legacy `?tab=` id, with where it now resolves. For the alias table and its test. */
export function legacyAliasTable(): Array<{ legacy: AdminTab; section: AdminSectionId | null; tab: string | null; redirect: string | null }> {
  const legacyIds = Object.keys(TAB_CAPS) as AdminTab[];
  return legacyIds.map((legacy) => {
    const redirect = LEGACY_TAB_REDIRECTS[legacy] ?? null;
    const resolved = resolveAdminTab(legacy);
    return { legacy, section: resolved?.section.id ?? null, tab: resolved?.tab.id ?? null, redirect };
  });
}
