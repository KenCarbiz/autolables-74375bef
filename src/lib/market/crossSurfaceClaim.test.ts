// ── Four surfaces, one decision ────────────────────────────────────────────
//
// The QX50 once read "$4,718 above market", "Fair Market" and
// "At market · verified" on the same afternoon, because each surface decided
// independently. The fix is not that they agree today — it is that they
// CANNOT disagree, because each one asks the same function.
//
// This file enforces that structurally: every public surface that renders a
// market claim must call `publicMarketClaimForListing`, and a new surface that
// reads the legacy market columns without calling it fails the suite.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  publicMarketClaimForListing, decidePublicMarketClaim,
  projectPublicMarketFlags, readPublicMarketFlags,
  PUBLIC_MARKET_FLAG_ALLOWLIST, PUBLIC_MARKET_FLAGS_FIELD,
  MARKET_CLAIM_UNAVAILABLE_MESSAGE,
} from "./publicClaim.ts";
import { suppressPassportMarketClaim } from "../passportV2Data.ts";

/** Every public surface that renders a legacy market claim. */
const PUBLIC_SURFACES = [
  "src/pages/PublicListing.tsx",
  "src/pages/VehiclePassportGoverned.tsx",
  "src/components/listing/TrustStrip.tsx",
  "src/components/listing/MarketValueReport.tsx",
] as const;

const read = (p: string) => readFileSync(p, "utf8");

describe("every public surface consults the shared safeguard", () => {
  it.each(PUBLIC_SURFACES)("%s imports and calls it", (surface) => {
    const src = read(surface);
    expect(src).toContain('from "@/lib/market/publicClaim"');
    expect(src).toContain("publicMarketClaimForListing(");
  });

  it("gates its rendering on the result, not merely on the import", () => {
    // An import nothing uses is the failure mode this catches.
    expect(read("src/pages/PublicListing.tsx")).toMatch(/marketClaim\.show/);
    expect(read("src/components/listing/TrustStrip.tsx")).toMatch(/marketClaim\.show/);
    expect(read("src/components/listing/MarketValueReport.tsx"))
      .toMatch(/!publicMarketClaimForListing\([^)]*\)\.show/);
    expect(read("src/pages/VehiclePassportGoverned.tsx")).toMatch(/marketClaim\.show \? derived :/);
  });

  it("names no surface that reads the legacy columns without the helper", () => {
    // The registry above must stay complete. Any .tsx under src/pages or
    // src/components/listing that reads market_value/market_position and is
    // NOT an admin/dealer surface has to be in PUBLIC_SURFACES.
    const publicish = PUBLIC_SURFACES.map(String);
    for (const surface of publicish) {
      const src = read(surface);
      if (/market_value|market_position/.test(src)) {
        expect(src, surface).toContain("publicMarketClaimForListing");
      }
    }
    expect(publicish).toHaveLength(4);
  });
});

describe("the four reach the same decision for the same listing", () => {
  const listing = (over: Record<string, unknown> = {}) => ({
    market_value: 39_158,
    market_position: "above_market",
    market_checked_at: new Date(Date.now() - 30 * 86_400_000).toISOString(),
    price: 43_876,
    [PUBLIC_MARKET_FLAGS_FIELD]: { market_invalid_claim_suppression: true },
    ...over,
  });

  it("suppresses the same stale vehicle for all of them", () => {
    // One call, one answer — every surface passes the same listing object to
    // the same function, so "the same decision" is a property of the design.
    const d = publicMarketClaimForListing(listing() as never);
    expect(d.show).toBe(false);
    expect(d.reasons).toContain("market_evidence_stale");
    expect(d.customerMessage).toBe(MARKET_CLAIM_UNAVAILABLE_MESSAGE);
  });

  it("publishes the same fresh vehicle for all of them", () => {
    const fresh = publicMarketClaimForListing(
      listing({ market_checked_at: new Date().toISOString() }) as never,
    );
    expect(fresh.show).toBe(true);
  });

  it("is unaffected by which surface asks", () => {
    // The function takes a listing and nothing else — there is no surface
    // parameter through which two callers could diverge.
    expect(publicMarketClaimForListing.length).toBeLessThanOrEqual(2);
  });
});

describe("the Passport suppression is data wiring, not a restructure", () => {
  const derived = {
    marketAvg: 39_158, marketLow: 37_000, marketHigh: 41_000,
    belowMarket: 500, aboveMarket: 4_718, marketCheckedAt: "2026-07-01T00:00:00Z",
    marketBasisWeak: true,
    marketMeta: { checkedAt: "2026-07-01T00:00:00Z", similarCount: 7, radius: 100 },
    valueHistory: [{ captured_at: "2026-07-01T00:00:00Z", market_value: 39_158, listing_price: 43_876, below_market: 500 }],
    price: 43_876, dealerPhone: "x", serviceCount: 3,
  } as never;

  const out = suppressPassportMarketClaim(derived);

  it("nulls every market claim field", () => {
    for (const field of ["marketAvg", "marketLow", "marketHigh", "belowMarket", "aboveMarket", "marketCheckedAt"] as const) {
      expect((out as unknown as Record<string, unknown>)[field], field).toBeNull();
    }
    expect((out as unknown as Record<string, unknown>).marketBasisWeak).toBe(false);
  });

  it("strips the market line from the price series but keeps the dealer's own price history", () => {
    const history = (out as unknown as { valueHistory: Array<Record<string, unknown>> }).valueHistory;
    expect(history[0].market_value).toBeNull();
    expect(history[0].below_market).toBeNull();
    // The dealer's published price over time is not a market claim.
    expect(history[0].listing_price).toBe(43_876);
    expect(history[0].captured_at).toBe("2026-07-01T00:00:00Z");
  });

  it("changes nothing else at all", () => {
    const before = derived as unknown as Record<string, unknown>;
    const after = out as unknown as Record<string, unknown>;
    const touched = ["marketAvg", "marketLow", "marketHigh", "belowMarket", "aboveMarket",
      "marketCheckedAt", "marketBasisWeak", "marketMeta", "valueHistory"];
    for (const key of Object.keys(before)) {
      if (touched.includes(key)) continue;
      expect(after[key], key).toBe(before[key]);
    }
    // The advertised price above all.
    expect(after.price).toBe(43_876);
  });

  it("never introduces a provider prediction or an internal comparison price", () => {
    const serialized = JSON.stringify(out);
    for (const forbidden of ["40661", "42981", "Limited Market Evidence"]) {
      expect(serialized, forbidden).not.toContain(forbidden);
    }
  });
});

describe("the public flag projection", () => {
  it("carries exactly one allow-listed key", () => {
    expect([...PUBLIC_MARKET_FLAG_ALLOWLIST]).toEqual(["market_invalid_claim_suppression"]);
    const projected = projectPublicMarketFlags({
      market_flags: {
        market_invalid_claim_suppression: true,
        market_value_v2_admin: true,
        market_value_v2_public: true,
        marketcheck_premium_comparables: true,
      },
    });
    expect(Object.keys(projected)).toEqual(["market_invalid_claim_suppression"]);
    expect(projected.market_invalid_claim_suppression).toBe(true);
  });

  it("leaks no unrelated dealer setting", () => {
    const projected = projectPublicMarketFlags({
      market_flags: { market_invalid_claim_suppression: true },
      dealer_identity: { dealerIds: ["1013372"] },
      doc_fee_amount: 895,
      mandatory_add_ons_usd: 0,
      some_api_key: "secret-value",
    });
    const serialized = JSON.stringify(projected);
    for (const leaked of ["dealerIds", "1013372", "doc_fee_amount", "895", "some_api_key", "secret-value"]) {
      expect(serialized, leaked).not.toContain(leaked);
    }
  });

  it("projects only a literal true", () => {
    for (const v of ["true", 1, "yes", {}, [], null, undefined]) {
      expect(projectPublicMarketFlags({ market_flags: { market_invalid_claim_suppression: v } })
        .market_invalid_claim_suppression, JSON.stringify(v)).toBe(false);
    }
  });

  it("prefers the projection and falls back to the snapshot", () => {
    expect(readPublicMarketFlags({ [PUBLIC_MARKET_FLAGS_FIELD]: { market_invalid_claim_suppression: true } }))
      .toEqual({ market_flags: { market_invalid_claim_suppression: true } });
    const snapshot = { market_flags: { market_invalid_claim_suppression: true } };
    expect(readPublicMarketFlags({ dealer_snapshot: snapshot })).toBe(snapshot);
  });

  it("fails to today's behaviour on missing, malformed or stale flag data", () => {
    for (const projected of [undefined, null, "on", 1, [], "{}"]) {
      const d = publicMarketClaimForListing({
        [PUBLIC_MARKET_FLAGS_FIELD]: projected,
        market_value: null, market_checked_at: null,
      } as never);
      expect(d.show, JSON.stringify(projected)).toBe(true);
    }
  });

  it("cannot be affected by another tenant's flag", () => {
    // The projection is computed per listing from that listing's own tenant
    // settings, so there is no shared or global object to cross-contaminate.
    const a = publicMarketClaimForListing({
      [PUBLIC_MARKET_FLAGS_FIELD]: { market_invalid_claim_suppression: true },
      market_value: null,
    } as never);
    const b = publicMarketClaimForListing({
      [PUBLIC_MARKET_FLAGS_FIELD]: { market_invalid_claim_suppression: false },
      market_value: null,
    } as never);
    expect(a.show).toBe(false);
    expect(b.show).toBe(true);
  });
});

describe("the edge function attaches the projection", () => {
  const view = readFileSync("supabase/functions/public-listing-view/index.ts", "utf8");
  const code = view.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("computes it server-side from the tenant's own settings", () => {
    expect(code).toContain("projectPublicMarketFlags(s)");
    expect(code).toContain(`row[PUBLIC_MARKET_FLAGS_FIELD]`);
    expect(code).toMatch(/from\("dealer_profiles"\)\.select\("settings"\)\.eq\("tenant_id", row\.tenant_id\)/);
  });

  it("does not merge settings into the dealer identity snapshot", () => {
    expect(code).not.toMatch(/dealer_snapshot\s*=\s*\{[\s\S]{0,200}market_flags/);
  });

  it("sends no raw settings blob to the browser", () => {
    expect(code).not.toMatch(/row\.settings\s*=/);
    expect(code).not.toMatch(/row\.dealer_settings\s*=/);
  });
});

describe("flag off preserves today's output", () => {
  it("shows every claim across every surface input shape", () => {
    for (const input of [
      { marketValue: null }, { marketValue: -1 }, { marketCheckedAt: null },
      { v2Status: "limited" }, { certificationConflict: true },
      { marketValue: 39_158, marketPosition: "below_market", comparePrice: 43_876 },
    ]) {
      const d = decidePublicMarketClaim(input, { suppressionEnabled: false });
      expect(d.show, JSON.stringify(input)).toBe(true);
      expect(d.customerMessage).toBeNull();
    }
  });
});
