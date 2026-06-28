import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

const { order, single } = vi.hoisted(() => ({ order: vi.fn(), single: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({ order }),                       // load
      insert: () => ({ select: () => ({ single }) }),  // receiveTradeIn
    }),
  },
}));

import { useTradeInLifecycle, type TradeInRecord } from "./useTradeInLifecycle";

const row = (over: Record<string, unknown> = {}) => ({
  id: "1", trade_vin: "TV1", trade_ymm: "2020 Honda Accord", trade_mileage: 30000,
  trade_value: "15000", customer_name: "Sam", deal_vin: "DV1", deal_ymm: "2024 Pilot",
  received_at: "2026-06-10", status: "received", vehicle_file_id: null, notes: null, ...over,
});

const ROWS = [
  row({ id: "1", status: "received", vehicle_file_id: null, notes: null }),
  row({ id: "2", status: "inspected", vehicle_file_id: "vf2", notes: "clean" }),
  row({ id: "3", status: "sold" }),
];

const mount = async () => {
  order.mockResolvedValue({ data: ROWS });
  const { result } = renderHook(() => useTradeInLifecycle());
  await waitFor(() => expect(result.current.records).toHaveLength(ROWS.length));
  return result;
};

beforeEach(() => { order.mockReset(); single.mockReset(); });

describe("useTradeInLifecycle — row mapping", () => {
  it("maps snake_case columns to camelCase with coercions", async () => {
    const r = await mount();
    const rec = r.current.records.find((x) => x.id === "1")!;
    expect(rec.tradeVin).toBe("TV1");
    expect(rec.tradeYmm).toBe("2020 Honda Accord");
    expect(rec.tradeValue).toBe(15000);          // string -> Number
    expect(typeof rec.tradeValue).toBe("number");
    expect(rec.notes).toBe("");                   // null -> ""
    expect(rec.vehicleFileId).toBeUndefined();    // null -> undefined
  });

  it("carries through an assigned vehicle file id and notes", async () => {
    const r = await mount();
    const rec = r.current.records.find((x) => x.id === "2")!;
    expect(rec.vehicleFileId).toBe("vf2");
    expect(rec.notes).toBe("clean");
  });
});

describe("useTradeInLifecycle — getPending", () => {
  it("returns only received and inspected trades", async () => {
    const r = await mount();
    expect(r.current.getPending().map((x) => x.id).sort()).toEqual(["1", "2"]);
  });
});

describe("useTradeInLifecycle — receiveTradeIn", () => {
  const input = {
    tradeVin: "TVX", tradeYmm: "2019 Civic", tradeMileage: 50000, tradeValue: 9000,
    customerName: "Pat", dealVin: "DVX", dealYmm: "2024 CRV",
  };

  it("returns the mapped record on a successful insert", async () => {
    const r = await mount();
    single.mockResolvedValue({ data: row({ id: "99", trade_vin: "TVX", trade_value: "9000", status: "received" }), error: null });
    const holder: { v: TradeInRecord | null } = { v: null };
    await act(async () => { holder.v = await r.current.receiveTradeIn(input); });
    expect(holder.v?.id).toBe("99");
    expect(holder.v?.tradeVin).toBe("TVX");
    expect(holder.v?.tradeValue).toBe(9000);
  });

  it("returns null when the insert errors", async () => {
    const r = await mount();
    single.mockResolvedValue({ data: null, error: { message: "constraint" } });
    let out: unknown = "x";
    await act(async () => { out = await r.current.receiveTradeIn(input); });
    expect(out).toBeNull();
  });
});
