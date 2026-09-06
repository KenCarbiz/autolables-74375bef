import { describe, it, expect } from "vitest";
import {
  refreshDecision, inventoryAge, REFRESH_MILESTONES,
} from "../../../supabase/functions/_shared/description-refresh.ts";

// Owner rule: write once on ingest, refresh at 60 days in inventory and again
// at 200. Nothing in between — a description that is still accurate does not
// need rewriting because a week passed, and every rewrite spends credits
// across the whole lot.

const NOW = new Date("2026-09-06T12:00:00Z");
const base = { hasDescription: true, now: NOW };

describe("inventory age comes from the vehicle, not from our database", () => {
  it("prefers the provider's days on market", () => {
    // Our oldest row is 79 days old; the oldest vehicle has been listed 883
    // days. Anchoring to our ingest date would call that car brand new.
    expect(inventoryAge({ ...base, dom: 883, ingestedAt: "2026-06-19" }))
      .toEqual({ days: 883, source: "provider_dom" });
  });

  it("falls back to ingest date when the provider has no figure", () => {
    const r = inventoryAge({ ...base, dom: null, ingestedAt: "2026-08-07T12:00:00Z" });
    expect(r.source).toBe("ingest_date");
    expect(r.days).toBe(30);
  });

  it("reports unknown rather than guessing zero", () => {
    // Zero would mean "brand new", which would suppress a refresh forever.
    expect(inventoryAge({ ...base, dom: null, ingestedAt: null }).source).toBe("unknown");
  });

  it("ignores a nonsense provider value", () => {
    expect(inventoryAge({ ...base, dom: -5, ingestedAt: "2026-08-07T12:00:00Z" }).source)
      .toBe("ingest_date");
  });
});

describe("the two milestones, and nothing between them", () => {
  it("writes a description for a vehicle that has none, at any age", () => {
    const d = refreshDecision({ ...base, hasDescription: false, dom: 3 });
    expect(d.due).toBe(true);
    expect(d.reason).toBe("initial");
  });

  it("leaves a fresh vehicle alone", () => {
    expect(refreshDecision({ ...base, dom: 12 }).due).toBe(false);
  });

  it("refreshes at sixty days", () => {
    const d = refreshDecision({ ...base, dom: 60 });
    expect(d.due).toBe(true);
    expect(d.milestone).toBe(60);
  });

  it("does not refresh again on day 61", () => {
    expect(refreshDecision({ ...base, dom: 61, lastMilestone: 60 }).due).toBe(false);
  });

  it("does not refresh anywhere between the milestones", () => {
    for (const dom of [61, 90, 120, 150, 199]) {
      expect(refreshDecision({ ...base, dom, lastMilestone: 60 }).due, `day ${dom}`).toBe(false);
    }
  });

  it("refreshes again at two hundred days", () => {
    const d = refreshDecision({ ...base, dom: 200, lastMilestone: 60 });
    expect(d.due).toBe(true);
    expect(d.milestone).toBe(200);
  });

  it("stops after the last milestone", () => {
    expect(refreshDecision({ ...base, dom: 900, lastMilestone: 200 }).due).toBe(false);
  });

  it("skips straight to the highest milestone reached", () => {
    // A car onboarded at 300 days should not generate twice to catch up.
    const d = refreshDecision({ ...base, dom: 300, lastMilestone: 0 });
    expect(d.milestone).toBe(200);
  });

  it("carries the milestones the owner set", () => {
    expect([...REFRESH_MILESTONES]).toEqual([60, 200]);
  });
});

describe("a human's copy is not overwritten by a calendar", () => {
  it("never refreshes a locked description on schedule", () => {
    const d = refreshDecision({ ...base, dom: 900, locked: true });
    expect(d.due).toBe(false);
    expect(d.reason).toBe("locked");
  });

  it("still writes a first description even if the case is locked", () => {
    // Nothing to protect when nothing exists.
    expect(refreshDecision({ ...base, hasDescription: false, locked: true, dom: 900 }).due)
      .toBe(true);
  });
});

describe("an unknown age does not trigger work", () => {
  it("holds rather than refreshing on a guess", () => {
    const d = refreshDecision({ ...base, dom: null, ingestedAt: null });
    expect(d.due).toBe(false);
    expect(d.reason).toBe("unknown_age");
  });
});
