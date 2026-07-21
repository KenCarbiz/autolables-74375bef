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

// The always-in-DOM print document (hidden print:block) duplicates report text.
// A real browser display:none-hides it, but jsdom can't compute CSS, so text
// queries must skip the print subtree to assert on the on-screen report.
const PRINT_IGNORE = "script, style, [data-print-doc], [data-print-doc] *";

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
    expect(screen.getByText(/6 checks verified · 1 needs confirmation · 1 pending/, { ignore: PRINT_IGNORE })).toBeInTheDocument();
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
    expect(screen.getByText(/conflicting recall information across available sources/, { ignore: PRINT_IGNORE })).toBeInTheDocument();
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
    expect(screen.queryByText("Campaign number", { ignore: PRINT_IGNORE })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /View recall details/ }));
    expect(screen.getByText("Campaign number", { ignore: PRINT_IGNORE })).toBeInTheDocument();
    expect(screen.getByText("25V-118", { ignore: PRINT_IGNORE })).toBeInTheDocument();
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

// ── Evidence-card interaction repair (desktop "What checked out" grid) ─────────
describe("VehiclePassportVerification — verified evidence cards", () => {
  beforeEach(() => { fixture = reviewListing(); navigateSpy.mockClear(); });

  const verifiedRegion = () => screen.getByText("What checked out").closest("section") as HTMLElement;
  const viewTriggers = (region: HTMLElement) => within(region).getAllByRole("button", { name: /View evidence/ });

  it("renders every verified card closed by default", () => {
    renderReport();
    const region = verifiedRegion();
    const triggers = viewTriggers(region);
    expect(triggers.length).toBeGreaterThan(1);
    triggers.forEach((b) => expect(b).toHaveAttribute("aria-expanded", "false"));
    expect(region.querySelector('[data-expanded="true"]')).toBeNull();
    // Expanded-only affordances are absent until a card opens.
    expect(within(region).queryByText("Customer result")).not.toBeInTheDocument();
    expect(within(region).queryByRole("region")).not.toBeInTheDocument();
  });

  it("opens the selected card as a full-row panel and toggles aria correctly", () => {
    renderReport();
    const region = verifiedRegion();
    const trigger = viewTriggers(region)[0];
    fireEvent.click(trigger);
    const hide = within(region).getByRole("button", { name: /Hide evidence/ });
    expect(hide).toHaveAttribute("aria-expanded", "true");
    const openCard = region.querySelector('[data-expanded="true"]') as HTMLElement;
    expect(openCard).not.toBeNull();
    // Spans the full grid row rather than staying a skinny column.
    expect(openCard.className).toContain("md:col-span-2");
    // Customer result leads; a real region panel is wired to the trigger.
    expect(within(openCard).getByText("Customer result")).toBeInTheDocument();
    const panel = document.getElementById(hide.getAttribute("aria-controls") as string) as HTMLElement;
    expect(panel).toHaveAttribute("role", "region");
    expect(panel).toHaveAttribute("aria-labelledby", hide.getAttribute("id"));
  });

  it("keeps only one card open at a time", () => {
    renderReport();
    const region = verifiedRegion();
    fireEvent.click(viewTriggers(region)[0]);
    expect(region.querySelectorAll('[data-expanded="true"]')).toHaveLength(1);
    // A fresh trigger now belongs to a different (still-closed) card.
    fireEvent.click(viewTriggers(region)[0]);
    expect(region.querySelectorAll('[data-expanded="true"]')).toHaveLength(1);
  });

  it("closes the open card via Hide evidence", () => {
    renderReport();
    const region = verifiedRegion();
    fireEvent.click(viewTriggers(region)[0]);
    fireEvent.click(within(region).getByRole("button", { name: /Hide evidence/ }));
    expect(region.querySelector('[data-expanded="true"]')).toBeNull();
    expect(within(region).queryByText("Customer result")).not.toBeInTheDocument();
  });

  it("renders canonical evidence as a key/value table when open", () => {
    renderReport();
    const region = verifiedRegion();
    const vinCard = within(region).getByText("VIN and vehicle identity").closest("article") as HTMLElement;
    fireEvent.click(within(vinCard).getByRole("button", { name: /View evidence/ }));
    const openCard = region.querySelector('[data-expanded="true"]') as HTMLElement;
    const dl = openCard.querySelector("dl") as HTMLElement;
    expect(dl).not.toBeNull();
    expect(dl.querySelectorAll("dt").length).toBeGreaterThan(0);
    expect(dl.querySelectorAll("dd").length).toBe(dl.querySelectorAll("dt").length);
    // Real provenance strip, not fabricated.
    expect(within(openCard).getByText(/Verified against/)).toBeInTheDocument();
  });

  it("keeps the source family visible on the closed card", () => {
    renderReport();
    const region = verifiedRegion();
    const vinCard = within(region).getByText("VIN and vehicle identity").closest("article") as HTMLElement;
    // Source is always shown; the checked date is governed — it renders only when
    // the check actually carries one, never fabricated.
    expect(within(vinCard).getByText("OEM / VIN decode")).toBeInTheDocument();
  });

  it("never renders a pending or unavailable check as a verified card", () => {
    renderReport();
    const region = verifiedRegion();
    // Title is pending in this fixture — it must not appear in "What checked out".
    expect(within(region).queryByText("Title and brand")).not.toBeInTheDocument();
    within(region).getAllByRole("article").forEach((card) =>
      expect(card).toHaveAttribute("data-status", "verified"));
  });
});
