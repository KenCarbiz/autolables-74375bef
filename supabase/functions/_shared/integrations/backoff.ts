export const BACKOFF_SCHEDULE_SECONDS = [60, 300, 1800, 7200, 21600, 86400] as const;
export const MAX_ATTEMPTS = BACKOFF_SCHEDULE_SECONDS.length;
export const JITTER_RATIO = 0.2;

export interface RetryDecision {
  dead: boolean;
  delaySeconds: number | null;
  reason: "retry" | "attempts_exhausted" | "permanent_failure";
}

export function jitteredDelaySeconds(attemptsMade: number, random: () => number = Math.random): number {
  const index = Math.min(Math.max(attemptsMade, 1), MAX_ATTEMPTS) - 1;
  const base = BACKOFF_SCHEDULE_SECONDS[index];
  const factor = 1 + (random() * 2 - 1) * JITTER_RATIO;
  return Math.round(base * factor);
}

export const isPermanentHttpFailure = (status: number): boolean =>
  status >= 400 && status < 500 && status !== 408 && status !== 429;

// attemptsMade counts the attempt that just failed, so the first failure passes 1.
export function nextRetry(
  attemptsMade: number,
  httpStatus: number | null,
  random: () => number = Math.random,
): RetryDecision {
  if (httpStatus !== null && isPermanentHttpFailure(httpStatus)) {
    return { dead: true, delaySeconds: null, reason: "permanent_failure" };
  }
  if (attemptsMade >= MAX_ATTEMPTS) {
    return { dead: true, delaySeconds: null, reason: "attempts_exhausted" };
  }
  return { dead: false, delaySeconds: jitteredDelaySeconds(attemptsMade, random), reason: "retry" };
}
