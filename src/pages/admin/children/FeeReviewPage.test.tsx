import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { renderAdmin } from "@/test/adminRender";
import { resetSupabaseSpy, rpcCalls, spyResponses, writeCalls } from "@/test/mocks/supabaseSpy";
import { SCREEN_06 } from "@/pages/admin/fixtures/06";
import { FEE_REVIEW_FIXTURE } from "@/pages/admin/fixtures/pricingFixtureData";

vi.mock("@/integrations/supabase/client", async () => {
  const m = await import("@/test/mocks/supabaseSpy");
  return { supabase: m.supabaseSpy };
});
vi.mock("sonner", () => ({ toast: Object.assign(() => {}, { info: () => {}, error: () => {}, success: () => {}, warning: () => {} }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "user-1", email: "owner@example.test" }, isAdmin: false, loading: false, signOut: () => {} }) }));
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: { id: "tenant-1", name: "Example Motors" }, currentStore: { id: "store-1" }, loading: false }) }));
const roleState = vi.hoisted(() => ({ role: "owner" }));
vi.mock("@/hooks/useEntitlements", () => ({ useEntitlements: () => ({ member: { role: roleState.role }, loading: false }) }));
const auditState = vi.hoisted(() => ({ log: vi.fn() }));
vi.mock("@/contexts/AuditContext", () => ({ useAudit: () => ({ log: auditState.log, entries: [] }) }));
const settingsState = vi.hoisted(() => ({ updateSettings: vi.fn(async () => true), reload: vi.fn(async () => {}) }));
vi.mock("@/contexts/DealerSettingsContext", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/contexts/DealerSettingsContext")>();
  return {
    ...mod,
    useDealerSettings: () => ({
      settings: { ...mod.DEFAULT_SETTINGS, doc_fee_enabled: true, doc_fee_amount: 895, doc_fee_state: "CT", dealer_name: "Example Motors" },
      updateSettings: settingsState.updateSettings,
      reload: settingsState.reload,
      loading: false,
    }),
  };
});
vi.mock("@/components/admin/PriceAuditPanel", () => ({ PriceAuditPanel: () => null }));
vi.mock("@/components/admin/PriceIntegrityPanel", () => ({ PriceIntegrityPanel: () => null }));

import FeeReviewPage from "./FeeReviewPage";

const dialog = () => screen.getByRole("dialog", { name: "Review document fee change" });

const renderPage = (route: string, fixture: typeof SCREEN_06.fixture | null) =>
  renderAdmin(
    <Routes>
      <Route path="/admin/pricing/fee-review" element={<FeeReviewPage />} />
      <Route path="/admin" element={<p>price rules page</p>} />
    </Routes>,
    { route, fixture },
  );

const listingRows = [
  { vin: "EXAMPLEVIN0000001", year: 2024, make: "Example", model: "Crossover", trim: "Base", archived_at: null, advertised_price_before_doc: 30000, doc_fee: 895, website_sale_price: 30895, price_parse_status: "ok", stock: "EX-1" },
  { vin: "EXAMPLEVIN0000002", year: 2023, make: "Example", model: "Sedan", trim: "Sport", archived_at: null, advertised_price_before_doc: 24500, doc_fee: 895, website_sale_price: 25395, price_parse_status: "ok", stock: "EX-2" },
  { vin: "EXAMPLEVIN0000003", year: 2025, make: "Example", model: "Pickup", trim: "Trail", archived_at: null, advertised_price_before_doc: 41200, doc_fee: 895, website_sale_price: 42095, price_parse_status: "ok", stock: "EX-3" },
  { vin: "EXAMPLEVIN0000004", year: 2022, make: "Example", model: "Hatch", trim: "Base", archived_at: "2026-09-01T00:00:00Z", advertised_price_before_doc: 18900, doc_fee: 895, website_sale_price: 19795, price_parse_status: "ok", stock: "EX-4" },
];

beforeEach(() => {
  resetSupabaseSpy();
  roleState.role = "owner";
  auditState.log.mockClear();
  settingsState.updateSettings.mockClear();
  settingsState.reload.mockClear();
});

describe("FeeReviewPage with the 06 fixture", () => {
  it("renders the review step over the pricing page with before, after, impact and samples, and writes nothing", () => {
    renderPage("/admin/pricing/fee-review", SCREEN_06.fixture);
    const d = dialog();
    expect(within(d).getByText("Current step")).toBeInTheDocument();
    expect(within(d).getByText("Completed")).toBeInTheDocument();
    expect(within(d).getByText("Not started")).toBeInTheDocument();
    const summary = within(d).getByRole("table", { name: "Before and after" });
    expect(within(summary).getByText("$895")).toBeInTheDocument();
    expect(within(summary).getByText("$925")).toBeInTheDocument();
    expect(within(summary).getByText("13")).toBeInTheDocument();
    expect(within(d).getByText("48")).toBeInTheDocument();
    expect(within(d).getByText("active vehicles eligible")).toBeInTheDocument();
    expect(within(d).getByText("Rows will be updated only when values differ")).toBeInTheDocument();
    expect(within(d).getByText("No changes will be made to archived records")).toBeInTheDocument();
    expect(within(within(d).getByRole("table", { name: "Example vehicles" })).getAllByRole("row")).toHaveLength(2);
    expect(within(d).getByText("Source verification dates and mismatch flags will be preserved.")).toBeInTheDocument();
    expect(within(d).getByText("Archived records require a separate authorized action.")).toBeInTheDocument();
    expect(within(d).getByRole("button", { name: "Apply to 48 active vehicles" })).toBeEnabled();
    expect(within(d).getByText("Requires pricing-management permission. Change will be audited.")).toBeInTheDocument();
    expect(writeCalls()).toEqual([]);
  });

  it("disables Apply for a role without pricing authority and says why", () => {
    renderPage("/admin/pricing/fee-review", { ...SCREEN_06.fixture, views: { ...SCREEN_06.fixture.views, "fee-review": { ...FEE_REVIEW_FIXTURE, canManage: false } } });
    expect(within(dialog()).getByRole("button", { name: "Apply to 48 active vehicles" })).toBeDisabled();
    expect(within(dialog()).getByText(/Your role cannot apply pricing changes/)).toBeInTheDocument();
  });
});

describe("FeeReviewPage against live data without the server contracts", () => {
  it("opens on the edit step from the deep link without any write or RPC", () => {
    renderPage("/admin/pricing/fee-review?enabled=1&amount=925&state=CT&scope=active", null);
    const d = dialog();
    expect(within(d).getByLabelText("Document fee")).toHaveValue(925);
    expect(within(d).getByRole("button", { name: "Review changes" })).toBeEnabled();
    expect(writeCalls()).toEqual([]);
    expect(rpcCalls()).toEqual([]);
  });

  it("reviews with the browser-side impact, states the fallback consequence, and applies through the existing routine only after review", async () => {
    spyResponses.tables.vehicle_listings = { data: listingRows, count: 3, error: null };
    spyResponses.tables.dealer_profiles = { data: { updated_at: "2026-10-20T00:00:00Z" }, error: null };
    spyResponses.rpcs.recalc_tenant_doc_fee = { data: 3, error: null };
    renderPage("/admin/pricing/fee-review?enabled=1&amount=925&state=CT&scope=active", null);
    fireEvent.click(within(dialog()).getByRole("button", { name: "Review changes" }));

    const apply = await within(dialog()).findByRole("button", { name: "Apply to 3 active vehicles" });
    expect(within(dialog()).getByText(/Until the dedicated routine is installed/)).toBeInTheDocument();
    expect(within(dialog()).getByText("archived vehicles excluded").parentElement).toHaveTextContent(/^1archived vehicles excluded/);
    expect(rpcCalls()).toEqual(["admin_doc_fee_change_preview", "admin_policy_version"]);
    expect(settingsState.updateSettings).not.toHaveBeenCalled();
    expect(apply).toBeEnabled();

    fireEvent.click(apply);
    expect(await within(dialog()).findByText("Applied")).toBeInTheDocument();
    expect(within(dialog()).getByText(/through the existing recalculation routine/)).toBeInTheDocument();
    expect(settingsState.updateSettings).toHaveBeenCalledWith({ doc_fee_enabled: true, doc_fee_amount: 925, doc_fee_state: "CT" });
    expect(rpcCalls()).toContain("recalc_tenant_doc_fee");
    expect(auditState.log).toHaveBeenCalledWith(expect.objectContaining({ action: "settings_updated", entity_type: "doc_fee_policy", details: expect.objectContaining({ path: "recalc_tenant_doc_fee", affected: 3 }) }));
  });

  it("blocks apply when the impact cannot be computed", async () => {
    spyResponses.tables.vehicle_listings = { data: null, count: null, error: { message: "read failed" } };
    spyResponses.tables.dealer_profiles = { data: { updated_at: "2026-10-20T00:00:00Z" }, error: null };
    renderPage("/admin/pricing/fee-review?enabled=1&amount=925&state=CT&scope=active", null);
    fireEvent.click(within(dialog()).getByRole("button", { name: "Review changes" }));
    expect(await within(dialog()).findByText("The review is no longer valid.")).toBeInTheDocument();
    await waitFor(() => expect(within(dialog()).getByRole("button", { name: /^Apply to/ })).toBeDisabled());
    expect(within(dialog()).getByRole("button", { name: "Apply to Unknown active vehicles" })).toBeInTheDocument();
    expect(settingsState.updateSettings).not.toHaveBeenCalled();
    expect(rpcCalls()).not.toContain("recalc_tenant_doc_fee");
  });

  it("keeps a salesperson from applying even with a computed impact", async () => {
    roleState.role = "salesperson";
    spyResponses.tables.vehicle_listings = { data: listingRows, count: 3, error: null };
    spyResponses.tables.dealer_profiles = { data: { updated_at: "2026-10-20T00:00:00Z" }, error: null };
    renderPage("/admin/pricing/fee-review?enabled=1&amount=925&state=CT&scope=active", null);
    fireEvent.click(within(dialog()).getByRole("button", { name: "Review changes" }));
    const apply = await within(dialog()).findByRole("button", { name: "Apply to 3 active vehicles" });
    expect(apply).toBeDisabled();
    expect(within(dialog()).getByText(/Your role cannot apply pricing changes/)).toBeInTheDocument();
  });
});
