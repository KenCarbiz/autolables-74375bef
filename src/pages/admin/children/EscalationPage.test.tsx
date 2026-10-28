import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AdminFixtureProvider, type AdminFixture } from "@/lib/admin/dataSource";
import { FIXTURE_09 } from "@/pages/admin/fixtures/09";
import EscalationPage from "./EscalationPage";

const h = vi.hoisted(() => {
  const writes: string[] = [];
  const invoked: string[] = [];
  const result = { data: [], error: null, count: null };
  let chain: any;
  const handler: ProxyHandler<any> = {
    get(_target, prop) {
      if (prop === "then") return (resolve: (v: unknown) => unknown) => resolve(result);
      if (prop === "rpc") {
        return (name: string) => {
          if (name === "merge_dealer_settings") writes.push(name);
          return chain;
        };
      }
      if (prop === "functions") return { invoke: (name: string) => { invoked.push(name); return Promise.resolve(result); } };
      if (typeof prop === "string" && ["insert", "update", "upsert", "delete"].includes(prop)) writes.push(prop);
      return () => chain;
    },
  };
  chain = new Proxy(() => chain, handler);
  return {
    writes,
    invoked,
    chain,
    settings: { passport_contact_routing: {}, passport_agents: [] },
    updateSettings: vi.fn<(patch: Record<string, unknown>) => Promise<boolean>>(async () => true),
  };
});

vi.mock("@/integrations/supabase/client", () => ({ supabase: h.chain }));
vi.mock("@/contexts/DealerSettingsContext", () => ({ useDealerSettings: () => ({ settings: h.settings, updateSettings: h.updateSettings, loading: false }) }));
vi.mock("@/contexts/TenantContext", () => ({
  useTenant: () => ({
    tenant: { id: "tenant-example", name: "Example Motors" },
    stores: [{ id: "example-store-1", name: "Example rooftop" }],
    currentStore: { id: "example-store-1", name: "Example rooftop" },
  }),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "user-example" }, isAdmin: true, loading: false }) }));
vi.mock("@/hooks/useEntitlements", () => ({ useEntitlements: () => ({ tenant: { id: "tenant-example" }, member: { role: "owner" }, loading: false }) }));

const renderWith = (ui: ReactElement, fixture: AdminFixture = FIXTURE_09.fixture) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <AdminFixtureProvider fixture={fixture}>{ui}</AdminFixtureProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => {
  h.updateSettings.mockClear();
  h.writes.length = 0;
  h.invoked.length = 0;
});

describe("EscalationPage (screen 09)", () => {
  it("shows destination-required states, keeps review disabled until complete, and reads activity in the sender's vocabulary", () => {
    renderWith(<EscalationPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Escalation rules" })).toBeInTheDocument();
    expect(screen.getAllByText("Destination required")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Review changes" })).toBeDisabled();
    expect(screen.getByText("Complete all required fields to review your changes.")).toBeInTheDocument();
    expect(screen.getByText("All rooftops (2)")).toBeInTheDocument();
    expect(screen.getAllByText("Second rooftop").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Provider rejected")).toBeInTheDocument();
    expect(screen.getAllByText("Accepted").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("Accepted does not mean delivered.").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Not supported")).toHaveLength(3);
    expect(screen.getAllByRole("switch", { name: "Escalation" })[0]).toBeChecked();
    expect(screen.queryByLabelText("BDC email")).toBeNull();
    expect(h.updateSettings).not.toHaveBeenCalled();
    expect(h.writes).toEqual([]);
  });

  it("reads a row recorded before outcomes were tracked as Attempted, never Accepted", () => {
    const escalation = FIXTURE_09.fixture.views.escalation as { activity: Array<Record<string, unknown>> };
    const legacy = { id: "example-audit-3", action: "customer_passport_escalated", entity_id: "2c3d4e5f-0000-4000-8000-00000000000c", created_at: "2026-10-01T13:20:00Z", details: { level: 1, to: "BDC" } };
    renderWith(<EscalationPage />, { ...FIXTURE_09.fixture, views: { ...FIXTURE_09.fixture.views, escalation: { activity: [...escalation.activity, legacy] } } });
    expect(screen.getAllByText("Attempted")).toHaveLength(2);
    expect(screen.getAllByText("Accepted")).toHaveLength(2);
  });

  it("renders Unavailable, never zero, when the activity read fails", () => {
    renderWith(<EscalationPage />, { ...FIXTURE_09.fixture, views: { ...FIXTURE_09.fixture.views, escalation: { activity: null } } });
    expect(screen.getByText(/could not be read/)).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("enables review once both destinations are valid and runs a dry run without sending", () => {
    renderWith(<EscalationPage />);
    fireEvent.click(screen.getByRole("button", { name: "Add BDC email" }));
    fireEvent.change(screen.getByLabelText("BDC email"), { target: { value: "bdc@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Sales manager email" }));
    fireEvent.change(screen.getByLabelText("Sales manager email"), { target: { value: "manager@example.test" } });
    expect(screen.getByText("bdc@example.test")).toBeInTheDocument();
    expect(screen.queryAllByText("Destination required")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Review changes" })).toBeEnabled();
    expect(screen.getByText("Keep draft")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Test route" }));
    fireEvent.click(screen.getByRole("button", { name: "Run dry run" }));
    expect(screen.getByText("Routed to")).toBeInTheDocument();
    expect(screen.getByText("No message is sent.")).toBeInTheDocument();
    expect(screen.getByText(/After 5 minutes: BDC desk \(destination set\)/)).toBeInTheDocument();
    expect(h.invoked).toEqual([]);
    expect(h.updateSettings).not.toHaveBeenCalled();
    expect(h.writes).toEqual([]);
  });
});
