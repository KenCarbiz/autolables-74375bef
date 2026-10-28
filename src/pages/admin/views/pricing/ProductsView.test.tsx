import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import { renderAdmin } from "@/test/adminRender";
import { resetSupabaseSpy, spyResponses, writeCalls } from "@/test/mocks/supabaseSpy";
import { EXAMPLE_PRODUCT, EXAMPLE_RULE, PRICING_FIXTURE_NOW } from "@/pages/admin/fixtures/pricingFixtureData";

vi.mock("@/integrations/supabase/client", async () => {
  const m = await import("@/test/mocks/supabaseSpy");
  return { supabase: m.supabaseSpy };
});
vi.mock("sonner", () => ({ toast: Object.assign(() => {}, { info: () => {}, error: () => {}, success: () => {}, warning: () => {} }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "user-1", email: "owner@example.test" }, isAdmin: false, loading: false, signOut: () => {} }) }));
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: { id: "tenant-1", name: "Example Motors" }, currentStore: { id: "store-1" }, loading: false }) }));
vi.mock("@/contexts/AuditContext", () => ({ useAudit: () => ({ log: () => {}, entries: [] }) }));
vi.mock("@/contexts/DealerSettingsContext", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/contexts/DealerSettingsContext")>();
  return { ...mod, useDealerSettings: () => ({ settings: { ...mod.DEFAULT_SETTINGS }, updateSettings: async () => true, reload: async () => {}, loading: false }) };
});
vi.mock("@/hooks/useProductRules", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/hooks/useProductRules")>();
  return { ...mod, useProductRules: () => ({ rules: [EXAMPLE_RULE], loading: false, addRule: async () => null, updateRule: async () => undefined, deleteRule: async () => undefined, getMatchingProducts: () => [] }) };
});

import ProductsView from "./ProductsView";
import ApplicabilityView from "./ApplicabilityView";

const second = { ...EXAMPLE_PRODUCT, id: "example-product-2", name: "Example Nitrogen Fill", badge_type: "optional", price: 149, is_active: true };

beforeEach(() => resetSupabaseSpy());

describe("ProductsView", () => {
  it("lists products from the fixture with their treatment and applicability link, and writes nothing", () => {
    renderAdmin(<ProductsView />, { fixture: { label: "products", now: PRICING_FIXTURE_NOW, views: { products: { products: [EXAMPLE_PRODUCT, second], library: [] } } } });
    expect(screen.getByText("Example Protection Package")).toBeInTheDocument();
    expect(screen.getByText("Example Nitrogen Fill")).toBeInTheDocument();
    expect(screen.getByText("$695")).toBeInTheDocument();
    expect(screen.getByText("Installed")).toBeInTheDocument();
    expect(screen.getByText("Optional")).toBeInTheDocument();
    expect(screen.getByText("Inactive")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Applicability" })[0]).toHaveAttribute("href", "/admin/products/example-product-1/applicability");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(writeCalls()).toEqual([]);
  });

  it("opens the editor for a product named in the query and still writes nothing", () => {
    renderAdmin(<ProductsView />, { route: "/admin?tab=products&product=example-product-2", fixture: { label: "products", now: PRICING_FIXTURE_NOW, views: { products: { products: [EXAMPLE_PRODUCT, second], library: [] } } } });
    expect(screen.getByRole("dialog", { name: "Edit product" })).toBeInTheDocument();
    expect(screen.getByLabelText("Product name")).toHaveValue("Example Nitrogen Fill");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(writeCalls()).toEqual([]);
  });

  it("reports an unreadable catalog as Unknown rather than empty", async () => {
    spyResponses.tables.products = { data: null, error: { message: "denied" } };
    renderAdmin(<ProductsView />);
    expect(await screen.findByRole("status")).toHaveTextContent("Products could not be read");
    expect(screen.getByText("(Unknown)")).toBeInTheDocument();
    expect(writeCalls()).toEqual([]);
  });
});

describe("ApplicabilityView", () => {
  it("groups rules by product, links to the child page, and writes nothing", () => {
    renderAdmin(<ApplicabilityView />, { fixture: { label: "applicability", now: PRICING_FIXTURE_NOW, views: { applicability: { products: [EXAMPLE_PRODUCT, second], rules: [EXAMPLE_RULE] } } } });
    expect(screen.getByText("1 rule")).toBeInTheDocument();
    expect(screen.getByText("Applies to every vehicle.")).toBeInTheDocument();
    expect(screen.getByText("2020 to Any")).toBeInTheDocument();
    expect(screen.getByText("Up to 80,000 mi")).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Open applicability" })[1]).toHaveAttribute("href", "/admin/products/example-product-2/applicability");
    expect(writeCalls()).toEqual([]);
  });
});
