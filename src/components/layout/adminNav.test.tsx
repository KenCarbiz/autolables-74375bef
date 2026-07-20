import { describe, it, expect } from "vitest";
import {
  BadgeCheck,
  BadgeDollarSign,
  BarChart3,
  CarFront,
  ClipboardList,
  Columns3,
  FilePlus2,
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
} from "lucide-react";
import {
  buildAdminNavSections,
  filterNavSections,
  findActiveNavItem,
  isNavItemActive,
  formatBadgeCount,
  badgeAriaLabel,
  type NavBadgeValues,
  type AdminNavItem,
  type NavPermissionContext,
} from "./adminNav";

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

const allItems = (badges: Partial<NavBadgeValues> = {}, anyAdminTab = true): AdminNavItem[] =>
  build(badges, anyAdminTab).flatMap((s) => s.items);

const byLabel = (label: string, badges: Partial<NavBadgeValues> = {}) =>
  allItems(badges).find((i) => i.label === label);

describe("buildAdminNavSections — structure preserved", () => {
  it("keeps the section order, keys, and titles", () => {
    const sections = build();
    expect(sections.map((s) => s.key)).toEqual([
      "main",
      "create",
      "work",
      "getready",
      "compliance",
      "office",
      "settings",
      "platform",
    ]);
    expect(sections.map((s) => s.title)).toEqual([
      "",
      "CREATE",
      "WORK",
      "GET READY",
      "COMPLIANCE",
      "OFFICE",
      "SETTINGS",
      "PLATFORM",
    ]);
  });

  it("preserves label order within each section", () => {
    const sections = build();
    const get = (key: string) => sections.find((s) => s.key === key)!.items.map((i) => i.label);
    expect(get("main")).toEqual(["Home", "Inventory", "Deals"]);
    expect(get("getready")).toEqual(["Recon Approvals", "Prep & Install", "Service Desk", "Ready Board"]);
    expect(get("compliance")).toEqual([
      "Compliance Center",
      "Compliance Tasks",
      "Price Change Review",
      "Audit Log",
    ]);
  });

  it("omits Settings when no admin tab is permitted, includes it otherwise", () => {
    expect(byLabel("Settings")).toBeDefined();
    const noAdmin = build({}, false).flatMap((s) => s.items).find((i) => i.label === "Settings");
    expect(noAdmin).toBeUndefined();
  });
});

describe("icon mapping (lucide-react, one distinct icon per destination)", () => {
  const expected: Record<string, unknown> = {
    Home: LayoutDashboard,
    Inventory: CarFront,
    Deals: Handshake,
    Create: FilePlus2,
    "Work Queue": ClipboardList,
    Leads: Users,
    "Recon Approvals": BadgeCheck,
    "Prep & Install": Wrench,
    "Service Desk": Headset,
    "Ready Board": Columns3,
    "Compliance Center": ShieldCheck,
    "Compliance Tasks": ListChecks,
    "Price Change Review": BadgeDollarSign,
    "Audit Log": History,
    Invoices: ScrollText,
    Settings: Settings,
    Reports: BarChart3,
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
  });

  it("matches a lead detail route to Leads", () => {
    expect(activeLabel("/leads/42")).toBe("Leads");
  });

  it("does not confuse Compliance Center with Compliance Tasks", () => {
    expect(activeLabel("/compliance")).toBe("Compliance Center");
    expect(activeLabel("/compliance-center")).toBe("Compliance Tasks");
    expect(activeLabel("/compliance-center/task-9")).toBe("Compliance Tasks");
  });

  it("does not confuse Service Desk with the service-inspection route", () => {
    expect(activeLabel("/service")).toBe("Service Desk");
    expect(activeLabel("/service-inspection")).toBeUndefined();
  });

  it("matches nested price-change-review to Price Change Review", () => {
    expect(activeLabel("/dashboard/document-review")).toBe("Price Change Review");
    expect(activeLabel("/dashboard/document-review/x")).toBe("Price Change Review");
  });

  it("keeps Home exact (dashboard sub-pages do not light Home)", () => {
    expect(activeLabel("/dashboard")).toBe("Home");
    expect(activeLabel("/dashboard/reports")).toBe("Reports");
  });

  it("distinguishes /admin tabs via the query string", () => {
    expect(activeLabel("/admin")).toBe("Settings");
    expect(activeLabel("/admin", "?tab=audit")).toBe("Audit Log");
    expect(activeLabel("/admin", "?tab=invoices")).toBe("Invoices");
    // Settings is the hub for any other /admin tab, and Audit Log/Invoices do
    // not bleed onto it.
    expect(activeLabel("/admin", "?tab=team")).toBe("Settings");
  });

  it("marks at most one leaf active for any route", () => {
    const paths = [
      "/dashboard",
      "/inventory/9",
      "/vehicle-file/x",
      "/compliance",
      "/compliance-center",
      "/service",
      "/dashboard/document-review",
      "/leads/1",
      "/recon",
      "/prep/1GT",
      "/ready-board",
    ];
    for (const p of paths) {
      const matches = build().flatMap((s) => s.items).filter((i) => isNavItemActive(i, p, ""));
      expect(matches.length).toBeLessThanOrEqual(1);
    }
    // The /admin query rows are mutually exclusive too.
    expect(build().flatMap((s) => s.items).filter((i) => isNavItemActive(i, "/admin", "?tab=audit")).length).toBe(1);
  });
});

describe("badge wiring and formatting", () => {
  it("wires live counts onto the queue rows", () => {
    expect(byLabel("Recon Approvals", { reconApprovals: 7 })?.badge).toBe(7);
    expect(byLabel("Work Queue", { workQueue: 3 })?.badge).toBe(3);
    expect(byLabel("Leads", { leads: 2 })?.badge).toBe(2);
  });

  it("hides a zero badge", () => {
    expect(byLabel("Recon Approvals", { reconApprovals: 0 })?.badge).toBeUndefined();
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
      can: (c) => c !== "can_view_get_ready",
      hasFeature: () => true,
    };
    const filtered = filterNavSections(build(), ctx);
    expect(filtered.find((s) => s.key === "getready")).toBeUndefined();
  });

  it("hides requireAdmin destinations from non-admins", () => {
    const ctx: NavPermissionContext = { isAdmin: false, isManager: true, can: () => true, hasFeature: () => true };
    const filtered = filterNavSections(build(), ctx);
    expect(filtered.find((s) => s.key === "platform")).toBeUndefined();
  });

  it("hides a feature-flagged item when the flag is off", () => {
    const ctx: NavPermissionContext = {
      isAdmin: false,
      isManager: false,
      can: () => true,
      hasFeature: (k) => k !== "feature_lead_capture",
    };
    const labels = filterNavSections(build(), ctx).flatMap((s) => s.items).map((i) => i.label);
    expect(labels).not.toContain("Leads");
  });
});
