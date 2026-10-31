import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderAdmin } from "@/test/adminRender";
import { functionCalls, resetSupabaseSpy, rpcCalls, spyCalls, spyResponses, writeCalls } from "@/test/mocks/supabaseSpy";
import InventoryNetworkPage from "./InventoryNetworkPage";

const mocks = vi.hoisted(() => ({ auth: { user: { id: "u1" }, isAdmin: true, loading: false }, tenant: null as { id: string } | null }));
vi.mock("@/integrations/supabase/client", async () => {
  const m = await import("@/test/mocks/supabaseSpy");
  return { supabase: m.supabaseSpy };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: mocks.tenant, currentStore: null }) }));
vi.mock("@/hooks/useEntitlements", () => ({ useEntitlements: () => ({ member: { role: "admin" }, loading: false }) }));
vi.mock("@/contexts/DealerSettingsContext", () => ({ useDealerSettings: () => ({ settings: { dealer_timezone: "UTC" }, loading: false }) }));

const group = { id: "g1", tenant_id: "t1", name: "Harte Auto Group", legal_name: null, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" };
const controls = { id: 1, ingestion_paused: true, emergency_stop: false, reconcile_enabled: false, reason: "Initial state", updated_at: "2026-10-01T00:00:00Z" };
const emptyOverview = { group, controls, stores: [], exceptions: { open_conflicts: 0, retirement_review: 0, quarantined_partitions_7d: 0, failed_jobs: 0, pending_mappings: 0 } };

beforeEach(() => {
  resetSupabaseSpy();
  mocks.auth.isAdmin = true;
  mocks.tenant = null;
});

describe("InventoryNetworkPage", () => {
  it("shows nothing to a non-admin and makes no calls", () => {
    mocks.auth.isAdmin = false;
    renderAdmin(<InventoryNetworkPage />, { route: "/admin/integrations/inventory-network" });
    expect(screen.getByText("Platform administrators only")).toBeInTheDocument();
    expect(spyCalls).toEqual([]);
  });

  it("opens the active account's group, not the first alphabetical one", async () => {
    const other = { ...group, id: "g0", tenant_id: "t0", name: "AutoLabels.io" };
    mocks.tenant = { id: "t1" };
    spyResponses.tables.dealer_groups = { data: [other, group] };
    spyResponses.rpcs.inv_admin_overview = { data: emptyOverview };
    renderAdmin(<InventoryNetworkPage />, { route: "/admin/integrations/inventory-network" });
    expect(await screen.findByText("No stores in this group yet")).toBeInTheDocument();
    expect((screen.getByLabelText("Dealer group") as HTMLSelectElement).value).toBe("g1");
    expect(screen.getByRole("link", { name: "Integrations" })).toHaveAttribute("href", "/admin?tab=inventory-feed");
  });

  it("explains an empty database instead of inventing data", async () => {
    spyResponses.tables.dealer_groups = { data: [] };
    renderAdmin(<InventoryNetworkPage />, { route: "/admin/integrations/inventory-network" });
    expect(await screen.findByText("No dealer groups yet")).toBeInTheDocument();
  });

  it("renders a group with no stores and reads only", async () => {
    spyResponses.tables.dealer_groups = { data: [group] };
    spyResponses.rpcs.inv_admin_overview = { data: emptyOverview };
    renderAdmin(<InventoryNetworkPage />, { route: "/admin/integrations/inventory-network" });
    expect(await screen.findByText("No stores in this group yet")).toBeInTheDocument();
    expect(screen.getByText("Ingestion paused")).toBeInTheDocument();
    expect(screen.getByText("Nothing is waiting for review.")).toBeInTheDocument();
    await waitFor(() => expect(rpcCalls()).toEqual(["inv_admin_overview"]));
    expect(functionCalls()).toEqual([]);
    expect(writeCalls().filter((c) => c.kind === "table")).toEqual([]);
  });

  it("shows a plain error when the database update is not applied", async () => {
    spyResponses.tables.dealer_groups = { data: [group] };
    renderAdmin(<InventoryNetworkPage />, { route: "/admin/integrations/inventory-network" });
    expect(await screen.findByText("Could not load this group")).toBeInTheDocument();
    expect(screen.getByText(/has not been applied to this project yet/)).toBeInTheDocument();
    expect(screen.queryByText(/42883|public\./)).not.toBeInTheDocument();
  });

  it("opens the sharing and runs views with empty states and no edge calls", async () => {
    spyResponses.tables.dealer_groups = { data: [group] };
    spyResponses.rpcs.inv_admin_overview = { data: { ...emptyOverview, stores: [] } };
    const { unmount } = renderAdmin(<InventoryNetworkPage />, { route: "/admin/integrations/inventory-network?view=runs" });
    expect(await screen.findByText("No activity yet")).toBeInTheDocument();
    expect(functionCalls()).toEqual([]);
    unmount();
    renderAdmin(<InventoryNetworkPage />, { route: "/admin/integrations/inventory-network?view=sharing" });
    expect(await screen.findByText("No stores yet")).toBeInTheDocument();
    expect(functionCalls()).toEqual([]);
  });

  it("shows feed health, counts and Feed only for a store with no policy, and reads every view without writing", async () => {
    const store = { id: "st1", group_id: "g1", tenant_id: "t1", display_name: "Harte Hyundai of Old Saybrook", legal_name: null, street: "1 Main St", city: "Old Saybrook", state: "CT", zip: "06475", phone: null, website: null, status: "active", subscription_status: "subscribed", is_primary_inventory_store: true, inventory_feed_enabled: true, feed_import_paused: false, inventory_sharing_enabled: false, customer_browser_enabled: false, listing_sync_enabled: false, feed_price_updates_listing: false, adopt_legacy_matches: false, retirement_automation_enabled: false, missing_snapshot_threshold: 3, max_invalid_rows: 0, provider_ids: {}, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-02T00:00:00Z" };
    const stores = [{ store, state: null, policy: null, counts: { present: 42, missing: 0, retirement_review: 0, retired: 0, price_unknown: 2, no_photos: 1 }, mappings: [], open_conflicts: 0, last_snapshot: { id: "sn1", status: "quarantined", reason: "too_many_invalid_rows", created_at: "2026-10-03T00:00:00Z", run_id: null }, sharing_out: 0, sharing_in: 0 }];
    spyResponses.tables.dealer_groups = { data: [group] };
    spyResponses.rpcs.inv_admin_overview = { data: { ...emptyOverview, stores, exceptions: { ...emptyOverview.exceptions, pending_mappings: 2 } } };
    const { unmount } = renderAdmin(<InventoryNetworkPage />, { route: "/admin/integrations/inventory-network" });
    expect(await screen.findByText("Harte Hyundai of Old Saybrook")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("Feed only")).toBeInTheDocument();
    expect(screen.getByText("Last feed quarantined")).toBeInTheDocument();
    expect(screen.getByText("Pending mappings").previousSibling).toHaveTextContent("2");
    unmount();
    const views: Array<[string, string]> = [
      ["stores&store=st1", "Save changes"], ["sharing", "Only one store in this group"], ["marketcheck", "Missing policy means Feed only"], ["mapping", "No files recorded yet"],
      ["runs&panel=conflicts", "No open conflicts"], ["runs&panel=retirement", "No vehicles waiting for review"], ["preview", "Customer view"],
    ];
    for (const [view, text] of views) {
      const r = renderAdmin(<InventoryNetworkPage />, { route: `/admin/integrations/inventory-network?view=${view}` });
      expect(await screen.findByText(text, { exact: false })).toBeInTheDocument();
      r.unmount();
    }
    expect(functionCalls()).toEqual([]);
    expect(writeCalls().filter((c) => c.kind === "table")).toEqual([]);
    expect(new Set(rpcCalls())).toEqual(new Set(["inv_admin_overview", "inv_admin_usage", "inv_admin_preview_context", "inv_admin_preview_customer_inventory"]));
  });

  it("shows the pilot, catalog and deliveries views with live data and never claims unknown is free", async () => {
    spyResponses.tables.dealer_groups = { data: [group] };
    spyResponses.rpcs.inv_admin_overview = { data: emptyOverview };
    spyResponses.rpcs.inv_admin_provider_dashboard = { data: {
      account: { account_ref: "marketcheck_primary", plan_name: "Pilot", pilot_mode: true, monthly_call_quota: 5000, protected_reserve: 1000, priority_floors: { "1": 0, "2": 0, "3": 250, "4": 750 }, monthly_usd_cap: null, rate_limit_per_minute: 60, uncertain_retry_hold_hours: 24 },
      period: { start: "2026-10-01T00:00:00Z", end: "2026-11-01T00:00:00Z", source: "assumed_utc_month" },
      calls: { quota: 5000, consumed: 100, billing_uncertain: 5, reserved: 2, external_unattributed: 0, available: 4893, protected: 1000, spendable: 3893, provider_reported_used: null, provider_reported_remaining: null, provider_reported_at: null },
      usd: { spent: 3.5, committed: 0.1, cap: null, basis: "estimates unless a verified rate or actual cost was recorded" },
      projection: { calls_per_day: 40, exhausts_spendable_at: "2026-11-20T00:00:00Z", exhausts_before_period_end: false },
      by_outcome: { consumed: 100, reused: 7 }, by_channel: { rest: 90, mcp: 10 }, free_refreshes: 0, by_store_product: [], refusals: { daily_cap: 3 }, pending: [], repeat_pulls: [], catalog_review: [{ product_key: "neovin" }],
    } };
    spyResponses.tables.provider_product_catalog = { data: [{
      account_ref: "marketcheck_primary", product_key: "neovin", billing_product: "neovin", label: "NeoVIN decode", endpoint: "/v2/decode/{vin}", bundled_fields: ["build_identity"], billing_unit: "request", quota_units: 1,
      rate_usd: 0.08, rate_status: "list_price_estimate", initial_charge_usd: null, repeat_charge_policy: "unknown", repeat_charge_usd: null, repeat_window_days: null, repeat_allowance: null, repeat_consumes_quota: "unknown",
      retention_policy: "unknown", retention_days: null, cross_store_reuse: "unknown", customer_display: "unknown", update_cadence: "static", freshness_days: null, enabled: true, evidence: null, evidence_url: null, verified_at: null, updated_at: "2026-10-01T00:00:00Z",
    }] };
    spyResponses.rpcs.inv_admin_delivery_timeline = { data: { timing: [], contracts: [], schemas: [], bulk_deliveries: [], filescom_runs: [], exceptions: [] } };
    const pilot = renderAdmin(<InventoryNetworkPage />, { route: "/admin/integrations/inventory-network?view=pilot" });
    expect(await screen.findByText(/Assumed UTC month/)).toBeInTheDocument();
    expect(screen.getByText("Staff AI tools")).toBeInTheDocument();
    pilot.unmount();
    const cat = renderAdmin(<InventoryNetworkPage />, { route: "/admin/integrations/inventory-network?view=catalog" });
    expect(await screen.findByText("Unknown, treated as charged")).toBeInTheDocument();
    expect(screen.queryByText(/^free$/i)).not.toBeInTheDocument();
    cat.unmount();
    renderAdmin(<InventoryNetworkPage />, { route: "/admin/integrations/inventory-network?view=deliveries" });
    expect(await screen.findByText("No open exceptions")).toBeInTheDocument();
    expect(await screen.findByText(/No MarketCheck bulk feed is contracted/)).toBeInTheDocument();
    expect(functionCalls()).toEqual([]);
    expect(writeCalls().filter((c) => c.kind === "table")).toEqual([]);
    expect(new Set(rpcCalls())).toEqual(new Set(["inv_admin_overview", "inv_admin_provider_dashboard", "inv_admin_delivery_timeline"]));
  });
});
