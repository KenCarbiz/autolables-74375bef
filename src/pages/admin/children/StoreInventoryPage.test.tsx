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
  id, tenant_id: "t1", updated_at: "2026-11-06T00:00:00Z", display_name: name, is_primary_inventory_store: primary, status: "active", subscription_status: primary ? "subscribed" : "unsubscribed",
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
  spyResponses.tables.store_provider_usage = { data: [{ id: 1, outcome: "denied", deny_reason: "feed_only", estimated_cost_usd: 0.08, product: "neovin" }], count: 1 };
  const listings = [
    { id: "l1", tenant_id: "t1", vin: "V1", ymm: "2026 INFINITI QX60", condition: "new", status: "published", updated_at: "", owning_store_id: PRIMARY, mc_dealer_id: "1013372" },
    { id: "l2", tenant_id: "t1", vin: "V2", ymm: "2026 INFINITI QX80", condition: "used", status: "published", updated_at: "", owning_store_id: null, mc_dealer_id: "1013372" },
    { id: "l3", tenant_id: "t1", vin: "5NMP54G13TH144040", ymm: "2026 Hyundai Santa Fe", condition: "new", status: "published", updated_at: "", owning_store_id: null, mc_dealer_id: "1028492", mc_dealer_name: "Harte Auto Group" },
  ];
  spyResponses.tables.vehicle_listings = { data: listings, count: listings.length };
  spyResponses.tables.store_inventory = (ops) => {
    const data = eqArg(ops, "store_id") === PRIMARY
      ? [vehicle(PRIMARY, "JN8AZ3CC0T9000001", "new"), vehicle(PRIMARY, "JN8AZ3CC0T9000002", "cpo"), vehicle(PRIMARY, "JN8AZ3CC0T9000003", "used", "missing")]
      : [];
    return { data, count: data.length };
  };
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
    await waitFor(() => expect(screen.getAllByText(/MarketCheck dealer 1028492/).length).toBeGreaterThan(0));
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

describe("Inventory by store: rooftop mapping and failure states", () => {
  it("a non-admin sees the review list but no mapping action", async () => {
    mount(`/admin/integrations/store-inventory?store=review`);
    await waitFor(() => expect(screen.getAllByText(/MarketCheck dealer 1028492/).length).toBeGreaterThan(0));
    expect(screen.queryByRole("button", { name: "Review mapping" })).toBeNull();
    expect(screen.getByText("A platform administrator maps dealer ids")).toBeTruthy();
  });

  it("an admin reviews evidence, destination and effect, and cannot save without a reason and confirmation", async () => {
    platformAdmin = true;
    mount(`/admin/integrations/store-inventory?store=review`);
    const select = await screen.findByLabelText("Map dealer 1028492 to a store");
    fireEvent.change(select, { target: { value: HYUNDAI } });
    fireEvent.click(screen.getByRole("button", { name: "Review mapping" }));
    const review = await screen.findByRole("region", { name: "Review mapping" });
    expect(within(review).getByText(/Harte Auto Group/)).toBeTruthy();
    expect(within(review).getByText(/1 listings move from rooftop review into Harte Hyundai of Old Saybrook/)).toBeTruthy();
    const save = within(review).getByRole("button", { name: "Map dealer id" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(within(review).getByRole("textbox"), { target: { value: "Confirmed on hartecars.com inventory page" } });
    expect(save.disabled).toBe(true);
    fireEvent.click(within(review).getByRole("checkbox"));
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(within(review).getByText(/turned off until its database change is applied/)).toBeTruthy());
    expect(writeCalls().filter((c) => c.kind === "table")).toEqual([]);
  });

  it("an admin can roll back a mapping through the same reviewed unmap flow", async () => {
    platformAdmin = true;
    spyResponses.tables.dealer_stores = { data: [store(HYUNDAI, "Harte Hyundai of Old Saybrook", false, "1028492"), store(PRIMARY, "Harte INFINITI", true, "1013372"), store(NISSAN, "Harte Nissan")] };
    mount(`/admin/integrations/store-inventory?store=${PRIMARY}`);
    fireEvent.click(await screen.findByRole("button", { name: "Unmap" }));
    const review = await screen.findByRole("region", { name: "Review mapping" });
    expect(within(review).getByText(/listings move back to rooftop review/)).toBeTruthy();
  });

  it("shows each store's budget: allocation, consumed, refused, remaining", async () => {
    mount(`/admin/integrations/store-inventory?store=${NISSAN}`);
    await waitFor(() => expect(screen.getByText("Monthly call allocation")).toBeTruthy());
    expect(screen.getByText("None (feed only)")).toBeTruthy();
    expect(screen.getByText("Calls consumed")).toBeTruthy();
    expect(screen.getByText(/1 \(feed only 1\)/)).toBeTruthy();
    expect(screen.getByText("0 calls")).toBeTruthy();
  });

  it("holds a manual listing with no rooftop evidence in review", async () => {
    spyResponses.tables.vehicle_listings = { data: [{ id: "m1", tenant_id: "t1", vin: "5N1AT3CB7MC736556", ymm: "2021 NISSAN Rogue", condition: "used", status: "published", updated_at: "", owning_store_id: null, mc_dealer_id: null }], count: 1 };
    mount(`/admin/integrations/store-inventory?store=review`);
    await waitFor(() => expect(screen.getByText("2021 NISSAN Rogue")).toBeTruthy());
    expect(screen.getAllByText(/No rooftop evidence/).length).toBeGreaterThan(0);
  });

  it("fails closed when listings cannot be verified: error with Retry, no counts or review list", async () => {
    spyResponses.tables.vehicle_listings = { data: [], count: 5 };
    mount();
    const err = await screen.findByTestId("store-scope-error");
    expect(err.textContent).toMatch(/could not be verified/);
    expect(within(err).getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.queryByText(/Primary dealership listings/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Needs rooftop review/ })).toBeNull();
  });
});
