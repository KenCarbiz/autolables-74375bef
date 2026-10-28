import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AdminFixtureProvider, type AdminFixture } from "@/lib/admin/dataSource";
import { FIXTURE_11 } from "@/pages/admin/fixtures/11";

const mocks = vi.hoisted(() => ({
  updateSettings: vi.fn(),
  profile: null as { updated_at: string } | null,
}));

vi.mock("sonner", () => ({ toast: Object.assign(() => {}, { info: () => {}, error: () => {}, success: () => {} }) }));
vi.mock("@/contexts/DealerSettingsContext", () => ({ useDealerSettings: () => ({ settings: { label_defaults: {} }, updateSettings: mocks.updateSettings, loading: false }) }));
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: { id: "tenant-test", name: "Example Motors" }, currentStore: null, stores: [] }) }));
vi.mock("@/components/admin/PrintSettingsPanel", () => ({ default: () => <div>Print settings panel</div> }));
vi.mock("@/integrations/supabase/client", () => {
  const chain = () => {
    const c: Record<string, unknown> = {};
    Object.assign(c, {
      select: () => c,
      eq: () => c,
      is: () => c,
      order: () => c,
      limit: () => c,
      maybeSingle: () => Promise.resolve({ data: mocks.profile, error: null }),
      then: (resolve: (v: unknown) => unknown) => resolve({ data: null, error: null, count: null }),
    });
    return c;
  };
  return {
    supabase: {
      from: () => chain(),
      rpc: () => Promise.resolve({ data: null, error: { code: "PGRST202", message: "Could not find the function" } }),
    },
  };
});

import PrintCalibrationView from "./PrintCalibrationView";

const renderView = (fixture?: AdminFixture) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = <PrintCalibrationView />;
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{fixture ? <AdminFixtureProvider fixture={fixture}>{view}</AdminFixtureProvider> : view}</MemoryRouter>
    </QueryClientProvider>,
  );
};

describe("PrintCalibrationView", () => {
  beforeEach(() => {
    mocks.updateSettings.mockReset();
    mocks.profile = null;
  });

  it("says Needs setup when no profile row exists and writes nothing", async () => {
    renderView();
    expect(screen.getByText("Print settings panel")).toBeInTheDocument();
    expect(await screen.findByText("Needs setup")).toBeInTheDocument();
    expect(screen.getByText("No profile saved")).toBeInTheDocument();
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("never claims a test from a saved profile alone", async () => {
    mocks.profile = { updated_at: new Date(Date.now() - 2 * 3_600_000).toISOString() };
    renderView();
    expect(await screen.findByText("Needs test")).toBeInTheDocument();
    expect(screen.getByText(/no test recorded/)).toBeInTheDocument();
    expect(screen.queryByText("Tested")).toBeNull();
  });

  it("reads the fixture profile", () => {
    renderView(FIXTURE_11.fixture);
    expect(screen.getByText("Needs test")).toBeInTheDocument();
  });
});
