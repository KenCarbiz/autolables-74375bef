import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router-dom";
import { renderAdmin } from "@/test/adminRender";
import { resetSupabaseSpy, spyResponses, writeCalls } from "@/test/mocks/supabaseSpy";
import { SCREEN_05 } from "@/pages/admin/fixtures/05";
import { PRICE_RULES_FIXTURE } from "@/pages/admin/fixtures/pricingFixtureData";

vi.mock("@/integrations/supabase/client", async () => {
  const m = await import("@/test/mocks/supabaseSpy");
  return { supabase: m.supabaseSpy };
});
vi.mock("sonner", () => ({ toast: Object.assign(() => {}, { info: () => {}, error: () => {}, success: () => {}, warning: () => {} }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "user-1", email: "owner@example.test" }, isAdmin: true, loading: false, signOut: () => {} }) }));
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: { id: "tenant-1", name: "Example Motors" }, currentStore: { id: "store-1" }, loading: false }) }));
const settingsState = vi.hoisted(() => ({ updateSettings: vi.fn(async () => true) }));
vi.mock("@/contexts/DealerSettingsContext", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/contexts/DealerSettingsContext")>();
  return {
    ...mod,
    useDealerSettings: () => ({
      settings: { ...mod.DEFAULT_SETTINGS, doc_fee_enabled: true, doc_fee_amount: 895, doc_fee_state: "CT", dealer_name: "Example Motors" },
      updateSettings: settingsState.updateSettings,
      reload: async () => {},
      loading: false,
    }),
  };
});
vi.mock("@/components/admin/PriceAuditPanel", () => ({ PriceAuditPanel: () => null }));
vi.mock("@/components/admin/PriceIntegrityPanel", () => ({ PriceIntegrityPanel: () => null }));

import PriceRulesView from "./PriceRulesView";

const LocationEcho = () => {
  const loc = useLocation();
  return <p data-testid="location">{loc.pathname + loc.search}</p>;
};

const renderView = (fixture = SCREEN_05.fixture) =>
  renderAdmin(
    <Routes>
      <Route path="/admin" element={<PriceRulesView />} />
      <Route path="/admin/pricing/fee-review" element={<LocationEcho />} />
    </Routes>,
    { route: "/admin", fixture },
  );

beforeEach(() => {
  resetSupabaseSpy();
  settingsState.updateSettings.mockClear();
});

describe("PriceRulesView with the 05 fixture", () => {
  it("renders the policy, the preview and the consistency table, and writes nothing", () => {
    renderView();
    expect(screen.getByText("Price display policy")).toBeInTheDocument();
    expect(screen.getByText("Connecticut")).toBeInTheDocument();
    expect(screen.getByText("Read only")).toBeInTheDocument();
    expect(screen.getByText("Administrative recalculation does not verify source prices.")).toBeInTheDocument();
    expect(screen.getByText("48")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review changes" })).toBeDisabled();
    expect(screen.getByText("No pending changes")).toBeInTheDocument();

    expect(screen.getByText("Customer price preview")).toBeInTheDocument();
    expect(screen.getByText("Advertised total")).toBeInTheDocument();
    expect(screen.getByText("Taxes and registration are separate.")).toBeInTheDocument();

    const table = screen.getByRole("table", { name: "Price consistency by vehicle" });
    expect(within(table).getAllByText("Consistent")).toHaveLength(3);
    expect(within(table).getAllByText("Mismatch")).toHaveLength(1);
    expect(within(table).getAllByText("Not checked")).toHaveLength(1);
    expect(within(table).getAllByText("Older version")).toHaveLength(1);
    expect(within(table).getAllByText("Awaiting evidence")).toHaveLength(1);
    expect(screen.getByText("5 vehicles shown")).toBeInTheDocument();
    expect(screen.getByText("1 mismatch needs review.")).toBeInTheDocument();
    expect(writeCalls()).toEqual([]);
  });

  it("shows Unknown, never zero, when counts or the consistency read are unavailable", () => {
    renderView({ ...SCREEN_05.fixture, views: { "price-rules": { ...PRICE_RULES_FIXTURE, counts: { eligible: null, archived: null }, consistency: null } } });
    expect(screen.getAllByText("Unknown").length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    expect(screen.getByText(/It is Unknown, not reconciled\./)).toBeInTheDocument();
  });

  it("enables Review changes only once the draft differs and hands the draft to the review route", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const amount = screen.getByLabelText("Document fee");
    fireEvent.change(amount, { target: { value: "925" } });
    const review = screen.getByRole("button", { name: "Review changes" });
    expect(review).toBeEnabled();
    fireEvent.click(review);
    expect(screen.getByTestId("location")).toHaveTextContent("/admin/pricing/fee-review?enabled=1&amount=925&state=CT&scope=active");
    expect(settingsState.updateSettings).not.toHaveBeenCalled();
    expect(writeCalls()).toEqual([]);
  });
});

describe("PriceRulesView against live data", () => {
  it("reports Unavailable and Unknown when the reads fail, and issues no write", async () => {
    spyResponses.tables.vehicle_listings = { data: null, count: null, error: { message: "read failed" } };
    renderView(null as never);
    expect(await screen.findAllByText("Unavailable")).toHaveLength(2);
    expect(await screen.findByText("Unknown")).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    expect(writeCalls()).toEqual([]);
  });

  it("builds the consistency table from inventory and website observations without writing", async () => {
    spyResponses.tables.vehicle_listings = {
      data: [
        { id: "l1", vin: "EXAMPLEVIN0000001", year: 2024, make: "Example", model: "Crossover", trim: "Base", condition: "used", mileage: 12, price: 30000, advertised_price_before_doc: 30000, doc_fee: 895, website_sale_price: 30895, price_parse_status: "ok", price_last_verified_at: "2026-10-20T00:00:00Z", archived_at: null, hero_image_url: null, vehicle_file_id: "f1", stock: "EX-1" },
      ],
      count: 1,
      error: null,
    };
    spyResponses.tables.advertised_prices = { data: [{ vin: "EXAMPLEVIN0000001", advertised_price: 30895, source_channel: "website", source_url: null, captured_at: "2026-10-21T00:00:00Z" }], error: null };
    renderView(null as never);
    const table = await screen.findByRole("table", { name: "Price consistency by vehicle" });
    expect(within(table).getByText("2024 Example Crossover")).toBeInTheDocument();
    expect(within(table).getByText("Consistent")).toBeInTheDocument();
    expect(within(table).getByRole("link", { name: "Review" })).toHaveAttribute("href", "/vehicle-file/f1");
    expect(await screen.findByText("1 vehicles shown")).toBeInTheDocument();
    expect(writeCalls()).toEqual([]);
  });
});
