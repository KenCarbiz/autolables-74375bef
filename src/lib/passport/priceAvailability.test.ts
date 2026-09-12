// ── Zero is not a price ─────────────────────────────────────────────────────
//
// The defect: `listing.price ?? 0` rendered "Our Price $0" on the classic
// listing and "$0/mo · For 72 months" on Today's Price for every vehicle the
// dealer had not priced. Both read as a real offer, and the finance term made
// the missing payment look deliberate rather than absent.
//
// The nullish default is the whole bug — it turns "we don't know" into "it
// costs nothing" — so the fix is a RESULT type that cannot be coerced back to
// a number, and these tests exist to keep it that way.
//
// A note on the matcher at the bottom: a blanket "$0 must never appear" rule
// would be wrong. A depreciation chart legitimately has a $0 axis origin, and
// a verified zero-dollar fee or add-on is a real, useful answer. What must
// never be zero is a SELLING PRICE or a PAYMENT. The matcher below classifies
// by role, not by substring.
//
// Synthetic fixtures only. No production VIN, slug or price.

import { describe, expect, it } from "vitest";
import {
  CONTACT_DEALER_FOR_PRICE,
  PAYMENT_UNAVAILABLE_MESSAGE,
  canEstimatePayment,
  priceAvailabilityFromAmount,
  resolvePriceAvailability,
} from "./priceAvailability.ts";
import { PUBLIC_MARKET_FLAGS_FIELD, publicMarketClaimForListing } from "@/lib/market/publicClaim";
import { governPublicListing } from "./publicSurface.ts";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");
const NOW = Date.UTC(2026, 8, 12, 12, 0, 0);
const DAY = 86_400_000;
const iso = (d: number) => new Date(NOW - d * DAY).toISOString();

const priceless = (extra: Record<string, unknown> = {}) => ({
  id: "listing-priceless",
  price: null, website_sale_price: null, advertised_price_before_doc: null, doc_fee: null,
  market_value: 80_000, market_position: "unknown", market_checked_at: iso(1),
  market_payload: { marketValue: 80_000 },
  [PUBLIC_MARKET_FLAGS_FIELD]: { market_invalid_claim_suppression: true },
  ...extra,
});

const priced = (extra: Record<string, unknown> = {}) => ({
  ...priceless(),
  id: "listing-priced",
  price: 75_000, website_sale_price: 75_000, advertised_price_before_doc: 74_500, doc_fee: 500,
  advertised_excludes_doc_fee: false,
  ...extra,
});

describe("a missing price never becomes zero", () => {
  it("reports unavailable for null, undefined and an absent listing", () => {
    expect(resolvePriceAvailability(priceless() as never))
      .toEqual({ available: false, reason: "no_price_source" });
    expect(resolvePriceAvailability(priceless({ price: undefined }) as never).available).toBe(false);
    expect(resolvePriceAvailability(null).available).toBe(false);
    expect(resolvePriceAvailability(undefined).available).toBe(false);
  });

  it("reports unavailable for zero, negatives and implausible figures", () => {
    for (const price of [0, -1, -75_000, 12, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = resolvePriceAvailability(priceless({ price }) as never);
      expect(r.available, String(price)).toBe(false);
    }
    // A derived amount goes through the same gate.
    expect(priceAvailabilityFromAmount(0)).toEqual({ available: false, reason: "non_positive" });
    expect(priceAvailabilityFromAmount(-5)).toEqual({ available: false, reason: "non_positive" });
    expect(priceAvailabilityFromAmount(null)).toEqual({ available: false, reason: "no_price_source" });
    expect(priceAvailabilityFromAmount(undefined)).toEqual({ available: false, reason: "no_price_source" });
  });

  it("never exposes a numeric amount on the unavailable branch", () => {
    const r = resolvePriceAvailability(priceless() as never);
    expect(r.available).toBe(false);
    // The type has no amount here; assert the shape so a future edit cannot
    // quietly add `amount: 0` and let callers coerce it.
    expect(Object.keys(r).sort()).toEqual(["available", "reason"]);
    expect((r as Record<string, unknown>).amount).toBeUndefined();
  });

  it("resolves a real advertised price unchanged", () => {
    const r = resolvePriceAvailability(priced() as never);
    expect(r.available).toBe(true);
    expect(r.available && r.amount).toBe(75_000);
  });
});

describe("no market figure can become a vehicle price", () => {
  it("refuses market value, provider prediction, comparable median, value history and MSRP", () => {
    const impostors: Record<string, unknown>[] = [
      { market_value: 80_000 },
      { market_payload: { marketValue: 80_000, high: 82_000, low: 78_000 } },
      { mc_attributes: { comparable_median: 80_000, msrp: 90_000 } },
      { msrp: 90_000 },
      { value_history: [{ captured_at: iso(2), market_value: 80_000, listing_price: 79_000 }] },
      { comparables: [{ vin: "1ZZZZZZZZZZZZZZZ9", price: 79_500 }] },
    ];
    for (const extra of impostors) {
      expect(resolvePriceAvailability(priceless(extra) as never).available).toBe(false);
    }
  });
});

describe("payment abstains without a price", () => {
  it("permits a payment only when a price is available", () => {
    expect(canEstimatePayment(resolvePriceAvailability(priced() as never))).toBe(true);
    expect(canEstimatePayment(resolvePriceAvailability(priceless() as never))).toBe(false);
    expect(canEstimatePayment(priceAvailabilityFromAmount(0))).toBe(false);
  });

  it("uses the approved wording and never a zero payment or a bare term", () => {
    expect(PAYMENT_UNAVAILABLE_MESSAGE)
      .toBe("Payment estimate unavailable until dealer pricing is available.");
    expect(PAYMENT_UNAVAILABLE_MESSAGE).not.toMatch(/\$|\d/);
    expect(CONTACT_DEALER_FOR_PRICE).toBe("Contact Dealer for Price");
    expect(CONTACT_DEALER_FOR_PRICE).not.toMatch(/\$|\d/);
  });
});

describe("the affected public surfaces are wired to the contract", () => {
  it("the classic listing no longer defaults the price to zero", () => {
    const src = read("src/pages/PublicListing.tsx");
    expect(src).not.toMatch(/const price = listing\.price \?\? 0;/);
    expect(src).toMatch(/resolvePriceAvailability/);
    expect(src).toMatch(/CONTACT_DEALER_FOR_PRICE/);
    // Every headline price render is gated on availability.
    expect(src).toMatch(/priceAvailability\.available\s*\n?\s*\?\s*<div[^>]*>\{fmt\$\(price\)\}/);
  });

  it("Today's Price abstains instead of printing a zero payment", () => {
    const src = read("src/components/passport/TodaysPriceExperience.tsx");
    expect(src).not.toMatch(/const price = d\.price \?\? 0;/);
    expect(src).toMatch(/paymentAvailable/);
    expect(src).toMatch(/PAYMENT_UNAVAILABLE_MESSAGE/);
    // The finance term must live inside the available branch, never beside an
    // absent payment.
    const termLine = src.match(/For \{term\} months at/);
    expect(termLine).not.toBeNull();
    const idx = src.indexOf("For {term} months at");
    const guard = src.lastIndexOf("paymentAvailable ? (", idx);
    expect(guard).toBeGreaterThan(-1);
    expect(idx - guard).toBeLessThan(600);
  });

  it("neither surface invents a price from a market figure", () => {
    for (const f of ["src/pages/PublicListing.tsx", "src/components/passport/TodaysPriceExperience.tsx"]) {
      const src = read(f);
      // Assignment forms only. `price={price} avg={marketAvg}` is a JSX prop
      // pair, not a substitution, and must not be mistaken for one.
      expect(src, f).not.toMatch(/(?:const|let|var)\s+price\s*=[^;\n]*market_value/);
      expect(src, f).not.toMatch(/(?:const|let|var)\s+price\s*=[^;\n]*marketAvg/);
      expect(src, f).not.toMatch(/(?:const|let|var)\s+price\s*=[^;\n]*(?:normalizedMarketValue|provider_prediction|msrp)/);
    }
  });
});

describe("the market safeguard stays separate and still works", () => {
  it("still suppresses the standalone market value for a price-less vehicle", () => {
    const claim = publicMarketClaimForListing(priceless() as never, NOW);
    expect(claim.show).toBe(false);
    expect(claim.subjectPriceMissing).toBe(true);
    const { listing: governed } = governPublicListing(priceless() as never, NOW);
    expect((governed as unknown as Record<string, unknown>).market_value).toBeNull();
  });

  it("leaves a priced, fresh listing publishable", () => {
    expect(publicMarketClaimForListing(priced() as never, NOW).show).toBe(true);
  });

  it("agrees with price availability about which vehicles have a price", () => {
    for (const l of [priceless(), priced()]) {
      const claim = publicMarketClaimForListing(l as never, NOW);
      const avail = resolvePriceAvailability(l as never);
      // One resolver, one answer: the claim's "subject price missing" and the
      // presentation's "price unavailable" can never disagree.
      expect(claim.subjectPriceMissing).toBe(!avail.available);
    }
  });
});

// ── Route-aware artifact matcher ────────────────────────────────────────────
//
// Replaces a global "$0 is forbidden" rule, which would have condemned a
// chart axis and a genuinely free fee alongside the real defects.

type MoneyRole = "sale_price" | "payment" | "market_value" | "chart_axis" | "verified_zero_fee";

export interface MoneyArtifact { role: MoneyRole; rendered: string }

/** A rendered money string is a defect only when a PRICE or PAYMENT is zero. */
export function isMoneyArtifact(a: MoneyArtifact): boolean {
  const zero = /^\$0(\.00)?(\/mo)?$/.test(a.rendered.trim());
  if (!zero) return false;
  return a.role === "sale_price" || a.role === "payment";
}

describe("route-aware artifact matcher", () => {
  it("flags a zero selling price and a zero payment", () => {
    expect(isMoneyArtifact({ role: "sale_price", rendered: "$0" })).toBe(true);
    expect(isMoneyArtifact({ role: "payment", rendered: "$0/mo" })).toBe(true);
  });

  it("permits a chart axis origin, a verified zero fee and a real market value", () => {
    expect(isMoneyArtifact({ role: "chart_axis", rendered: "$0" })).toBe(false);
    expect(isMoneyArtifact({ role: "verified_zero_fee", rendered: "$0" })).toBe(false);
    expect(isMoneyArtifact({ role: "market_value", rendered: "$80,000" })).toBe(false);
  });

  it("does not flag real prices or payments", () => {
    expect(isMoneyArtifact({ role: "sale_price", rendered: "$75,000" })).toBe(false);
    expect(isMoneyArtifact({ role: "payment", rendered: "$1,043/mo" })).toBe(false);
  });

  it("is not a substring rule — $0 inside a larger figure is untouched", () => {
    expect(isMoneyArtifact({ role: "sale_price", rendered: "$20,500" })).toBe(false);
    expect(isMoneyArtifact({ role: "payment", rendered: "$304/mo" })).toBe(false);
  });
});

describe("a verified zero-dollar amount is still a real answer", () => {
  it("keeps a zero mandatory add-on valid and distinct from a missing price", () => {
    // A dealer who charges no mandatory add-on has ANSWERED the question. That
    // zero is data; a missing vehicle price is the absence of data. The two
    // must not be conflated.
    const zeroAddOns = priced({ mandatory_dealer_add_ons: 0 });
    expect(resolvePriceAvailability(zeroAddOns as never).available).toBe(true);
    expect(isMoneyArtifact({ role: "verified_zero_fee", rendered: "$0" })).toBe(false);
  });

  it("keeps a zero doc fee from making a real price unavailable", () => {
    const noDocFee = priced({ doc_fee: 0, advertised_price_before_doc: 75_000 });
    expect(resolvePriceAvailability(noDocFee as never).available).toBe(true);
  });
});

describe("nothing here can reach a provider", () => {
  it("resolves entirely from the listing, with no network or write surface", () => {
    const src = read("src/lib/passport/priceAvailability.ts");
    for (const forbidden of ["fetch(", "supabase", "functions.invoke", "insert(", "update(", "marketcheck"]) {
      expect(src, forbidden).not.toContain(forbidden);
    }
  });
});
