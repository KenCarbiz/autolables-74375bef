import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { renderAdmin } from "@/test/adminRender";
import { resetSupabaseSpy, spyCalls, spyResponses, writeCalls } from "@/test/mocks/supabaseSpy";
import { SCREEN_07 } from "@/pages/admin/fixtures/07";
import { EXAMPLE_PRODUCT, EXAMPLE_RULE } from "@/pages/admin/fixtures/pricingFixtureData";
import { PRODUCT_APPLICABILITY_PATH } from "@/pages/admin/childRoutes";

vi.mock("@/integrations/supabase/client", async () => {
  const m = await import("@/test/mocks/supabaseSpy");
  return { supabase: m.supabaseSpy };
});
vi.mock("sonner", () => ({ toast: Object.assign(() => {}, { info: () => {}, error: () => {}, success: () => {}, warning: () => {} }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "user-1", email: "owner@example.test" }, isAdmin: false, loading: false, signOut: () => {} }) }));
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: { id: "tenant-1", name: "Example Motors" }, currentStore: { id: "store-1" }, loading: false }) }));
const auditState = vi.hoisted(() => ({ log: vi.fn() }));
vi.mock("@/contexts/AuditContext", () => ({ useAudit: () => ({ log: auditState.log, entries: [] }) }));
vi.mock("@/contexts/DealerSettingsContext", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/contexts/DealerSettingsContext")>();
  return { ...mod, useDealerSettings: () => ({ settings: { ...mod.DEFAULT_SETTINGS, require_install_verification: true }, updateSettings: async () => true, reload: async () => {}, loading: false }) };
});
const rulesState = vi.hoisted(() => ({ rules: [] as Array<Record<string, unknown>>, addRule: vi.fn(async () => null), updateRule: vi.fn(async () => undefined) }));
vi.mock("@/hooks/useProductRules", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/hooks/useProductRules")>();
  return { ...mod, useProductRules: () => ({ rules: rulesState.rules, loading: false, addRule: rulesState.addRule, updateRule: rulesState.updateRule, deleteRule: vi.fn(), getMatchingProducts: () => [] }) };
});

import ProductApplicabilityPage from "./ProductApplicabilityPage";

const renderPage = (route: string, fixture: typeof SCREEN_07.fixture | null) =>
  renderAdmin(<ProductApplicabilityPage />, { route, path: PRODUCT_APPLICABILITY_PATH, fixture });

beforeEach(() => {
  resetSupabaseSpy();
  rulesState.rules = [];
  rulesState.addRule.mockClear();
  rulesState.updateRule.mockClear();
  auditState.log.mockClear();
});

describe("ProductApplicabilityPage with the 07 fixture", () => {
  it("renders the rules, price treatment, evidence checklist and real sample results without writing", () => {
    renderPage("/admin/products/example-product-1/applicability", SCREEN_07.fixture);
    expect(screen.getByRole("heading", { level: 1, name: "Example Protection Package" })).toBeInTheDocument();
    expect(screen.getByText("Draft policy")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Applicability" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("checkbox", { name: "New" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Used" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /Certified pre-owned/ })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Set maximum mileage" })).toBeChecked();
    expect(screen.getByLabelText("Maximum mileage")).toHaveValue(80000);
    expect(screen.getByLabelText("Model year from")).toHaveValue("2020");
    expect(screen.getByRole("radio", { name: /Installed product/ })).toBeChecked();
    expect(screen.getByText("Installed status requires proof before publication.")).toBeInTheDocument();

    expect(screen.getByText("Pending")).toBeInTheDocument();
    expect(screen.getByText("Required")).toBeInTheDocument();
    expect(screen.getByText("Complete")).toBeInTheDocument();
    expect(screen.getByText("Manager required")).toBeInTheDocument();

    const table = screen.getByRole("table", { name: "Sample vehicle results" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText("Yes")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Proof attached")).toBeInTheDocument();
    expect(within(rows[0]).getByText("Ready for review")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Missing proof")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Blocked")).toBeInTheDocument();
    expect(within(rows[2]).getByText("No")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Excluded")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Not published")).toBeInTheDocument();

    expect(screen.getByRole("button", { name: "Review changes" })).toBeDisabled();
    expect(writeCalls()).toEqual([]);
  });
});

describe("ProductApplicabilityPage against live data", () => {
  const product = { ...EXAMPLE_PRODUCT, id: "p1", is_active: true };
  const vehicles = [
    { vin: "EXAMPLEVIN0000001", year: 2024, make: "Example", model: "Crossover", trim: "Base", condition: "new", mileage: 12 },
    { vin: "EXAMPLEVIN0000002", year: 2023, make: "Example", model: "Sedan", trim: "Sport", condition: "used", mileage: 28115 },
  ];

  it("reads the product, rule and vehicles, marks a failed proof read Unknown, and issues no write on mount", async () => {
    rulesState.rules = [{ ...EXAMPLE_RULE, id: "r1", product_id: "p1" }];
    spyResponses.tables.products = { data: product, error: null };
    spyResponses.tables.vehicle_listings = { data: vehicles, error: null };
    spyResponses.tables.install_proofs = { data: null, error: { message: "denied" } };
    renderPage("/admin/products/p1/applicability", null);
    expect(await screen.findByRole("heading", { level: 1, name: "Example Protection Package" })).toBeInTheDocument();
    expect(screen.getByText("Active policy")).toBeInTheDocument();
    const table = await screen.findByRole("table", { name: "Sample vehicle results" });
    expect(await within(table).findAllByText("Unknown")).toHaveLength(4);
    expect(within(table).queryByText("Proof attached")).not.toBeInTheDocument();
    expect(writeCalls()).toEqual([]);
    expect(spyCalls.filter((c) => c.kind === "table").every((c) => ["select", "eq", "is", "in", "order", "limit", "maybeSingle", "not"].includes(c.op))).toBe(true);
  });

  it("requires a review before applying, then writes the rule and audits it", async () => {
    rulesState.rules = [{ ...EXAMPLE_RULE, id: "r1", product_id: "p1" }];
    spyResponses.tables.products = { data: product, error: null };
    spyResponses.tables.vehicle_listings = { data: vehicles, error: null };
    spyResponses.tables.install_proofs = { data: [{ vehicle_vin: "EXAMPLEVIN0000001" }], error: null };
    renderPage("/admin/products/p1/applicability", null);
    await screen.findByRole("heading", { level: 1, name: "Example Protection Package" });
    expect(await screen.findByText("Proof attached")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: "Used" }));
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    const review = screen.getByRole("button", { name: "Review changes" });
    expect(review).toBeEnabled();
    fireEvent.click(review);
    expect(screen.getByText("Changes to apply")).toBeInTheDocument();
    expect(screen.getByText("New, Used and CPO")).toBeInTheDocument();
    expect(rulesState.updateRule).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Apply changes" }));
    expect(await screen.findByText("Applied")).toBeInTheDocument();
    expect(rulesState.updateRule).toHaveBeenCalledWith("r1", { condition: "new", mileage_max: 80000, year_min: "2020", year_max: "" });
    expect(rulesState.addRule).not.toHaveBeenCalled();
    expect(spyCalls.some((c) => c.kind === "table" && c.table === "products" && c.op === "update")).toBe(false);
    expect(auditState.log).toHaveBeenCalledWith(expect.objectContaining({ action: "rule_updated", entity_type: "product_rule", entity_id: "r1" }));
  });
});
