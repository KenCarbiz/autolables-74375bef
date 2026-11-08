import { describe, it, expect, vi, afterEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderAdmin } from "@/test/adminRender";
import { spyCalls } from "@/test/mocks/supabaseSpy";
import { adminTabHref } from "@/lib/admin/sections";
import OverviewView from "@/pages/admin/views/OverviewView";
import PlanUsageView from "@/pages/admin/views/plan/PlanUsageView";
import { ADMIN_FIXTURES } from "./index";
import { WAVE_E_FIXTURES } from "./WaveEFixtures";

vi.mock("@/integrations/supabase/client", async () => {
  const m = await import("@/test/mocks/supabaseSpy");
  return { supabase: m.supabaseSpy };
});
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: { id: "tenant-1", name: "Example Motors" }, loading: false }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ isAdmin: false }) }));
vi.mock("@/hooks/useEntitlements", () => ({ useEntitlements: () => ({ member: { role: "owner" }, entitlementFor: () => null, loading: false, error: null }) }));
vi.mock("@/components/admin/v2/useAdminVisibility", () => ({ useAdminVisibility: () => ({ ctx: { role: "owner", isAdmin: false }, ready: true }) }));

vi.mock("@/contexts/DealerSettingsContext", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/contexts/DealerSettingsContext")>();
  return { ...mod, useDealerSettings: () => ({ settings: mod.DEFAULT_SETTINGS, updateSettings: async () => true, loading: false }) };
});

const fetchSpy = vi.fn(async () => new Response("{}", { status: 404 }));
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const STATES = ["default", "empty", "error", "readonly", "stale", "trial", "suspended", "unlimited"];

describe("Wave E fixtures", () => {
  it("are registered under their design ids", () => {
    expect(ADMIN_FIXTURES["v3-overview"]).toBe(WAVE_E_FIXTURES["v3-overview"]);
    expect(ADMIN_FIXTURES["v3-plan-usage"]).toBe(WAVE_E_FIXTURES["v3-plan-usage"]);
    expect(WAVE_E_FIXTURES["v3-overview"].tabId).toBe("overview");
    expect(WAVE_E_FIXTURES["v3-plan-usage"].tabId).toBe("plan-features");
  });

  it.each(STATES)("render the %s variant with no request", (state) => {
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    const a = renderAdmin(<OverviewView />, { route: `${adminTabHref("overview")}&state=${state}`, fixture: WAVE_E_FIXTURES["v3-overview"].fixture });
    expect(screen.getByRole("region", { name: "Summary" })).toBeTruthy();
    a.unmount();
    renderAdmin(<PlanUsageView />, { route: `${adminTabHref("plan-features")}&state=${state}`, fixture: WAVE_E_FIXTURES["v3-plan-usage"].fixture });
    expect(screen.getByText("Current plan")).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(spyCalls).toEqual([]);
  });

  it("holds invented data only", () => {
    const text = JSON.stringify(WAVE_E_FIXTURES, (_k, v) => (typeof v === "function" ? undefined : v));
    expect(text).not.toMatch(/https?:\/\/(?!example\.test)/);
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });
});
