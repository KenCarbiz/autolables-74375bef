import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import PriceIntegrityCards from "../PriceIntegrityCard";
import type { VehicleRow } from "../types";

const TENANT = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const VIN = "JN8AZ2NE0P9300001";
const PATH = `${TENANT}/${VIN}/1750000000000.png`;

const createSignedUrl = vi.fn();
const rows = [{
  advertised_price: 24981, source_channel: "website", source_url: null,
  captured_at: "2026-09-01T12:00:00Z", screenshot_url: PATH, screenshot_bucket: "price-evidence",
}];

vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  for (const k of ["select", "eq", "order"]) chain[k] = () => chain;
  chain.limit = async () => ({ data: rows, error: null });
  return {
    supabase: {
      from: () => chain,
      storage: { from: (bucket: string) => ({ createSignedUrl: (p: string, ttl: number) => createSignedUrl(bucket, p, ttl) }) },
    },
  };
});

const vehicle = { id: "v1", tenant_id: TENANT, vin: VIN, price: 24981 } as unknown as VehicleRow;

describe("PriceIntegrityCard evidence link", () => {
  beforeEach(() => {
    createSignedUrl.mockReset();
    vi.spyOn(window, "open").mockImplementation(() => null);
  });

  it("mints a signed URL under the user's session on click, not on load", async () => {
    createSignedUrl.mockResolvedValue({ data: { signedUrl: "https://signed.example/x?token=1" }, error: null });
    render(<PriceIntegrityCards vehicle={vehicle} />);
    const button = await screen.findByRole("button", { name: "Evidence" });
    expect(createSignedUrl).not.toHaveBeenCalled();
    fireEvent.click(button);
    await waitFor(() => expect(window.open).toHaveBeenCalledWith("https://signed.example/x?token=1", "_blank", "noopener"));
    expect(createSignedUrl).toHaveBeenCalledWith("price-evidence", PATH, 600);
  });

  it("shows the unavailable state when storage refuses the mint", async () => {
    createSignedUrl.mockResolvedValue({ data: null, error: { message: "Object not found" } });
    render(<PriceIntegrityCards vehicle={vehicle} />);
    fireEvent.click(await screen.findByRole("button", { name: "Evidence" }));
    expect(await screen.findByText("Evidence unavailable")).toBeInTheDocument();
    expect(screen.queryByText("Object not found")).toBeNull();
    expect(window.open).not.toHaveBeenCalled();
  });
});
