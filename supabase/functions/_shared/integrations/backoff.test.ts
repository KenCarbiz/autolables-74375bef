import { describe, it, expect } from "vitest";
import { BACKOFF_SCHEDULE_SECONDS, jitteredDelaySeconds, nextRetry } from "./backoff.ts";

describe("backoff (OPS-02)", () => {
  it("follows 1m, 5m, 30m, 2h, 6h, 24h with no jitter at the midpoint", () => {
    expect(BACKOFF_SCHEDULE_SECONDS).toEqual([60, 300, 1800, 7200, 21600, 86400]);
    [60, 300, 1800, 7200, 21600].forEach((s, i) => expect(jitteredDelaySeconds(i + 1, () => 0.5)).toBe(s));
  });

  it("keeps jitter within plus or minus 20 percent", () => {
    expect(jitteredDelaySeconds(1, () => 0)).toBe(48);
    expect(jitteredDelaySeconds(1, () => 1)).toBe(72);
  });

  it("goes dead after the sixth failed attempt", () => {
    expect(nextRetry(5, 503, () => 0.5)).toMatchObject({ dead: false, delaySeconds: 21600 });
    expect(nextRetry(6, 503)).toMatchObject({ dead: true, reason: "attempts_exhausted" });
  });

  it("treats 4xx other than 408 and 429 as dead immediately", () => {
    expect(nextRetry(1, 400).dead).toBe(true);
    expect(nextRetry(1, 403).dead).toBe(true);
    expect(nextRetry(1, 408).dead).toBe(false);
    expect(nextRetry(1, 429).dead).toBe(false);
    expect(nextRetry(1, 500).dead).toBe(false);
    expect(nextRetry(1, null).dead).toBe(false);
  });
});
