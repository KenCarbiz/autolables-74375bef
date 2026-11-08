import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { DEFAULT_SETTINGS } from "@/contexts/DealerSettingsContext";
import PassportModulesView from "./PassportModulesView";
import CallsToActionView from "./CallsToActionView";

const h = vi.hoisted(() => ({ update: vi.fn(async (_p: Record<string, unknown>) => true) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: vi.fn(async () => ({ data: [], error: null })), from: vi.fn(() => ({ select: vi.fn(async () => ({ data: [], error: null })) })) } }));
vi.mock("@/contexts/DealerSettingsContext", async (orig) => {
  const m = await orig<typeof import("@/contexts/DealerSettingsContext")>();
  return { ...m, useDealerSettings: () => ({ settings: m.DEFAULT_SETTINGS, updateSettings: h.update, loading: false, reload: vi.fn(), tenantId: "t1", loadGeneration: 1, serverLoaded: true, loadError: null }) };
});
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: { id: "t1", name: "Example" }, stores: [], currentStore: null }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ isAdmin: true }) }));
vi.mock("@/hooks/useEntitlements", () => ({ useEntitlements: () => ({ member: { role: "owner" } }) }));

const apply = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Review changes" }));
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Apply changes" }));
  await waitFor(() => expect(h.update).toHaveBeenCalledTimes(1));
  return h.update.mock.calls[0][0];
};

describe("apply calls the settings writer with the existing keys", () => {
  it("modules write packet_module_defaults with false for off", async () => {
    expect(DEFAULT_SETTINGS.packet_module_defaults).toEqual({});
    render(<MemoryRouter><PassportModulesView /></MemoryRouter>);
    fireEvent.click(screen.getByRole("switch", { name: "Videos" }));
    const patch = await apply();
    expect(patch).toEqual({ packet_module_defaults: { videos: false } });
  });
  it("ctas write sticky_bottom_buttons with one primary", async () => {
    h.update.mockClear();
    render(<MemoryRouter><CallsToActionView /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: "Make primary: Call" }));
    const patch = await apply();
    expect(Object.keys(patch)).toEqual(["sticky_bottom_buttons"]);
    expect((patch.sticky_bottom_buttons as { primary_key: string }).primary_key).toBe("call");
  });
});
