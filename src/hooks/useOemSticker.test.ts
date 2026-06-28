import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// vi.hoisted so the mock fns exist before the (hoisted) vi.mock factories run.
const { invoke, toastSuccess, toastError } = vi.hoisted(() => ({
  invoke: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke } },
}));
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

import { useOemSticker } from "./useOemSticker";

beforeEach(() => {
  invoke.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

const callFetch = async (args: { vin: string; tenantId?: string | null; vehicleId?: string | null }) => {
  const { result } = renderHook(() => useOemSticker());
  expect(result.current.loading).toBe(false);
  let out: string | null = null;
  await act(async () => { out = await result.current.fetchSticker(args); });
  // loading always returns to false in the finally block
  expect(result.current.loading).toBe(false);
  return out;
};

describe("useOemSticker.fetchSticker", () => {
  it("returns the URL and toasts success when the function returns ok+url", async () => {
    invoke.mockResolvedValue({ data: { ok: true, url: "https://cdn/oem/abc.pdf" }, error: null });
    const url = await callFetch({ vin: "1HGCM82633A123456", tenantId: "t1", vehicleId: "v1" });
    expect(url).toBe("https://cdn/oem/abc.pdf");
    expect(toastSuccess).toHaveBeenCalledTimes(1);
    expect(toastError).not.toHaveBeenCalled();
  });

  it("passes the vin + tenant + vehicle through to the edge function body", async () => {
    invoke.mockResolvedValue({ data: { ok: true, url: "https://cdn/x.pdf" }, error: null });
    await callFetch({ vin: "VIN123", tenantId: "t9", vehicleId: "v9" });
    expect(invoke).toHaveBeenCalledWith("oem-window-sticker", {
      body: { vin: "VIN123", tenant_id: "t9", vehicle_id: "v9" },
    });
  });

  it("nulls tenant/vehicle when not provided", async () => {
    invoke.mockResolvedValue({ data: { ok: true, url: "https://cdn/x.pdf" }, error: null });
    await callFetch({ vin: "VIN123" });
    expect(invoke).toHaveBeenCalledWith("oem-window-sticker", {
      body: { vin: "VIN123", tenant_id: null, vehicle_id: null },
    });
  });

  it("returns null and warns to deploy when the function errors", async () => {
    invoke.mockResolvedValue({ data: null, error: { message: "not found" } });
    const url = await callFetch({ vin: "VIN123" });
    expect(url).toBeNull();
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(String(toastError.mock.calls[0][0])).toMatch(/oem-window-sticker function/);
  });

  it("returns null with the provider-not-configured message", async () => {
    invoke.mockResolvedValue({ data: { ok: false, error: "not_configured" }, error: null });
    const url = await callFetch({ vin: "VIN123" });
    expect(url).toBeNull();
    expect(String(toastError.mock.calls[0][0])).toMatch(/not configured/i);
  });

  it("returns null with a generic not-found message when ok is false without a reason", async () => {
    invoke.mockResolvedValue({ data: { ok: false }, error: null });
    const url = await callFetch({ vin: "VIN123" });
    expect(url).toBeNull();
    expect(String(toastError.mock.calls[0][0])).toMatch(/No OEM window sticker/i);
  });

  it("returns null and toasts on a thrown error", async () => {
    invoke.mockRejectedValue(new Error("network down"));
    const url = await callFetch({ vin: "VIN123" });
    expect(url).toBeNull();
    expect(toastError).toHaveBeenCalledTimes(1);
  });
});
