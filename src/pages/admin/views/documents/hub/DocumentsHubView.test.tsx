import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AdminFixtureProvider } from "@/lib/admin/dataSource";
import { WAVE_D_DOCS_FIXTURES } from "@/pages/admin/fixtures/WaveDDocsFixtures";

vi.mock("sonner", () => ({ toast: Object.assign(() => {}, { info: () => {}, error: () => {}, success: () => {} }) }));
vi.mock("@/contexts/DealerSettingsContext", () => ({ useDealerSettings: () => ({ settings: {}, updateSettings: vi.fn(), loading: false }) }));
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: { id: "tenant-test", name: "Example Motors" }, currentStore: null, stores: [] }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u", email: "m@example.test" }, isAdmin: false, loading: false }) }));
vi.mock("@/hooks/useEntitlements", () => ({ useEntitlements: () => ({ member: { role: "owner" }, loading: false }) }));
vi.mock("@/contexts/AuditContext", () => ({ useAudit: () => ({ entries: [], log: vi.fn() }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => { throw new Error("network read in a fixture"); }, rpc: () => { throw new Error("network read in a fixture"); } } }));

import DocumentsHubView from "./DocumentsHubView";

const Where = () => <span data-testid="loc">{useLocation().search}</span>;

const renderHub = (search: string) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/admin?tab=templates${search}`]}>
        <AdminFixtureProvider fixture={WAVE_D_DOCS_FIXTURES["v3-documents-hub"].fixture}>
          <DocumentsHubView />
          <Where />
        </AdminFixtureProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe("DocumentsHubView", () => {
  it("opens on Overview and syncs the view tab to the URL", () => {
    renderHub("");
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("tab", { name: /Vehicle readiness/ }));
    expect(screen.getByTestId("loc").textContent).toContain("view=readiness");
  });

  it("shows an exact total and a 25-row first page", async () => {
    renderHub("&view=readiness");
    expect(await screen.findByText(/Showing 1 to 25 of 64/)).toBeInTheDocument();
  });

  it("keeps filters in the URL and narrows the total", async () => {
    renderHub("&view=readiness&condition=new");
    await waitFor(() => expect(screen.getByText(/of 21\b/)).toBeInTheDocument());
    expect(screen.getByTestId("loc").textContent).toContain("condition=new");
  });

  it("falls back to Overview for an unknown view", () => {
    renderHub("&view=bogus");
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
    expect(within(screen.getByRole("tablist")).getAllByRole("tab").length).toBe(5);
  });
});
