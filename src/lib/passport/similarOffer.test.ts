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
const cohort = readFileSync(join(ROOT, "supabase/functions/_shared/compCohort.ts"), "utf8");
const projection = readFileSync(join(ROOT, "supabase/functions/_shared/publicListingProjection.ts"), "utf8");
const passport = readFileSync(join(ROOT, "src/pages/VehiclePassportGoverned.tsx"), "utf8");

describe("evidence and offer are separate sets", () => {
  it("keeps the dealer's own rooftop out of the market evidence", () => {
    // A dealer's own cars are not independent evidence of the market.
    expect(enrich).toMatch(/const split = splitCohortRows\(all, subjectVin, dealerName\);\s+const rows = split\.rows;/);
    expect(cohort).toMatch(/\(isOurs\(l\) \? ownRows : rows\)\.push\(l\)/);
  });

  it("keeps ONLY the dealer's own rooftop in the offer", () => {
    expect(enrich).toMatch(/const groupRows = split\.ownRows;/);
  });

  it("treats a same-lot listing as ours even when the seller name differs", () => {
    expect(cohort).toMatch(/return Number\(l\.dist\) === 0;/);
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
    const offer = projection.slice(projection.indexOf("export const projectComparables"), projection.indexOf("export const projectValueHistory"));
    expect(offer).not.toMatch(/ourPrice/);
    expect(offer).toMatch(/Number\.isFinite\(p\) && p > 0/);
    expect(projection).toMatch(/out\.group_similar = projectComparables\(out\.group_similar/);
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
    expect(projection).toMatch(/const COMP_KEYS = \[[^\]]*\]/);
    expect(projection.match(/const COMP_KEYS = \[([^\]]*)\]/)![1]).not.toMatch(/dealer|vin/);
    expect(projection).toMatch(/opts\?\.forFeed \? OWN_STOCK_FEED_KEYS : \[\]/);
  });
});
