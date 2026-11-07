import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AdminFixtureProvider, type AdminFixture } from "@/lib/admin/dataSource";
import type { CustomerPassportContactSettings } from "@/lib/passportRouting";
import { FIXTURE_08, ROUTING_FIXTURE_08 } from "@/pages/admin/fixtures/08";
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

describe("Passport modules, Calls to action and Customer previews", () => {
  it("links to the locked Passport preview and shows the routing preview", () => {
    renderWith(<CustomerPreviewsView />);
    const links = screen.getAllByRole("link", { name: /open preview/i });
    expect(links[0]).toHaveAttribute("href", "/v/demo?preview=1&scenario=new2026");
    expect(links[0]).toHaveAttribute("target", "_blank");
    expect(screen.getByText("Live preview")).toBeInTheDocument();
    expect(h.updateSettings).not.toHaveBeenCalled();
  });
});
