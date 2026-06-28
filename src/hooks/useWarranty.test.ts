import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const { order } = vi.hoisted(() => ({ order: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ select: () => ({ order }) }) },
}));

import { useWarranty } from "./useWarranty";

// Date helper relative to "now" so getExpiringSoon stays deterministic.
const inDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString();
};

// deno-lint-ignore no-explicit-any
const rec = (over: Record<string, unknown>): any => ({
  id: "r", store_id: "s1", status: "active", warranty_end: inDays(10), created_at: inDays(-1), ...over,
});

const mount = async (storeId: string, data: unknown[]) => {
  order.mockResolvedValue({ data });
  const { result } = renderHook(() => useWarranty(storeId));
  await waitFor(() => expect(result.current.loading).toBe(false));
  return result;
};

beforeEach(() => order.mockReset());

describe("useWarranty — store scoping", () => {
  it("filters records to the active store", async () => {
    const r = await mount("s1", [rec({ id: "a", store_id: "s1" }), rec({ id: "b", store_id: "s2" })]);
    expect(r.current.records.map((x: { id: string }) => x.id)).toEqual(["a"]);
  });

  it("returns all records when no store is set", async () => {
    const r = await mount("", [rec({ id: "a", store_id: "s1" }), rec({ id: "b", store_id: "s2" })]);
    expect(r.current.records).toHaveLength(2);
  });
});

describe("useWarranty — getExpiringSoon", () => {
  it("includes active records ending within the window (and already past)", async () => {
    const r = await mount("s1", [
      rec({ id: "soon", warranty_end: inDays(10) }),    // within 30d -> in
      rec({ id: "past", warranty_end: inDays(-5) }),    // already ended (<= cutoff) -> in
      rec({ id: "far", warranty_end: inDays(100) }),    // beyond 30d -> out
      rec({ id: "expired", status: "expired", warranty_end: inDays(10) }), // not active -> out
    ]);
    expect(r.current.getExpiringSoon(30).map((x: { id: string }) => x.id).sort()).toEqual(["past", "soon"]);
  });

  it("respects a custom window length", async () => {
    const r = await mount("s1", [
      rec({ id: "d10", warranty_end: inDays(10) }),
      rec({ id: "d40", warranty_end: inDays(40) }),
    ]);
    expect(r.current.getExpiringSoon(7).map((x: { id: string }) => x.id)).toEqual([]);
    expect(r.current.getExpiringSoon(60).map((x: { id: string }) => x.id).sort()).toEqual(["d10", "d40"]);
  });
});
