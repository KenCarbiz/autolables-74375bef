// ── Warranty calculation service ─────────────────────────────────────────────
// Pure remaining-coverage math for USED / pre-owned vehicles. New vehicles never
// call this — their coverage hasn't started counting down (it begins at
// delivery), so they display term figures only.
//
// Missing-data rule: if the in-service date is unknown we skip date math; if the
// mileage is unknown we skip mileage math. When either dimension is missing the
// result is marked `partial` + `needsDealerConfirmation` so the UI can disclose
// that instead of fabricating a number.

import type { CoverageRemaining, OemWarrantyCoverage } from "@/lib/warranty/types";

const MS_PER_MONTH = 1000 * 60 * 60 * 24 * 30.4375;

const addMonths = (iso: string, months: number): Date => {
  const d = new Date(iso);
  d.setMonth(d.getMonth() + months);
  return d;
};

export interface CalcInput {
  coverage: OemWarrantyCoverage;
  inServiceDate?: string | null;
  currentMileage?: number | null;
  asOfDate?: Date;
}

export function calculateUsedWarrantyRemaining({
  coverage,
  inServiceDate,
  currentMileage,
  asOfDate = new Date(),
}: CalcInput): CoverageRemaining {
  const termMonths = coverage.termMonths ?? (coverage.termYears != null ? coverage.termYears * 12 : null);
  const mileageLimit = coverage.unlimitedMiles ? null : (coverage.mileageLimit ?? null);

  // ── Time dimension ──
  let expirationDate: string | null = null;
  let monthsRemaining: number | null = null;
  let yearsRemaining: number | null = null;
  let timePct: number | null = null;
  const haveTime = !!inServiceDate && !!termMonths;
  if (haveTime) {
    const end = addMonths(inServiceDate as string, termMonths as number);
    expirationDate = end.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    const ms = end.getTime() - asOfDate.getTime();
    monthsRemaining = Math.max(0, Math.round(ms / MS_PER_MONTH));
    yearsRemaining = Math.round(monthsRemaining / 12);
    timePct = Math.max(0, Math.min(100, (monthsRemaining / (termMonths as number)) * 100));
  }

  // ── Mileage dimension ──
  let expirationMileage: number | null = null;
  let milesRemaining: number | null = null;
  let milesPct: number | null = null;
  const haveMiles = currentMileage != null && mileageLimit != null && mileageLimit > 0;
  if (haveMiles) {
    expirationMileage = mileageLimit as number;
    milesRemaining = Math.max(0, (mileageLimit as number) - (currentMileage as number));
    milesPct = Math.max(0, Math.min(100, (milesRemaining / (mileageLimit as number)) * 100));
  } else if (coverage.unlimitedMiles) {
    // Unlimited mileage is not "missing" — there's simply no cap to count down.
    expirationMileage = null;
  }

  // Overall percentage = the more-consumed of the two known dimensions.
  const pcts = [timePct, milesPct].filter((p): p is number => p != null);
  const pctRemaining = pcts.length ? Math.round(Math.min(...pcts)) : null;

  // Active if any known dimension still has coverage left. Unlimited-mileage
  // coverage stays active on the mileage axis as long as time remains.
  const activeSignals: boolean[] = [];
  if (haveTime) activeSignals.push((monthsRemaining ?? 0) > 0);
  if (haveMiles) activeSignals.push((milesRemaining ?? 0) > 0);
  const active = activeSignals.length ? activeSignals.every(Boolean) : null;

  // Missing a dimension we'd expect (in-service for time, or mileage for a
  // capped coverage) → partial + confirm with dealer.
  const missingTime = !inServiceDate;
  const missingMiles = mileageLimit != null && currentMileage == null;
  const partial = missingTime || missingMiles;
  const needsDealerConfirmation = missingTime || missingMiles || active == null;

  return {
    coverageType: coverage.coverageType,
    expirationDate,
    expirationMileage,
    monthsRemaining,
    yearsRemaining,
    milesRemaining,
    pctRemaining,
    active,
    partial,
    needsDealerConfirmation,
  };
}
