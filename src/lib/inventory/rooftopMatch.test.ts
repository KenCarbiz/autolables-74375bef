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
