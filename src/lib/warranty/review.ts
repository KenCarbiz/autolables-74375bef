// ── Warranty library review / update tooling ─────────────────────────────────
// OEM warranty and CPO terms change — especially at model-year changeover. This
// builds a review queue so we can go back in at any time and see what needs to
// be re-checked: unverified programs, programs whose model-year range has rolled
// over, makes missing a new-car or CPO program, and a periodic full re-review.

import { OEM_WARRANTY_PROGRAMS } from "@/data/oemWarrantyPrograms";
import { OEM_WARRANTY_REFERENCE } from "@/data/oemWarrantyReference";
import { OEM_CPO_REFERENCE } from "@/data/oemCpoReference";
import type { OemWarrantyProgram } from "@/lib/warranty/types";

// When the library was last given a full human review, and how often it should
// be re-reviewed. Update lastReviewedAt whenever a verification pass is done.
export const WARRANTY_LIBRARY_META = {
  lastReviewedAt: "2026-07-02",
  reviewIntervalMonths: 12,
  notes:
    "New-car terms derive from the curated oemWarrantyReference; CPO terms from oemCpoReference. " +
    "All programs are needs_review until source-verified. Re-check every model-year changeover (fall).",
} as const;

export type ReviewReason =
  | "unverified"           // confidence_status is needs_review
  | "model_year_rollover"  // program's model-year range ends before the current year
  | "missing_cpo"          // make has a new-car program but no CPO reference
  | "review_interval_due"; // periodic full re-review is due

export interface WarrantyReviewItem {
  kind: "new" | "cpo";
  make: string;
  programId?: string;
  reason: ReviewReason;
  detail: string;
}

const monthsBetween = (fromIso: string, to: Date) => {
  const from = new Date(fromIso);
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
};

export interface ReviewQueueOptions {
  asOf?: Date;
  programs?: OemWarrantyProgram[];
}

export function buildWarrantyReviewQueue(opts: ReviewQueueOptions = {}): WarrantyReviewItem[] {
  const asOf = opts.asOf ?? new Date();
  const asOfYear = asOf.getFullYear();
  const programs = opts.programs ?? OEM_WARRANTY_PROGRAMS;
  const items: WarrantyReviewItem[] = [];

  // New-car programs: unverified + model-year rollover.
  for (const p of programs) {
    if (p.confidenceStatus !== "verified") {
      items.push({ kind: "new", make: p.oemMake, programId: p.id, reason: "unverified", detail: `${p.programName} (${p.model ?? "all models"} ${p.modelYearStart}-${p.modelYearEnd}) has not been source-verified.` });
    }
    if (p.modelYearEnd < asOfYear) {
      items.push({ kind: "new", make: p.oemMake, programId: p.id, reason: "model_year_rollover", detail: `${p.oemMake} program ends at MY${p.modelYearEnd}; MY${asOfYear} has arrived — re-check for term changes.` });
    }
  }

  // Makes with a new-car program but no CPO reference.
  const newMakes = new Set(programs.map((p) => p.oemMake.toUpperCase()));
  for (const make of newMakes) {
    if (!OEM_CPO_REFERENCE[make]) {
      items.push({ kind: "cpo", make, reason: "missing_cpo", detail: `${make} has a new-car program but no CPO reference — add or confirm none exists.` });
    }
  }

  // CPO reference: flag only the entries not yet verified.
  for (const make of Object.keys(OEM_CPO_REFERENCE)) {
    const cpo = OEM_CPO_REFERENCE[make];
    if (cpo.confidenceStatus !== "verified") {
      items.push({ kind: "cpo", make, reason: "unverified", detail: `${cpo.programName} is not source-verified${cpo.notes ? ` — ${cpo.notes}` : "."}` });
    }
  }

  // Periodic full re-review.
  if (monthsBetween(WARRANTY_LIBRARY_META.lastReviewedAt, asOf) >= WARRANTY_LIBRARY_META.reviewIntervalMonths) {
    items.push({ kind: "new", make: "*", reason: "review_interval_due", detail: `Library last reviewed ${WARRANTY_LIBRARY_META.lastReviewedAt}; a full re-review is due (every ${WARRANTY_LIBRARY_META.reviewIntervalMonths} months).` });
  }

  return items;
}

// One-line summary for admin/CLI surfacing.
export function reviewQueueSummary(opts: ReviewQueueOptions = {}): {
  total: number;
  byReason: Record<ReviewReason, number>;
  newMakes: number;
  cpoMakes: number;
} {
  const items = buildWarrantyReviewQueue(opts);
  const byReason = { unverified: 0, model_year_rollover: 0, missing_cpo: 0, review_interval_due: 0 } as Record<ReviewReason, number>;
  for (const it of items) byReason[it.reason]++;
  return {
    total: items.length,
    byReason,
    newMakes: Object.keys(OEM_WARRANTY_REFERENCE).length,
    cpoMakes: Object.keys(OEM_CPO_REFERENCE).length,
  };
}
