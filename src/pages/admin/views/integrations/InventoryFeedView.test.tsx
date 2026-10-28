import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import InventoryFeedView, { type FeedViewFixture } from "./InventoryFeedView";
import { renderInFixture } from "./testHarness";
import { FIXTURE_CONFIG, FIXTURE_COUNTS, FIXTURE_RUNS, RUN_RATE_LIMITED, RUN_SUCCESS } from "@/pages/admin/fixtures/integrationsData";

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.from, rpc: mocks.rpc, functions: { invoke: mocks.invoke } } }));
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: null, currentStore: null }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, isAdmin: false, loading: false }) }));
vi.mock("@/hooks/useEntitlements", () => ({ useEntitlements: () => ({ member: { role: "owner" }, loading: false }) }));
vi.mock("@/contexts/DealerSettingsContext", () => ({ useDealerSettings: () => ({ settings: { dealer_timezone: "", feature_blackbook: false }, loading: false }) }));

const rateLimited: FeedViewFixture = {
  config: FIXTURE_CONFIG,
  latestRun: RUN_RATE_LIMITED,
  latestRealRun: RUN_RATE_LIMITED,
  lastSuccessAt: RUN_SUCCESS.started_at,
  runs: { rows: FIXTURE_RUNS, total: FIXTURE_RUNS.length },
  counts: FIXTURE_COUNTS,
  viewer: { canManageSettings: true, canClearScope: false, timeZone: "America/New_York" },
};

const scopeMismatch = { ...RUN_RATE_LIMITED, id: "a1b2c3d4-0000-4000-8000-000000000777", http_status: 200, error_summary: "MarketCheck answered with a different rooftop", raw: { kind: "scope_mismatch" } };
const identityHold: FeedViewFixture = {
  ...rateLimited,
  latestRun: scopeMismatch,
  latestRealRun: scopeMismatch,
  viewer: { canManageSettings: true, canClearScope: true },
};

const unreadable: FeedViewFixture = {
  config: null,
  configLoadFailed: true,
  latestRun: null,
  latestRealRun: null,
  lastSuccessAt: null,
  runsLoadFailed: true,
  runs: { rows: [], total: null },
  counts: { active: { kind: "failed" }, new: { kind: "failed" }, used: { kind: "failed" }, cpo: { kind: "failed" } },
};

describe("InventoryFeedView under a provider rate limit (screen 12)", () => {
  beforeEach(() => {
    mocks.from.mockReset();
    mocks.rpc.mockReset();
    mocks.invoke.mockReset();
  });

  it("renders the health banner, tiles and recent attempts from the fixture without touching the backend", () => {
    renderInFixture(<InventoryFeedView />, { "inventory-feed": rateLimited });
    expect(screen.getByText("Provider rate limited (HTTP 429)")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open run details" })).toHaveAttribute("href", `/admin/integrations/runs/${RUN_RATE_LIMITED.id}`);
    expect(screen.getAllByText("Previously validated").length).toBeGreaterThan(0);
    expect(screen.getByRole("link", { name: "Active vehicles: 130" })).toBeInTheDocument();

    const table = screen.getByRole("table", { name: "Recent inventory feed attempts" });
    expect(within(table).getAllByRole("row")).toHaveLength(4);
    expect(within(table).getByText("Rate limit from provider")).toBeInTheDocument();
    expect(within(table).getByText("Scheduled run (cadence)")).toBeInTheDocument();
    expect(within(table).getByText("Inventory updated")).toBeInTheDocument();
    expect(within(table).getByText("None (retained)")).toBeInTheDocument();
    expect(within(table).getByText("128 seen")).toBeInTheDocument();
    expect(screen.getByText("Showing 3 of 3 attempts")).toBeInTheDocument();

    expect(screen.getByText("79")).toBeInTheDocument();
    expect(screen.getByText("31")).toBeInTheDocument();
    expect(screen.getByText("20")).toBeInTheDocument();
    expect(screen.getByText("On schedule")).toBeInTheDocument();
    expect(screen.getByText("Every 24 hours, 06:00 UTC")).toBeInTheDocument();

    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("retains the source identity and disables review while the provider error is active", () => {
    renderInFixture(<InventoryFeedView />, { "inventory-feed": rateLimited });
    expect(screen.getByText("Verified source retained")).toBeInTheDocument();
    expect(screen.getByText("Do not clear identity on provider rate limits or errors.")).toBeInTheDocument();
    const review = screen.getByRole("button", { name: "Review source" });
    expect(review).toBeDisabled();
    expect(screen.getByText("Review source is disabled while a provider error is active.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /clear/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run feed now" })).toBeDisabled();
  });

  it("exposes the clear-pin path only behind review and confirmation on an identity hold", () => {
    renderInFixture(<InventoryFeedView />, { "inventory-feed": identityHold });
    expect(screen.getByText("Source identity needs review")).toBeInTheDocument();
    const review = screen.getByRole("button", { name: "Review source" });
    expect(review).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Clear rooftop pin" })).not.toBeInTheDocument();
    fireEvent.click(review);
    fireEvent.click(screen.getByRole("button", { name: "Clear rooftop pin" }));
    expect(screen.getByRole("button", { name: "Clear the pin" })).toBeInTheDocument();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("renders unknown and unavailable, never zero, when the reads fail", () => {
    renderInFixture(<InventoryFeedView />, { "inventory-feed": unreadable });
    expect(screen.getByText("Feed health could not be read")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Active vehicles: Unavailable" })).toBeInTheDocument();
    expect(screen.getAllByText("Unavailable")).toHaveLength(4);
    expect(screen.getByText("The run ledger could not be read.")).toBeInTheDocument();
    expect(screen.getAllByText("Unknown").length).toBeGreaterThan(0);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
