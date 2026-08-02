import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke } } }));
vi.mock("@/lib/passportEngagement", () => ({ passportSessionId: () => "sess" }));

import { usePublicListing } from "./usePublicListing";

const wrapper = ({ children }: { children: ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

const edgeError = (status: number) => ({ data: null, error: Object.assign(new Error("edge"), { context: { status } }) });

beforeEach(() => invoke.mockReset());

describe("usePublicListing", () => {
  it("returns the listing on success", async () => {
    invoke.mockResolvedValue({ data: { listing: { id: "1", vin: "V" } }, error: null });
    const { result } = renderHook(() => usePublicListing("V"), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.listing).toEqual({ id: "1", vin: "V" });
    expect(result.current.notFound).toBe(false);
    expect(result.current.rateLimited).toBe(false);
  });

  it("treats a 404 as not found", async () => {
    invoke.mockResolvedValue(edgeError(404));
    const { result } = renderHook(() => usePublicListing("NOPE"), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.notFound).toBe(true);
    expect(result.current.rateLimited).toBe(false);
  });

  // The bug this guards: a throttled shopper was shown "sold or unpublished"
  // for a car that is on the lot and for sale.
  it("reports a 429 as rate limited, never as not found", async () => {
    invoke.mockResolvedValue(edgeError(429));
    const { result } = renderHook(() => usePublicListing("V"), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.rateLimited).toBe(true);
    expect(result.current.notFound).toBe(false);
    expect(result.current.listing).toBeNull();
  });

  it("does not retry a throttled request and add load to the limiter", async () => {
    invoke.mockResolvedValue(edgeError(429));
    const { result } = renderHook(() => usePublicListing("V"), { wrapper });
    await waitFor(() => expect(result.current.rateLimited).toBe(true));
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("reports preview mode without calling the edge function", async () => {
    const { result } = renderHook(
      () => usePublicListing("demo", { preview: true, previewData: { id: "p" } as never }),
      { wrapper },
    );
    expect(result.current.listing).toEqual({ id: "p" });
    expect(result.current.rateLimited).toBe(false);
    expect(invoke).not.toHaveBeenCalled();
  });
});
