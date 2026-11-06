import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { renderAdmin } from "@/test/adminRender";
import { functionCalls, resetSupabaseSpy, spyCalls, spyResponses, writeCalls, type SpyOp } from "@/test/mocks/supabaseSpy";
import InventoryModern from "./InventoryModern";
import InventoryCommandCenterV2 from "./InventoryCommandCenterV2";

// Both dealer Inventory screens, desktop and phone width: they show the primary
// dealership only, and any failure to verify store scope shows an error with
// Retry and no vehicles at all, never the unscoped mixed list.

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

const PRIMARY = "45cd", HYUNDAI = "02b4";
const stores = [
  { id: PRIMARY, tenant_id: "t1", display_name: "Harte INFINITI", is_primary_inventory_store: true, status: "active", provider_ids: { marketcheck_dealer_id: ["1013372"] } },
  { id: HYUNDAI, tenant_id: "t1", display_name: "Harte Hyundai of Old Saybrook", is_primary_inventory_store: false, status: "active", provider_ids: {} },
];
const row = (id: string, vin: string, ymm: string, extra: Record<string, unknown>) => ({
  id, tenant_id: "t1", vin, ymm, trim: null, mileage: 10, condition: "new", price: 50000, status: "published", slug: id,
  source_url: null, published_at: null, view_count: 0, created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-01T00:00:00Z",
  owning_store_id: null, mc_dealer_id: null, ...extra,
});
const PRIMARY_CAR = row("a1", "JN8AZ3CC0T9000001", "2026 INFINITI QX60", { owning_store_id: PRIMARY });
const MAPPED_CAR = row("a2", "JN8AZ3CC0T9000002", "2026 INFINITI QX80", { mc_dealer_id: "1013372" });
const SISTER_CAR = row("a3", "5NMP54G13TH144040", "2026 Hyundai Santa Fe", { mc_dealer_id: "1028492" });
const CHILD_CAR = row("a4", "KM8JBDD13TU000004", "2026 Hyundai Tucson", { owning_store_id: HYUNDAI });
const MANUAL_CAR = row("a5", "5N1AT3CB7MC736556", "2021 NISSAN Rogue", {});

const listingsOk = (rows = [PRIMARY_CAR, MAPPED_CAR, SISTER_CAR, CHILD_CAR, MANUAL_CAR]) => ({ data: rows, count: rows.length });

// The server's own view of the tenant's stores (inventory_scope_report, SECURITY DEFINER).
let serverStores: typeof stores = stores;
const serverReport = () => ({ data: { tenant_id: "t1", stores: serverStores.map((s) => ({ store_id: s.id, primary: s.is_primary_inventory_store })) }, error: null });

beforeEach(() => {
  resetSupabaseSpy();
  serverStores = stores;
  spyResponses.rpcs.inventory_scope_report = () => serverReport();
  spyResponses.tables.dealer_stores = { data: stores };
  spyResponses.tables.vehicle_listings = listingsOk();
});

const SCREENS = [
  { name: "/inventory", ui: () => <InventoryModern /> },
  { name: "/inventory-v2", ui: () => <InventoryCommandCenterV2 /> },
];

const setWidth = (w: number) => { Object.defineProperty(window, "innerWidth", { configurable: true, value: w }); window.dispatchEvent(new Event("resize")); };

describe.each(SCREENS)("$name store scope", ({ ui }) => {
  for (const width of [1440, 390]) {
    it(`shows only the primary dealership's verified vehicles (width ${width})`, async () => {
      setWidth(width);
      renderAdmin(ui(), { route: "/inventory" });
      await waitFor(() => expect(screen.getAllByText(/2026 INFINITI QX60/).length).toBeGreaterThan(0));
      expect(screen.getAllByText(/2026 INFINITI QX80/).length).toBeGreaterThan(0);
      expect(screen.queryByText(/Hyundai Santa Fe/)).toBeNull();
      expect(screen.queryByText(/Hyundai Tucson/)).toBeNull();
      expect(screen.queryByText(/NISSAN Rogue/)).toBeNull();
      expect(functionCalls()).toEqual([]);
      expect(writeCalls()).toEqual([]);
    });
  }

  const failures: Array<[string, () => void, RegExp]> = [
    ["store registry read failure", () => { spyResponses.tables.dealer_stores = { data: null, error: { code: "42501", message: "permission denied" } }; }, /Store list could not be read/],
    ["scope columns missing", () => { spyResponses.tables.vehicle_listings = { data: null, error: { code: "42703", message: "column vehicle_listings.owning_store_id does not exist" } }; }, /Store ownership could not be read/],
    ["no primary store", () => { serverStores = stores.map((s) => ({ ...s, is_primary_inventory_store: false })); spyResponses.tables.dealer_stores = { data: serverStores }; }, /No primary dealership is set/],
    ["two primary stores", () => { serverStores = stores.map((s) => ({ ...s, is_primary_inventory_store: true })); spyResponses.tables.dealer_stores = { data: serverStores }; }, /More than one primary dealership/],
    ["permissions showing only one of the account's stores", () => { spyResponses.tables.dealer_stores = { data: [stores[0]] }; }, /Store list is incomplete/],
    ["permissions showing only a child store, with no store-owned rows", () => { spyResponses.tables.dealer_stores = { data: [stores[1]] }; spyResponses.tables.vehicle_listings = listingsOk([MAPPED_CAR, SISTER_CAR, MANUAL_CAR]); }, /Store list is incomplete/],
    ["the server store count is unavailable", () => { spyResponses.rpcs.inventory_scope_report = { data: null, error: { code: "42501", message: "not authorized for tenant" } }; }, /Store list could not be verified/],
    ["registry hidden by permissions while vehicles are store-owned", () => { spyResponses.tables.dealer_stores = { data: [] }; }, /Store list is incomplete/],
    ["a row from another tenant", () => { spyResponses.tables.vehicle_listings = listingsOk([PRIMARY_CAR, { ...SISTER_CAR, tenant_id: "t2" }]); }, /failed a safety check/],
    ["row count that does not add up", () => { spyResponses.tables.vehicle_listings = { data: [PRIMARY_CAR], count: 3 }; }, /total could not be verified/],
    ["listing query failure", () => { spyResponses.tables.vehicle_listings = { data: null, error: { code: "57014", message: "statement timeout" } }; }, /Inventory could not be loaded/],
  ];
  for (const [label, arrange, title] of failures) {
    it(`fails closed on ${label}: error, Retry, and no vehicles`, async () => {
      arrange();
      renderAdmin(ui(), { route: "/inventory" });
      const alert = await screen.findByTestId("inventory-scope-error");
      expect(alert.textContent).toMatch(title);
      expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
      expect(screen.queryByText(/2026 INFINITI QX60/)).toBeNull();
      expect(screen.queryByText(/Hyundai Santa Fe/)).toBeNull();
      expect(writeCalls()).toEqual([]);
    });
  }

  it("drops a previously loaded list when a retry cannot verify scope, then recovers on Retry", async () => {
    spyResponses.tables.dealer_stores = { data: null, error: { message: "network down" } };
    renderAdmin(ui(), { route: "/inventory" });
    await screen.findByTestId("inventory-scope-error");
    spyResponses.tables.dealer_stores = { data: stores };
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.getAllByText(/2026 INFINITI QX60/).length).toBeGreaterThan(0));
    expect(screen.queryByText(/Hyundai Santa Fe/)).toBeNull();
  });

  it("reads past 500 vehicles with deterministic paging and a verified count", async () => {
    const many = Array.from({ length: 1234 }, (_, i) => row(`p${String(i).padStart(5, "0")}`, `VIN${i}`, `2025 Model ${i}`, { owning_store_id: PRIMARY }));
    spyResponses.tables.vehicle_listings = (ops: SpyOp[]) => {
      const r = ops.find((o) => o.op === "range")?.args as [number, number];
      return { data: many.slice(r[0], r[1] + 1), count: many.length };
    };
    renderAdmin(ui(), { route: "/inventory" });
    await waitFor(() => expect(document.body.textContent).toMatch(/1,?234/));
    expect(screen.queryByTestId("inventory-scope-error")).toBeNull();
    const ranges = spyCalls.filter((c) => c.kind === "table" && c.table === "vehicle_listings" && c.op === "range").map((c) => (c as { args: unknown[] }).args);
    expect(ranges.slice(0, 2)).toEqual([[0, 999], [1000, 1999]]);
    const orders = spyCalls.filter((c) => c.kind === "table" && c.table === "vehicle_listings" && c.op === "order").map((c) => (c as { args: unknown[] }).args[0]);
    expect(new Set(orders)).toEqual(new Set(["id"]));
    expect(spyCalls.some((c) => c.kind === "table" && c.table === "vehicle_listings" && c.op === "limit")).toBe(false);
  });
});

describe("/inventory actions stay in the primary dealership", () => {
  it("a manual add from the primary list is attested to the primary rooftop", async () => {
    spyResponses.tables.vehicle_listings = (ops: SpyOp[]) => (ops.some((o) => o.op === "insert") ? { data: { id: "new1" } } : listingsOk());
    renderAdmin(<InventoryModern />, { route: "/inventory?add=1" });
    await waitFor(() => expect(screen.getAllByText(/2026 INFINITI QX60/).length).toBeGreaterThan(0));
    fireEvent.change(await screen.findByPlaceholderText("17 characters"), { target: { value: "JN8AZ3CC0T9000099" } });
    fireEvent.change(screen.getByPlaceholderText("e.g. T5892"), { target: { value: "I99999" } });
    fireEvent.click(screen.getByRole("button", { name: /Create & open file/ }));
    await waitFor(() => expect(writeCalls().some((c) => c.kind === "table" && c.op === "insert")).toBe(true));
    const insert = writeCalls().find((c) => c.kind === "table" && c.op === "insert") as { args: unknown[] };
    expect((insert.args[0] as { owning_store_id?: string }).owning_store_id).toBe(PRIMARY);
  });
});
