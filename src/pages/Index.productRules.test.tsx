import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { resetSupabaseSpy, spyResponses, writeCalls, type SpyOp } from "@/test/mocks/supabaseSpy";
import type { Product } from "@/hooks/useProducts";
import type { ProductRule } from "@/hooks/useProductRules";
import { draftFromRule, sampleResult } from "@/lib/admin/pricing/productApplicability";

// The addendum builder through its real product-rule path: the vehicle-file
// link (/addendum?vehicleId=&vin=&ymm=&mileage=) loads the inventory record,
// and the real useProductRules reads product_rules and applies them with the
// vehicle's recorded condition and mileage. Only the catalog, session and
// delivery hooks are stubbed.

vi.mock("@/integrations/supabase/client", async () => {
  const m = await import("@/test/mocks/supabaseSpy");
  return { supabase: m.supabaseSpy };
});
vi.mock("sonner", () => ({ toast: Object.assign(() => {}, { info: () => {}, error: () => {}, success: () => {}, warning: () => {} }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "user-1", email: "owner@example.test" }, isAdmin: false, loading: false, signOut: () => {} }) }));
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: { id: "tenant-1", name: "Example Motors" }, currentStore: { id: "store-1", tenant_id: "tenant-1", name: "Example Motors", state: "CT" }, loading: false }) }));
vi.mock("@/contexts/AuditContext", () => ({ useAudit: () => ({ log: () => {}, entries: [] }) }));
const settingsState = vi.hoisted(() => ({ rules: true }));
vi.mock("@/contexts/DealerSettingsContext", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/contexts/DealerSettingsContext")>();
  return { ...mod, useDealerSettings: () => ({ settings: { ...mod.DEFAULT_SETTINGS, feature_product_rules: settingsState.rules }, updateSettings: async () => true, reload: async () => {}, loading: false }) };
});
const catalog = vi.hoisted(() => ({ products: [] as unknown[] }));
vi.mock("@/hooks/useProducts", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/hooks/useProducts")>();
  return { ...mod, useProducts: () => ({ data: catalog.products, isLoading: false }) };
});
vi.mock("@/hooks/useAdvertisedPrices", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/hooks/useAdvertisedPrices")>();
  return { ...mod, useAdvertisedPrices: () => ({ byVin: new Map(), captureSnapshot: vi.fn() }) };
});
vi.mock("@/hooks/useSmsDelivery", () => ({ useSmsDelivery: () => ({ sendSigningLink: vi.fn() }) }));
vi.mock("@/hooks/useVehicleFiles", () => ({ useVehicleFiles: () => ({ getOrCreateFile: vi.fn(), registerSticker: vi.fn() }) }));

import Index from "./Index";

const product = (id: string, name: string, extra: Partial<Product> = {}): Product => ({
  id,
  name,
  subtitle: null,
  warranty: null,
  badge_type: "installed",
  price: 100,
  price_label: "Included in Selling Price",
  disclosure: `${name} disclosure.`,
  sort_order: 0,
  is_active: true,
  benefit_justification: `${name} benefit.`,
  price_in_advertised: true,
  disclosure_optional: null,
  benefit_justification_optional: null,
  available_preinstalled: true,
  ...extra,
} as Product);

const rule = (product_id: string, condition: ProductRule["condition"], mileage_max = 0): ProductRule => ({
  id: `rule-${product_id}`,
  product_id,
  year_min: "",
  year_max: "",
  makes: [],
  models: [],
  trims: [],
  body_styles: [],
  condition,
  mileage_max,
});

const PRODUCTS = [
  product("p-any", "Any Vehicle Coating"),
  product("p-new", "New Only Film"),
  product("p-used", "Used Only Warranty"),
  product("p-all", "All Conditions Kit"),
  product("p-25k", "Low Mileage Plan"),
  product("p-at", "At Limit Plan"),
  product("p-used30", "Used Under 30k Plan", { badge_type: "optional", price: 250, price_label: "If Accepted" }),
];
const RULES = [
  rule("p-new", "new"),
  rule("p-used", "used"),
  rule("p-all", "all"),
  rule("p-25k", "all", 25_000),
  rule("p-at", "all", 28_115),
  rule("p-used30", "used", 30_000),
];

type Listing = { condition: string | null; mileage: number | null };

const renderBuilder = (listing: Listing, query = "") => {
  spyResponses.tables.product_rules = { data: RULES, error: null };
  spyResponses.tables.vehicle_listings = (ops: SpyOp[]) =>
    ops.some((o) => o.op === "select" && String(o.args[0]).includes("mc_attributes"))
      ? { data: [{ id: "v1", vin: "1EXAMPLE0VIN00001", ymm: "2023 Example S30", trim: "", stock_number: "S1", mileage: listing.mileage, price: 30000, condition: listing.condition, mc_attributes: {} }], error: null }
      : { data: [], error: null };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const mileageParam = listing.mileage != null ? `&mileage=${listing.mileage}` : "";
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/addendum?vehicleId=v1&vin=1EXAMPLE0VIN00001&ymm=2023%20Example%20S30${mileageParam}${query}`]}>
        <Routes><Route path="/addendum" element={<Index />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

const shown = (name: string) => screen.queryAllByText(name, { exact: true }).length > 0;
const notice = () => screen.getByTestId("product-rules-notice");

beforeEach(() => {
  resetSupabaseSpy();
  settingsState.rules = true;
  catalog.products = PRODUCTS;
});

describe("addendum builder applies saved product rules with the vehicle's condition and mileage", () => {
  it("Used vehicle at 28,115 mi: Used only and All apply; New only and the 25,000 mi limit exclude; exactly at the limit applies", async () => {
    renderBuilder({ condition: "used", mileage: 28_115 });
    await waitFor(() => expect(within(notice()).getByText(/Not applicable under product rules/)).toBeInTheDocument());
    for (const name of ["Any Vehicle Coating", "Used Only Warranty", "All Conditions Kit", "At Limit Plan", "Used Under 30k Plan"]) expect(shown(name), name).toBe(true);
    for (const name of ["New Only Film", "Low Mileage Plan"]) expect(shown(name), name).toBe(false);
    expect(notice()).toHaveTextContent("New Only Film (Rule applies to New vehicles; this vehicle is Used.)");
    expect(notice()).toHaveTextContent("Low Mileage Plan (Mileage 28,115 is over the 25,000 mi limit.)");
    expect(writeCalls()).toEqual([]);
  });

  it("CPO counts as Used: Used only applies and New only is excluded", async () => {
    renderBuilder({ condition: "cpo", mileage: 9_000 });
    await waitFor(() => expect(within(notice()).getByText(/Not applicable under product rules/)).toBeInTheDocument());
    expect(shown("Used Only Warranty")).toBe(true);
    expect(shown("Low Mileage Plan")).toBe(true);
    expect(shown("New Only Film")).toBe(false);
    expect(notice()).toHaveTextContent("this vehicle is CPO");
  });

  it("New vehicle: New only applies; Used only and Used under 30k are excluded", async () => {
    renderBuilder({ condition: "new", mileage: 12 });
    await waitFor(() => expect(within(notice()).getByText(/Not applicable under product rules/)).toBeInTheDocument());
    expect(shown("New Only Film")).toBe(true);
    expect(shown("Used Only Warranty")).toBe(false);
    expect(shown("Used Under 30k Plan")).toBe(false);
  });

  it("over the limit on a combined rule (Used and 30,000 mi) is excluded even though the condition matches", async () => {
    renderBuilder({ condition: "used", mileage: 30_001 });
    await waitFor(() => expect(within(notice()).getByText(/Not applicable under product rules/)).toBeInTheDocument());
    expect(shown("Used Only Warranty")).toBe(true);
    expect(shown("Used Under 30k Plan")).toBe(false);
    expect(notice()).toHaveTextContent("Used Under 30k Plan (Mileage 30,001 is over the 30,000 mi limit.)");
  });

  it("missing condition and mileage are not assumed: dependent products are held and named as undetermined", async () => {
    renderBuilder({ condition: null, mileage: null });
    await waitFor(() => expect(within(notice()).getByText(/Eligibility not determined/)).toBeInTheDocument());
    expect(shown("Any Vehicle Coating")).toBe(true);
    expect(shown("All Conditions Kit")).toBe(true);
    for (const name of ["New Only Film", "Used Only Warranty", "Low Mileage Plan", "At Limit Plan", "Used Under 30k Plan"]) expect(shown(name), name).toBe(false);
    expect(notice()).toHaveTextContent("New Only Film (condition not recorded)");
    expect(notice()).toHaveTextContent("Low Mileage Plan (mileage not recorded)");
    expect(notice()).toHaveTextContent("Used Under 30k Plan (condition not recorded, mileage not recorded)");
  });

  it("an unrecognized condition is reported as such, never read as Used", async () => {
    renderBuilder({ condition: "Fleet return", mileage: 5_000 });
    await waitFor(() => expect(within(notice()).getByText(/Eligibility not determined/)).toBeInTheDocument());
    expect(shown("Used Only Warranty")).toBe(false);
    expect(notice()).toHaveTextContent('Used Only Warranty (condition "Fleet return" not recognized)');
  });

  it("agrees with screen 07's sample results for every rule and vehicle", async () => {
    const vehicles: Listing[] = [
      { condition: "new", mileage: 12 },
      { condition: "used", mileage: 28_115 },
      { condition: "cpo", mileage: 96_480 },
      { condition: null, mileage: 40_000 },
    ];
    for (const v of vehicles) {
      const { unmount } = renderBuilder(v);
      await waitFor(() => expect(notice()).toBeInTheDocument());
      await waitFor(() => expect(spyResponses.tables.vehicle_listings).toBeDefined());
      await screen.findAllByText("Any Vehicle Coating");
      await waitFor(() => {
        for (const r of RULES) {
          const p = PRODUCTS.find((x) => x.id === r.product_id)!;
          const sample = sampleResult(draftFromRule(r), "optional", { requireManagerApproval: false }, { vin: "1EXAMPLE0VIN00001", year: 2023, make: "Example", model: "S30", trim: null, condition: v.condition, mileage: v.mileage }, null);
          expect(shown(p.name), `${p.name} for ${JSON.stringify(v)}`).toBe(sample.status === "eligible");
        }
      });
      unmount();
    }
  });

  it("when every rule applies, the product lines, prices and disclosures match the builder with rules off", async () => {
    catalog.products = PRODUCTS.filter((p) => ["p-any", "p-used", "p-all", "p-at", "p-used30"].includes(p.id));
    const lines = () => Array.from(document.querySelectorAll("body *")).filter((e) => e.children.length === 0).map((e) => e.textContent?.trim() ?? "").filter((t) => /\$\d|disclosure\.|benefit\.|Plan|Warranty|Coating|Kit|Voluntary purchase notice/.test(t));
    const on = renderBuilder({ condition: "used", mileage: 28_115 });
    await screen.findAllByText("Used Under 30k Plan");
    const withRules = lines();
    on.unmount();
    settingsState.rules = false;
    renderBuilder({ condition: "used", mileage: 28_115 });
    await screen.findAllByText("Used Under 30k Plan");
    expect(lines()).toEqual(withRules);
    expect(screen.getAllByText(/Voluntary purchase notice/).length).toBeGreaterThan(0);
  });
});
