import { describe, it, expect } from "vitest";
import {
  BadgeCheck,
  BarChart3,
  CarFront,
  ClipboardCheck,
  ClipboardList,
  Columns3,
  Handshake,
  Headset,
  House,
  LayoutDashboard,
  Printer,
  Rocket,
  ScrollText,
  Settings,
  ShieldCheck,
  Radar,
  Tag,
  Terminal,
  Users,
  Wrench,
} from "lucide-react";
import type { DealerCapability } from "@/lib/permissions/dealerRoleCapabilities";
import {
  buildAdminNavSections,
  filterNavSections,
  findActiveNavItem,
  isNavItemActive,
  formatBadgeCount,
  badgeAriaLabel,
  navModeForRole,
  groupHref,
  isGroupActive,
  isGroupExpanded,
  groupBadgeCount,
  groupBadgeAriaLabel,
  groupLabel,
  railRows,
  navSectionsForViewer,
  canOpenAdministration,
  ReportsBarsIcon,
  type NavBadgeValues,
  type AdminNavItem,
  type NavPermissionContext,
} from "./adminNav";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ADMIN_ICON_PATHS } from "@/lib/design/adminIconPaths";
import { dealerRoleCapabilityMap } from "@/lib/permissions/dealerRoleCapabilities";
import { visibleSections } from "@/lib/admin/sections";

const ZERO_BADGES: NavBadgeValues = {
  workQueue: 0,
  leads: 0,
  reconApprovals: 0,
  priceChangeReview: 0,
  complianceTasks: 0,
  returns: 0,
};

const allowAll: NavPermissionContext = {
  isAdmin: true,
  isManager: true,
  can: () => true,
  hasFeature: () => true,
};

const build = (badges: Partial<NavBadgeValues> = {}, anyAdminTab = true) =>
  buildAdminNavSections({ badges: { ...ZERO_BADGES, ...badges }, anyAdminTab });

const buildFor = (role: string, badges: Partial<NavBadgeValues> = {}) =>
  buildAdminNavSections({ badges: { ...ZERO_BADGES, ...badges }, anyAdminTab: true, role });

const allItems = (badges: Partial<NavBadgeValues> = {}, anyAdminTab = true): AdminNavItem[] =>
  build(badges, anyAdminTab).flatMap((s) => s.items);

const byLabel = (label: string, badges: Partial<NavBadgeValues> = {}) =>
  allItems(badges).find((i) => i.label === label);

describe("buildAdminNavSections — the rail's eight groups", () => {
  it("keeps the group order, keys, and titles drawn in the mock", () => {
    const sections = build();
    // Mock 01: Today, Vehicles, Merchandising, Get Ready, Customers & Deals,
    // Compliance, Reports, Administration, and Platform console pinned below.
    expect(sections.map((s) => s.key)).toEqual([
      "today",
      "vehicles",
      "merchandising",
      "getready",
      "customers",
      "compliance",
      "reports",
      "administration",
      "platform",
    ]);
    expect(sections.map((s) => s.title)).toEqual([
      "Today",
      "Vehicles",
      "Merchandising",
      "Get Ready",
      "Customers & Deals",
      "Compliance",
      "Reports",
      "Administration",
      "Platform console",
    ]);
  });

  it("pins only the Platform console", () => {
    expect(build().filter((s) => s.pinned).map((s) => s.key)).toEqual(["platform"]);
  });

  it("preserves leaf order within each group", () => {
    const sections = build();
    const get = (key: string) => sections.find((s) => s.key === key)!.items.map((i) => i.label);
    expect(get("today")).toEqual(["Today"]);
    expect(get("vehicles")).toEqual(["Inventory", "Inventory Intelligence", "Work Queue"]);
    expect(get("merchandising")).toEqual(["OEM Window Sticker Studio", "Description Operations", "Print Center"]);
    expect(get("getready")).toEqual([
      "Get Ready Command",
      "Service Writer Desk",
      "Service Desk",
      "Prep & Vendors",
      "Ready Board",
      "Recon Approvals",
    ]);
    expect(get("customers")).toEqual(["Customers", "Deals", "Invoices"]);
    // FIVE rows pointed at the one ComplianceShell: Compliance Center,
    // Compliance Tasks, Price Change Review, Audit Log and Titles. They are
    // sections of that surface, not destinations of their own.
    expect(get("compliance")).toEqual(["Compliance"]);
    expect(get("reports")).toEqual(["Reports"]);
    expect(get("administration")).toEqual(["Administration"]);
    expect(get("platform")).toEqual(["Platform console"]);
  });

  it("omits Administration when no admin tab is permitted, includes it otherwise", () => {
    expect(byLabel("Administration")).toBeDefined();
    const noAdmin = build({}, false).flatMap((s) => s.items).find((i) => i.label === "Administration");
    expect(noAdmin).toBeUndefined();
    // ...and the emptied group is pruned rather than drawn with no leaf.
    expect(filterNavSections(build({}, false), allowAll).find((s) => s.key === "administration")).toBeUndefined();
  });

  it("keeps every former destination reachable for a full-capability dealer", () => {
    const paths = filterNavSections(build(), allowAll).flatMap((s) => s.items).map((i) => i.path);
    for (const path of [
      "/dashboard",
      "/inventory",
      "/inventory-intelligence",
      "/window-sticker-studio",
      "/description-operations",
      "/queue",
      "/print-center",
      "/invoices",
      "/get-ready-command",
      "/service-desk",
      "/service",
      "/prep",
      "/ready-board",
      "/recon",
      "/customers",
      "/deals",
      "/compliance",
      "/dashboard/reports",
      "/admin",
      "/platform-admin",
    ]) {
      expect(paths).toContain(path);
    }
    // Paths stay unique, because the rail and the role preview key rows by path.
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe("rail groups", () => {
  const only = (...caps: DealerCapability[]): NavPermissionContext => ({
    isAdmin: false,
    isManager: false,
    can: (c) => caps.includes(c),
    hasFeature: () => true,
  });
  const group = (ctx: NavPermissionContext, key: string) => filterNavSections(build(), ctx).find((s) => s.key === key);

  it("opens a group on its first permitted leaf", () => {
    const full = filterNavSections(build(), allowAll);
    expect(full.map((s) => groupHref(s))).toEqual([
      "/dashboard",
      "/inventory",
      "/window-sticker-studio",
      "/get-ready-command",
      "/customers",
      "/compliance",
      "/dashboard/reports",
      "/admin",
      "/platform-admin",
    ]);
    expect(groupHref(group(only("can_view_work_queue"), "vehicles")!)).toBe("/queue");
    expect(groupHref(group(only("can_assign_service_work"), "getready")!)).toBe("/service-desk");
    expect(groupHref(group(only("can_view_print_queue"), "merchandising")!)).toBe("/print-center");
    expect(groupHref(group(only("can_manage_invoices"), "customers")!)).toBe("/invoices");
  });

  it("hides a group with no permitted leaf", () => {
    const keys = filterNavSections(build(), only("can_view_dashboard", "can_view_inventory")).map((s) => s.key);
    expect(keys).toEqual(["today", "vehicles", "administration"]);
    expect(group(only("can_view_inventory"), "merchandising")).toBeUndefined();
  });

  it("is active exactly when one of its leaves is the current page", () => {
    const sections = filterNavSections(build(), allowAll);
    const activeGroups = (pathname: string, search = "") => {
      const leaf = findActiveNavItem(sections, pathname, search);
      return sections.filter((s) => isGroupActive(s, leaf)).map((s) => s.key);
    };
    expect(activeGroups("/vehicle-file/abc")).toEqual(["vehicles"]);
    expect(activeGroups("/queue")).toEqual(["vehicles"]);
    expect(activeGroups("/print-queue")).toEqual(["merchandising"]);
    expect(activeGroups("/recon")).toEqual(["getready"]);
    expect(activeGroups("/admin", "?tab=invoices")).toEqual(["getready"]);
    expect(activeGroups("/admin", "?tab=team")).toEqual(["administration"]);
    expect(activeGroups("/platform-admin")).toEqual(["platform"]);
    expect(activeGroups("/nowhere")).toEqual([]);
  });

  it("lists the leaves only under the active group, and only when there is more than one", () => {
    const sections = filterNavSections(build(), allowAll);
    const expandedAt = (pathname: string) => {
      const leaf = findActiveNavItem(sections, pathname, "");
      return sections.filter((s) => isGroupExpanded(s, leaf)).map((s) => s.key);
    };
    expect(expandedAt("/dashboard")).toEqual([]);
    expect(expandedAt("/compliance")).toEqual([]);
    expect(expandedAt("/prep")).toEqual(["getready"]);
    expect(expandedAt("/inventory")).toEqual(["vehicles"]);
    // A group trimmed to one permitted leaf is that leaf, with nothing to list.
    const narrow = filterNavSections(build(), only("can_view_work_queue"));
    const leaf = findActiveNavItem(narrow, "/queue", "");
    expect(leaf?.label).toBe("Work Queue");
    expect(narrow.filter((s) => isGroupExpanded(s, leaf))).toEqual([]);
  });

  it("lights the owning section for every child route the rail no longer lists", () => {
    const sections = filterNavSections(build(), allowAll);
    const litAt = (pathname: string, search = "") => {
      const leaf = findActiveNavItem(sections, pathname, search);
      return sections.filter((s) => isGroupActive(s, leaf)).map((s) => s.key);
    };
    expect(litAt("/inventory-intelligence")).toEqual(["vehicles"]);
    expect(litAt("/queue")).toEqual(["vehicles"]);
    expect(litAt("/vehicle-file/abc")).toEqual(["vehicles"]);
    expect(litAt("/get-ready-command")).toEqual(["getready"]);
    expect(litAt("/prep")).toEqual(["getready"]);
    expect(litAt("/recon")).toEqual(["getready"]);
    expect(litAt("/invoices")).toEqual(["getready"]);
    expect(litAt("/window-sticker-studio")).toEqual(["vehicles"]);
    expect(litAt("/description-operations")).toEqual(["vehicles"]);
    expect(litAt("/leads")).toEqual(["customers"]);
  });

  it("rolls the real leaf counts up onto a group", () => {
    const getReady = build({ reconApprovals: 150 }).find((s) => s.key === "getready")!;
    expect(groupBadgeCount(getReady)).toBe(150);
    expect(formatBadgeCount(groupBadgeCount(getReady))).toBe("99+");
    expect(groupBadgeAriaLabel(getReady.title, groupBadgeCount(getReady)!)).toBe("150 pending in Get Ready");
    const customers = build({ leads: 2, returns: 3 }).find((s) => s.key === "customers")!;
    expect(groupBadgeCount(customers)).toBe(5);
    expect(groupBadgeCount(build().find((s) => s.key === "vehicles")!)).toBeUndefined();
  });
});

describe("role-scoped navigation", () => {
  it("classifies the isolated roles", () => {
    expect(navModeForRole("third_party_vendor")).toBe("vendor");
    expect(navModeForRole("technician")).toBe("technician");
    expect(navModeForRole("detail")).toBe("technician");
    expect(navModeForRole("sales_manager")).toBe("dealer");
    expect(navModeForRole(null)).toBe("dealer");
    expect(navModeForRole(undefined)).toBe("dealer");
  });

  it("gives a vendor exactly one destination — their own assignments", () => {
    const items = buildFor("third_party_vendor").flatMap((s) => s.items);
    expect(items.map((i) => i.label)).toEqual(["My Assignments"]);
    expect(items[0].path).toBe("/home/vendor");
  });

  it("never shows a vendor a dealer surface, even with every capability", () => {
    // Containment is decided by role, so a mis-set capability cannot open a
    // door into inventory, pricing, customers or compliance.
    const items = filterNavSections(buildFor("third_party_vendor"), allowAll).flatMap((s) => s.items);
    const dealerPaths = ["/inventory", "/customers", "/deals", "/compliance", "/admin", "/dashboard", "/queue", "/create"];
    for (const item of items) {
      expect(dealerPaths).not.toContain(item.path);
    }
  });

  it("gives a technician their bench and the shop board, and no administration", () => {
    const items = buildFor("detail").flatMap((s) => s.items);
    expect(items.map((i) => i.label)).toEqual(["My Work", "Ready Board"]);
    expect(items.map((i) => i.path)).toEqual(["/home/technician", "/ready-board"]);
  });

  it("lights the isolated row wherever that role can land", () => {
    const vendor = buildFor("third_party_vendor");
    for (const path of ["/home/vendor", "/dashboard", "/queue"]) {
      expect(findActiveNavItem(vendor, path, "")?.label).toBe("My Assignments");
    }
    const tech = buildFor("technician");
    for (const path of ["/home/technician", "/dashboard", "/service/vehicle/1FT"]) {
      expect(findActiveNavItem(tech, path, "")?.label).toBe("My Work");
    }
  });

  it("carries no dealer-wide badge onto an isolated row", () => {
    // The dealer counts are store-wide; a vendor's or technician's own list is
    // the only honest count of their work, and it lives on their page.
    const loud = { workQueue: 40, leads: 9, reconApprovals: 7, priceChangeReview: 12, complianceTasks: 5, returns: 3 };
    const items = [
      ...buildFor("third_party_vendor", loud).flatMap((s) => s.items),
      ...buildFor("technician", loud).flatMap((s) => s.items),
    ];
    expect(items.every((i) => i.badge === undefined)).toBe(true);
  });
});

describe("icon mapping (lucide-react, one distinct icon per destination)", () => {
  const expected: Record<string, unknown> = {
    Today: LayoutDashboard,
    Inventory: CarFront,
    "Inventory Intelligence": Radar,
    "OEM Window Sticker Studio": Tag,
    "Work Queue": ClipboardList,
    "Print Center": Printer,
    Invoices: ScrollText,
    "Get Ready Command": Rocket,
    "Service Writer Desk": ClipboardCheck,
    "Service Desk": Headset,
    "Prep & Vendors": Wrench,
    "Ready Board": Columns3,
    "Recon Approvals": BadgeCheck,
    Customers: Users,
    Deals: Handshake,
    Compliance: ShieldCheck,
    Reports: BarChart3,
    Administration: Settings,
    "Platform console": Terminal,
  };

  Object.entries(expected).forEach(([label, icon]) => {
    it(`maps ${label} to the approved icon`, () => {
      expect(byLabel(label)?.icon).toBe(icon);
    });
  });

  it("assigns a distinct icon to every destination", () => {
    const icons = allItems().map((i) => i.icon);
    expect(new Set(icons).size).toBe(icons.length);
  });

  it("draws each group with the glyph measured from the mock", () => {
    const icon = (key: string) => build().find((s) => s.key === key)?.icon;
    expect(icon("today")).toBe(House);
    expect(icon("vehicles")).toBe(CarFront);
    expect(icon("merchandising")).toBe(Tag);
    expect(icon("getready")).toBe(Wrench);
    expect(icon("customers")).toBe(Users);
    expect(icon("compliance")).toBe(ShieldCheck);
    expect(icon("reports")).toBe(ReportsBarsIcon);
    expect(icon("administration")).toBe(Settings);
    expect(icon("platform")).toBe(Terminal);
    const groupIcons = build().map((s) => s.icon);
    expect(new Set(groupIcons).size).toBe(groupIcons.length);
  });
});

describe("active-route matching", () => {
  const activeLabel = (pathname: string, search = "") =>
    findActiveNavItem(build(), pathname, search)?.label;

  it("matches exact and nested inventory routes to Inventory", () => {
    expect(activeLabel("/inventory")).toBe("Inventory");
    expect(activeLabel("/inventory/123")).toBe("Inventory");
    expect(activeLabel("/inventory-v2")).toBe("Inventory");
    expect(activeLabel("/vehicle-file/abc-123")).toBe("Inventory");
    // VIN Command Center has no row of its own; it lights Inventory.
    expect(activeLabel("/vin-command/abc-123")).toBe("Inventory");
    // ...and Inventory Intelligence is a sibling prefix, not a child.
    expect(activeLabel("/inventory-intelligence")).toBe("Inventory Intelligence");
  });

  it("matches the command surfaces to their own rows", () => {
    expect(activeLabel("/get-ready-command")).toBe("Get Ready Command");
    expect(activeLabel("/get-ready-command/abc-123")).toBe("Get Ready Command");
    expect(activeLabel("/print-center")).toBe("Print Center");
    expect(activeLabel("/print-center/abc-123")).toBe("Inventory");
    expect(activeLabel("/factory-sticker/abc-123")).toBe("Inventory");
  });

  it("lights Customers from both the new and the legacy URL", () => {
    expect(activeLabel("/customers")).toBe("Customers");
    expect(activeLabel("/customers/42")).toBe("Customers");
    expect(activeLabel("/leads")).toBe("Customers");
    expect(activeLabel("/leads/42")).toBe("Customers");
  });

  it("lights Deals from the deal stages that kept their own URLs", () => {
    expect(activeLabel("/deals")).toBe("Deals");
    expect(activeLabel("/saved")).toBe("Deals");
    expect(activeLabel("/signed")).toBe("Deals");
    expect(activeLabel("/delivered")).toBe("Deals");
    expect(activeLabel("/returns")).toBe("Deals");
    expect(activeLabel("/signatures")).toBe("Deals");
  });

  it("lights the one Compliance row from every superseded compliance URL", () => {
    expect(activeLabel("/compliance")).toBe("Compliance");
    expect(activeLabel("/compliance", "?tab=titles")).toBe("Compliance");
    expect(activeLabel("/compliance-center")).toBe("Compliance");
    expect(activeLabel("/titles")).toBe("Compliance");
    expect(activeLabel("/dashboard/document-review")).toBe("Compliance");
  });

  it("does not confuse Service Desk with the writer desk or the inspection route", () => {
    expect(activeLabel("/service")).toBe("Service Desk");
    expect(activeLabel("/service/vehicle/1FT")).toBe("Service Desk");
    expect(activeLabel("/service-inspection")).toBe("Service Desk");
    expect(activeLabel("/service-desk")).toBe("Service Writer Desk");
  });

  it("keeps Today on the role boards and off the dashboard sub-pages", () => {
    expect(activeLabel("/dashboard")).toBe("Today");
    expect(activeLabel("/home/gm")).toBe("Today");
    expect(activeLabel("/dashboard/classic")).toBe("Today");
    expect(activeLabel("/dashboard/reports")).toBe("Reports");
    expect(activeLabel("/dashboard/qr-analytics")).toBe("Reports");
  });

  it("distinguishes /admin tabs via the query string", () => {
    expect(activeLabel("/admin")).toBe("Administration");
    expect(activeLabel("/admin", "?tab=invoices")).toBe("Invoices");
    // Administration is the hub for every other /admin tab, including the
    // audit tab now that Audit Log is a section of the compliance surface.
    expect(activeLabel("/admin", "?tab=team")).toBe("Administration");
    expect(activeLabel("/admin", "?tab=audit")).toBe("Administration");
    expect(activeLabel("/admin/inventory-sync")).toBe("Administration");
  });

  it("marks at most one leaf active for any route", () => {
    const paths = [
      "/dashboard",
      "/home/service",
      "/inventory/9",
      "/inventory-intelligence",
      "/vehicle-file/x",
      "/compliance",
      "/compliance-center",
      "/titles",
      "/service",
      "/service-desk",
      "/dashboard/document-review",
      "/customers/1",
      "/leads/1",
      "/deals",
      "/saved",
      "/recon",
      "/prep/1GT",
      "/ready-board",
      "/queue",
      "/print-center",
    ];
    for (const p of paths) {
      const matches = build().flatMap((s) => s.items).filter((i) => isNavItemActive(i, p, ""));
      expect(matches.length).toBeLessThanOrEqual(1);
    }
    // The /admin query rows are mutually exclusive too.
    expect(build().flatMap((s) => s.items).filter((i) => isNavItemActive(i, "/admin", "?tab=invoices")).length).toBe(1);
  });
});

describe("badge wiring and formatting", () => {
  it("wires live counts onto the queue rows", () => {
    expect(byLabel("Recon Approvals", { reconApprovals: 7 })?.badge).toBe(7);
    expect(byLabel("Work Queue", { workQueue: 3 })?.badge).toBe(3);
    expect(byLabel("Customers", { leads: 2 })?.badge).toBe(2);
    expect(byLabel("Deals", { returns: 4 })?.badge).toBe(4);
  });

  it("counts both open compliance queues on the one compliance row", () => {
    expect(byLabel("Compliance", { complianceTasks: 3, priceChangeReview: 2 })?.badge).toBe(5);
  });

  it("hides a zero badge", () => {
    expect(byLabel("Recon Approvals", { reconApprovals: 0 })?.badge).toBeUndefined();
    expect(byLabel("Compliance")?.badge).toBeUndefined();
    expect(formatBadgeCount(0)).toBeNull();
    expect(formatBadgeCount(undefined)).toBeNull();
  });

  it("caps display at 99+ and never hard-codes 100", () => {
    expect(formatBadgeCount(1)).toBe("1");
    expect(formatBadgeCount(99)).toBe("99");
    expect(formatBadgeCount(100)).toBe("99+");
    expect(formatBadgeCount(250)).toBe("99+");
    // The real count (100) drives the accessible label even when text is "99+".
    expect(byLabel("Recon Approvals", { reconApprovals: 100 })?.badge).toBe(100);
  });

  it("builds an accessible badge label from the real count", () => {
    expect(badgeAriaLabel("Recon Approvals", 100)).toBe("100 recon approvals pending");
  });
});

describe("permission filtering", () => {
  it("passes everything through for an admin", () => {
    const filtered = filterNavSections(build(), allowAll);
    expect(filtered.flatMap((s) => s.items).length).toBe(allItems().length);
  });

  it("drops a capability-gated item and prunes the emptied section", () => {
    const ctx: NavPermissionContext = {
      isAdmin: false,
      isManager: false,
      can: (c) => c !== "can_view_get_ready" && c !== "can_assign_service_work",
      hasFeature: () => true,
    };
    const filtered = filterNavSections(build(), ctx);
    expect(filtered.find((s) => s.key === "getready")).toBeUndefined();
  });

  it("shows the writer desk only to the roles that dispatch service work", () => {
    const ctx: NavPermissionContext = {
      isAdmin: false,
      isManager: false,
      can: (c) => c !== "can_assign_service_work",
      hasFeature: () => true,
    };
    const labels = filterNavSections(build(), ctx).flatMap((s) => s.items).map((i) => i.label);
    expect(labels).not.toContain("Service Writer Desk");
    expect(labels).toContain("Service Desk");
  });

  it("keeps Invoices off every role that does not hold them", () => {
    const ctx: NavPermissionContext = {
      isAdmin: false,
      isManager: false,
      can: (c) => c !== "can_manage_invoices",
      hasFeature: () => true,
    };
    const labels = filterNavSections(build(), ctx).flatMap((s) => s.items).map((i) => i.label);
    expect(labels).not.toContain("Invoices");
  });

  it("hides requireAdmin destinations from non-admins", () => {
    const ctx: NavPermissionContext = { isAdmin: false, isManager: true, can: () => true, hasFeature: () => true };
    const filtered = filterNavSections(build(), ctx);
    expect(filtered.find((s) => s.key === "platform")).toBeUndefined();
  });

  it("keeps the customer book when lead capture is switched off", () => {
    // The Customers workspace is the record of shoppers, deals and document
    // requests the dealer already has; it is not the optional lead-capture
    // form, and gating it on that flag stranded /customers/:id with no way back.
    const ctx: NavPermissionContext = {
      isAdmin: false,
      isManager: false,
      can: () => true,
      hasFeature: (k) => k !== "feature_lead_capture",
    };
    const labels = filterNavSections(build(), ctx).flatMap((s) => s.items).map((i) => i.label);
    expect(labels).toContain("Customers");
  });
});

// ── The asset pack has to actually render ────────────────────────────
//
// The 290-asset admin pack was installed, adminIconPaths.ts was generated and
// <AdminIcon> was built and tested -- and nothing imported it. The whole
// visual identity sat unused, which is exactly why the admin looked unchanged
// after the design work landed. A component with no caller is not shipped.

describe("navigation uses the admin asset pack", () => {
  it("gives every row an icon from the pack", () => {
    const missing = [...allItems(), ...buildFor("technician").flatMap((s) => s.items), ...buildFor("third_party_vendor").flatMap((s) => s.items)]
      .filter((i) => !i.assetIcon || !(i.assetIcon in ADMIN_ICON_PATHS))
      .map((i) => i.label);
    expect(missing).toEqual([]);
  });

  it("uses the pack's own navigation icons for the top-level surfaces", () => {
    // The pack names exactly eight: Home, Inventory, My Work, Get Ready,
    // Customers, Compliance, Reports, Settings. They stay on those leaves.
    const id = (label: string) => byLabel(label)?.assetIcon;
    expect(id("Today")).toBe("010AC");
    expect(id("Inventory")).toBe("011AC");
    expect(id("Work Queue")).toBe("012AC");
    expect(id("Get Ready Command")).toBe("013AC");
    expect(id("Customers")).toBe("014AC");
    expect(id("Compliance")).toBe("015AC");
    expect(id("Reports")).toBe("016AC");
    expect(id("Administration")).toBe("017AC");
  });

  it("keeps a lucide fallback on every row", () => {
    // A wrong id or an uninstalled pack must cost the icon, never the row.
    expect(allItems().every((i) => typeof i.icon === "function"
      || typeof i.icon === "object")).toBe(true);
  });

  it("renders the pack inline, not as an <img>", () => {
    // currentColor does not inherit through <img>, so a file reference would
    // quietly turn every nav icon the same colour.
    const rail = readFileSync(join(__dirname, "AppRail.tsx"), "utf8");
    expect(rail).toMatch(/<AdminIcon id=\{item\.assetIcon\}/);
    expect(rail).toMatch(/ADMIN_ICON_PATHS\[item\.assetIcon\]/);
  });
});

// ── What each real role sees ─────────────────────────────────────────
//
// The rail for a viewer comes from navSectionsForViewer, the one computation
// AppShell draws. These rows are read off the real capability contract, so a
// change to a role's capabilities shows up here as a changed rail.

describe("role matrix: the rail each role is drawn, from the real capability contract", () => {
  const ON = () => true;
  const rail = (role: string | null, isAdmin = false, hasFeature: (k: string) => boolean = ON) =>
    railRows(navSectionsForViewer({ role, isAdmin, badges: ZERO_BADGES, hasFeature })).map((r) => r.label);
  const doors = (role: string | null, isAdmin = false) =>
    navSectionsForViewer({ role, isAdmin, badges: ZERO_BADGES, hasFeature: ON }).map((s) => `${groupLabel(s)} ${groupHref(s)}`);
  const ALL = ["Today", "Vehicles", "Merchandising", "Get Ready", "Customers & Deals", "Compliance", "Reports", "Administration"];

  it("gives the full-authority dealer roles all eight groups and no Platform console", () => {
    for (const role of ["owner", "general_manager", "gsm", "admin", "manager", "used_car_manager"]) {
      expect(rail(role)).toEqual(ALL);
    }
  });

  it("draws the narrower dealer roles from their own capabilities", () => {
    expect(rail("sales_manager")).toEqual(["Today", "Vehicles", "Merchandising", "Customers & Deals", "Compliance", "Reports", "Administration"]);
    expect(rail("salesperson")).toEqual(["Today", "Vehicles", "Merchandising", "Customers & Deals"]);
    // staff is the legacy alias of salesperson.
    expect(rail("staff")).toEqual(rail("salesperson"));
    expect(rail("inventory_manager")).toEqual(["Today", "Vehicles", "Merchandising", "Get Ready", "Compliance", "Reports", "Administration"]);
    expect(rail("service_manager")).toEqual(["Today", "Vehicles", "Get Ready", "Compliance", "Reports", "Administration"]);
    expect(rail("office")).toEqual(["Today", "Vehicles", "Merchandising", "Customers & Deals", "Compliance", "Reports", "Administration"]);
    expect(rail("finance")).toEqual(["Today", "Vehicles", "Merchandising", "Customers & Deals", "Compliance", "Reports", "Administration"]);
    expect(rail("biller")).toEqual(["Today", "Customers & Deals", "Reports", "Administration"]);
    expect(rail("readonly")).toEqual(["Today", "Vehicles", "Reports", "Administration"]);
    // No membership row: the safe default capabilities only.
    expect(rail(null)).toEqual(["Today", "Vehicles"]);
  });

  it("names a one-leaf group after the leaf it opens", () => {
    // A service writer's Vehicles group holds only the Work Queue, and the
    // compliance role's Customers & Deals group only Deals.
    expect(doors("service_advisor")).toEqual(["Today /dashboard", "Work Queue /queue", "Get Ready /get-ready-command"]);
    expect(doors("compliance")).toContain("Deals /deals");
    expect(doors("compliance")).not.toContain("Customers & Deals /deals");
    // Office and billing hold Deals and Invoices: a real group, opened on Deals.
    expect(doors("office")).toContain("Customers & Deals /deals");
    expect(doors("biller")).toContain("Customers & Deals /deals");
  });

  it("offers Administration exactly when Admin V2 has a tab the role may open", () => {
    const roles = [...Object.keys(dealerRoleCapabilityMap), "staff", null];
    for (const role of roles) {
      if (navModeForRole(role) !== "dealer") continue;
      const v2 = visibleSections({ role, isAdmin: false, features: {} }).length > 0;
      expect(rail(role).includes("Administration")).toBe(v2);
      expect(canOpenAdministration({ role, isAdmin: false, hasFeature: ON })).toBe(v2);
    }
    // The salesperson's only legacy tab (leads) now redirects out of
    // Administration, so the door would open onto "not available".
    expect(rail("salesperson")).not.toContain("Administration");
  });

  it("shows the Platform console to the platform-admin authority only", () => {
    // isAdmin is user_roles.role = 'admin' (AuthContext), the same authority
    // AdminGate checks on /platform-admin. A dealership "admin" role is not it.
    for (const role of [...Object.keys(dealerRoleCapabilityMap), "staff", null]) {
      expect(rail(role, false)).not.toContain("Platform console");
    }
    expect(rail("admin", true)).toEqual([...ALL, "Platform console"]);
    expect(rail("salesperson", true)).toContain("Platform console");
    expect(rail(null, true)).toContain("Platform console");
    // Vendors and technicians are contained by role, platform admin or not.
    expect(rail("third_party_vendor", true)).toEqual(["My Assignments"]);
    expect(rail("detail", true)).toEqual(["My Work", "Ready Board"]);
  });

  it("gives the isolated roles their own rows", () => {
    expect(rail("third_party_vendor")).toEqual(["My Assignments"]);
    expect(rail("detail")).toEqual(["My Work", "Ready Board"]);
  });

  it("hides Invoices when invoicing is switched off, as Admin V2 does", () => {
    const leaves = (hasFeature: (k: string) => boolean) =>
      navSectionsForViewer({ role: "office", isAdmin: false, badges: ZERO_BADGES, hasFeature }).flatMap((s) => s.items.map((i) => i.label));
    expect(leaves(ON)).toContain("Invoices");
    expect(leaves((k) => k !== "feature_invoicing")).not.toContain("Invoices");
  });

  it("opens every group on a leaf the role holds", () => {
    for (const role of [...Object.keys(dealerRoleCapabilityMap), "staff", null]) {
      for (const section of navSectionsForViewer({ role, isAdmin: false, badges: ZERO_BADGES, hasFeature: ON })) {
        expect(section.items.length).toBeGreaterThan(0);
        expect(groupHref(section)).toBe(section.items[0].path);
      }
    }
  });
});

describe("railRows (the rows the rail and the role preview draw)", () => {
  it("draws one row per group, named as the rail names it, with the pages of a larger group", () => {
    const rows = railRows(filterNavSections(build(), allowAll));
    expect(rows.map((r) => r.label)).toEqual([
      "Today", "Vehicles", "Merchandising", "Get Ready", "Customers & Deals", "Compliance", "Reports", "Administration", "Platform console",
    ]);
    expect(rows.find((r) => r.key === "today")?.leaves).toEqual([]);
    expect(rows.find((r) => r.key === "vehicles")?.leaves).toEqual(["Inventory", "Inventory Intelligence", "Work Queue"]);
    expect(rows.filter((r) => r.pinned).map((r) => r.label)).toEqual(["Platform console"]);
  });

  it("draws a flat list one row per page", () => {
    expect(railRows(buildFor("detail")).map((r) => r.label)).toEqual(["My Work", "Ready Board"]);
  });
});
