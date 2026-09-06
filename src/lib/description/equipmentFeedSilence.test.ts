import { describe, it, expect } from "vitest";
import { buildFactSnapshot } from "../../../supabase/functions/_shared/description-core.ts";

// A marketing feed enumerates what a dealer chose to advertise. A factory
// build sheet enumerates what the manufacturer actually installed. Treating
// the feed's silence as a denial turned every well-equipped car into a
// "source conflict": 592 of them standing in production, 98 on Adaptive
// Cruise Control alone, and three separate conflicts for one panoramic roof
// because the decode names it three ways. Not one was the reverse shape.

const LISTING = {
  vin: "JN8AZ3CC5T9624253",
  ymm: "2027 INFINITI QX80",
  condition: "used",
  mileage: 12408,
  mc_attributes: {
    year: 2027, make: "INFINITI", model: "QX80",
    options: ["Panoramic roof", "Head-Up Display", "Adaptive Cruise Control"],
  },
  features: ["Bluetooth", "Backup Camera"],
};

const snapOf = (listing: Record<string, unknown>) => buildFactSnapshot(listing, {}, null);
const equipment = (s: ReturnType<typeof buildFactSnapshot>) =>
  String((s.facts as Record<string, { value?: unknown } | undefined>).equipment?.value ?? "");
const excludedFields = (s: ReturnType<typeof buildFactSnapshot>) =>
  (s.excluded_claims || []).map((e: { field?: string }) => e.field);

describe("a feed that omits an option is silent, not contradicting", () => {
  const snap = snapOf(LISTING);

  it("raises no conflict for factory equipment the feed did not list", () => {
    expect(snap.conflicts.filter((c: { field: string }) =>
      c.field.startsWith("equipment:"))).toHaveLength(0);
  });

  it("states the decoded equipment instead of withholding it", () => {
    for (const item of ["Panoramic roof", "Head-Up Display", "Adaptive Cruise Control"]) {
      expect(equipment(snap)).toContain(item);
      expect(excludedFields(snap)).not.toContain(`equipment:${item}`);
    }
  });

  it("marks a decode-backed equipment list verified", () => {
    // Previously only feed/decode OVERLAP counted as verified, so a car with a
    // complete factory build sheet and a thin feed read as "feed_provided".
    expect((snap.facts as Record<string, { status?: string } | undefined>)
      .equipment?.status).toBe("verified");
  });

  it("keeps the feed's own features too", () => {
    expect(equipment(snap)).toContain("Bluetooth");
  });
});

describe("an option only the feed claims is still not auto-published", () => {
  // The Bose case, which is the real risk this guard existed for: a premium
  // claim with no factory record behind it.
  const snap = snapOf({
    ...LISTING,
    mc_attributes: { ...LISTING.mc_attributes, options: ["Panoramic roof"] },
    features: ["Bluetooth", "Bose Premium Audio"],
  });

  it("withholds it from copy", () => {
    expect(excludedFields(snap)).toContain("equipment:Bose Premium Audio");
    expect(equipment(snap)).not.toContain("Bose");
  });

  it("does so without blocking the description on a manager's decision", () => {
    // Withheld, but not a conflict — nobody has to adjudicate a car being
    // described without a stereo the factory never recorded.
    expect(snap.conflicts.filter((c: { field: string }) =>
      c.field.startsWith("equipment:"))).toHaveLength(0);
    const reason = (snap.excluded_claims || [])
      .find((e: { field?: string }) => e.field === "equipment:Bose Premium Audio");
    expect((reason as { reason?: string } | undefined)?.reason).toBe("unverified_feed_claim");
  });

  it("leaves an ordinary unverified feature alone", () => {
    // Only premium/named equipment is worth withholding; "Bluetooth" is not a
    // claim anyone is misled by.
    expect(excludedFields(snap)).not.toContain("equipment:Bluetooth");
  });
});

describe("a manager's decision still wins either way", () => {
  const overrides = (decision: string, field: string) =>
    [{ field_key: field, decision }] as never;

  it("include publishes a feed-only premium claim", () => {
    const snap = buildFactSnapshot(
      { ...LISTING, features: ["Bose Premium Audio"] }, {}, null,
      overrides("include", "equipment:Bose Premium Audio"));
    expect(equipment(snap)).toContain("Bose Premium Audio");
  });

  it("exclude withholds a decoded option the manager does not want stated", () => {
    const snap = buildFactSnapshot(
      LISTING, {}, null, overrides("exclude", "equipment:Panoramic roof"));
    expect(equipment(snap)).not.toContain("Panoramic roof");
    expect(excludedFields(snap)).toContain("equipment:Panoramic roof");
  });
});
