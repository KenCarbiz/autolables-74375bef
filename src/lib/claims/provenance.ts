// ── Claim governance & provenance ───────────────────────────────────────────
// One truth model for every verifiable claim on the passport. A claim is never
// "verified" by default, missing data never becomes "verified", and a PENDING
// or CONFLICT on a MATERIAL check can never roll up into an all-green vehicle
// status. Shared by the Verified Report, warranty, and equipment panels.

export type ClaimStatus =
  | "VERIFIED"
  | "PENDING"
  | "UNAVAILABLE"
  | "CONFLICT_DETECTED"
  | "NOT_APPLICABLE";

// The kind of authority behind a claim — kept distinct so the UI never implies
// AutoLabels physically inspected the vehicle or that sources are "independent".
export type EvidenceType =
  | "oem"                 // manufacturer / build data
  | "government"          // NHTSA, DMV, etc.
  | "commercial_history"  // CARFAX / AutoCheck-class providers
  | "dealer_reported"     // dealership-entered
  | "autolabels_calculated" // derived by AutoLabels (e.g. market comparison)
  | "inferred";           // trim-typical / not vehicle-specific

export const EVIDENCE_LABEL: Record<EvidenceType, string> = {
  oem: "Manufacturer data",
  government: "Government source",
  commercial_history: "Vehicle-history provider",
  dealer_reported: "Dealer-reported",
  autolabels_calculated: "AutoLabels-calculated",
  inferred: "Inferred (trim-typical)",
};

export const STATUS_LABEL: Record<ClaimStatus, string> = {
  VERIFIED: "Verified",
  PENDING: "Pending",
  UNAVAILABLE: "Not available",
  CONFLICT_DETECTED: "Needs review",
  NOT_APPLICABLE: "N/A",
};

export interface VerificationClaim {
  key: string;
  label: string;                 // "Title & Brand Check"
  status: ClaimStatus;
  /** The actual result, never a bare "Verified": "No open recalls as of Jun 26" / "Title status still being confirmed". */
  outcome: string;
  evidence: EvidenceType;
  sourceLabel: string;           // "NHTSA" / "AutoCheck" / "Dealer"
  /** Material checks (title, odometer, recalls) block an all-green rollup unless resolved. */
  material: boolean;
  /** Per-check freshness — recall / price / mileage / availability age differently. */
  checkedAt: string | null;
  confidence?: "high" | "medium" | "low" | null;
  vehicleSpecific?: boolean;
}

export type OverallVerification = "verified" | "in_progress" | "attention";

export interface VerificationRollup {
  applicableChecks: number;
  completedChecks: number;       // terminal (not pending)
  verified: number;
  pending: number;
  unavailable: number;
  conflicts: number;
  notApplicable: number;
  sourcesConsulted: number;
  completenessPct: number;       // completedChecks / applicableChecks, 0..100
  materialPending: boolean;
  materialConflict: boolean;
  overall: OverallVerification;
  /** Ring / status headline, e.g. "Verification in progress". */
  statusHeadline: string;
  /** Full sentence naming what's still pending. */
  subcopy: string;
  lastRefreshedAt: string | null;
}

// The report is a DATA-verification report — it aggregates records, it does not
// inspect the vehicle. Title is fixed and legally careful.
export const REPORT_TITLE = "AutoLabels Data-Verified Report";

function latest(dates: (string | null)[]): string | null {
  const valid = dates.filter((d): d is string => !!d).sort();
  return valid.length ? valid[valid.length - 1] : null;
}

/**
 * Roll individual claims into a governed vehicle-level status. Deterministic.
 * Rules: NOT_APPLICABLE is excluded from totals; "completed" excludes PENDING;
 * a material PENDING/CONFLICT prevents "verified"; missing data is never verified.
 */
export function rollupVerification(claims: VerificationClaim[]): VerificationRollup {
  const applicable = claims.filter((c) => c.status !== "NOT_APPLICABLE");
  const verified = applicable.filter((c) => c.status === "VERIFIED").length;
  const pending = applicable.filter((c) => c.status === "PENDING").length;
  const unavailable = applicable.filter((c) => c.status === "UNAVAILABLE").length;
  const conflicts = applicable.filter((c) => c.status === "CONFLICT_DETECTED").length;
  const notApplicable = claims.length - applicable.length;
  const completed = applicable.filter((c) => c.status !== "PENDING").length;
  const sources = new Set(applicable.map((c) => c.sourceLabel.trim().toLowerCase()).filter(Boolean));

  const materialPending = applicable.some((c) => c.material && c.status === "PENDING");
  const materialConflict = applicable.some((c) => c.material && c.status === "CONFLICT_DETECTED");

  let overall: OverallVerification;
  if (materialConflict || conflicts > 0) overall = "attention";
  else if (pending > 0 || verified !== applicable.length) overall = "in_progress";
  else overall = "verified";

  const pct = applicable.length ? Math.round((completed / applicable.length) * 100) : 0;

  const pendingMaterialNames = applicable
    .filter((c) => c.material && c.status === "PENDING")
    .map((c) => c.label);
  const conflictNames = applicable
    .filter((c) => c.status === "CONFLICT_DETECTED")
    .map((c) => c.label);

  let statusHeadline: string;
  let subcopy: string;
  const base = `We checked this vehicle's information across ${sources.size} data source${sources.size === 1 ? "" : "s"}. ${completed} of ${applicable.length} checks are complete.`;

  if (overall === "verified") {
    statusHeadline = "Checks complete";
    subcopy = `${base} All checks returned a result.`;
  } else if (overall === "attention") {
    statusHeadline = "Review needed";
    const names = conflictNames.length ? conflictNames.join(", ") : "One or more checks";
    subcopy = `${base} ${names} returned conflicting information — confirm with the dealer.`;
  } else {
    statusHeadline = "Verification in progress";
    const still = pendingMaterialNames.length
      ? `${pendingMaterialNames.join(" and ")} ${pendingMaterialNames.length === 1 ? "is" : "are"} still being confirmed.`
      : "Some checks are still being confirmed.";
    subcopy = `${base} ${still}`;
  }

  return {
    applicableChecks: applicable.length,
    completedChecks: completed,
    verified,
    pending,
    unavailable,
    conflicts,
    notApplicable,
    sourcesConsulted: sources.size,
    completenessPct: pct,
    materialPending,
    materialConflict,
    overall,
    statusHeadline,
    subcopy,
    lastRefreshedAt: latest(applicable.map((c) => c.checkedAt)),
  };
}
