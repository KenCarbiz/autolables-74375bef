import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import DataQualityView, { type DataQualityViewFixture } from "./DataQualityView";
import { DATA_QUALITY_CHECKS } from "@/lib/admin/integrations/dataQuality";
import { renderInFixture } from "./testHarness";

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.from, rpc: mocks.rpc, functions: { invoke: mocks.invoke } } }));
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: null, currentStore: null }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, isAdmin: false, loading: false }) }));
vi.mock("@/hooks/useEntitlements", () => ({ useEntitlements: () => ({ member: { role: "owner" }, loading: false }) }));
vi.mock("@/contexts/DealerSettingsContext", () => ({ useDealerSettings: () => ({ settings: { dealer_timezone: "", feature_blackbook: false }, loading: false }) }));

describe("DataQualityView", () => {
  beforeEach(() => {
    mocks.from.mockReset();
    mocks.rpc.mockReset();
    mocks.invoke.mockReset();
  });

  it("renders unavailable counts, never zero, and makes no backend call", () => {
    const fixture: DataQualityViewFixture = { counts: {} };
    renderInFixture(<DataQualityView />, { "data-quality": fixture });
    expect(screen.getByText(`${DATA_QUALITY_CHECKS.length} checks could not be read`)).toBeInTheDocument();
    expect(screen.getAllByText("Unavailable")).toHaveLength(DATA_QUALITY_CHECKS.length);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    expect(screen.queryByText("Market data refresh tools")).not.toBeInTheDocument();
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("links each actionable count to its exact destination", () => {
    const counts = Object.fromEntries(DATA_QUALITY_CHECKS.map((c) => [c.id, { kind: "known" as const, value: 0 }]));
    counts.source_conflicts = { kind: "known", value: 4 };
    renderInFixture(<DataQualityView />, { "data-quality": { counts } });
    expect(screen.getByText("1 check needs attention")).toBeInTheDocument();
    expect(screen.getByText("4")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open exceptions" })).toHaveAttribute("href", "/admin/exceptions");
    expect(screen.getAllByText("Clear").length).toBe(DATA_QUALITY_CHECKS.length - 1);
  });
});
