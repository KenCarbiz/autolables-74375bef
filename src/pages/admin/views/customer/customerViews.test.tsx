import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AdminFixtureProvider, type AdminFixture } from "@/lib/admin/dataSource";
import type { CustomerPassportContactSettings } from "@/lib/passportRouting";
import { FIXTURE_08, ROUTING_FIXTURE_08 } from "@/pages/admin/fixtures/08";
import RoutingView from "./RoutingView";
import PassportModulesView from "./PassportModulesView";
import CallsToActionView from "./CallsToActionView";
import CustomerPreviewsView from "./CustomerPreviewsView";

const h = vi.hoisted(() => {
  const writes: string[] = [];
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
      if (typeof prop === "string" && ["insert", "update", "upsert", "delete"].includes(prop)) writes.push(prop);
      return () => chain;
    },
  };
  chain = new Proxy(() => chain, handler);
  const settings = {
    passport_contact_routing: {
      contactMode: "smart_routing",
      dealershipDefaultContact: { salesPhone: "860 555 0100", salesEmail: "" },
      bdcSettings: { enabled: false, showBdcAsTeam: true },
      managerFallback: { enabled: false },
      escalationRules: { enabled: false, firstResponseSlaMinutes: 5 },
      businessHours: [{ dayOfWeek: 1, startTime: "09:00", endTime: "19:00" }],
    },
    passport_agents: [
      { id: "example-agent-1", name: "Example Rivera", status: "available", acceptsPassportLeads: true, workingHours: [] },
      { id: "example-agent-2", name: "Example Chen", status: "available", acceptsPassportLeads: true, workingHours: [] },
    ],
    packet_module_defaults: {},
    history_report_links_enabled: true,
    ingest_auto_publish: true,
    sticky_bottom_buttons: null,
  };
  return { writes, chain, settings, updateSettings: vi.fn<(patch: Record<string, unknown>) => Promise<boolean>>(async () => true) };
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
vi.mock("@/hooks/useInstantSave", () => ({ useInstantSave: () => undefined }));

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

const renderWith = (ui: ReactElement, fixture: AdminFixture | null = FIXTURE_08.fixture) =>
  render(
    <QueryClientProvider client={client()}>
      <MemoryRouter>{fixture ? <AdminFixtureProvider fixture={fixture}>{ui}</AdminFixtureProvider> : ui}</MemoryRouter>
    </QueryClientProvider>,
  );

const cleanFixture = (): AdminFixture => {
  const routing = ROUTING_FIXTURE_08.routing as CustomerPassportContactSettings;
  return {
    ...FIXTURE_08.fixture,
    views: {
      routing: {
        ...ROUTING_FIXTURE_08,
        routing: {
          ...routing,
          dealershipDefaultContact: { salesPhone: "860 555 0100", salesEmail: "" },
          bdcSettings: { enabled: false, showBdcAsTeam: true },
          managerFallback: { enabled: false },
          escalationRules: { ...routing.escalationRules, enabled: false },
        },
      },
    },
  };
};

beforeEach(() => {
  h.updateSettings.mockClear();
  h.writes.length = 0;
});

describe("RoutingView (screen 08)", () => {
  it("renders the resolver order with Incomplete chips and the readiness rail from the fixture, writing nothing on mount", () => {
    renderWith(<RoutingView />);
    for (const title of ["CRM owner", "Assigned salesperson", "Sales rotation", "BDC", "Manager fallback", "Store contact"]) {
      expect(screen.getAllByText(title).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByText("Incomplete").length).toBeGreaterThanOrEqual(3);
    expect(screen.getAllByText("Missing").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("2 salespeople").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Review changes" })).toBeDisabled();
    expect(screen.getByText("Live preview")).toBeInTheDocument();
    expect(h.updateSettings).not.toHaveBeenCalled();
    expect(h.writes).toEqual([]);
  });

  it("keeps edits in the draft, opens the review without writing, and refuses a change that enables a dead route", () => {
    renderWith(<RoutingView />, cleanFixture());
    expect(screen.queryAllByText("Incomplete")).toHaveLength(0);
    fireEvent.click(screen.getByRole("switch", { name: "Enable manager fallback" }));
    expect(h.updateSettings).not.toHaveBeenCalled();
    const review = screen.getByRole("button", { name: "Review changes" });
    expect(review).toBeEnabled();
    fireEvent.click(review);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getAllByText("Add a valid fallback before enabling this route.").length).toBeGreaterThan(0);
    expect(within(dialog).getByRole("button", { name: "Apply changes" })).toBeDisabled();
    expect(h.updateSettings).not.toHaveBeenCalled();
    expect(h.writes).toEqual([]);
  });

  it("applies through updateSettings with only the two routing keys, and only after review", async () => {
    renderWith(<RoutingView />, null);
    fireEvent.click(screen.getByRole("switch", { name: "Smart routing" }));
    expect(h.updateSettings).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Contact mode")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply changes" }));
    await waitFor(() => expect(h.updateSettings).toHaveBeenCalledTimes(1));
    const patch = h.updateSettings.mock.calls[0][0];
    expect(Object.keys(patch).sort()).toEqual(["passport_agents", "passport_contact_routing"]);
    expect((patch.passport_contact_routing as CustomerPassportContactSettings).contactMode).toBe("dealership_default");
    expect(await within(dialog).findByRole("button", { name: "Done" })).toBeInTheDocument();
  });
});

describe("RoutingView draft against live settings", () => {
  const review = () => screen.getByRole("button", { name: "Review changes" });
  const smart = () => screen.getByRole("switch", { name: "Smart routing" });

  it("marks an edit as a draft in the Draft configuration bar and Discard restores the saved values", () => {
    renderWith(<RoutingView />, null);
    expect(screen.getByText("Draft configuration")).toBeInTheDocument();
    expect(screen.getByText(/^No pending changes\./)).toBeInTheDocument();
    expect(review()).toBeDisabled();
    expect(smart()).toBeChecked();

    fireEvent.click(smart());
    expect(smart()).not.toBeChecked();
    expect(screen.getByText("1 setting changed. Review before applying.")).toBeInTheDocument();
    expect(review()).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(smart()).toBeChecked();
    expect(screen.getByText(/^No pending changes\./)).toBeInTheDocument();
    expect(review()).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Discard" })).toBeNull();
    expect(h.updateSettings).not.toHaveBeenCalled();
    expect(h.writes).toEqual([]);
  });

  it("drops back to no pending changes when an edit is reverted by hand", () => {
    renderWith(<RoutingView />, null);
    fireEvent.click(smart());
    expect(review()).toBeEnabled();
    fireEvent.click(smart());
    expect(review()).toBeDisabled();
    expect(screen.getByText(/^No pending changes\./)).toBeInTheDocument();
  });

  it("keeps the draft and shows the failure in the review and the bar when the save is refused", async () => {
    h.updateSettings.mockResolvedValueOnce(false);
    renderWith(<RoutingView />, null);
    fireEvent.click(smart());
    fireEvent.click(review());
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Apply changes" }));
    await waitFor(() => expect(h.updateSettings).toHaveBeenCalledTimes(1));
    expect(await within(dialog).findByText("Not applied.")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Done" })).toBeNull();
    expect(within(dialog).queryByText("Applied.")).toBeNull();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const bar = screen.getByText("Draft configuration").parentElement as HTMLElement;
    expect(within(bar).getByText("The change was not saved. Nothing was applied.")).toBeInTheDocument();
    expect(smart()).not.toBeChecked();
    expect(review()).toBeEnabled();
  });

  it("closes the review on Cancel without writing and keeps the draft", () => {
    renderWith(<RoutingView />, null);
    fireEvent.click(smart());
    fireEvent.click(review());
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(smart()).not.toBeChecked();
    expect(screen.getByText("1 setting changed. Review before applying.")).toBeInTheDocument();
    expect(h.updateSettings).not.toHaveBeenCalled();
  });

  it("links Review escalation rules to the escalation child page", () => {
    renderWith(<RoutingView />, null);
    expect(screen.getByRole("link", { name: "Review escalation rules" })).toHaveAttribute("href", "/admin/customer-experience/escalation");
  });
});

describe("Passport modules, Calls to action and Customer previews", () => {
  it("render the rehomed panels without writing", async () => {
    renderWith(<PassportModulesView />);
    expect(screen.getByText("Customer Packet Defaults")).toBeInTheDocument();
    expect(screen.getByText("Passport Publishing")).toBeInTheDocument();
    expect(await screen.findByText("Manufacturer Document Permissions")).toBeInTheDocument();
    renderWith(<CallsToActionView />);
    expect(screen.getByText("Passport Buttons")).toBeInTheDocument();
    expect(h.updateSettings).not.toHaveBeenCalled();
    expect(h.writes).toEqual([]);
  });

  it("links to the locked Passport preview and shows the routing preview", () => {
    renderWith(<CustomerPreviewsView />);
    const links = screen.getAllByRole("link", { name: /open preview/i });
    expect(links[0]).toHaveAttribute("href", "/v/demo?preview=1&scenario=new2026");
    expect(links[0]).toHaveAttribute("target", "_blank");
    expect(screen.getByText("Live preview")).toBeInTheDocument();
    expect(h.updateSettings).not.toHaveBeenCalled();
  });
});
