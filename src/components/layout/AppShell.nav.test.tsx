import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { render, screen, within, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// AppShell is deeply wired to app contexts; each direct dependency is mocked
// down to a stub the test controls, so the test exercises only the frame's
// rendered behaviour. The capability contract, the admin-tab access table and
// the Admin V2 section registry are the REAL modules: what a role sees here is
// what that role sees in the product.
const nav = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock("@/lib/navigation", () => ({ useViewTransitionNavigate: () => nav.navigate }));
vi.mock("qrcode.react", () => ({ QRCodeSVG: () => null }));
vi.mock("sonner", () => ({ toast: Object.assign(() => {}, { info: () => {}, error: () => {}, success: () => {} }) }));
vi.mock("@/components/brand/Logo", () => ({ default: () => null }));
const palette = vi.hoisted(() => ({ setOpen: vi.fn(), restoreFocus: vi.fn(() => false) }));
vi.mock("@/components/layout/CommandPalette", () => ({
  default: () => null,
  useCommandPalette: () => ({ open: false, setOpen: palette.setOpen, restoreFocus: palette.restoreFocus }),
}));
vi.mock("@/contexts/VinScanContext", async () => {
  const React = await import("react");
  return { VinScanContext: React.createContext(null), prefersLiveScanner: () => false };
});
const auth = vi.hoisted(() => ({ isAdmin: true, signOut: vi.fn(async () => {}) }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1", email: "ken@ken.cc" }, isAdmin: auth.isAdmin, signOut: auth.signOut }),
}));
type TestStore = { id: string; name: string; city: string; state: string };
const tenantState = vi.hoisted(() => ({
  tenant: { id: "t1", name: "Test Motors" } as { id: string; name: string },
  stores: [] as TestStore[],
  currentStore: null as TestStore | null,
  setCurrentStore: vi.fn(),
}));
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => tenantState }));
const settingsState = vi.hoisted(() => ({ settings: { feature_lead_capture: true, dealer_name: "Test Motors" } as Record<string, unknown> }));
vi.mock("@/contexts/DealerSettingsContext", () => ({ useDealerSettings: () => settingsState }));
const auditState = vi.hoisted(() => ({ entries: [] as Array<Record<string, unknown>> }));
vi.mock("@/contexts/AuditContext", () => ({ useAudit: () => auditState }));
const shellRole = vi.hoisted(() => ({ value: "admin" as string | null }));
vi.mock("@/hooks/useEntitlements", () => ({ useEntitlements: () => ({ member: shellRole.value === null ? null : { role: shellRole.value } }) }));
vi.mock("@/hooks/usePlatformEntitlements", () => ({ usePlatformEntitlements: () => ({ productIds: ["autolabels", "autocurb"], load: () => {} }) }));
const badgeState = vi.hoisted(() => ({ reconApprovals: 150 }));
vi.mock("@/hooks/useNavBadges", () => ({
  useNavBadges: () => ({ workQueue: 0, leads: 0, reconApprovals: badgeState.reconApprovals, priceChangeReview: 0, complianceTasks: 0, returns: 0 }),
}));
const db = vi.hoisted(() => ({
  notifications: [] as Array<Record<string, unknown>>,
  updates: [] as Array<Record<string, unknown>>,
  invoke: vi.fn(async () => ({ data: null, error: null })),
}));
vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    in: () => chain,
    or: () => chain,
    order: () => chain,
    limit: () => Promise.resolve({ data: db.notifications, error: null }),
    update: (values: Record<string, unknown>) => { db.updates.push(values); return chain; },
    maybeSingle: () => Promise.resolve({ data: null }),
  });
  return { supabase: { from: () => chain, functions: { invoke: db.invoke } } };
});

import AppShell from "./AppShell";

beforeAll(() => {
  // Radix and cmdk measure and scroll; jsdom does neither.
  class RO { observe() {} unobserve() {} disconnect() {} }
  const g = globalThis as unknown as { ResizeObserver?: unknown };
  if (!g.ResizeObserver) g.ResizeObserver = RO;
  const proto = Element.prototype as unknown as Record<string, unknown>;
  if (!proto.scrollIntoView) proto.scrollIntoView = () => {};
  if (!proto.hasPointerCapture) proto.hasPointerCapture = () => false;
  if (!proto.releasePointerCapture) proto.releasePointerCapture = () => {};
});

const renderShell = (route: string) =>
  render(
    <MemoryRouter initialEntries={[route]}>
      <AppShell>
        <div>content</div>
      </AppShell>
    </MemoryRouter>,
  );

const primaryNav = () => screen.getByRole("navigation", { name: "Primary" });
const hrefs = (root: HTMLElement) => within(root).getAllByRole("link").map((l) => l.getAttribute("href"));
const header = () => screen.getByRole("banner");
const STORES: TestStore[] = [
  { id: "s0", name: "Test Motors North", city: "Springfield", state: "MA" },
  { id: "s1", name: "Test Motors South", city: "Chicopee", state: "MA" },
  { id: "s2", name: "Test Motors East", city: "", state: "" },
];

const openMenu = (trigger: HTMLElement) => {
  fireEvent.keyDown(trigger, { key: "Enter" });
  return screen.getByRole("menu");
};

beforeEach(() => {
  localStorage.clear();
  shellRole.value = "admin";
  auth.isAdmin = true;
  auth.signOut.mockClear();
  tenantState.tenant = { id: "t1", name: "Test Motors" };
  tenantState.stores = [];
  tenantState.currentStore = null;
  tenantState.setCurrentStore.mockClear();
  settingsState.settings = { feature_lead_capture: true, dealer_name: "Test Motors" };
  auditState.entries = [];
  badgeState.reconApprovals = 150;
  db.notifications = [];
  db.updates = [];
  db.invoke.mockClear();
  nav.navigate.mockClear();
  palette.setOpen.mockClear();
});

describe("AppShell rail rendering", () => {
  it("renders one Primary navigation at every width", () => {
    renderShell("/dashboard");
    expect(screen.getAllByRole("navigation", { name: "Primary" })).toHaveLength(1);
  });

  it("marks exactly one rail row as current for the active route", () => {
    renderShell("/inventory");
    const current = primaryNav().querySelectorAll("[aria-current]");
    expect(current.length).toBe(1);
    expect(current[0]).toHaveAttribute("aria-current", "page");
    expect(current[0].textContent).toContain("Vehicles");
    expect(current[0]).toHaveAttribute("data-active", "true");
  });

  it("lights the parent section on a nested vehicle-file route", () => {
    renderShell("/vehicle-file/abc-123");
    const current = primaryNav().querySelectorAll("[aria-current]");
    expect(current.length).toBe(1);
    expect(current[0].textContent).toContain("Vehicles");
  });

  it.each([
    ["/inventory-intelligence", "Vehicles"],
    ["/queue", "Vehicles"],
    ["/vehicle-file/abc-123", "Vehicles"],
    ["/description-writer", "Merchandising"],
    ["/print-queue", "Merchandising"],
    ["/prep", "Get Ready"],
    ["/recon", "Get Ready"],
    ["/ready-board", "Get Ready"],
    ["/service-desk", "Get Ready"],
    ["/signed", "Customers & Deals"],
    ["/invoices", "Customers & Deals"],
    ["/leads", "Customers & Deals"],
  ])("lights only the %s parent section: %s", (path, section) => {
    renderShell(path);
    const lit = Array.from(primaryNav().querySelectorAll('[data-active="true"]'));
    expect(lit).toHaveLength(1);
    expect(lit[0].textContent).toContain(section);
    expect(lit[0]).toHaveAttribute("aria-current");
  });

  it.each([
    ["/inventory", ["Inventory", "Inventory Intelligence", "Work Queue"]],
    ["/queue", ["Inventory", "Inventory Intelligence", "Work Queue"]],
    ["/window-sticker-studio", ["OEM Window Sticker Studio", "Description Operations", "Print Center"]],
    ["/prep", ["Get Ready Command", "Service Writer Desk", "Service Desk", "Prep & Vendors", "Ready Board", "Recon Approvals"]],
    ["/customers", ["Customers", "Deals", "Invoices"]],
    ["/invoices", ["Customers", "Deals", "Invoices"]],
  ])("links every former child of the section from the page at %s", (path, labels) => {
    renderShell(path);
    const tabs = screen.getByRole("navigation", { name: /pages$/ });
    expect(Array.from(tabs.querySelectorAll("a")).map((a) => a.textContent?.replace(/\s*\([^)]*\)$/, ""))).toEqual(labels);
    expect(within(primaryNav()).queryByRole("list", { name: /pages$/ })).toBeNull();
  });

  it("offers no section tabs on a single-screen section", () => {
    renderShell("/compliance");
    expect(screen.queryByRole("navigation", { name: /pages$/ })).toBeNull();
  });

  it("makes a single-leaf group its own current page", () => {
    renderShell("/admin");
    const current = primaryNav().querySelectorAll('[aria-current="page"]');
    expect(current.length).toBe(1);
    expect(current[0]).toHaveAttribute("href", "/admin");
    expect(current[0].textContent).toContain("Administration");
  });

  it("renders nav destinations as semantic, focusable links", () => {
    renderShell("/dashboard");
    // A group opens its first permitted leaf.
    const link = within(primaryNav()).getByRole("link", { name: "Vehicles" });
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "/inventory");
    link.focus();
    expect(document.activeElement).toBe(link);
    // The ring is asserted through a palette class, not a literal hex: the
    // colour is the rail's to change, a visible focus ring is not.
    expect(link.className).toContain("focus-visible:outline-white/70");
    expect(link.className).not.toMatch(/outline-\[#/);
  });

  it("draws the eight groups in the mock's order with the Platform console last for a platform admin", () => {
    renderShell("/dashboard");
    expect(hrefs(primaryNav())).toEqual([
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
    expect(within(primaryNav()).getByRole("link", { name: "Platform console" })).toHaveAttribute("href", "/platform-admin");
  });

  it("keeps the Platform console from a dealership admin who is not a platform admin", () => {
    auth.isAdmin = false;
    const { container } = renderShell("/dashboard");
    expect(hrefs(primaryNav())).not.toContain("/platform-admin");
    expect(container.querySelector('a[href="/platform-admin"]')).toBeNull();
    expect(within(primaryNav()).getByRole("link", { name: "Administration" })).toBeInTheDocument();
  });

  it("shows a 99+ recon count on the section row and on the Recon Approvals tab", () => {
    renderShell("/recon");
    const rail = primaryNav();
    expect(within(rail).getByText("99+")).toBeInTheDocument();
    expect(within(rail).getByRole("link", { name: "Get Ready 150 pending in Get Ready" })).toHaveAttribute("href", "/get-ready-command");
    expect(within(rail).queryByRole("link", { name: /Recon Approvals/ })).toBeNull();
    expect(within(screen.getByRole("navigation", { name: "Get Ready pages" })).getByRole("link", { name: /^Recon Approvals/ })).toHaveAttribute("aria-current", "page");
  });

  it("rolls a section's queue up onto the section row from the real count", () => {
    renderShell("/dashboard");
    const rail = primaryNav();
    expect(within(rail).getByText("99+")).toBeInTheDocument();
    expect(within(rail).getByRole("link", { name: "Get Ready 150 pending in Get Ready" })).toHaveAttribute("href", "/get-ready-command");
  });

  it("never lists a section's pages in the rail, active or not, and carries no disclosure state", () => {
    for (const path of ["/dashboard", "/prep"]) {
      const view = renderShell(path);
      const rail = primaryNav();
      expect(within(rail).queryByRole("list", { name: /pages$/ })).toBeNull();
      expect(within(rail).queryByRole("link", { name: "Prep & Vendors" })).toBeNull();
      for (const name of ["Today", "Vehicles", "Get Ready", "Compliance", "Reports", "Administration"]) {
        const link = within(rail).getByRole("link", { name: new RegExp(`^${name}`) });
        expect(link).not.toHaveAttribute("aria-expanded");
        expect(link).not.toHaveAttribute("aria-controls");
      }
      view.unmount();
    }
  });

  it("names a one-leaf group after the page it opens", () => {
    auth.isAdmin = false;
    shellRole.value = "service_advisor";
    renderShell("/dashboard");
    const link = within(primaryNav()).getByRole("link", { name: "Work Queue" });
    expect(link).toHaveAttribute("href", "/queue");
    expect(within(primaryNav()).queryByRole("link", { name: "Vehicles" })).toBeNull();
  });

  it("does not offer Administration to a role whose Administration would be empty", () => {
    auth.isAdmin = false;
    for (const role of ["salesperson", "staff"]) {
      shellRole.value = role;
      const view = renderShell("/dashboard");
      expect(hrefs(primaryNav())).not.toContain("/admin");
      view.unmount();
    }
  });

  it("keeps Add Vehicle and Create out of the frame", () => {
    renderShell("/dashboard");
    expect(screen.queryByRole("button", { name: "Add Vehicle" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Create" })).toBeNull();
    expect(within(primaryNav()).queryByRole("link", { name: "Add Vehicle" })).toBeNull();
    expect(within(primaryNav()).queryByRole("link", { name: "Create" })).toBeNull();
  });

  it("prints no page heading of its own; each page renders its single title", () => {
    const inventory = renderShell("/inventory");
    expect(screen.queryByRole("heading", { level: 1, name: "Inventory Command Center" })).toBeNull();
    inventory.unmount();
    renderShell("/admin");
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull();
  });

  it("gives a third-party vendor their assignments and no dealer surface", () => {
    // Capabilities are wide open (platform admin) on purpose: vendor
    // containment must not depend on a capability being set correctly.
    shellRole.value = "third_party_vendor";
    const { container } = renderShell("/dashboard");
    expect(hrefs(primaryNav())).toEqual(["/home/vendor"]);
    expect(container.querySelector('a[href="/platform-admin"]')).toBeNull();
    expect(screen.queryByRole("button", { name: "Add Vehicle" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Create" })).toBeNull();
  });

  it("gives a technician a bench and a board, and no administration", () => {
    shellRole.value = "detail";
    const { container } = renderShell("/dashboard");
    expect(hrefs(primaryNav())).toEqual(["/home/technician", "/ready-board"]);
    expect(container.querySelector('a[href="/platform-admin"]')).toBeNull();
    expect(screen.queryByRole("button", { name: "Add Vehicle" })).toBeNull();
  });

  it("ignores a collapsed-rail preference left in the browser", () => {
    localStorage.setItem("sidebar_collapsed", "1");
    renderShell("/inventory");
    const rail = primaryNav();
    expect(within(rail).queryByText("Inventory")).toBeNull();
    expect(within(rail).getByText("Vehicles")).toBeInTheDocument();
  });

  it("offers a skip link to the page content", () => {
    renderShell("/dashboard");
    const skip = screen.getByRole("link", { name: "Skip to content" });
    fireEvent.click(skip);
    expect(document.activeElement).toBe(document.getElementById("app-scroll"));
  });
});

describe("drawer below lg (matchMedia reports a phone in jsdom)", () => {
  const rail = () => document.getElementById("app-rail") as HTMLElement;
  const content = () => document.getElementById("app-scroll")?.parentElement as HTMLElement;
  const openDrawer = () => {
    const toggle = screen.getByRole("button", { name: "Open menu" });
    toggle.focus();
    fireEvent.click(toggle);
    return toggle;
  };

  it("opens from its trigger as a modal dialog and moves focus into it", () => {
    renderShell("/dashboard");
    const toggle = screen.getByRole("button", { name: "Open menu" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveAttribute("aria-controls", "app-rail");
    expect(rail()).not.toHaveAttribute("role");
    openDrawer();
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("dialog", { name: "Main menu" })).toBe(rail());
    expect(rail()).toHaveAttribute("aria-modal", "true");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close menu" }));
    // The page behind it cannot be reached.
    expect(content()).toHaveAttribute("inert");
  });

  it("closes on Escape and returns focus to the menu button", () => {
    renderShell("/dashboard");
    const toggle = openDrawer();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(rail()).not.toHaveAttribute("role");
    expect(content()).not.toHaveAttribute("inert");
    expect(document.activeElement).toBe(toggle);
  });

  it("returns focus to the menu button from the close button, the scrim and a followed link", () => {
    renderShell("/dashboard");
    let toggle = openDrawer();
    fireEvent.click(screen.getByRole("button", { name: "Close menu" }));
    expect(document.activeElement).toBe(toggle);

    toggle = openDrawer();
    const scrim = document.querySelector(".bg-black\\/50") as HTMLElement;
    fireEvent.click(scrim);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(document.activeElement).toBe(toggle);

    toggle = openDrawer();
    fireEvent.click(within(primaryNav()).getByRole("link", { name: "Vehicles" }));
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(document.activeElement).toBe(toggle);
  });

  it("keeps Tab inside the open drawer", () => {
    renderShell("/dashboard");
    openDrawer();
    const close = screen.getByRole("button", { name: "Close menu" });
    const links = within(rail()).getAllByRole("link");
    const last = links[links.length - 1];
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });
});

describe("header controls", () => {
  it("opens the command palette from the search box and the phone search button", () => {
    tenantState.stores = STORES;
    tenantState.currentStore = STORES[0];
    renderShell("/dashboard");
    const [box, phone] = within(header()).getAllByRole("button", { name: "Search vehicles, customers, or anything" });
    expect(primaryNav().contains(box)).toBe(false);
    expect(box).toHaveAttribute("aria-keyshortcuts");
    fireEvent.click(box);
    expect(palette.setOpen).toHaveBeenCalledWith(true);
    fireEvent.click(phone);
    expect(palette.setOpen).toHaveBeenCalledTimes(2);
  });

  it("names only the searches the palette can run for the role", () => {
    // No rooftop selected: leads are per rooftop, so no customer search.
    renderShell("/dashboard");
    expect(within(header()).getAllByRole("button", { name: "Search vehicles or anything" })).toHaveLength(2);
  });

  it("draws the header from the tenant with no stores and no current store", () => {
    renderShell("/dashboard");
    expect(within(header()).getByText("Test Motors")).toBeInTheDocument();
    // One rooftop: static, so there is no switcher and no chevron.
    expect(within(header()).queryByRole("button", { name: /switch rooftop/i })).toBeNull();
    expect(within(header()).getByRole("button", { name: "Notifications" })).toBeInTheDocument();
    expect(within(header()).getByRole("button", { name: "Account menu for Ken" })).toBeInTheDocument();
    expect(within(header()).queryByText(/MarketCheck|Synced|Last sync|Select store/)).toBeNull();
  });

  it("names the platform instead of asking for a store when a platform admin has no dealership", () => {
    tenantState.tenant = { id: "house", name: "AutoLabels.io" };
    renderShell("/platform-admin");
    expect(within(header()).getByText("AutoLabels platform")).toBeInTheDocument();
    expect(within(header()).queryByText(/Select store|AutoLabels\.io/)).toBeNull();
  });

  it("draws the rooftop chevrons and a switcher only when there is more than one rooftop", () => {
    tenantState.stores = [STORES[0]];
    tenantState.currentStore = STORES[0];
    const one = renderShell("/dashboard");
    expect(within(header()).queryByRole("button", { name: /switch rooftop/i })).toBeNull();
    const staticRooftop = within(header()).getByTitle("Test Motors, Springfield, MA | Test Motors North");
    expect(staticRooftop.querySelectorAll("svg")).toHaveLength(0);
    one.unmount();

    tenantState.stores = STORES;
    renderShell("/dashboard");
    const switcher = within(header()).getByRole("button", { name: /switch rooftop/i });
    // The visible words are the accessible name: group, location, rooftop.
    expect(switcher).toHaveAccessibleName("Test Motors, Springfield, MA, Test Motors North: switch rooftop");
    expect(switcher.querySelectorAll("svg")).toHaveLength(2);
  });

  it("shows a rooftop's own city, never another store's", () => {
    tenantState.stores = STORES;
    tenantState.currentStore = STORES[2];
    settingsState.settings = { dealer_name: "Test Motors", dealer_city: "Hartford", dealer_state: "CT" };
    renderShell("/dashboard");
    const switcher = within(header()).getByRole("button", { name: /switch rooftop/i });
    expect(switcher).toHaveAccessibleName("Test Motors, Test Motors East: switch rooftop");
  });

  it("uses the dealership address for the one rooftop synthesized from the tenant", () => {
    const synthesized = { id: "t1", name: "Test Motors", city: "", state: "" };
    tenantState.stores = [synthesized];
    tenantState.currentStore = synthesized;
    settingsState.settings = { dealer_name: "Test Motors", dealer_city: "Hartford", dealer_state: "CT" };
    renderShell("/dashboard");
    expect(within(header()).getByTitle("Test Motors, Hartford, CT")).toBeInTheDocument();
  });

  it("switches rooftops from the keyboard, closes, and returns focus to the switcher", async () => {
    tenantState.stores = STORES;
    tenantState.currentStore = STORES[0];
    renderShell("/dashboard");
    const switcher = within(header()).getByRole("button", { name: /switch rooftop/i });
    switcher.focus();
    fireEvent.click(switcher);
    const dialog = await screen.findByRole("dialog", { name: "Switch rooftop" });
    const filter = within(dialog).getByRole("combobox");
    await waitFor(() => expect(document.activeElement).toBe(filter));
    expect(within(dialog).getAllByRole("option").map((o) => o.textContent)).toEqual([
      expect.stringContaining("Test Motors North"),
      expect.stringContaining("Test Motors South"),
      expect.stringContaining("Test Motors East"),
      expect.stringContaining("Dealership overview"),
    ]);
    fireEvent.keyDown(filter, { key: "ArrowDown" });
    fireEvent.keyDown(filter, { key: "Enter" });
    expect(tenantState.setCurrentStore).toHaveBeenCalledWith(STORES[1]);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Switch rooftop" })).toBeNull());
    expect(document.activeElement).toBe(switcher);
  });

  it("filters rooftops and opens the dealership overview only for roles that hold it", async () => {
    tenantState.stores = STORES;
    tenantState.currentStore = STORES[0];
    auth.isAdmin = false;
    shellRole.value = "salesperson";
    renderShell("/dashboard");
    fireEvent.click(within(header()).getByRole("button", { name: /switch rooftop/i }));
    const dialog = await screen.findByRole("dialog", { name: "Switch rooftop" });
    expect(within(dialog).queryByRole("option", { name: /Dealership overview/ })).toBeNull();
    fireEvent.change(within(dialog).getByRole("combobox"), { target: { value: "chicopee" } });
    await waitFor(() => expect(within(dialog).getAllByRole("option")).toHaveLength(1));
    expect(within(dialog).getByRole("option")).toHaveTextContent("Test Motors South");
  });
});

describe("notifications", () => {
  const NOTIFS = [
    { id: "n1", tenant_id: "t1", user_id: "u1", type: "service_task_assigned", dedupe_key: null, vin: "1hgcm82633a004352", payload: {}, read_at: null, created_at: new Date().toISOString() },
    { id: "n2", tenant_id: "t1", user_id: "u1", type: "service_task_assigned", dedupe_key: null, vin: null, payload: {}, read_at: null, created_at: new Date().toISOString() },
  ];
  const BLOCKS = [
    { id: "a1", action: "compliance_block", entity_type: "vehicle_listing", entity_id: "v1", created_at: new Date().toISOString(), details: { ymm: "2022 Example Sedan" } },
    { id: "a2", action: "price_integrity_block", entity_type: "vehicle_listing", entity_id: "v2", created_at: new Date().toISOString(), details: {} },
  ];

  it("counts only what the viewer can clear: their unread notifications", async () => {
    db.notifications = NOTIFS;
    auditState.entries = BLOCKS;
    renderShell("/dashboard");
    // Two unread notifications; the two block events have no read state.
    expect(await within(header()).findByRole("button", { name: "Notifications (2 unread)" })).toBeInTheDocument();
  });

  it("opens a dialog whose rows, Mark all read and View all activity all act, and returns focus on Escape", async () => {
    db.notifications = NOTIFS;
    auditState.entries = BLOCKS;
    renderShell("/dashboard");
    const bell = await within(header()).findByRole("button", { name: "Notifications (2 unread)" });
    bell.focus();
    fireEvent.click(bell);
    const panel = await screen.findByRole("dialog", { name: "Notifications" });
    // Every control in it is a real button, reachable with Tab.
    const buttons = within(panel).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual([
      "Mark all read",
      expect.stringContaining("VIN …004352"),
      expect.stringContaining("Service"),
      "View all activity",
    ]);
    // The activity feed is a record, not a set of doors that all open page 1.
    expect(within(panel).getByText("Compliance Block").closest("button")).toBeNull();

    fireEvent.click(within(panel).getByRole("button", { name: "Mark all read" }));
    expect(db.updates.at(-1)).toHaveProperty("read_at");
    // The modal panel hides the page from assistive tech while it is open.
    expect(screen.getByRole("button", { name: "Notifications", hidden: true })).toBe(bell);
    expect(document.activeElement).toBe(panel);

    fireEvent.keyDown(document.activeElement || panel, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Notifications" })).toBeNull());
    expect(document.activeElement).toBe(bell);

    fireEvent.click(bell);
    const again = await screen.findByRole("dialog", { name: "Notifications" });
    fireEvent.click(within(again).getByRole("button", { name: /VIN …004352/ }));
    expect(nav.navigate).toHaveBeenCalledWith("/service/vehicle/1HGCM82633A004352");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Notifications" })).toBeNull());

    fireEvent.click(bell);
    const third = await screen.findByRole("dialog", { name: "Notifications" });
    fireEvent.click(within(third).getByRole("button", { name: "View all activity" }));
    expect(nav.navigate).toHaveBeenCalledWith("/admin?tab=audit");
  });

  it("keeps the activity feed and its door from roles that cannot open the Activity tab", async () => {
    auth.isAdmin = false;
    auditState.entries = BLOCKS;
    for (const role of ["salesperson", "service_advisor", "biller", "readonly", "detail", "third_party_vendor"]) {
      shellRole.value = role;
      const view = renderShell("/dashboard");
      fireEvent.click(within(header()).getByRole("button", { name: "Notifications" }));
      const panel = await screen.findByRole("dialog", { name: "Notifications" });
      expect(within(panel).queryByText("Recent activity")).toBeNull();
      expect(within(panel).queryByRole("button", { name: "View all activity" })).toBeNull();
      expect(within(panel).getByText(/all caught up/)).toBeInTheDocument();
      view.unmount();
    }
  });
});

describe("account menu", () => {
  const items = (menu: HTMLElement) => within(menu).getAllByRole("menuitem").map((i) => i.textContent?.trim());
  const choose = async (name: RegExp) => {
    const trigger = within(header()).getByRole("button", { name: /^Account menu for/ });
    const menu = openMenu(trigger);
    await act(async () => { fireEvent.click(within(menu).getByRole("menuitem", { name })); });
  };

  it("gives every entry a handler that does what it says", async () => {
    auth.isAdmin = false;
    shellRole.value = "admin";
    renderShell("/dashboard");
    const menu = openMenu(within(header()).getByRole("button", { name: "Account menu for Ken" }));
    expect(items(menu)).toEqual([
      expect.stringContaining("AutoLabels"),
      expect.stringContaining("AutoCurb"),
      expect.stringContaining("AutoFilm"),
      "Team & permissions",
      "Workspace settings",
      "Plan & billing",
      "Help & trust center",
      "Sign out",
    ]);
    // The current app and an app not on the plan are shown, disabled, and say why.
    expect(within(menu).getByRole("menuitem", { name: /AutoLabels/ })).toHaveAttribute("aria-disabled", "true");
    expect(within(menu).getByRole("menuitem", { name: /AutoLabels/ })).toHaveTextContent("Current app");
    expect(within(menu).getByRole("menuitem", { name: /AutoFilm/ })).toHaveAttribute("aria-disabled", "true");
    expect(within(menu).getByRole("menuitem", { name: /AutoFilm/ })).toHaveTextContent("Not on your plan");
    fireEvent.keyDown(menu, { key: "Escape" });

    await choose(/AutoCurb/);
    expect(db.invoke).toHaveBeenCalledWith("mint-handoff-token", { body: { targetApp: "autocurb" } });
    await choose(/Team & permissions/);
    expect(nav.navigate).toHaveBeenLastCalledWith("/admin?tab=team");
    await choose(/Workspace settings/);
    expect(nav.navigate).toHaveBeenLastCalledWith("/admin?tab=settings");
    await choose(/Plan & billing/);
    expect(db.invoke).toHaveBeenLastCalledWith("billing-portal-session", expect.anything());
    await choose(/Help & trust center/);
    expect(nav.navigate).toHaveBeenLastCalledWith("/trust");
    await choose(/Sign out/);
    expect(auth.signOut).toHaveBeenCalled();
    expect(nav.navigate).toHaveBeenLastCalledWith("/login");
  });

  it("offers Plan & billing only to the roles that manage billing, matching the palette", () => {
    auth.isAdmin = false;
    const expectations: Record<string, boolean> = {
      owner: true, general_manager: true, admin: true, manager: true, biller: true,
      gsm: false, salesperson: false, service_advisor: false, readonly: false, detail: false, third_party_vendor: false,
    };
    for (const [role, offered] of Object.entries(expectations)) {
      shellRole.value = role;
      const view = renderShell("/dashboard");
      const menu = openMenu(within(header()).getByRole("button", { name: /^Account menu for/ }));
      expect([role, items(menu).includes("Plan & billing")]).toEqual([role, offered]);
      view.unmount();
    }
  });

  it("offers Workspace settings only when Administration has a tab for the role", () => {
    auth.isAdmin = false;
    for (const [role, offered] of [["salesperson", false], ["staff", false], ["detail", false], ["biller", true], ["compliance", true]] as const) {
      shellRole.value = role;
      const view = renderShell("/dashboard");
      const menu = openMenu(within(header()).getByRole("button", { name: /^Account menu for/ }));
      expect([role, items(menu).includes("Workspace settings")]).toEqual([role, offered]);
      view.unmount();
    }
  });

  it("shows the dealership role and the platform authority as separate chips", () => {
    shellRole.value = "salesperson";
    auth.isAdmin = true;
    renderShell("/dashboard");
    const menu = openMenu(within(header()).getByRole("button", { name: /^Account menu for/ }));
    expect(within(menu).getByText("Salesperson")).toBeInTheDocument();
    expect(within(menu).getByText("Platform Admin")).toBeInTheDocument();
  });
});

describe("bottom navigation", () => {
  it("is a named landmark of links lit by the rail's own matchers", () => {
    renderShell("/home/gm");
    const bar = screen.getByRole("navigation", { name: "Quick actions" });
    const home = within(bar).getByRole("link", { name: "Home" });
    expect(home).toHaveAttribute("href", "/dashboard");
    expect(home).toHaveAttribute("aria-current", "page");
    expect(within(bar).getByRole("link", { name: "Inventory" })).not.toHaveAttribute("aria-current");
    // Scan is an action, not a destination.
    expect(within(bar).getByRole("button", { name: "Scan" })).toBeInTheDocument();
  });
});
