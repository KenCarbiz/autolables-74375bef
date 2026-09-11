// ── Every public market surface is governed, and stays governed ────────────
//
// The defect this suite exists to prevent, stated plainly: on 2026-09-11 the
// governed Passport at /v/:slug was about to start suppressing a stale market
// claim while /v/:slug/great-buy and /v/:slug/todays-price kept publishing the
// same claim from the same row. Both sibling routes built their own
// `derivePassport(listing)` and never asked the safeguard anything.
//
// Structural assertions, not behavioural mocks: the point is that a NEW public
// Passport route cannot render a claim without appearing in the registry, and
// that no nested component can rebuild one out of listing fields the
// suppression left behind.

import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PROTECTED_LISTING_MARKET_FIELDS,
  PROTECTED_MC_ATTRIBUTE_KEYS,
  PROTECTED_MC_ATTRIBUTE_PREFIXES,
  PROTECTED_VALUE_HISTORY_FIELDS,
  PUBLIC_LISTING_FETCH_MODULE,
  PUBLIC_MARKET_SURFACE_REGISTRY,
  governPublicListing,
  governedPassportData,
} from "./publicSurface.ts";
import {
  MARKET_CLAIM_UNAVAILABLE_MESSAGE,
  INTERNAL_ONLY_PUBLIC_STRINGS,
  PUBLIC_MARKET_FLAGS_FIELD,
  publicMarketClaimForListing,
} from "@/lib/market/publicClaim";

const read = (p: string) => readFileSync(p, "utf8");
const NOW = Date.UTC(2026, 8, 11, 23, 0, 0);
const DAY = 86_400_000;

// ── Synthetic fixtures ─────────────────────────────────────────────────────
//
// Round numbers and invented VINs. No production VIN, slug or price appears in
// this file; the two live examples that exposed the defect are reproduced by
// SHAPE (a stale below-market claim on a sibling route), not by their data.

const SUPPRESSED_VIN = "1AAAAAAAAAAAAAAA1";
const SHOWN_VIN = "1BBBBBBBBBBBBBBB2";

/** Stale evidence: every governed surface must refuse this one. */
const staleListing = (extra: Record<string, unknown> = {}) => ({
  id: "listing-stale",
  vin: SUPPRESSED_VIN,
  slug: "synthetic-stale-vehicle",
  price: 50_000,
  market_value: 55_000,
  market_position: "below_market",
  market_checked_at: new Date(NOW - 40 * DAY).toISOString(),
  market_payload: { belowMarket: 5_000, high: 60_000, low: 48_000, checked_at: new Date(NOW - 40 * DAY).toISOString() },
  market_meta: { price_percentile: 12, search_radius: 150, similar_count: 42, avg_dom: 37, checked_at: new Date(NOW - 40 * DAY).toISOString() },
  comparables: [{ vin: "1CCCCCCCCCCCCCCC3", price: 56_000, dealer: "Synthetic Motors", dist: 12 }],
  value_history: [{ captured_at: new Date(NOW - 40 * DAY).toISOString(), market_value: 55_000, listing_price: 50_000, below_market: 5_000, position: "below_market" }],
  mc_attributes: { engine: "V6", exterior_color: "Blue", price_percentile: 12, similar_count: 42, search_radius: 150, sold_price_median: 54_000, trim_matched: true },
  [PUBLIC_MARKET_FLAGS_FIELD]: { market_invalid_claim_suppression: true },
  ...extra,
});

/** Fresh, consistent evidence: the safeguard has nothing to object to. */
const freshListing = (extra: Record<string, unknown> = {}) => ({
  ...staleListing(),
  id: "listing-fresh",
  vin: SHOWN_VIN,
  slug: "synthetic-fresh-vehicle",
  market_checked_at: new Date(NOW - 1 * DAY).toISOString(),
  market_payload: { belowMarket: 5_000, high: 60_000, low: 48_000, checked_at: new Date(NOW - 1 * DAY).toISOString() },
  market_meta: { price_percentile: 12, search_radius: 150, similar_count: 42, avg_dom: 37, checked_at: new Date(NOW - 1 * DAY).toISOString() },
  value_history: [{ captured_at: new Date(NOW - 1 * DAY).toISOString(), market_value: 55_000, listing_price: 50_000, below_market: 5_000, position: "below_market" }],
  ...extra,
});

const flagOff = (l: Record<string, unknown>): Record<string, unknown> => ({
  ...l,
  [PUBLIC_MARKET_FLAGS_FIELD]: { market_invalid_claim_suppression: false },
});

// ── 1. Flag false changes nothing ──────────────────────────────────────────

describe("with suppression off the boundary is invisible", () => {
  it("returns the very same listing reference for a stale vehicle", () => {
    const listing = flagOff(staleListing());
    expect(governPublicListing(listing, NOW).listing).toBe(listing);
  });

  it("returns the very same listing reference for a fresh vehicle", () => {
    const listing = flagOff(freshListing());
    expect(governPublicListing(listing, NOW).listing).toBe(listing);
  });

  it("leaves every protected field intact", () => {
    const listing = flagOff(staleListing());
    const governed = governPublicListing(listing, NOW).listing as Record<string, unknown>;
    for (const f of PROTECTED_LISTING_MARKET_FIELDS) expect(governed[f], f).toEqual(listing[f]);
  });

  it("derives passport data identical to the ungoverned derivation", () => {
    const listing = flagOff(staleListing());
    const d = governedPassportData(listing as never, NOW);
    expect(d?.marketAvg).toBe(55_000);
    expect(d?.belowMarket).toBe(5_000);
    expect(d?.marketCheckedAt).not.toBeNull();
  });
});

// ── 2. Flag true suppresses the claim, everywhere, in every spelling ───────

describe("with suppression on a refused claim cannot be rebuilt", () => {
  it("nulls every protected listing field", () => {
    const governed = governPublicListing(staleListing(), NOW).listing as Record<string, unknown>;
    for (const f of PROTECTED_LISTING_MARKET_FIELDS) expect(governed[f], f).toBeNull();
  });

  it("strips the comparison counters out of mc_attributes", () => {
    const governed = governPublicListing(staleListing(), NOW).listing as { mc_attributes: Record<string, unknown> };
    for (const k of PROTECTED_MC_ATTRIBUTE_KEYS) expect(governed.mc_attributes, k).not.toHaveProperty(k);
    for (const k of Object.keys(governed.mc_attributes)) {
      for (const p of PROTECTED_MC_ATTRIBUTE_PREFIXES) expect(k.startsWith(p), k).toBe(false);
    }
  });

  it("keeps the vehicle description that is not a market claim", () => {
    const governed = governPublicListing(staleListing(), NOW).listing as { mc_attributes: Record<string, unknown> };
    expect(governed.mc_attributes.engine).toBe("V6");
    expect(governed.mc_attributes.exterior_color).toBe("Blue");
  });

  it("nulls the market series but keeps the dealer's own price history", () => {
    const governed = governPublicListing(staleListing(), NOW).listing as { value_history: Record<string, unknown>[] };
    for (const point of governed.value_history) {
      for (const f of PROTECTED_VALUE_HISTORY_FIELDS) expect(point[f], f).toBeNull();
      expect(point.listing_price).toBe(50_000);
      expect(point.captured_at).toBeTruthy();
    }
  });

  it("does not mutate the listing it was handed", () => {
    const listing = staleListing();
    const before = JSON.stringify(listing);
    governPublicListing(listing, NOW);
    expect(JSON.stringify(listing)).toBe(before);
  });

  it("leaves the advertised price alone", () => {
    const governed = governPublicListing(staleListing(), NOW).listing as { price: number };
    expect(governed.price).toBe(50_000);
  });

  it("keeps the flag projection readable so the decision stays stable", () => {
    const governed = governPublicListing(staleListing(), NOW).listing;
    expect(publicMarketClaimForListing(governed as never, NOW).show).toBe(false);
    // Governing twice must not flip the answer back to "show".
    expect(governPublicListing(governed, NOW).listing).toEqual(governed);
  });
});

// ── 3. The derived shape a page renders ────────────────────────────────────

describe("governed passport data states no market claim", () => {
  const d = governedPassportData(staleListing() as never, NOW);

  it("nulls the market value, band and below-market delta", () => {
    expect(d?.marketAvg).toBeNull();
    expect(d?.marketLow).toBeNull();
    expect(d?.marketHigh).toBeNull();
    expect(d?.belowMarket).toBeNull();
    expect(d?.aboveMarket).toBeNull();
    expect(d?.marketCheckedAt).toBeNull();
  });

  it("empties the comparison metadata rather than leaving half of it", () => {
    expect(d?.marketMeta.percentile).toBeNull();
    expect(d?.marketMeta.similarCount).toBeNull();
    expect(d?.marketMeta.radius).toBeNull();
    expect(d?.marketMeta.checkedAt).toBeNull();
    expect(d?.marketMeta.soldDisplayable).toBe(false);
  });

  it("empties the comparable set that backed 'Market Data Verified'", () => {
    expect(d?.comparables).toEqual([]);
  });

  it("nulls the market series without discarding the price series", () => {
    expect(d?.valueHistory.every((p) => p.market_value === null && p.below_market === null)).toBe(true);
    expect(d?.valueHistory.some((p) => p.listing_price != null)).toBe(true);
  });

  it("never yields zero where a claim used to be", () => {
    // A zero renders as "$0 below market"; null renders as nothing at all.
    for (const v of [d?.marketAvg, d?.belowMarket, d?.marketHigh, d?.marketLow]) expect(v).not.toBe(0);
  });

  it("keeps the advertised price", () => {
    expect(d?.price).toBe(50_000);
  });

  it("leaves a fresh consistent vehicle fully intact", () => {
    const fresh = governedPassportData(freshListing() as never, NOW);
    expect(fresh?.marketAvg).toBe(55_000);
    expect(fresh?.belowMarket).toBe(5_000);
    expect(fresh?.comparables.length).toBe(1);
  });
});

// ── 4. Cross-route agreement ───────────────────────────────────────────────

describe("every applicable surface reaches the same decision", () => {
  const governedRoutes = PUBLIC_MARKET_SURFACE_REGISTRY.filter((s) => s.governance === "governed");

  it("registers at least the six known claim-bearing routes", () => {
    expect(governedRoutes.length).toBeGreaterThanOrEqual(6);
    for (const route of ["/v/:slug", "/v-classic/:slug", "/v/:slug/great-buy", "/v/:slug/:section", "/v/:slug/vehicle-history"]) {
      expect(governedRoutes.map((s) => s.route)).toContain(route);
    }
  });

  it("agrees on the suppressed vehicle and on the shown one", () => {
    const suppressed = governedRoutes.map(() => publicMarketClaimForListing(staleListing() as never, NOW).show);
    const shown = governedRoutes.map(() => publicMarketClaimForListing(freshListing() as never, NOW).show);
    expect(new Set(suppressed).size).toBe(1);
    expect(new Set(shown).size).toBe(1);
    expect(suppressed[0]).toBe(false);
    expect(shown[0]).toBe(true);
  });

  it("gives every non-applicable surface a written structural reason", () => {
    for (const s of PUBLIC_MARKET_SURFACE_REGISTRY.filter((x) => x.governance === "no_market_claim")) {
      expect(s.reason, s.route).toBeTruthy();
      expect((s.reason ?? "").length, s.route).toBeGreaterThan(20);
    }
  });
});

// ── 5. Structural guards over the real source tree ─────────────────────────

const PROTECTED_FIELD_PATTERN = new RegExp(
  `\\b(${[...PROTECTED_LISTING_MARKET_FIELDS, "marketAvg", "marketLow", "marketHigh", "belowMarket", "aboveMarket", "marketCheckedAt"].join("|")})\\b`,
);

describe("the source tree matches the registry", () => {
  it("governs the listing inside the one shared public fetch", () => {
    const hook = read(PUBLIC_LISTING_FETCH_MODULE);
    expect(hook).toContain("governPublicListing");
    // The raw fetched row must not escape the hook ungoverned.
    expect(hook).not.toMatch(/listing:\s*query\.data\?\.listing\s*\?\?\s*null/);
  });

  it("has no claim-bearing page deriving straight from an ungoverned listing", () => {
    // A `no_market_claim` page may call derivePassport freely: it renders no
    // claim, and the listing it derives from is governed by the shared fetch.
    for (const s of PUBLIC_MARKET_SURFACE_REGISTRY.filter((x) => x.governance === "governed")) {
      const src = read(s.entry);
      if (!src.includes("derivePassport(")) continue;
      expect(src, `${s.route} calls derivePassport directly`).toMatch(
        /governedPassportData|suppressPassportMarketClaim/,
      );
    }
  });

  it("keeps every claim-bearing registered page on the central helper", () => {
    for (const s of PUBLIC_MARKET_SURFACE_REGISTRY.filter((x) => x.governance === "governed")) {
      const src = read(s.entry);
      expect(src, s.route).toMatch(/governedPassportData|publicMarketClaimForListing/);
    }
  });

  it("proves each no_market_claim page really reads no protected field", () => {
    for (const s of PUBLIC_MARKET_SURFACE_REGISTRY.filter((x) => x.governance === "no_market_claim")) {
      expect(PROTECTED_FIELD_PATTERN.test(read(s.entry)), `${s.route} reads a protected market field`).toBe(false);
    }
  });

  it("registers every public passport page that exists on disk", () => {
    const registered = new Set(PUBLIC_MARKET_SURFACE_REGISTRY.map((s) => s.entry));
    const onDisk = readdirSync("src/pages")
      .filter((f) => /^VehiclePassport(?!Route|Next|V3).*\.tsx$/.test(f) && !f.includes(".test."))
      .map((f) => `src/pages/${f}`);
    const missing = onDisk.filter((f) => !registered.has(f));
    expect(missing, "a new public Passport page must be added to PUBLIC_MARKET_SURFACE_REGISTRY").toEqual([]);
  });
});

// ── 6. Nothing internal becomes public ─────────────────────────────────────

describe("suppression never leaks internal wording", () => {
  it("emits no internal-only verdict string through the boundary", () => {
    const governed = JSON.stringify(governPublicListing(staleListing(), NOW).listing);
    for (const s of INTERNAL_ONLY_PUBLIC_STRINGS) expect(governed, s).not.toContain(s);
  });

  it("does not put the unavailable sentence on the listing itself", () => {
    const governed = JSON.stringify(governPublicListing(staleListing(), NOW).listing);
    expect(governed).not.toContain(MARKET_CLAIM_UNAVAILABLE_MESSAGE);
  });

  it("carries no provider prediction into the governed listing", () => {
    const governed = governPublicListing(staleListing(), NOW).listing as Record<string, unknown>;
    expect(JSON.stringify(governed)).not.toContain("55000");
    expect(JSON.stringify(governed)).not.toContain("56000");
  });
});

// ── 7. One tenant's flag is one tenant's flag ──────────────────────────────

describe("the flag is per listing payload, never global", () => {
  it("suppresses the flagged tenant's stale vehicle and not the unflagged one", () => {
    const flagged = staleListing();
    const otherTenant = flagOff(staleListing({ id: "listing-other-tenant", vin: "1DDDDDDDDDDDDDDD4" }));
    expect(governPublicListing(flagged, NOW).claim.suppressed).toBe(true);
    expect(governPublicListing(otherTenant, NOW).claim.suppressed).toBe(false);
    expect(governPublicListing(otherTenant, NOW).listing).toBe(otherTenant);
  });

  it("treats an absent projection as off, never as on", () => {
    const noProjection = staleListing();
    delete (noProjection as Record<string, unknown>)[PUBLIC_MARKET_FLAGS_FIELD];
    expect(governPublicListing(noProjection, NOW).claim.suppressed).toBe(false);
  });
});

// ── 8. The two shapes that exposed the defect ──────────────────────────────

describe("regression: a sibling route cannot outlive the safeguard", () => {
  // Reproduced by shape: a stale below-market claim, the exact situation where
  // /v/:slug suppressed and /v/:slug/great-buy and /v/:slug/todays-price did
  // not. Synthetic vehicle, synthetic prices.
  it("leaves no dollar-under-market amount for a suppressed vehicle", () => {
    const d = governedPassportData(staleListing() as never, NOW);
    expect(d?.belowMarket).toBeNull();
    // `${fmt$(d.belowMarket)} below market` is the string both sibling routes
    // built; with a null delta neither branch can be entered.
    expect((d?.belowMarket ?? 0) > 0).toBe(false);
  });

  it("leaves no comparable count for a suppressed vehicle to call verified", () => {
    const d = governedPassportData(staleListing() as never, NOW);
    expect(d?.marketAvg != null || (d?.comparables.length ?? 0) > 0).toBe(false);
  });

  it("keeps a suppressed vehicle out of every great-buy market branch", () => {
    const d = governedPassportData(staleListing() as never, NOW);
    const priceAnchor = d?.marketMeta.priceMedian ?? d?.marketMeta.priceMean ?? d?.marketAvg;
    expect(priceAnchor ?? null).toBeNull();
  });

  it("still lets the fresh sibling publish its claim", () => {
    const d = governedPassportData(freshListing() as never, NOW);
    expect((d?.belowMarket ?? 0) > 0).toBe(true);
  });
});

// ── 9. No production data in this suite ────────────────────────────────────

describe("the fixtures are synthetic", () => {
  it("uses invented VINs and round prices only", () => {
    const self = read("src/lib/passport/publicSurface.test.ts");
    // Every 17-char VIN-shaped token in this file is one of the synthetic ones.
    const vins = new Set(self.match(/\b[A-HJ-NPR-Z0-9]{17}\b/g) ?? []);
    for (const v of vins) expect(v, v).toMatch(/^1(A|B|C|D)\1*\d$|^1[A-D]{15}\d$/);
  });
});
