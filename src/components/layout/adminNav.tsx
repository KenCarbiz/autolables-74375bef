// Shared admin left-navigation model. ONE source of truth for the sidebar's
// icons, ordering, section grouping, active-route matching, permission
// filtering, and badge formatting — consumed by AppShell (expanded, collapsed,
// and mobile drawer all read this same config). Icons are lucide-react only.

import {
  Sparkles,
  Radar,
  Tag,
  BadgeCheck,
  BarChart3,
  CarFront,
  ClipboardCheck,
  ClipboardList,
  Columns3,
  Handshake,
  Headset,
  LayoutDashboard,
  Printer,
  Rocket,
  ScrollText,
  Settings,
  ShieldCheck,
  Store,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { DealerCapability, DealerRole } from "@/lib/permissions/dealerRoleCapabilities";

export interface AdminNavItem {
  label: string;
  path: string;
  /** Lucide fallback. Retained so a row still renders if an asset id is wrong
   *  or the pack has not been installed on this build. */
  icon: LucideIcon;
  /** Id in the admin asset pack (ADMIN_ICON_PATHS), rendered by <AdminIcon>.
   *  The pack is the product's icon language; lucide was the placeholder. */
  assetIcon?: string;
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

/**
 * Which navigation a role gets. Technicians and third-party vendors work one
 * assignment list and nothing else; the vendor case is a containment
 * requirement, not a preference, so it is decided by role rather than left to
 * capability filtering alone — a mis-set capability must never hand an outside
 * company a door into dealer inventory, pricing or customer data.
 */
export type NavMode = "dealer" | "technician" | "vendor";

const TECHNICIAN_ROLES = new Set(["technician", "detail"]);
const VENDOR_ROLES = new Set(["third_party_vendor", "vendor"]);

export const navModeForRole = (role: DealerRole): NavMode => {
  const normalized = `${role || ""}`.trim().toLowerCase();
  if (VENDOR_ROLES.has(normalized)) return "vendor";
  if (TECHNICIAN_ROLES.has(normalized)) return "technician";
  return "dealer";
};

export interface BuildNavOptions {
  badges: NavBadgeValues;
  anyAdminTab: boolean;
  role?: DealerRole;
}

// The vendor's whole application: the work addressed to their company. Every
// path here resolves to VendorHome for this role, including /dashboard and
// /queue, so the row stays lit wherever the vendor lands.
const vendorSections = (): AdminNavSection[] => [
  {
    key: "main",
    title: "",
    defaultOpen: true,
    items: [
      {
        label: "My Assignments",
        assetIcon: "093AC",
        path: "/home/vendor",
        icon: ClipboardList,
        capability: "can_complete_get_ready",
        match: (p) => p === "/home/vendor" || p === "/dashboard" || p === "/queue",
      },
    ],
  },
];

// The technician's bench plus the board that tells them where a vehicle went.
// No administration, no pricing, no customers.
const technicianSections = (): AdminNavSection[] => [
  {
    key: "main",
    title: "",
    defaultOpen: true,
    items: [
      {
        label: "My Work",
        assetIcon: "061AC",
        path: "/home/technician",
        icon: ClipboardList,
        capability: "can_view_work_queue",
        match: (p) =>
          p === "/home/technician" ||
          p === "/dashboard" ||
          underSegment("/service/vehicle")(p) ||
          underSegment("/service-inspection")(p),
      },
      {
        label: "Ready Board",
        assetIcon: "055AC",
        path: "/ready-board",
        icon: Columns3,
        capability: "can_view_get_ready",
        match: underSegment("/ready-board"),
      },
    ],
  },
];

export function buildAdminNavSections({ badges, anyAdminTab, role }: BuildNavOptions): AdminNavSection[] {
  const mode = navModeForRole(role);
  if (mode === "vendor") return vendorSections();
  if (mode === "technician") return technicianSections();

  return [
    {
      key: "main",
      title: "",
      defaultOpen: true,
      items: [
        {
          label: "Home",
          assetIcon: "010AC",
          path: "/dashboard",
          icon: LayoutDashboard,
          capability: "can_view_dashboard",
          // Home resolves per role, so every named role board is still Home.
          match: (p) => p === "/dashboard" || p === "/dashboard/classic" || underSegment("/home")(p),
        },
      ],
    },
    {
      key: "inventory",
      title: "INVENTORY",
      defaultOpen: true,
      items: [
        {
          label: "Inventory",
          assetIcon: "011AC",
          path: "/inventory",
          icon: CarFront,
          capability: "can_view_inventory",
          // The vehicle detail page lives outside /inventory in the route model
          // but is reached from Inventory, so it keeps the parent lit.
          // VIN Command Center is per-vehicle and has no top-level row, so it
          // keeps Inventory lit the same way the vehicle file does.
          match: (p) =>
            underSegment("/inventory")(p) ||
            p === "/inventory-v2" ||
            p === "/add-inventory" ||
            p.startsWith("/vehicle-file/") ||
            underSegment("/vin-command")(p),
        },
        {
          label: "Inventory Intelligence",
          assetIcon: "141AC",
          path: "/inventory-intelligence",
          icon: Radar,
          capability: "can_view_inventory",
          match: underSegment("/inventory-intelligence"),
        },
        // The document families are not interchangeable, so each production
        // destination is named for exactly what it produces. "New Car
        // Sticker" is deliberately absent: it read as either a manufacturer
        // reproduction or a dealer addendum, which are different documents.
        {
          label: "OEM Window Sticker Studio",
          assetIcon: "041AC",
          path: "/window-sticker-studio",
          icon: Tag,
          capability: "can_create_documents",
          match: (p) =>
            p.startsWith("/window-sticker-studio") ||
            p.startsWith("/factory-sticker") ||
            p.startsWith("/new-car-sticker"),
        },
        // Description work is exception-driven and visited daily, so it earns a
        // row of its own rather than living only behind the Create control.
        {
          label: "Description Operations",
          assetIcon: "037AC",
          path: "/description-operations",
          icon: Sparkles,
          capability: "can_create_documents",
          match: (p) =>
            p.startsWith("/description-operations") ||
            p.startsWith("/description-intelligence") ||
            p.startsWith("/description-writer") ||
            p.startsWith("/description-studio"),
        },
      ],
    },
    {
      key: "mywork",
      title: "MY WORK",
      defaultOpen: true,
      items: [
        { label: "Work Queue", assetIcon: "012AC", path: "/queue", icon: ClipboardList, capability: "can_view_work_queue", badge: badgeOrUndefined(badges.workQueue), match: underSegment("/queue") },
        // Gate on the same capability the page itself checks. Every role that
        // holds can_print also holds can_view_print_queue, so this only widens
        // the row to the read-only roles the page already admits.
        { label: "Print Center", assetIcon: "045AC", path: "/print-center", icon: Printer, capability: "can_view_print_queue", match: (p) => underSegment("/print-center")(p) || underSegment("/print-queue")(p) },
        // Billing paperwork is a daily job for the office, not a setting, so it
        // sits with the other worklists — and only for the roles that hold it.
        { label: "Invoices", assetIcon: "106AC", path: "/admin?tab=invoices", icon: ScrollText, capability: "can_manage_invoices" },
      ],
    },
    {
      key: "getready",
      title: "GET READY",
      defaultOpen: true,
      items: [
        { label: "Get Ready Command", assetIcon: "013AC", path: "/get-ready-command", icon: Rocket, capability: "can_view_get_ready", match: underSegment("/get-ready-command") },
        // The writer's own desk. Narrowly gated so it appears for the people who
        // dispatch service work and for nobody else.
        { label: "Service Writer Desk", assetIcon: "062AC", path: "/service-desk", icon: ClipboardCheck, capability: "can_assign_service_work", match: underSegment("/service-desk") },
        { label: "Service Desk", assetIcon: "060AC", path: "/service", icon: Headset, capability: "can_view_get_ready", match: (p) => underSegment("/service")(p) || underSegment("/service-inspection")(p) },
        { label: "Prep & Vendors", assetIcon: "053AC", path: "/prep", icon: Wrench, capability: "can_view_get_ready", match: underSegment("/prep") },
        { label: "Ready Board", assetIcon: "055AC", path: "/ready-board", icon: Columns3, capability: "can_view_get_ready", match: underSegment("/ready-board") },
        { label: "Recon Approvals", assetIcon: "052AC", path: "/recon", icon: BadgeCheck, capability: "can_view_get_ready", badge: badgeOrUndefined(badges.reconApprovals), match: underSegment("/recon") },
      ],
    },
    {
      key: "customers",
      title: "CUSTOMERS",
      defaultOpen: true,
      items: [
        // One customer book. /leads is the same workspace and keeps working, so
        // the row has to light on both. Deliberately NOT gated on
        // feature_lead_capture: the records exist whether or not the dealer
        // runs lead-capture forms, and a customer file no one can navigate
        // back to is a dead end.
        { label: "Customers", assetIcon: "014AC", path: "/customers", icon: Users, capability: "can_view_leads", badge: badgeOrUndefined(badges.leads), match: (p) => underSegment("/customers")(p) || underSegment("/leads")(p) },
        // An addendum IS the deal. The saved/signed/delivered/returns stages are
        // the same record set under their older URLs.
        { label: "Deals", assetIcon: "105AC", path: "/deals", icon: Handshake, capability: "can_view_deals", badge: badgeOrUndefined(badges.returns), match: (p) => underSegment("/deals")(p) || underSegment("/saved")(p) || underSegment("/signed")(p) || underSegment("/delivered")(p) || underSegment("/returns")(p) || underSegment("/signatures")(p) },
      ],
    },
    {
      key: "compliance",
      title: "COMPLIANCE",
      defaultOpen: true,
      items: [
        // ONE row for one surface. Compliance Center, Compliance Tasks, Price
        // Change Review, Audit Log and Titles were five rows onto the same
        // ComplianceShell, which made the dealer choose a module before they
        // could look at a problem. The shell's own tabs are the navigation
        // inside it, and the legacy URLs still open on their old section.
        // The count is both open queues; each tab carries its own exact number.
        {
          label: "Compliance",
          assetIcon: "015AC",
          path: "/compliance",
          icon: ShieldCheck,
          capability: "can_view_compliance",
          badge: badgeOrUndefined(badges.complianceTasks + badges.priceChangeReview),
          match: (p) =>
            underSegment("/compliance")(p) ||
            underSegment("/compliance-center")(p) ||
            underSegment("/titles")(p) ||
            underSegment("/dashboard/document-review")(p),
        },
      ],
    },
    {
      key: "reports",
      title: "REPORTS",
      defaultOpen: true,
      items: [
        {
          label: "Reports",
          assetIcon: "016AC",
          path: "/dashboard/reports",
          icon: BarChart3,
          capability: "can_view_reports",
          match: (p) => underSegment("/dashboard/reports")(p) || underSegment("/dashboard/qr-analytics")(p),
        },
      ],
    },
    {
      key: "settings",
      title: "SETTINGS",
      defaultOpen: true,
      items: [
        // Settings is the /admin hub for every tab except Invoices, which has
        // its own row in MY WORK and wins that tab.
        ...(anyAdminTab
          ? [{ label: "Settings", assetIcon: "017AC", path: "/admin", icon: Settings, match: (p: string, s: string) => underSegment("/admin")(p) && s !== "?tab=invoices" }]
          : []),
      ],
    },
    {
      key: "platform",
      title: "PLATFORM",
      defaultOpen: false,
      items: [
        { label: "Platform Admin", assetIcon: "145AC", path: "/platform-admin", icon: Store, requireAdmin: true, match: underSegment("/platform-admin") },
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
