import { describe, it, expect, vi, beforeEach } from "vitest";
import { Suspense } from "react";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { renderAdmin } from "@/test/adminRender";
import { functionCalls, resetSupabaseSpy, spyResponses, writeCalls, type SpyOp } from "@/test/mocks/supabaseSpy";
import StoreInventoryPage from "./StoreInventoryPage";

vi.mock("@/integrations/supabase/client", async () => {
  const m = await import("@/test/mocks/supabaseSpy");
  return { supabase: m.supabaseSpy };
});
let platformAdmin = false;
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, session: null, isAdmin: platformAdmin, loading: false, signOut: () => {} }) }));
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: { id: "t1", name: "Harte Auto Group" }, currentStore: null, stores: [], loading: false, setCurrentStore: () => {} }) }));

const PRIMARY = "45cd", HYUNDAI = "02b4", NISSAN = "35d5";
const store = (id: string, name: string, primary = false, mc?: string) => ({
  id, display_name: name, is_primary_inventory_store: primary, status: "active", subscription_status: primary ? "subscribed" : "unsubscribed",
  inventory_feed_enabled: true, inventory_sharing_enabled: primary, listing_sync_enabled: primary, city: "Hartford", state: "CT", provider_ids: mc ? { marketcheck_dealer_id: mc } : {},
});
const vehicle = (storeId: string, vin: string, condition: string, presence = "present") => ({
  id: vin, store_id: storeId, vin, stock_number: "S1", condition, certified: false, year: 2026, make: "Make", model: "Model", trim: null, mileage: 10,
  feed_price: 30000, feed_price_status: "known", presence, last_seen_at: "2026-10-31T19:51:11Z", enrichment_status: "not_requested", listing_id: null,
});
const eqArg = (ops: SpyOp[], col: string) => ops.find((o) => o.op === "eq" && o.args[0] === col)?.args[1];

beforeEach(() => {
  resetSupabaseSpy();
  platformAdmin = false;
  spyResponses.tables.dealer_stores = { data: [store(HYUNDAI, "Harte Hyundai of Old Saybrook"), store(PRIMARY, "Harte INFINITI", true, "1013372"), store(NISSAN, "Harte Nissan")] };
  spyResponses.tables.store_enrichment_policies = { data: [] };
  spyResponses.tables.store_provider_usage = { data: [{ outcome: "denied", deny_reason: "feed_only", estimated_cost_usd: 0.08, product: "neovin" }] };
  spyResponses.tables.vehicle_listings = { data: [
    { id: "l1", vin: "V1", ymm: "2026 INFINITI QX60", condition: "new", status: "published", updated_at: "", owning_store_id: PRIMARY, mc_dealer_id: null },
    { id: "l2", vin: "V2", ymm: "2026 INFINITI QX80", condition: "used", status: "published", updated_at: "", owning_store_id: null, mc_dealer_id: "1013372" },
    { id: "l3", vin: "5NMP54G13TH144040", ymm: "2026 Hyundai Santa Fe", condition: "new", status: "published", updated_at: "", owning_store_id: null, mc_dealer_id: "1028492" },
  ] };
  spyResponses.tables.store_inventory = (ops) => ({
    data: eqArg(ops, "store_id") === PRIMARY
      ? [vehicle(PRIMARY, "JN8AZ3CC0T9000001", "new"), vehicle(PRIMARY, "JN8AZ3CC0T9000002", "cpo"), vehicle(PRIMARY, "JN8AZ3CC0T9000003", "used", "missing")]
      : [],
  });
});

const mount = (route = "/admin/integrations/store-inventory") => renderAdmin(
  <Suspense fallback={null}><Routes><Route path="/admin/integrations/store-inventory" element={<StoreInventoryPage />} /></Routes></Suspense>, { route },
);

describe("Inventory by store", () => {
  it("opens on the primary dealership with its own counts, and lists child stores separately", async () => {
    mount();
    const nav = await screen.findByRole("navigation", { name: "Stores" });
    expect(within(nav).getByText("Default view")).toBeTruthy();
    expect(within(nav).getByText("Child stores (2)")).toBeTruthy();
    await waitFor(() => expect(screen.getByText(/Primary dealership listings: 2 \(1 new · 1 used · 0 CPO\)/)).toBeTruthy());
    await waitFor(() => expect(screen.getByText("JN8AZ3CC0T9000001")).toBeTruthy());
    expect(screen.queryByText("JN8AZ3CC0T9000003")).toBeNull();
    expect(screen.getByText(/1 absent from the last feed \(kept, not removed\)/)).toBeTruthy();
  });

  it("a child store shows only its own inventory and an honest empty state", async () => {
    mount(`/admin/integrations/store-inventory?store=${HYUNDAI}`);
    await waitFor(() => expect(screen.getByText("No vehicles from this store's feed yet")).toBeTruthy());
    expect(screen.queryByText("JN8AZ3CC0T9000001")).toBeNull();
  });

  it("shows per-store data controls with spec defaults, and only real categories as switchable", async () => {
    mount(`/admin/integrations/store-inventory?store=${NISSAN}`);
    const table = await screen.findByRole("table", { name: "Data categories" });
    const row = (label: string) => within(table).getByText(label).closest("tr")!;
    expect(within(row("Inventory visibility")).getByText("On")).toBeTruthy();
    expect(within(row("NeoVIN specifications and equipment")).getByText("Off")).toBeTruthy();
    expect(within(row("OEM incentives")).getByText("Not available")).toBeTruthy();
    expect(within(row("Factory window-sticker data")).getByText("Not available")).toBeTruthy();
    expect(screen.getByText("No paid enrichment (feed only)")).toBeTruthy();
  });

  it("holds the unmapped group-site listing for rooftop review", async () => {
    mount();
    const btn = await screen.findByRole("button", { name: /Needs rooftop review/ });
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getAllByText("MarketCheck dealer 1028492").length).toBeGreaterThan(0));
    expect(screen.getByText("2026 Hyundai Santa Fe")).toBeTruthy();
  });

  it("opening every view issues reads only: no edge function, RPC or write", async () => {
    mount();
    await screen.findByRole("navigation", { name: "Stores" });
    fireEvent.click(await screen.findByRole("button", { name: /Harte Nissan/ }));
    await screen.findByRole("table", { name: "Data categories" });
    expect(functionCalls()).toEqual([]);
    expect(writeCalls()).toEqual([]);
  });
});
