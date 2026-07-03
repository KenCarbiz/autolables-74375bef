import {
  hasAnyDealerCapability,
  type DealerCapability,
  type DealerRole,
} from "@/lib/permissions/dealerRoleCapabilities";

// Declared here (not in Admin.tsx) so AppShell/CommandPalette/RouteCapabilityGuard
// can gate per-tab without importing the page module.
export type AdminTab =
  | "home"
  | "products"
  | "rules"
  | "settings"
  | "branding"
  | "labels"
  | "programs"
  | "analytics"
  | "leads"
  | "funnel"
  | "audit"
  | "queue"
  | "files"
  | "getready"
  | "inventory"
  | "invoices"
  | "warranty"
  | "factory-warranty"
  | "team"
  | "print-settings"
  | "document-rules"
  | "incentives"
  | "features"
  | "passport-ctas"
  | "passport-trust"
  | "passport-routing";

// Any-of semantics: holding ANY listed capability grants the tab.
export const TAB_CAPS: Record<AdminTab, DealerCapability[]> = {
  home: ["can_manage_settings", "can_view_reports"],
  settings: ["can_manage_settings"],
  branding: ["can_manage_settings"],
  labels: ["can_manage_settings"],
  "print-settings": ["can_manage_settings"],
  "document-rules": ["can_manage_settings"],
  features: ["can_manage_settings"],
  getready: ["can_manage_settings"],
  "passport-ctas": ["can_manage_settings"],
  "passport-trust": ["can_manage_settings"],
  "passport-routing": ["can_manage_settings", "can_manage_deals"],
  incentives: ["can_manage_settings", "can_manage_deals"],
  products: ["can_manage_settings", "can_manage_addons"],
  rules: ["can_manage_settings", "can_manage_addons"],
  programs: ["can_manage_settings", "can_manage_addons"],
  "factory-warranty": ["can_manage_settings", "can_manage_addons"],
  leads: ["can_manage_settings", "can_view_leads"],
  analytics: ["can_manage_settings", "can_view_reports"],
  funnel: ["can_manage_settings", "can_view_reports"],
  warranty: ["can_manage_settings", "can_view_reports"],
  queue: ["can_manage_settings", "can_view_print_queue"],
  audit: ["can_manage_settings", "can_view_compliance"],
  files: ["can_manage_settings", "can_view_compliance"],
  invoices: ["can_manage_settings", "can_manage_invoices"],
  team: ["can_manage_settings", "can_manage_team"],
  inventory: ["can_manage_settings"],
};

// Nav order — firstPermittedAdminTab lands the role on the earliest tab it holds.
export const ADMIN_TABS = Object.keys(TAB_CAPS) as AdminTab[];

export const isAdminTab = (value: string | null | undefined): value is AdminTab =>
  !!value && ADMIN_TABS.includes(value as AdminTab);

export const canSeeAdminTab = (role: DealerRole, tab: AdminTab, isAdmin = false): boolean =>
  hasAnyDealerCapability(role, TAB_CAPS[tab], isAdmin);

export const firstPermittedAdminTab = (role: DealerRole, isAdmin = false): AdminTab | null =>
  ADMIN_TABS.find((tab) => canSeeAdminTab(role, tab, isAdmin)) ?? null;
