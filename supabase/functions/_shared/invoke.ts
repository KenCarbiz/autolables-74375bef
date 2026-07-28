// Calling one edge function from another, without losing the work.
//
// The platform rate-limits invocations and answers 429 with a Retry-After
// header and a body like:
//   { "message": "Rate limit exceeded for function. Retry after 27658ms." }
//
// Every call site in this tree used to throw that away and drop the work.
// That is how an ingest burst turned into 97 permanent
// artifact_autogen_failed exceptions: a transient throttle was recorded as
// a failed artifact, and three of those artifacts have no retry path at
// all, so they were simply lost.
//
// Two rules follow from that, and they are the point of this module:
//
//   * A throttle is not a failure. It is the platform asking us to wait.
//     Callers must be able to tell the difference, because "we were asked
//     to slow down" and "this vehicle cannot produce this document" need
//     opposite responses.
//
//   * The cure is pacing, not retrying. A 27-second Retry-After cannot be
//     honoured inside an edge request, so `maxWaitMs` caps the sleep and
//     reports the throttle instead of blocking. The durable fix is to not
//     provoke it — see `mapWithConcurrency`.

export interface InvokeOptions {
  body?: unknown;
  /** Per-attempt client timeout. */
  timeoutMs?: number;
  headers?: Record<string, string>;
  /** Retries after the first attempt. */
  maxRetries?: number;
  /**
   * Longest single sleep, however long the platform asks for. An edge
   * request has a hard wall clock and a 27s wait would eat it.
   */
  maxWaitMs?: number;
  /** Total budget including sleeps. */
  deadlineMs?: number;
  signal?: AbortSignal;
}

export interface InvokeResult {
  ok: boolean;
  status: number;
  data: unknown;
  /** Short loggable reason, or null on success. */
  error: string | null;
  attempts: number;
  /**
   * The platform throttled us at least once. Callers use this to requeue
   * rather than record a permanent failure — and must NOT burn a
   * per-vehicle attempt budget on it.
   */
  rateLimited: boolean;
  /** What the platform last asked us to wait, when it said. */
  retryAfterMs: number | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Run work that must not delay the response, without it being killed.
 *
 * An edge worker is torn down once the handler resolves, so a bare
 * `void somePromise()` after `return` is a coin flip. `EdgeRuntime.waitUntil`
 * is the supported way to keep the worker alive for it. Errors are swallowed
 * on purpose: the caller has already succeeded at its real job, and a failed
 * side task must never turn that into an error response.
 */
export function runInBackground(work: Promise<unknown>): void {
  const guarded = work.catch(() => undefined);
  const rt = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (typeof rt?.waitUntil === "function") rt.waitUntil(guarded);
  else void guarded;
}

// AbortSignal.timeout is missing in some test runtimes; without it we only
// lose the client-side timeout.
const timeoutSignal = (ms: number): AbortSignal | undefined => {
  const t = (AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal }).timeout;
  return typeof t === "function" ? t.call(AbortSignal, ms) : undefined;
};

/** How long the platform wants us to wait, or null if it did not say. */
export function parseRetryAfterMs(headerValue: string | null, bodyText: string): number | null {
  if (headerValue) {
    const secs = Number(headerValue);
    if (Number.isFinite(secs) && secs >= 0) return Math.round(secs * 1000);
    const at = Date.parse(headerValue);
    if (Number.isFinite(at)) return Math.max(0, at - Date.now());
  }
  const ms = /retry\s+after\s+(\d+)\s*ms/i.exec(bodyText);
  if (ms) return Number(ms[1]);
  const s = /retry\s+after\s+(\d+(?:\.\d+)?)\s*s(?:ec|econds)?\b/i.exec(bodyText);
  if (s) return Math.round(Number(s[1]) * 1000);
  return null;
}

// Full jitter over an exponential base, so throttled callers do not all
// wake at the same moment and throttle each other again.
const jittered = (base: number) => Math.round(base * (0.5 + Math.random() * 0.5));

/**
 * POST to a sibling edge function, retrying throttles and transient errors.
 * Never throws — the outcome is always in the result.
 */
export async function invokeFunction(
  url: string,
  serviceKey: string,
  opts: InvokeOptions = {},
): Promise<InvokeResult> {
  const {
    body, timeoutMs = 20_000, headers = {}, maxRetries = 3,
    maxWaitMs = 8_000, deadlineMs = 45_000, signal,
  } = opts;

  const giveUpAt = Date.now() + deadlineMs;
  let lastStatus = 0;
  let lastError = "not_attempted";
  let retryAfterMs: number | null = null;
  let sawRateLimit = false;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    if (signal?.aborted) {
      return { ok: false, status: lastStatus, data: null, error: "aborted",
               attempts: attempt - 1, rateLimited: sawRateLimit, retryAfterMs };
    }
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}`, ...headers },
        body: JSON.stringify(body ?? {}),
        signal: timeoutSignal(timeoutMs),
      });

      // Response shape is defensive on purpose: unit fakes and some runtimes
      // hand back a partial object without text()/headers.
      const readText = async (): Promise<string> => {
        try { return typeof res.text === "function" ? await res.text() : ""; }
        catch { return ""; }
      };
      const header = (name: string): string | null => {
        try { return res.headers?.get?.(name) ?? null; } catch { return null; }
      };

      if (res.ok) {
        const text = await readText();
        let data: unknown = null;
        try { data = text ? JSON.parse(text) : null; } catch { data = null; }
        return { ok: true, status: res.status, data, error: null,
                 attempts: attempt, rateLimited: sawRateLimit, retryAfterMs };
      }

      lastStatus = res.status;
      const text = await readText();
      lastError = `http_${res.status}`;

      // A deterministic 4xx will fail identically next time. Retrying it
      // only burns the invocation quota that got us throttled.
      if (res.status !== 429 && res.status !== 408 && res.status < 500) {
        return { ok: false, status: res.status, data: null,
                 error: `${lastError}${text ? `: ${text.slice(0, 200)}` : ""}`,
                 attempts: attempt, rateLimited: sawRateLimit, retryAfterMs };
      }

      if (res.status === 429) {
        sawRateLimit = true;
        retryAfterMs = parseRetryAfterMs(header("Retry-After"), text);
      }
      if (attempt > maxRetries) break;

      const asked = retryAfterMs ?? jittered(500 * 2 ** (attempt - 1));
      const wait = Math.min(asked, maxWaitMs);
      // Rather than sleep past the budget, report the throttle so the
      // caller requeues instead of pretending the work happened.
      if (Date.now() + wait > giveUpAt) {
        return {
          ok: false, status: res.status, data: null,
          error: res.status === 429 ? "rate_limited_gave_up" : lastError,
          attempts: attempt, rateLimited: sawRateLimit, retryAfterMs,
        };
      }
      await sleep(wait);
    } catch (e) {
      const msg = String((e as { message?: string } | null)?.message || e).slice(0, 200);
      lastError = msg;
      // The platform can reject the invocation outright rather than
      // answering, in which case the throttle only appears in the message.
      if (/rate limit|too many requests/i.test(msg)) {
        sawRateLimit = true;
        retryAfterMs = parseRetryAfterMs(null, msg) ?? retryAfterMs;
      }
      if (attempt > maxRetries) break;
      const wait = Math.min(retryAfterMs ?? jittered(500 * 2 ** (attempt - 1)), maxWaitMs);
      if (Date.now() + wait > giveUpAt) break;
      await sleep(wait);
    }
  }

  return { ok: false, status: lastStatus, data: null, error: lastError,
           attempts: maxRetries + 1, rateLimited: sawRateLimit, retryAfterMs };
}

/**
 * Run `worker` over `items` with at most `limit` in flight.
 *
 * The unawaited `for` loop that fans two hundred invocations into a single
 * tick is what the gateway throttles. Pacing the dispatch is the actual
 * fix; retrying is only the safety net for what slips through.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
  opts: { gapMs?: number; signal?: AbortSignal } = {},
): Promise<R[]> {
  const { gapMs = 0, signal } = opts;
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runner = async () => {
    for (;;) {
      if (signal?.aborted) return;
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
      if (gapMs) await sleep(gapMs);
    }
  };
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, runner),
  );
  return results;
}
