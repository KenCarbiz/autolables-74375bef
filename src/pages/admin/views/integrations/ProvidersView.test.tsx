import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import ProvidersView, { type ProvidersViewFixture } from "./ProvidersView";
import { renderInFixture, FIXTURE_NOW } from "./testHarness";

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.from, rpc: mocks.rpc, functions: { invoke: mocks.invoke } } }));
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: null, currentStore: null }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, isAdmin: false, loading: false }) }));
vi.mock("@/hooks/useEntitlements", () => ({ useEntitlements: () => ({ member: { role: "owner" }, loading: false }) }));
vi.mock("@/contexts/DealerSettingsContext", () => ({ useDealerSettings: () => ({ settings: { dealer_timezone: "", feature_blackbook: false }, loading: false }) }));

const hoursAgo = (h: number) => new Date(FIXTURE_NOW - h * 3_600_000).toISOString();

describe("ProvidersView", () => {
  beforeEach(() => {
    mocks.from.mockReset();
    mocks.rpc.mockReset();
    mocks.invoke.mockReset();
  });

  it("renders unknown, not healthy, when telemetry could not be read, and calls no provider", () => {
    const fixture: ProvidersViewFixture = { events: null, crawl: null, backendOk: false, latestRunId: null };
    renderInFixture(<ProvidersView />, { providers: fixture });
    expect(screen.getAllByText("Provider status could not be read").length).toBeGreaterThanOrEqual(5);
    expect(screen.getByText("A read failed")).toBeInTheDocument();
    expect(screen.getAllByText("Not configured").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Healthy")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open inventory feed" })).toHaveAttribute("href", "/admin?tab=inventory-feed");
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("derives health from recorded calls and names the affected output", () => {
    const fixture: ProvidersViewFixture = {
      events: [
        { at: hoursAgo(8), product: "dealer_inventory_syndication", outcome: "refused_rate", http_status: 429 },
        { at: hoursAgo(56), product: "dealer_inventory_syndication", outcome: "ok", http_status: 200 },
        { at: hoursAgo(2), product: "inventory_search", outcome: "ok", http_status: 200 },
      ],
      crawl: { lastAttemptAt: hoursAgo(3), lastSuccessAt: hoursAgo(3), lastOutcome: "captured", attempts: 12 },
      backendOk: true,
      latestRunId: "run-1",
    };
    renderInFixture(<ProvidersView />, { providers: fixture });
    expect(screen.getByText("Last call failed")).toBeInTheDocument();
    expect(screen.getAllByText("Answering").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Inventory freshness and availability")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open inventory feed" })).toHaveAttribute("href", "/admin/integrations/runs/run-1");
    expect(screen.getAllByText("Entitlement blocked").length).toBeGreaterThanOrEqual(1);
  });
});
