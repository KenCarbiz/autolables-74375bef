import { describe, expect, it, vi, beforeEach } from "vitest";
import { resetSupabaseSpy, spyResponses, type SpyOp } from "@/test/mocks/supabaseSpy";
import { InventoryScopeError, loadScopedInventory, scopeInventory } from "./primaryInventory";
import { IncompleteReadError, readAllPages } from "./paging";
import { CONFLICT_TEXT, planMapping, saveMapping } from "./mapping";
import { resolveListingScope } from "./storeScope";
import type { TenantStore } from "./api";

vi.mock("@/integrations/supabase/client", async () => {
  const m = await import("@/test/mocks/supabaseSpy");
  return { supabase: m.supabaseSpy };
});

const T = "3f0f97f5";
const st = (id: string, name: string, primary = false, mc?: string[]): TenantStore => ({
  id, tenant_id: T, display_name: name, is_primary_inventory_store: primary, status: "active", provider_ids: mc ? { marketcheck_dealer_id: mc } : {},
  subscription_status: primary ? "subscribed" : "unsubscribed", inventory_feed_enabled: true, inventory_sharing_enabled: primary, listing_sync_enabled: primary, city: "Hartford", state: "CT",
});

// The six Harte rooftops from the Nov 6 2026 production audit.
const INFINITI = "45cdc1e0";
const CHILDREN = [
  st("35d5584b", "Harte Nissan"), st("e400e636", "George Harte INFINITI"), st("12e1d831", "George Harte Nissan"),
  st("17a9f6f2", "Harte Volkswagen of Meriden"), st("02b4f1ac", "Harte Hyundai of Old Saybrook"),
];
const harte = (mapped: string[] | undefined) => [st(INFINITI, "Harte INFINITI", true, mapped), ...CHILDREN];

type Row = { id: string; tenant_id: string; owning_store_id: string | null; mc_dealer_id: string | null; condition: string };
const r = (id: string, owner: string | null, dealer: string | null, condition = "used"): Row => ({ id, tenant_id: T, owning_store_id: owner, mc_dealer_id: dealer, condition });

/** The reviewed 153-listing production fixture (Nov 6 2026, read-only audit). */
const AUDIT_153: Row[] = [
  ...Array.from({ length: 77 }, (_, i) => r(`feed-mc-${i}`, INFINITI, "1013372")),
  ...Array.from({ length: 23 }, (_, i) => r(`feed-${i}`, INFINITI, null)),
  ...Array.from({ length: 50 }, (_, i) => r(`mc-${i}`, null, "1013372")),
  r("santa-fe", null, "1028492", "new"), r("sonata", null, "1028492", "new"),
  r("manual-rogue", null, null),
];

describe("153-vehicle audit classification", () => {
  it("before mapping: 100 feed vehicles are primary, 53 wait for rooftop review, none are deleted", () => {
    const s = scopeInventory(T, harte(undefined), AUDIT_153);
    expect(s.totalRead).toBe(153);
    expect(s.summary.primary.total).toBe(100);
    expect(s.summary.review.total).toBe(53);
    expect(s.mode).toBe("multi_rooftop");
  });

  it("after mapping dealer 1013372 to Harte INFINITI: 150 primary; the 2 group-site Hyundais and the unverified manual Rogue stay in review", () => {
    const s = scopeInventory(T, harte(["1013372"]), AUDIT_153);
    expect(s.summary.primary.total).toBe(150);
    expect(s.summary.review.total).toBe(3);
    const reviewed = AUDIT_153.filter((x) => resolveListingScope(x, s.registry).kind === "rooftop_review").map((x) => x.id).sort();
    expect(reviewed).toEqual(["manual-rogue", "santa-fe", "sonata"]);
    expect(s.summary.primary.total + s.summary.review.total).toBe(153);
  });

  it("dealer 1028492 is never placed in Harte INFINITI because it shares the group name or address", () => {
    const s = scopeInventory(T, harte(["1013372"]), AUDIT_153);
    expect(resolveListingScope(r("x", null, "1028492"), s.registry).basis).toBe("unmapped_provider_dealer");
  });
});

describe("fail-closed scope checks", () => {
  const rows = [r("a", INFINITI, null)];
  it("rejects a row from another tenant", () => {
    expect(() => scopeInventory(T, harte(undefined), [{ ...rows[0], tenant_id: "other" }])).toThrow(InventoryScopeError);
  });
  it("rejects a store from another tenant", () => {
    expect(() => scopeInventory(T, [...harte(undefined), { ...CHILDREN[0], id: "foreign", tenant_id: "other" }], rows)).toThrow(/wrong_tenant/);
  });
  it("rejects rows without scope columns", () => {
    expect(() => scopeInventory(T, harte(undefined), [{ id: "a", condition: "new" } as unknown as Row])).toThrow(/scope_columns_unavailable/);
  });
  it("rejects a multi-store tenant with no primary, or with two", () => {
    expect(() => scopeInventory(T, CHILDREN, rows)).toThrow(/no_primary_store/);
    expect(() => scopeInventory(T, [st("p1", "A", true), st("p2", "B", true)], rows)).toThrow(/multiple_primary_stores/);
  });
  it("rejects an empty registry when vehicles are store-owned (registry hidden by permissions)", () => {
    expect(() => scopeInventory(T, [], rows)).toThrow(/registry_incomplete/);
  });
  it("a single-rooftop tenant with no stores keeps every listing", () => {
    expect(scopeInventory(T, [], [r("m", null, null), r("n", null, "555")]).primaryRows).toHaveLength(2);
  });
  it("a vehicle owned by a store outside the registry (wrong rooftop) goes to review", () => {
    const s = scopeInventory(T, harte(undefined), [r("z", "not-a-harte-store", null)]);
    expect(s.summary.review.total).toBe(1);
    expect(s.primaryRows).toHaveLength(0);
  });
  it("a child store's own vehicle never appears in the primary list", () => {
    const s = scopeInventory(T, harte(["1013372"]), [r("c", "02b4f1ac", "1013372")]);
    expect(s.primaryRows).toHaveLength(0);
    expect(s.summary.byChild.get("02b4f1ac")?.total).toBe(1);
  });
});

describe("complete paged reads", () => {
  it("reads every page past the old 500 and 2,000 limits and verifies the count", async () => {
    const all = Array.from({ length: 2345 }, (_, i) => ({ id: `r${String(i).padStart(5, "0")}` }));
    const calls: Array<[number, number]> = [];
    const { rows, count } = await readAllPages((from, to) => { calls.push([from, to]); return Promise.resolve({ data: all.slice(from, to + 1), error: null, count: all.length }); });
    expect(count).toBe(2345);
    expect(rows).toHaveLength(2345);
    expect(calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });
  it("refuses a short read, a missing count, a count that changes, and duplicate rows", async () => {
    await expect(readAllPages(() => Promise.resolve({ data: [{ id: "a" }], error: null, count: 2 }), 1)).rejects.toBeInstanceOf(IncompleteReadError);
    await expect(readAllPages(() => Promise.resolve({ data: [{ id: "a" }], error: null, count: null }))).rejects.toThrow(/row count/);
    let n = 0;
    await expect(readAllPages(() => Promise.resolve({ data: [{ id: `x${n}` }], error: null, count: 2 + n++ }), 1)).rejects.toThrow(/changed/);
    await expect(readAllPages(() => Promise.resolve({ data: [{ id: "a" }], error: null, count: 2 }), 1)).rejects.toThrow(/twice/);
  });
});

describe("loadScopedInventory", () => {
  beforeEach(() => resetSupabaseSpy());
  it("never falls back to a column set without the scope columns", async () => {
    spyResponses.tables.dealer_stores = { data: harte(undefined) };
    const selects: string[] = [];
    spyResponses.tables.vehicle_listings = (ops: SpyOp[]) => {
      selects.push(String(ops.find((o) => o.op === "select")?.args[0]));
      return { data: null, error: { code: "42703", message: "column does not exist" } };
    };
    await expect(loadScopedInventory({ tenantId: T, includeArchived: false, columnSets: ["id,vin,market_value", "id,vin"] })).rejects.toThrow(/scope_columns_unavailable/);
    expect(selects.length).toBe(2);
    for (const s of selects) expect(s).toContain("owning_store_id");
  });
  it("filters by tenant id only (no null-tenant legacy rows) and orders by id", async () => {
    spyResponses.tables.dealer_stores = { data: harte(undefined) };
    const seen: SpyOp[][] = [];
    spyResponses.tables.vehicle_listings = (ops: SpyOp[]) => { seen.push(ops); return { data: [r("a", INFINITI, null)], count: 1 }; };
    await loadScopedInventory({ tenantId: T, includeArchived: false, columnSets: ["id"] });
    const ops = seen[0];
    expect(ops.find((o) => o.op === "eq")?.args).toEqual(["tenant_id", T]);
    expect(ops.some((o) => o.op === "or")).toBe(false);
    expect(ops.find((o) => o.op === "order")?.args[0]).toBe("id");
  });
});

describe("rooftop mapping plan", () => {
  const stores = harte(undefined);
  it("shows the listings that move and the before/after mapping", () => {
    const p = planMapping(stores, AUDIT_153, "1013372", INFINITI, "map");
    expect(p.conflicts).toEqual([]);
    expect(p.affected).toBe(50);
    expect(p.previous).toEqual([]);
    expect(p.next).toEqual(["1013372"]);
  });
  it("refuses a dealer id already mapped to another rooftop", () => {
    const mapped = [st(INFINITI, "Harte INFINITI", true, ["1013372"]), ...CHILDREN];
    const p = planMapping(mapped, AUDIT_153, "1013372", "02b4f1ac", "map");
    expect(p.conflicts.map((c) => c.code)).toEqual(["mapped_to_other_store"]);
    expect(CONFLICT_TEXT(p.conflicts[0])).toMatch(/Harte INFINITI/);
  });
  it("refuses malformed ids, unknown stores and unmapping what is not mapped", () => {
    expect(planMapping(stores, [], "10 13", INFINITI, "map").conflicts.map((c) => c.code)).toContain("invalid_dealer_id");
    expect(planMapping(stores, [], "1", "nope", "map").conflicts.map((c) => c.code)).toContain("store_not_found");
    expect(planMapping(stores, [], "1013372", INFINITI, "unmap").conflicts.map((c) => c.code)).toEqual(["not_mapped"]);
  });
  it("saves only through the server function, and reports a refusal without changing anything", async () => {
    resetSupabaseSpy();
    const p = planMapping(stores, AUDIT_153, "1013372", INFINITI, "map");
    const ev = { provider_dealer_name: "Harte Infiniti", provider_dealer_website: null, provider_dealer_address: null, source: "test", feed_vehicles_at_store: 77, confirmed_destination: INFINITI };
    await expect(saveMapping(p, ev, "Verified on dealer site", null)).rejects.toThrow(/turned off until its database change/);
    spyResponses.rpcs.inv_admin_map_provider_dealer = { data: null, error: { code: "42501", message: "platform_admin_required" } };
    await expect(saveMapping(p, ev, "Verified on dealer site", null)).rejects.toThrow(/Only a platform administrator/);
    const blocked = planMapping([st(INFINITI, "Harte INFINITI", true, ["1013372"]), ...CHILDREN], AUDIT_153, "1013372", "02b4f1ac", "map");
    await expect(saveMapping(blocked, ev, "x".repeat(20), null)).rejects.toThrow(/conflicts/);
  });
});
