import { describe, it, expect } from "vitest";
import {
  applyJitter,
  backoffMs,
  BACKOFF_CAP_MS,
  createRenderPacer,
  DEFAULT_RENDERS_PER_MINUTE,
  delayBeforeNextRender,
  deriveRenderBudget,
  minIntervalMs,
  parseRetryAfter,
  resolveRendersPerMinute,
  RETRY_AFTER_MARGIN_MS,
  waitAfterRateLimit,
} from "../../../supabase/functions/_shared/renderPacer";

// Verbatim from the ledger on 2026-09-08, the night the crawler fired 25
// renders in nine seconds against an 11/min plan.
const BODY_429 =
  '{"success":false,"error":"Rate limit exceeded. Consumed (req/min): 11, Remaining (req/min): 0. '
  + 'Upgrade your plan at https://firecrawl.dev/pricing for increased rate limits or please '
  + 'retry after 54s, resets at ..."}';

describe("rate math at 10 renders per minute", () => {
  it("stays under the provider's 11 by default", () => {
    expect(DEFAULT_RENDERS_PER_MINUTE).toBe(10);
    expect(DEFAULT_RENDERS_PER_MINUTE).toBeLessThan(11);
  });

  it("spaces consecutive renders six seconds apart", () => {
    expect(minIntervalMs(10)).toBe(6000);
    expect(delayBeforeNextRender([], 100_000, 10)).toBe(0);
    expect(delayBeforeNextRender([100_000], 100_000, 10)).toBe(6000);
    expect(delayBeforeNextRender([100_000], 104_000, 10)).toBe(2000);
    expect(delayBeforeNextRender([100_000], 106_000, 10)).toBe(0);
  });

  it("never lets more than ten starts land inside any trailing minute", () => {
    // Ten renders, evenly spaced, starting at t=0. The eleventh may not start
    // until the first has aged out of the window, whatever the spacing says.
    const starts = Array.from({ length: 10 }, (_, i) => i * 6000);
    const now = 9 * 6000 + 100;
    const delay = delayBeforeNextRender(starts, now, 10);
    expect(now + delay).toBeGreaterThanOrEqual(starts[0] + 60_000);
  });

  it("holds the whole burst back, not just the spacing", () => {
    // The 2026-09-08 shape: ten requests in one second. The next one waits
    // for the window, close to a full minute.
    const burst = Array.from({ length: 10 }, (_, i) => i * 100);
    const delay = delayBeforeNextRender(burst, 1000, 10);
    expect(delay).toBeGreaterThanOrEqual(59_000);
  });

  it("forgets starts older than the window", () => {
    expect(delayBeforeNextRender([0], 61_000, 10)).toBe(0);
  });

  it("a simulated run never exceeds the rate in any sliding minute", () => {
    const pacer = createRenderPacer({ rpm: 10, random: () => 0 });
    const starts: number[] = [];
    let now = 0;
    for (let i = 0; i < 40; i++) {
      now += pacer.waitBeforeRender(now);
      pacer.noteRenderStarted(now);
      starts.push(now);
      now += 250;
    }
    for (const t of starts) {
      const inWindow = starts.filter((s) => s > t - 60_000 && s <= t).length;
      expect(inWindow).toBeLessThanOrEqual(10);
    }
  });
});

describe("jitter", () => {
  it("adds between zero and fifteen percent", () => {
    expect(applyJitter(6000, 0)).toBe(6000);
    expect(applyJitter(6000, 1)).toBe(6900);
    expect(applyJitter(6000, 0.5)).toBe(6450);
  });

  it("never shortens a delay and never exceeds the bound", () => {
    for (const r of [0, 0.1, 0.33, 0.7, 0.999]) {
      const j = applyJitter(6000, r);
      expect(j).toBeGreaterThanOrEqual(6000);
      expect(j).toBeLessThanOrEqual(6900);
    }
  });

  it("leaves a zero delay at zero", () => {
    expect(applyJitter(0, 0.9)).toBe(0);
  });

  it("clamps a random value outside [0,1)", () => {
    expect(applyJitter(1000, -1)).toBe(1000);
    expect(applyJitter(1000, 5)).toBe(1150);
  });
});

describe("Retry-After", () => {
  it("reads integer seconds from the header first", () => {
    expect(parseRetryAfter("30", BODY_429)).toBe(30_000);
  });

  it("reads an HTTP-date header relative to now", () => {
    const now = Date.parse("2026-09-09T00:00:00Z");
    expect(parseRetryAfter("Wed, 09 Sep 2026 00:00:20 GMT", null, now)).toBe(20_000);
  });

  it("falls back to the real 429 body text", () => {
    expect(parseRetryAfter(null, BODY_429)).toBe(54_000);
    expect(parseRetryAfter("", BODY_429)).toBe(54_000);
  });

  it("returns null when neither says anything", () => {
    expect(parseRetryAfter(null, "Rate limit exceeded")).toBeNull();
    expect(parseRetryAfter(undefined, undefined)).toBeNull();
  });

  it("honours the provider's wait with a margin", () => {
    expect(waitAfterRateLimit(54_000, 1)).toBe(54_000 + RETRY_AFTER_MARGIN_MS);
    expect(waitAfterRateLimit(54_000, 1)).toBeGreaterThan(54_000);
  });
});

describe("backoff", () => {
  it("doubles from a two second base", () => {
    expect(backoffMs(1)).toBe(2000);
    expect(backoffMs(2)).toBe(4000);
    expect(backoffMs(3)).toBe(8000);
    expect(backoffMs(4)).toBe(16_000);
  });

  it("caps at about a minute", () => {
    expect(backoffMs(6)).toBe(BACKOFF_CAP_MS);
    expect(backoffMs(20)).toBe(BACKOFF_CAP_MS);
    expect(BACKOFF_CAP_MS).toBe(60_000);
  });

  it("is zero with no failures", () => {
    expect(backoffMs(0)).toBe(0);
  });

  it("takes the larger of backoff and the provider's wait", () => {
    expect(waitAfterRateLimit(null, 3)).toBe(8000);
    expect(waitAfterRateLimit(2000, 3)).toBe(8000);
    expect(waitAfterRateLimit(54_000, 3)).toBe(55_000);
  });

  it("resets on success in the stateful pacer", () => {
    const pacer = createRenderPacer({ rpm: 10, random: () => 0 });
    expect(pacer.noteRateLimited(null)).toBe(2000);
    expect(pacer.noteRateLimited(null)).toBe(4000);
    expect(pacer.noteRateLimited(null)).toBe(8000);
    expect(pacer.snapshot().consecutiveRateLimits).toBe(3);
    pacer.noteSuccess();
    expect(pacer.snapshot().consecutiveRateLimits).toBe(0);
    expect(pacer.noteRateLimited(null)).toBe(2000);
  });
});

describe("render budget derivation", () => {
  it("fits 36 renders into a 220 second run at 10 per minute", () => {
    expect(deriveRenderBudget(220_000, 10)).toBe(36);
  });

  it("never plans more renders than the wall clock allows", () => {
    for (const budgetMs of [1000, 30_000, 60_000, 220_000, 600_000]) {
      for (const rpm of [1, 5, 10, 11, 30, 60]) {
        const n = deriveRenderBudget(budgetMs, rpm);
        expect(n * minIntervalMs(rpm)).toBeLessThanOrEqual(budgetMs);
      }
    }
  });

  it("is smaller than the old flat 30 would have allowed at low rates", () => {
    expect(deriveRenderBudget(220_000, 1)).toBe(3);
  });

  it("respects a reserve and never goes negative", () => {
    expect(deriveRenderBudget(220_000, 10, 20_000)).toBe(33);
    expect(deriveRenderBudget(10_000, 10, 20_000)).toBe(0);
  });
});

describe("FIRECRAWL_RPM env", () => {
  it("defaults to 10 when unset or unparseable", () => {
    expect(resolveRendersPerMinute(undefined)).toBe(10);
    expect(resolveRendersPerMinute(null)).toBe(10);
    expect(resolveRendersPerMinute("")).toBe(10);
    expect(resolveRendersPerMinute("fast")).toBe(10);
  });

  it("accepts a value in range", () => {
    expect(resolveRendersPerMinute("8")).toBe(8);
    expect(resolveRendersPerMinute(" 11 ")).toBe(11);
  });

  it("clamps to 1..60", () => {
    expect(resolveRendersPerMinute("0")).toBe(1);
    expect(resolveRendersPerMinute("-5")).toBe(1);
    expect(resolveRendersPerMinute("500")).toBe(60);
  });
});

describe("the stateful pacer", () => {
  it("records every start, refused or not, and sums the waits", () => {
    const pacer = createRenderPacer({ rpm: 10, random: () => 0 });
    expect(pacer.waitBeforeRender(0)).toBe(0);
    pacer.noteRenderStarted(0);
    expect(pacer.waitBeforeRender(1000)).toBe(5000);
    pacer.noteRenderStarted(6000);
    const s = pacer.snapshot();
    expect(s.renders).toBe(2);
    expect(s.totalWaitMs).toBe(5000);
    expect(s.rpm).toBe(10);
  });

  it("applies jitter from the injected source", () => {
    const pacer = createRenderPacer({ rpm: 10, random: () => 1 });
    pacer.noteRenderStarted(0);
    expect(pacer.waitBeforeRender(0)).toBe(6900);
  });
});
