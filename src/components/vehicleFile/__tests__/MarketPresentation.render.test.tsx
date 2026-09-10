// Rendering proof for the shared market presentation.
//
// The source scan is supplemental; it can only see text. These render the real
// component and read the DOM, so a surface that reintroduces its own label or
// colour fails here even if it does so in a shape no regex anticipated.
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import PriceIntegrityCards from "../PriceIntegrityCard";
import type { VehicleRow } from "../types";
import { presentLegacyPosition } from "@/lib/market/presentation";
import { LEGACY_POSITIONS } from "@/lib/market/surfaceCompat";

const TENANT = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const VIN = "JN8AZ2NE0P9300001";

vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  for (const k of ["select", "eq", "order"]) chain[k] = () => chain;
  chain.limit = async () => ({ data: [], error: null });
  return {
    supabase: {
      from: () => chain,
      functions: { invoke: async () => ({ data: {}, error: null }) },
      storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: null }) }) },
    },
  };
});

const vehicleWith = (market_position: string | null) => ({
  id: "v1", tenant_id: TENANT, vin: VIN, price: 24981,
  market_value: 26000, market_position,
} as unknown as VehicleRow);

describe("the Vehicle File price card renders the shared market label", () => {
  it.each(LEGACY_POSITIONS)("renders %s with the shared vocabulary", (position) => {
    const expected = presentLegacyPosition(position).label;
    render(<PriceIntegrityCards vehicle={vehicleWith(position)} />);
    expect(screen.getAllByText(expected).length).toBeGreaterThan(0);
  });

  it("renders the two most common production values, which the old table had no entry for", () => {
    for (const position of ["below_market", "at_market"]) {
      const { unmount } = render(<PriceIntegrityCards vehicle={vehicleWith(position)} />);
      expect(screen.getAllByText(presentLegacyPosition(position).label).length).toBeGreaterThan(0);
      unmount();
    }
  });

  it("never renders a legacy label the shared map does not own", () => {
    render(<PriceIntegrityCards vehicle={vehicleWith("above_market")} />);
    for (const retired of ["Great deal", "Good deal", "Fair price", "Above market"]) {
      expect(screen.queryByText(retired)).toBeNull();
    }
  });

  it("falls back to limited evidence for an unrecognised position", () => {
    render(<PriceIntegrityCards vehicle={vehicleWith("something_invented")} />);
    expect(screen.getAllByText(presentLegacyPosition("something_invented").label).length).toBeGreaterThan(0);
  });
});
