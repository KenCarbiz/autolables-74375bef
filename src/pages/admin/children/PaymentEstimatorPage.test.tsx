import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act, within, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { normalizeEstimatorConfig, type EstimatorConfig } from "@/lib/payment/estimator";
import type { ApplyOutcome, EstimatorSource } from "@/pages/admin/views/brand/paymentEstimator/data";
import { PE_PUBLISHED, PE_VEHICLES } from "@/pages/admin/fixtures/paymentEstimator";

// The editor against a controllable source: store scoping, review gating,
// apply outcomes, permission and concurrency. Synthetic data only.

const h = vi.hoisted(() => ({ source: null as unknown as EstimatorSource, apply: vi.fn() }));

vi.mock("@/pages/admin/views/brand/paymentEstimator/data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/pages/admin/views/brand/paymentEstimator/data")>();
  return { ...actual, useEstimatorSource: () => h.source };
});

import PaymentEstimatorPage from "./PaymentEstimatorPage";

const published = (config: unknown, version: number) => ({ config: normalizeEstimatorConfig(config), version, updatedAt: "2026-10-28T15:42:00Z", updatedBy: null });

const makeSource = (over: Partial<EstimatorSource> = {}): EstimatorSource => ({
  state: "ready", error: null, tenantId: "tenant-a", storeId: "store-north", storeName: "Example Motors North", accountWide: false,
  otherStores: [{ id: "store-south", name: "Example Motors South" }],
  published: published(PE_PUBLISHED, 3), vehicles: PE_VEHICLES, vehiclesState: "ready", vehiclesCheckedAt: 0,
  priceContext: { price_display_mode: "website_sale_price", advertised_excludes_doc_fee: null },
  canManage: true, isFixture: false, reload: vi.fn(), apply: h.apply as unknown as EstimatorSource["apply"], ...over,
});

const ui = () => <MemoryRouter initialEntries={["/admin/brand/payment-estimator"]}><PaymentEstimatorPage /></MemoryRouter>;
const review = () => screen.getByRole("button", { name: "Review changes" });
const goTo = (label: string) => fireEvent.change(screen.getByLabelText("Section"), { target: { value: label } });
const setDollarDown = (v: string) => {
  fireEvent.click(screen.getByRole("radio", { name: "Dollar amount" }));
  fireEvent.change(screen.getByLabelText("Dollar amount"), { target: { value: v } });
};

beforeEach(() => {
  h.apply.mockReset();
  h.source = makeSource();
});

describe("payment estimator editor", () => {
  it("names the store it edits and keeps Review disabled until a real change exists", () => {
    render(ui());
    expect(screen.getByText("Editing payment settings for Example Motors North")).toBeTruthy();
    expect(review()).toHaveProperty("disabled", true);
    setDollarDown("2500");
    expect(review()).toHaveProperty("disabled", false);
    expect(screen.getByText(/\$2,500 down on a \$27,500 selling price/)).toBeTruthy();
  });

  it("blocks review on invalid settings and lists what to fix", () => {
    render(ui());
    fireEvent.change(screen.getByLabelText("Percentage of selling price"), { target: { value: "120" } });
    fireEvent.click(review());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByText("1 problem to fix before review")).toBeTruthy();
    expect(h.apply).not.toHaveBeenCalled();
  });

  it("reviews before/after for this store and applies against the starting version", async () => {
    h.apply.mockResolvedValue({ status: "applied", version: 4, replayed: false } satisfies ApplyOutcome);
    render(ui());
    setDollarDown("2500");
    fireEvent.click(review());
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Example Motors North")).toBeTruthy();
    expect(within(dialog).getByText(/from version 3 to 4/)).toBeTruthy();
    expect(within(dialog).getByText("10% of selling price")).toBeTruthy();
    expect(within(dialog).getByText("$2,500 fixed")).toBeTruthy();
    // Coverage gaps must be acknowledged before apply.
    const apply = within(dialog).getByRole("button", { name: "Apply changes" });
    expect(apply).toHaveProperty("disabled", true);
    fireEvent.click(within(dialog).getByRole("checkbox"));
    await act(async () => { fireEvent.click(apply); });
    expect(h.apply).toHaveBeenCalledTimes(1);
    const call = h.apply.mock.calls[0][0] as { baseVersion: number; config: EstimatorConfig; requestId: string };
    expect(call.baseVersion).toBe(3);
    expect(call.config.downPayment).toEqual({ mode: "amount", amount: 2500, percent: 10 });
    await waitFor(() => expect(screen.getByText("Applied as version 4")).toBeTruthy());
  });

  it("retries a failed apply with the same request id and keeps the draft", async () => {
    h.apply.mockResolvedValueOnce({ status: "failed", message: "The server did not accept the change. Nothing was saved." } satisfies ApplyOutcome);
    render(ui());
    setDollarDown("2500");
    fireEvent.click(review());
    fireEvent.click(screen.getByRole("checkbox"));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Apply changes" })); });
    expect(screen.getByText("Not applied")).toBeTruthy();
    h.apply.mockResolvedValueOnce({ status: "applied", version: 4, replayed: false } satisfies ApplyOutcome);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Retry apply" })); });
    expect(h.apply).toHaveBeenCalledTimes(2);
    expect(h.apply.mock.calls[1][0].requestId).toBe(h.apply.mock.calls[0][0].requestId);
  });

  it("never overwrites a newer version: a conflict stops the apply and offers a compare", async () => {
    h.apply.mockResolvedValue({ status: "conflict", currentVersion: 4 } satisfies ApplyOutcome);
    render(ui());
    setDollarDown("2500");
    fireEvent.click(review());
    fireEvent.click(screen.getByRole("checkbox"));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Apply changes" })); });
    expect(screen.getByText("Not applied: newer settings exist")).toBeTruthy();
    expect(h.source.reload).toHaveBeenCalled();
  });

  it("flags a stale draft when another admin applies first, and disables review until compared", () => {
    const view = render(ui());
    setDollarDown("2500");
    h.source = makeSource({ published: published({ ...PE_PUBLISHED, downPayment: { mode: "percent", amount: 2000, percent: 15 } }, 4) });
    view.rerender(ui());
    expect(screen.getByText("Newer settings were applied")).toBeTruthy();
    expect(review()).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: "Compare with latest" }));
    expect(review()).toHaveProperty("disabled", false);
  });

  it("keeps each store's draft to that store", () => {
    const view = render(ui());
    setDollarDown("2500");
    h.source = makeSource({ storeId: "store-south", storeName: "Example Motors South", otherStores: [{ id: "store-north", name: "Example Motors North" }], published: published({ ...PE_PUBLISHED, rules: [] }, 1) });
    view.rerender(ui());
    expect(screen.getByText("Editing payment settings for Example Motors South")).toBeTruthy();
    expect(screen.getByText("Unsaved changes for another store")).toBeTruthy();
    expect(review()).toHaveProperty("disabled", true);
    expect(screen.getByRole("radio", { name: "Percentage" }).getAttribute("aria-checked")).toBe("true");
  });

  it("is view-only for roles that can't manage settings", () => {
    h.source = makeSource({ canManage: false });
    render(ui());
    expect(screen.getByText("View only")).toBeTruthy();
    expect(screen.getByRole("switch", { name: "Show retail payment estimates on Passport" })).toHaveProperty("disabled", true);
    expect(review()).toHaveProperty("disabled", true);
  });

  it("turning the estimator off keeps every range and rate in the draft", () => {
    render(ui());
    fireEvent.click(screen.getByRole("switch", { name: "Show retail payment estimates on Passport" }));
    goTo("rates");
    expect(screen.getByText("2025–2027")).toBeTruthy();
    expect(screen.getByText("2017–2019")).toBeTruthy();
    expect(review()).toHaveProperty("disabled", false);
  });

  it("shows the unavailable message in the preview for a year with no range", () => {
    h.source = makeSource({ vehicles: [PE_VEHICLES[4]] });
    render(ui());
    expect(screen.getByText("Estimate unavailable")).toBeTruthy();
  });

  it("says when the settings table is not installed and cannot apply", () => {
    h.source = makeSource({ state: "not_installed", published: published(null, 0) });
    render(ui());
    expect(screen.getByText("Pending migration")).toBeTruthy();
  });
});
