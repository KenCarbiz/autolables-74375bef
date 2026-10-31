import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
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

const renderView = (fixture = SCREEN_05.fixture, returned?: unknown) =>
  renderAdmin(
    <Routes>
      <Route path="/admin" element={<PriceRulesView />} />
      <Route path="/admin/pricing/fee-review" element={<LocationEcho />} />
      <Route path="/admin/design-fixture/06" element={<LocationEcho />} />
      <Route path="/return" element={<Navigate to="/admin" state={{ feeReviewReturn: returned }} />} />
    </Routes>,
    { route: returned ? "/return" : "/admin", fixture },
  );

const LIVE_ROUTE_FIXTURE = { ...SCREEN_05.fixture, views: { "price-rules": { ...PRICE_RULES_FIXTURE, reviewHref: undefined } } };

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
    // Fee-inclusive basis: the preview anchors on the inventory total the label and Passport show
    // ($39,525) and splits the $895 fee out of it once; it never adds the fee on top.
    const preview = screen.getByText("Advertised total").closest("dl") as HTMLElement;
    expect(within(preview).getByText("Selling price").nextElementSibling).toHaveTextContent("$38,630");
    expect(within(preview).getByText("Conveyance Fee").nextElementSibling).toHaveTextContent("$895");
    expect(within(preview).getByText("Advertised total").nextElementSibling).toHaveTextContent("$39,525");
    expect(within(preview).queryByText("$40,420")).toBeNull();

    // The display basis is fee-inclusive, so the first row's $40,420 website
    // total disagrees with the $39,525 total the label and Passport advertise.
    const table = screen.getByRole("table", { name: "Price consistency by vehicle" });
    const first = within(table).getAllByRole("row")[1];
    expect(within(first).getByText("$40,420")).toBeInTheDocument();
    expect(within(first).getAllByText("$39,525")).toHaveLength(3);
    expect(within(first).getByText("Mismatch")).toBeInTheDocument();
    expect(within(first).getByText(/Website differs from the label by \+\$895 on the advertised total including the document fee\./)).toBeInTheDocument();
    expect(within(table).queryByText("Consistent")).toBeNull();
    // Every fixture row stores a before-fee price equal to its total, so the breakdown
    // (price before fee + fee) does not add up on the fee-inclusive basis; that stays visible.
    expect(within(first).getByText(/Stored breakdown \(\$39,525 before fee \+ \$895 fee = \$40,420\) differs from the advertised total by \+\$895\./)).toBeInTheDocument();
    expect(within(table).getAllByText("Mismatch")).toHaveLength(3);
    expect(within(table).queryByText("Not checked")).toBeNull();
    expect(within(table).getAllByText("Older version")).toHaveLength(1);
    expect(within(table).getAllByText("Awaiting evidence")).toHaveLength(1);
    expect(screen.getByText(/^Compared on the advertised total including the document fee \(the display basis\)/)).toBeInTheDocument();
    expect(screen.getByText("Conveyance Fee is what Connecticut calls the document fee; customers see that term.")).toBeInTheDocument();
    const stacked = screen.getByRole("list", { name: "Price consistency by vehicle" });
    expect(within(stacked).getAllByRole("listitem")).toHaveLength(3);
    expect(within(stacked).getAllByText("Mismatch")).toHaveLength(3);
    expect(screen.getByText("3 vehicles shown")).toBeInTheDocument();
    expect(screen.getByText("3 mismatches need review.")).toBeInTheDocument();
    expect(writeCalls()).toEqual([]);
  });

  it("shows Unknown, never zero, when counts or the consistency read are unavailable", () => {
    renderView({ ...SCREEN_05.fixture, views: { "price-rules": { ...PRICE_RULES_FIXTURE, counts: { eligible: null, archived: null }, consistency: null } } });
    expect(screen.getAllByText("Unknown").length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    expect(screen.getByText(/It is Unknown, not reconciled\./)).toBeInTheDocument();
  });

  it("enables Review changes only once the draft differs and hands the draft to the review route", () => {
    renderView(LIVE_ROUTE_FIXTURE);
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

describe("PriceRulesView returning from Fee Change Review", () => {
  it("restores the returned draft and puts focus back on Review changes", async () => {
    renderView(LIVE_ROUTE_FIXTURE, { draft: { enabled: true, amount: 925, stateCode: "CT" }, scope: "all" });
    const review = screen.getByRole("button", { name: "Review changes" });
    expect(review).toBeEnabled();
    expect(screen.getByLabelText("Document fee")).toHaveValue(925);
    expect(screen.getByLabelText("Change scope")).toHaveValue("all");
    await waitFor(() => expect(review).toHaveFocus());
    expect(writeCalls()).toEqual([]);
  });

  it("keeps Review changes disabled when the returned draft equals the saved policy, and focuses Edit", async () => {
    renderView(LIVE_ROUTE_FIXTURE, { draft: { enabled: true, amount: 895, stateCode: "CT" }, scope: "active" });
    expect(screen.getByRole("button", { name: "Review changes" })).toBeDisabled();
    await waitFor(() => expect(screen.getByRole("button", { name: "Edit" })).toHaveFocus());
  });

  it("stays inside the design fixtures when the fixture names its review route", () => {
    renderView();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Document fee"), { target: { value: "925" } });
    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
    expect(screen.getByTestId("location")).toHaveTextContent("/admin/design-fixture/06");
  });
});

describe("PriceRulesView fee draft against live settings", () => {
  const review = () => screen.getByRole("button", { name: "Review changes" });

  it("keeps Review changes disabled until the draft differs from the saved policy, including after a change back", () => {
    renderView(null as never);
    expect(review()).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(review()).toBeDisabled();
    const amount = screen.getByLabelText("Document fee");
    expect(amount).toHaveValue(895);
    fireEvent.change(amount, { target: { value: "925" } });
    expect(review()).toBeEnabled();
    expect(screen.getByText("Draft changes are reviewed before anything is applied.")).toBeInTheDocument();
    fireEvent.change(amount, { target: { value: "895" } });
    expect(review()).toBeDisabled();
    expect(screen.getByText("No pending changes")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Jurisdiction"), { target: { value: "NY" } });
    expect(review()).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Jurisdiction"), { target: { value: "CT" } });
    expect(review()).toBeDisabled();
    expect(writeCalls()).toEqual([]);
  });

  it("keeps Review changes disabled for a negative, empty or jurisdiction-less draft and says why", () => {
    renderView(null as never);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const amount = screen.getByLabelText("Document fee");

    fireEvent.change(amount, { target: { value: "-5" } });
    expect(screen.getByText("The fee cannot be negative.")).toBeInTheDocument();
    expect(screen.getByText("Fix the draft before reviewing.")).toBeInTheDocument();
    expect(review()).toBeDisabled();

    fireEvent.change(amount, { target: { value: "" } });
    expect(screen.getByText("Enter a dollar amount.")).toBeInTheDocument();
    expect(review()).toBeDisabled();

    fireEvent.change(amount, { target: { value: "925" } });
    fireEvent.change(screen.getByLabelText("Jurisdiction"), { target: { value: "" } });
    expect(screen.getByText("Choose the jurisdiction the fee is charged in.")).toBeInTheDocument();
    expect(review()).toBeDisabled();

    fireEvent.click(review());
    expect(screen.queryByTestId("location")).toBeNull();
    expect(settingsState.updateSettings).not.toHaveBeenCalled();
  });

  it("routes a valid draft and the chosen scope to the fee review child without writing", () => {
    renderView(null as never);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Document fee"), { target: { value: "925.50" } });
    fireEvent.change(screen.getByLabelText("Change scope"), { target: { value: "all" } });
    fireEvent.click(review());
    expect(screen.getByTestId("location")).toHaveTextContent("/admin/pricing/fee-review?enabled=1&amount=925.5&state=CT&scope=all");
    expect(settingsState.updateSettings).not.toHaveBeenCalled();
    expect(writeCalls()).toEqual([]);
  });

  it("discards the draft back to the saved policy", () => {
    renderView(null as never);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(screen.getByLabelText("Document fee"), { target: { value: "925" } });
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.queryByLabelText("Document fee")).toBeNull();
    expect(screen.getByText("$895")).toBeInTheDocument();
    expect(review()).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByLabelText("Document fee")).toHaveValue(895);
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
        { id: "l1", vin: "EXAMPLEVIN0000001", ymm: "2024 Example Crossover", mc_year: null, mc_make: null, mc_model: null, trim: "Base", condition: "used", mileage: 12, price: 30000, advertised_price_before_doc: 30000, doc_fee: 895, website_sale_price: 30895, price_parse_status: "ok", price_last_verified_at: "2026-10-20T00:00:00Z", archived_at: null, hero_image_url: null, vehicle_file_id: "f1", stock: "EX-1" },
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
