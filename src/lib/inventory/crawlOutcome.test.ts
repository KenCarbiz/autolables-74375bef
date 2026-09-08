import { describe, it, expect } from "vitest";
import {
  classifyCrawlOutcome, CRAWL_OUTCOMES, type CrawlOutcomeInput,
} from "../../../supabase/functions/_shared/crawlOutcome";

// The two bodies below are verbatim from `advertised_price_crawl_attempts` on
// 2026-09-08. They are the whole reason this module exists: both contain the
// phrase "upgrade your plan", and the previous classifier tested for that
// phrase before it tested the HTTP status. The 429 branch was therefore
// unreachable, and for eighteen days every rate limit was reported to the
// operator as an exhausted account -- which would have been "fixed" by buying
// credits that were not the problem.

const BODY_402 =
  '{"success":false,"error":"Insufficient credits to perform this request. For more credits, '
  + 'you can upgrade your plan at https://firecrawl.dev/pricing or try changing the request '
  + 'limit to a lower value."}';

const BODY_429 =
  '{"success":false,"error":"Rate limit exceeded. Consumed (req/min): 11, Remaining (req/min): 0. '
  + 'Upgrade your plan at https://firecrawl.dev/pricing for increased rate limits or please '
  + 'retry after 54s, resets at ..."}';

const input = (over: Partial<CrawlOutcomeInput> = {}): CrawlOutcomeInput => ({
  captured: false,
  reason: null,
  cheapStatus: 403,
  renderAttempted: true,
  renderStatus: null,
  renderError: null,
  renderConfigured: true,
  ...over,
});

describe("the real Firecrawl bodies", () => {
  it("classifies the 429 as a rate limit, not as exhausted credits", () => {
    // The regression. Both bodies say "upgrade your plan"; only the status
    // separates them.
    expect(classifyCrawlOutcome(input({ renderStatus: 429, renderError: BODY_429 })).outcome)
      .toBe("render_rate_limited");
  });

  it("classifies the 402 as a cost refusal", () => {
    expect(classifyCrawlOutcome(input({ renderStatus: 402, renderError: BODY_402 })).outcome)
      .toBe("render_cost_refused");
  });

  it("does not let the shared phrase decide either one", () => {
    // "upgrade your plan" appears in both, so on its own it must classify
    // nothing at all. With no status and only that phrase, this is an
    // unreachable renderer -- not a guess between two paid outcomes.
    const ambiguous = "please upgrade your plan at https://firecrawl.dev/pricing";
    expect(classifyCrawlOutcome(input({ renderStatus: null, renderError: ambiguous })).outcome)
      .toBe("render_unreachable");
  });

  it("keeps the provider's raw body as the detail for diagnostics", () => {
    // The original message must survive classification. Losing it is what made
    // the first misdiagnosis unfalsifiable.
    expect(classifyCrawlOutcome(input({ renderStatus: 429, renderError: BODY_429 })).detail)
      .toBe(BODY_429);
    expect(classifyCrawlOutcome(input({ renderStatus: 402, renderError: BODY_402 })).detail)
      .toBe(BODY_402);
  });
});

describe("structured status outranks body text", () => {
  it("trusts a 429 status even when the body talks about credits", () => {
    // A provider that returns 429 with a credit-flavoured body is still rate
    // limiting us. The code is the contract.
    expect(classifyCrawlOutcome(input({
      renderStatus: 429, renderError: "Insufficient credits. Upgrade your plan.",
    })).outcome).toBe("render_rate_limited");
  });

  it("trusts a 402 status even when the body talks about rate limits", () => {
    expect(classifyCrawlOutcome(input({
      renderStatus: 402, renderError: "Rate limit exceeded. Retry after 54s.",
    })).outcome).toBe("render_cost_refused");
  });

  it("reads the body only when there is no status to read", () => {
    expect(classifyCrawlOutcome(input({
      renderStatus: null, renderError: "Rate limit exceeded, retry after 30s",
    })).outcome).toBe("render_rate_limited");
    expect(classifyCrawlOutcome(input({
      renderStatus: null, renderError: "Insufficient credits for this request",
    })).outcome).toBe("render_cost_refused");
  });
});

describe("the other outcomes still resolve", () => {
  it("reports success", () => {
    expect(classifyCrawlOutcome(input({ captured: true })).outcome).toBe("captured");
    expect(classifyCrawlOutcome(input({ captured: true })).detail).toBeNull();
  });

  it("separates an auth failure from a cost failure", () => {
    for (const st of [401, 403]) {
      expect(classifyCrawlOutcome(input({ renderStatus: st })).outcome).toBe("render_auth_failed");
    }
  });

  it("reports an unconfigured renderer before blaming anything else", () => {
    expect(classifyCrawlOutcome(input({ renderConfigured: false, renderAttempted: false })).outcome)
      .toBe("render_unconfigured");
  });

  it("blames the dealer's site only after the renderer is cleared", () => {
    // A bot challenge means: we reached the page, the renderer was available
    // and genuinely tried, and the page still refused us.
    // renderStatus 200: the renderer answered. With no status at all this is
    // an unreachable renderer instead, which the next test pins.
    expect(classifyCrawlOutcome(input({
      reason: "bot_challenge", renderAttempted: true, renderStatus: 200,
    })).outcome).toBe("bot_challenge");
  });

  it("distinguishes a refusal we never rendered from a wall we did", () => {
    expect(classifyCrawlOutcome(input({
      reason: "bot_challenge", renderAttempted: false, renderStatus: null,
    })).outcome).toBe("blocked_no_render_budget");
  });

  it("calls a renderer that answered nothing unreachable, not a bot wall", () => {
    expect(classifyCrawlOutcome(input({
      reason: "bot_challenge", renderAttempted: true, renderStatus: null,
    })).outcome).toBe("render_unreachable");
  });

  it("passes an unrecognised reason through rather than inventing one", () => {
    expect(classifyCrawlOutcome(input({
      reason: "vin_mismatch", renderAttempted: false,
    })).outcome).toBe("vin_mismatch");
  });
});

describe("every outcome is declared", () => {
  it("returns only outcomes in CRAWL_OUTCOMES, or a pass-through reason", () => {
    const produced = [
      classifyCrawlOutcome(input({ captured: true })),
      classifyCrawlOutcome(input({ renderStatus: 429 })),
      classifyCrawlOutcome(input({ renderStatus: 402 })),
      classifyCrawlOutcome(input({ renderStatus: 401 })),
      classifyCrawlOutcome(input({ renderConfigured: false, renderAttempted: false })),
      classifyCrawlOutcome(input({ renderAttempted: true, renderStatus: null })),
      classifyCrawlOutcome(input({ reason: "bot_challenge", renderAttempted: true, renderStatus: 200 })),
      classifyCrawlOutcome(input({ reason: "bot_challenge", renderAttempted: false })),
    ].map((r) => r.outcome);
    for (const o of produced) expect(CRAWL_OUTCOMES).toContain(o);
  });

  it("no longer emits the misleading name", () => {
    // "credits exhausted" named one of the 402's two causes and sent this
    // investigation down the wrong path twice.
    expect(CRAWL_OUTCOMES).not.toContain("render_credits_exhausted");
  });
});
