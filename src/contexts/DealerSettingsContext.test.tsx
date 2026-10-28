import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

// The provider's write-safety contract: a failed read never autosaves, a
// refused write never lands in the cache or falls back to a row rewrite, and
// every load bumps the generation so forms re-baseline.

const h = vi.hoisted(() => ({
  user: { id: "user-1" } as { id: string } | null,
  tenant: { id: "tenant-a", name: "Example Motors", logo_url: "" } as { id: string; name: string; logo_url: string } | null,
  rows: {} as Record<string, { data: unknown; error: { message: string } | null }>,
  rpc: vi.fn(async (..._args: unknown[]): Promise<{ error: { message: string } | null }> => ({ error: null })),
  upsert: vi.fn(async (..._args: unknown[]) => ({ error: null })),
  toastError: vi.fn(),
}));

vi.mock("sonner", () => ({ toast: Object.assign(() => {}, { info: () => {}, error: h.toastError, success: () => {} }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: h.user }) }));
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: h.tenant, stores: [], currentStore: null }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => h.rows[table] ?? { data: null, error: null },
        upsert: (...args: unknown[]) => h.upsert(...args),
      };
      return chain;
    },
    rpc: (...args: unknown[]) => h.rpc(...args),
  },
}));

import { DealerSettingsProvider, useDealerSettings } from "./DealerSettingsContext";

const Probe = () => {
  const ctx = useDealerSettings();
  return (
    <div>
      <output data-testid="name">{ctx.settings.dealer_name}</output>
      <output data-testid="state">
        {JSON.stringify({ loading: ctx.loading, gen: ctx.loadGeneration, serverLoaded: ctx.serverLoaded, loadError: ctx.loadError, lastSaveError: ctx.lastSaveError, tenantId: ctx.tenantId })}
      </output>
      <button type="button" onClick={() => void ctx.updateSettings({ dealer_name: "Example Motors Renamed" })}>save</button>
    </div>
  );
};

const state = () => JSON.parse(screen.getByTestId("state").textContent || "{}") as { loading: boolean; gen: number; serverLoaded: boolean; loadError: string | null; lastSaveError: string | null; tenantId: string | null };
const cacheFor = (tenantId: string) => JSON.parse(localStorage.getItem(`autolabels.dealer_settings.v2:${tenantId}`) || "null") as Record<string, unknown> | null;

describe("DealerSettingsProvider", () => {
  beforeEach(() => {
    localStorage.clear();
    h.user = { id: "user-1" };
    h.tenant = { id: "tenant-a", name: "Example Motors", logo_url: "" };
    h.rows = { dealer_profiles: { data: { settings: { dealer_name: "Example Motors Saved" } }, error: null } };
    h.rpc.mockClear();
    h.rpc.mockResolvedValue({ error: null });
    h.upsert.mockClear();
    h.toastError.mockClear();
  });

  it("reads the server row, marks it loaded and bumps the generation once", async () => {
    render(<DealerSettingsProvider><Probe /></DealerSettingsProvider>);
    await waitFor(() => expect(state().loading).toBe(false));
    expect(screen.getByTestId("name").textContent).toBe("Example Motors Saved");
    expect(state()).toMatchObject({ gen: 1, serverLoaded: true, loadError: null, tenantId: "tenant-a" });
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.upsert).not.toHaveBeenCalled();
  });

  it("never writes anything when the read fails", async () => {
    h.rows = { dealer_profiles: { data: null, error: { message: "permission denied for table dealer_profiles" } } };
    render(<DealerSettingsProvider><Probe /></DealerSettingsProvider>);
    await waitFor(() => expect(state().loading).toBe(false));
    expect(state()).toMatchObject({ gen: 1, serverLoaded: false, loadError: "permission denied for table dealer_profiles" });
    expect(screen.getByTestId("name").textContent).toBe("Example Motors");
    expect(h.rpc).not.toHaveBeenCalled();
    expect(h.upsert).not.toHaveBeenCalled();
    expect(cacheFor("tenant-a")).toBeNull();
  });

  it("writes through merge_dealer_settings only and caches after the server accepted", async () => {
    render(<DealerSettingsProvider><Probe /></DealerSettingsProvider>);
    await waitFor(() => expect(state().loading).toBe(false));
    await act(async () => { fireEvent.click(screen.getByText("save")); });
    await waitFor(() => expect(h.rpc).toHaveBeenCalledTimes(1));
    expect(h.rpc).toHaveBeenCalledWith("merge_dealer_settings", { _tenant_id: "tenant-a", _patch: { dealer_name: "Example Motors Renamed" } });
    expect(h.upsert).not.toHaveBeenCalled();
    await waitFor(() => expect(cacheFor("tenant-a")?.dealer_name).toBe("Example Motors Renamed"));
    expect(state().lastSaveError).toBeNull();
  });

  it("reports a refused write without a row rewrite and without caching the refused value", async () => {
    h.rpc.mockResolvedValue({ error: { message: "dealer_settings_forbidden_key" } });
    render(<DealerSettingsProvider><Probe /></DealerSettingsProvider>);
    await waitFor(() => expect(state().loading).toBe(false));
    await act(async () => { fireEvent.click(screen.getByText("save")); });
    await waitFor(() => expect(state().lastSaveError).toBe("dealer_settings_forbidden_key"));
    expect(h.upsert).not.toHaveBeenCalled();
    expect(h.toastError).toHaveBeenCalledTimes(1);
    expect(cacheFor("tenant-a")?.dealer_name).toBe("Example Motors Saved");
    expect(screen.getByTestId("name").textContent).toBe("Example Motors Renamed");
  });

  it("still falls back on a missing RPC with an error instead of a full-snapshot upsert", async () => {
    h.rpc.mockResolvedValue({ error: { message: "Could not find the function public.merge_dealer_settings in the schema cache" } });
    render(<DealerSettingsProvider><Probe /></DealerSettingsProvider>);
    await waitFor(() => expect(state().loading).toBe(false));
    await act(async () => { fireEvent.click(screen.getByText("save")); });
    await waitFor(() => expect(state().lastSaveError).toMatch(/schema cache/));
    expect(h.upsert).not.toHaveBeenCalled();
  });

  it("reloads and bumps the generation when the tenant changes", async () => {
    const view = render(<DealerSettingsProvider><Probe /></DealerSettingsProvider>);
    await waitFor(() => expect(state().gen).toBe(1));
    h.tenant = { id: "tenant-b", name: "Example Motors North", logo_url: "" };
    h.rows = { dealer_profiles: { data: { settings: { dealer_name: "Example Motors North Saved" } }, error: null } };
    view.rerender(<DealerSettingsProvider><Probe /></DealerSettingsProvider>);
    await waitFor(() => expect(state().gen).toBe(2));
    expect(state().tenantId).toBe("tenant-b");
    expect(screen.getByTestId("name").textContent).toBe("Example Motors North Saved");
  });

  it("keeps anonymous visitors on cache and defaults with nothing loaded from the server", async () => {
    h.user = null;
    h.tenant = null;
    render(<DealerSettingsProvider><Probe /></DealerSettingsProvider>);
    await waitFor(() => expect(state().loading).toBe(false));
    expect(state()).toMatchObject({ serverLoaded: false, tenantId: null, gen: 1 });
    expect(h.rpc).not.toHaveBeenCalled();
  });
});
