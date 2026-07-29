// Should this factory window sticker publish itself?
//
// The orchestrator renders, QAs and files a document on every run. This
// module is the single place that decides whether the filed document goes
// straight to the customer passport or waits for a human, and it is pure so
// the decision can be tested rather than inferred from production.
//
// The bar is not "is anything imperfect" — that bar left every record in
// NEEDS REVIEW forever, which is worse than useless because a document
// nobody publishes is a document nobody reads. The bar is: could publishing
// this state put something on a customer-facing manufacturer document that
// is wrong, unverifiable, or not ours to assert. Everything that clears that
// bar publishes; everything that does not stays in review WITH A REASON A
// DEALER CAN ACT ON.
//
// Never auto-publishable, in any combination:
//   * no VIN-specific manufacturer build sheet,
//   * a conflict between trusted sources (make, condition),
//   * MSRP arithmetic that does not reconcile,
//   * a brand with no registered, renderable template,
//   * a vehicle the reproduction rules do not permit,
//   * a failed QA/geometry/content-completeness check.

import type { SelectionDowngrade, SelectionStatus } from "./oem/selection.ts";

// Part of the generation fingerprint. Bumping it re-decides every record on
// its next orchestration instead of letting a stale REVIEW_REQUIRED sit
// behind a fingerprint that no longer reflects the policy that produced it.
export const AUTO_PUBLISH_POLICY_VERSION = "2026-07-29.1";

// ── Money ────────────────────────────────────────────────────────────
// Every comparison below is integer cents. Dollar figures arrive as JSON
// numbers, so they are converted once, at the edge, and never added as
// floats: 53350.1 + 2450.2 + 1095.3 is not 56895.6 in binary floating point,
// and a sticker that reconciles or does not on that difference is not a
// sticker anyone can stand behind.

export const toCents = (dollars: number | null | undefined): number | null => {
  if (dollars === null || dollars === undefined) return null;
  const n = Number(dollars);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
};

export const fromCents = (cents: number | null): number | null =>
  cents === null ? null : Math.round(cents) / 100;

/** Exact-match tolerance, in cents. Five dollars, as the pipeline has always used. */
export const RECONCILIATION_MATCH_TOLERANCE_CENTS = 500;
/** Above this the difference is a discrepancy a human has to look at. */
export const RECONCILIATION_MINOR_TOLERANCE_CENTS = 10_000;

export type ReconciliationStatus =
  | "MATCHED"
  | "MINOR_VARIANCE"
  | "REVIEW_REQUIRED"
  | "INSUFFICIENT_DATA";

export interface MsrpReconciliation {
  status: ReconciliationStatus;
  /** Absolute difference in integer cents; null when it could not be computed. */
  differenceCents: number | null;
  /** The same figure as an exact two-decimal number, for storage and display. */
  difference: number | null;
  computedCents: number | null;
  statedCents: number | null;
}

export interface MsrpInputs {
  baseMsrp: number | null;
  optionsTotal: number | null;
  destinationCharge: number | null;
  statedTotalMsrp: number | null;
}

/**
 * Base + options + destination against the manufacturer-stated total.
 *
 * Absent components are NOT treated as zero-and-fine: a missing destination
 * charge makes the computed total short by exactly the destination charge,
 * which is a discrepancy, and it is reported as one rather than papered over.
 */
export function reconcileMsrp(input: MsrpInputs): MsrpReconciliation {
  const base = toCents(input.baseMsrp);
  const stated = toCents(input.statedTotalMsrp);
  if (base === null || stated === null) {
    return {
      status: "INSUFFICIENT_DATA",
      differenceCents: null, difference: null,
      computedCents: null, statedCents: stated,
    };
  }
  const computed = base + (toCents(input.optionsTotal) ?? 0) + (toCents(input.destinationCharge) ?? 0);
  const differenceCents = Math.abs(computed - stated);
  const status: ReconciliationStatus =
    differenceCents <= RECONCILIATION_MATCH_TOLERANCE_CENTS ? "MATCHED"
    : differenceCents <= RECONCILIATION_MINOR_TOLERANCE_CENTS ? "MINOR_VARIANCE"
    : "REVIEW_REQUIRED";
  return {
    status,
    differenceCents,
    difference: fromCents(differenceCents),
    computedCents: computed,
    statedCents: stated,
  };
}

// ── Template selection policy ────────────────────────────────────────
//
// A selection downgrade is not automatically a publication blocker. Two of
// them are presentation-only:
//
//   make_alias                 — "Chevy" resolved to CHEVROLET through the
//                                registered alias table. The brand is not in
//                                doubt; the spelling was.
//   generated_fallback_profile — the brand HAS a registered, rendered theme,
//                                but no hand-authored profile covers this
//                                model year, so the engine serves the brand's
//                                own theme through a generated profile. A
//                                profile selects presentation only; it carries
//                                no arithmetic, no barcode logic and no
//                                authorized logo artwork. Blocking on it meant
//                                no vehicle older than model year 2020 could
//                                ever publish, for any brand.
//
// The other two are identity risk and stay manual:
//
//   make_fuzzy         — the make matched by normalization only. Putting one
//                        manufacturer's design on another's vehicle is the
//                        exact failure this refuses to automate.
//   model_year_missing — the model year is printed on the document and pins
//                        the theme; absent, neither can be asserted.
const AUTO_PUBLISHABLE_DOWNGRADES: ReadonlySet<SelectionDowngrade> = new Set<SelectionDowngrade>([
  "make_alias",
  "generated_fallback_profile",
]);

export interface SelectionFacts {
  selectionStatus: SelectionStatus;
  downgrades: SelectionDowngrade[];
  conflictingFields: string[];
  /** True when the engine resolved a registered template it can actually render. */
  hasTemplateDefinition: boolean;
}

export function selectionAllowsAutoPublish(selection: SelectionFacts): boolean {
  if (!selection.hasTemplateDefinition) return false;
  if (selection.conflictingFields.length > 0) return false;
  if (selection.selectionStatus === "selected") return true;
  if (selection.selectionStatus !== "manual_review") return false;
  // Fail closed: a downgrade code this policy has never been reasoned about
  // blocks, so adding one to the selection engine cannot silently widen what
  // publishes on its own.
  return selection.downgrades.every((d) => AUTO_PUBLISHABLE_DOWNGRADES.has(d));
}

// ── The decision ─────────────────────────────────────────────────────

export type AutoPublishBlockerCode =
  | "build_sheet_absent"
  | "not_eligible"
  | "template_unresolved"
  | "template_override_active"
  | "msrp_incomplete"
  | "msrp_does_not_reconcile"
  | "passport_url_missing"
  | "layout_incomplete"
  | "page_geometry_failed"
  | "qa_failed"
  | "low_confidence";

export interface AutoPublishBlocker {
  code: AutoPublishBlockerCode;
  /** One sentence a dealer can act on. No jargon, no stale provider errors. */
  detail: string;
}

export interface AutoPublishInput {
  hasBuildSheet: boolean;
  eligibility: {
    eligible: boolean;
    status: string;
    reasons: string[];
  };
  selection: SelectionFacts;
  /** A human pinned this template; the document they steered is theirs to approve. */
  templateOverrideActive: boolean;
  reconciliation: MsrpReconciliation;
  /** Normalizer grade: HIGH only when a VIN-specific sheet carries a base MSRP. */
  confidence: "HIGH" | "MEDIUM" | "LOW";
  canonicalPassportUrl: string | null;
  qaChecks: Record<string, boolean>;
  completeness: {
    pass: boolean;
    code: string;
    missing: Array<{ label: string }>;
    miscounted: Array<{ label: string; actualCount: number }>;
  };
  geometry: { pass: boolean; code: string; reasons: string[] };
}

export interface AutoPublishDecision {
  autoPublish: boolean;
  blockers: AutoPublishBlocker[];
  /** Written to factory_sticker_records.review_reason; null when publishing. */
  reviewReason: string | null;
}

const money = (cents: number | null): string =>
  cents === null ? "unknown" : (cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });

const list = (items: string[], max = 4): string => {
  const shown = items.slice(0, max).join("; ");
  return items.length > max ? `${shown}; and ${items.length - max} more` : shown;
};

export function evaluateAutoPublish(input: AutoPublishInput): AutoPublishDecision {
  const blockers: AutoPublishBlocker[] = [];
  const block = (code: AutoPublishBlockerCode, detail: string) => blockers.push({ code, detail });

  if (!input.hasBuildSheet) {
    block("build_sheet_absent",
      "no VIN-specific manufacturer build sheet is saved for this vehicle yet");
  }

  if (!input.eligibility.eligible) {
    block("not_eligible",
      input.eligibility.reasons.length
        ? list(input.eligibility.reasons)
        : `this vehicle does not qualify for a manufacturer-style sticker (${input.eligibility.status})`);
  }

  if (!selectionAllowsAutoPublish(input.selection)) {
    const why = input.selection.hasTemplateDefinition
      ? (input.selection.conflictingFields.length
        ? `trusted sources disagree on ${input.selection.conflictingFields.join(", ")}`
        : list(input.selection.downgrades.filter((d) => !AUTO_PUBLISHABLE_DOWNGRADES.has(d))
          .map(describeDowngrade)))
      : "this brand has no registered OEM template that the engine can render";
    block("template_unresolved",
      why || "the OEM template could not be assigned automatically");
  }

  if (input.templateOverrideActive) {
    block("template_override_active",
      "a manager pinned this template by hand, so the document they steered is theirs to approve");
  }

  if (input.reconciliation.status === "INSUFFICIENT_DATA") {
    block("msrp_incomplete",
      "the manufacturer base MSRP and total MSRP are not both on the record, so the price table cannot be checked");
  } else if (input.reconciliation.status !== "MATCHED") {
    block("msrp_does_not_reconcile",
      `base plus options plus destination comes to $${money(input.reconciliation.computedCents)} `
      + `but the manufacturer record states $${money(input.reconciliation.statedCents)} `
      + `(off by $${money(input.reconciliation.differenceCents)})`);
  }

  if (!input.canonicalPassportUrl) {
    block("passport_url_missing",
      "this vehicle has no public passport address, so the QR code on the sticker would resolve to nothing");
  }

  if (input.confidence !== "HIGH") {
    block("low_confidence",
      `the decoded record is graded ${input.confidence}, not HIGH`);
  }

  if (!input.completeness.pass) {
    const missing = input.completeness.missing.map((m) => `missing ${m.label}`);
    const dupes = input.completeness.miscounted.map((m) => `${m.label} appeared ${m.actualCount}x`);
    block("layout_incomplete",
      `${input.completeness.code.toLowerCase()}: ${list([...missing, ...dupes])}`);
  }

  if (!input.geometry.pass) {
    block("page_geometry_failed",
      `${input.geometry.code.toLowerCase()}: ${list(input.geometry.reasons)}`);
  }

  const failedQa = Object.entries(input.qaChecks).filter(([, ok]) => !ok).map(([name]) => name);
  // content_complete and page_count_ok already have their own, more specific
  // blockers above; naming them twice would only make the reason harder to read.
  const otherQa = failedQa.filter((n) => n !== "content_complete" && n !== "page_count_ok");
  if (otherQa.length) {
    block("qa_failed", `identity check failed: ${list(otherQa)}`);
  }

  return {
    autoPublish: blockers.length === 0,
    blockers,
    reviewReason: blockers.length
      ? blockers.map((b) => `${b.code}: ${b.detail}`).join(" | ")
      : null,
  };
}

function describeDowngrade(code: SelectionDowngrade): string {
  switch (code) {
    case "make_fuzzy":
      return "the make matched only after normalization, so the brand needs confirming before it prints";
    case "model_year_missing":
      return "the model year is missing, so the template year-range cannot be pinned";
    case "make_alias":
      return "the make matched through the alias table";
    case "generated_fallback_profile":
      return "no authored theme profile covers this model year";
    default:
      return code;
  }
}
