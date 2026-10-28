import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, screen, within } from "@testing-library/react";
import { Route, Routes, useParams } from "react-router-dom";
import { renderAdmin } from "@/test/adminRender";
import { functionCalls, isSingleRead, resetSupabaseSpy, spyCalls, spyResponses, writeCalls } from "@/test/mocks/supabaseSpy";
import { FIXTURE_CONFIG, RUN_RATE_LIMITED, RUN_SUCCESS } from "@/pages/admin/fixtures/integrationsData";
import type { SyncRunRow } from "@/lib/admin/integrations/runs";
import InventoryFeedView from "./InventoryFeedView";

// Screen 12 against live (spied) reads: the manual run is the only path to
// marketcheck-sync, it fires once per confirmed click, and the run links lead
// to the run's own page.

vi.mock("@/integrations/supabase/client", async () => {
  const m = await import("@/test/mocks/supabaseSpy");
  return { supabase: m.supabaseSpy };
});
vi.mock("sonner", () => ({ toast: Object.assign(() => {}, { info: () => {}, error: () => {}, success: () => {}, warning: () => {} }) }));
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: { id: "tenant-1", name: "Example Motors" }, currentStore: { id: "store-1", name: "Example Motors" }, loading: false }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "user-1" }, isAdmin: false, loading: false }) }));
vi.mock("@/hooks/useEntitlements", () => ({ useEntitlements: () => ({ member: { role: "owner" }, loading: false }) }));
vi.mock("@/contexts/DealerSettingsContext", () => ({ useDealerSettings: () => ({ settings: { dealer_timezone: "America/New_York", feature_blackbook: false }, loading: false }) }));

const RUN_PROVIDER_ERROR: SyncRunRow = {
  ...RUN_RATE_LIMITED,
  id: "a1b2c3d4-0000-4000-8000-000000000503",
  http_status: 503,
  error_summary: "MarketCheck answered HTTP 503",
  raw: { kind: "provider_refused", error: "refused_503", attempts: 3, source: FIXTURE_CONFIG.source },
};

const RunEcho = () => <p data-testid="run-page">{useParams().runId}</p>;

const renderFeed = () =>
  renderAdmin(
    <Routes>
      <Route path="/admin" element={<InventoryFeedView />} />
      <Route path="/admin/integrations/runs/:runId" element={<RunEcho />} />
    </Routes>,
    { route: "/admin?tab=inventory-feed" },
  );

const ready = () => screen.findByRole("table", { name: "Recent inventory feed attempts" });

beforeEach(() => {
  resetSupabaseSpy();
  spyResponses.tables.marketcheck_sync_config = { data: FIXTURE_CONFIG, error: null };
  spyResponses.tables.inventory_sync_runs = (ops) => (isSingleRead(ops) ? { data: RUN_PROVIDER_ERROR, error: null } : { data: [RUN_PROVIDER_ERROR, RUN_SUCCESS], count: 2, error: null });
  spyResponses.tables.vehicle_listings = { data: null, count: 130, error: null };
  spyResponses.rpcs.admin_feed_last_success = { data: RUN_SUCCESS.started_at, error: null };
  spyResponses.functions["marketcheck-sync"] = { data: { listings_seen: 128, new_vehicles: 2, prices_recorded: 128 }, error: null };
});

describe("InventoryFeedView manual run against live reads (screen 12)", () => {
  it("calls marketcheck-sync only after Run feed now is confirmed, exactly once, and shows the outcome", async () => {
    renderFeed();
    await ready();
    expect(functionCalls()).toEqual([]);
    expect(writeCalls().filter((c) => c.kind === "table")).toEqual([]);

    const run = screen.getByRole("button", { name: "Run feed now" });
    expect(run).toBeEnabled();
    fireEvent.click(run);
    expect(screen.getByText("Confirm the manual run")).toBeInTheDocument();
    expect(functionCalls()).toEqual([]);

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Run now" })); });
    expect(await screen.findByText("Run finished")).toBeInTheDocument();
    expect(screen.getByText("Run finished: 128 seen, 2 new, 128 prices recorded.")).toBeInTheDocument();
    expect(functionCalls()).toEqual(["marketcheck-sync"]);
    const call = spyCalls.find((c) => c.kind === "function");
    expect(call && call.kind === "function" ? call.args : null).toEqual({ body: { tenant_id: "tenant-1", force: true } });
  });

  it("makes no call when the manual run is cancelled at confirmation", async () => {
    renderFeed();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Run feed now" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Confirm the manual run")).toBeNull();
    expect(screen.getByRole("button", { name: "Run feed now" })).toBeEnabled();
    expect(functionCalls()).toEqual([]);
  });

  it("reports a refused run as not completed rather than finished", async () => {
    spyResponses.functions["marketcheck-sync"] = { data: null, error: { message: "Edge Function returned a non-2xx status code" } };
    renderFeed();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Run feed now" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Run now" })); });
    expect(await screen.findByText("Run did not complete")).toBeInTheDocument();
    expect(screen.getByText(/The run could not be started/)).toBeInTheDocument();
    expect(screen.queryByText("Run finished")).toBeNull();
    expect(functionCalls()).toEqual(["marketcheck-sync"]);
  });

  it("opens the latest run's page from Open run details", async () => {
    renderFeed();
    await ready();
    const link = screen.getByRole("link", { name: "Open run details" });
    expect(link).toHaveAttribute("href", `/admin/integrations/runs/${RUN_PROVIDER_ERROR.id}`);
    fireEvent.click(link);
    expect(screen.getByTestId("run-page")).toHaveTextContent(RUN_PROVIDER_ERROR.id);
    expect(functionCalls()).toEqual([]);
  });

  it("opens a run's page from its row in Recent attempts", async () => {
    renderFeed();
    const table = await ready();
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(2);
    fireEvent.click(within(rows[1]).getAllByRole("cell")[1]);
    expect(screen.getByTestId("run-page")).toHaveTextContent(RUN_SUCCESS.id);
    expect(functionCalls()).toEqual([]);
  });
});
