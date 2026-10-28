import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AdminFixtureProvider } from "@/lib/admin/dataSource";

// Every brand view renders from the 02 fixture without touching live data,
// and the live-mode form never writes on mount, writes only on an explicit
// Save, and refuses to save what the server never returned.

const h = vi.hoisted(() => ({
  ctx: {
    settings: {} as Record<string, unknown>,
    loading: false,
    updateSettings: vi.fn(async (_patch: Record<string, unknown>): Promise<boolean> => true),
    reload: vi.fn(),
    tenantId: "tenant-a" as string | null,
    loadGeneration: 1,
    serverLoaded: true,
    loadError: null as string | null,
    lastSaveError: null as string | null,
  },
  upload: vi.fn(async (..._args: unknown[]) => ({ url: "https://files.example.test/logo.png" })),
  invoke: vi.fn(async (..._args: unknown[]) => ({ data: { test: { price: 12345, matched_label: "Internet Price" } }, error: null })),
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("sonner", () => ({ toast: Object.assign(() => {}, { info: () => {}, error: h.toast.error, success: h.toast.success }) }));
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: { id: "tenant-a", name: "Example Auto Group" }, currentStore: null, stores: [] }) }));
vi.mock("@/contexts/DealerSettingsContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/contexts/DealerSettingsContext")>();
  return { ...actual, useDealerSettings: () => h.ctx };
});
vi.mock("@/lib/storage", () => ({ uploadPhoto: (...args: unknown[]) => h.upload(...args) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...args: unknown[]) => h.invoke(...args) } } }));
vi.mock("@/components/admin/DealershipTrustPanel", () => ({ default: () => <div>trust panel stub</div> }));

import { DEFAULT_SETTINGS } from "@/contexts/DealerSettingsContext";
import { FIXTURE_02 } from "@/pages/admin/fixtures/02";
import IdentityView from "./IdentityView";
import AppearanceView from "./AppearanceView";
import HoursContactView from "./HoursContactView";
import WhyBuyView from "./WhyBuyView";
import WebsitesFeedsView from "./WebsitesFeedsView";
import DocumentDefaultsView from "./DocumentDefaultsView";

const renderFixture = (View: () => JSX.Element) =>
  render(
    <MemoryRouter>
      <AdminFixtureProvider fixture={FIXTURE_02.fixture}>
        <View />
      </AdminFixtureProvider>
    </MemoryRouter>,
  );

const renderLive = (View: () => JSX.Element) => render(<MemoryRouter><View /></MemoryRouter>);

const reviewButton = () => screen.getByRole("button", { name: "Review changes" });
const applyButton = () => screen.getByRole("button", { name: "Apply changes" });
const reviewAndApply = async () => {
  fireEvent.click(reviewButton());
  await act(async () => { fireEvent.click(applyButton()); });
};

beforeEach(() => {
  h.ctx.settings = { ...DEFAULT_SETTINGS, dealer_name: "Example Motors", dealer_city: "Example City", dealer_state: "CT", primary_color: "" };
  h.ctx.loading = false;
  h.ctx.serverLoaded = true;
  h.ctx.loadGeneration = 1;
  h.ctx.tenantId = "tenant-a";
  h.ctx.updateSettings.mockClear();
  h.ctx.updateSettings.mockResolvedValue(true);
  h.upload.mockClear();
  h.invoke.mockClear();
  h.toast.error.mockClear();
  h.toast.success.mockClear();
});

describe("brand views render from the 02 fixture", () => {
  it("Identity shows the store identity, header preview, appearance summary and contact readiness", () => {
    renderFixture(IdentityView);
    expect(screen.getByText("Store identity")).toBeTruthy();
    expect(screen.getByLabelText("Dealership name")).toHaveProperty("value", "Example INFINITI");
    expect(screen.getByLabelText("Group")).toHaveProperty("value", "Example Auto Group");
    expect(screen.getByLabelText("State")).toHaveProperty("value", "CT");
    expect(screen.getByLabelText("Time zone")).toHaveProperty("value", "America/New_York");
    const preview = screen.getByLabelText("Application header preview");
    expect(within(preview).getByText("Example INFINITI")).toBeTruthy();
    expect(within(preview).getByText("Example City, CT")).toBeTruthy();
    expect(screen.getByText("Workspace accent")).toBeTruthy();
    expect(screen.getByText("Blue (#2457D6)")).toBeTruthy();
    const table = screen.getByRole("table", { name: "Contact readiness" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getAllByRole("cell")[2].textContent)).toEqual(["Incomplete", "Incomplete", "Ready"]);
    expect(screen.getByText("No changes pending")).toBeTruthy();
    expect(reviewButton()).toHaveProperty("disabled", true);
    expect(screen.getByText("Branding for this rooftop.")).toBeTruthy();
    expect(h.ctx.updateSettings).not.toHaveBeenCalled();
  });

  it("Appearance renders the palette, the accent editor and the reset", () => {
    renderFixture(AppearanceView);
    expect(screen.getByLabelText("Workspace accent")).toHaveProperty("value", "#2457D6");
    expect(screen.getByRole("button", { name: "Reset accent to default" })).toBeTruthy();
    expect(reviewButton()).toHaveProperty("disabled", true);
  });

  it("Hours & Contact renders hours, contact, licensing and read-only city and state", () => {
    renderFixture(HoursContactView);
    expect(screen.getByLabelText("Store hours")).toBeTruthy();
    expect(screen.getByLabelText("Main phone")).toBeTruthy();
    expect(screen.getByLabelText("City")).toHaveProperty("value", "Example City");
    expect(screen.getAllByText("Edit on Identity")).toHaveLength(2);
    expect(screen.getByLabelText("DMV dealer license number")).toBeTruthy();
    expect(screen.getByText("Dealership phone number is missing.")).toBeTruthy();
  });

  it("Why Buy renders the tagline, the marketing copy and stands in for the trust panel", () => {
    renderFixture(WhyBuyView);
    expect(screen.getByLabelText("Tagline")).toBeTruthy();
    expect(screen.getByLabelText("Why buy here")).toBeTruthy();
    expect(screen.getByLabelText("Warranty programs")).toBeTruthy();
    expect(screen.queryByText("trust panel stub")).toBeNull();
  });

  it("Websites & feeds renders the feed, marketplace, extraction and condition cards with the test disabled", () => {
    renderFixture(WebsitesFeedsView);
    expect(screen.getByLabelText("DMS provider")).toBeTruthy();
    expect(screen.getByLabelText("CarGurus")).toBeTruthy();
    expect(screen.getByLabelText("VDP price labels, priority order")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Test" })).toHaveProperty("disabled", true);
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it("Document defaults renders the generator defaults and payment toggles", () => {
    renderFixture(DocumentDefaultsView);
    expect(screen.getByLabelText("New-car addendum")).toHaveProperty("value", "standard");
    expect(screen.getByLabelText("FTC used-car warranty (Buyers Guide)")).toHaveProperty("value", "as_is");
    expect(screen.getAllByRole("switch")).toHaveLength(4);
  });
});

describe("Identity in live mode", () => {
  it("does not write on mount and keeps Save disabled while clean", () => {
    renderLive(IdentityView);
    expect(h.ctx.updateSettings).not.toHaveBeenCalled();
    expect(reviewButton()).toHaveProperty("disabled", true);
    expect(screen.getByText("No changes pending")).toBeTruthy();
  });

  it("lists the change for review and applies only the changed keys on an explicit click", async () => {
    const view = renderLive(IdentityView);
    fireEvent.change(screen.getByLabelText("Dealership name"), { target: { value: "Example Motors of Example City" } });
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    expect(screen.getByText("Preview reflects unsaved changes. Save to apply them.")).toBeTruthy();
    expect(h.ctx.updateSettings).not.toHaveBeenCalled();
    fireEvent.click(reviewButton());
    const panel = screen.getByLabelText("Changes to apply");
    expect(within(panel).getByText("Dealership name")).toBeTruthy();
    expect(within(panel).getByText("Example Motors")).toBeTruthy();
    expect(within(panel).getByText("Example Motors of Example City")).toBeTruthy();
    expect(h.ctx.updateSettings).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(screen.queryByLabelText("Changes to apply")).toBeNull();
    await reviewAndApply();
    await waitFor(() => expect(h.ctx.updateSettings).toHaveBeenCalledTimes(1));
    expect(h.ctx.updateSettings).toHaveBeenCalledWith({ dealer_name: "Example Motors of Example City" });
    h.ctx.settings = { ...h.ctx.settings, dealer_name: "Example Motors of Example City" };
    view.rerender(<MemoryRouter><IdentityView /></MemoryRouter>);
    expect(screen.getByText("Saved")).toBeTruthy();
    expect(reviewButton()).toHaveProperty("disabled", true);
  });

  it("blocks saving with a visible reason when a name is cleared", () => {
    renderLive(IdentityView);
    fireEvent.change(screen.getByLabelText("Dealership name"), { target: { value: "  " } });
    expect(screen.getByText("1 issue to fix")).toBeTruthy();
    expect(reviewButton()).toHaveProperty("disabled", true);
  });

  it("discards a draft back to the saved values", () => {
    renderLive(IdentityView);
    const name = screen.getByLabelText("Dealership name") as HTMLInputElement;
    fireEvent.change(name, { target: { value: "Example Motors Changed" } });
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(name.value).toBe("Example Motors");
    expect(screen.getByText("No changes pending")).toBeTruthy();
  });

  it("refuses to save when the server row was never read", () => {
    h.ctx.serverLoaded = false;
    h.ctx.loadError = "permission denied";
    renderLive(IdentityView);
    fireEvent.change(screen.getByLabelText("Dealership name"), { target: { value: "Example Motors Changed" } });
    expect(reviewButton()).toHaveProperty("disabled", true);
    expect(screen.getByText("Settings unavailable")).toBeTruthy();
    expect(h.ctx.updateSettings).not.toHaveBeenCalled();
  });

  it("reports a refused save and keeps the draft", async () => {
    h.ctx.updateSettings.mockResolvedValue(false);
    renderLive(IdentityView);
    fireEvent.change(screen.getByLabelText("Dealership name"), { target: { value: "Example Motors Changed" } });
    await reviewAndApply();
    await waitFor(() => expect(screen.getByText("Couldn't save")).toBeTruthy());
    expect((screen.getByLabelText("Dealership name") as HTMLInputElement).value).toBe("Example Motors Changed");
  });

  it("returns to clean, with Review disabled, when an edit is typed back to the saved value", () => {
    renderLive(IdentityView);
    const city = screen.getByLabelText("City");
    fireEvent.change(city, { target: { value: "Another City" } });
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    expect(reviewButton()).toHaveProperty("disabled", false);
    fireEvent.change(city, { target: { value: "Example City" } });
    expect(screen.getByText("No changes pending")).toBeTruthy();
    expect(reviewButton()).toHaveProperty("disabled", true);
    expect(screen.queryByRole("button", { name: "Discard" })).toBeNull();
  });

  it("applies only the fields still changed when several are edited and one is reverted", async () => {
    renderLive(IdentityView);
    fireEvent.change(screen.getByLabelText("Dealership name"), { target: { value: "Example Motors Renamed" } });
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Another City" } });
    fireEvent.change(screen.getByLabelText("State"), { target: { value: "NY" } });
    fireEvent.change(screen.getByLabelText("Dealership name"), { target: { value: "Example Motors" } });
    expect(screen.getByText("2 fields changed. Review to apply them.")).toBeTruthy();
    fireEvent.click(reviewButton());
    const panel = screen.getByLabelText("Changes to apply");
    expect(within(panel).queryByText("Dealership name")).toBeNull();
    await act(async () => { fireEvent.click(applyButton()); });
    await waitFor(() => expect(h.ctx.updateSettings).toHaveBeenCalledTimes(1));
    expect(h.ctx.updateSettings).toHaveBeenCalledWith({ dealer_city: "Another City", dealer_state: "NY" });
  });

  it("discards a multi-field draft back to every saved value without writing", () => {
    renderLive(IdentityView);
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Another City" } });
    fireEvent.change(screen.getByLabelText("State"), { target: { value: "NY" } });
    fireEvent.click(reviewButton());
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.queryByLabelText("Changes to apply")).toBeNull();
    expect((screen.getByLabelText("City") as HTMLInputElement).value).toBe("Example City");
    expect((screen.getByLabelText("State") as HTMLSelectElement).value).toBe("CT");
    expect(reviewButton()).toHaveProperty("disabled", true);
    expect(h.ctx.updateSettings).not.toHaveBeenCalled();
  });

  it("leaves Applying with a visible failure and keeps the draft when the save throws", async () => {
    h.ctx.updateSettings.mockRejectedValue(new Error("network down"));
    renderLive(IdentityView);
    fireEvent.change(screen.getByLabelText("Dealership name"), { target: { value: "Example Motors Changed" } });
    await reviewAndApply();
    await waitFor(() => expect(screen.getByText("Couldn't save")).toBeTruthy());
    expect(screen.queryByText("Applying...")).toBeNull();
    expect(screen.getByText("The server did not accept the change. Nothing was saved.")).toBeTruthy();
    expect((screen.getByLabelText("Dealership name") as HTMLInputElement).value).toBe("Example Motors Changed");
    expect(screen.getByRole("button", { name: "Discard" })).toBeTruthy();
  });

  it("re-baselines the draft when the settings load again for a tenant", () => {
    const view = renderLive(IdentityView);
    fireEvent.change(screen.getByLabelText("Dealership name"), { target: { value: "Example Motors Changed" } });
    h.ctx.settings = { ...h.ctx.settings, dealer_name: "Example Motors From Server" };
    h.ctx.loadGeneration = 2;
    view.rerender(<MemoryRouter><IdentityView /></MemoryRouter>);
    expect((screen.getByLabelText("Dealership name") as HTMLInputElement).value).toBe("Example Motors From Server");
    expect(h.ctx.updateSettings).not.toHaveBeenCalled();
  });

  it("uploads a logo through the existing storage helper and saves its address at once", async () => {
    renderLive(IdentityView);
    const file = new File(["png"], "logo.png", { type: "image/png" });
    await act(async () => { fireEvent.change(screen.getByLabelText("Upload new logo"), { target: { files: [file] } }); });
    await waitFor(() => expect(h.upload).toHaveBeenCalledTimes(1));
    expect(h.upload).toHaveBeenCalledWith("dealer-logos", file, { tenantId: "tenant-a", storeId: undefined, vin: "brand-logo" });
    await waitFor(() => expect(h.ctx.updateSettings).toHaveBeenCalledWith({ dealer_logo_url: "https://files.example.test/logo.png" }));
  });

  it("rejects an oversized logo before any upload", async () => {
    renderLive(IdentityView);
    const big = new File([new Uint8Array(3 * 1024 * 1024)], "logo.png", { type: "image/png" });
    await act(async () => { fireEvent.change(screen.getByLabelText("Upload new logo"), { target: { files: [big] } }); });
    expect(h.upload).not.toHaveBeenCalled();
    expect(screen.getByText("The logo must be 2 MB or smaller.")).toBeTruthy();
  });
});

describe("other brand views in live mode", () => {
  it("Appearance saves only primary_color and resets to the default", async () => {
    h.ctx.settings = { ...h.ctx.settings, primary_color: "#142338" };
    const view = renderLive(AppearanceView);
    fireEvent.change(screen.getByLabelText("Workspace accent"), { target: { value: "#2457D6" } });
    await reviewAndApply();
    await waitFor(() => expect(h.ctx.updateSettings).toHaveBeenCalledWith({ primary_color: "#2457D6" }));
    h.ctx.settings = { ...h.ctx.settings, primary_color: "#2457D6" };
    view.rerender(<MemoryRouter><AppearanceView /></MemoryRouter>);
    expect(screen.getByText("Saved")).toBeTruthy();
    vi.spyOn(window, "confirm").mockReturnValue(true);
    fireEvent.click(screen.getByRole("button", { name: "Reset accent to default" }));
    expect(screen.getByText("Unsaved changes")).toBeTruthy();
    await reviewAndApply();
    await waitFor(() => expect(h.ctx.updateSettings).toHaveBeenLastCalledWith({ primary_color: "" }));
  });

  it("Hours & Contact validates and saves its own keys only", async () => {
    renderLive(HoursContactView);
    fireEvent.change(screen.getByLabelText("ZIP"), { target: { value: "123" } });
    expect(reviewButton()).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByLabelText("ZIP"), { target: { value: "06120" } });
    fireEvent.change(screen.getByLabelText("Store hours"), { target: { value: "Mon to Sat 9 to 7" } });
    await reviewAndApply();
    await waitFor(() => expect(h.ctx.updateSettings).toHaveBeenCalledWith({ dealer_hours: "Mon to Sat 9 to 7", dealer_zip: "06120" }));
  });

  it("Why Buy mounts the trust panel live and saves the marketing copy", async () => {
    renderLive(WhyBuyView);
    expect(screen.getByText("trust panel stub")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Why buy here"), { target: { value: "Family owned since the start" } });
    await reviewAndApply();
    await waitFor(() => expect(h.ctx.updateSettings).toHaveBeenCalledWith({ why_buy_here: "Family owned since the start" }));
  });

  it("Websites & feeds runs the price test only on click and only when clean", async () => {
    const view = renderLive(WebsitesFeedsView);
    const url = screen.getByLabelText("Test URL");
    fireEvent.change(url, { target: { value: "https://www.example-dealer.test/used/example/" } });
    expect(h.invoke).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("VDP price labels, priority order"), { target: { value: "Internet Price" } });
    expect(screen.getByRole("button", { name: "Test" })).toHaveProperty("disabled", true);
    expect(screen.getByText("Save your label settings before testing.")).toBeTruthy();
    await reviewAndApply();
    await waitFor(() => expect(h.ctx.updateSettings).toHaveBeenCalledWith({ vdp_price_labels: "Internet Price" }));
    h.ctx.settings = { ...h.ctx.settings, vdp_price_labels: "Internet Price" };
    view.rerender(<MemoryRouter><WebsitesFeedsView /></MemoryRouter>);
    expect(screen.getByRole("button", { name: "Test" })).toHaveProperty("disabled", false);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Test" })); });
    await waitFor(() => expect(h.invoke).toHaveBeenCalledTimes(1));
    expect(h.invoke).toHaveBeenCalledWith("crawl-advertised-prices", { body: { tenant_id: "tenant-a", test_url: "https://www.example-dealer.test/used/example/" } });
    await waitFor(() => expect(screen.getByText(/Price read: \$12,345/)).toBeTruthy());
  });

  it("Document defaults saves the payment display as one object", async () => {
    renderLive(DocumentDefaultsView);
    fireEvent.click(screen.getByRole("switch", { name: "Interest rate (APR)" }));
    fireEvent.click(reviewButton());
    expect(within(screen.getByLabelText("Changes to apply")).getByText("payment on, down payment on, term on, APR off")).toBeTruthy();
    await act(async () => { fireEvent.click(applyButton()); });
    await waitFor(() => expect(h.ctx.updateSettings).toHaveBeenCalledTimes(1));
    const patch = h.ctx.updateSettings.mock.calls[0][0] as unknown as { passport_payment_display: { interestRate: boolean } };
    expect(Object.keys(patch)).toEqual(["passport_payment_display"]);
    expect(patch.passport_payment_display.interestRate).toBe(false);
  });
});
