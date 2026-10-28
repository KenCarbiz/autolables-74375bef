import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import { renderAdmin } from "@/test/adminRender";
import { resetSupabaseSpy, spyResponses, type SpyOp } from "@/test/mocks/supabaseSpy";
import { EXAMPLE_PRODUCT, EXAMPLE_RULE } from "@/pages/admin/fixtures/pricingFixtureData";
import { PRODUCT_APPLICABILITY_PATH } from "@/pages/admin/childRoutes";

// Product applicability through the real useProductRules writer: a write the
// database refuses is reported, never shown as Applied or audited.

vi.mock("@/integrations/supabase/client", async () => {
  const m = await import("@/test/mocks/supabaseSpy");
  return { supabase: m.supabaseSpy };
});
vi.mock("sonner", () => ({ toast: Object.assign(() => {}, { info: () => {}, error: () => {}, success: () => {}, warning: () => {} }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "user-1" }, isAdmin: false, loading: false }) }));
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: { id: "tenant-1", name: "Example Motors" }, currentStore: { id: "store-1" }, loading: false }) }));
const auditState = vi.hoisted(() => ({ log: vi.fn() }));
vi.mock("@/contexts/AuditContext", () => ({ useAudit: () => ({ log: auditState.log, entries: [] }) }));
vi.mock("@/contexts/DealerSettingsContext", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/contexts/DealerSettingsContext")>();
  return { ...mod, useDealerSettings: () => ({ settings: { ...mod.DEFAULT_SETTINGS }, updateSettings: async () => true, loading: false }) };
});

import ProductApplicabilityPage from "./ProductApplicabilityPage";

const REFUSED = { code: "42501", message: "permission denied for table product_rules" };
const writes = (ops: SpyOp[]) => ops.some((o) => o.op === "insert" || o.op === "update" || o.op === "delete");

const renderPage = () => renderAdmin(<ProductApplicabilityPage />, { route: "/admin/products/p1/applicability", path: PRODUCT_APPLICABILITY_PATH });

const apply = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Apply changes" })); });
};

beforeEach(() => {
  resetSupabaseSpy();
  auditState.log.mockClear();
  spyResponses.tables.products = { data: { ...EXAMPLE_PRODUCT, id: "p1", is_active: true }, error: null };
  spyResponses.tables.vehicle_listings = { data: [], error: null };
});

describe("ProductApplicabilityPage with the real rule writer", () => {
  it("shows a refused rule update, keeps the draft and audits nothing", async () => {
    spyResponses.tables.product_rules = (ops) => (writes(ops) ? { data: null, error: REFUSED } : { data: [{ ...EXAMPLE_RULE, id: "r1", product_id: "p1" }], error: null });
    renderPage();
    await screen.findByText("Active policy");
    fireEvent.click(screen.getByRole("checkbox", { name: "Used" }));
    await apply();
    expect(await screen.findByText(REFUSED.message)).toBeInTheDocument();
    expect(screen.queryByText("Applied")).toBeNull();
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Used" })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Review changes" })).toBeEnabled();
    expect(auditState.log).not.toHaveBeenCalled();
  });

  it("shows a refused rule insert, keeps the draft and audits nothing", async () => {
    spyResponses.tables.product_rules = (ops) => (writes(ops) ? { data: null, error: REFUSED } : { data: [], error: null });
    renderPage();
    await screen.findByText("No limits");
    fireEvent.click(screen.getByRole("radio", { name: "Set maximum mileage" }));
    await apply();
    expect(await screen.findByText(REFUSED.message)).toBeInTheDocument();
    expect(screen.queryByText("Applied")).toBeNull();
    expect(screen.getByLabelText("Maximum mileage")).toHaveValue(100000);
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    expect(auditState.log).not.toHaveBeenCalled();
  });

  it("applies and audits a rule update the database accepts", async () => {
    spyResponses.tables.product_rules = (ops) => (writes(ops) ? { data: null, error: null } : { data: [{ ...EXAMPLE_RULE, id: "r1", product_id: "p1" }], error: null });
    renderPage();
    await screen.findByText("Active policy");
    fireEvent.click(screen.getByRole("checkbox", { name: "Used" }));
    await apply();
    expect(await screen.findByText("Applied")).toBeInTheDocument();
    expect(auditState.log).toHaveBeenCalledWith(expect.objectContaining({ action: "rule_updated", entity_id: "r1" }));
  });
});
