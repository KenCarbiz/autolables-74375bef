// Shared admin left-navigation model. ONE source of truth for the rail's
// groups, icons, ordering, active-route matching, permission filtering and
// badge formatting -- consumed by AppRail (desktop rail and mobile drawer are
// the same element) and by the Admin role preview.
//
// Dealer navigation is eight groups plus the pinned Platform console. Each
// group's items are the destinations (leaves); the rail draws a group as one
// row that opens its first permitted leaf, and lists the leaves under it only
// while one of them is the current page.

import type { ComponentType, SVGProps } from "react";
import {
  Sparkles,
  Radar,
  Tag,
  BadgeCheck,
  BarChart3,
  Car,
  CarFront,
  ClipboardCheck,
  ClipboardList,
  Columns3,
  FilePlus2,
  Folder,
  Grid2X2,
  Handshake,
  Headset,
  House,
  LayoutDashboard,
  Printer,
  Rocket,
  ScrollText,
  Settings,
  ShieldCheck,
  Terminal,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { hasDealerCapability, type DealerCapability, type DealerRole } from "@/lib/permissions/dealerRoleCapabilities";
import { visibleSections, type AdminFeatureKey } from "@/lib/admin/sections";

export type RailGlyph = ComponentType<{ className?: string; strokeWidth?: number | string; "aria-hidden"?: boolean | "true" | "false" }>;

// The mock draws Reports as three outlined, touching bars on a baseline
// (short, tallest, medium); lucide has no such glyph.
export function ReportsBarsIcon({ strokeWidth = 1.75, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={24}
      height={24}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M4.5 20v-8h5v8M9.5 20V4h5v16M14.5 20V7h5v13M3.5 20h17" />
    </svg>
  );
}

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
  /** Section key the rail lights while this item is the current page, when
   *  that is not the section the item is listed under. */
  litSection?: string;
  badge?: number;
  featureKey?: string;
  requireManager?: boolean;
  requireAdmin?: boolean;
  capability?: DealerCapability;
}

export interface AdminNavSection {
  key: string;
  /** The group's rail label. Empty for the flat technician and vendor lists. */
  title: string;
  /** The group's rail glyph, drawn in place of the leaves' own icons. */
  icon?: RailGlyph;
  /** Drawn at the bottom of the rail under a divider, not in the list. */
  pinned?: boolean;
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
      key: "today",
      title: "Today",
      icon: House,
      items: [
        {
          label: "Today",
          assetIcon: "010AC",
          path: "/dashboard",
          icon: LayoutDashboard,
          capability: "can_view_dashboard",
          // Today resolves per role, so every named role board is still Today.
          match: (p) => p === "/dashboard" || p === "/dashboard/classic" || underSegment("/home")(p),
        },
      ],
    },
    {
      key: "vehicles",
      title: "Vehicles",
      icon: CarFront,
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
          match: (p, s) =>
            underSegment("/inventory")(p) ||
            p === "/inventory-v2" ||
            p === "/add-inventory" ||
            (p.startsWith("/vehicle-file/") && !/[?&]tab=(getready|compliance)\b/.test(s)) ||
            underSegment("/vin-command")(p) ||
            underSegment("/window-sticker-studio")(p) ||
            underSegment("/description-operations")(p) ||
            /^\/(print-center|factory-sticker)\/[^/]+/.test(p),
        },
        {
          label: "Inventory Intelligence",
          assetIcon: "141AC",
          path: "/inventory-intelligence",
          icon: Radar,
          capability: "can_view_inventory",
          match: underSegment("/inventory-intelligence"),
        },
        { label: "Work Queue", assetIcon: "012AC", path: "/queue", icon: ClipboardList, capability: "can_view_work_queue", badge: badgeOrUndefined(badges.workQueue), match: underSegment("/queue") },
      ],
    },
    {
      key: "merchandising",
      title: "Merchandising",
      icon: Tag,
      items: [
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
        // Gate on the same capability the page itself checks. Every role that
        // holds can_print also holds can_view_print_queue, so this only widens
        // the row to the read-only roles the page already admits.
        { label: "Print Center", assetIcon: "045AC", path: "/print-center", icon: Printer, capability: "can_view_print_queue", match: (p) => underSegment("/print-center")(p) || underSegment("/print-queue")(p) },
      ],
    },
    {
      key: "getready",
      title: "Get Ready",
      icon: Wrench,
      items: [
        { label: "Get Ready Command", assetIcon: "013AC", path: "/get-ready-command", icon: Rocket, capability: "can_view_get_ready", match: (p, s) => underSegment("/get-ready-command")(p) || (p.startsWith("/vehicle-file/") && /[?&]tab=getready\b/.test(s)) },
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
      title: "Customers & Deals",
      icon: Users,
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
        // Billing paperwork is the deal's paperwork, so it sits with the deals,
        // and only for the roles that hold it. Same feature switch as the Admin
        // V2 invoices tab, or the row would open the fallback tab while lit.
        // Its screens are installer invoices paid out of reconditioning, so the
        // rail lights Get Ready while the row stays where the role can open it.
        { label: "Invoices", assetIcon: "106AC", path: "/invoices", icon: ScrollText, capability: "can_manage_invoices", featureKey: "feature_invoicing", litSection: "getready", match: (p, s) => underSegment("/invoices")(p) || (p === "/admin" && s === "?tab=invoices") },
      ],
    },
    {
      key: "compliance",
      title: "Compliance",
      icon: ShieldCheck,
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
          match: (p, s) =>
            (p.startsWith("/vehicle-file/") && /[?&]tab=compliance\b/.test(s)) ||
            underSegment("/compliance")(p) ||
            underSegment("/compliance-center")(p) ||
            underSegment("/titles")(p) ||
            underSegment("/dashboard/document-review")(p),
        },
      ],
    },
    {
      key: "reports",
      title: "Reports",
      icon: ReportsBarsIcon,
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
      key: "administration",
      title: "Administration",
      icon: Settings,
      items: [
        // Administration is the /admin hub for every tab except Invoices, which
        // has its own row under Customers & Deals and wins that tab.
        ...(anyAdminTab
          ? [{ label: "Administration", assetIcon: "017AC", path: "/admin", icon: Settings, match: (p: string, s: string) => underSegment("/admin")(p) && s !== "?tab=invoices" }]
          : []),
      ],
    },
    {
      key: "platform",
      title: "Platform console",
      icon: Terminal,
      pinned: true,
      items: [
        { label: "Platform console", assetIcon: "145AC", path: "/platform-admin", icon: Terminal, requireAdmin: true, match: underSegment("/platform-admin") },
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

/** A group row opens its first permitted leaf. */
export function groupHref(section: AdminNavSection): string | undefined {
  return section.items[0]?.path;
}

/** A group is active exactly when one of its leaves is the active page. */
export function isGroupActive(section: AdminNavSection, active: AdminNavItem | undefined): boolean {
  if (!active) return false;
  if (active.litSection) return section.key === active.litSection;
  return section.items.includes(active);
}

/** A group lists its leaves only while active, and only when it has more than one. */
export function isGroupExpanded(section: AdminNavSection, active: AdminNavItem | undefined): boolean {
  return section.items.length > 1 && isGroupActive(section, active);
}

/** The real sum of the leaves' counts, shown on a collapsed group so no queue is hidden. */
export function groupBadgeCount(section: AdminNavSection): number | undefined {
  return badgeOrUndefined(section.items.reduce((n, item) => n + (item.badge ?? 0), 0));
}

export function groupBadgeAriaLabel(title: string, count: number): string {
  return `${count} pending in ${title}`;
}

/**
 * The words a group row shows. A group trimmed to one permitted leaf is that
 * leaf, so it carries the leaf's own name: a service writer whose Vehicles
 * group holds only the Work Queue sees "Work Queue", not a door to inventory.
 */
export function groupLabel(section: AdminNavSection): string {
  return section.items.length === 1 ? section.items[0].label : section.title;
}

/** The rows the rail draws, in order: one per group, one per flat leaf. The role preview reads this too. */
export function railRows(sections: AdminNavSection[]): { key: string; label: string; leaves: string[]; pinned: boolean }[] {
  return sections.flatMap((section) =>
    section.title
      ? [{ key: section.key, label: groupLabel(section), leaves: section.items.length > 1 ? section.items.map((i) => i.label) : [], pinned: !!section.pinned }]
      : section.items.map((item) => ({ key: item.path, label: item.label, leaves: [], pinned: false })),
  );
}

/** Every fixed destination the frame links to outside the rail. Route tests read this list. */
export const FRAME_LINKS = {
  brand: "/dashboard",
  administration: "/admin",
  team: "/admin?tab=team",
  workspaceSettings: "/admin?tab=settings",
  activity: "/admin?tab=audit",
  dealershipOverview: "/admin?tab=home",
  trust: "/trust",
  serviceDesk: "/service",
  serviceVehicle: (vin: string) => `/service/vehicle/${encodeURIComponent(vin.toUpperCase())}`,
} as const;

export interface BottomNavCandidate {
  label: string;
  path: string;
  icon: LucideIcon;
  capability: DealerCapability;
}

// The phone and tablet bar beside the raised Scan button, by role. The caller
// keeps the ones the viewer holds and draws at most four.
export function bottomNavCandidates(mode: NavMode): BottomNavCandidate[] {
  if (mode === "vendor") return [{ label: "My Work", path: "/home/vendor", icon: ClipboardList, capability: "can_complete_get_ready" }];
  if (mode === "technician") {
    return [
      { label: "My Work", path: "/home/technician", icon: ClipboardList, capability: "can_view_work_queue" },
      { label: "Ready", path: "/ready-board", icon: Wrench, capability: "can_view_get_ready" },
    ];
  }
  return [
    { label: "Home", path: "/dashboard", icon: Grid2X2, capability: "can_view_dashboard" },
    { label: "Inventory", path: "/inventory", icon: Car, capability: "can_view_inventory" },
    { label: "Get Ready", path: "/ready-board", icon: Wrench, capability: "can_view_get_ready" },
    { label: "Deals", path: "/deals", icon: Folder, capability: "can_view_deals" },
    { label: "Create", path: "/create", icon: FilePlus2, capability: "can_create_documents" },
  ];
}

export interface NavViewer {
  role: DealerRole;
  /** Platform administrator (user_roles.role = 'admin'), never a dealer role. */
  isAdmin: boolean;
  badges: NavBadgeValues;
  /** Dealer feature switches; a switch that is not set reads as on, as in Admin V2. */
  hasFeature: (featureKey: string) => boolean;
}

/**
 * Whether Administration has anything to show this viewer. Decided by Admin
 * V2's own visibility, not by the legacy tab list: a salesperson's only legacy
 * tab (leads) now redirects out of Administration, so a door built on it opened
 * onto "not available for your role".
 */
export function canOpenAdministration({ role, isAdmin, hasFeature }: Pick<NavViewer, "role" | "isAdmin" | "hasFeature">): boolean {
  const features: Partial<Record<AdminFeatureKey, boolean>> = {
    feature_product_rules: hasFeature("feature_product_rules"),
    feature_invoicing: hasFeature("feature_invoicing"),
    feature_warranty: hasFeature("feature_warranty"),
  };
  return visibleSections({ role, isAdmin, features }).length > 0;
}

/** The permission-filtered rail for one viewer: the single computation the frame draws. */
export function navSectionsForViewer(viewer: NavViewer): AdminNavSection[] {
  const { role, isAdmin, badges, hasFeature } = viewer;
  const can = (c: DealerCapability) => hasDealerCapability(role, c, isAdmin);
  return filterNavSections(buildAdminNavSections({ badges, anyAdminTab: canOpenAdministration(viewer), role }), {
    isAdmin,
    isManager: isAdmin || hasDealerCapability(role, "can_manage_settings"),
    can,
    hasFeature,
  });
}

