import { describe, it, expect } from "vitest";
import { classifyPinnedFeed, type PinnedFeedSample } from "../../../supabase/functions/_shared/pinnedFeedOutcome";

const PIN = { param: "mc_rooftop_id", value: "000000" };
const ROOFTOP = { street: "1 example st", zip: "00000" };

const sample = (over: Partial<PinnedFeedSample>): PinnedFeedSample => ({
  refused: false, http: 200, got: 0, match: 0, purity: 0, minPurity: 0.95, ...over,
});

describe("a provider refusal is never a rooftop mismatch", () => {
  it("classifies a 429 as provider_refused and keeps the pin", () => {
    const o = classifyPinnedFeed(sample({ refused: true, http: 429 }), PIN, ROOFTOP);
    expect(o.kind).toBe("provider_refused");
    expect(o.error).toBe("provider_refused_429");
    expect(o.runStatus).toBe("failed");
    expect(o.note).toMatch(/HTTP 429/);
    expect(o.note).toMatch(/do not clear the pin/i);
    expect(o.note).not.toMatch(/no longer matches/);
  });

  it.each([401, 403, 500, 502, 503])("classifies HTTP %i the same way", (http) => {
    const o = classifyPinnedFeed(sample({ refused: true, http }), PIN, ROOFTOP);
    expect(o.kind).toBe("provider_refused");
    expect(o.error).toBe(`provider_refused_${http}`);
  });

  it("classifies a timeout as a refusal with no status", () => {
    const o = classifyPinnedFeed(sample({ refused: true, http: 0 }), PIN, ROOFTOP);
    expect(o.kind).toBe("provider_refused");
    expect(o.error).toBe("provider_refused_timeout");
    expect(o.note).toMatch(/did not answer/);
  });

  it("writes a failed run row for a refusal, never a skipped one", () => {
    const o = classifyPinnedFeed(sample({ refused: true, http: 429 }), PIN, ROOFTOP);
    expect(o.runStatus).toBe("failed");
  });
});

describe("the two honest validation failures", () => {
  it("reports an empty 2xx answer as empty_answer, still a pin question", () => {
    const o = classifyPinnedFeed(sample({ got: 0 }), PIN, ROOFTOP);
    expect(o.kind).toBe("empty_answer");
    expect(o.error).toBe("pinned_scope_failed_validation");
    expect(o.note).toMatch(/answered with no cars/);
    expect(o.note).toMatch(/Clear the pin/);
  });

  it("reports rows that do not match the rooftop as scope_mismatch with the counts", () => {
    const o = classifyPinnedFeed(sample({ got: 50, match: 10, purity: 0.2 }), PIN, ROOFTOP);
    expect(o.kind).toBe("scope_mismatch");
    expect(o.error).toBe("pinned_scope_failed_validation");
    expect(o.note).toMatch(/10 of 50 rows matched/);
    expect(o.note).toMatch(/1 example st 00000/);
  });

  it("treats zero decidable rows with cars present as a mismatch, not a refusal", () => {
    const o = classifyPinnedFeed(sample({ got: 12, match: 0, purity: 0 }), PIN, ROOFTOP);
    expect(o.kind).toBe("scope_mismatch");
  });
});

describe("validation", () => {
  it("validates when rows matched at or above the demanded purity", () => {
    const o = classifyPinnedFeed(sample({ got: 50, match: 50, purity: 1 }), PIN, ROOFTOP);
    expect(o.kind).toBe("validated");
    expect(o.error).toBeNull();
    expect(o.runStatus).toBe("success");
  });

  it("does not validate below the demanded purity even with matches", () => {
    const o = classifyPinnedFeed(sample({ got: 50, match: 46, purity: 0.92, minPurity: 0.95 }), PIN, ROOFTOP);
    expect(o.kind).toBe("scope_mismatch");
  });

  it("a refusal flag wins over any row counts, because refused rows are not an answer", () => {
    const o = classifyPinnedFeed(sample({ refused: true, http: 429, got: 50, match: 50, purity: 1 }), PIN, ROOFTOP);
    expect(o.kind).toBe("provider_refused");
  });
});
