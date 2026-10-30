import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

// F01: the "house" tenant sentinel is not a uuid. Before the fix the hook put
// it into .eq("tenant_id", "house") and the page showed a raw Postgres
// "invalid input syntax for type uuid" error. It must now issue no tenant
// query for the sentinel, and keep scoping real tenants by their own id.

const { from, tenantRef } = vi.hoisted(() => ({
  from: vi.fn(),
  tenantRef: { current: { id: "house" } as { id: string } | null },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from, rpc: vi.fn(), functions: { invoke: vi.fn() } },
}));
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: tenantRef.current }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ isAdmin: true }) }));
vi.mock("@/hooks/useEntitlements", () => ({ useEntitlements: () => ({ member: { role: "owner" } }) }));

import { useDescriptionOperations } from "./useDescriptionOps";

const REAL = "7f1c9d2e-4b3a-4a6f-9d21-0b2f6a1c8e55";

const chain = () => {
  const q: Record<string, unknown> = {};
  const self = () => q;
  for (const k of ["select", "eq", "is", "in", "limit", "order", "maybeSingle"]) q[k] = vi.fn(self);
  (q as { then: unknown }).then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null, count: 0 }).then(res);
  return q;
};

beforeEach(() => {
  from.mockReset();
  from.mockImplementation(() => chain());
});

describe("useDescriptionOperations tenant boundary (F01)", () => {
  it("sends no tenant-scoped query for the house sentinel", async () => {
    tenantRef.current = { id: "house" };
    const { result } = renderHook(() => useDescriptionOperations());
    await new Promise((r) => setTimeout(r, 20));
    expect(from).not.toHaveBeenCalled();
    expect(result.current.error).toBeNull();
    expect(result.current.tenantId).toBeNull();
  });

  it("still scopes every query to a real tenant id", async () => {
    tenantRef.current = { id: REAL };
    renderHook(() => useDescriptionOperations());
    await waitFor(() => expect(from).toHaveBeenCalled());
    const eqs = from.mock.results.flatMap((r) => (r.value.eq as ReturnType<typeof vi.fn>).mock.calls);
    expect(eqs.some(([col, val]) => col === "tenant_id" && val === REAL)).toBe(true);
    expect(eqs.some(([, val]) => val === "house")).toBe(false);
  });
});
