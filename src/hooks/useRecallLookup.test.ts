import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke } } }));

import { useRecallLookup, type RecallResult } from "./useRecallLookup";

const RESULT: RecallResult = {
  recalls: [],
  hasOpenRecall: true,
  hasStopSale: false,
  hasTakata: false,
  lastChecked: "2026-06-28T00:00:00Z",
};

const INPUT = { vin: "1HGCM82633A123456", make: "Honda", model: "Accord", year: "2024" };

beforeEach(() => invoke.mockReset());

describe("useRecallLookup.lookup", () => {
  it("invokes the nhtsa-recall function and returns the result", async () => {
    invoke.mockResolvedValue({ data: RESULT, error: null });
    const { result } = renderHook(() => useRecallLookup());
    let out: RecallResult | null = null;
    await act(async () => { out = await result.current.lookup(INPUT); });
    expect(out).toEqual(RESULT);
    expect(invoke).toHaveBeenCalledWith("nhtsa-recall", { body: INPUT });
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("serves a repeat identical lookup from the 24h cache (no second invoke)", async () => {
    invoke.mockResolvedValue({ data: RESULT, error: null });
    const { result } = renderHook(() => useRecallLookup());
    let first: RecallResult | null = null;
    let second: RecallResult | null = null;
    await act(async () => { first = await result.current.lookup(INPUT); });
    await act(async () => { second = await result.current.lookup(INPUT); });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it("re-invokes for a different vehicle (distinct cache key)", async () => {
    invoke.mockResolvedValue({ data: RESULT, error: null });
    const { result } = renderHook(() => useRecallLookup());
    await act(async () => { await result.current.lookup(INPUT); });
    await act(async () => { await result.current.lookup({ ...INPUT, model: "Civic" }); });
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("returns null and surfaces the error when the function reports one", async () => {
    invoke.mockResolvedValue({ data: null, error: { message: "NHTSA upstream 503" } });
    const { result } = renderHook(() => useRecallLookup());
    let out: RecallResult | null = RESULT;
    await act(async () => { out = await result.current.lookup(INPUT); });
    expect(out).toBeNull();
    expect(result.current.error).toBe("NHTSA upstream 503");
  });

  it("returns null and records the message when the call throws", async () => {
    invoke.mockImplementationOnce(async () => { throw new Error("network down"); });
    const { result } = renderHook(() => useRecallLookup());
    let out: RecallResult | null = RESULT;
    await act(async () => { out = await result.current.lookup(INPUT); });
    expect(out).toBeNull();
    expect(result.current.error).toBe("network down");
  });

  it("queries MarketCheck first when a tenant is known and maps its Normalized shape", async () => {
    invoke.mockResolvedValueOnce({
      data: {
        recalls: [
          { nhtsaCampaignNumber: "22V-500", status: "open", title: "Airbag inflator", description: "Takata inflator may rupture", component: "AIR BAGS", remedy: "Replace inflator", manufacturer: "Honda", reportDate: "2022-07-01" },
          { nhtsaCampaignNumber: "18V-900", status: "closed", title: "Old campaign", component: "OTHER" },
        ],
        recallStatus: "open_recalls", openRecallCount: 1, checkedAt: "2026-07-21T00:00:00Z",
      },
      error: null,
    });
    const { result } = renderHook(() => useRecallLookup());
    let out: RecallResult | null = null;
    await act(async () => { out = await result.current.lookup({ ...INPUT, tenantId: "t-1" }); });
    expect(invoke).toHaveBeenCalledWith("marketcheck-recalls", { body: { vin: INPUT.vin, tenant_id: "t-1" } });
    // Closed campaign dropped; open one mapped with Takata flagged.
    expect(out!.recalls).toHaveLength(1);
    expect(out!.recalls[0].campaignNumber).toBe("22V-500");
    expect(out!.recalls[0].summary).toBe("Airbag inflator");
    expect(out!.hasOpenRecall).toBe(true);
    expect(out!.hasTakata).toBe(true);
  });

  it("falls back to NHTSA when MarketCheck cannot answer (no recalls array)", async () => {
    invoke
      .mockResolvedValueOnce({ data: { recallStatus: "error", note: "no_authoritative_source" }, error: null })
      .mockResolvedValueOnce({ data: RESULT, error: null });
    const { result } = renderHook(() => useRecallLookup());
    let out: RecallResult | null = null;
    await act(async () => { out = await result.current.lookup({ ...INPUT, tenantId: "t-1" }); });
    expect(invoke).toHaveBeenNthCalledWith(1, "marketcheck-recalls", { body: { vin: INPUT.vin, tenant_id: "t-1" } });
    expect(invoke).toHaveBeenNthCalledWith(2, "nhtsa-recall", { body: { vin: INPUT.vin, make: INPUT.make, model: INPUT.model, year: INPUT.year } });
    expect(out).toEqual(RESULT);
  });
});
