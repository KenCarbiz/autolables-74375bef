import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AdminFixtureProvider } from "@/lib/admin/dataSource";
import { derivePublishingMatrix } from "@/lib/admin/publishingPolicy";

// The view reads through contexts and the Supabase client; each is stubbed so
// the test can prove what the page does on mount (reads only, no dialog, no
// writes) and what it shows when a read fails (Unknown, never a default).

const spies = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  updateSettings: vi.fn(),
  readFails: { value: false },
}));

vi.mock("@/integrations/supabase/client", () => {
  const result = () => (spies.readFails.value ? { data: null, error: { message: "unavailable" }, count: null } : { data: null, error: null, count: 0 });
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    select: () => chain,
    eq: () => chain,
    is: () => chain,
    in: () => chain,
    or: () => chain,
    order: () => chain,
    range: () => chain,
    maybeSingle: () => Promise.resolve(result()),
    insert: (...args: unknown[]) => {
      spies.insert(...args);
      return Promise.resolve({ data: null, error: null });
    },
    update: (...args: unknown[]) => {
      spies.update(...args);
      return chain;
    },
    then: (resolve: (v: unknown) => unknown) => resolve(result()),
  });
  return {
    supabase: {
      from: (...args: unknown[]) => {
        spies.from(...args);
        return chain;
      },
      rpc: (...args: unknown[]) => {
        spies.rpc(...args);
        return Promise.resolve({ data: null, error: null });
      },
    },
  };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "user-1", email: "admin@example.com" }, isAdmin: true }) }));
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: { id: "tenant-1", name: "Example Auto Group" } }) }));
vi.mock("@/hooks/useEntitlements", () => ({ useEntitlements: () => ({ member: { role: "admin" } }) }));
vi.mock("@/contexts/DealerSettingsContext", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/contexts/DealerSettingsContext")>();
  return { ...mod, useDealerSettings: () => ({ settings: mod.DEFAULT_SETTINGS, loading: false, updateSettings: spies.updateSettings, reload: () => Promise.resolve() }) };
});

import EffectivePolicyView from "./EffectivePolicyView";
import fixture10 from "@/pages/admin/fixtures/10";
import type { PublishingFixture } from "./usePublishingData";

const renderView = (withFixture: boolean) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/admin?tab=effective-policy"]}>
        <EffectivePolicyView />
      </MemoryRouter>
    </QueryClientProvider>
  );
  return render(withFixture ? <AdminFixtureProvider fixture={fixture10.fixture}>{tree}</AdminFixtureProvider> : tree);
};

const fixtureView = fixture10.fixture.views["effective-policy"] as PublishingFixture;

describe("Publishing > Effective policy", () => {
  beforeEach(() => {
    spies.from.mockClear();
    spies.rpc.mockClear();
    spies.insert.mockClear();
    spies.update.mockClear();
    spies.updateSettings.mockClear();
    spies.readFails.value = false;
  });

  it("renders the rooftop matrix from the fixture without reading or writing anything", () => {
    renderView(true);
    expect(screen.getByText("This rooftop")).toBeInTheDocument();
    expect(screen.getByText(`Policy applies to all vehicles at ${fixtureView.rooftopLabel}.`)).toBeInTheDocument();
    expect(screen.getByText("Draft pending")).toBeInTheDocument();
    expect(screen.getByText("Do-not-drive recall follows a separate blocking policy.")).toBeInTheDocument();

    const expected = derivePublishingMatrix({ settings: fixtureView.settings, description: fixtureView.description });
    const table = screen.getByRole("table", { name: "Effective publishing policy by vehicle type" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);
    expected.forEach((r, i) => {
      expect(within(rows[i]).getByRole("button", { name: r.label })).toBeInTheDocument();
      expect(within(rows[i]).getByText(r.listingVisibility.label)).toBeInTheDocument();
      expect(within(rows[i]).getByText(r.documentPublication.label)).toBeInTheDocument();
      expect(within(rows[i]).getByText(r.retailReadiness.label)).toBeInTheDocument();
      expect(within(rows[i]).getByText(r.overrides.label)).toBeInTheDocument();
    });
    expect(rows[1]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("Effective rule for Used")).toBeInTheDocument();
    expect(screen.getByText("Listing can be visible")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Review approval rules/ })).toHaveAttribute("href", expect.stringContaining("approval-rules"));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(spies.from).not.toHaveBeenCalled();
    expect(spies.rpc).not.toHaveBeenCalled();
    expect(spies.insert).not.toHaveBeenCalled();
    expect(spies.update).not.toHaveBeenCalled();
    expect(spies.updateSettings).not.toHaveBeenCalled();
  });

  it("switches the detail panel to the clicked class", () => {
    renderView(true);
    fireEvent.click(screen.getByRole("button", { name: "New" }));
    expect(screen.getByText("Effective rule for New")).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "Effective publishing policy by vehicle type" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows[0]).toHaveAttribute("aria-selected", "true");
    expect(rows[1]).toHaveAttribute("aria-selected", "false");
  });

  it("opens Review & Apply only on an explicit click and never applies from a fixture", () => {
    renderView(true);
    fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Review publishing policy change")).toBeInTheDocument();
    const switches = within(dialog).getAllByRole("switch");
    expect(switches).toHaveLength(6);
    switches.forEach((s) => expect(s).toBeDisabled());
    fireEvent.click(within(dialog).getByRole("button", { name: "Continue to review" }));
    expect(within(dialog).getByText("Nothing has changed. The policy in force is shown as the current state.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Apply policy" })).toBeDisabled();
    expect(spies.updateSettings).not.toHaveBeenCalled();
    expect(spies.insert).not.toHaveBeenCalled();
  });

  it("shows Unknown for counts and descriptions when the live reads fail, and reads only", async () => {
    spies.readFails.value = true;
    renderView(false);
    expect(await screen.findByText("Some policy inputs could not be read")).toBeInTheDocument();
    expect(screen.getByText("Active Unavailable · Published Unavailable")).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "Effective publishing policy by vehicle type" });
    expect(within(table).getAllByText(/\(descriptions unknown\)/)).toHaveLength(3);
    expect(screen.getByText("Enforced policy · no pending changes")).toBeInTheDocument();

    const tables = spies.from.mock.calls.map((c) => c[0]);
    expect(new Set(tables)).toEqual(new Set(["description_settings", "vehicle_listings"]));
    expect(spies.rpc).not.toHaveBeenCalled();
    expect(spies.insert).not.toHaveBeenCalled();
    expect(spies.update).not.toHaveBeenCalled();
    expect(spies.updateSettings).not.toHaveBeenCalled();
  });
});
