import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { HelmetProvider } from "react-helmet-async";
import type { VehicleListing } from "@/hooks/useVehicleListing";

const navigateSpy = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return { ...actual, useNavigate: () => navigateSpy };
});

// No-op analytics + telemetry so the render path is exercised without network.
vi.mock("@/lib/engagement/customerEngagement", () => ({ trackCustomerEngagement: vi.fn() }));

// Drive the page with a real raw listing pushed through the real derivation.
let fixture: VehicleListing;
vi.mock("@/hooks/usePublicListing", () => ({
  usePublicListing: () => ({ listing: fixture, loading: false, notFound: false }),
}));

import VehiclePassportVerification from "./VehiclePassportVerification";

const reviewListing = (): VehicleListing => ({
  id: "veh1", slug: "sample", vin: "5N1AL1F83VC332076", ymm: "2025 INFINITI QX50", trim: "LUXE AWD",
  mileage: 12480, condition: "used", price: 39500, market_value: 41000, market_payload: { belowMarket: 1500 },
  mc_attributes: { owner_count: 1, accident_count: 0, msrp: 45000 },
  warranty_info: { factory_months: 48, factory_miles: 60000, in_service_date: "2024-10-01" },
  recall_status: "clear", open_recall_count: 1,
  recall_check: { checked_at: "2026-07-10T00:00:00Z", has_open: true, do_not_drive: false, campaigns: [{ campaignNumber: "25V-118", component: "Rear view camera", summary: "The rearview image may fail.", remedy: "Software update." }] },
  service_records: [], dealer_snapshot: { name: "Harte INFINITI", phone: "8605551234" },
} as unknown as VehicleListing);

const renderReport = () => render(
  <HelmetProvider>
    <MemoryRouter initialEntries={["/v/sample/verification"]}>
      <Routes><Route path="/v/:slug/verification" element={<VehiclePassportVerification />} /></Routes>
    </MemoryRouter>
  </HelmetProvider>,
);

describe("VehiclePassportVerification — rendered report", () => {
  beforeEach(() => { fixture = reviewListing(); navigateSpy.mockClear(); });

  it("leads with the exception-first banner (no numeric score ring)", () => {
    renderReport();
    expect(screen.getByRole("heading", { level: 2, name: "Review one item before purchase" })).toBeInTheDocument();
    expect(screen.getByText(/6 checks verified · 1 needs confirmation · 1 pending/)).toBeInTheDocument();
    // Governance: no percent/score/grade ring anywhere.
    expect(screen.queryByText(/\d+\s*\/\s*8/)).not.toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });

  it("shows a single h1 titled the Data-Verified Report", () => {
    renderReport();
    const h1s = screen.getAllByRole("heading", { level: 1 });
    expect(h1s).toHaveLength(1);
    expect(h1s[0]).toHaveTextContent("AutoLabels Data-Verified Report");
  });

  it("surfaces the recall as NEEDS CONFIRMATION, never 'issue found' or 'verified'", () => {
    renderReport();
    expect(screen.getByRole("heading", { name: "Recall status needs confirmation" })).toBeInTheDocument();
    expect(screen.getByText(/conflicting recall information across available sources/)).toBeInTheDocument();
    expect(screen.queryByText(/issue found/i)).not.toBeInTheDocument();
  });

  it("shows the pending title as pending — never verified", () => {
    renderReport();
    expect(screen.getByRole("heading", { name: "Title and brand check pending" })).toBeInTheDocument();
  });

  it("lists verified checks under 'What checked out'", () => {
    renderReport();
    const region = screen.getByText("What checked out").closest("section") as HTMLElement;
    expect(within(region).getByText("VIN and vehicle identity")).toBeInTheDocument();
    expect(within(region).getByText("Factory warranty")).toBeInTheDocument();
    // The pending/conflict checks must NOT appear as verified cards.
    expect(within(region).queryByText("Open safety recalls")).not.toBeInTheDocument();
  });

  it("reports 5 unique data-source families in the summary rail", () => {
    renderReport();
    const summary = screen.getByText("Report summary").closest("div") as HTMLElement;
    const dataSourcesRow = within(summary).getByText("Data sources").closest("div") as HTMLElement;
    expect(dataSourcesRow).toHaveTextContent("5");
  });

  it("'View recall details' expands the recall evidence", () => {
    renderReport();
    expect(screen.queryByText("Campaign number")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /View recall details/ }));
    expect(screen.getByText("Campaign number")).toBeInTheDocument();
    expect(screen.getByText("25V-118")).toBeInTheDocument();
  });

  it("'Ask the dealer' on the recall routes to contact with warranty/recall context", () => {
    renderReport();
    const recallCard = screen.getByRole("heading", { name: "Recall status needs confirmation" }).closest("div")!.parentElement!.parentElement as HTMLElement;
    fireEvent.click(within(recallCard).getByRole("button", { name: "Ask the dealer" }));
    expect(navigateSpy).toHaveBeenCalledWith(expect.stringContaining("/v/sample/contact?topic=warranty"));
    expect(navigateSpy).toHaveBeenCalledWith(expect.stringContaining("about="));
  });

  it("the report help bubble never defaults to 'Reserve This Vehicle'", () => {
    renderReport();
    expect(screen.queryByText(/Reserve This Vehicle/i)).not.toBeInTheDocument();
    expect(screen.getByText("Questions about this report?")).toBeInTheDocument();
  });

  it("an all-verified vehicle shows the green completed banner and no exceptions", () => {
    fixture = { ...reviewListing(), condition: "new", recall_status: "clear", open_recall_count: 0,
      recall_check: { has_open: false }, mc_attributes: { owner_count: 1, accident_count: 0, carfax_clean_title: true, msrp: 45000 } } as unknown as VehicleListing;
    renderReport();
    expect(screen.getByRole("heading", { level: 2, name: "Verification checks completed" })).toBeInTheDocument();
    expect(screen.getByText(/Nothing needs your attention/)).toBeInTheDocument();
  });
});
