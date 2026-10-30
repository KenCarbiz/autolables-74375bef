// Inventory readiness, stated two separate ways so the numbers reconcile.
//
// Every vehicle gets a checklist score from 0 to 100 (share of its checks that
// pass). From the same list of scores:
//   - checklist completeness is the MEAN score across vehicles, and
//   - the complete rate is how many vehicles scored 100, out of all vehicles.
// A lot can average 72% completeness while only a few vehicles are complete;
// the two figures answer different questions and are never printed as one.

export interface ReadinessSummary {
  total: number;
  /** Vehicles whose every check passes. */
  complete: number;
  /** complete / total, whole percent; null when there are no vehicles. */
  completeRatePct: number | null;
  /** Mean checklist score across all vehicles, whole percent; null when none. */
  meanCompletenessPct: number | null;
}

export function summarizeReadiness(scores: number[]): ReadinessSummary {
  const total = scores.length;
  if (total === 0) return { total: 0, complete: 0, completeRatePct: null, meanCompletenessPct: null };
  const complete = scores.filter((s) => s >= 100).length;
  const mean = scores.reduce((sum, s) => sum + s, 0) / total;
  return {
    total,
    complete,
    completeRatePct: Math.round((complete / total) * 100),
    meanCompletenessPct: Math.round(mean),
  };
}
