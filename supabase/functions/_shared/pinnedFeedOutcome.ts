// What a pinned syndication feed actually said — shared so it is unit-tested
// rather than only exercised nightly against a live provider.
//
// A pinned rooftop is re-validated every night. Three very different things
// can leave the validation with no usable hit, and for 24 nights in October
// 2026 they were all reported as one of them:
//
//   budget_refused     our own monthly provider budget refused the request, so
//                      nothing was sent. Not the provider, not the rooftop.
//   provider_refused   the provider answered 429 / 401 / 403 / 5xx or timed out.
//                      The feed said nothing about the rooftop. This is an
//                      account, quota or rate condition, and clearing the pin
//                      would not change it.
//   empty_answer       a 2xx with zero rows. The feed answered and the pinned
//                      scope is empty: the lot is empty or the pin is wrong.
//   scope_mismatch     rows came back but too few matched the rooftop's
//                      street and ZIP. The pin now points at another store.
//
// Only the last two are "pinned_scope_failed_validation". Reporting a refusal
// that way told the operator the rooftop had moved when the provider had said
// no, and because the refusal path also skipped the run row, the 24 refusals
// left no trace in inventory_sync_runs at all.

export type PinnedFeedOutcomeKind = "validated" | "budget_refused" | "provider_refused" | "empty_answer" | "scope_mismatch";

export interface PinnedFeedSample {
  /** The provider refused or never answered (mcFetch's `refused`). */
  refused: boolean;
  /** Our own budget gate refused it; nothing was sent (mcFetch's `budgetDenied`). */
  budgetDenied?: boolean;
  /** HTTP status; 0 when the request never completed. */
  http: number;
  /** Rows the page carried. */
  got: number;
  /** Rows that positively matched the rooftop. */
  match: number;
  /** match / (match + mismatch); 0 when nothing was decidable. */
  purity: number;
  /** The purity the run demanded (0.95 strict, 0.6 relaxed). */
  minPurity: number;
}

export interface PinnedFeedOutcome {
  kind: PinnedFeedOutcomeKind;
  /** The `error` written to last_status and the run row; null when validated. */
  error: string | null;
  /** Operator-facing note. Never blames the pin for a refusal. */
  note: string | null;
  /** Run-row status. A refusal is a failed run, never a skipped one. */
  runStatus: "success" | "failed" | null;
}

const refusalWord = (http: number): string => {
  if (http === 429) return "rate-limited or over quota (HTTP 429)";
  if (http === 401) return "rejected the key (HTTP 401)";
  if (http === 403) return "refused the endpoint for this plan (HTTP 403)";
  if (http >= 500) return `failed on its side (HTTP ${http})`;
  if (http === 0) return "did not answer (timeout or network)";
  return `refused (HTTP ${http})`;
};

export function classifyPinnedFeed(
  sample: PinnedFeedSample,
  pin: { param: string; value: string },
  rooftop: { street: string; zip: string },
): PinnedFeedOutcome {
  const pinLabel = `${pin.param}=${pin.value}`;
  if (sample.budgetDenied) {
    return {
      kind: "budget_refused",
      error: "budget_refused",
      note: `The monthly provider budget refused the request for the pinned feed ${pinLabel}; nothing was sent to MarketCheck. ` +
        "Inventory left untouched. This is AutoLabels' own spend limit, not a provider or rooftop condition: " +
        "do not clear the pin. Review provider_call_budgets and this month's provider_call_events.",
      runStatus: "failed",
    };
  }
  if (sample.refused) {
    return {
      kind: "provider_refused",
      error: sample.http > 0 ? `provider_refused_${sample.http}` : "provider_refused_timeout",
      note: `MarketCheck ${refusalWord(sample.http)} on the pinned feed ${pinLabel}. ` +
        "Inventory left untouched. This is a provider or account condition, not a rooftop change: " +
        "do not clear the pin. Check the MarketCheck account for quota, plan or key status.",
      runStatus: "failed",
    };
  }
  if (sample.got > 0 && sample.match > 0 && sample.purity >= sample.minPurity) {
    return { kind: "validated", error: null, note: null, runStatus: "success" };
  }
  if (sample.got === 0) {
    return {
      kind: "empty_answer",
      error: "pinned_scope_failed_validation",
      note: `Pinned feed ${pinLabel} answered with no cars (HTTP ${sample.http}). ` +
        "Inventory left untouched. Either the lot is empty on the feed or the pin no longer " +
        "points at this rooftop. Clear the pin to re-resolve.",
      runStatus: "failed",
    };
  }
  return {
    kind: "scope_mismatch",
    error: "pinned_scope_failed_validation",
    note: `Pinned feed ${pinLabel} no longer matches ${rooftop.street} ${rooftop.zip} ` +
      `(${sample.match} of ${sample.got} rows matched, purity ${sample.purity.toFixed(2)} below ${sample.minPurity}). ` +
      "Inventory left untouched. Clear the pin to re-resolve.",
    runStatus: "failed",
  };
}
