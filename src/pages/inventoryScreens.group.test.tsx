import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useLocation } from "react-router-dom";
import { renderAdmin } from "@/test/adminRender";
import { resetSupabaseSpy, rpcCalls, spyCalls, spyResponses, writeCalls } from "@/test/mocks/supabaseSpy";
import { accessPayload, dealerStoreRows, feedRow, feedRowsFor, resetSerial, rowsResponder, SIX_STORES } from "@/test/fixtures/groupInventory";
import { selectionKey } from "@/lib/inventoryScope/groupInventory";
import InventoryModern from "./InventoryModern";
import InventoryCommandCenterV2 from "./InventoryCommandCenterV2";

// Multi-dealership selection on both Inventory screens: read-only, selection
// persisted per user and tenant, and every failure to verify the combined view
// shows an error with Retry rather than partial totals.

vi.mock("@/integrations/supabase/client", async () => {
  const m = await import("@/test/mocks/supabaseSpy");
  return { supabase: m.supabaseSpy };
});
vi.mock("sonner", () => ({ toast: Object.assign(() => {}, { info: () => {}, error: () => {}, success: () => {}, warning: () => {} }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, session: null, isAdmin: false, loading: false, signOut: () => {} }) }));
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: { id: "t1", name: "Harte Auto Group" }, currentStore: null, stores: [], loading: false, setCurrentStore: () => {} }) }));
vi.mock("@/hooks/useEntitlements", () => ({ useEntitlements: () => ({ tenant: { id: "t1" }, member: { role: "owner" }, profile: null, entitlements: [], loading: false }) }));
vi.mock("@/contexts/VinScanContext", () => ({ useVinScan: () => ({ openScan: () => {} }) }));
vi.mock("@/hooks/useAdvertisedPrices", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/hooks/useAdvertisedPrices")>();
  return { ...mod, useAdvertisedPrices: () => ({ byVin: new Map(), loading: false }) };
});
vi.mock("@/hooks/useGetReady", () => ({ useGetReady: () => ({ createGetReady: vi.fn() }) }));
vi.mock("@/contexts/DealerSettingsContext", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/contexts/DealerSettingsContext")>();
  return { ...mod, useDealerSettings: () => ({ settings: { ...mod.DEFAULT_SETTINGS }, updateSettings: vi.fn(async () => true), reload: vi.fn(async () => {}), loading: false }) };
});

const PRIMARY = "st-infiniti";
const ALL_IDS = SIX_STORES.map((s) => s.id);
const KEY = selectionKey("u1", "t1");

let feed = feedRowsFor(SIX_STORES);
const listing = (id: string, vin: string, ymm: string, over: Record<string, unknown> = {}) => ({
  id, tenant_id: "t1", vin, ymm, trim: "Luxe", mileage: 10, condition: "new", price: 61000, status: "published", slug: id,
  source_url: null, published_at: null, view_count: 0, created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-01T00:00:00Z",
  owning_store_id: PRIMARY, mc_dealer_id: null, ...over,
});
let listings: ReturnType<typeof listing>[] = [];
// Four working listings of the primary store; the first is also in the primary feed.
const arrange = () => {
  resetSerial();
  feed = feedRowsFor(SIX_STORES);
  const primaryFeed = feed.filter((r) => r.store_id === PRIMARY);
  listings = [
    listing("L1", primaryFeed[0].vin, "2026 INFINITI QX60"),
    listing("L2", "JN8AZ3CC0T9000002", "2026 INFINITI QX80"),
    listing("L3", "JN8AZ3CC0T9000003", "2025 INFINITI Q50", { status: "draft", condition: "used" }),
    listing("L4", "JN8AZ3CC0T9000004", "2025 INFINITI QX50", { price: null, condition: "used" }),
  ];
  spyResponses.tables.dealer_stores = { data: dealerStoreRows() };
  spyResponses.tables.vehicle_listings = () => ({ data: listings, count: listings.length });
  spyResponses.rpcs.inventory_scope_report = () => ({ data: { tenant_id: "t1", stores: SIX_STORES.map((s) => ({ store_id: s.id, primary: s.primary })) }, error: null });
  spyResponses.rpcs.inventory_group_view_access = () => ({ data: accessPayload(feed), error: null });
  spyResponses.rpcs.inventory_group_view_rows = rowsResponder(feed);
};

beforeEach(() => {
  resetSupabaseSpy();
  window.localStorage.clear();
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
  arrange();
});

let here = "";
const Probe = () => { here = useLocation().pathname + useLocation().search; return null; };

const SCREENS = [
  { name: "/inventory", ui: () => <><InventoryModern /><Probe /></> },
  { name: "/inventory-v2", ui: () => <><InventoryCommandCenterV2 /><Probe /></> },
];

const select = (ids: string[] | null) => { if (ids) window.localStorage.setItem(KEY, JSON.stringify(ids)); };
const expectedTotal = (ids: string[]) => {
  const feedN = feed.filter((r) => ids.includes(r.store_id)).length;
  return ids.includes(PRIMARY) ? feedN + listings.length - 1 : feedN;
};
const summaryLine = async () => (await screen.findByTestId("dealership-summary-line")).textContent || "";
const feedRowsCalls = () => spyCalls.filter((c) => c.kind === "rpc" && c.fn === "inventory_group_view_rows");

describe.each(SCREENS)("$name dealership selection", ({ ui }) => {
  it("defaults to the primary dealership: same listings, no feed rows read, selector shown", async () => {
    renderAdmin(ui(), { route: "/inventory" });
    await waitFor(() => expect(screen.getAllByText(/2026 INFINITI QX60/).length).toBeGreaterThan(0));
    expect((await screen.findByTestId("dealership-summary")).textContent).toBe("Harte INFINITI");
    expect(feedRowsCalls()).toEqual([]);
    expect(screen.queryByTestId("dealership-summary-line")).toBeNull();
    expect(screen.queryByTestId("dealership-status")).toBeNull();
    expect(writeCalls()).toEqual([]);
  });

  it.each([
    ["two", [PRIMARY, "st-harte-nissan"]],
    ["three", [PRIMARY, "st-george-nissan", "st-vw"]],
    ["all six", ALL_IDS],
    ["one child", ["st-hyundai"]],
  ])("combines %s dealerships with totals that cover exactly the selection", async (_label, ids) => {
    select(ids);
    renderAdmin(ui(), { route: "/inventory" });
    const line = await summaryLine();
    expect(line).toContain(`Showing ${expectedTotal(ids).toLocaleString()} vehicles from ${ids.length} of 6 dealerships`);
    const named = line.slice(line.indexOf("dealerships: ") + "dealerships: ".length, line.indexOf(". Each dealership")).split(", ");
    expect(new Set(named)).toEqual(new Set(SIX_STORES.filter((x) => ids.includes(x.id)).map((x) => x.name)));
    expect(feedRowsCalls().length).toBeGreaterThan(0);
    expect(writeCalls()).toEqual([]);
  });

  it("shows the same vehicle once when it is both the primary feed row and its listing", async () => {
    select([PRIMARY, "st-hyundai"]);
    renderAdmin(ui(), { route: "/inventory" });
    await summaryLine();
    const vin = feed.find((r) => r.store_id === PRIMARY)!.vin;
    expect(screen.getAllByText(new RegExp(vin.slice(-6))).length).toBeGreaterThan(0);
    expect((await summaryLine())).toContain(`Showing ${expectedTotal([PRIMARY, "st-hyundai"])} vehicles`);
  });

  it("feed-only rows have no mutating actions and never route to a vehicle file", async () => {
    select(["st-hyundai"]);
    renderAdmin(ui(), { route: "/inventory" });
    await summaryLine();
    const first = feed.find((r) => r.store_id === "st-hyundai")!;
    const detailButtons = screen.getAllByRole("button", { name: /Feed details for/ });
    expect(detailButtons.length).toBe(7);
    const containers = detailButtons.map((b) => b.closest("tr, div.group, div.grid") as HTMLElement);
    for (const c of containers) {
      expect(within(c).queryAllByRole("button").every((b) => /^(Feed details|Details$)/.test(b.getAttribute("aria-label") || b.textContent || ""))).toBe(true);
      expect(c.textContent).not.toMatch(/Publish listing|Delete|Create addendum|Open vehicle|Generate sticker|Edit/i);
      expect(c.querySelector("[aria-haspopup]")).toBeNull();
      expect(c.querySelector('button[aria-label="More actions"]')).toBeNull();
    }
    expect(document.querySelectorAll('a[href*="vehicle-file"]')).toHaveLength(0);
    fireEvent.click(screen.getAllByText(new RegExp(first.vin.slice(-6)))[0]);
    expect(here).not.toMatch(/vehicle-file/);
    fireEvent.click(detailButtons[0]);
    const sheet = await screen.findByTestId("feed-vehicle-sheet");
    expect(here).not.toMatch(/vehicle-file/);
    expect(within(sheet).getByText(/Read-only/)).toBeTruthy();
    expect(within(sheet).queryByRole("button", { name: /publish|edit|delete|addendum/i })).toBeNull();
    expect(sheet.querySelectorAll("a[href*='vehicle-file']")).toHaveLength(0);
    expect(within(sheet).getByText(first.vin)).toBeTruthy();
    expect(writeCalls()).toEqual([]);
  });

  it("the details sheet says 'Price not in feed' and 'No photos in feed' instead of inventing values", async () => {
    feed = feed.map((r) => (r.id === "st-hyundai-inv-1" ? { ...r, feed_price: null, feed_price_status: "unknown" as const, photos: [], photo_count: 0 } : r));
    spyResponses.rpcs.inventory_group_view_access = () => ({ data: accessPayload(feed), error: null });
    spyResponses.rpcs.inventory_group_view_rows = rowsResponder(feed);
    select(["st-hyundai"]);
    renderAdmin(ui(), { route: "/inventory" });
    await summaryLine();
    const target = feed.find((r) => r.id === "st-hyundai-inv-1")!;
    const row = screen.getAllByText(new RegExp(target.vin.slice(-6)))[0].closest("tr, div.grid, div.group") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: /Feed details for/ }));
    const sheet = await screen.findByTestId("feed-vehicle-sheet");
    expect(within(sheet).getByText("Price not in feed")).toBeTruthy();
    expect(within(sheet).getByText("No photos in feed")).toBeTruthy();
    expect(within(sheet).getByText("In the latest feed")).toBeTruthy();
    expect(sheet.textContent).not.toMatch(/\$0\b/);
  });

  it("labels feed-only vehicles 'Feed only', never Published", async () => {
    select(["st-hyundai"]);
    renderAdmin(ui(), { route: "/inventory" });
    await summaryLine();
    const badges = screen.getAllByTestId("dealership-status");
    expect(badges.length).toBeGreaterThan(0);
    expect(badges.every((b) => b.textContent === "Feed only")).toBe(true);
    const rowsOf = screen.getAllByRole("button", { name: /Feed details for/ }).map((b) => b.closest("tr, div.group, div.grid") as HTMLElement);
    expect(rowsOf.length).toBeGreaterThan(0);
    expect(rowsOf.every((r) => !/Published/.test(r.textContent || ""))).toBe(true);
  });

  it("flags a VIN claimed by two rooftops as needing review on both", async () => {
    const dup = feed.find((r) => r.store_id === "st-vw")!;
    feed = feed.map((r) => (r.id === "st-hyundai-inv-1" ? { ...r, vin: dup.vin } : r));
    spyResponses.rpcs.inventory_group_view_access = () => ({ data: accessPayload(feed), error: null });
    spyResponses.rpcs.inventory_group_view_rows = rowsResponder(feed);
    select(["st-vw", "st-hyundai"]);
    renderAdmin(ui(), { route: "/inventory" });
    await summaryLine();
    const tail = dup.vin.slice(-6);
    for (const store of ["Harte Volkswagen of Meriden", "Harte Hyundai of Old Saybrook"]) {
      const holders = screen.getAllByText(new RegExp(tail)).map((e) => e.closest("tr, div.group, div.grid") as HTMLElement).filter((r) => r && r.textContent!.includes(store));
      expect(holders.length).toBeGreaterThan(0);
      expect(holders.every((r) => r.querySelector('[data-status="review"]'))).toBe(true);
    }
  });

  it("persists the choice made in the dropdown and the other screen reads the same selection", async () => {
    const first = renderAdmin(ui(), { route: "/inventory" });
    fireEvent.click(await screen.findByTestId("dealership-trigger"));
    fireEvent.click(await screen.findByRole("button", { name: "Select all dealerships" }));
    await screen.findByTestId("dealership-summary-line");
    expect(new Set(JSON.parse(window.localStorage.getItem(KEY)!))).toEqual(new Set(ALL_IDS));
    first.unmount();
    const other = SCREENS.find((s) => s.name !== (ui === SCREENS[0].ui ? SCREENS[0].name : SCREENS[1].name))!;
    renderAdmin(other.ui(), { route: "/inventory" });
    expect((await screen.findByTestId("dealership-summary")).textContent).toBe("All 6 dealerships");
  });

  it("unchecks a dealership from the dropdown and returns to the primary view with 'Primary dealership only'", async () => {
    select(ALL_IDS);
    renderAdmin(ui(), { route: "/inventory" });
    await summaryLine();
    fireEvent.click(screen.getByTestId("dealership-trigger"));
    const box = await screen.findByRole("checkbox", { name: /Harte Volkswagen of Meriden/ });
    fireEvent.click(box);
    await waitFor(() => expect(screen.getByTestId("dealership-summary").textContent).toBe("5 of 6 dealerships"));
    fireEvent.click(await screen.findByRole("button", { name: "Primary dealership only" }));
    await waitFor(() => expect(screen.getByTestId("dealership-summary").textContent).toBe("Harte INFINITI"));
    expect(window.localStorage.getItem(KEY)).toBeNull();
    await waitFor(() => expect(screen.queryByTestId("dealership-summary-line")).toBeNull());
  });

  it("keeps at least one dealership selected", async () => {
    renderAdmin(ui(), { route: "/inventory" });
    fireEvent.click(await screen.findByTestId("dealership-trigger"));
    const box = await screen.findByRole("checkbox", { name: /^Harte INFINITI Primary/ });
    expect((box as HTMLInputElement).disabled).toBe(true);
  });

  it("falls back to the primary dealership with a note when access is denied", async () => {
    select(ALL_IDS);
    spyResponses.rpcs.inventory_group_view_access = () => ({ data: accessPayload([], SIX_STORES, { allowed: false }), error: null });
    renderAdmin(ui(), { route: "/inventory" });
    await waitFor(() => expect(screen.getAllByText(/2026 INFINITI QX60/).length).toBeGreaterThan(0));
    expect((await screen.findByTestId("dealership-note")).textContent).toMatch(/primary dealership only/);
    expect(screen.queryByTestId("dealership-trigger")).toBeNull();
    expect(feedRowsCalls()).toEqual([]);
    expect(screen.queryByTestId("dealership-summary-line")).toBeNull();
  });

  it("falls back to the primary dealership with a note when the migration is not applied", async () => {
    select(ALL_IDS);
    delete spyResponses.rpcs.inventory_group_view_access;
    renderAdmin(ui(), { route: "/inventory" });
    await waitFor(() => expect(screen.getAllByText(/2026 INFINITI QX60/).length).toBeGreaterThan(0));
    expect((await screen.findByTestId("dealership-note")).textContent).toMatch(/not available yet/);
    expect(screen.queryByTestId("dealership-trigger")).toBeNull();
    expect(feedRowsCalls()).toEqual([]);
  });

  it("falls back with a note when access cannot be verified", async () => {
    select(ALL_IDS);
    spyResponses.rpcs.inventory_group_view_access = { data: null, error: { code: "57014", message: "statement timeout" } };
    renderAdmin(ui(), { route: "/inventory" });
    expect((await screen.findByTestId("dealership-note")).textContent).toMatch(/could not be verified/);
    expect(screen.queryByTestId("dealership-trigger")).toBeNull();
    expect(screen.getAllByText(/2026 INFINITI QX60/).length).toBeGreaterThan(0);
  });

  it("shows the registry failure error, not the combined view, when the store list cannot be read", async () => {
    select(ALL_IDS);
    spyResponses.tables.dealer_stores = { data: null, error: { code: "42501", message: "permission denied" } };
    renderAdmin(ui(), { route: "/inventory" });
    const alert = await screen.findByTestId("inventory-scope-error");
    expect(alert.textContent).toMatch(/Store list could not be read/);
    expect(screen.queryByTestId("dealership-summary-line")).toBeNull();
    expect(screen.queryByTestId("dealership-status")).toBeNull();
  });

  it("shows an error with Retry, and no partial totals, when the combined rows fail validation", async () => {
    select(["st-hyundai", "st-vw"]);
    spyResponses.rpcs.inventory_group_view_rows = (a) => {
      const r = rowsResponder(feed)(a);
      return { ...r, data: { ...r.data, rows: r.data.rows.slice(1) } };
    };
    renderAdmin(ui(), { route: "/inventory" });
    const alert = await screen.findByTestId("dealership-view-error");
    expect(alert.textContent).toMatch(/totals could not be verified/);
    expect(within(alert).getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.queryByTestId("dealership-summary-line")).toBeNull();
    expect(screen.queryByTestId("dealership-status")).toBeNull();

    spyResponses.rpcs.inventory_group_view_rows = rowsResponder(feed);
    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(await summaryLine()).toContain(`Showing ${expectedTotal(["st-hyundai", "st-vw"])} vehicles`);
  });

  it("fails closed when the offered dealerships differ from the store registry", async () => {
    select(ALL_IDS);
    spyResponses.tables.dealer_stores = { data: dealerStoreRows(SIX_STORES.slice(0, 5)) };
    spyResponses.rpcs.inventory_scope_report = () => ({ data: { tenant_id: "t1", stores: SIX_STORES.slice(0, 5).map((s) => ({ store_id: s.id, primary: s.primary })) }, error: null });
    renderAdmin(ui(), { route: "/inventory" });
    const alert = await screen.findByTestId("dealership-view-error");
    expect(alert.textContent).toMatch(/does not match/);
    expect(screen.queryByTestId("dealership-summary-line")).toBeNull();
  });

  it("searches VIN, stock number and make/model across the combined rows", async () => {
    select(ALL_IDS);
    renderAdmin(ui(), { route: "/inventory" });
    await summaryLine();
    if (ui === SCREENS[0].ui) {
      fireEvent.click(screen.getByRole("button", { name: "More actions" }));
      fireEvent.click(await screen.findByRole("menuitem", { name: /Filter and sort/ }));
    }
    const box = await screen.findByLabelText("Search inventory");
    const vwVin = feed.find((r) => r.store_id === "st-vw")!.vin;
    fireEvent.change(box, { target: { value: vwVin } });
    await waitFor(() => expect(screen.getAllByText(new RegExp(vwVin.slice(-6))).length).toBeGreaterThan(0));
    expect(screen.queryAllByRole("button", { name: /Feed details for/ })).toHaveLength(1);
    const hyundai = feed.find((r) => r.store_id === "st-hyundai")!;
    fireEvent.change(box, { target: { value: hyundai.stock_number! } });
    await waitFor(() => expect(screen.queryAllByRole("button", { name: /Feed details for/ }).length).toBe(1));
    fireEvent.change(box, { target: { value: "Atlas" } });
    await waitFor(() => {
      const names = screen.queryAllByRole("button", { name: /Feed details for/ }).map((b) => b.getAttribute("aria-label") || "");
      expect(names.length).toBeGreaterThan(0);
      expect(names.every((n) => /Atlas/.test(n))).toBe(true);
    });
  });
});

describe("/inventory combined view specifics", () => {
  it("adds a Dealership column and a store line on phone cards", async () => {
    select(["st-hyundai", "st-vw"]);
    renderAdmin(<InventoryModern />, { route: "/inventory" });
    await summaryLine();
    expect(screen.getByRole("columnheader", { name: "Dealership" })).toBeTruthy();
    expect(screen.getAllByText("Harte Hyundai of Old Saybrook").length).toBeGreaterThan(7);
  });

  it("disables listing-only batch actions with an explanation while feed-only rows are shown", async () => {
    select(["st-hyundai"]);
    renderAdmin(<InventoryModern />, { route: "/inventory" });
    await summaryLine();
    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    const recalls = await screen.findByRole("menuitem", { name: /Check Recalls/ });
    expect((recalls as HTMLButtonElement).disabled).toBe(true);
    expect(recalls.getAttribute("title")).toMatch(/listings only/);
    expect((screen.getByRole("menuitem", { name: /CSV Import/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(rpcCalls().filter((f) => !/^inventory_(scope_report|group_view_)/.test(f))).toEqual([]);
  });

  it("exports feed-only rows to CSV with their dealership, as a read-only action", async () => {
    select(["st-hyundai"]);
    renderAdmin(<InventoryModern />, { route: "/inventory" });
    await summaryLine();
    const boxes = screen.getAllByRole("checkbox", { name: /^Select / });
    fireEvent.click(boxes[1]);
    expect(await screen.findByText(/Includes feed-only vehicles/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Export CSV" })).toBeTruthy();
  });

  it("filters by status and shows per-condition tab counts for the combined rows", async () => {
    select(ALL_IDS);
    renderAdmin(<InventoryModern />, { route: "/inventory" });
    await summaryLine();
    const used = feed.filter((r) => r.condition === "used").length - 1 + 2;
    const tab = screen.getByRole("link", { name: /^Used/ });
    expect(tab.textContent).toContain(String(used));
    expect(screen.getByRole("link", { name: /^All/ }).textContent).toContain(String(expectedTotal(ALL_IDS)));
  });

  it("pages 2,000 combined rows", async () => {
    resetSerial();
    feed = [...feedRowsFor(SIX_STORES).filter((r) => r.store_id !== "st-vw"), ...Array.from({ length: 2000 }, (_, i) => feedRow("st-vw", i + 1000))];
    spyResponses.rpcs.inventory_group_view_access = () => ({ data: accessPayload(feed), error: null });
    spyResponses.rpcs.inventory_group_view_rows = rowsResponder(feed);
    select(["st-vw"]);
    renderAdmin(<InventoryModern />, { route: "/inventory" });
    expect(await summaryLine()).toContain("Showing 2,000 vehicles");
    expect(feedRowsCalls()).toHaveLength(4);
    expect(document.body.textContent).toContain("Showing 1–25 of 2000 vehicles");
    expect(screen.getAllByRole("button", { name: /Feed details for/ })).toHaveLength(25);
  });
});

describe("/inventory-v2 combined view specifics", () => {
  it("counts the selection in the KPI tiles and tabs and pages the rows", async () => {
    select(["st-hyundai", "st-vw", "st-george-nissan"]);
    renderAdmin(<InventoryCommandCenterV2 />, { route: "/inventory-v2" });
    await summaryLine();
    const n = expectedTotal(["st-hyundai", "st-vw", "st-george-nissan"]);
    expect(screen.getByRole("tab", { name: /^All/ }).textContent).toContain(String(n));
    expect(document.body.textContent).toContain(`Showing 1–${Math.min(25, n)} of ${n}`);
    expect(screen.getByRole("tab", { name: /^Ready to publish/ }).textContent).toContain("0");
  });

  it("shows the per-store count in the dropdown", async () => {
    renderAdmin(<InventoryCommandCenterV2 />, { route: "/inventory-v2" });
    fireEvent.click(await screen.findByTestId("dealership-trigger"));
    const group = await screen.findByRole("group", { name: "Dealerships" });
    const row = within(group).getByText("George Harte Nissan").closest("label") as HTMLElement;
    expect(within(row).getByLabelText("8 vehicles")).toBeTruthy();
  });
});
