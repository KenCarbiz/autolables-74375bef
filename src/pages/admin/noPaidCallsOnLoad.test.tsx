import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Suspense } from "react";
import { act, waitFor } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { renderAdmin } from "@/test/adminRender";
import { functionCalls, resetSupabaseSpy } from "@/test/mocks/supabaseSpy";
import { ADMIN_VIEWS } from "./views";
import { ADMIN_CHILD_ROUTE_ELEMENTS } from "./childRoutes";
import { adminTabHref } from "@/lib/admin/sections";

// Opening any Administration screen must not start a paid provider call, a
// mail send or any other edge function: those run only from an explicit
// button. Every V2 view and child page is mounted against live (spied) data
// as a platform administrator, so every role-gated panel renders, and the
// test fails on any edge function invocation or outbound fetch.

vi.mock("@/integrations/supabase/client", async () => {
  const m = await import("@/test/mocks/supabaseSpy");
  return { supabase: m.supabaseSpy };
});
vi.mock("sonner", () => ({ toast: Object.assign(() => {}, { info: () => {}, error: () => {}, success: () => {}, warning: () => {} }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "user-1", email: "owner@example.test" }, session: null, isAdmin: true, loading: false, signOut: () => {} }) }));
vi.mock("@/contexts/TenantContext", () => ({
  useTenant: () => ({ tenant: { id: "tenant-1", name: "Example Motors" }, currentStore: { id: "store-1", name: "Example Motors" }, stores: [{ id: "store-1", name: "Example Motors" }], loading: false, setCurrentStore: () => {} }),
}));
vi.mock("@/hooks/useEntitlements", () => ({ useEntitlements: () => ({ tenant: { id: "tenant-1" }, member: { role: "owner" }, profile: null, entitlements: [], loading: false }) }));
vi.mock("@/contexts/AuditContext", () => ({ useAudit: () => ({ log: vi.fn(), entries: [] }) }));
vi.mock("@/contexts/DealerSettingsContext", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/contexts/DealerSettingsContext")>();
  return {
    ...mod,
    useDealerSettings: () => ({ settings: { ...mod.DEFAULT_SETTINGS, dealer_name: "Example Motors" }, updateSettings: vi.fn(async () => true), reload: vi.fn(async () => {}), loading: false }),
  };
});

const fetchSpy = vi.fn(async () => new Response("{}", { status: 404 }));
const realFetch = globalThis.fetch;

beforeEach(() => {
  resetSupabaseSpy();
  fetchSpy.mockClear();
  globalThis.fetch = fetchSpy as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

const settle = async (container: HTMLElement) => {
  await waitFor(() => expect(container.textContent?.trim().length ?? 0).toBeGreaterThan(0), { timeout: 5000 });
  await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
};

describe("opening an Administration screen starts no edge function", () => {
  it.each(Object.keys(ADMIN_VIEWS))("view %s", async (id) => {
    const View = ADMIN_VIEWS[id];
    const { container } = renderAdmin(<Suspense fallback={null}><View /></Suspense>, { route: adminTabHref(id) });
    await settle(container);
    expect(functionCalls()).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  const childUrls: Record<string, string> = {
    "/admin/people/:memberId": "/admin/people/member-1",
    "/admin/pricing/fee-review": "/admin/pricing/fee-review?enabled=1&amount=925&state=CT&scope=active",
    "/admin/products/:productId/applicability": "/admin/products/product-1/applicability",
    "/admin/customer-experience/escalation": "/admin/customer-experience/escalation",
    "/admin/integrations/runs/:runId": "/admin/integrations/runs/run-1",
    "/admin/integrations/providers/:providerId": "/admin/integrations/providers/syndication",
    "/admin/integrations/jobs/:jobId": "/admin/integrations/jobs/inventory_sync",
  };
  it.each(ADMIN_CHILD_ROUTE_ELEMENTS.map((r) => r.path))("child page %s", async (path) => {
    const route = ADMIN_CHILD_ROUTE_ELEMENTS.find((r) => r.path === path)!;
    const { container } = renderAdmin(
      <Suspense fallback={null}><Routes><Route path={route.path} element={route.element} /></Routes></Suspense>,
      { route: childUrls[path] },
    );
    await settle(container);
    expect(functionCalls()).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("the recorder this rests on", () => {
  it("records an edge function invocation, so an empty list is evidence", async () => {
    const { supabaseSpy } = await import("@/test/mocks/supabaseSpy");
    await supabaseSpy.functions.invoke("vehicle-enrich", { body: { vin: "EXAMPLEVIN0000001" } });
    expect(functionCalls()).toEqual(["vehicle-enrich"]);
  });
});
