import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import ActivityView, { activityCsv, type ActivityViewFixture } from "./ActivityView";
import { renderInFixture } from "./testHarness";

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.from, rpc: mocks.rpc, functions: { invoke: mocks.invoke } } }));
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: null, currentStore: null }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, isAdmin: false, loading: false }) }));
vi.mock("@/hooks/useEntitlements", () => ({ useEntitlements: () => ({ member: { role: "owner" }, loading: false }) }));
vi.mock("@/contexts/DealerSettingsContext", () => ({ useDealerSettings: () => ({ settings: { dealer_timezone: "UTC", feature_blackbook: false }, loading: false }) }));

const fixture: ActivityViewFixture = {
  rows: [
    { id: "e1", action: "settings_updated", entity_type: "dealer_settings", entity_id: "abcdef12-0000", user_id: "u1", user_email: "ops@example.test", created_at: "2026-10-24T12:00:00Z", details: {} },
    { id: "e2", action: "marketcheck_sync_refused_429", entity_type: "inventory_sync_run", entity_id: "a1b2c3d4-0000", user_id: null, user_email: null, created_at: "2026-10-24T06:07:09Z", details: { http_status: 429 } },
  ],
  total: 2,
};

describe("ActivityView", () => {
  beforeEach(() => {
    mocks.from.mockReset();
    mocks.rpc.mockReset();
  });

  it("types each event, names the actor honestly and reads nothing on mount", () => {
    renderInFixture(<ActivityView />, { activity: fixture });
    const table = within(screen.getByRole("table", { name: "Activity ledger" }));
    expect(table.getByText("Configuration")).toBeInTheDocument();
    expect(table.getByText("Provider / job")).toBeInTheDocument();
    expect(table.getByText("ops@example.test")).toBeInTheDocument();
    expect(table.getByText("System")).toBeInTheDocument();
    expect(screen.getByText("Showing 2 of 2 events")).toBeInTheDocument();
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("keeps verification and export as explicit, gated clicks", () => {
    renderInFixture(<ActivityView />, { activity: fixture });
    const verify = screen.getByRole("button", { name: "Verify chain" });
    const exportButton = screen.getByRole("button", { name: "Export CSV" });
    expect(verify).toBeDisabled();
    expect(exportButton).toBeDisabled();
    fireEvent.click(verify);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("builds a CSV with the typed kind column", () => {
    const csv = activityCsv(fixture.rows);
    expect(csv.split("\n")).toHaveLength(3);
    expect(csv).toContain('"configuration","settings_updated"');
    expect(csv).toContain('"provider_job","marketcheck_sync_refused_429"');
  });
});
