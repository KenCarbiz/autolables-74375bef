import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, within } from "@testing-library/react";
import SyncRunPage, { type SyncRunFixture } from "./SyncRunPage";
import { renderInFixture } from "@/pages/admin/views/integrations/testHarness";
import { RUN_RATE_LIMITED, RUN_SUCCESS } from "@/pages/admin/fixtures/integrationsData";

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.from, rpc: mocks.rpc, functions: { invoke: mocks.invoke } } }));
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: null, currentStore: null }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: null, isAdmin: false, loading: false }) }));
vi.mock("@/hooks/useEntitlements", () => ({ useEntitlements: () => ({ member: { role: "manager" }, loading: false }) }));
vi.mock("@/contexts/DealerSettingsContext", () => ({ useDealerSettings: () => ({ settings: { dealer_timezone: "UTC", feature_blackbook: false }, loading: false }) }));

const PATH = "/admin/integrations/runs/:runId";
const fixture: SyncRunFixture = {
  run: { ...RUN_RATE_LIMITED, raw: { ...(RUN_RATE_LIMITED.raw ?? {}), api_key: "secret-value", headers: { Authorization: "Bearer secret-value" } } },
  errors: [],
  lastSuccessAt: RUN_SUCCESS.started_at,
};

describe("SyncRunPage for a provider rate limit (screen 13)", () => {
  beforeEach(() => {
    mocks.from.mockReset();
    mocks.rpc.mockReset();
    mocks.invoke.mockReset();
  });

  it("derives the outcome, summary, diagnosis and next step from the run row", () => {
    renderInFixture(<SyncRunPage />, { "sync-run": fixture }, { route: `/admin/integrations/runs/${RUN_RATE_LIMITED.id}`, path: PATH });
    expect(screen.getByRole("heading", { level: 1, name: "Inventory sync run" })).toBeInTheDocument();
    expect(screen.getByText("Provider rate limited")).toBeInTheDocument();
    expect(screen.getByText("429")).toBeInTheDocument();
    expect(screen.getByText("Too Many Requests")).toBeInTheDocument();
    expect(screen.getByText("example-dealer.test")).toBeInTheDocument();
    expect(screen.getByText("New, updated, or retired")).toBeInTheDocument();
    expect(screen.getByText("No changes made")).toBeInTheDocument();
    expect(screen.getByText("The provider declined this request")).toBeInTheDocument();
    expect(screen.getByText("Next step")).toBeInTheDocument();
    expect(screen.getByText("Review provider quota and retry policy")).toBeInTheDocument();
    expect(screen.getByText("Rooftop pin remains unchanged")).toBeInTheDocument();
    expect(screen.getByText("Run details")).toBeInTheDocument();
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("shows the timeline, zero impact and redacted evidence", () => {
    renderInFixture(<SyncRunPage />, { "sync-run": fixture }, { route: `/admin/integrations/runs/${RUN_RATE_LIMITED.id}`, path: PATH });
    const timeline = screen.getByRole("table", { name: "Run event timeline" });
    const rows = within(timeline).getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getAllByRole("cell")[1].textContent)).toEqual(["Scheduled run started", "Provider returned 429", "Inventory preservation applied", "Retry pending review"]);
    const impact = screen.getByText("No vehicles imported").closest("section") as HTMLElement;
    expect(within(impact).getAllByText("0")).toHaveLength(3);
    expect(screen.getByText(/"reason": "provider_rate_limited"/)).toBeInTheDocument();
    expect(screen.getByText(/"api_key": "\[redacted\]"/)).toBeInTheDocument();
    expect(screen.getByText(/"Authorization": "\[redacted\]"/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("secret-value");
    expect(document.body.textContent).toContain(RUN_RATE_LIMITED.id);
  });

  it("explains retry options without starting a run", () => {
    renderInFixture(<SyncRunPage />, { "sync-run": fixture }, { route: `/admin/integrations/runs/${RUN_RATE_LIMITED.id}`, path: PATH });
    for (const link of screen.getAllByRole("link", { name: "Back to feed" })) expect(link).toHaveAttribute("href", "/admin?tab=inventory-feed");
    fireEvent.click(screen.getByRole("button", { name: "Review retry options" }));
    expect(screen.getByText(/The next scheduled run retries automatically/)).toBeInTheDocument();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("says when a run is not found instead of inventing one", () => {
    renderInFixture(<SyncRunPage />, { "sync-run": { run: null, errors: [], lastSuccessAt: null } satisfies SyncRunFixture }, { route: "/admin/integrations/runs/missing", path: PATH });
    expect(screen.getByText("Run not found")).toBeInTheDocument();
  });
});
