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
  LayoutDashboard,
  Printer,
  Rocket,
  ScrollText,
  Settings,
  ShieldCheck,
  Radar,
  Store,
  Tag,
  Users,
  Wrench,
} from "lucide-react";
import {
  buildAdminNavSections,
  filterNavSections,
  findActiveNavItem,
  isNavItemActive,
  formatBadgeCount,
  badgeAriaLabel,
  navModeForRole,
  type NavBadgeValues,
  type AdminNavItem,
  type NavPermissionContext,
} from "./adminNav";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ADMIN_ICON_PATHS } from "@/lib/design/adminIconPaths";

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

describe("buildAdminNavSections — structure preserved", () => {
  it("keeps the section order, keys, and titles", () => {
    const sections = build();
    // The eight primary destinations the admin asset pack names: Home,
    // Inventory, My Work, Get Ready, Customers, Compliance, Reports, Settings.
    // CREATE is gone as a section -- Create is a global control, and the
    // production surfaces belong to the vehicle, so they sit under Inventory.
    // TITLES & INVOICES is gone too: Titles is a section of the compliance
    // surface, and Invoices is a worklist.
    expect(sections.map((s) => s.key)).toEqual([
      "main",
      "inventory",
      "mywork",
      "getready",
      "customers",
      "compliance",
      "reports",
      "settings",
      "platform",
    ]);
    expect(sections.map((s) => s.title)).toEqual([
      "",
      "INVENTORY",
      "MY WORK",
      "GET READY",
      "CUSTOMERS",
      "COMPLIANCE",
      "REPORTS",
      "SETTINGS",
      "PLATFORM",
    ]);
  });

  it("preserves label order within each section", () => {
    const sections = build();
    const get = (key: string) => sections.find((s) => s.key === key)!.items.map((i) => i.label);
    expect(get("main")).toEqual(["Home"]);
    expect(get("inventory")).toEqual([
      "Inventory",
      "Inventory Intelligence",
      "OEM Window Sticker Studio",
      "Description Operations",
    ]);
    expect(get("mywork")).toEqual(["Work Queue", "Print Center", "Invoices"]);
    expect(get("getready")).toEqual([
      "Get Ready Command",
      "Service Writer Desk",
      "Service Desk",
      "Prep & Vendors",
      "Ready Board",
      "Recon Approvals",
    ]);
    expect(get("customers")).toEqual(["Customers", "Deals"]);
    // FIVE rows pointed at the one ComplianceShell: Compliance Center,
    // Compliance Tasks, Price Change Review, Audit Log and Titles. They are
    // sections of that surface, not destinations of their own.
    expect(get("compliance")).toEqual(["Compliance"]);
    expect(get("reports")).toEqual(["Reports"]);
  });

  it("omits Settings when no admin tab is permitted, includes it otherwise", () => {
    expect(byLabel("Settings")).toBeDefined();
    const noAdmin = build({}, false).flatMap((s) => s.items).find((i) => i.label === "Settings");
    expect(noAdmin).toBeUndefined();
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
    Home: LayoutDashboard,
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
    Settings: Settings,
    "Platform Admin": Store,
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
    expect(activeLabel("/print-center/abc-123")).toBe("Print Center");
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

  it("keeps Home on the role boards and off the dashboard sub-pages", () => {
    expect(activeLabel("/dashboard")).toBe("Home");
    expect(activeLabel("/home/gm")).toBe("Home");
    expect(activeLabel("/dashboard/classic")).toBe("Home");
    expect(activeLabel("/dashboard/reports")).toBe("Reports");
    expect(activeLabel("/dashboard/qr-analytics")).toBe("Reports");
  });

  it("distinguishes /admin tabs via the query string", () => {
    expect(activeLabel("/admin")).toBe("Settings");
    expect(activeLabel("/admin", "?tab=invoices")).toBe("Invoices");
    // Settings is the hub for every other /admin tab, including the audit tab
    // now that Audit Log is a section of the compliance surface.
    expect(activeLabel("/admin", "?tab=team")).toBe("Settings");
    expect(activeLabel("/admin", "?tab=audit")).toBe("Settings");
    expect(activeLabel("/admin/inventory-sync")).toBe("Settings");
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
    // Customers, Compliance, Reports, Settings.
    const id = (label: string) => byLabel(label)?.assetIcon;
    expect(id("Home")).toBe("010AC");
    expect(id("Inventory")).toBe("011AC");
    expect(id("Work Queue")).toBe("012AC");
    expect(id("Get Ready Command")).toBe("013AC");
    expect(id("Customers")).toBe("014AC");
    expect(id("Compliance")).toBe("015AC");
    expect(id("Reports")).toBe("016AC");
    expect(id("Settings")).toBe("017AC");
  });

  it("keeps a lucide fallback on every row", () => {
    // A wrong id or an uninstalled pack must cost the icon, never the row.
    expect(allItems().every((i) => typeof i.icon === "function"
      || typeof i.icon === "object")).toBe(true);
  });

  it("renders the pack inline, not as an <img>", () => {
    // currentColor does not inherit through <img>, so a file reference would
    // quietly turn every nav icon the same colour.
    const shell = readFileSync(join(__dirname, "AppShell.tsx"), "utf8");
    expect(shell).toMatch(/<AdminIcon id=\{item\.assetIcon\}/);
    expect(shell).toMatch(/ADMIN_ICON_PATHS\[item\.assetIcon\]/);
  });
});
