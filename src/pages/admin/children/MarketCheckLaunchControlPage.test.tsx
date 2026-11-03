import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderAdmin } from "@/test/adminRender";
import { functionCalls, resetSupabaseSpy, rpcCalls, spyCalls, spyResponses } from "@/test/mocks/supabaseSpy";
import { STATE_LABEL } from "@/lib/marketcheckLaunch/viewModel";
import type { LaunchState } from "@/lib/marketcheckLaunch/types";
import MarketCheckLaunchControlPage from "./MarketCheckLaunchControlPage";

const mocks = vi.hoisted(() => ({ auth: { user: { id: "u1" }, isAdmin: true, loading: false } }));
vi.mock("@/integrations/supabase/client", async () => {
  const m = await import("@/test/mocks/supabaseSpy");
  return { supabase: m.supabaseSpy };
});
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => mocks.auth }));
vi.mock("@/contexts/TenantContext", () => ({ useTenant: () => ({ tenant: null, currentStore: null }) }));
vi.mock("@/hooks/useEntitlements", () => ({ useEntitlements: () => ({ member: { role: "admin" }, loading: false }) }));
vi.mock("@/contexts/DealerSettingsContext", () => ({ useDealerSettings: () => ({ settings: { dealer_timezone: "UTC" }, loading: false }) }));

const ROUTE = "/admin/integrations/marketcheck/launch-control";
const STOP = "Stop All MarketCheck Paid Calls";
const START = "Start MarketCheck & Inventory Intelligence";

const plan = {
  version: 3, title: "November pilot", status: "approved", canary_store_id: "s1", canary_store_name: "Harte Honda",
  canary_max_calls: 40, canary_window_hours: 6, hourly_call_ceiling: 15, daily_call_ceiling: 90, error_tripwire_per_hour: 4, uncertain_tripwire_per_hour: 2,
  feed_max_age_hours: 24, required_gate_version: "g7", products: ["predict_price", "vin_decode"], allowed_callers: ["enrich-vehicle"], cron_jobs: ["mc-refresh"], account_usd_cap: 250,
  rollout_stores: [
    { store_id: "s1", name: "Harte Honda", order: 1, min_hours_after_previous: 0, active: false, policy_ready: true },
    { store_id: "s2", name: "Harte Toyota", order: 2, min_hours_after_previous: 24, active: false, policy_ready: true },
  ],
  approved_at: "2026-11-01T00:00:00Z",
};
const check = (key: string, label: string, status: string, summary = "ok") => ({ key, label, mandatory: true, status, summary });
const consumption = {
  period_start: "2026-11-01T00:00:00Z", period_end: "2026-12-01T00:00:00Z", period_source: "assumed_utc_month", quota: 1000, protected_reserve: 100, priority_floors: {}, usd_cap: null,
  local_consumed: 12, local_reserved: 0, local_uncertain: 0, usd_spent_estimated: 1.5, usd_committed_estimated: 0,
  provider_reported: { limit: null, used: null, remaining: null, reset_at: null, reported_at: null }, remaining_local: 988, budget_gate: { cap: 900, reserve: 100, enabled: true },
  calls_this_month: 12, denied_this_month: 2, per_product: { vin_decode: 12 }, denials_by_reason: { daily_limit: 2 },
  per_store: [{ store_id: "s1", name: "Harte Honda", mode: "paused", daily_limit: 30, monthly_cap: 300, used_month: 5 }],
  last_success: null, last_error: null, marketcheck_cron: [{ jobid: 1, jobname: "mc-refresh", schedule: "0 * * * *", active: false, target: null }],
};
const status = (over: Record<string, unknown> = {}) => ({
  state: "ready_to_activate", stored_state: "ready_to_activate", activation_on: false, activation_allowed: true, emergency_stop: false, control: {}, has_rollback_snapshot: false,
  plan, readiness: { checks: [check("migrations", "Database migrations", "passed"), check("credentials", "Provider credentials", "passed")], all_mandatory_passed: true, evaluated_at: "2026-11-02T00:00:00Z", plan_version: 3 },
  consumption, heartbeats: [], events: [], ...over,
});
const setStatus = (over: Record<string, unknown> = {}) => { spyResponses.rpcs.marketcheck_launch_status = { data: status(over) }; };
const mutations = () => spyCalls.filter((c) => c.kind === "rpc" && c.fn !== "marketcheck_launch_status");

beforeEach(() => {
  resetSupabaseSpy();
  mocks.auth.isAdmin = true;
});

describe("MarketCheckLaunchControlPage", () => {
  it("shows nothing to a non-admin and makes no calls", () => {
    mocks.auth.isAdmin = false;
    renderAdmin(<MarketCheckLaunchControlPage />, { route: ROUTE });
    expect(screen.getByText("Platform administrators only")).toBeInTheDocument();
    expect(spyCalls).toEqual([]);
  });

  it("renders NOT READY with activation disabled and lists the failing checks", async () => {
    setStatus({
      state: "not_ready", activation_allowed: false,
      readiness: { checks: [check("migrations", "Database migrations", "passed"), check("quota_known", "Monthly quota and remaining calls", "failed", "No provider figures"), check("credentials", "Provider credentials", "unverified", "Not attested")], all_mandatory_passed: false, evaluated_at: "2026-11-02T00:00:00Z", plan_version: 3 },
    });
    renderAdmin(<MarketCheckLaunchControlPage />, { route: ROUTE });
    expect((await screen.findAllByText("NOT READY")).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: START })).toBeDisabled();
    expect(screen.getByText("1 of 3 mandatory checks passed.", { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/Not passed: Monthly quota and remaining calls, Provider credentials/)).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("Unverified")).toBeInTheDocument();
    expect(screen.getAllByText("Not reported by provider").length).toBeGreaterThan(0);
    expect(screen.getByText("No dollar cap")).toBeInTheDocument();
    expect(screen.getByText("Assumed UTC month", { exact: false })).toBeInTheDocument();
  });

  it("enables START at READY TO ACTIVATE and only activates after typing START", async () => {
    setStatus();
    spyResponses.rpcs.marketcheck_launch_activate = { data: { ok: true, state: "activating_canary" } };
    renderAdmin(<MarketCheckLaunchControlPage />, { route: ROUTE });
    const btn = await screen.findByRole("button", { name: START });
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    const dlg = await screen.findByRole("dialog");
    for (const t of ["Harte Honda", "vin_decode", "predict_price", "Canary max calls", "40", "6 hours", "Hourly call ceiling", "Daily call ceiling", "Rollout order", "Harte Toyota"]) {
      expect(within(dlg).getAllByText(t, { exact: false }).length).toBeGreaterThan(0);
    }
    const confirm = within(dlg).getByRole("button", { name: "Start" });
    expect(confirm).toBeDisabled();
    expect(mutations()).toEqual([]);
    fireEvent.change(within(dlg).getByLabelText("Type START to confirm"), { target: { value: "STAR" } });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dlg).getByLabelText("Type START to confirm"), { target: { value: "START" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(mutations()).toEqual([{ kind: "rpc", fn: "marketcheck_launch_activate", args: { p_plan_version: 3, p_confirm: "START" } }]));
    await waitFor(() => expect(rpcCalls().filter((f) => f === "marketcheck_launch_status").length).toBeGreaterThan(1));
  });

  it("shows the server refusal and failed checks", async () => {
    setStatus();
    spyResponses.rpcs.marketcheck_launch_activate = { data: { ok: false, reason: "readiness_failed", failed: [{ key: "credentials", label: "Provider credentials", summary: "stale" }] } };
    renderAdmin(<MarketCheckLaunchControlPage />, { route: ROUTE });
    fireEvent.click(await screen.findByRole("button", { name: START }));
    const dlg = await screen.findByRole("dialog");
    fireEvent.change(within(dlg).getByLabelText("Type START to confirm"), { target: { value: "START" } });
    fireEvent.click(within(dlg).getByRole("button", { name: "Start" }));
    expect(await within(dlg).findByText("Readiness checks did not pass.")).toBeInTheDocument();
    expect(within(dlg).getByText("Provider credentials: stale")).toBeInTheDocument();
  });

  it("keeps emergency stop visible in every state and sends the reason", async () => {
    const states = Object.keys(STATE_LABEL) as LaunchState[];
    for (const st of states) {
      resetSupabaseSpy();
      setStatus({ state: st, emergency_stop: st === "emergency_stop", activation_allowed: st === "ready_to_activate", activation_on: ["activating_canary", "pilot_active", "expanding"].includes(st) });
      const { unmount } = renderAdmin(<MarketCheckLaunchControlPage />, { route: ROUTE });
      expect((await screen.findAllByText(STATE_LABEL[st])).length).toBeGreaterThan(0);
      expect(screen.getAllByRole("button", { name: STOP }).length).toBeGreaterThan(0);
      unmount();
    }
    resetSupabaseSpy();
    setStatus();
    spyResponses.rpcs.marketcheck_emergency_stop = { data: { ok: true, state: "emergency_stop", crons_parked: 2 } };
    renderAdmin(<MarketCheckLaunchControlPage />, { route: ROUTE });
    fireEvent.click((await screen.findAllByRole("button", { name: STOP }))[0]);
    const dlg = await screen.findByRole("dialog");
    const go = within(dlg).getByRole("button", { name: "Stop all paid calls" });
    expect(go).toBeDisabled();
    fireEvent.change(within(dlg).getByLabelText("Reason (required)"), { target: { value: "runaway spend" } });
    fireEvent.click(go);
    await waitFor(() => expect(mutations()).toEqual([{ kind: "rpc", fn: "marketcheck_emergency_stop", args: { p_reason: "runaway spend" } }]));
  });

  it("offers the SQL fallback and release when stopped", async () => {
    setStatus({ state: "emergency_stop", emergency_stop: true, activation_allowed: false });
    renderAdmin(<MarketCheckLaunchControlPage />, { route: ROUTE });
    expect(await screen.findByRole("button", { name: "Release stop" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Run stop drill" })).not.toBeInTheDocument();
    expect(screen.getByText("UPDATE public.marketcheck_launch_control SET emergency_stop = true, state = 'emergency_stop' WHERE id = 1;")).toBeInTheDocument();
  });

  it("shows an unknown state, not passed checks, when the status read fails", async () => {
    renderAdmin(<MarketCheckLaunchControlPage />, { route: ROUTE });
    expect(await screen.findByText("Launch status is Unknown")).toBeInTheDocument();
    expect(screen.queryByText("Passed")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: START })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: STOP }).length).toBeGreaterThan(0);
  });

  it("shows the account dollar cap on the plan", async () => {
    setStatus();
    renderAdmin(<MarketCheckLaunchControlPage />, { route: ROUTE });
    await screen.findByRole("button", { name: START });
    expect(screen.getByText("Account dollar cap")).toBeInTheDocument();
    expect(screen.getByText("$250.00 / month")).toBeInTheDocument();
  });

  it("says no scheduled jobs when the plan has none", async () => {
    setStatus({ plan: { ...plan, cron_jobs: [] } });
    renderAdmin(<MarketCheckLaunchControlPage />, { route: ROUTE });
    await screen.findByRole("button", { name: START });
    expect(screen.getByText("No scheduled jobs are turned on by this plan")).toBeInTheDocument();
  });

  it("lists every plan rooftop, marks the canary, and shows the workload START begins", async () => {
    const stores = [
      { store_id: "s1", name: "Harte Honda", role: "canary", order: 0, identity_verified: true, feed_paused: false, store_status: "active", mapping: { source_dealer_id: "MP1", status: "approved", verdict: "match" }, feed_clean: true, policy_ready: true, active_in_launch: false },
      { store_id: "s2", name: "Harte Toyota", role: "expansion", order: 1, identity_verified: false, feed_paused: true, store_status: "active", mapping: { source_dealer_id: "MP2", status: "pending", verdict: null }, feed_clean: false, policy_ready: false, active_in_launch: false },
    ];
    const workload = { caller: "marketcheck-specs", function: "marketcheck-specs", max_vehicles_per_store: 20, calls_per_vehicle: 2, batch_size: 2, response_timeout_minutes: 10 };
    setStatus({
      plan: { ...plan, workload, canary_store_usd_cap: 10 },
      readiness: { checks: [check("migrations", "Database migrations", "passed"), { key: "rooftop_mappings", label: "All plan rooftops", mandatory: false, status: "failed", summary: "1 of 2", detail: { stores } }], all_mandatory_passed: true, evaluated_at: "2026-11-02T00:00:00Z", plan_version: 3 },
      workload: { definition: workload, counts: { queued: 3, dispatched: 2, done: 1 }, admissions: 3, last_dispatch: null },
    });
    renderAdmin(<MarketCheckLaunchControlPage />, { route: ROUTE });
    await screen.findByRole("button", { name: START });
    const table = screen.getByRole("table", { name: "Plan rooftops" });
    expect(within(table).getByText("Canary")).toBeInTheDocument();
    expect(within(table).getByText("Verified (MP1)")).toBeInTheDocument();
    expect(within(table).getByText("MP2: pending")).toBeInTheDocument();
    expect(screen.getByText("3 queued, 2 in flight, 1 done, 0 failed")).toBeInTheDocument();
    expect(screen.getAllByText("Up to 20 vehicles per store through marketcheck-specs, at most 2 calls each, 2 at a time").length).toBeGreaterThan(0);
    expect(screen.getByText("$10.00 / month")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: START })).toBeEnabled();
  });

  it("disables Approve while the draft plan has no cap and sets the cap with the RPC payload", async () => {
    setStatus({ plan: { ...plan, status: "draft", account_usd_cap: null } });
    spyResponses.rpcs.marketcheck_launch_set_plan_usd_cap = { data: { ok: true, version: 3, account_usd_cap: 125.5 } };
    renderAdmin(<MarketCheckLaunchControlPage />, { route: ROUTE });
    expect(await screen.findByText("Not set - required before approval")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve plan" })).toBeDisabled();
    expect(screen.getByText("Approval needs an account dollar cap")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Set dollar cap" }));
    const dlg = await screen.findByRole("dialog");
    const go = within(dlg).getByRole("button", { name: "Set dollar cap" });
    const input = within(dlg).getByLabelText("Account dollar cap per month");
    expect(go).toBeDisabled();
    for (const bad of ["0", "-5", "100001"]) {
      fireEvent.change(input, { target: { value: bad } });
      expect(go).toBeDisabled();
    }
    fireEvent.change(input, { target: { value: "125.5" } });
    expect(go).toBeEnabled();
    fireEvent.click(go);
    await waitFor(() => expect(mutations()).toEqual([{ kind: "rpc", fn: "marketcheck_launch_set_plan_usd_cap", args: { p_version: 3, p_usd_cap: 125.5 } }]));
  });

  it("enables Approve on a draft plan once a cap is set", async () => {
    setStatus({ plan: { ...plan, status: "draft", account_usd_cap: 100 } });
    renderAdmin(<MarketCheckLaunchControlPage />, { route: ROUTE });
    expect(await screen.findByRole("button", { name: "Approve plan" })).toBeEnabled();
  });

  it("offers Record evidence only for hand-attested checks", async () => {
    const keys = ["credentials", "mcp_boundary", "quota_concurrency", "sticker_templates", "print_passport_qa", "cost_controls", "sticker_generation", "stop_drill", "edge_versions"];
    setStatus({ readiness: { checks: keys.map((k) => check(k, `Label ${k}`, "unverified")), all_mandatory_passed: false, evaluated_at: "2026-11-02T00:00:00Z", plan_version: 3 } });
    renderAdmin(<MarketCheckLaunchControlPage />, { route: ROUTE });
    await screen.findByText("Label cost_controls");
    expect(screen.getAllByRole("button", { name: "Record evidence" })).toHaveLength(5);
    for (const k of ["cost_controls", "sticker_generation", "stop_drill", "edge_versions"]) {
      const row = screen.getByText(`Label ${k}`).closest("li")!;
      expect(within(row).queryByRole("button", { name: "Record evidence" })).not.toBeInTheDocument();
    }
    const row = screen.getByText("Label mcp_boundary").closest("li")!;
    expect(within(row).getByRole("button", { name: "Record evidence" })).toBeInTheDocument();
  });

  it("shows the drill summary on success and on failure", async () => {
    setStatus();
    spyResponses.rpcs.marketcheck_launch_stop_drill = { data: { ok: true, summary: "Stop refused 3 admission(s); all restored.", detail: {} } };
    renderAdmin(<MarketCheckLaunchControlPage />, { route: ROUTE });
    fireEvent.click(await screen.findByRole("button", { name: "Run stop drill" }));
    expect(await screen.findByText("Stop refused 3 admission(s); all restored.")).toBeInTheDocument();
    spyResponses.rpcs.marketcheck_launch_stop_drill = { data: { ok: false, summary: "The stop did not refuse at every boundary; see detail.", detail: {} } };
    fireEvent.click(screen.getByRole("button", { name: "Run stop drill" }));
    expect(await screen.findByText("The stop did not refuse at every boundary; see detail.")).toBeInTheDocument();
  });

  it("makes no mutation and no edge call on mount", async () => {
    setStatus();
    renderAdmin(<MarketCheckLaunchControlPage />, { route: ROUTE });
    await screen.findByRole("button", { name: START });
    expect(rpcCalls()).toEqual(["marketcheck_launch_status"]);
    expect(functionCalls()).toEqual([]);
    expect(spyCalls.filter((c) => c.kind === "table")).toEqual([]);
  });

  it("maps all eight states to their labels", () => {
    expect(STATE_LABEL).toEqual({
      not_ready: "NOT READY", ready_to_activate: "READY TO ACTIVATE", activating_canary: "ACTIVATING CANARY", pilot_active: "PILOT ACTIVE",
      expanding: "EXPANDING APPROVED STORES", paused: "PAUSED", emergency_stop: "EMERGENCY STOP", activation_failed: "ACTIVATION FAILED",
    });
  });
});
