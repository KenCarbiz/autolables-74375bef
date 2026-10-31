import { describe, expect, it, vi } from "vitest";
import { cheapestCover, planEnrichment, type CatalogProduct, type PlanInput } from "./planner";
import { classifyDecode, readConfidence, readProviderDates, readQuotaHeaders, vinLooksValid } from "./responseSemantics";
import { catalogProductForUrl, requestDedupeKey } from "./catalogKeys";
import { admitProviderCall, recordProviderCall } from "../providerBudget";
import { settlementForAnswer } from "../providerBudgetPolicy";

const P = (o: Partial<CatalogProduct> & Pick<CatalogProduct, "productKey" | "bundledFields">): CatalogProduct => ({
  label: o.productKey, rateUsd: 0.07, rateStatus: "list_price_estimate", quotaUnits: 1, repeatChargePolicy: "unknown", repeatChargeUsd: null,
  repeatWindowDays: null, repeatConsumesQuota: "unknown", retentionPolicy: "unknown", retentionDays: null, crossStoreReuse: "unknown",
  customerDisplay: "unknown", updateCadence: "static", freshnessDays: null, verifiedAt: null, enabled: true, ...o,
});
const CATALOG = [
  P({ productKey: "neovin", rateUsd: 0.08, bundledFields: ["build_identity", "installed_equipment", "msrp_build", "factory_warranty_spec"] }),
  P({ productKey: "basic_decode", rateUsd: 0.0015, bundledFields: ["build_identity"] }),
  P({ productKey: "price_base", bundledFields: ["valuation"], updateCadence: "freshness_or_input_change", freshnessDays: 7 }),
  P({ productKey: "price_premium", bundledFields: ["valuation", "comparables"], updateCadence: "freshness_or_input_change", freshnessDays: 7 }),
  P({ productKey: "price_premium_plus", bundledFields: ["valuation", "comparables", "build_identity", "installed_equipment", "msrp_build", "factory_warranty_spec"], updateCadence: "freshness_or_input_change", freshnessDays: 7 }),
  P({ productKey: "vin_history", rateUsd: 0.006, bundledFields: ["listing_history"], updateCadence: "freshness", freshnessDays: 30 }),
  P({ productKey: "sales_stats", rateUsd: 0.002, bundledFields: ["inferred_sales"], updateCadence: "monthly_dataset" }),
];
const ALL = CATALOG.map((p) => p.productKey);
const base = (o: Partial<PlanInput> = {}): PlanInput => ({
  requiredFields: [], approvedProducts: ALL, catalog: CATALOG, held: [], storeId: "s1", inputsHash: "h1", now: new Date("2026-10-31T12:00:00Z"), use: "internal", ...o,
});

describe("bundle selection", () => {
  it("valuation, comparables and the decode come from one Premium Plus call, not a separate NeoVIN call", () => {
    const plan = planEnrichment(base({ requiredFields: ["valuation", "comparables", "installed_equipment"] }));
    expect(plan.calls.map((c) => c.productKey)).toEqual(["price_premium_plus"]);
    expect(plan.totalQuotaUnits).toBe(1);
  });
  it("only identity needed: the cheapest product that covers it", () => {
    expect(cheapestCover(["build_identity"], CATALOG)!.map((p) => p.productKey)).toEqual(["basic_decode"]);
  });
  it("without Premium Plus approved, it uses the fewest calls", () => {
    const plan = planEnrichment(base({ requiredFields: ["valuation", "comparables", "installed_equipment"], approvedProducts: ["neovin", "price_premium", "price_base"] }));
    expect(plan.calls.map((c) => c.productKey).sort()).toEqual(["neovin", "price_premium"]);
  });
  it("explains when turning a field off does not change the price", () => {
    const plan = planEnrichment(base({ requiredFields: ["valuation", "comparables", "installed_equipment"] }));
    expect(plan.explanations.join(" ")).toMatch(/Disabling comparables saves nothing/);
    expect(plan.explanations.join(" ")).toMatch(/turning those off does not change the price/);
  });
  it("a field no approved product supplies is blocked, not bought elsewhere", () => {
    const plan = planEnrichment(base({ requiredFields: ["listing_history"], approvedProducts: ["neovin"] }));
    expect(plan.fields[0]).toMatchObject({ field: "listing_history", action: "blocked" });
    expect(plan.calls).toEqual([]);
  });
  it("remaining warranty is recalculated, never requested", () => {
    const plan = planEnrichment(base({ requiredFields: ["warranty_remaining"], held: [{ productKey: "neovin", fields: ["factory_warranty_spec"], fetchedAt: "2026-01-01T00:00:00Z", storeId: "s1", inputsHash: null, paid: true }] }));
    expect(plan.fields.find((f) => f.field === "warranty_remaining")!.action).toBe("recalculate");
    expect(plan.calls).toEqual([]);
  });
  it("unknown repeat billing is never labelled free", () => {
    const plan = planEnrichment(base({ requiredFields: ["valuation"], approvedProducts: ["price_base"], held: [{ productKey: "price_base", fields: ["valuation"], fetchedAt: "2026-10-01T00:00:00Z", storeId: "s1", inputsHash: "h1", paid: true }] }));
    expect(plan.calls[0]).toMatchObject({ freeRefresh: false, estimatedUsd: 0.07 });
    expect(plan.explanations.join(" ")).toMatch(/repeat billing is unknown/);
  });
  it("a verified free repeat is used inside its window but still counts quota while that is unknown", () => {
    const cat = CATALOG.map((p) => p.productKey === "price_base" ? { ...p, repeatChargePolicy: "free_within_window" as const, repeatWindowDays: 30, repeatChargeUsd: 0, verifiedAt: "2026-10-01" } : p);
    const plan = planEnrichment(base({ catalog: cat, requiredFields: ["valuation"], approvedProducts: ["price_base"], held: [{ productKey: "price_base", fields: ["valuation"], fetchedAt: "2026-10-20T00:00:00Z", storeId: "s1", inputsHash: "h0", paid: true }] }));
    expect(plan.calls[0]).toMatchObject({ freeRefresh: true, estimatedUsd: 0, quotaUnits: 1 });
    expect(plan.fields[0].action).toBe("free_refresh");
  });
});

describe("reuse and cadence", () => {
  const held = (o: Partial<PlanInput["held"][0]>) => ({ productKey: "neovin", fields: ["installed_equipment"], fetchedAt: "2026-03-01T00:00:00Z", storeId: "s1", inputsHash: null, paid: true, ...o });
  it("a static decode is reused for the same store, flagged for retention review", () => {
    const plan = planEnrichment(base({ requiredFields: ["installed_equipment"], held: [held({})] }));
    expect(plan.fields[0]).toMatchObject({ action: "reuse", review: ["retention"] });
    expect(plan.calls).toEqual([]);
  });
  it("another store's answer is not reused while cross-store reuse is unverified", () => {
    const plan = planEnrichment(base({ requiredFields: ["installed_equipment"], held: [held({ storeId: "s2" })] }));
    expect(plan.calls.length).toBe(1);
    expect(plan.fields[0].why).toMatch(/cross-store reuse is not verified/);
  });
  it("valuation is refreshed when its inputs change", () => {
    const plan = planEnrichment(base({ requiredFields: ["valuation"], approvedProducts: ["price_base"], held: [held({ productKey: "price_base", fields: ["valuation"], fetchedAt: "2026-10-30T00:00:00Z", inputsHash: "old" })] }));
    expect(plan.calls.map((c) => c.productKey)).toEqual(["price_base"]);
  });
  it("inferred sales are reused until the provider's monthly regeneration", () => {
    const sameMonth = planEnrichment(base({ requiredFields: ["inferred_sales"], held: [held({ productKey: "sales_stats", fields: ["inferred_sales"], fetchedAt: "2026-10-02T00:00:00Z" })] }));
    expect(sameMonth.calls).toEqual([]);
    const nextMonth = planEnrichment(base({ requiredFields: ["inferred_sales"], now: new Date("2026-11-01T01:00:00Z"), held: [held({ productKey: "sales_stats", fields: ["inferred_sales"], fetchedAt: "2026-10-02T00:00:00Z" })] }));
    expect(nextMonth.calls.map((c) => c.productKey)).toEqual(["sales_stats"]);
  });
  it("customer display of a field with unknown display rights is flagged for review", () => {
    const plan = planEnrichment(base({ use: "customer_display", requiredFields: ["installed_equipment"], held: [held({})] }));
    expect(plan.fields[0].review).toContain("customer_display");
  });
});

describe("response semantics", () => {
  it("checks the VIN locally before spending", () => {
    expect(vinLooksValid("1HGCM82633A004352").valid).toBe(true);
    expect(vinLooksValid("1HGCM82633A004353").valid).toBe(false);
    expect(vinLooksValid("WVWZZZ1JZXW000001").valid).toBe(true);
    expect(vinLooksValid("SHORT").valid).toBe(false);
  });
  it("distinguishes the nine decode states", () => {
    const req = ["build_identity", "installed_equipment"];
    expect(classifyDecode(null, null, req, true)).toMatchObject({ state: "billing_uncertain", billing: "billing_uncertain" });
    expect(classifyDecode(400, "Invalid VIN", req).state).toBe("invalid_vin");
    expect(classifyDecode(422, "vehicle not supported", req).state).toBe("unsupported");
    expect(classifyDecode(404, "", req).state).toBe("unavailable");
    expect(classifyDecode(503, "", req)).toMatchObject({ state: "temporarily_failed", billing: "billing_uncertain" });
    expect(classifyDecode(429, "quota", req)).toMatchObject({ billing: "no_charge" });
    expect(classifyDecode(200, { year: 2024, make: "Nissan", model: "Rogue", is_generic: true }, req).state).toBe("ambiguous");
    expect(classifyDecode(200, { year: 2024, make: "Nissan", model: "Rogue", trim: "SV" }, req)).toMatchObject({ state: "partial", presentFields: ["build_identity"] });
    expect(classifyDecode(200, { year: 2024, make: "Nissan", model: "Rogue", trim: "SV", options: [{ name: "x" }] }, req).state).toBe("complete");
  });
  it("detects the confidence scale instead of assuming it", () => {
    expect(readConfidence({ record_confidence: 0.98 })).toMatchObject({ scale: "fraction", fraction: 0.98 });
    expect(readConfidence({ record_confidence: 98, trim_confidence: 90 })).toMatchObject({ scale: "percent", fraction: 0.98 });
    expect(readConfidence({ record_confidence: 1 })).toMatchObject({ scale: "unknown", fraction: null });
    expect(readConfidence({}).meaning).toMatch(/not a guarantee/);
  });
  it("keeps the data delivery date apart from vehicle and warranty dates", () => {
    expect(readProviderDates({ delivery_date: "2026-10-01" })).toEqual({ dataDeliveryDate: "2026-10-01", warrantyInServiceDate: null });
    expect(readProviderDates({ in_service_date: "2024-05-02T00:00:00Z" }).warrantyInServiceDate).toBe("2024-05-02");
  });
  it("reads quota headers only when present and never guesses a reset zone", () => {
    const now = new Date("2026-10-31T12:00:00Z");
    expect(readQuotaHeaders({ "X-RateLimit-Limit": "5000", "X-RateLimit-Remaining": "4200", "X-RateLimit-Reset": "1793491200" }, now)).toMatchObject({ limit: 5000, remaining: 4200, resetAt: "2026-11-01T00:00:00.000Z" });
    expect(readQuotaHeaders({ "X-RateLimit-Reset": "2026-11-01 00:00" }, now).resetAt).toBeNull();
    expect(readQuotaHeaders({}, now)).toMatchObject({ limit: null, remaining: null, resetAt: null, source: [] });
  });
  it("maps price endpoints to their own catalog products", () => {
    expect(catalogProductForUrl("https://api.marketcheck.com/v2/predict/car/us/marketcheck_price/comparables/decode?vin=X")).toBe("price_premium_plus");
    expect(catalogProductForUrl("https://api.marketcheck.com/v2/predict/car/us/marketcheck_price/comparables?vin=X")).toBe("price_premium");
    expect(catalogProductForUrl("https://api.marketcheck.com/v2/predict/car/us/marketcheck_price?vin=X")).toBe("price_base");
  });
  it("dedupe keys never contain the credential", async () => {
    const a = await requestDedupeKey("https://api.marketcheck.com/v2/search/car/active?api_key=SECRET1&zip=06120");
    const b = await requestDedupeKey("https://api.marketcheck.com/v2/search/car/active?zip=06120&api_key=SECRET2");
    expect(a).toBe(b);
    expect(a).not.toMatch(/SECRET/);
  });
});

describe("account coordinator in the shared gate", () => {
  const URL = "https://api.marketcheck.com/v2/decode/car/neovin/1N4AZ1CP0LC000001/specs?api_key=K";
  const admin = (reserve: unknown) => ({
    rpc: vi.fn(async (fn: string) => {
      if (fn === "provider_reserve") return reserve instanceof Error ? { data: null, error: { message: "x", code: "XX000" } } : { data: reserve, error: null };
      if (fn === "store_enrichment_admit") return { data: { admitted: true }, error: null };
      return { data: [{ admitted: true, event_id: 9, month_calls: 0, monthly_call_cap: 100, reason: "admitted" }], error: null };
    }),
  });
  it("every MarketCheck call reserves account quota with its priority", async () => {
    const a = admin({ reserved: true, request_id: "r1" });
    const r = await admitProviderCall(a, { url: URL, caller: "vehicle-enrich", tenantId: "t", vin: "1N4AZ1CP0LC000001", priority: 2 });
    expect(r).toMatchObject({ admitted: true, accountRequestId: "r1" });
    expect(a.rpc).toHaveBeenCalledWith("provider_reserve", expect.objectContaining({ p_priority: 2, p_product_key: "neovin", p_provider_event_id: 9, p_dedupe_key: "neovin:1N4AZ1CP0LC000001" }));
  });
  it("a refusal closes the platform reservation and refuses the call", async () => {
    const a = admin({ reserved: false, reason: "protected_reserve" });
    const r = await admitProviderCall(a, { url: URL, caller: "enrich-sweep" });
    expect(r).toMatchObject({ admitted: false, reason: "account_quota", accountReason: "protected_reserve" });
    expect(a.rpc).toHaveBeenCalledWith("provider_call_record", expect.objectContaining({ p_event_id: 9, p_outcome: "budget_denied" }));
  });
  it("a coordinator failure fails closed", async () => {
    expect((await admitProviderCall(admin(new Error("down")), { url: URL, caller: "x" })).admitted).toBe(false);
  });
  it("non-essential calls default to optional priority, essential ones to required", async () => {
    const a = admin({ reserved: true, request_id: "r" });
    await admitProviderCall(a, { url: URL, caller: "x" });
    await admitProviderCall(a, { url: "https://api.marketcheck.com/v2/dealerships/inventory?x=1", caller: "marketcheck-sync", essential: true });
    const pr = a.rpc.mock.calls.filter((c) => c[0] === "provider_reserve").map((c) => (c as unknown as [string, { p_priority: number }])[1].p_priority);
    expect(pr).toEqual([4, 1]);
  });
  it("a timeout settles as billing uncertain, never as free", async () => {
    expect(settlementForAnswer(null)).toBe("billing_uncertain");
    expect(settlementForAnswer(502)).toBe("billing_uncertain");
    expect(settlementForAnswer(429)).toBe("no_charge");
    expect(settlementForAnswer(404)).toBe("consumed");
    const a = admin({});
    await recordProviderCall(a, 9, null, null, null, new Headers({ "x-ratelimit-remaining": "4100", "x-ratelimit-limit": "5000" }));
    expect(a.rpc).toHaveBeenCalledWith("provider_settle_event", expect.objectContaining({ p_event_id: 9, p_outcome: "billing_uncertain" }));
    expect(a.rpc).toHaveBeenCalledWith("provider_reconcile_account", expect.objectContaining({ p_limit: 5000, p_remaining: 4100 }));
  });
});
