// Shared admin left-navigation model. ONE source of truth for the sidebar's
// icons, ordering, section grouping, active-route matching, permission
// filtering, and badge formatting — consumed by AppShell (expanded, collapsed,
// and mobile drawer all read this same config). Icons are lucide-react only.

import {
  BadgeCheck,
  BadgeDollarSign,
  BarChart3,
  CarFront,
  ClipboardList,
  Columns3,
  FilePlus2,
  FileText,
  Handshake,
  Headset,
  History,
  LayoutDashboard,
  ListChecks,
  ScrollText,
  Settings,
  ShieldCheck,
  Store,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { DealerCapability } from "@/lib/permissions/dealerRoleCapabilities";

export interface AdminNavItem {
  label: string;
  path: string;
  icon: LucideIcon;
  /**
   * Explicit active matcher for nested routes. When present it decides active
   * state (search is `location.search`, e.g. "?tab=audit"); when absent the
   * item matches its own path exactly, including any `?tab=` query on `path`.
   */
  match?: (pathname: string, search: string) => boolean;
  badge?: number;
  featureKey?: string;
  requireManager?: boolean;
  requireAdmin?: boolean;
  capability?: DealerCapability;
}

export interface AdminNavSection {
  key: string;
  title: string;
  defaultOpen?: boolean;
  items: AdminNavItem[];
}

export interface NavBadgeValues {
  workQueue: number;
  leads: number;
  reconApprovals: number;
  priceChangeReview: number;
  complianceTasks: number;
  returns: number;
}

// pathname === base, or a child segment of base — never a sibling that merely
// shares a prefix (e.g. "/service" must not light up on "/service-inspection").
const underSegment = (base: string) => (pathname: string) =>
  pathname === base || pathname.startsWith(`${base}/`);

const badgeOrUndefined = (n: number) => (n > 0 ? n : undefined);

export interface BuildNavOptions {
  badges: NavBadgeValues;
  anyAdminTab: boolean;
}

export function buildAdminNavSections({ badges, anyAdminTab }: BuildNavOptions): AdminNavSection[] {
  return [
    {
      key: "main",
      title: "",
      defaultOpen: true,
      items: [
        { label: "Home", path: "/dashboard", icon: LayoutDashboard, capability: "can_view_dashboard" },
        {
          label: "Inventory",
          path: "/inventory",
          icon: CarFront,
          capability: "can_view_inventory",
          // The vehicle detail page lives outside /inventory in the route model
          // but is reached from Inventory, so it keeps the parent lit.
          match: (p) => underSegment("/inventory")(p) || p === "/inventory-v2" || p.startsWith("/vehicle-file/"),
        },
        { label: "Deals", path: "/saved", icon: Handshake, capability: "can_view_deals", badge: badgeOrUndefined(badges.returns), match: underSegment("/saved") },
      ],
    },
    {
      key: "create",
      title: "CREATE",
      defaultOpen: true,
      items: [
        { label: "Create", path: "/create", icon: FilePlus2, capability: "can_create_documents", match: underSegment("/create") },
      ],
    },
    {
      key: "work",
      title: "WORK",
      defaultOpen: true,
      items: [
        { label: "Work Queue", path: "/queue", icon: ClipboardList, capability: "can_view_work_queue", badge: badgeOrUndefined(badges.workQueue), match: underSegment("/queue") },
        { label: "Leads", path: "/leads", icon: Users, capability: "can_view_leads", featureKey: "feature_lead_capture", badge: badgeOrUndefined(badges.leads), match: underSegment("/leads") },
      ],
    },
    {
      key: "getready",
      title: "GET READY",
      defaultOpen: true,
      items: [
        { label: "Recon Approvals", path: "/recon", icon: BadgeCheck, capability: "can_view_get_ready", badge: badgeOrUndefined(badges.reconApprovals), match: underSegment("/recon") },
        { label: "Prep & Install", path: "/prep", icon: Wrench, capability: "can_view_get_ready", match: underSegment("/prep") },
        { label: "Service Desk", path: "/service", icon: Headset, capability: "can_view_get_ready", match: underSegment("/service") },
        { label: "Ready Board", path: "/ready-board", icon: Columns3, capability: "can_view_get_ready", match: underSegment("/ready-board") },
      ],
    },
    {
      key: "compliance",
      title: "COMPLIANCE",
      defaultOpen: false,
      items: [
        { label: "Compliance Center", path: "/compliance", icon: ShieldCheck, capability: "can_view_compliance", match: underSegment("/compliance") },
        { label: "Compliance Tasks", path: "/compliance-center", icon: ListChecks, capability: "can_manage_compliance", badge: badgeOrUndefined(badges.complianceTasks), match: underSegment("/compliance-center") },
        { label: "Price Change Review", path: "/dashboard/document-review", icon: BadgeDollarSign, capability: "can_view_compliance", badge: badgeOrUndefined(badges.priceChangeReview), match: underSegment("/dashboard/document-review") },
        { label: "Audit Log", path: "/admin?tab=audit", icon: History, capability: "can_view_compliance" },
      ],
    },
    {
      key: "office",
      title: "OFFICE",
      defaultOpen: false,
      items: [
        { label: "Titles", path: "/titles", icon: FileText, capability: "can_view_compliance", match: underSegment("/titles") },
        { label: "Invoices", path: "/admin?tab=invoices", icon: ScrollText, capability: "can_manage_invoices" },
      ],
    },
    {
      key: "settings",
      title: "SETTINGS",
      defaultOpen: false,
      items: [
        // Settings is the /admin hub for every tab except the two broken out
        // into their own rows (Audit Log, Invoices), which win those tabs.
        ...(anyAdminTab
          ? [{ label: "Settings", path: "/admin", icon: Settings, match: (p: string, s: string) => p === "/admin" && s !== "?tab=audit" && s !== "?tab=invoices" }]
          : []),
        { label: "Reports", path: "/dashboard/reports", icon: BarChart3, capability: "can_view_reports" },
      ],
    },
    {
      key: "platform",
      title: "PLATFORM",
      defaultOpen: false,
      items: [
        { label: "Platform Admin", path: "/platform-admin", icon: Store, requireAdmin: true, match: underSegment("/platform-admin") },
      ],
    },
  ];
}

export function isNavItemActive(item: AdminNavItem, pathname: string, search: string): boolean {
  if (item.match) return item.match(pathname, search);
  const [itemPath, query = ""] = item.path.split("?");
  if (pathname !== itemPath) return false;
  if (!query) return true;
  return search === `?${query}`;
}

// The single active leaf across all sections. Only this item gets
// aria-current="page"; matchers are authored to be mutually exclusive, and
// first-match wins as a hard guarantee.
export function findActiveNavItem(sections: AdminNavSection[], pathname: string, search: string): AdminNavItem | undefined {
  for (const section of sections) {
    for (const item of section.items) {
      if (isNavItemActive(item, pathname, search)) return item;
    }
  }
  return undefined;
}

export interface NavPermissionContext {
  isAdmin: boolean;
  isManager: boolean;
  can: (c: DealerCapability) => boolean;
  hasFeature: (featureKey: string) => boolean;
}

export function filterNavSections(sections: AdminNavSection[], ctx: NavPermissionContext): AdminNavSection[] {
  const keep = (item: AdminNavItem) =>
    (!item.featureKey || ctx.hasFeature(item.featureKey)) &&
    (ctx.isAdmin || !item.capability || ctx.can(item.capability)) &&
    (!item.requireManager || ctx.isManager) &&
    (!item.requireAdmin || ctx.isAdmin);
  return sections
    .map((section) => ({ ...section, items: section.items.filter(keep) }))
    .filter((section) => section.items.length > 0);
}

// Compact pill text: hidden below 1, capped at "99+".
export function formatBadgeCount(count: number | undefined): string | null {
  if (!count || count <= 0) return null;
  return count > 99 ? "99+" : String(count);
}

export function badgeAriaLabel(label: string, count: number): string {
  return `${count} ${label.toLowerCase()} pending`;
}
