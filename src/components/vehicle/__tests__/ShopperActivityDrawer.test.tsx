import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { buildShopperActivity } from "@/lib/shopperActivity";

// Drive the drawer with a real fixture pushed through buildShopperActivity,
// proving the rendering path works without any network. The hook is mocked to
// return that summary so we exercise the component tree, not supabase.
const fixture = buildShopperActivity({
  currentVin: "1FIXTURE00000001",
  viewCount: 42,
  engagement: [
    { session_id: "s1", module: "warranty", seconds: 140, first_at: "2026-07-01T10:00:00Z", last_at: "2026-07-01T10:02:20Z" },
    { session_id: "s1", module: "market-price", seconds: 60, first_at: "2026-07-01T10:02:20Z", last_at: "2026-07-01T10:03:20Z" },
    { session_id: "s2", module: "gallery", seconds: 40, first_at: "2026-07-02T09:00:00Z", last_at: "2026-07-02T09:00:40Z" },
  ],
  events: [
    { session_id: "e1", visitor_id: "v1", vin: "1FIXTURE00000001", event_type: "passport_opened", device_type: "mobile", browser: "Safari", city: "Hartford", region: "CT", occurred_at: "2026-07-01T10:00:00Z" },
    { session_id: "e1", visitor_id: "v1", vin: "1FIXTURE00000001", event_type: "lead_form_opened", device_type: "mobile", occurred_at: "2026-07-01T10:03:00Z" },
    { session_id: "e2", visitor_id: "v1", vin: "1FIXTURE00000001", event_type: "cta_clicked", device_type: "desktop", occurred_at: "2026-07-03T12:00:00Z" },
  ],
});

vi.mock("@/hooks/useShopperActivity", () => ({
  useShopperActivity: () => ({ summary: fixture, loading: false, error: null, range: "all", setRange: vi.fn(), refresh: vi.fn() }),
}));

import ShopperActivityDrawer from "../ShopperActivityDrawer";

describe("ShopperActivityDrawer", () => {
  it("renders the fixture-driven summary sections", () => {
    render(
      <ShopperActivityDrawer
        open
        onOpenChange={() => {}}
        vin="1FIXTURE00000001"
        tenantId="t1"
        vehicleId="veh1"
        viewCount={42}
        title="2024 Honda Accord"
        trim="EX-L"
        stock="H1234"
        thumbnailUrl={null}
      />,
    );
    expect(screen.getByText("Shopper Activity")).toBeTruthy();
    expect(screen.getByText("Engagement Score")).toBeTruthy();
    expect(screen.getByText("Attention by Section")).toBeTruthy();
    expect(screen.getByText("What this tells us")).toBeTruthy();
    // section label from the fixture dwell rollup
    expect(screen.getAllByText("Warranty").length).toBeGreaterThan(0);
    // returning-visitor trigger should be Active (v1 across two sessions)
    expect(screen.getAllByText("Active").length).toBeGreaterThan(0);
  });
});
