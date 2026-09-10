// GENERATED — do not edit.
// Mirror of src/lib/market/providerTransport.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// ── One provider call, classified ──────────────────────────────────────────
//
// This module exists so the transport can be tested without a network and
// without money. `callProviderOnce` takes its fetch as an argument, so every
// failure mode below is reachable from a unit test and none of them is
// reachable by accident from a test run that forgot to mock something.
//
// The classification is the point. A 403 and a 502 are both "no answer", but
// they are not the same fact and must not be recorded as the same fact:
//
//   502  the provider is broken right now      -> try again later
//   403  we are not entitled to this endpoint  -> trying again changes nothing
//
// Lumping them together (as `!res.ok -> server_error` did) makes an
// entitlement failure look transient. A scheduler then retries it nightly
// forever, each retry reserving budget, and the operator reads "server_error"
// and concludes MarketCheck is flaky rather than that we are not paying for
// the endpoint we are calling.

import type { ProviderAttemptOutcome } from "./freshness.ts";

/** The shape of a response this module needs. Narrower than the DOM's. */
export interface ProviderHttpResponse {
  status: number;
  json: () => Promise<unknown>;
}

export type ProviderFetch = (
  url: string,
  init?: { signal?: AbortSignal },
) => Promise<ProviderHttpResponse>;

export interface ProviderCallResult {
  outcome: ProviderAttemptOutcome;
  status: number | null;
  body: unknown;
  /**
   * How many times the network was touched. This is asserted in tests and
   * carried into the audit record: a gate that authorises one paid call needs
   * evidence that one call is what happened, not an assurance that it is what
   * the code intends.
   */
  attempts: number;
}

/**
 * Map an HTTP status onto an outcome.
 *
 * 4xx is split rather than collapsed, because the three groups need three
 * different human responses: fix the credential, buy the endpoint, fix the
 * request.
 */
export function classifyProviderStatus(status: number): ProviderAttemptOutcome {
  if (status >= 200 && status < 300) return "succeeded";
  if (status === 401) return "auth_failed";
  if (status === 403) return "not_entitled";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server_error";
  if (status >= 400) return "request_rejected";
  // 1xx/3xx never reach here through a normal fetch, which follows redirects.
  // Whatever it is, it is not an answer, and it is not the caller's fault.
  return "server_error";
}

/** A failed attempt that a later identical attempt would resolve. */
export const TRANSIENT_STATUSES: ProviderAttemptOutcome[] = [
  "timeout", "rate_limited", "server_error", "network_error",
];

const timeoutSignal = (ms: number): AbortSignal | undefined => {
  try {
    return typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
      ? AbortSignal.timeout(ms)
      : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Perform exactly one provider request.
 *
 * There is deliberately no retry here and there must never be one. Retrying
 * inside the transport would spend a second reservation's worth of money
 * without a second reservation, which is precisely the control the budget
 * exists to impose. If a retry policy is ever wanted it belongs above the
 * reservation, not below it.
 */
export async function callProviderOnce(
  url: string,
  fetchImpl: ProviderFetch,
  timeoutMs: number,
): Promise<ProviderCallResult> {
  let attempts = 0;
  try {
    attempts = 1;
    const res = await fetchImpl(url, { signal: timeoutSignal(timeoutMs) });
    const outcome = classifyProviderStatus(res.status);
    if (outcome !== "succeeded") {
      return { outcome, status: res.status, body: null, attempts };
    }
    // A 200 carrying unparseable JSON still cost money, so it is still a
    // succeeded attempt. The body is null and the parser rejects it; what it
    // must never do is become a market value.
    const body = await res.json().catch(() => null);
    return { outcome: "succeeded", status: res.status, body, attempts };
  } catch (e) {
    const name = String((e as Error)?.name ?? e);
    const isTimeout = name.includes("Timeout") || name.includes("Abort");
    return {
      outcome: isTimeout ? "timeout" : "network_error",
      status: null,
      body: null,
      attempts,
    };
  }
}

/**
 * What the reservation ledger records for a failed call.
 *
 * The HTTP status is kept because the outcome alone loses it, and "not
 * entitled (403)" is a different support conversation from "not entitled"
 * with no number attached.
 */
export function failureReason(outcome: ProviderAttemptOutcome, status: number | null): string {
  return status == null ? outcome : `${outcome}_${status}`;
}
