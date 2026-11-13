import { describe, it, expect, vi, afterEach } from "vitest";
import { checkCallPolicy, decideCallPolicy, readCallPolicy, REPEAT_GRACE_MS, type CallPolicyConfig, type ScopeFacts } from "./callPolicy";
import { admitProviderCall } from "../providerBudget";

const NOW = Date.parse("2026-11-12T20:00:00Z");
const VIN = "1HGCM82633A004352";
const cfg = (over: Partial<CallPolicyConfig> = {}): CallPolicyConfig => ({ mode: "primary_only", monthlyLimit: 3000, vinTtlHours: 168, scheduledRefresh: false, ...over });
const facts = (over: Partial<ScopeFacts> = {}): ScopeFacts => ({ listing: { archived: false, storeId: null }, storeIsPrimary: null, lastBillableAtMs: null, monthBillable: 10, ...over });
const input = (over: Record<string, unknown> = {}) => ({ config: cfg(), essential: false, tenantId: "t1", vin: VIN, product: "inventory_search", nowMs: NOW, ...over });

describe("readCallPolicy", () => {
  it("defaults to off with a 3000 monthly limit and a 7-day VIN window", () => {
    expect(readCallPolicy(() => undefined)).toEqual({ mode: "off", monthlyLimit: 3000, vinTtlHours: 168, scheduledRefresh: false });
  });
  it("reads the modes and rejects junk", () => {
    expect(readCallPolicy((k) => ({ MARKETCHECK_MODE: " PRIMARY_ONLY " } as Record<string, string>)[k]).mode).toBe("primary_only");
    expect(readCallPolicy((k) => ({ MARKETCHECK_MODE: "on" } as Record<string, string>)[k]).mode).toBe("off");
    const env: Record<string, string> = { MARKETCHECK_MONTHLY_LIMIT: "-4", MARKETCHECK_VIN_TTL_HOURS: "24", MARKETCHECK_SCHEDULED_REFRESH: "true" };
    expect(readCallPolicy((k) => env[k])).toMatchObject({ monthlyLimit: 3000, vinTtlHours: 24, scheduledRefresh: true });
  });
});

describe("decideCallPolicy", () => {
  it("off refuses everything, the feed included; unrestricted admits", () => {
    expect(decideCallPolicy(input({ config: cfg({ mode: "off" }), essential: true }), facts())).toEqual({ admitted: false, reason: "kill_switch" });
    expect(decideCallPolicy(input({ config: cfg({ mode: "unrestricted" }), tenantId: null }), null)).toEqual({ admitted: true });
  });
  it("admits the tenant's own unarchived listing", () => {
    expect(decideCallPolicy(input(), facts())).toEqual({ admitted: true });
  });
  it("refuses a call with no tenant, or with facts it could not read", () => {
    expect(decideCallPolicy(input({ tenantId: null }), facts())).toMatchObject({ reason: "no_tenant" });
    expect(decideCallPolicy(input(), null)).toMatchObject({ reason: "policy_unavailable" });
  });
  it("refuses a VIN outside the tenant's inventory except the intake decode", () => {
    expect(decideCallPolicy(input(), facts({ listing: null }))).toMatchObject({ reason: "not_tenant_inventory" });
    expect(decideCallPolicy(input({ product: "neovin" }), facts({ listing: null }))).toEqual({ admitted: true });
  });
  it("refuses archived listings and stores that are not the primary inventory store", () => {
    expect(decideCallPolicy(input(), facts({ listing: { archived: true, storeId: null } }))).toMatchObject({ reason: "archived" });
    expect(decideCallPolicy(input(), facts({ listing: { archived: false, storeId: "s2" }, storeIsPrimary: false }))).toMatchObject({ reason: "not_primary_store" });
    expect(decideCallPolicy(input(), facts({ listing: { archived: false, storeId: "s1" }, storeIsPrimary: true }))).toEqual({ admitted: true });
  });
  it("allows one billable call per VIN and product inside the window, but not a visit's own follow-ups", () => {
    expect(decideCallPolicy(input(), facts({ lastBillableAtMs: NOW - 3 * 3600_000 }))).toMatchObject({ reason: "vin_repeat_window" });
    expect(decideCallPolicy(input(), facts({ lastBillableAtMs: NOW - REPEAT_GRACE_MS + 1000 }))).toEqual({ admitted: true });
    expect(decideCallPolicy(input(), facts({ lastBillableAtMs: NOW - 169 * 3600_000 }))).toEqual({ admitted: true });
  });
  it("stops non-essential calls at the monthly limit and lets the feed through", () => {
    expect(decideCallPolicy(input(), facts({ monthBillable: 3000 }))).toMatchObject({ reason: "monthly_limit" });
    expect(decideCallPolicy(input({ vin: null, essential: true }), facts({ monthBillable: 3000 }))).toEqual({ admitted: true });
  });
});

type Answer = { data?: unknown; error?: unknown; count?: number | null };
function fakeDb(tables: Record<string, Answer | ((filters: string[]) => Answer)>) {
  const from = vi.fn((table: string) => {
    const filters: string[] = [];
    const q: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "gte", "lte", "order", "limit"]) {
      q[m] = (...args: unknown[]) => { filters.push(`${m}:${JSON.stringify(args)}`); return q; };
    }
    q.then = (res: (v: Answer) => unknown, rej: (e: unknown) => unknown) => {
      const t = tables[table];
      const a = typeof t === "function" ? t(filters) : t ?? { data: [], error: null };
      return Promise.resolve(a).then(res, rej);
    };
    return q;
  });
  return { from };
}

describe("checkCallPolicy against the database", () => {
  const events = (filters: string[]): Answer =>
    filters.some((f) => f.startsWith("select:") && f.includes("head"))
      ? { count: 42, error: null }
      : { data: [], error: null };

  it("admits a primary-store listing and reads its store", async () => {
    const db = fakeDb({
      provider_call_events: events,
      vehicle_listings: { data: [{ archived_at: null, owning_store_id: "s1" }], error: null },
      dealer_stores: { data: [{ is_primary_inventory_store: true }], error: null },
    });
    const r = await checkCallPolicy(db, { caller: "t", essential: false, tenantId: "t1", vin: VIN.toLowerCase(), product: "inventory_search" }, cfg(), NOW);
    expect(r).toEqual({ admitted: true });
    expect(db.from).toHaveBeenCalledWith("dealer_stores");
  });

  it("refuses when any read fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const db = fakeDb({ provider_call_events: events, vehicle_listings: { data: null, error: { message: "boom" } } });
    const r = await checkCallPolicy(db, { caller: "t", essential: false, tenantId: "t1", vin: VIN, product: "inventory_search" }, cfg(), NOW);
    expect(r).toMatchObject({ admitted: false, reason: "policy_unavailable" });
    warn.mockRestore();
  });

  it("refuses when the client cannot read tables", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const r = await checkCallPolicy({}, { caller: "t", essential: false, tenantId: "t1", vin: VIN, product: "inventory_search" }, cfg(), NOW);
    expect(r).toMatchObject({ reason: "policy_unavailable" });
    warn.mockRestore();
  });
});

describe("admitProviderCall honors the switch", () => {
  const prev = process.env.MARKETCHECK_MODE;
  afterEach(() => { process.env.MARKETCHECK_MODE = prev; });

  it("with the mode unset, no MarketCheck call reaches the budget gates and the log carries no key", async () => {
    delete process.env.MARKETCHECK_MODE;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    const r = await admitProviderCall({ rpc }, { url: `https://api.marketcheck.com/v2/dealerships/inventory?api_key=SECRET-1`, caller: "marketcheck-sync", essential: true, tenantId: "t1" });
    expect(r).toMatchObject({ admitted: false, reason: "call_policy", policyReason: "kill_switch" });
    expect(rpc).not.toHaveBeenCalled();
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/SECRET-1|api_key/);
    warn.mockRestore();
  });

  it("other providers are untouched by the MarketCheck switch", async () => {
    delete process.env.MARKETCHECK_MODE;
    const rpc = vi.fn(async (fn: string) => fn === "provider_call_admit"
      ? { data: [{ admitted: true, event_id: 3, reason: "admitted" }], error: null }
      : { data: null, error: null });
    const r = await admitProviderCall({ rpc }, { url: "https://api.firecrawl.dev/v2/scrape", caller: "crawl", provider: "firecrawl", product: "scrape" });
    expect(r.admitted).toBe(true);
  });
});
