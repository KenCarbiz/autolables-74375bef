import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// One array used to be both the price evidence and the cars we invite a
// shopper to look at. The market search deliberately excludes the dealer's own
// rooftop -- correct for evidence, and it meant the only cars left to offer
// were competitors'. A shopper on a Harte passport was shown a car 91 miles
// away at another store.
//
// These pin the separation, because the two will drift back together the
// moment someone edits the pricing maths without noticing what else reads it.

const ROOT = join(__dirname, "..", "..", "..");
const enrich = readFileSync(join(ROOT, "supabase/functions/vehicle-enrich/index.ts"), "utf8");
const view = readFileSync(join(ROOT, "supabase/functions/public-listing-view/index.ts"), "utf8");
const passport = readFileSync(join(ROOT, "src/pages/VehiclePassportGoverned.tsx"), "utf8");

describe("evidence and offer are separate sets", () => {
  it("keeps the dealer's own rooftop out of the market evidence", () => {
    // A dealer's own cars are not independent evidence of the market.
    expect(enrich).toMatch(/const rows: any\[\] = all\.filter\(\(l: any\) => notSubject\(l\) && !isOurs\(l\)\)/);
  });

  it("keeps ONLY the dealer's own rooftop in the offer", () => {
    expect(enrich).toMatch(/const groupRows: any\[\] = all\.filter\(\(l: any\) => notSubject\(l\) && isOurs\(l\)\)/);
  });

  it("treats a same-lot listing as ours even when the seller name differs", () => {
    expect(enrich).toMatch(/return Number\(l\.dist\) === 0;/);
  });

  it("stores the offer under its own column, not inside comparables", () => {
    expect(enrich).toMatch(/patch\.group_similar = comps\.groupSimilar;/);
  });
});

describe("never detract from the car they came in on", () => {
  it("drops only a car that wins on every axis at once", () => {
    // Cheaper alone is fine -- a cheaper car in a different segment is often
    // the right offer. Cheaper AND same trim AND same-or-fewer miles is the
    // one that loses the deal.
    const rule = enrich.slice(enrich.indexOf("const cannibalises"), enrich.indexOf("const groupSimilar"));
    expect(rule).toMatch(/if \(p == null \|\| listingPrice == null \|\| p >= listingPrice\) return false;/);
    expect(rule).toMatch(/return sameTrim\(l\.build\?\.trim\) && fewerOrEqualMiles;/);
  });

  it("does not apply a blunt price floor to the dealer's own cars", () => {
    // A cheaper car of theirs is a sale, not a leak. The floor belongs to the
    // market evidence, where it keeps the price claim honest.
    const offer = view.slice(view.indexOf("row.group_similar = "), view.indexOf("if (row.market_meta"));
    expect(offer).not.toMatch(/ourPrice/);
    expect(offer).toMatch(/Number\.isFinite\(p\) && p > 0/);
  });
});

describe("the shopper never sees a competitor as an offer", () => {
  it("renders the offer, not the evidence", () => {
    expect(passport).toMatch(/group_similar\?: typeof d\.comparables/);
    expect(passport).toMatch(/\.group_similar\) \?\? \[\],/);
    expect(passport).not.toMatch(/normalizeComparables\(\s*\{[^}]*\},\s*d\.comparables,\s*\)/);
  });

  it("ships no dealer name to an anonymous page", () => {
    // Competitor identity stays off the payload, same rule the market set has.
    const offer = view.slice(view.indexOf("row.group_similar = "), view.indexOf("if (row.market_meta"));
    expect(offer).not.toMatch(/dealer:/);
  });
});
