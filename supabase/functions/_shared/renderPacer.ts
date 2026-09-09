// Pacing for the Firecrawl renderer.
//
// The plan allows 11 requests per minute. On 2026-09-08 the crawler fired 25
// renders in 9 seconds: 10 were refused at 402 and 15 at 429, and for the
// next fortnight nothing was captured. Every decision here is a pure function
// of the timestamps it is handed, so the arithmetic can be tested without a
// clock, and the provider's own "retry after Ns" is honoured rather than
// guessed at.

export const DEFAULT_RENDERS_PER_MINUTE = 10;
export const MIN_RENDERS_PER_MINUTE = 1;
export const MAX_RENDERS_PER_MINUTE = 60;
export const WINDOW_MS = 60_000;
export const JITTER_MAX_FRACTION = 0.15;
export const BACKOFF_BASE_MS = 2_000;
export const BACKOFF_CAP_MS = 60_000;
export const RETRY_AFTER_MARGIN_MS = 1_000;

const RETRY_AFTER_BODY_RE = /retry after (\d+)s/i;

export function resolveRendersPerMinute(
  raw: string | null | undefined,
  fallback = DEFAULT_RENDERS_PER_MINUTE,
): number {
  const n = Number.parseInt(String(raw ?? "").trim(), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_RENDERS_PER_MINUTE, Math.max(MIN_RENDERS_PER_MINUTE, n));
}

export function minIntervalMs(rpm: number, windowMs = WINDOW_MS): number {
  return Math.ceil(windowMs / Math.max(MIN_RENDERS_PER_MINUTE, rpm));
}

// Two constraints, both must hold: an even gap between consecutive renders
// (a burst of ten in one second is inside the per-minute count and still the
// shape that got us refused), and no more than `rpm` starts inside any
// trailing window.
export function delayBeforeNextRender(
  recentStarts: readonly number[],
  now: number,
  rpm: number,
  windowMs = WINDOW_MS,
): number {
  const inWindow = recentStarts.filter((t) => t > now - windowMs && t <= now).sort((a, b) => a - b);
  let delay = 0;
  if (inWindow.length > 0) {
    const last = inWindow[inWindow.length - 1];
    delay = Math.max(delay, last + minIntervalMs(rpm, windowMs) - now);
  }
  if (inWindow.length >= rpm) {
    const oldest = inWindow[inWindow.length - rpm];
    delay = Math.max(delay, oldest + windowMs - now);
  }
  return Math.max(0, delay);
}

export function applyJitter(delayMs: number, random: number, maxFraction = JITTER_MAX_FRACTION): number {
  if (delayMs <= 0) return 0;
  const r = Math.min(1, Math.max(0, random));
  return Math.round(delayMs * (1 + r * maxFraction));
}

export function parseRetryAfter(
  header: string | null | undefined,
  body: string | null | undefined,
  now?: number,
): number | null {
  const h = String(header ?? "").trim();
  if (h) {
    if (/^\d+$/.test(h)) return Number.parseInt(h, 10) * 1000;
    const at = Date.parse(h);
    if (Number.isFinite(at) && now != null) return Math.max(0, at - now);
  }
  const m = RETRY_AFTER_BODY_RE.exec(String(body ?? ""));
  if (m) return Number.parseInt(m[1], 10) * 1000;
  return null;
}

export function backoffMs(consecutiveRateLimits: number): number {
  if (consecutiveRateLimits <= 0) return 0;
  return Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (consecutiveRateLimits - 1));
}

export function waitAfterRateLimit(retryAfterMs: number | null, consecutiveRateLimits: number): number {
  const honoured = retryAfterMs != null ? retryAfterMs + RETRY_AFTER_MARGIN_MS : 0;
  return Math.max(honoured, backoffMs(consecutiveRateLimits));
}

export function deriveRenderBudget(runBudgetMs: number, rpm: number, reserveMs = 0): number {
  const usable = runBudgetMs - reserveMs;
  if (usable <= 0) return 0;
  return Math.floor(usable / minIntervalMs(rpm));
}

export interface RenderPacerSnapshot {
  rpm: number;
  renders: number;
  consecutiveRateLimits: number;
  totalWaitMs: number;
}

export interface RenderPacer {
  waitBeforeRender(now: number): number;
  noteRenderStarted(now: number): void;
  noteSuccess(): void;
  noteRateLimited(retryAfterMs: number | null): number;
  snapshot(): RenderPacerSnapshot;
}

export function createRenderPacer(opts: {
  rpm?: number;
  random?: () => number;
  windowMs?: number;
} = {}): RenderPacer {
  const rpm = opts.rpm ?? DEFAULT_RENDERS_PER_MINUTE;
  const random = opts.random ?? Math.random;
  const windowMs = opts.windowMs ?? WINDOW_MS;
  let starts: number[] = [];
  let renders = 0;
  let consecutiveRateLimits = 0;
  let totalWaitMs = 0;
  return {
    waitBeforeRender(now) {
      starts = starts.filter((t) => t > now - windowMs * 2);
      const wait = applyJitter(delayBeforeNextRender(starts, now, rpm, windowMs), random());
      totalWaitMs += wait;
      return wait;
    },
    noteRenderStarted(now) {
      starts.push(now);
      renders++;
    },
    noteSuccess() {
      consecutiveRateLimits = 0;
    },
    noteRateLimited(retryAfterMs) {
      consecutiveRateLimits++;
      const wait = waitAfterRateLimit(retryAfterMs, consecutiveRateLimits);
      totalWaitMs += wait;
      return wait;
    },
    snapshot() {
      return { rpm, renders, consecutiveRateLimits, totalWaitMs };
    },
  };
}
