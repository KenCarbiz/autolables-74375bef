import { describe, it, expect } from "vitest";
import {
  classifyListing, shouldIngest, isStrictRooftop, normStreet, normZip, normHost,
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
