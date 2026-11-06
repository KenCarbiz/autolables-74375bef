import { describe, expect, it } from "vitest";
import {
  CHILD_DEFAULT_PRODUCTS, DATA_CATEGORIES, categoryState, childStoreMayReserve, inventoryVisible, isSwitchable,
  orderForEnrichment, planMonthlyCalls, setCategory, type StorePlanInput,
} from "./dataControls";

describe("data categories", () => {
  it("exposes switches only for categories backed by a store-level product", () => {
    const switchable = DATA_CATEGORIES.filter(isSwitchable).map((c) => c.id);
    expect(switchable).toEqual(["neovin_specs", "market_value_comps", "vehicle_history", "market_days_supply", "recalls"]);
    for (const id of ["oem_incentives", "factory_window_sticker", "marketcheck_inventory_sync"]) {
      const c = DATA_CATEGORIES.find((x) => x.id === id)!;
      expect(categoryState(c, ["neovin"])).toBe("unavailable");
      expect(c.unavailableReason).toBeTruthy();
    }
  });

  it("child stores start with no paid products", () => {
    expect(CHILD_DEFAULT_PRODUCTS).toEqual([]);
    for (const c of DATA_CATEGORIES.filter(isSwitchable)) expect(categoryState(c, CHILD_DEFAULT_PRODUCTS)).toBe("off");
  });

  it("a switch changes only its own products", () => {
    const next = setCategory(["neovin", "auto_recalls"], "market_value_comps", true);
    expect(next).toEqual(["neovin", "price_prediction", "inventory_search", "auto_recalls"]);
    expect(setCategory(next, "neovin_specs", false)).toEqual(["price_prediction", "inventory_search", "auto_recalls"]);
    expect(categoryState(DATA_CATEGORIES.find((c) => c.id === "market_days_supply")!, ["sales_stats"])).toBe("partial");
  });

  it("an unavailable category cannot add products", () => {
    expect(setCategory(["neovin"], "oem_incentives", true)).toEqual(["neovin"]);
  });
});

describe("visibility is independent of paid enrichment", () => {
  it("an approved active store shows inventory with every paid category off", () => {
    expect(inventoryVisible({ status: "active", inventory_feed_enabled: true, mappingApproved: true, inventory_sharing_enabled: true })).toBe(true);
  });
  it("an unmapped store does not show inventory", () => {
    expect(inventoryVisible({ status: "active", inventory_feed_enabled: true, mappingApproved: false, inventory_sharing_enabled: true })).toBe(false);
  });
});

describe("enrichment ordering", () => {
  const rows = [{ vin: "B", condition: "new" }, { vin: "A", condition: "used" }, { vin: "C", condition: "cpo" }];
  it("used first by default puts used and CPO ahead of new", () => {
    expect(orderForEnrichment(rows, "used_first").map((r) => r.vin)).toEqual(["A", "C", "B"]);
    expect(orderForEnrichment(rows, "new_first").map((r) => r.vin)).toEqual(["B", "A", "C"]);
  });
});

const s = (o: Partial<StorePlanInput>): StorePlanInput => ({
  storeId: "x", name: "X", primary: false, mode: "enrichment", vehicles: 100, allowedProducts: ["neovin"], refreshCadenceHours: null, monthlyRequestCap: 250, ...o,
});

describe("monthly call plan (5,000 account calls, 250 reserve)", () => {
  const account = { monthlyQuota: 5000, reserve: 250, usedThisPeriod: 0 };

  it("allocates primary inventory before child stores", () => {
    const plan = planMonthlyCalls({ ...account, usedThisPeriod: 4600 }, [
      s({ storeId: "c", name: "Child", monthlyRequestCap: 300 }),
      s({ storeId: "p", name: "Primary", primary: true, monthlyRequestCap: 200 }),
    ]);
    expect(plan.nonessentialBudget).toBe(4750);
    expect(plan.lines[0]).toMatchObject({ storeId: "p", allocated: 150, deferred: 50 });
    expect(plan.lines[1]).toMatchObject({ storeId: "c", allocated: 0, deferred: 200 });
  });

  it("feed-only and paused stores plan zero calls", () => {
    const plan = planMonthlyCalls(account, [s({ mode: "feed_only" }), s({ storeId: "y", mode: "paused" })]);
    expect(plan.worstCase).toBe(0);
    expect(plan.lines.every((l) => l.demand === 0 && l.allocated === 0)).toBe(true);
  });

  it("rejects a plan whose store caps exceed the 4,750 nonessential calls", () => {
    const plan = planMonthlyCalls(account, [s({ primary: true, monthlyRequestCap: 4000 }), s({ storeId: "c", monthlyRequestCap: 1000 })]);
    expect(plan.ok).toBe(false);
    expect(plan.worstCase).toBe(5000);
  });

  it("rejects refresh products with no cadence and enrichment with no cap", () => {
    const plan = planMonthlyCalls(account, [s({ allowedProducts: ["price_prediction"], monthlyRequestCap: 0 })]);
    expect(plan.ok).toBe(false);
    expect(plan.problems.length).toBe(2);
  });

  it("worst-case demand counts full lot turnover and cadence ticks", () => {
    const plan = planMonthlyCalls(account, [s({ allowedProducts: ["neovin", "price_prediction"], refreshCadenceHours: 168, monthlyRequestCap: 2000 })]);
    expect(plan.lines[0].demand).toBe(100 * 2 + 100 * 5);
  });

  it("unknown usage allocates nothing", () => {
    const plan = planMonthlyCalls({ ...account, usedThisPeriod: null }, [s({ primary: true })]);
    expect(plan.ok).toBe(false);
    expect(plan.lines[0].allocated).toBe(0);
  });
});

describe("primary precedence at admission", () => {
  const base = { quota: 5000, reserve: 250, primaryHoldback: 1000 };
  it("a child store stops before the primary holdback and reserve", () => {
    expect(childStoreMayReserve({ ...base, used: 3749 }).ok).toBe(true);
    expect(childStoreMayReserve({ ...base, used: 3750 })).toEqual({ ok: false, reason: "primary_precedence" });
  });
  it("unknown usage fails closed", () => {
    expect(childStoreMayReserve({ ...base, used: null })).toEqual({ ok: false, reason: "usage_unknown" });
  });
});
