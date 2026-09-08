import { describe, it, expect } from "vitest";
import {
  classifyListing, shouldIngest, isStrictRooftop, normStreet, normZip, normHost, prunePreflight,
  type ListingIdentity, type Rooftop,
} from "../../../supabase/functions/_shared/rooftopMatch";

// The tenant in the reported drift: one rooftop inside a multi-store group,
// where every sibling shares the state and the group's naming stem.
const ROOFTOP: Rooftop = {
  domain: "harteinfiniti.com",
  state: "CT",
  street: normStreet("150 Weston Street"),
  zip: "06120",
};

const listing = (over: Partial<ListingIdentity>): ListingIdentity => ({
  hosts: [], state: "", street: "", zip: "", ...over,
});

describe("street normalization", () => {
  it("treats the same address written different ways as equal", () => {
    const forms = ["150 Weston Street", "150 Weston St.", "150 WESTON ST", "150  weston   street"];
    const normalized = forms.map(normStreet);
    expect(new Set(normalized).size).toBe(1);
  });

  it("does not collapse genuinely different addresses", () => {
    expect(normStreet("150 Weston St")).not.toBe(normStreet("250 Weston St"));
    expect(normStreet("150 Weston St")).not.toBe(normStreet("150 Preston St"));
  });

  it("normalizes zip and host forms", () => {
    expect(normZip("06120-4471")).toBe("06120");
    expect(normHost("https://www.harteinfiniti.com/inventory/used")).toBe("harteinfiniti.com");
  });
});

describe("classifyListing", () => {
  it("matches our own rooftop by address", () => {
    const l = listing({ street: normStreet("150 Weston St"), zip: "06120", state: "CT" });
    expect(classifyListing(l, ROOFTOP)).toBe("match");
  });

  it("rejects a sibling store in the same group, state, and city", () => {
    const sibling = listing({ street: normStreet("500 Connecticut Blvd"), zip: "06108", state: "CT" });
    expect(classifyListing(sibling, ROOFTOP)).toBe("mismatch");
  });

  it("rejects a sibling even when it carries the group domain", () => {
    const sibling = listing({
      hosts: ["harteinfiniti.com"], street: normStreet("500 Connecticut Blvd"), zip: "06108", state: "CT",
    });
    // Address is decisive: a syndicated sibling car on our own domain is theirs.
    expect(classifyListing(sibling, ROOFTOP)).toBe("mismatch");
  });

  it("rejects a different rooftop at the same ZIP", () => {
    const sameZip = listing({ street: normStreet("400 Weston St"), zip: "06120", state: "CT" });
    expect(classifyListing(sameZip, ROOFTOP)).toBe("mismatch");
  });

  it("never lets a shared state alone prove ownership", () => {
    // This is the exact regression: a listing with no host and no address used
    // to pass because its state equalled the tenant's.
    const ctOnly = listing({ state: "CT" });
    expect(classifyListing(ctOnly, ROOFTOP)).not.toBe("match");
  });

  it("still uses state to disprove ownership", () => {
    expect(classifyListing(listing({ state: "MA" }), ROOFTOP)).toBe("mismatch");
  });

  it("falls back to domain when the listing carries no address", () => {
    expect(classifyListing(listing({ hosts: ["harteinfiniti.com"] }), ROOFTOP)).toBe("match");
    expect(classifyListing(listing({ hosts: ["hartehonda.com"] }), ROOFTOP)).toBe("mismatch");
  });

  it("returns unknown when nothing decides", () => {
    expect(classifyListing(listing({}), ROOFTOP)).toBe("unknown");
  });
});

describe("shouldIngest", () => {
  it("ingests only positively matched cars once the address is known", () => {
    expect(isStrictRooftop(ROOFTOP)).toBe(true);
    expect(shouldIngest(listing({ street: ROOFTOP.street, zip: "06120" }), ROOFTOP)).toBe(true);
    expect(shouldIngest(listing({ state: "CT" }), ROOFTOP)).toBe(false);      // unproven
    expect(shouldIngest(listing({}), ROOFTOP)).toBe(false);                   // unproven
  });

  it("stays permissive for a tenant that has not configured an address yet", () => {
    const loose: Rooftop = { domain: "example.com", state: "CT", street: "", zip: "" };
    expect(isStrictRooftop(loose)).toBe(false);
    expect(shouldIngest(listing({ state: "CT" }), loose)).toBe(true);
    expect(shouldIngest(listing({ hosts: ["other.com"] }), loose)).toBe(false);
  });

  it("keeps a car whose address matches even if its host looks foreign", () => {
    // Third-party syndication can rewrite the host; the lot address cannot.
    const ours = listing({ hosts: ["cars.com"], street: ROOFTOP.street, zip: "06120" });
    expect(shouldIngest(ours, ROOFTOP)).toBe(true);
  });
});

describe("prunePreflight", () => {
  const base = { feedWalked: true, matched: 100, liveVins: 100, lastGoodCount: 100, writeError: false };

  it("allows the prune on a clean, complete run", () => {
    expect(prunePreflight(base)).toBeNull();
  });

  it("never prunes on a partial feed", () => {
    // The live VIN set is incomplete, so everything unseen looks sold.
    expect(prunePreflight({ ...base, feedWalked: false })).toBe("partial_feed");
  });

  it("never prunes after a write error", () => {
    expect(prunePreflight({ ...base, writeError: true })).toBe("write_error");
  });

  it("never prunes when the run matched nothing", () => {
    expect(prunePreflight({ ...base, liveVins: 0, matched: 0 })).toBe("no_live_vins");
  });

  it("blocks a mass delete when inventory suddenly collapses", () => {
    // A feed that returns 12 of 200 cars must not delete the other 188.
    expect(prunePreflight({ ...base, matched: 12, liveVins: 12, lastGoodCount: 200 }))
      .toBe("inventory_collapsed:12_vs_200");
  });

  it("still allows normal day-to-day inventory movement", () => {
    // Selling a quarter of the lot is real; it must not trip the breaker.
    expect(prunePreflight({ ...base, matched: 150, liveVins: 150, lastGoodCount: 200 })).toBeNull();
  });

  it("allows growth without complaint", () => {
    expect(prunePreflight({ ...base, matched: 260, liveVins: 260, lastGoodCount: 200 })).toBeNull();
  });

  it("does not gate the very first run, which has no baseline", () => {
    expect(prunePreflight({ ...base, matched: 5, liveVins: 5, lastGoodCount: 0 })).toBeNull();
  });
});

// MarketCheck's own physical-store key. Their docs name mc_rooftop_id as the
// primary boundary for a single store; a group id or website id spans siblings.
describe("mc_rooftop_id invariant", () => {
  const pinned: Rooftop = { ...ROOFTOP, rooftopId: "RT-100" };

  it("accepts a row carrying the pinned rooftop id", () => {
    expect(classifyListing(listing({ rooftopId: "RT-100" }), pinned)).toBe("match");
  });

  it("rejects a sibling rooftop even when every other signal looks like ours", () => {
    const sibling = listing({
      rooftopId: "RT-200",
      hosts: ["harteinfiniti.com"],
      street: ROOFTOP.street,
      zip: "06120",
      state: "CT",
    });
    // Same domain, same address, same state — MarketCheck still says it is a
    // different physical rooftop, and that wins.
    expect(classifyListing(sibling, pinned)).toBe("mismatch");
    expect(shouldIngest(sibling, pinned)).toBe(false);
  });

  it("falls back to the address when the row carries no rooftop id", () => {
    expect(classifyListing(listing({ street: ROOFTOP.street, zip: "06120" }), pinned)).toBe("match");
  });

  it("rejects a disallowed location id", () => {
    const rt: Rooftop = { ...ROOFTOP, locationIds: ["LOC-1"] };
    expect(classifyListing(listing({ locationId: "LOC-9" }), rt)).toBe("mismatch");
  });

  it("treats a known rooftop id as strict on its own", () => {
    const idOnly: Rooftop = { domain: "", state: "", street: "", zip: "", rooftopId: "RT-100" };
    expect(isStrictRooftop(idOnly)).toBe(true);
    expect(shouldIngest(listing({}), idOnly)).toBe(false);          // unproven
    expect(shouldIngest(listing({ rooftopId: "RT-100" }), idOnly)).toBe(true);
  });
});

// ── Per-segment retirement ────────────────────────────────────────────
// The 2026-08-01 incident, as an executable assertion. The feed stopped
// returning new units, the walk completed, every used car came back, and the
// prune read the absence as 39 sales.

import {
  segmentOf, segmentPrunePreflight, SEGMENT_COLLAPSE_FLOOR,
  probeCoverageSatisfied, sufficientCoverage,
  type SegmentGateInput,
} from "../../../supabase/functions/_shared/rooftopMatch";

const seg = (over: Partial<SegmentGateInput> = {}): SegmentGateInput => ({
  segment: "new", feedWalked: true, writeError: false,
  feedReported: 39, accepted: 39, priorInventory: 39, ...over,
});

describe("a certification flip is not a segment change", () => {
  it("keeps cpo with used, because CPO is a grade of used", () => {
    expect(segmentOf("cpo")).toBe("rest");
    expect(segmentOf("used")).toBe("rest");
    expect(segmentOf("new")).toBe("new");
  });

  it("puts an unknown or missing condition where the old prune put it", () => {
    for (const v of [null, undefined, "", "certified", "demo"]) expect(segmentOf(v)).toBe("rest");
  });

  it("reads the segment case-insensitively", () => {
    for (const v of ["New", "NEW", " new "]) expect(segmentOf(v)).toBe("new");
  });
});

describe("a segment the run did not observe is never retired", () => {
  it("retires nothing when the provider stopped listing a segment the dealer still stocks", () => {
    // The incident. Everything else about the run was healthy.
    expect(segmentPrunePreflight(seg({ feedReported: 0, accepted: 0, priorInventory: 39 })))
      .toBe("segment_vanished:new:0_vs_39");
  });

  it("still retires the segment that WAS observed on the same run", () => {
    // The used walk succeeding must not be held hostage by the new segment.
    expect(segmentPrunePreflight(seg({ segment: "rest", feedReported: 55, accepted: 55, priorInventory: 55 })))
      .toBeNull();
  });

  it("separates the provider having none from us rejecting all of them", () => {
    // Same visible outcome, opposite cause: one is a provider gap, the other is
    // our own address gate. They must not print as the same thing.
    expect(segmentPrunePreflight(seg({ feedReported: 39, accepted: 0, priorInventory: 39 })))
      .toBe("segment_all_rejected:new:0_of_39");
  });

  it("fails closed when the provider could not be asked", () => {
    expect(segmentPrunePreflight(seg({ feedReported: null, accepted: 0, priorInventory: 39 })))
      .toBe("segment_unverified:new");
  });

  it("allows a genuine sell-down to complete", () => {
    // Nothing on the ground and nothing in the feed is a finished segment, not
    // an outage — otherwise the last car of a segment could never be retired.
    expect(segmentPrunePreflight(seg({ feedReported: 0, accepted: 0, priorInventory: 0 }))).toBeNull();
  });

  it("allows normal movement inside a segment", () => {
    expect(segmentPrunePreflight(seg({ feedReported: 30, accepted: 30, priorInventory: 39 }))).toBeNull();
  });

  it("keeps the run-level gates binding on every segment", () => {
    expect(segmentPrunePreflight(seg({ feedWalked: false }))).toBe("partial_feed");
    expect(segmentPrunePreflight(seg({ writeError: true }))).toBe("write_error");
  });
});

// ── A tiny non-zero result is the same outage ─────────────────────────
// Every clause above tests for zero. On 2026-09-08 a probe returned ONE new
// car against 71 in stock, `accepted` was 1, all three clauses passed, and
// only the coarse run-level breaker stopped 70 live cars being archived.
describe("a segment that came back a fraction of itself is never retired", () => {
  it("blocks 1 accepted of 71 — the case that got through", () => {
    expect(segmentPrunePreflight(seg({ feedReported: 0, accepted: 1, priorInventory: 71 })))
      .toBe("segment_collapsed:new:1_vs_71");
  });

  it("blocks 0 accepted of 71 by the more specific reason", () => {
    expect(segmentPrunePreflight(seg({ feedReported: 0, accepted: 0, priorInventory: 71 })))
      .toBe("segment_vanished:new:0_vs_71");
  });

  it("blocks 5 accepted of 71", () => {
    expect(segmentPrunePreflight(seg({ feedReported: 5, accepted: 5, priorInventory: 71 })))
      .toBe("segment_collapsed:new:5_vs_71");
  });

  it("allows a healthy 70 of 71", () => {
    expect(segmentPrunePreflight(seg({ feedReported: 70, accepted: 70, priorInventory: 71 })))
      .toBeNull();
  });

  it("allows ordinary daily churn — the largest attrition this feed has shown", () => {
    // 19 nightly runs at the reference rooftop: worst observed was 15 of ~130
    // run-level and 9 new units of ~80 segment-level. Both must pass, or the
    // gate stops legitimate archiving.
    expect(segmentPrunePreflight(seg({ feedReported: 71, accepted: 71, priorInventory: 80 }))).toBeNull();
    expect(segmentPrunePreflight(seg({ segment: "rest", feedReported: 115, accepted: 115, priorInventory: 130 }))).toBeNull();
  });

  it("protects a small segment inside a large lot — the store the run-level breaker cannot save", () => {
    // 20 new units in a 120-car lot. Losing all 20 leaves 100 >= floor(120*0.6),
    // so the RUN-level gate waves it through. The segment gate must not.
    expect(segmentPrunePreflight(seg({ feedReported: 0, accepted: 1, priorInventory: 20 })))
      .toBe("segment_collapsed:new:1_vs_20");
    expect(segmentPrunePreflight(seg({ feedReported: 20, accepted: 20, priorInventory: 20 })))
      .toBeNull();
  });

  it("applies to the used segment too, not just new", () => {
    expect(segmentPrunePreflight(seg({ segment: "rest", feedReported: 3, accepted: 3, priorInventory: 60 })))
      .toBe("segment_collapsed:rest:3_vs_60");
  });

  it("does not fire for a dealer who stocks none of that segment", () => {
    // priorInventory 0 means there is nothing to protect; a new tenant or a
    // used-only store must not be permanently blocked.
    expect(segmentPrunePreflight(seg({ feedReported: 0, accepted: 0, priorInventory: 0 }))).toBeNull();
  });

  it("still refuses a partial feed or a write error before it looks at counts", () => {
    expect(segmentPrunePreflight(seg({ feedWalked: false, accepted: 71, priorInventory: 71 })))
      .toBe("partial_feed");
    expect(segmentPrunePreflight(seg({ writeError: true, accepted: 71, priorInventory: 71 })))
      .toBe("write_error");
  });

  it("uses the run-level collapse threshold, not a second invented one", () => {
    expect(SEGMENT_COLLAPSE_FLOOR).toBe(0.6);
    // The boundary is exactly floor(prior * 0.6): 60 of 100 passes, 59 blocks.
    expect(segmentPrunePreflight(seg({ feedReported: 60, accepted: 60, priorInventory: 100 }))).toBeNull();
    expect(segmentPrunePreflight(seg({ feedReported: 59, accepted: 59, priorInventory: 100 })))
      .toBe("segment_collapsed:new:59_vs_100");
  });
});

// ── Backstop probe coverage ───────────────────────────────────────────
// The other half of the 2026-09-08 near-miss: the probe loop stopped at the
// first probe that ingested anything, so a transient 1-car answer pre-empted
// the 70-car answer four probes later.
describe("probing continues until the segment is plausibly covered", () => {
  const cov = (ingestedTotal: number, priorInventory: number, capped = false) =>
    probeCoverageSatisfied({ ingestedTotal, priorInventory, capped });

  it("does NOT stop after a transient one-car probe", () => {
    // The exact 2026-09-08 shape: 1 ingested against 71 in stock.
    expect(cov(1, 71)).toBe(false);
  });

  it("stops once a probe covers the segment", () => {
    expect(cov(70, 71)).toBe(true);
  });

  it("keeps probing so a later probe can succeed after an early one returned 1", () => {
    // Probe 1 yields 1, probes 2-4 yield nothing, probe 5 yields 69.
    // Union crosses the floor only at the end -- which is why the loop must
    // not have exited at probe 1.
    expect(cov(1, 71)).toBe(false);
    expect(cov(1, 71)).toBe(false);
    expect(cov(70, 71)).toBe(true);
  });

  it("stops immediately when capped, because that is a ceiling not an outage", () => {
    expect(cov(1, 71, true)).toBe(true);
    expect(cov(0, 71, true)).toBe(true);
  });

  it("accepts any success when there is no prior inventory to measure against", () => {
    // A new tenant, or a store that stocks none of this segment. Requiring 60%
    // of zero would loop through every probe on every run forever.
    expect(sufficientCoverage(0)).toBe(1);
    expect(cov(1, 0)).toBe(true);
    expect(cov(0, 0)).toBe(false);
  });

  it("never demands more than the segment gate would accept", () => {
    // If coverage were stricter than the gate, the loop would burn all five
    // probes on a run the gate would have passed anyway.
    for (const prior of [1, 5, 20, 71, 130]) {
      const need = sufficientCoverage(prior);
      expect(segmentPrunePreflight(seg({
        feedReported: need, accepted: need, priorInventory: prior,
      }))).toBeNull();
    }
  });

  it("uses the same floor as the segment gate", () => {
    expect(sufficientCoverage(100)).toBe(Math.floor(100 * SEGMENT_COLLAPSE_FLOOR));
  });
});

// ── The two gates together ────────────────────────────────────────────
describe("run-level and segment-level gates in combination", () => {
  it("blocks a catastrophically incomplete segment even when the run looks fine", () => {
    // The store the run-level breaker cannot save: 20 new units in a 120-car
    // lot. Lose all but one new car and the run still reports 101 of 120.
    expect(prunePreflight({
      feedWalked: true, writeError: false, matched: 101, liveVins: 101, lastGoodCount: 120,
    })).toBeNull();
    // ...and the segment gate is the only thing standing in the way.
    expect(segmentPrunePreflight(seg({ feedReported: 0, accepted: 1, priorInventory: 20 })))
      .toBe("segment_collapsed:new:1_vs_20");
  });

  it("a partial feed stops both gates, however healthy the counts look", () => {
    // Pagination failure and a transient upstream error both surface as an
    // unwalked feed; neither may retire anything.
    expect(prunePreflight({
      feedWalked: false, writeError: false, matched: 129, liveVins: 129, lastGoodCount: 129,
    })).toBe("partial_feed");
    expect(segmentPrunePreflight(seg({ feedWalked: false, accepted: 71, priorInventory: 71 })))
      .toBe("partial_feed");
  });

  it("both gates pass on a genuinely healthy run", () => {
    expect(prunePreflight({
      feedWalked: true, writeError: false, matched: 129, liveVins: 129, lastGoodCount: 130,
    })).toBeNull();
    expect(segmentPrunePreflight(seg({ feedReported: 71, accepted: 71, priorInventory: 71 }))).toBeNull();
    expect(segmentPrunePreflight(seg({ segment: "rest", feedReported: 58, accepted: 58, priorInventory: 60 }))).toBeNull();
  });
});
