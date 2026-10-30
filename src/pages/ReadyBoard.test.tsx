// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// F26 / F18: counts and empty copy describe the selected view, and nothing
// reads as zero or "all clear" before the board has actually loaded.

const state = vi.hoisted(() => ({ listings: [] as unknown[], failList: false, hold: null as null | Promise<void> }));

vi.mock("@/integrations/supabase/client", () => {
  const chain = (table: string) => {
    const result = async () => {
      if (state.hold) await state.hold;
      if (table === "vehicle_listings") {
        return state.failList ? { data: null, error: { message: "boom" } } : { data: state.listings, error: null };
      }
      return { data: [], error: null };
    };
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "neq", "order", "limit", "in", "is", "not"]) q[m] = () => q;
    q.maybeSingle = result;
    q.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => result().then(res, rej);
    return q;
  };
  return { supabase: { from: chain, rpc: async () => ({ data: null, error: null }), functions: { invoke: async () => ({ data: null }) } } };
});
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: { id: "t1" } }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ isAdmin: false }) }));
vi.mock("@/hooks/useEntitlements", () => ({ useEntitlements: () => ({ member: { role: "used_car_manager" } }) }));
vi.mock("@/components/workflow/NextStepBanner", () => ({ default: () => null }));

import ReadyBoard from "./ReadyBoard";

afterEach(() => {
  cleanup();
  state.listings = [];
  state.failList = false;
  state.hold = null;
});

const mount = (url = "/ready-board") =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <ReadyBoard />
    </MemoryRouter>,
  );

describe("Ready Board selected-view context", () => {
  it("shows Unknown, not zero, while the board is loading", async () => {
    let release!: () => void;
    state.hold = new Promise<void>((r) => { release = r; });
    mount();
    expect(screen.queryByText("0")).toBeNull();
    expect(screen.getAllByRole("status", { name: "Loading" }).length).toBeGreaterThan(0);
    release();
    await waitFor(() => expect(screen.queryByRole("status", { name: "Loading" })).toBeNull());
  });

  it("an empty selected view names the view and does not claim the pipeline is clear", async () => {
    state.listings = [{ id: "v1", vin: "1HGCM82633A004352", ymm: "2020 Honda Accord", condition: "used", status: "active", recall_check: null, orchestrated_at: null, deal_processed_at: null }];
    mount("/ready-board?view=ready");
    expect(await screen.findByText(/No vehicles have cleared every station in this view/)).toBeTruthy();
    expect(screen.getByText(/does not say the rest of the pipeline is clear/)).toBeTruthy();
    expect(screen.getByText(/1 vehicle is on the board in total/)).toBeTruthy();
  });

  it("a failed read is an error with retry, never an empty board", async () => {
    state.failList = true;
    mount();
    expect(await screen.findByText("The board could not be loaded.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
    expect(screen.queryByText(/No vehicles/)).toBeNull();
  });
});
