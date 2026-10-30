import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AdminFixtureProvider, type AdminFixture } from "@/lib/admin/dataSource";
import { FIXTURE_11 } from "@/pages/admin/fixtures/11";

const mocks = vi.hoisted(() => ({
  updateSettings: vi.fn(),
  settings: {} as Record<string, unknown>,
}));

vi.mock("sonner", () => ({ toast: Object.assign(() => {}, { info: () => {}, error: () => {}, success: () => {} }) }));
vi.mock("@/contexts/DealerSettingsContext", () => ({ useDealerSettings: () => ({ settings: mocks.settings, updateSettings: mocks.updateSettings, loading: false }) }));
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: { id: "tenant-test", name: "Example Motors" }, currentStore: null, stores: [] }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "user-test", email: "manager@example.test" }, isAdmin: false, loading: false }) }));
vi.mock("@/hooks/useEntitlements", () => ({ useEntitlements: () => ({ member: { role: "owner" }, loading: false }) }));
vi.mock("@/components/admin/LabelDefaultsPanel", () => ({ default: () => <div>Label defaults panel</div> }));
vi.mock("@/components/admin/FactoryStickerPanel", () => ({ default: () => <div>Factory sticker panel</div> }));
vi.mock("@/components/admin/StickerPrintTemplates", () => ({ default: () => <div>Sticker print templates</div> }));
vi.mock("@/integrations/supabase/client", () => {
  const chain = () => {
    const c: Record<string, unknown> = {};
    Object.assign(c, {
      select: () => c,
      eq: () => c,
      is: () => c,
      order: () => c,
      limit: () => c,
      then: (resolve: (v: unknown) => unknown) => resolve({ data: null, error: { message: "read failed" }, count: null }),
    });
    return c;
  };
  return { supabase: { from: () => chain() } };
});

import TemplatesView from "./TemplatesView";

const renderView = (fixture?: AdminFixture) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = <TemplatesView />;
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{fixture ? <AdminFixtureProvider fixture={fixture}>{view}</AdminFixtureProvider> : view}</MemoryRouter>
    </QueryClientProvider>,
  );
};

describe("TemplatesView", () => {
  beforeEach(() => {
    mocks.updateSettings.mockReset();
    mocks.updateSettings.mockResolvedValue(true);
    mocks.settings = { addendum_paper_size: "letter", addendum_custom_width: "8.5", addendum_custom_height: "11", label_defaults: {} };
  });

  it("renders the legacy panels and paper size, and reports a catalog read failure honestly", async () => {
    renderView();
    expect(screen.getByText("Label defaults panel")).toBeInTheDocument();
    expect(screen.getByText("Factory sticker panel")).toBeInTheDocument();
    expect(screen.getByText("Sticker print templates")).toBeInTheDocument();
    expect((screen.getByLabelText("Addendum paper size") as HTMLSelectElement).value).toBe("letter");
    await waitFor(() => expect(screen.getByText(/could not be read/)).toBeInTheDocument());
    expect(screen.getByText("Saves automatically")).toBeInTheDocument();
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("shows the fixture catalog versions without claiming an unrecorded version", () => {
    renderView(FIXTURE_11.fixture);
    expect(screen.getByText("Example Window Classic")).toBeInTheDocument();
    expect(screen.getByText("v3")).toBeInTheDocument();
    expect(screen.getByText("Version not recorded")).toBeInTheDocument();
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });
});
