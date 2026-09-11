// ── Frontend SAFE RECOVERY mode ────────────────────────────────────────────
//
// This suite qualifies the Gate 14G.5 frontend recovery patch and runs ONLY
// against a build carrying it. It is not part of main and must never be merged
// there: on an unpatched tree these assertions are false by construction.
//
// What the patch does: forces `suppressionEnabled: false` at its single source
// in publicClaim.ts, so every surface reached through
// publicMarketClaimForListing -> decidePublicMarketClaimForTenant renders the
// verified flag-off behaviour no matter what is stored.

import { describe, it, expect } from "vitest";
import {
  publicMarketClaimForListing, decidePublicMarketClaim,
  projectPublicMarketFlags, readPublicMarketFlags,
  PUBLIC_MARKET_FLAG_ALLOWLIST, PUBLIC_MARKET_FLAGS_FIELD,
  MARKET_CLAIM_UNAVAILABLE_MESSAGE, INTERNAL_ONLY_PUBLIC_STRINGS,
  isInternalOnlyCopy,
} from "./publicClaim.ts";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 11);

/** A listing that an ACTIVATED build would suppress on every count. */
const worstCase = (extra: Record<string, unknown> = {}) => ({
  id: "listing-recovery-1",
  price: 30_000,
  market_value: 29_000,
  market_position: "above_market",
  // far beyond PUBLIC_MARKET_FRESHNESS_DAYS
  market_checked_at: new Date(NOW - 90 * DAY).toISOString(),
  ...extra,
});

describe("recovery mode forcibly disables suppression", () => {
  it("shows the claim for a listing that would otherwise be suppressed as stale", () => {
    const d = publicMarketClaimForListing(worstCase() as never, NOW);
    expect(d.show).toBe(true);
    expect(d.suppressed).toBe(false);
  });

  it("reports the recovery reason rather than a suppression reason", () => {
    const d = publicMarketClaimForListing(worstCase() as never, NOW);
    expect(d.reasons).toContain("suppression_disabled");
  });
});

describe("stored suppression cannot override recovery mode", () => {
  it("ignores a literal true in the allow-listed public projection", () => {
    const listing = worstCase({
      [PUBLIC_MARKET_FLAGS_FIELD]: { market_invalid_claim_suppression: true },
    });
    expect(publicMarketClaimForListing(listing as never, NOW).show).toBe(true);
  });

  it("ignores a literal true in the dealer_snapshot fallback", () => {
    const listing = worstCase({
      dealer_snapshot: { market_flags: { market_invalid_claim_suppression: true } },
    });
    expect(publicMarketClaimForListing(listing as never, NOW).show).toBe(true);
  });

  it("ignores both sources set at once", () => {
    const listing = worstCase({
      [PUBLIC_MARKET_FLAGS_FIELD]: { market_invalid_claim_suppression: true },
      dealer_snapshot: { market_flags: { market_invalid_claim_suppression: true } },
    });
    expect(publicMarketClaimForListing(listing as never, NOW).show).toBe(true);
  });
});

describe("nothing internal reaches the customer in recovery mode", () => {
  it("never emits the unavailable message", () => {
    for (const l of [worstCase(), worstCase({ market_value: null }), worstCase({ price: null })]) {
      const d = publicMarketClaimForListing(l as never, NOW);
      expect(d.customerMessage).not.toBe(MARKET_CLAIM_UNAVAILABLE_MESSAGE);
    }
  });

  it("never emits internal-only copy", () => {
    const d = publicMarketClaimForListing(worstCase() as never, NOW);
    expect(isInternalOnlyCopy(d.customerMessage)).toBe(false);
    for (const s of INTERNAL_ONLY_PUBLIC_STRINGS) {
      expect(d.customerMessage ?? "").not.toContain(s);
    }
  });

  it("still recognises internal-only copy when asked directly", () => {
    // The detector itself is untouched by the patch.
    expect(isInternalOnlyCopy("Limited Market Evidence")).toBe(true);
  });
});

describe("the price and its surrounding fields are untouched by the patch", () => {
  it("leaves the listing price on the record the surfaces read", () => {
    const listing = worstCase();
    publicMarketClaimForListing(listing as never, NOW);
    expect(listing.price).toBe(30_000);
  });

  it("decides without mutating the listing it was handed", () => {
    const listing = worstCase();
    const before = JSON.stringify(listing);
    publicMarketClaimForListing(listing as never, NOW);
    expect(JSON.stringify(listing)).toBe(before);
  });
});

describe("unrelated public-claim behaviour is preserved", () => {
  it("keeps the explicit-options entry point honest", () => {
    // decidePublicMarketClaim still honours a caller that passes true; the
    // patch changes only the flag-reading wrapper, not the decision engine.
    const d = decidePublicMarketClaim(
      { subjectPrice: 30_000, marketValue: 29_000, position: "above_market",
        checkedAt: new Date(NOW - 90 * DAY).toISOString() } as never,
      { suppressionEnabled: true, now: NOW },
    );
    expect(d.show).toBe(false);
  });

  it("still narrows the public projection to the allow-list of one", () => {
    const projected = projectPublicMarketFlags({
      market_flags: { market_invalid_claim_suppression: true, market_value_v2_public: true },
    });
    expect(Object.keys(projected)).toEqual([...PUBLIC_MARKET_FLAG_ALLOWLIST]);
  });

  it("still reads the projection in preference to the snapshot", () => {
    const listing = {
      [PUBLIC_MARKET_FLAGS_FIELD]: { market_invalid_claim_suppression: false },
      dealer_snapshot: { market_flags: { market_invalid_claim_suppression: true } },
    };
    // Returned in the shape readMarketFlag consumes, i.e. wrapped in market_flags.
    expect(readPublicMarketFlags(listing as never)).toEqual(
      { market_flags: { market_invalid_claim_suppression: false } },
    );
  });
});
