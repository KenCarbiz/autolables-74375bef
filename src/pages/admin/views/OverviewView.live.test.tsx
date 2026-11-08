import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { renderAdmin } from "@/test/adminRender";
import { functionCalls, resetSupabaseSpy, spyCalls, spyResponses, writeCalls } from "@/test/mocks/supabaseSpy";
import { adminTabHref } from "@/lib/admin/sections";
import OverviewView from "./OverviewView";

vi.mock("@/integrations/supabase/client", async () => {
  const m = await import("@/test/mocks/supabaseSpy");
  return { supabase: m.supabaseSpy };
});
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: { id: "tenant-1", name: "Example Motors" }, loading: false }) }));
vi.mock("@/components/admin/v2/useAdminVisibility", () => ({ useAdminVisibility: () => ({ ctx: { role: "owner", isAdmin: false }, ready: true }) }));
vi.mock("@/contexts/DealerSettingsContext", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/contexts/DealerSettingsContext")>();
  return { ...mod, useDealerSettings: () => ({ settings: mod.DEFAULT_SETTINGS, updateSettings: async () => true, loading: false }) };
});

beforeEach(() => resetSupabaseSpy());

describe("Overview against live reads", () => {
  it("shows a failed count as Unavailable and an unread activity list as unavailable", async () => {
    spyResponses.tables.vehicle_listings = { data: null, count: null, error: { message: "boom" } };
    spyResponses.tables.vehicle_exceptions = { data: null, count: null, error: { message: "boom" } };
    spyResponses.tables.stale_document_flags = { data: null, count: null, error: { message: "boom" } };
    spyResponses.tables.audit_log = { data: null, error: { message: "boom" } };
    renderAdmin(<OverviewView />, { route: adminTabHref("overview") });
    const summary = screen.getByRole("region", { name: "Summary" });
    await waitFor(() => expect(within(summary).getAllByText("Unavailable")).toHaveLength(3));
    expect(within(summary).queryByText("0")).toBeNull();
    await waitFor(() => expect(screen.getByText(/Activity is unavailable right now/)).toBeTruthy());
  });

  it("counts unique vehicles apart from issues and keeps view events out of recent activity", async () => {
    const rows = [
      { id: "a", vehicle_listing_id: "v1", vin: "X1", severity: "high", exception_type: "price_change", title: "t" },
      { id: "b", vehicle_listing_id: "v1", vin: "X1", severity: "low", exception_type: "missing_required_field", title: "t" },
      { id: "c", vehicle_listing_id: "v2", vin: "X2", severity: "low", exception_type: "missing_required_field", title: "t" },
    ];
    spyResponses.tables.vehicle_exceptions = { data: rows, count: 3, error: null };
    spyResponses.tables.vehicle_listings = { data: null, count: 40, error: null };
    renderAdmin(<OverviewView />, { route: adminTabHref("overview") });
    const summary = screen.getByRole("region", { name: "Summary" });
    await waitFor(() => expect(within(summary).getByText("2 vehicles")).toBeTruthy());
    expect(within(summary).getByText(/3 open issues in total/)).toBeTruthy();
    const audit = spyCalls.find((c) => c.kind === "table" && c.table === "audit_log" && c.op === "not");
    expect(audit).toBeTruthy();
    expect((audit as { args: unknown[] }).args).toEqual(["action", "in", "(listing_viewed,addendum_viewed,window_sticker.view)"]);
  });

  it("starts no sync, function or write on mount", async () => {
    renderAdmin(<OverviewView />, { route: adminTabHref("overview") });
    await waitFor(() => expect(spyCalls.length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 100));
    expect(functionCalls()).toEqual([]);
    expect(writeCalls()).toEqual([]);
  });
});
