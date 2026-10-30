import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  h.updateSettings.mockReset();
  h.updateSettings.mockResolvedValue(true);
  h.writes.length = 0;
  h.invoked.length = 0;
  h.settings.passport_contact_routing = {};
});

const renderLive = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <EscalationPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

const CONFIGURED_ROUTING = {
  contactMode: "smart_routing",
  dealershipDefaultContact: { salesPhone: "860 555 0100", salesEmail: "" },
  bdcSettings: { enabled: true, showBdcAsTeam: true, bdcEmail: "bdc@example.test" },
  managerFallback: { enabled: true, managerEmail: "manager@example.test" },
  escalationRules: { enabled: true, firstResponseSlaMinutes: 5, escalateToBdcAfterMinutes: 5, escalateToManagerAfterMinutes: 10, notifyMethods: ["email"] },
};

describe("EscalationPage (screen 09)", () => {
  it("shows destination-required states, keeps review disabled until complete, and reads activity in the sender's vocabulary", () => {
    renderWith(<EscalationPage />);
    expect(screen.getByRole("heading", { level: 1, name: "Escalation & Delivery" })).toBeInTheDocument();
    expect(screen.getAllByText("Destination required")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Review changes" })).toBeDisabled();
    expect(screen.getByText("Complete all required fields to review your changes.")).toBeInTheDocument();
    expect(screen.getByText("All rooftops (2)")).toBeInTheDocument();
    expect(screen.getAllByText("Second rooftop").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Provider rejected")).toBeInTheDocument();
    expect(screen.getAllByText("Accepted").length).toBeGreaterThanOrEqual(1);
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
    expect(screen.getAllByText("Attempted")).toHaveLength(1);
    expect(screen.getAllByText("Accepted")).toHaveLength(1);
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

describe("EscalationPage draft against live settings (screen 09)", () => {
  beforeEach(() => {
    h.settings.passport_contact_routing = CONFIGURED_ROUTING;
  });

  const review = () => screen.getByRole("button", { name: "Review changes" });
  const managerAfter = () => screen.getByLabelText("Escalate to manager after") as HTMLSelectElement;

  it("keeps Review changes disabled until the rules change, and again after a change back", () => {
    renderLive();
    expect(screen.queryAllByText("Destination required")).toHaveLength(0);
    expect(review()).toBeDisabled();
    expect(screen.getByText("No changes to review.")).toBeInTheDocument();
    expect(screen.queryByText("Keep draft")).toBeNull();

    fireEvent.change(managerAfter(), { target: { value: "15" } });
    expect(review()).toBeEnabled();
    expect(screen.getByText("Keep draft")).toBeInTheDocument();
    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(screen.getByText("Nothing is written until you review and apply.")).toBeInTheDocument();

    fireEvent.change(managerAfter(), { target: { value: "10" } });
    expect(review()).toBeDisabled();
    expect(screen.queryByText("Keep draft")).toBeNull();
    expect(h.updateSettings).not.toHaveBeenCalled();
  });

  it("blocks review with a visible message while a destination email is invalid", () => {
    renderLive();
    fireEvent.click(screen.getByRole("button", { name: "Change BDC email" }));
    const email = screen.getByLabelText("BDC email");
    fireEvent.change(email, { target: { value: "bdc@" } });
    expect(screen.getByText("Complete all required fields to review your changes.")).toBeInTheDocument();
    expect(review()).toBeDisabled();
    fireEvent.click(review());
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.change(email, { target: { value: "desk@example.test" } });
    expect(screen.queryByText("Complete all required fields to review your changes.")).toBeNull();
    expect(screen.getByText("Nothing is written until you review and apply.")).toBeInTheDocument();
    expect(review()).toBeEnabled();
    expect(h.updateSettings).not.toHaveBeenCalled();
    expect(h.writes).toEqual([]);
  });

  it("keeps the draft when the review is cancelled, and Discard restores the saved rules", async () => {
    renderLive();
    fireEvent.change(managerAfter(), { target: { value: "15" } });
    fireEvent.click(review());
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Review escalation changes")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(managerAfter().value).toBe("15");
    expect(screen.getByText("Keep draft")).toBeInTheDocument();
    expect(review()).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(managerAfter().value).toBe("10");
    expect(screen.queryByText("Keep draft")).toBeNull();
    expect(review()).toBeDisabled();
    expect(h.updateSettings).not.toHaveBeenCalled();
  });

  it("saves the reviewed rules through updateSettings only on Apply", async () => {
    renderLive();
    fireEvent.change(managerAfter(), { target: { value: "15" } });
    fireEvent.click(review());
    const dialog = screen.getByRole("dialog");
    expect(h.updateSettings).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply changes" }));
    await waitFor(() => expect(h.updateSettings).toHaveBeenCalledTimes(1));
    const patch = h.updateSettings.mock.calls[0][0] as { passport_contact_routing: { escalationRules: { escalateToManagerAfterMinutes: number }; bdcSettings: { bdcEmail: string } } };
    expect(Object.keys(patch).sort()).toEqual(["passport_agents", "passport_contact_routing"]);
    expect(patch.passport_contact_routing.escalationRules.escalateToManagerAfterMinutes).toBe(15);
    expect(patch.passport_contact_routing.bdcSettings.bdcEmail).toBe("bdc@example.test");
    expect(await within(dialog).findByRole("button", { name: "Done" })).toBeInTheDocument();
    expect(h.invoked).toEqual([]);
  });

  it("names a malformed destination address as not valid, with Change, and blocks review", () => {
    renderLive();
    fireEvent.click(screen.getByRole("button", { name: "Change BDC email" }));
    fireEvent.change(screen.getByLabelText("BDC email"), { target: { value: "bdc@" } });
    const alert = screen.getByText("Not a valid email address: bdc@").closest("[role='alert']") as HTMLElement;
    expect(alert).toBeInTheDocument();
    expect(screen.queryByText("bdc@", { selector: "[data-parity='destination-email']" })).toBeNull();
    expect(review()).toBeDisabled();
    expect(screen.getByText("Complete all required fields to review your changes.")).toBeInTheDocument();
  });

  it("offers Change on a stored malformed address, and review returns once it is fixed", () => {
    h.settings.passport_contact_routing = { ...CONFIGURED_ROUTING, managerFallback: { enabled: true, managerEmail: "manager at example" } };
    renderLive();
    expect(screen.getByText("Not a valid email address: manager at example")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Change Sales manager email" }));
    fireEvent.change(screen.getByLabelText("Sales manager email"), { target: { value: "manager@example.test" } });
    expect(screen.queryByText(/Not a valid email address/)).toBeNull();
    expect(review()).toBeEnabled();
    expect(h.updateSettings).not.toHaveBeenCalled();
  });

  it("leaves Applying with a visible failure and keeps the draft when the save throws", async () => {
    h.updateSettings.mockRejectedValueOnce(new Error("network down"));
    renderLive();
    fireEvent.change(managerAfter(), { target: { value: "15" } });
    fireEvent.click(review());
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply changes" }));
    expect(await within(dialog).findByText("Not applied.")).toBeInTheDocument();
    expect(within(dialog).queryByText("Applying…")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(managerAfter().value).toBe("15");
    expect(screen.getByText("Keep draft")).toBeInTheDocument();
  });

  it("shows a refused save as Not applied and keeps the draft for another try", async () => {
    h.updateSettings.mockResolvedValueOnce(false);
    renderLive();
    fireEvent.change(managerAfter(), { target: { value: "15" } });
    fireEvent.click(review());
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply changes" }));
    expect(await within(dialog).findByText("Not applied.")).toBeInTheDocument();
    expect(within(dialog).getAllByText("The change was not saved. Nothing was applied.").length).toBeGreaterThan(0);
    expect(within(dialog).queryByRole("button", { name: "Done" })).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(managerAfter().value).toBe("15");
    expect(screen.getByText("Keep draft")).toBeInTheDocument();
    expect(review()).toBeEnabled();
  });
});
