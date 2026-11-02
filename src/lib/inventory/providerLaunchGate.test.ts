import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { admitProviderCall, PROVIDER_GATE_VERSION, reserveAccountQuota, admitStoreEnrichment } from "../../../supabase/functions/_shared/providerBudget";
import { isLaunchGateReason, parseAdmitRow } from "../../../supabase/functions/_shared/providerBudgetPolicy";

const MC_URL = "https://api.marketcheck.com/v2/decode/car/neovin/1HGCM82633A004352/specs?api_key=K";
type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
const client = (impl: Rpc) => ({ rpc: vi.fn(impl) });

describe("MarketCheck launch gate (migration 0018)", () => {
  it("admits through provider_call_admit_v2 and sends the gate version", async () => {
    const admin = client(async (fn) => {
      if (fn === "provider_call_admit_v2") return { data: [{ admitted: true, event_id: 9, reason: "admitted" }], error: null };
      if (fn === "provider_reserve") return { data: { reserved: true, request_id: "r9" }, error: null };
      return { data: null, error: null };
    });
    const r = await admitProviderCall(admin, { url: MC_URL, caller: "marketcheck-specs" });
    expect(r).toMatchObject({ admitted: true, accountRequestId: "r9" });
    expect(admin.rpc).toHaveBeenCalledWith("provider_call_admit_v2", expect.objectContaining({ p_gate_version: PROVIDER_GATE_VERSION, p_caller: "marketcheck-specs" }));
    expect(admin.rpc).not.toHaveBeenCalledWith("provider_call_admit", expect.anything());
  });

  it("reads launch refusals as launch_gate and keeps the database's reason", async () => {
    for (const reason of ["launch_inactive", "emergency_stop", "launch_paused_canary_ceiling_reached", "launch_store_not_active", "launch_store_mismatch",
      "launch_vin_ownership_ambiguous", "launch_store_required", "launch_product_not_approved", "launch_product_mismatch", "launch_gate_version_mismatch", "gate_upgrade_required"]) {
      const admin = client(async (fn) => (fn === "provider_call_admit_v2" ? { data: [{ admitted: false, event_id: 3, reason }], error: null } : { data: null, error: null }));
      const r = await admitProviderCall(admin, { url: MC_URL, caller: "marketcheck-sync", essential: true });
      expect(r).toMatchObject({ admitted: false, reason: "launch_gate", launchReason: reason });
      expect(admin.rpc).not.toHaveBeenCalledWith("provider_reserve", expect.anything());
    }
  });

  it("sends the catalog product and the caller's store so the database can scope the rooftop", async () => {
    const admin = client(async (fn) => (fn === "provider_call_admit_v2" ? { data: [{ admitted: false, event_id: 4, reason: "launch_inactive" }], error: null }
      : fn === "store_enrichment_admit" ? { data: { admitted: true }, error: null } : { data: null, error: null }));
    await admitProviderCall(admin, { url: MC_URL, caller: "marketcheck-specs", tenantId: "t1", vin: "1HGCM82633A004352" });
    expect(admin.rpc).toHaveBeenCalledWith("provider_call_admit_v2", expect.objectContaining({ p_catalog_product: "neovin", p_product: "neovin", p_store_id: null, p_vin: "1HGCM82633A004352" }));
    const synd = "https://api.marketcheck.com/v2/dealerships/inventory?api_key=K&dealer_id=1";
    await admitProviderCall(admin, { url: synd, caller: "marketcheck-sync", tenantId: "t1", storeId: "s1" });
    expect(admin.rpc).toHaveBeenCalledWith("provider_call_admit_v2", expect.objectContaining({ p_catalog_product: "syndication", p_product: "dealer_inventory_syndication", p_store_id: "s1" }));
  });

  it("other providers send no catalog product", async () => {
    const admin = client(async () => ({ data: [{ admitted: false, event_id: 5, reason: "monthly_cap" }], error: null }));
    await admitProviderCall(admin, { url: "https://x.invalid/a", caller: "google-reviews", provider: "google_places", product: "place_details" });
    expect(admin.rpc).toHaveBeenCalledWith("provider_call_admit_v2", expect.objectContaining({ p_catalog_product: null }));
  });

  it("an admitted row carrying a launch reason is malformed and refused", () => {
    expect(parseAdmitRow({ admitted: true, event_id: 1, reason: "launch_inactive" })?.reason).toBe("gate_unavailable");
    expect(isLaunchGateReason("launch_paused_provider_errors")).toBe(true);
    expect(isLaunchGateReason("monthly_cap")).toBe(false);
  });

  it("refuses when the account coordinator is not installed (no compatibility pass)", async () => {
    for (const code of ["PGRST202", "42883"]) {
      const admin = client(async () => ({ data: null, error: { code, message: "function does not exist" } }));
      const r = await reserveAccountQuota(admin, { url: MC_URL, caller: "t" }, 5);
      expect(r).toEqual({ reserved: false, reason: "coordinator_not_installed" });
    }
  });

  it("refuses when the reservation trigger reports the launch gate closed", async () => {
    const admin = client(async () => ({ data: null, error: { code: "P0001", message: "launch_gate_closed: emergency_stop" } }));
    expect(await reserveAccountQuota(admin, { url: MC_URL, caller: "t" }, 5)).toEqual({ reserved: false, reason: "launch_gate_closed" });
  });

  it("refuses when the store enrichment gate is not installed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const admin = client(async () => ({ data: null, error: { code: "PGRST202", message: "missing" } }));
    expect(await admitStoreEnrichment(admin, { url: MC_URL, caller: "t", tenantId: "t1", vin: "1HGCM82633A004352" }, "neovin"))
      .toEqual({ admitted: false, reason: "store_gate_not_installed" });
    warn.mockRestore();
  });

  it("an admitted call whose coordinator is missing is closed as refused in the ledger", async () => {
    const admin = client(async (fn) => {
      if (fn === "provider_call_admit_v2") return { data: [{ admitted: true, event_id: 11, reason: "admitted" }], error: null };
      if (fn === "provider_reserve") return { data: null, error: { code: "PGRST202", message: "missing" } };
      return { data: null, error: null };
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await admitProviderCall(admin, { url: MC_URL, caller: "t" });
    warn.mockRestore();
    expect(r).toMatchObject({ admitted: false, reason: "account_quota", accountReason: "coordinator_not_installed" });
    expect(admin.rpc).toHaveBeenCalledWith("provider_call_record", expect.objectContaining({ p_event_id: 11, p_outcome: "budget_denied" }));
  });

  it("the edge copy of the gate has no remaining compatibility admission", () => {
    const src = readFileSync("supabase/functions/_shared/providerBudget.ts", "utf8");
    expect(src).not.toMatch(/reserved:\s*true,\s*reason:\s*"coordinator_not_installed"/);
    expect(src).not.toMatch(/admitted:\s*true,\s*reason:\s*"store_gate_not_installed"/);
  });

  it("the migration keeps the old entry point refusing MarketCheck and starts the switch OFF", () => {
    const sql = readFileSync("drizzle/migrations/0018_marketcheck_launch_control.sql", "utf8");
    expect(sql).toMatch(/RENAME TO provider_call_admit_core/);
    expect(sql).toMatch(/'gate_upgrade_required'/);
    expect(sql).toMatch(/state text NOT NULL DEFAULT 'not_ready'/);
    expect(sql).toMatch(/emergency_stop boolean NOT NULL DEFAULT false/);
    expect(sql).not.toMatch(/INSERT INTO public\.marketcheck_launch_plans[\s\S]*'approved'/);
  });
});
