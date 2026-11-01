import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderAdmin } from "@/test/adminRender";
import { functionCalls, resetSupabaseSpy, writeCalls } from "@/test/mocks/supabaseSpy";
import { AL97_05, AL97_06, AL97_17 } from "@/pages/admin/fixtures/al97-batch5";
import { AL97_13, AL97_14 } from "@/pages/admin/fixtures/al97-batch2";
import { ADMIN_CHILD_ROUTES } from "@/lib/admin/sections";
import { amortizedPayment, normalizeEstimatorConfig } from "@/lib/payment/estimator";
import type { DedupePreview } from "@/lib/inventoryNetwork/api";
import PaymentAssumptionsPage, { reviewRows } from "./PaymentAssumptionsPage";
import InventoryNetworkPage from "./InventoryNetworkPage";
import StoreIdentityPage, { REGISTRY_MIGRATION, stateDisplay } from "./StoreIdentityPage";
import { approveBlocked } from "./inventoryNetwork/ReconciliationReview";

vi.mock("@/integrations/supabase/client", async () => {
  const m = await import("@/test/mocks/supabaseSpy");
  return { supabase: m.supabaseSpy };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" }, isAdmin: true, loading: false }) }));
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: null, currentStore: null, stores: [] }) }));
vi.mock("@/hooks/useEntitlements", () => ({ useEntitlements: () => ({ member: { role: "admin" }, loading: false }) }));
vi.mock("@/contexts/DealerSettingsContext", async (orig) => ({ ...(await orig<typeof import("@/contexts/DealerSettingsContext")>()), useDealerSettings: () => ({ settings: { dealer_timezone: "UTC" }, loading: false }) }));

const noWrites = () => {
  expect(functionCalls()).toEqual([]);
  expect(writeCalls().filter((c) => c.kind === "table")).toEqual([]);
  expect(writeCalls().filter((c) => c.kind === "rpc" && /apply|save|set_|approve|scan|create|purge|undo/.test(c.fn))).toEqual([]);
};

beforeEach(() => resetSupabaseSpy());

const views = (fx: typeof AL97_06, patch: Record<string, unknown>) => {
  const est = fx.fixture.views["payment-estimator"] as Record<string, unknown>;
  return { ...fx.fixture, views: { ...fx.fixture.views, "payment-estimator": { ...est, ...patch } } };
};

describe("AL97 payment estimator", () => {
  it("shows the shared resolver's payment for the synthetic draft, scoped to one store", () => {
    renderAdmin(<PaymentAssumptionsPage />, { route: ADMIN_CHILD_ROUTES.paymentAssumptions, fixture: AL97_06.fixture });
    expect(amortizedPayment(27000, 7.9, 72)).toBeCloseTo(472.08, 2);
    expect(screen.getByText("$472")).toBeInTheDocument();
    expect(screen.getByText("72 months · 7.90% assumed APR")).toBeInTheDocument();
    expect(screen.getByText("Retail finance assumptions · Harte INFINITI only")).toBeInTheDocument();
    const row = screen.getByText("2018–2021").closest("tr")!;
    expect(within(row).getAllByText("Not offered")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Review changes" })).toBeEnabled();
    noWrites();
  });

  it("labels account-wide settings as the whole account and keeps Review disabled without a draft", () => {
    renderAdmin(<PaymentAssumptionsPage />, { route: ADMIN_CHILD_ROUTES.paymentAssumptions, fixture: views(AL97_06, { accountWide: true, draft: undefined }) });
    expect(screen.getByText("Retail finance assumptions · Whole account")).toBeInTheDocument();
    const review = screen.getByRole("button", { name: "Review changes" });
    expect(review).toBeDisabled();
    expect(review).toHaveAttribute("title", expect.stringContaining("No draft changes"));
    noWrites();
  });

  it("lists exact before and after values for the review", () => {
    const before = normalizeEstimatorConfig(null);
    const after = normalizeEstimatorConfig((AL97_17.fixture.views["payment-estimator"] as { draft: unknown }).draft);
    expect(reviewRows(before, after)).toEqual([
      { setting: "Estimator", before: "Off", after: "On" },
      { setting: "Down payment", before: "Not set", after: "10% of selling price" },
      { setting: "Year range 2022–2024", before: "None", after: "48 / 60 / 72 months at 7.50 / 7.50 / 7.90%" },
      { setting: "Default term", before: "None", after: "72 months" },
    ]);
  });
});

describe("AL97 payment estimator review", () => {
  it("holds Apply until the coverage warning is acknowledged and never writes from a fixture", async () => {
    renderAdmin(<PaymentAssumptionsPage />, { route: ADMIN_CHILD_ROUTES.paymentAssumptions, fixture: AL97_17.fixture });
    const dialog = screen.getByRole("dialog", { name: "Review payment changes" });
    const apply = within(dialog).getByRole("button", { name: "Apply changes" });
    expect(apply).toBeDisabled();
    expect(apply).toHaveAttribute("title", expect.stringContaining("no estimate"));
    fireEvent.click(within(dialog).getByRole("checkbox"));
    expect(apply).toBeEnabled();
    fireEvent.click(apply);
    expect(await within(dialog).findByText("Not applied")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Retry apply" })).toBeInTheDocument();
    noWrites();
  });

  it("returns focus to Review changes on Escape", async () => {
    renderAdmin(<PaymentAssumptionsPage />, { route: ADMIN_CHILD_ROUTES.paymentAssumptions, fixture: AL97_17.fixture });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(screen.getByRole("button", { name: "Review changes" })).toHaveFocus());
  });
});

describe("AL97 duplicate handling", () => {
  it("keeps the stop engaged, reconcile and purge off, and runs nothing on load", () => {
    renderAdmin(<InventoryNetworkPage />, { route: "/admin/integrations/inventory-network?view=duplicates&store=s1", fixture: AL97_13.fixture });
    expect(screen.getByRole("heading", { level: 1, name: "Duplicate handling" })).toBeInTheDocument();
    expect(screen.getByText("Emergency stop engaged")).toBeInTheDocument();
    expect(screen.getByText("Engaged")).toHaveClass("red");
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    const stats = screen.getByRole("list", { name: "Duplicate handling summary" });
    expect(within(stats).getAllByText("Off")).toHaveLength(2);
    expect(screen.getByText("5 · proposed, not approved")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run detection" })).toBeEnabled();
    noWrites();
  });
});

describe("AL97 exact reconciliation review", () => {
  it("shows the pinned plan with approval blocked by the emergency stop", () => {
    renderAdmin(<InventoryNetworkPage />, { route: "/admin/integrations/inventory-network?view=duplicates&preview=preview-demo", fixture: AL97_14.fixture });
    expect(screen.getByText("Synthetic candidate · VIN ending DEMO01")).toBeInTheDocument();
    expect(screen.getByText("HOLD for manual choice")).toBeInTheDocument();
    expect(screen.getByText("Fresh scan required")).toBeInTheDocument();
    expect(screen.getByText("Preview expires in 60 min")).toBeInTheDocument();
    const approve = screen.getByRole("button", { name: "Approve exact preview" });
    expect(approve).toBeDisabled();
    expect(approve).toHaveAttribute("title", "The emergency stop is engaged, so no plan can be approved.");
    noWrites();
  });

  it("allows approval only for a pending, eligible, unexpired plan with the stop clear", () => {
    const p = (AL97_14.fixture.views["inventory-network"] as { dedupePreview: DedupePreview }).dedupePreview;
    const now = AL97_14.fixture.now;
    expect(approveBlocked(p, false, now)).toBeNull();
    expect(approveBlocked(p, null, now)).toMatch(/could not be read/);
    expect(approveBlocked(p, false, now + 61 * 60000)).toMatch(/expired/);
    expect(approveBlocked({ ...p, plan: { ...p.plan, disposition: "needs_review" } }, false, now)).toMatch(/person's review/);
    expect(approveBlocked(null, false, now)).toMatch(/could not be read/);
  });
});

describe("AL97 store identity and scope", () => {
  it("labels account settings as the whole account and keeps the page read-only", () => {
    renderAdmin(<StoreIdentityPage />, { route: ADMIN_CHILD_ROUTES.storeIdentity, fixture: AL97_05.fixture });
    expect(screen.getByText("Harte Auto Group / Hartford, CT · whole account")).toBeInTheDocument();
    expect(screen.getByText("Account setting")).toBeInTheDocument();
    expect(screen.getByText("Not stored")).toBeInTheDocument();
    expect(screen.getByText("Canonical store registry")).toBeInTheDocument();
    const review = screen.getByRole("button", { name: "Review changes" });
    expect(review).toBeDisabled();
    expect(review).toHaveAccessibleDescription(/read-only/);
    noWrites();
  });

  it("shows a legacy state name as its code without rewriting it, and the registry as Unknown when unreadable", () => {
    const brand = AL97_05.fixture.views.brand as { settings: Record<string, unknown> };
    renderAdmin(<StoreIdentityPage />, { route: ADMIN_CHILD_ROUTES.storeIdentity, fixture: { ...AL97_05.fixture, views: { ...AL97_05.fixture.views, brand: { ...brand, settings: { ...brand.settings, dealer_state: "Connecticut" } }, "al97-identity": { registry: null } } } });
    expect(screen.getByText(/Stored as "Connecticut"; shown as CT/)).toBeInTheDocument();
    expect(screen.getByText("Inventory ownership").closest("tr")).toHaveTextContent("Unknown");
    expect(screen.getByText(new RegExp(REGISTRY_MIGRATION.replace(/\./g, "\\.")))).toBeInTheDocument();
    expect(stateDisplay("CT").hint).toBe("Stored as two-letter code; displayed as Connecticut.");
    expect(stateDisplay("Narnia").code).toBe("Narnia");
    noWrites();
  });
});
