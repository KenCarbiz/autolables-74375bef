import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  savingsAgainst, buildSavingsClaim, fmtMoney, MARKET_METRIC_LABEL, countDocumentTruth,
  type MarketMetric,
} from "./vehicleTruth";

// The reference vehicle (3PCAJ5JR1SF103167) showed three contradictions at
// once, all of which reduce to the same root cause: several surfaces derived
// the same fact independently.
//
//   Passport      Title & Brand ....... Pending
//   Passport      Vehicle History ..... Not available
//   Buying Report History & Title ..... 86/100, "Strong"
//
//   Passport      Normalized market value $42,880 − $38,981 = $3,899 below  (valid)
//   Buying Report Market average         $39,049 − $38,981 = $68            (shown as $3,899)
//
// These pin the corrected behaviour at the level where it is decided.

const metric = (key: MarketMetric["key"], value: number | null): MarketMetric => ({
  key, label: MARKET_METRIC_LABEL[key], value, sampleSize: null, checkedAt: null,
});

describe("a savings number is derived from the value printed beside it", () => {
  it("reproduces the valid normalized-market-value claim", () => {
    expect(savingsAgainst(42_880, 38_981)).toBe(3_899);
  });

  it("returns the real $68 gap for the comparable listing average, not $3,899", () => {
    // The exact defect: this number used to be rendered as $3,899 because it
    // was computed against a different metric than the one displayed.
    expect(savingsAgainst(39_049, 38_981)).toBe(68);
  });

  it("gives no savings claim when the vehicle is at or above the comparison", () => {
    expect(savingsAgainst(38_981, 38_981)).toBeNull();
    expect(savingsAgainst(38_000, 38_981)).toBeNull();
  });

  it("refuses to invent a claim from a missing metric", () => {
    expect(savingsAgainst(null, 38_981)).toBeNull();
    expect(savingsAgainst(42_880, null)).toBeNull();
    expect(savingsAgainst(Number.NaN, 38_981)).toBeNull();
  });
});

describe("a claim carries the basis it was measured against", () => {
  it("names the normalized market value in the sentence", () => {
    const c = buildSavingsClaim(metric("normalized_market_value", 42_880), 38_981);
    expect(c).not.toBeNull();
    expect(c!.amount).toBe(3_899);
    expect(c!.comparisonValue).toBe(42_880);
    expect(c!.sentence).toBe("$3,899 below the normalized market value");
  });

  it("names the comparable listing average when that is the basis", () => {
    const c = buildSavingsClaim(metric("comparable_listing_average", 39_049), 38_981);
    expect(c!.amount).toBe(68);
    expect(c!.sentence).toBe("$68 below the comparable listing average");
  });

  it("never labels one metric as the other", () => {
    expect(MARKET_METRIC_LABEL.normalized_market_value).not.toBe(MARKET_METRIC_LABEL.comparable_listing_average);
    expect(MARKET_METRIC_LABEL.comparable_listing_average).not.toMatch(/normalized/i);
  });

  it("formats money one way everywhere", () => {
    expect(fmtMoney(38_981)).toBe("$38,981");
    expect(fmtMoney(null)).toBe("—");
  });
});

// ── The scoring gate, asserted at the source that decides it ────────────────
const v2 = readFileSync(join(__dirname, "..", "passportV2Data.ts"), "utf8");

describe("missing evidence cannot lift a confidence score", () => {
  it("blocks the History & Title score until title AND history have returned", () => {
    // `knownSignals >= 2` alone was the old gate, and recall status plus a
    // warranty string satisfy it — neither is history or title.
    expect(v2).toMatch(/const titleResolved = titleStatus !== "unknown";/);
    expect(v2).toMatch(/const historyResolved = accidentCount != null \|\| ownerCount != null;/);
    expect(v2).toMatch(/const confScore = confBlockedBy\.length === 0 && knownSignals >= 2/);
  });

  it("says which source is missing rather than showing a bare blank", () => {
    expect(v2).toMatch(/confBlockedBy\.push\("Title & brand"\)/);
    expect(v2).toMatch(/confBlockedBy\.push\("Vehicle history"\)/);
    expect(v2).toMatch(/\? \(confBlockedBy\.length \? "Insufficient data" : ""\)/);
  });

  it("keeps a null score out of the overall rating rather than defaulting it", () => {
    // deriveRating already averages over measured factors only; this pins that
    // the history factor still reads the gated value and is not re-defaulted.
    expect(v2).toMatch(/label: "History & Title", score: d\.confScore/);
    expect(v2).toMatch(/const measured = factors\.filter\(\(f\) => f\.score != null\);/);
  });
});

// ── The Buying Report row that produced the impossible badge ────────────────
const greatBuy = readFileSync(join(__dirname, "..", "..", "pages", "VehiclePassportGreatBuy.tsx"), "utf8");

describe("the Buying Report comparison row cannot drift from its badge", () => {
  it("derives the advantage from the value the row prints", () => {
    expect(greatBuy).toMatch(/const priceSaving = priceComparison \? savingsAgainst\(priceComparison\.value, d\.price\) : null;/);
    expect(greatBuy).toMatch(/priceSaving != null \? \{ text: `\$\{fmt\$\(priceSaving\)\} below`, good: true \}/);
  });

  it("no longer reads the badge off d.belowMarket while printing another metric", () => {
    const rule = greatBuy.slice(greatBuy.indexOf("const priceComparison"), greatBuy.indexOf("const posRows"));
    expect(rule).not.toMatch(/d\.belowMarket/);
  });

  it("prints the metric's own name in the comparison cell", () => {
    expect(greatBuy).toMatch(/\$\{priceComparison\.label\}/);
  });

  it("stops calling every comparison column a market average", () => {
    expect(greatBuy).not.toMatch(/>Market Average</);
    expect(greatBuy).toMatch(/>Compared With</);
  });
});

// ── Document claims ────────────────────────────────────────────────────────
describe("document counts separate availability from verification", () => {
  const listing = {
    documents: [
      { type: "window_sticker", name: "Window Sticker", url: "https://x/a.pdf", verified: true },
      { type: "buyers_guide", name: "Buyers Guide", url: "https://x/b.pdf" },
      { type: "addendum_signed", name: "Signed Addendum", url: "https://x/c.pdf" },
    ],
    oem_brochure: { url: "https://infiniti.com/b.pdf" },
    history_report_url: "https://carfax.com/x",
  } as never;

  it("counts a signed record as signed, not as plainly available", () => {
    const c = countDocumentTruth(listing);
    expect(c.signed).toBe(1);
    expect(c.availableNow).toBe(2);
  });

  it("counts external links separately from records we hold", () => {
    const c = countDocumentTruth(listing);
    expect(c.externalSource).toBe(2);
    expect(c.dealerProvided).toBe(3);
  });

  it("never reports more verified than exist", () => {
    const c = countDocumentTruth(listing);
    expect(c.verified).toBe(1);
    expect(c.verified).toBeLessThanOrEqual(c.dealerProvided);
  });

  it("returns zeroes rather than throwing on a vehicle with no documents", () => {
    const c = countDocumentTruth({} as never);
    expect(c.total).toBe(0);
    expect(c.verified).toBe(0);
  });
});

describe("an unscored category is shown, and says why", () => {
  it("labels a blocked History & Title 'Insufficient data', not 'Pending'", () => {
    expect(greatBuy).toMatch(/pendingLabel: b\.label === "History & Title" && d\.confBlockedBy\.length \? "Insufficient data" : "Pending"/);
  });

  it("names the sources it is waiting on", () => {
    expect(greatBuy).toMatch(/Not scored — awaiting \$\{d\.confBlockedBy\.join\(" and "\)\.toLowerCase\(\)\}/);
  });

  it("still renders the category rather than dropping it from the report", () => {
    expect(greatBuy).toMatch(/pendingCards\.length > 0 && \(/);
    expect(greatBuy).toMatch(/Confirm Before Purchase/);
  });

  it("refuses a Strong headline while title and history are unverified", () => {
    expect(greatBuy).toMatch(/const historyBlocked = rating\.factors\.some\(\(f\) => f\.key === "history" && f\.score == null\) && d\.confBlockedBy\.length > 0;/);
    expect(greatBuy).toMatch(/\? "Promising — Title & History Not Yet Verified"/);
  });
});
