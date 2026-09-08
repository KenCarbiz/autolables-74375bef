// Naming what actually stopped a crawl.
//
// The advertised-price crawl stopped producing on 2026-08-24 and every attempt
// for the next fifteen days was recorded as "bot_challenge" -- the dealer's
// site is blocking us. It was not. The first version of this classifier fixed
// that, and introduced a subtler version of the same mistake: it tested the
// response BODY for "upgrade your plan" before it tested the HTTP status, and
// Firecrawl puts that phrase in its rate-limit body as well as its credit
// body. So the 429 branch became unreachable, and for eighteen days the
// operator surface reported rate limits as an exhausted account.
//
// Both bodies, captured verbatim from the ledger on 2026-09-08:
//
//   402  "Insufficient credits to perform this request. For more credits, you
//         can upgrade your plan at https://firecrawl.dev/pricing or try
//         changing the request limit to a lower value."
//   429  "Rate limit exceeded. Consumed (req/min): 11, Remaining (req/min): 0.
//         Upgrade your plan at https://firecrawl.dev/pricing for increased
//         rate limits or please retry after 54s"
//
// The lesson is structural, not textual: a status code is a contract and a
// message body is prose. **Structured status always outranks body text**, and
// body text is consulted only when there is no status to read. A phrase that
// appears in more than one body discriminates nothing and must never classify
// on its own.
//
// The distinction matters because each outcome points at a different action,
// and two of them cost money:
//
//   render_rate_limited   slow down          (free)
//   render_cost_refused   cheapen or pay     (only sometimes money)
//   render_auth_failed    rotate the key
//   render_unconfigured   set the key
//   render_unreachable    check the provider
//   bot_challenge         call the website vendor
//
// "render_cost_refused" is deliberately not called "credits exhausted". A 402
// here means the provider refused this request at this cost; its own suggested
// remedy is "try changing the request limit to a lower value". An empty
// balance produces it, and so does a request too expensive for the plan while
// the balance is healthy. Naming it for one of its two causes is what sent
// this investigation down the wrong path twice.

export interface CrawlOutcomeInput {
  captured: boolean;
  reason: string | null;
  cheapStatus: number | null;
  renderAttempted: boolean;
  renderStatus: number | null;
  renderError: string | null;
  /** False when no renderer is configured at all. */
  renderConfigured: boolean;
}

export interface CrawlOutcome {
  outcome: string;
  detail: string | null;
}

/** Every outcome this classifier can return, for the ledger's CHECK and docs. */
export const CRAWL_OUTCOMES = [
  "captured",
  "render_rate_limited",
  "render_cost_refused",
  "render_auth_failed",
  "render_unconfigured",
  "render_unreachable",
  "bot_challenge",
  "blocked_no_render_budget",
] as const;

// Body-text fallbacks, used ONLY when there is no HTTP status to read.
// Each pattern must be unique to one outcome across every body the provider
// sends. "upgrade your plan" is deliberately absent: it appears in both the
// 402 and the 429, which is exactly how the previous version went wrong.
const RATE_LIMIT_TEXT = /\brate limit\b|\breq\/min\b|\bretry after\b|\btoo many requests\b/i;
const COST_TEXT = /\binsufficient credits\b|\bnot enough credits\b|\bcredit balance\b|\bpayment required\b/i;

export function classifyCrawlOutcome(args: CrawlOutcomeInput): CrawlOutcome {
  const {
    captured, reason, cheapStatus, renderAttempted, renderStatus, renderError,
    renderConfigured,
  } = args;

  if (captured) return { outcome: "captured", detail: null };

  // ── Structured status first. A code is a contract. ──────────────────
  if (renderStatus === 429) {
    return {
      outcome: "render_rate_limited",
      detail: renderError || "Renderer rate limit (HTTP 429)",
    };
  }
  if (renderStatus === 402) {
    return {
      outcome: "render_cost_refused",
      detail: renderError || "Renderer refused the request at this cost (HTTP 402)",
    };
  }
  if (renderStatus === 401 || renderStatus === 403) {
    return {
      outcome: "render_auth_failed",
      detail: renderError || `Renderer rejected the key (HTTP ${renderStatus})`,
    };
  }

  // ── Only now, and only with no status, does prose get a vote. ───────
  if (renderStatus == null && renderError) {
    if (RATE_LIMIT_TEXT.test(renderError)) {
      return { outcome: "render_rate_limited", detail: renderError };
    }
    if (COST_TEXT.test(renderError)) {
      return { outcome: "render_cost_refused", detail: renderError };
    }
  }

  if (!renderConfigured) {
    return {
      outcome: "render_unconfigured",
      detail: "No renderer is configured, so a walled page cannot be rendered",
    };
  }
  if (renderAttempted && renderStatus == null) {
    return {
      outcome: "render_unreachable",
      detail: renderError || "Renderer did not respond",
    };
  }

  // Only now is the dealer's site a fair thing to blame.
  if (reason === "bot_challenge") {
    return renderAttempted
      ? {
        outcome: "bot_challenge",
        detail: `Site refused the request (HTTP ${cheapStatus ?? "?"}) and the rendered page was also refused`,
      }
      : {
        outcome: "blocked_no_render_budget",
        detail: `Site refused the request (HTTP ${cheapStatus ?? "?"}); no render budget left this run`,
      };
  }
  return {
    outcome: reason || "no_price_extracted",
    detail: cheapStatus ? `HTTP ${cheapStatus}` : null,
  };
}
