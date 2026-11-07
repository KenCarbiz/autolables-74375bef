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
  it("Websites & feeds renders the feed, marketplace, extraction and condition cards with the test disabled", () => {
    renderFixture(WebsitesFeedsView);
    expect(screen.getByLabelText("DMS provider")).toBeTruthy();
    expect(screen.getByLabelText("CarGurus")).toBeTruthy();
    expect(screen.getByLabelText("VDP price labels, priority order")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Test" })).toHaveProperty("disabled", true);
    expect(h.invoke).not.toHaveBeenCalled();
  });

  it("Document defaults renders the generator defaults and the payment estimator entry", () => {
    renderFixture(DocumentDefaultsView);
    expect(screen.getByLabelText("New-car addendum")).toHaveProperty("value", "standard");
    expect(screen.getByLabelText("FTC used-car warranty (Buyers Guide)")).toHaveProperty("value", "as_is");
    expect(screen.queryAllByRole("switch")).toHaveLength(0);
    expect(screen.getByText("Passport payment estimator")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Configure estimator" })).toBeTruthy();
  });
});

describe("other brand views in live mode", () => {
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

  it("Document defaults links to the store's payment estimator instead of display toggles", async () => {
    renderLive(DocumentDefaultsView);
    expect(screen.queryByRole("switch", { name: "Interest rate (APR)" })).toBeNull();
    expect(screen.getByRole("link", { name: "Configure estimator" }).getAttribute("href")).toBe("/admin/brand/payment-estimator");
    await waitFor(() => expect(screen.getByText(/Status couldn't be read here/)).toBeTruthy());
    expect(h.ctx.updateSettings).not.toHaveBeenCalled();
  });
});
