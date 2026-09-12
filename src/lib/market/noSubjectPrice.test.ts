// ── A market value is not a price, and may not stand in for one ────────────
//
// The defect this suite exists to prevent, stated plainly: on 2026-09-12 a
// published vehicle with no advertised price of its own rendered
// a normalized market value beside "THIS VEHICLE —", and that figure was the
// ONLY dollar figure anywhere on the page. Every safeguard passed. The claim
// was fresh, the label was accurate, the number sat in a market-value position
// and nothing was substituted into a price field.
//
// It was still wrong. A shopper asking "what does this cost" got one number
// back, and it was not the answer. Correct labelling does not rescue a page
// whose sole dollar figure is an estimate of a market.
//
// So `no_subject_price` is a suppression reason in its own right, decided in
// `decidePublicMarketClaim` beside staleness and inconsistency rather than in
// any component. And the subject price is resolved by `resolvePriceBasis` —
// not read off a column — because that resolver takes market_value, provider
// predictions, comparable medians, value-history points and MSRP as no kind of
// input at all. The substitution is impossible, not merely forbidden.
//
// Synthetic fixtures throughout. No production VIN, slug or price appears
// here; the live case is reproduced by SHAPE — fresh evidence, no price.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MARKET_CLAIM_NO_SUBJECT_PRICE_MESSAGE,
  MARKET_CLAIM_UNAVAILABLE_MESSAGE,
  NO_SUBJECT_PRICE_REASON,
  PUBLIC_MARKET_FLAGS_FIELD,
  INTERNAL_ONLY_PUBLIC_STRINGS,
  decidePublicMarketClaim,
  publicMarketClaimForListing,
  resolveSubjectPrice,
} from "./publicClaim.ts";
import { resolvePriceBasis } from "./priceBasis.ts";
import { isContextOnlyEvidence } from "./relationship.ts";
import { governPublicListing, governedPassportData, PUBLIC_MARKET_SURFACE_REGISTRY } from "@/lib/passport/publicSurface";
import { resolveMarketComparison } from "@/lib/passport/marketComparison";

const read = (p: string) => readFileSync(p, "utf8");
const NOW = Date.UTC(2026, 8, 12, 12, 0, 0);
const DAY = 86_400_000;
const iso = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();

const FLAGS = (on: boolean) => ({ [PUBLIC_MARKET_FLAGS_FIELD]: { market_invalid_claim_suppression: on } });

/**
 * A vehicle with fresh, self-consistent market evidence and NO price.
 *
 * Everything the old safeguard looked at is in order here: the timestamp is a
 * day old, the value is a real number, position and value cannot contradict
 * each other because the position is unknown. Before `no_subject_price` this
 * shape returned `claim_publishable`.
 */
const pricelessFresh = (extra: Record<string, unknown> = {}) => ({
  id: "listing-priceless-fresh",
  vin: "1DDDDDDDDDDDDDDD4",
  slug: "synthetic-priceless-fresh",
  condition: "new",
  price: null,
  website_sale_price: null,
  advertised_price_before_doc: null,
  doc_fee: null,
  market_value: 80_000,
  market_position: "unknown",
  market_checked_at: iso(1),
  market_payload: { marketValue: 80_000, high: 82_000, low: 78_000, belowMarket: 0, position: "unknown", checked_at: iso(1) },
  market_meta: null,
  comparables: [],
  mc_attributes: { engine: "V6", exterior_color: "White" },
  ...FLAGS(true),
  ...extra,
});

/** The same shape, priced. Nothing here may change. */
const pricedFresh = (extra: Record<string, unknown> = {}) => ({
  ...pricelessFresh(),
  id: "listing-priced-fresh",
  vin: "1EEEEEEEEEEEEEEE5",
  slug: "synthetic-priced-fresh",
  price: 75_000,
  website_sale_price: 75_000,
  doc_fee: 500,
  advertised_price_before_doc: 74_500,
  market_position: "below_market",
  ...extra,
});

describe("no_subject_price — the decision", () => {
  it("suppresses a fresh, otherwise-publishable claim when the vehicle has no price", () => {
    const claim = publicMarketClaimForListing(pricelessFresh() as never, NOW);
    expect(claim.show).toBe(false);
    expect(claim.suppressed).toBe(true);
    expect(claim.subjectPriceMissing).toBe(true);
    expect(claim.reasons).toContain(NO_SUBJECT_PRICE_REASON);
    // The point of the regression: freshness alone used to carry this vehicle.
    expect(claim.reasons).not.toContain("market_evidence_stale");
    expect(claim.reasons).not.toContain("claim_publishable");
  });

  it("keeps a priced, fresh, consistent claim publishable", () => {
    const claim = publicMarketClaimForListing(pricedFresh() as never, NOW);
    expect(claim.show).toBe(true);
    expect(claim.suppressed).toBe(false);
    expect(claim.subjectPriceMissing).toBe(false);
    expect(claim.reasons).toEqual(["claim_publishable"]);
  });

  it("records BOTH reasons, deterministically ordered, when evidence is stale AND there is no price", () => {
    const claim = publicMarketClaimForListing(
      pricelessFresh({ market_checked_at: iso(40) }) as never, NOW);
    expect(claim.show).toBe(false);
    expect(claim.subjectPriceMissing).toBe(true);
    expect(claim.reasons).toContain("market_evidence_stale");
    expect(claim.reasons).toContain(NO_SUBJECT_PRICE_REASON);
    // Staleness is evaluated before price, and neither masks the other.
    expect(claim.reasons.indexOf("market_evidence_stale"))
      .toBeLessThan(claim.reasons.indexOf(NO_SUBJECT_PRICE_REASON));
    // Same inputs, same answer, every time.
    expect(publicMarketClaimForListing(pricelessFresh({ market_checked_at: iso(40) }) as never, NOW).reasons)
      .toEqual(claim.reasons);
  });

  it("suppresses a price-less vehicle even when the market timestamp is missing entirely", () => {
    const claim = publicMarketClaimForListing(
      pricelessFresh({ market_checked_at: null }) as never, NOW);
    expect(claim.subjectPriceMissing).toBe(true);
    expect(claim.reasons).toContain("missing_market_timestamp");
    expect(claim.reasons).toContain(NO_SUBJECT_PRICE_REASON);
  });
});

describe("nothing else can become a subject price", () => {
  it("refuses market_value, provider prediction, comparable median, value history and another car's price", () => {
    // Each of these is a real number on the row, and none of them is this
    // vehicle's advertised price. All must leave the subject price null.
    const impostors: Record<string, unknown>[] = [
      { market_value: 80_000 },
      { market_payload: { marketValue: 80_000, high: 82_000, low: 78_000 } },
      { provider_prediction: 80_000 },
      { mc_attributes: { price_percentile: 40, comparable_median: 80_000, msrp: 90_000 } },
      { value_history: [{ captured_at: iso(3), market_value: 80_000, listing_price: 79_000 }] },
      { comparables: [{ vin: "1FFFFFFFFFFFFFFF6", price: 79_500 }] },
      { group_similar: [{ vin: "1GGGGGGGGGGGGGGG7", price: 79_500 }] },
    ];
    for (const extra of impostors) {
      const listing = pricelessFresh(extra);
      expect(resolveSubjectPrice(listing as never)).toBeNull();
      expect(publicMarketClaimForListing(listing as never, NOW).subjectPriceMissing).toBe(true);
    }
  });

  it("accepts only the approved advertised/dealer-price sources", () => {
    const cases: [string, Record<string, unknown>][] = [
      ["price", { price: 75_000 }],
      ["website_sale_price", { website_sale_price: 75_000 }],
      // `public-listing-view` always projects the tenant's fee treatment onto
      // the payload, so this is the shape a page actually receives.
      ["advertised_price_before_doc + doc_fee", {
        advertised_price_before_doc: 74_500, doc_fee: 500, advertised_excludes_doc_fee: false,
      }],
    ];
    for (const [label, extra] of cases) {
      const resolved = resolveSubjectPrice(pricelessFresh(extra) as never);
      expect(resolved, label).not.toBeNull();
      expect(resolved as number, label).toBeGreaterThan(0);
    }
  });

  it("will not invent a customer total when the doc-fee treatment is unknown", () => {
    // An advertised leg alone cannot say what the shopper pays: whether the
    // fee sits inside it is exactly the unanswered question. Conservative by
    // design — no price is a better answer than a guessed one.
    const resolved = resolveSubjectPrice(
      pricelessFresh({ advertised_price_before_doc: 74_500, doc_fee: 500 }) as never);
    expect(resolved).toBeNull();
  });

  it("routes the subject price through the canonical resolver, not a raw column", () => {
    // The resolver's own answer for the priced fixture is what the claim uses.
    const listing = pricedFresh();
    const basis = resolvePriceBasis({
      price: listing.price, websiteSalePrice: listing.website_sale_price,
      advertisedPriceBeforeDoc: listing.advertised_price_before_doc, docFee: listing.doc_fee,
      advertisedExcludesDocFee: null,
    });
    expect(resolveSubjectPrice(listing as never)).toBe(basis.displayedTotalPrice);
  });

  it("treats an implausible price as no price at all", () => {
    for (const price of [0, -1, 12, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(resolveSubjectPrice(pricelessFresh({ price }) as never)).toBeNull();
    }
  });

  it("never lets MSRP alone stand in as the advertised price", () => {
    const withMsrp = pricelessFresh({ mc_attributes: { msrp: 110_000 }, msrp: 110_000 });
    expect(resolveSubjectPrice(withMsrp as never)).toBeNull();
    expect(publicMarketClaimForListing(withMsrp as never, NOW).show).toBe(false);
  });
});

describe("the page cannot end up with a standalone market estimate", () => {
  it("strips every market field from a price-less listing", () => {
    const { listing: governed, claim } = governPublicListing(pricelessFresh() as never, NOW);
    expect(claim.show).toBe(false);
    const bag = governed as unknown as Record<string, unknown>;
    for (const f of ["market_value", "market_position", "market_checked_at", "market_payload", "market_meta", "comparables"]) {
      expect(bag[f], f).toBeNull();
    }
  });

  it("collapses the Market Comparison module to unavailable — no lone value, no em-dash pairing", () => {
    const { listing: governed } = governPublicListing(pricelessFresh() as never, NOW);
    const bag = governed as unknown as Record<string, unknown>;
    const mc = resolveMarketComparison({
      valueHistory: [],
      advertisedPrice: null,
      normalizedMarketValue: bag.market_value as number | null,
      checkedAt: bag.market_checked_at as string | null,
      nowMs: NOW,
    });
    // This is the exact shape that put a lone market value on a public page:
    // a static mode reached on the market value alone.
    expect(mc.mode).toBe("unavailable");
    expect(mc.normalizedMarketValue).toBeNull();
    expect(mc.advertisedPrice).toBeNull();
    expect(mc.diff).toBeNull();
  });

  it("leaves the derived passport with no market number to render", () => {
    const d = governedPassportData(pricelessFresh() as never, NOW);
    expect(d).not.toBeNull();
    for (const v of [d?.marketAvg, d?.marketLow, d?.marketHigh, d?.belowMarket, d?.aboveMarket]) {
      expect(v == null).toBe(true);
    }
    expect(d?.comparables.length ?? 0).toBe(0);
    expect(d?.marketMeta.priceMedian ?? null).toBeNull();
    expect(d?.marketMeta.similarCount ?? null).toBeNull();
  });

  it("produces no $0, undefined or NaN anywhere in the governed shape", () => {
    const { listing: governed } = governPublicListing(pricelessFresh() as never, NOW);
    const d = governedPassportData(pricelessFresh() as never, NOW);
    const serialized = JSON.stringify({ governed, d });
    expect(serialized).not.toMatch(/NaN/);
    expect(serialized).not.toMatch(/"\$0"/);
    expect(serialized).not.toMatch(/:\s*undefined/);
    // Suppression nulls a field; it never zeroes one. A $0 on a car page is a
    // worse answer than no answer.
    for (const v of [d?.marketAvg, d?.marketLow, d?.marketHigh, d?.belowMarket]) expect(v).not.toBe(0);
  });

  it("keeps the vehicle and its CTAs — suppression removes the claim, never the car", () => {
    const listing = pricelessFresh({
      sticky_bottom_buttons: { call: true, text: true, test_drive: true },
      dealer_snapshot: { name: "Synthetic Motors", phone: "555-0100" },
      photos: ["a.jpg", "b.jpg"],
      mileage: 12,
    });
    const { listing: governed } = governPublicListing(listing as never, NOW);
    const bag = governed as unknown as Record<string, unknown>;
    expect(bag.sticky_bottom_buttons).toEqual({ call: true, text: true, test_drive: true });
    expect(bag.dealer_snapshot).toEqual({ name: "Synthetic Motors", phone: "555-0100" });
    expect(bag.photos).toEqual(["a.jpg", "b.jpg"]);
    expect(bag.mileage).toBe(12);
    expect((bag.mc_attributes as Record<string, unknown>).engine).toBe("V6");
  });
});

describe("the neutral wording", () => {
  it("sends a price-less shopper to the dealer and never promises dealer pricing", () => {
    const claim = publicMarketClaimForListing(pricelessFresh() as never, NOW);
    expect(claim.customerMessage).toBe(MARKET_CLAIM_NO_SUBJECT_PRICE_MESSAGE);
    expect(MARKET_CLAIM_NO_SUBJECT_PRICE_MESSAGE)
      .toBe("Market comparison temporarily unavailable. Contact the dealer for current pricing.");
    expect(MARKET_CLAIM_NO_SUBJECT_PRICE_MESSAGE).not.toMatch(/dealer pricing remain/i);
  });

  it("keeps the existing sentence for a priced listing suppressed for another reason", () => {
    const claim = publicMarketClaimForListing(
      pricedFresh({ market_checked_at: iso(40) }) as never, NOW);
    expect(claim.suppressed).toBe(true);
    expect(claim.subjectPriceMissing).toBe(false);
    expect(claim.customerMessage).toBe(MARKET_CLAIM_UNAVAILABLE_MESSAGE);
  });

  it("says nothing diagnostic", () => {
    const claim = publicMarketClaimForListing(pricelessFresh() as never, NOW);
    const copy = (claim.customerMessage ?? "").toLowerCase();
    for (const s of INTERNAL_ONLY_PUBLIC_STRINGS) expect(copy).not.toContain(String(s).toLowerCase());
    expect(copy).not.toContain(NO_SUBJECT_PRICE_REASON);
    expect(copy).not.toMatch(/\$|\d/);
  });

  it("is rendered from the decision, not hardcoded, at every site on the governed page", () => {
    const src = read("src/pages/VehiclePassportGoverned.tsx");
    expect(src).not.toMatch(/Market comparison temporarily unavailable\. Vehicle information and dealer pricing remain available\.<\/p>/);
    expect(src).toMatch(/marketClaim\.subjectPriceMissing/);
    expect(src).toMatch(/MARKET_CLAIM_NO_SUBJECT_PRICE_MESSAGE/);
    // Both unavailable slots read the same resolved copy.
    expect(src.match(/\{marketUnavailableCopy\}/g)?.length).toBe(2);
  });
});

describe("every claim-bearing public route agrees", () => {
  it("governs the same decision through the one shared boundary", () => {
    const governedRoutes = PUBLIC_MARKET_SURFACE_REGISTRY.filter((s) => s.governance === "governed");
    expect(governedRoutes.length).toBeGreaterThanOrEqual(6);
    const hook = read("src/hooks/usePublicListing.ts");
    expect(hook).toMatch(/governPublicListing\(fetched\)/);
    expect(hook).toMatch(/marketClaim/);
    // Every governed entry point reads the listing through that hook, so the
    // no-price decision reaches all of them without any page repeating it.
    for (const s of governedRoutes) {
      const src = read(s.entry);
      // Either the shared fetch governs it, or the page reaches the same one
      // decision itself. There is no third way to render a claim.
      const governed = src.includes("usePublicListing")
        || src.includes("governedPassportData")
        || src.includes("publicMarketClaimForListing");
      expect(governed, s.route).toBe(true);
    }
  });

  it("yields no market number on any governed route's derivation for a price-less vehicle", () => {
    const d = governedPassportData(pricelessFresh() as never, NOW);
    const { listing: governed } = governPublicListing(pricelessFresh() as never, NOW);
    // great-buy's badge, the V2 detail average, the governed grid and the
    // classic page all key off these three. None may survive.
    expect(d?.marketAvg ?? null).toBeNull();
    expect((governed as unknown as Record<string, unknown>).market_value).toBeNull();
    expect(d?.comparables.length ?? 0).toBe(0);
  });

  it("gates every raw market-field read behind the claim", () => {
    for (const s of PUBLIC_MARKET_SURFACE_REGISTRY) {
      const src = read(s.entry);
      if (!/listing\.market_(value|payload|meta|checked_at)\b/.test(src)) continue;
      // A page may read the raw field only if it resolves the claim itself and
      // zeroes the field when the claim is refused.
      expect(src, s.route).toMatch(/publicMarketClaimForListing/);
      expect(src, s.route).toMatch(/marketClaim\.show\s*\?/);
    }
  });
});

describe("flag false is behaviourally identical", () => {
  it("shows the claim, returns the same object reference, and reports no missing price", () => {
    const listing = pricelessFresh(FLAGS(false));
    const { listing: governed, claim } = governPublicListing(listing as never, NOW);
    expect(claim.show).toBe(true);
    expect(claim.suppressed).toBe(false);
    expect(claim.reasons).toEqual(["suppression_disabled"]);
    // False here on purpose: a surface branching on it must not change copy on
    // a flag-false page.
    expect(claim.subjectPriceMissing).toBe(false);
    expect(claim.customerMessage).toBeNull();
    expect(governed).toBe(listing);
  });

  it("leaves a priced flag-false listing untouched too", () => {
    const listing = pricedFresh(FLAGS(false));
    const { listing: governed, claim } = governPublicListing(listing as never, NOW);
    expect(governed).toBe(listing);
    expect(claim.subjectPriceMissing).toBe(false);
  });
});

describe("internal awareness is unaffected", () => {
  it("still classifies an absent price as an internal work item", () => {
    // The public rule hides a number. It does not stop the engine noticing.
    const basis = resolvePriceBasis({
      price: null, websiteSalePrice: null, advertisedPriceBeforeDoc: null, docFee: null,
    });
    expect(basis.basisStatus).toBe("invalid");
    expect(basis.basisReasons).toContain("no_usable_price");
    expect(basis.displayedTotalPrice == null || basis.vehicleComparisonPrice == null).toBe(true);
  });

  it("keeps adjustment_required context-only", () => {
    expect(isContextOnlyEvidence({ compatibility: "adjustment_required" } as never)).toBe(true);
    expect(isContextOnlyEvidence({ compatibility: "context_only" } as never)).toBe(true);
    expect(isContextOnlyEvidence({ compatibility: "exact" } as never)).toBe(false);
  });

  it("never lets the provider prediction reach a public page as a price", () => {
    // `market_value` IS the provider's VIN-level predicted value — see the
    // header of marketComparison.ts. It is the prediction, under its storage
    // name, and it is the number that reached a shopper.
    const withPrediction = pricelessFresh({ v2_status: "unavailable" });
    expect(resolveSubjectPrice(withPrediction as never)).toBeNull();
    const claim = publicMarketClaimForListing(withPrediction as never, NOW);
    expect(claim.show).toBe(false);
    expect(claim.reasons).toContain(NO_SUBJECT_PRICE_REASON);
    expect(claim.reasons).toContain("v2_status_unavailable");
    const { listing: governed } = governPublicListing(withPrediction as never, NOW);
    // 80000 is the prediction; it must survive nowhere in the public shape.
    expect(JSON.stringify(governed)).not.toContain("80000");
    expect(JSON.stringify(governedPassportData(withPrediction as never, NOW))).not.toContain("80000");
  });
});

describe("the decision is reachable without a listing shape", () => {
  it("suppresses on a bare input with no subject price", () => {
    const claim = decidePublicMarketClaim(
      { marketValue: 80_000, marketPosition: "unknown", marketCheckedAt: iso(1), subjectPrice: null },
      { suppressionEnabled: true, now: NOW },
    );
    expect(claim.reasons).toContain(NO_SUBJECT_PRICE_REASON);
    expect(claim.subjectPriceMissing).toBe(true);
  });

  it("publishes the same input once a subject price is supplied", () => {
    const claim = decidePublicMarketClaim(
      { marketValue: 80_000, marketPosition: "unknown", marketCheckedAt: iso(1), subjectPrice: 75_000 },
      { suppressionEnabled: true, now: NOW },
    );
    expect(claim.show).toBe(true);
    expect(claim.reasons).toEqual(["claim_publishable"]);
  });
});
