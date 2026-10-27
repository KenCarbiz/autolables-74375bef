import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { classifyRawPayload, LEGACY_PRICING_SQL_PREDICATE } from "./rawPayloadBoundary.ts";

// Synthetic shapes only: the key sets are the ones observed in production, the
// values are not.
const FEED_ROW = {
  vin: "1AAAAAAAAAAAAAAAA", heading: "2025 Example Model", inventory_type: "used",
  build: { year: 2025, make: "Example", model: "Model" },
  dealer: { name: "A Dealer", state: "CT" },
  media: { photo_links: [] }, mc_dealership: { mc_rooftop_id: "1" },
};

const LEGACY_PRICING = {
  vin: "1AAAAAAAAAAAAAAAA", belowMarket: 1, checkedAt: "2026-01-01T00:00:00Z", high: 2, low: 1,
  listingPrice: 2, marketValue: 2, position: "at_market", raw: {}, rawProvider: "marketcheck",
};

describe("classifyRawPayload", () => {
  it("recognises a syndication row", () => {
    expect(classifyRawPayload(FEED_ROW).kind).toBe("syndication_row");
  });

  it("recognises the retired pricing writer's payload", () => {
    const c = classifyRawPayload(LEGACY_PRICING);
    expect(c.kind).toBe("legacy_market_pricing");
    expect(c.reasons).toContain("has_marketValue");
    expect(c.reasons).toContain("has_rawProvider");
  });

  it("calls null and empty objects empty", () => {
    expect(classifyRawPayload(null).kind).toBe("empty");
    expect(classifyRawPayload(undefined).kind).toBe("empty");
    expect(classifyRawPayload({}).kind).toBe("empty");
  });

  it("refuses to guess at a VIN-only payload or a mixed one", () => {
    expect(classifyRawPayload({ vin: "1AAAAAAAAAAAAAAAA" }).kind).toBe("unknown");
    expect(classifyRawPayload({ ...FEED_ROW, marketValue: 1, rawProvider: "x" }).kind).toBe("unknown");
    expect(classifyRawPayload("string").kind).toBe("unknown");
    expect(classifyRawPayload([FEED_ROW]).kind).toBe("unknown");
  });

  it("needs two legacy keys, so one stray key is not a reclassification", () => {
    expect(classifyRawPayload({ vin: "1AAAAAAAAAAAAAAAA", marketValue: 1 }).kind).toBe("unknown");
  });
});

describe("the repair migration uses the same rule", () => {
  const SQL = readFileSync("supabase/migrations/20261027201000_mc_raw_boundary_repair.sql", "utf8");

  it("selects legacy rows with the classifier's predicate, verbatim", () => {
    expect(SQL).toContain(LEGACY_PRICING_SQL_PREDICATE);
  });

  it("copies before it clears, into a product-specific store", () => {
    const copy = SQL.indexOf("INSERT INTO public.market_pricing_legacy_payloads");
    const clear = SQL.indexOf("SET mc_raw = NULL");
    expect(copy).toBeGreaterThan(-1);
    expect(clear).toBeGreaterThan(copy);
  });

  it("never touches a syndication row and never reinterprets an unknown one", () => {
    expect(SQL).toContain("NOT (mc_raw ? 'build')");
    expect(SQL).not.toMatch(/mc_raw\s*=\s*jsonb_build_object/);
  });

  it("keeps the legacy store append-only and tenant-scoped", () => {
    expect(SQL).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(SQL).toMatch(/REVOKE ALL PRIVILEGES ON TABLE public\.market_pricing_legacy_payloads FROM PUBLIC/);
    expect(SQL).toMatch(/GRANT SELECT, INSERT ON TABLE public\.market_pricing_legacy_payloads TO service_role/);
    expect(SQL).not.toMatch(/GRANT (UPDATE|DELETE)/);
  });

  it("states the one meaning of mc_raw on the column", () => {
    expect(SQL).toMatch(/COMMENT ON COLUMN public\.vehicle_listings\.mc_raw IS/);
    expect(SQL).toMatch(/verbatim/i);
  });
});
