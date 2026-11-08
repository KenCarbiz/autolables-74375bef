import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderAdmin } from "@/test/adminRender";
import { resetSupabaseSpy, spyCalls, spyResponses, functionCalls } from "@/test/mocks/supabaseSpy";
import { adminTabHref } from "@/lib/admin/sections";
import { WAVE_E_FIXTURES } from "@/pages/admin/fixtures/WaveEFixtures";
import PlanUsageView from "./PlanUsageView";

const live = vi.hoisted(() => ({ role: "owner" as string, entitlement: null as unknown }));

vi.mock("@/integrations/supabase/client", async () => {
  const m = await import("@/test/mocks/supabaseSpy");
  return { supabase: m.supabaseSpy };
});
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: { id: "tenant-1", name: "Example Motors" }, loading: false }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ isAdmin: false }) }));
vi.mock("@/hooks/useEntitlements", () => ({
  useEntitlements: () => ({ member: { role: live.role }, entitlementFor: () => live.entitlement, loading: false, error: null }),
}));
vi.mock("@/contexts/DealerSettingsContext", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/contexts/DealerSettingsContext")>();
  return { ...mod, useDealerSettings: () => ({ settings: { ...mod.DEFAULT_SETTINGS, dealer_timezone: "America/New_York" }, updateSettings: async () => true, loading: false }) };
});

const fixture = WAVE_E_FIXTURES["v3-plan-usage"].fixture;
const open = (query = "") => renderAdmin(<PlanUsageView />, { route: `${adminTabHref("plan-features")}${query}`, fixture });

beforeEach(() => {
  resetSupabaseSpy();
  live.role = "owner";
  live.entitlement = { id: "e1", tenant_id: "tenant-1", app_slug: "autolabels", plan_tier: "pro", status: "active", activated_at: "2026-02-15T00:00:00Z", trial_ends_at: "2026-02-20T00:00:00Z", expires_at: null, stripe_subscription_id: "sub_fixture", seat_limit: null };
});

describe("Plan & Usage from the fixture", () => {
  it("shows the plan, its status and dates from the entitlement, with no stale trial wording", () => {
    const { container } = open();
    expect(container.querySelector("[data-plan-name]")?.textContent).toBe("Pro");
    expect(screen.getByText("Active")).toBeTruthy();
    expect(screen.getByText("Current period ends")).toBeTruthy();
    expect(container.textContent).not.toMatch(/trial/i);
    expect(screen.getByText("Autocurb subscription")).toBeTruthy();
  });

  it("offers Manage billing only to an authorized role and keeps the invoice route", () => {
    open();
    expect(screen.getByRole("link", { name: /Manage billing/ })).toHaveAttribute("href", "https://autocurb.io/settings");
    expect(screen.getByRole("link", { name: /Installer invoices/ })).toHaveAttribute("href", "/invoices");
  });

  it("hides Manage billing from a read-only role and says why", () => {
    open("&state=readonly");
    expect(screen.queryByRole("link", { name: /Manage billing/ })).toBeNull();
    expect(screen.getByText(/Billing is changed by an owner or biller/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Installer invoices/ })).toBeNull();
  });

  it("distinguishes trial and suspension", () => {
    const trial = open("&state=trial");
    expect(trial.container.querySelector("[data-plan-name]")?.textContent).toBe("Starter");
    expect(screen.getAllByText("Trial").length).toBeGreaterThan(0);
    expect(screen.getByText("Trial ends")).toBeTruthy();
    trial.unmount();
    open("&state=suspended");
    expect(screen.getAllByText("Suspended").length).toBeGreaterThan(0);
    expect(screen.getByText("This plan is suspended")).toBeTruthy();
  });

  it("shows five metrics with month, timezone, scope and last updated, and no percent for unlimited", () => {
    const { container } = open("&state=unlimited");
    expect(container.querySelectorAll("[data-metric]").length).toBe(5);
    const meta = container.querySelector("[data-usage-meta]") as HTMLElement;
    expect(meta.textContent).toContain("November 2026 (America/New_York)");
    expect(meta.textContent).toContain("All rooftops in this account");
    expect(meta.textContent).toMatch(/Last updated/);
    const stickers = container.querySelector('[data-metric="stickers_generated"]') as HTMLElement;
    expect(stickers.textContent).toContain("3,921");
    expect(stickers.textContent).toContain("Unlimited on this plan.");
    expect(within(stickers).queryByRole("progressbar")).toBeNull();
  });

  it("gives a limited metric a progress bar and marks unrecorded activity Unavailable with a reason", () => {
    const { container } = open();
    const stickers = container.querySelector('[data-metric="stickers_generated"]') as HTMLElement;
    expect(within(stickers).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "412");
    const batch = container.querySelector('[data-metric="batch_jobs"]') as HTMLElement;
    expect(batch.getAttribute("data-metric-state")).toBe("unavailable");
    expect(batch.textContent).toContain("Unavailable");
    expect(batch.textContent).toMatch(/not recorded by the app yet/);
    const docs = container.querySelector('[data-metric="documents_published"]') as HTMLElement;
    expect(docs.textContent).toContain("No monthly limit is set");
  });

  it("shows a failed usage read as Unavailable, not zero", () => {
    const { container } = open("&state=error");
    expect(screen.getByText("The plan could not be read")).toBeTruthy();
    for (const el of Array.from(container.querySelectorAll("[data-metric]"))) expect(el.getAttribute("data-metric-state")).toBe("unavailable");
    expect(container.querySelector("[data-metric] .tabular-nums")).toBeNull();
  });

  it("shows a real zero as zero when the read succeeded", () => {
    const { container } = open("&state=empty");
    const stickers = container.querySelector('[data-metric="stickers_generated"]') as HTMLElement;
    expect(stickers.textContent).toContain("0");
    expect(stickers.getAttribute("data-metric-state")).toBe("value");
  });

  it("keeps the four feature states apart and locks with an icon, never a check", () => {
    const { container } = open();
    const status = (k: string) => container.querySelector(`[data-feature="${k}"]`)?.getAttribute("data-feature-status");
    expect(status("window_stickers")).toBe("included");
    expect(status("template_customization")).toBe("setup_required");
    expect(status("evidence_packet_export")).toBe("requires_upgrade");
    expect(status("team_permissions")).toBe("unavailable");
    const locked = container.querySelector('[data-feature="evidence_packet_export"]') as HTMLElement;
    expect(locked.querySelector("svg.lucide-lock")).toBeTruthy();
    expect(locked.querySelector("svg.lucide-circle-check-big, svg.lucide-check-circle-2, svg.lucide-circle-check")).toBeNull();
    expect(screen.getByRole("link", { name: "Open Store settings for Template customization" })).toHaveAttribute("href", adminTabHref("store-settings"));
  });

  it("separates provider quotas and links the provider usage pages", () => {
    open();
    expect(screen.getByRole("link", { name: "Provider usage and budgets" })).toHaveAttribute("href", "/admin/integrations/inventory-network?view=marketcheck");
    expect(screen.getByRole("link", { name: "Providers" })).toHaveAttribute("href", adminTabHref("providers"));
    expect(screen.getByText("MarketCheck")).toBeTruthy();
  });

  it("opens Compare plans from the real tier definitions", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: "Compare plans" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: "Compare plans" })).toBeTruthy();
    expect(within(dialog).getByText("Your plan")).toBeTruthy();
    expect(within(dialog).getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Starter", "Pro", "Compliance"]);
  });

  it("opens metric details", () => {
    open("&panel=metric-stickers_generated");
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Stickers generated")).toBeTruthy();
    expect(within(dialog).getByText("Usage events recorded by the app (autolabels_usage_events)")).toBeTruthy();
  });

  it("reads nothing and writes nothing in fixture mode", () => {
    open();
    expect(spyCalls).toEqual([]);
  });
});

describe("Plan & Usage against live data", () => {
  it("totals this month's events and calls no edge function", async () => {
    spyResponses.tables.autolabels_usage_events = { data: [
      { metric_key: "stickers_generated", quantity: 1, created_at: "2026-11-02T10:00:00Z" },
      { metric_key: "stickers_generated", quantity: 4, created_at: "2026-11-03T10:00:00Z" },
      { metric_key: "documents_published", quantity: null, created_at: "2026-11-03T11:00:00Z" },
    ], error: null };
    const { container } = renderAdmin(<PlanUsageView />, { route: adminTabHref("plan-features") });
    await waitFor(() => expect(container.querySelector('[data-metric="stickers_generated"]')?.getAttribute("data-metric-state")).toBe("value"));
    expect(container.querySelector('[data-metric="stickers_generated"] p.tabular-nums')?.textContent).toBe("5");
    expect(container.querySelector('[data-metric="documents_published"] p.tabular-nums')?.textContent).toBe("1");
    expect(functionCalls()).toEqual([]);
    expect(spyCalls.every((c) => c.kind === "table" && c.op !== "insert" && c.op !== "update" && c.op !== "upsert" && c.op !== "delete")).toBe(true);
  });

  it("shows Unavailable when the usage table cannot be read", async () => {
    spyResponses.tables.autolabels_usage_events = { data: null, error: { message: "relation does not exist" } };
    const { container } = renderAdmin(<PlanUsageView />, { route: adminTabHref("plan-features") });
    await waitFor(() => expect(screen.getByText("Usage is unavailable")).toBeTruthy());
    expect(container.querySelector('[data-metric="stickers_generated"]')?.getAttribute("data-metric-state")).toBe("unavailable");
  });

  it("hides Manage billing from a role without the billing capability", async () => {
    live.role = "salesperson";
    renderAdmin(<PlanUsageView />, { route: adminTabHref("plan-features") });
    expect(screen.queryByRole("link", { name: /Manage billing/ })).toBeNull();
  });
});
