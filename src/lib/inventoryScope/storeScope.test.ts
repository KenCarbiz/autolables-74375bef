import { describe, expect, it } from "vitest";
import { buildRegistry, inPrimaryView, resolveListingScope, storeFeedHealth, summarizeScopes, summarizeUsage, type ScopeStore } from "./storeScope";

const store = (id: string, name: string, primary = false, mc?: string | string[]): ScopeStore => ({
  id, display_name: name, is_primary_inventory_store: primary, status: "active", provider_ids: mc ? { marketcheck_dealer_id: mc } : {},
});

// Shapes taken from the Nov 6 2026 production audit of the Harte tenant.
const PRIMARY = store("45cd", "Harte INFINITI", true, "1013372");
const HYUNDAI = store("02b4", "Harte Hyundai of Old Saybrook");
const NISSAN = store("35d5", "Harte Nissan");

describe("store scope", () => {
  const reg = buildRegistry([NISSAN, PRIMARY, HYUNDAI]);

  it("identifies the one primary store and lists children separately", () => {
    expect(reg.primary?.id).toBe("45cd");
    expect(reg.children.map((s) => s.id)).toEqual(["02b4", "35d5"]);
  });

  it("puts Files.com rows owned by a child store in that child, never in primary", () => {
    const s = resolveListingScope({ id: "l1", owning_store_id: "02b4", condition: "new" }, reg);
    expect(s).toEqual({ kind: "child", storeId: "02b4", basis: "owning_store" });
    expect(inPrimaryView({ id: "l1", owning_store_id: "02b4" }, reg)).toBe(false);
  });

  it("maps a MarketCheck dealer id only through an explicit store mapping", () => {
    expect(resolveListingScope({ id: "l2", mc_dealer_id: 1013372 }, reg)).toEqual({ kind: "primary", storeId: "45cd", basis: "marketcheck_dealer_id" });
  });

  it("holds an unmapped provider dealer (the group-site Hyundais) for review instead of counting it as primary", () => {
    const s = resolveListingScope({ id: "l3", mc_dealer_id: "1028492", condition: "new" }, reg);
    expect(s.kind).toBe("rooftop_review");
    expect(inPrimaryView({ id: "l3", mc_dealer_id: "1028492" }, reg)).toBe(false);
  });

  it("keeps manual/legacy rows with no provider identity in the primary view", () => {
    expect(resolveListingScope({ id: "l4" }, reg)).toEqual({ kind: "primary", storeId: "45cd", basis: "no_provider_identity" });
  });

  it("owning store wins over a conflicting provider dealer id", () => {
    expect(resolveListingScope({ id: "l5", owning_store_id: "35d5", mc_dealer_id: "1013372" }, reg).storeId).toBe("35d5");
  });

  it("an owning store outside the tenant's registry is reviewed, not assumed primary (tenant isolation)", () => {
    expect(resolveListingScope({ id: "l6", owning_store_id: "other-tenant-store" }, reg).kind).toBe("rooftop_review");
  });

  it("a dealer id mapped to two stores is ambiguous and resolves to review", () => {
    const r = buildRegistry([store("a", "A", true, "9"), store("b", "B", false, "9")]);
    expect(r.ambiguousMcDealers.has("9")).toBe(true);
    expect(resolveListingScope({ id: "x", mc_dealer_id: "9" }, r).kind).toBe("rooftop_review");
  });

  it("no designated primary means no store is treated as primary", () => {
    const r = buildRegistry([store("a", "A"), store("b", "B")]);
    expect(r.primary).toBeNull();
    expect(resolveListingScope({ id: "x", owning_store_id: "a" }, r).kind).toBe("child");
  });

  it("never groups distinct vehicles by year/model or stock pattern: totals are per row", () => {
    const rows = [
      { id: "1", owning_store_id: "45cd", condition: "new" },
      { id: "2", owning_store_id: "45cd", condition: "used" },
      { id: "3", owning_store_id: "45cd", condition: "cpo" },
      { id: "4", owning_store_id: "02b4", condition: "new" },
      { id: "5", mc_dealer_id: "1028492", condition: "new" },
      { id: "6", condition: "weird" },
    ];
    const sum = summarizeScopes(rows, reg);
    expect(sum.primary).toEqual({ total: 4, new: 1, used: 1, cpo: 1, unknown: 1 });
    expect(sum.review.total).toBe(1);
    expect(sum.byChild.get("02b4")?.new).toBe(1);
  });
});


describe("store status lines", () => {
  it("summarizes this month's ledger with denials kept separate from spend", () => {
    const u = summarizeUsage([
      { outcome: "denied", deny_reason: "feed_only", estimated_cost_usd: 0.08, product: "neovin" },
      { outcome: "admitted", deny_reason: null, estimated_cost_usd: 0.08, product: "neovin" },
      { outcome: "admitted", deny_reason: null, estimated_cost_usd: null, product: "price_prediction" },
    ]);
    expect(u).toMatchObject({ admitted: 2, denied: 1, estimatedUsd: 0.08, unpriced: 1, denyReasons: { feed_only: 1 } });
  });

  it("counts missing data honestly and keeps vehicles absent from the last feed out of totals", () => {
    const h = storeFeedHealth([
      { presence: "present", condition: "new", stock_number: "A1", feed_price_status: "known", enrichment_status: "fresh", last_seen_at: "2026-10-31T19:51:11Z" },
      { presence: "present", condition: "used", stock_number: null, feed_price_status: "unknown", enrichment_status: "not_requested", last_seen_at: "2026-10-31T19:51:11Z" },
      { presence: "missing", condition: "used", stock_number: "B", feed_price_status: "known", enrichment_status: "fresh", last_seen_at: "2026-10-30T00:00:00Z" },
    ]);
    expect(h.counts.total).toBe(2);
    expect(h).toMatchObject({ missingFromLastFeed: 1, noStockNumber: 1, noPrice: 1, enrichmentFresh: 1, lastFeedUpdate: "2026-10-31T19:51:11Z" });
  });
});
