import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, renderHook, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useLatestAddendum } from "./useLatestAddendum";
import { useVehicleEvidence } from "./useVehicleEvidence";
import AddendumSection from "@/components/vehicleFile/AddendumSection";
import type { VehicleRow } from "@/components/vehicleFile/types";

const state = vi.hoisted(() => ({ selects: [] as string[], acceptanceUnavailable: false }));
const row = vi.hoisted(() => ({
  id: "test-addendum", created_at: "2026-11-01T12:00:00Z", updated_at: "2026-11-01T12:00:00Z",
  status: "signed", customer_signed_at: "2026-11-01T13:00:00Z", signing_token: "test-token",
  total_with_optional: 1250, customer_name: null, cobuyer_name: null, content_hash: "test-hash",
  products_snapshot: [], accepted_at: null, getready_dispatched_at: null,
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ isAdmin: false }) }));
vi.mock("@/hooks/useEntitlements", () => ({ useEntitlements: () => ({ member: { role: "sales" } }) }));
vi.mock("@/hooks/useGetReady", () => ({ deriveGetReadyDispatch: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      let selected = "";
      const result = (single = false) => {
        const invalid = selected.split(",").map((s) => s.trim()).find((key) => !(key in row));
        if (table === "addendums") {
          if (invalid || (state.acceptanceUnavailable && selected.includes("accepted_at"))) {
            return { data: null, error: { code: "42703" } };
          }
          return { data: single ? row : [row], error: null };
        }
        return { data: single ? null : [], error: null };
      };
      const chain = {
        select: (columns: string) => { selected = columns; if (table === "addendums") state.selects.push(columns); return chain; },
        eq: () => chain, order: () => chain, limit: () => chain,
        maybeSingle: () => Promise.resolve(result(true)),
        then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve),
      };
      return chain;
    },
  },
}));

beforeEach(() => { cleanup(); state.selects = []; state.acceptanceUnavailable = false; });

describe("addendum readers against the hosted column contract", () => {
  it("loads the latest packet with its stored optional-inclusive total and customer signature", async () => {
    const { result } = renderHook(() => useLatestAddendum("TESTVIN"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.addendum).toMatchObject({ id: row.id, totalPrice: 1250, signedAt: row.customer_signed_at });
  });

  it("retains both packet creation and signing evidence", async () => {
    const { result } = renderHook(() => useVehicleEvidence("test-vehicle", "TESTVIN"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.events.map((event) => event.id).sort()).toEqual(["add-test-addendum", "add-test-addendum-signed"]);
    expect(result.current.events.find((event) => event.id.endsWith("-signed"))?.at).toBe(row.customer_signed_at);
  });

  it.each([false, true])("loads Vehicle File rows with acceptance fallback = %s", async (fallback) => {
    state.acceptanceUnavailable = fallback;
    const view = render(<MemoryRouter><AddendumSection vehicle={{ id: "test-vehicle", vin: "TESTVIN" } as VehicleRow} /></MemoryRouter>);
    await waitFor(() => expect(view.getAllByRole("button", { name: "Open" })).toHaveLength(1));
    expect(state.selects).toHaveLength(fallback ? 2 : 1);
    for (const select of state.selects) {
      expect(select.split(",").every((column) => column.trim() in row)).toBe(true);
    }
  });
});