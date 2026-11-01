import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderAdmin } from "@/test/adminRender";
import { functionCalls, resetSupabaseSpy, writeCalls } from "@/test/mocks/supabaseSpy";
import { AL97_07, AL97_08, AL97_09, AL97_21, AL97_24 } from "@/pages/admin/fixtures/al97-batch3";
import { AL97_10 } from "@/pages/admin/fixtures/al97-batch2";
import { assessConsistency } from "@/lib/admin/pricing/priceConsistency";
import { integrityQueueRow, isSchemaMismatch, summarizeIntegrity } from "@/lib/admin/pricing/integrity";
import { catalogPipelineRow, filesWorkerRow } from "@/lib/admin/integrations/pipelines";
import { deriveJobRow, JOB_CATALOG } from "@/lib/admin/integrations/jobs";
import PricingIntegrityPage from "./PricingIntegrityPage";
import VehicleFilesPage from "./VehicleFilesPage";
import JobsPipelinesPage from "./JobsPipelinesPage";
import InventoryNetworkPage from "./InventoryNetworkPage";

vi.mock("@/integrations/supabase/client", async () => {
  const m = await import("@/test/mocks/supabaseSpy");
  return { supabase: m.supabaseSpy };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, isAdmin: true, loading: false }) }));
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: null, currentStore: null }) }));
vi.mock("@/hooks/useEntitlements", () => ({ useEntitlements: () => ({ member: { role: "admin" }, loading: false }) }));
vi.mock("@/contexts/DealerSettingsContext", () => ({ useDealerSettings: () => ({ settings: { dealer_timezone: "UTC" }, loading: false }) }));

const noWrites = () => {
  expect(functionCalls()).toEqual([]);
  expect(writeCalls().filter((c) => c.kind === "table")).toEqual([]);
  expect(writeCalls().filter((c) => c.kind === "rpc" && /save|set_|approve|decide|retry|enqueue|resolve|assign|associate/.test(c.fn))).toEqual([]);
};

beforeEach(() => resetSupabaseSpy());

const listing = { id: "l1", vin: "V1", year: 2024, make: "Example", model: "SUV", trim: null, stock: "S1", condition: "used", heroImageUrl: null, price: 30000, advertisedBeforeDoc: 29105, docFee: 895, websiteSalePrice: 30000, parseStatus: "ok", verifiedAt: "2026-10-31T18:00:00Z", vehicleFileId: null };

describe("AL97 pricing integrity", () => {
  it("shows a failed read as Unknown, names the schema mismatch and marks nothing verified", () => {
    renderAdmin(<PricingIntegrityPage />, { route: "/admin/pricing/integrity", fixture: AL97_07.fixture });
    expect(screen.getByRole("heading", { level: 1, name: "Pricing integrity" })).toBeInTheDocument();
    expect(screen.getByText("Price consistency could not be checked")).toBeInTheDocument();
    expect(screen.getByText("Unknown")).toBeInTheDocument();
    expect(screen.getByText("Mismatch")).toHaveClass("red");
    expect(screen.queryByText("Confirmed")).toBeNull();
    expect(document.querySelectorAll(".chip.green")).toHaveLength(0);
    noWrites();
  });

  it("derives the ready preview from the locked fee arithmetic and keeps unverified rows off green", () => {
    renderAdmin(<PricingIntegrityPage />, { route: "/admin/pricing/integrity", fixture: AL97_21.fixture });
    expect(screen.getByText("$29,105")).toBeInTheDocument();
    expect(screen.getByText("$895")).toBeInTheDocument();
    expect(screen.getByText("$30,000")).toBeInTheDocument();
    const stats = screen.getByRole("list", { name: "Pricing integrity summary" });
    expect(within(stats).getByText("18")).toBeInTheDocument();
    expect(within(stats).getByText("6")).toBeInTheDocument();
    const missing = screen.getByText("DEMO02").closest("tr")!;
    expect(within(missing).getByText("Missing")).toHaveClass("amber");
    expect(within(missing).getByText("Unknown")).toHaveClass("amber");
    noWrites();
  });

  it("counts a vehicle verified only with a same-version observation that agrees", () => {
    const ok = assessConsistency(listing, { price: 30000, capturedAt: "2026-10-31T19:00:00Z", sourceUrl: null, channel: "website" }, 895, "website_sale_price");
    const none = assessConsistency(listing, null, 895, "website_sale_price");
    const off = assessConsistency(listing, { price: 30500, capturedAt: "2026-10-31T19:00:00Z", sourceUrl: null, channel: "website" }, 895, "website_sale_price");
    expect(summarizeIntegrity([ok, none, off])).toMatchObject({ checked: 3, verified: 1, needsEvidence: 2, observed: 2, breakdownConflicts: 0 });
    expect(integrityQueueRow(none).fee.tone).toBe("amber");
    expect(integrityQueueRow(off).arithmetic).toEqual({ label: "Conflict", tone: "red" });
    expect(isSchemaMismatch("column vehicle_listings.year does not exist")).toBe(true);
    expect(isSchemaMismatch("permission denied")).toBe(false);
  });
});

describe("AL97 vehicle files", () => {
  it("lists unassigned files read-only and offers no association action", () => {
    renderAdmin(<VehicleFilesPage />, { route: "/admin/integrations/vehicle-files", fixture: AL97_08.fixture });
    expect(screen.getByText("330 legacy files need a store association review")).toBeInTheDocument();
    const row = screen.getByText("VF-DEMO-001").closest("tr")!;
    expect(within(row).getByRole("link", { name: "Inspect" })).toHaveAttribute("href", "/vehicle-file/DEMO-001");
    expect(screen.getByRole("link", { name: "Review legacy associations" })).toHaveAttribute("href", "/admin?tab=vehicle-files");
    expect(screen.queryByRole("button", { name: /assign/i })).toBeNull();
    noWrites();
  });

  it("shows the associated state with provider re-pulls Unknown when no ledger was read", () => {
    renderAdmin(<VehicleFilesPage />, { route: "/admin/integrations/vehicle-files", fixture: AL97_24.fixture });
    expect(screen.getByRole("heading", { level: 1, name: "Vehicle files / associated" })).toBeInTheDocument();
    expect(screen.getByText("Original record preserved")).toBeInTheDocument();
    const fx = AL97_24.fixture.views["vehicle-files"] as Record<string, unknown>;
    renderAdmin(<VehicleFilesPage />, { route: "/admin/integrations/vehicle-files", fixture: { ...AL97_24.fixture, views: { "vehicle-files": { ...fx, providerRepulls: null } } } });
    expect(screen.getAllByText("Unknown").length).toBeGreaterThan(0);
    noWrites();
  });
});

describe("AL97 jobs and pipelines", () => {
  it("separates delivery from work and keeps paused jobs paused", () => {
    renderAdmin(<JobsPipelinesPage />, { route: "/admin/integrations/jobs", fixture: AL97_09.fixture });
    const mc = screen.getAllByText("MarketCheck inventory")[0].closest("tr")!;
    expect(within(mc).getByText("Oct 29 · delivered")).toBeInTheDocument();
    expect(within(mc).getByText("Oct 3 · completed")).toBeInTheDocument();
    expect(within(mc).getByText("Paused", { selector: ".chip" })).toBeInTheDocument();
    expect(screen.getByText(/last business success is older than its last cron request/)).toBeInTheDocument();
    expect(screen.getByText("Manual import only")).toBeInTheDocument();
    noWrites();
  });

  it("judges a job with its own ledger by that ledger, not by a delivered request", () => {
    const spec = JOB_CATALOG.find((j) => j.id === "description_reconcile")!;
    const cron = { jobname: spec.cronName, schedule: "30 4 * * *", active: true, last_status: "succeeded", last_message: null, last_start: "2026-10-31T04:30:00Z", last_end: null };
    const row = deriveJobRow({ spec, cron, ledger: null, now: Date.parse("2026-10-31T12:00:00Z") });
    const out = catalogPipelineRow(row, cron, {}, "Description reconcile", "/x");
    expect(out.health).toEqual({ label: "Needs evidence", tone: "amber" });
    expect(out.work).toBe("Outcome ledger required");
    expect(catalogPipelineRow(row, cron, { description: null }, "Description reconcile", "/x").work).toBe("Unknown");
    expect(filesWorkerRow(null, "/f").health.label).toBe("Unknown");
  });
});

describe("AL97 provider usage and budgets", () => {
  it("shows billed cost as Unknown, never $0, and keeps the store policy read-only", () => {
    renderAdmin(<InventoryNetworkPage />, { route: "/admin/integrations/inventory-network?view=marketcheck&store=s2", fixture: AL97_10.fixture });
    const stats = screen.getByRole("list", { name: "Provider budget summary" });
    expect(within(stats).getByText("5,000")).toBeInTheDocument();
    expect(within(stats).getByText("Unknown")).toBeInTheDocument();
    expect(within(stats).queryByText(/\$0/)).toBeNull();
    expect(screen.getByRole("switch", { name: /Enrich shared inventory/ })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("heading", { name: "More inventory network views" })).toBeInTheDocument();
    noWrites();
  });
});
