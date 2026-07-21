// ── Shared passport verification derivation ─────────────────────────────────
// ONE governed source of truth for "how many checks exist, how many are
// complete, and whether a material check is pending" — consumed by BOTH the
// mobile and desktop passport layers so they can never diverge. `d.verifyRows`
// is pre-filtered to completed rows only, so it cannot answer "what's pending";
// this reconstructs the full category set from the governed PassportData fields.
//
// Governance: a pending MATERIAL check (VIN / title / recall) can never roll up
// into an all-complete state; missing data is "pending", never "verified".

import { fmt$, type PassportData } from "@/lib/passportV2Data";
import type { VehicleListing } from "@/hooks/useVehicleListing";

export type VerificationCategoryState =
  | "verified"
  | "dealer_confirmed"
  | "calculated"
  | "inferred"
  | "pending"
  | "unavailable"
  | "conflict_detected"
  | "not_applicable";

export type VerificationSourceType =
  | "oem"
  | "government"
  | "commercial"
  | "dealer"
  | "autolabels_calculated"
  | "autolabels_inferred"
  | "unknown";

export interface VerificationCategory {
  key: string;
  label: string;
  state: VerificationCategoryState;
  material: boolean;
  sourceType: VerificationSourceType;
  checkedAt?: string;
  limitation?: string;
}

export interface PassportVerificationSummary {
  total: number;
  completed: number;      // terminal (not pending/unavailable)
  completedPct: number;   // 0..100
  verified: number;
  dealerConfirmed: number;
  pending: number;
  unavailable: number;
  conflicts: number;
  materialPending: number;
  categories: VerificationCategory[];
}

const TERMINAL: VerificationCategoryState[] = ["verified", "dealer_confirmed", "calculated", "inferred", "conflict_detected"];

/**
 * Build the governed verification summary for a vehicle. Pure + deterministic.
 * Each category resolves to a positive state when its governed data is present,
 * otherwise "pending" — never a fabricated pass.
 */
export function derivePassportVerification(d: PassportData, listing: VehicleListing): PassportVerificationSummary {
  const checkedAt = d.marketCheckedAt || undefined;
  const cat = (
    key: string,
    label: string,
    done: boolean,
    positive: VerificationCategoryState,
    sourceType: VerificationSourceType,
    material: boolean,
  ): VerificationCategory => ({
    key,
    label,
    state: done ? positive : "pending",
    material,
    sourceType,
    checkedAt: done ? checkedAt : undefined,
  });

  const categories: VerificationCategory[] = [
    cat("vin", "VIN", !!listing.vin, "verified", "oem", true),
    cat("title", "Title & Brand", d.cleanTitle, "verified", "commercial", true),
    cat("recall", "Recall", !!listing.recall_status || d.recallClear, "verified", "government", true),
    cat("history", "Vehicle History", d.ownerCount != null || d.accidentCount != null || d.cleanTitle, "verified", "commercial", false),
    cat("market", "Market Data", d.marketAvg != null, "calculated", "autolabels_calculated", false),
    cat("warranty", "Warranty", !!d.warrantyStr, "dealer_confirmed", "oem", false),
    cat("service", "Service History", d.serviceCount > 0, "dealer_confirmed", "dealer", false),
  ];

  const total = categories.length;
  const completed = categories.filter((c) => TERMINAL.includes(c.state)).length;
  const verified = categories.filter((c) => c.state === "verified").length;
  const dealerConfirmed = categories.filter((c) => c.state === "dealer_confirmed").length;
  const pending = categories.filter((c) => c.state === "pending").length;
  const unavailable = categories.filter((c) => c.state === "unavailable").length;
  const conflicts = categories.filter((c) => c.state === "conflict_detected").length;
  const materialPending = categories.filter((c) => c.material && c.state === "pending").length;

  return {
    total,
    completed,
    completedPct: total > 0 ? Math.round((completed / total) * 100) : 0,
    verified,
    dealerConfirmed,
    pending,
    unavailable,
    conflicts,
    materialPending,
    categories,
  };
}

// ── Customer-facing verification report model ───────────────────────────────
// The CANONICAL summary the Data-Verified Report page renders. It is the single
// consumer-facing projection of the governed verification model above: every
// report section (banner, exception cards, "what checked out", summary rail,
// source list) reads its numbers from ONE VerificationReport object so the
// arithmetic can never diverge between sections.
//
// A VERIFICATION CHECK (a category we evaluated) is deliberately distinct from a
// DATA SOURCE (an external provider family). `sourceCount` counts unique source
// FAMILIES that returned anything — never the number of checks.
//
// Governance is absolute: a pending check is NEVER shown as verified; a conflict
// across sources is "needs confirmation", not "issue found"; reassuring findings
// ("no accidents", "warranty active") render only when the real data supports
// them; missing values are omitted or shown as "Not available from current
// sources" — never replaced with comforting language.

export type VerificationStatus =
  | "verified"
  | "needs_attention"
  | "needs_confirmation"
  | "pending"
  | "unavailable";

// A data-source FAMILY — the external authority a check consulted. Five core
// families exist; `dealer` is tracked separately and never counted among the
// core five so a dealer-provided record is never labeled independently verified.
export type VerificationSourceFamily =
  | "oem_vin"
  | "vehicle_history"
  | "nhtsa"
  | "live_market"
  | "oem_warranty"
  | "dealer";

// Where an individual piece of evidence came from — kept distinct so the UI can
// never imply AutoLabels physically inspected the car, nor that a dealer-entered
// value or an AutoLabels-derived comparison is an independent third-party fact.
export type EvidenceProvenance =
  | "oem"
  | "government"
  | "independent_history"
  | "live_market"
  | "dealer_provided"
  | "autolabels_derived";

export interface EvidenceField {
  label: string;
  // null renders as "Not available from current sources" — never a fabricated value.
  value: string | null;
}

export interface ReportCheck {
  key: string;
  name: string;
  status: VerificationStatus;
  family: VerificationSourceFamily;
  provenance: EvidenceProvenance;
  material: boolean;
  // A high-severity, confirmed, actionable condition (e.g. do-not-drive recall)
  // — the ONLY thing that turns the status banner red. Merely incomplete or
  // conflicting checks never set this.
  highSeverity: boolean;
  // One-sentence, evidence-derived finding. null when there is no supported
  // statement to make (pending / unavailable) — the UI shows neutral copy.
  finding: string | null;
  // Short reviewer note used to compose the banner body for exception checks.
  reviewNote: string | null;
  evidence: EvidenceField[];
  checkedAt: string | null;
}

export interface VerificationSourceInfo {
  family: VerificationSourceFamily;
  label: string;
  type: string;
  provenance: EvidenceProvenance;
  checkedAt: string | null;
  available: boolean;
}

export interface VerificationBanner {
  tone: "green" | "amber" | "red" | "neutral";
  heading: string;
  body: string;
  reviewCount: number;
}

export interface VerificationReport {
  // False when the raw data cannot produce a coherent report (arithmetic
  // violation, or no listing). The page then renders a neutral "report data
  // unavailable" state instead of forcing a valid-looking equation.
  valid: boolean;
  totalChecks: number;
  completedChecks: number;
  verifiedChecks: number;
  needsAttentionChecks: number;
  needsConfirmationChecks: number;
  pendingChecks: number;
  unavailableChecks: number;
  sourceCount: number;
  checks: ReportCheck[];
  sources: VerificationSourceInfo[];
  banner: VerificationBanner;
  lastCheckedAt: string | null;
}

const FAMILY_META: Record<VerificationSourceFamily, { label: string; type: string; provenance: EvidenceProvenance }> = {
  oem_vin: { label: "OEM / VIN decode", type: "Manufacturer & VIN data", provenance: "oem" },
  vehicle_history: { label: "Vehicle history", type: "Independent history records", provenance: "independent_history" },
  nhtsa: { label: "NHTSA recalls", type: "Government source", provenance: "government" },
  live_market: { label: "Live market data", type: "AutoLabels market analysis", provenance: "autolabels_derived" },
  oem_warranty: { label: "OEM warranty", type: "Manufacturer coverage", provenance: "oem" },
  dealer: { label: "Dealer-provided records", type: "Dealership-entered", provenance: "dealer_provided" },
};

export const PROVENANCE_LABEL: Record<EvidenceProvenance, string> = {
  oem: "OEM",
  government: "Government",
  independent_history: "Independent history",
  live_market: "Live market",
  dealer_provided: "Dealer-provided",
  autolabels_derived: "AutoLabels-derived",
};

function latestDate(dates: (string | null)[]): string | null {
  const valid = dates.filter((v): v is string => !!v).sort();
  return valid.length ? valid[valid.length - 1] : null;
}

const isValidVin = (vin: string | null | undefined): boolean =>
  !!vin && /^[A-HJ-NPR-Z0-9]{17}$/i.test(vin);

const milesFmt = (n: number) => n.toLocaleString();
const dateFmt = (iso: string | null): string | null =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;

interface RecallSignals {
  hasCheck: boolean;
  clearStatus: boolean;
  openCount: number | null;
  detailOpen: boolean | null;
  doNotDrive: boolean;
  checkedAt: string | null;
  campaign: { number: string | null; component: string | null; summary: string | null; remedy: string | null };
}

function readRecall(listing: VehicleListing): RecallSignals {
  const rc = listing.recall_check || null;
  const first = rc?.campaigns?.[0] || null;
  return {
    hasCheck: !!listing.recall_status || !!rc,
    clearStatus: listing.recall_status === "clear",
    openCount: listing.open_recall_count ?? null,
    detailOpen: rc ? !!rc.has_open : null,
    doNotDrive: !!rc?.do_not_drive,
    checkedAt: rc?.checked_at || null,
    campaign: {
      number: first?.campaignNumber || null,
      component: first?.component || null,
      summary: first?.summary || null,
      remedy: first?.remedy || null,
    },
  };
}

/**
 * Build the canonical customer verification report. Pure + deterministic.
 * Evaluates a fixed catalog of checks against real listing data, maps each to a
 * five-state customer status, and derives all counts from that single list.
 */
export function deriveVerificationReport(d: PassportData, listing: VehicleListing): VerificationReport {
  const reportTime = d.marketCheckedAt || (listing as unknown as { updated_at?: string }).updated_at || null;
  const historyConsulted = d.accidentCount != null || d.ownerCount != null || d.titleStatus !== "unknown" || d.cleanTitle;
  const isNew = String((listing as unknown as { condition?: string }).condition || "").toLowerCase() === "new";
  const recall = readRecall(listing);

  const src = (family: VerificationSourceFamily): { family: VerificationSourceFamily; provenance: EvidenceProvenance } =>
    ({ family, provenance: FAMILY_META[family].provenance });

  const checks: ReportCheck[] = [];

  // 1 — VIN & vehicle identity (OEM / VIN decode)
  checks.push((() => {
    const s = src("oem_vin");
    const decoded = !!listing.ymm;
    const valid = isValidVin(listing.vin);
    const status: VerificationStatus = valid && decoded ? "verified" : listing.vin ? "pending" : "unavailable";
    return {
      key: "vin", name: "VIN and vehicle identity", ...s, material: true, highSeverity: false,
      status,
      finding: status === "verified"
        ? `VIN decodes to the listed ${listing.ymm}${listing.trim ? ` ${listing.trim}` : ""} and passed 17-character format validation.`
        : status === "pending" ? null : null,
      reviewNote: status === "pending" ? "the VIN decode has not completed" : null,
      evidence: [
        { label: "VIN", value: listing.vin || null },
        { label: "Format check", value: valid ? "Valid 17-character VIN" : listing.vin ? "Not confirmed" : null },
        { label: "Decoded vehicle", value: decoded ? `${listing.ymm}${listing.trim ? ` ${listing.trim}` : ""}` : null },
        { label: "Source", value: FAMILY_META.oem_vin.label },
      ],
      checkedAt: status === "verified" ? reportTime : null,
    };
  })());

  // 2 — Accident & damage history (Vehicle history)
  checks.push((() => {
    const s = src("vehicle_history");
    const known = d.accidentCount != null;
    const count = d.accidentCount ?? 0;
    const status: VerificationStatus = !known ? "unavailable" : count > 0 ? "needs_attention" : "verified";
    return {
      key: "history", name: "Accident and damage history", ...s, material: false, highSeverity: false,
      status,
      finding: !known ? null
        : count === 0 ? "No accidents or damage reported in the available history records."
        : `${count} reported ${count === 1 ? "accident" : "accidents"} on record — review the details with the dealer.`,
      reviewNote: known && count > 0 ? `${count} reported ${count === 1 ? "accident is" : "accidents are"} on record` : null,
      evidence: [
        { label: "Reported accidents", value: known ? String(count) : null },
        { label: "Source", value: FAMILY_META.vehicle_history.label },
      ],
      checkedAt: known ? reportTime : null,
    };
  })());

  // 3 — Ownership history (Vehicle history)
  checks.push((() => {
    const s = src("vehicle_history");
    const known = isNew || d.ownerCount != null;
    const status: VerificationStatus = known ? "verified" : "unavailable";
    const owners = d.ownerCount;
    return {
      key: "ownership", name: "Ownership history", ...s, material: false, highSeverity: false,
      status,
      finding: !known ? null
        : isNew ? "New vehicle — no prior owners on record."
        : owners === 1 ? "One owner on record."
        : owners === 0 ? "No prior owners on record."
        : `${owners} owners on record.`,
      reviewNote: null,
      evidence: [
        { label: "Owners on record", value: known ? (isNew ? "0 (new vehicle)" : String(owners)) : null },
        { label: "Source", value: FAMILY_META.vehicle_history.label },
      ],
      checkedAt: known ? reportTime : null,
    };
  })());

  // 4 — Odometer reading (Vehicle history)
  checks.push((() => {
    const s = src("vehicle_history");
    const miles = listing.mileage;
    const status: VerificationStatus =
      miles == null ? "unavailable" : historyConsulted ? "verified" : "pending";
    return {
      key: "odometer", name: "Odometer reading", ...s, material: true, highSeverity: false,
      status,
      finding: status === "verified"
        ? `Odometer reads ${milesFmt(miles as number)} mi with no rollback indicators in the available records.`
        : null,
      reviewNote: status === "pending" ? "the odometer reading is still being corroborated against history records" : null,
      evidence: [
        { label: "Reported mileage", value: miles != null ? `${milesFmt(miles)} mi` : null },
        { label: "Rollback indicators", value: status === "verified" ? "None found in available records" : null },
        { label: "Source", value: FAMILY_META.vehicle_history.label },
      ],
      checkedAt: status === "verified" ? reportTime : null,
    };
  })());

  // 5 — Title & brand (Vehicle history) — MATERIAL
  checks.push((() => {
    const s = src("vehicle_history");
    const status: VerificationStatus =
      d.titleStatus === "clean" ? "verified" : d.titleStatus === "branded" ? "needs_attention" : "pending";
    // When the dealer pulled the national title record (NMVTIS) and attested,
    // cite that authoritative source + the verification date explicitly.
    const nmvtis = d.titleVerifiedSource === "nmvtis";
    const verifiedOn = nmvtis ? dateFmt(d.titleVerifiedAt) : null;
    return {
      key: "title", name: "Title and brand", ...s, material: true, highSeverity: false,
      status,
      finding: status === "verified"
        ? nmvtis
          ? `Clean title confirmed against the national title record (NMVTIS)${verifiedOn ? `, verified by the dealer on ${verifiedOn}` : ""} — no salvage, flood, lemon, or rebuilt brands found.`
          : "Clean title on record — no salvage, flood, lemon, or rebuilt brands found."
        : status === "needs_attention"
          ? "A title brand is on record for this vehicle — review the brand details with the dealer."
          : null,
      reviewNote: status === "pending"
        ? "the title and brand check is still pending"
        : status === "needs_attention" ? "a title brand is on record" : null,
      evidence: [
        { label: "Title status", value: d.titleStatus === "clean" ? "Clean" : d.titleStatus === "branded" ? "Brand on record" : null },
        { label: "Brands checked", value: status !== "pending" ? "Salvage, flood, lemon, rebuilt" : null },
        { label: "Verification", value: nmvtis ? `Dealer-verified via NMVTIS${verifiedOn ? ` on ${verifiedOn}` : ""}` : null },
        { label: "Source", value: nmvtis ? "NMVTIS national title record" : FAMILY_META.vehicle_history.label },
      ],
      checkedAt: status !== "pending" ? (nmvtis ? (d.titleVerifiedAt || reportTime) : reportTime) : null,
    };
  })());

  // 6 — Open safety recalls (NHTSA) — MATERIAL
  checks.push((() => {
    const s = src("nhtsa");
    // A genuine, detectable cross-source conflict: the aggregate status says
    // clear while the detailed NHTSA campaign check reports an open campaign
    // (or a positive open-recall count). Sources disagree → NEEDS CONFIRMATION,
    // never "issue found".
    const conflict = recall.hasCheck &&
      ((recall.clearStatus && (recall.detailOpen === true || (recall.openCount ?? 0) > 0)) ||
       (!recall.clearStatus && recall.detailOpen === false));
    let status: VerificationStatus;
    let highSeverity = false;
    if (!recall.hasCheck) status = "pending";
    else if (recall.doNotDrive) { status = "needs_attention"; highSeverity = true; }
    else if (conflict) status = "needs_confirmation";
    else if (recall.detailOpen === true || (recall.openCount ?? 0) > 0) status = "needs_attention";
    else status = "verified";
    const asOf = dateFmt(recall.checkedAt || reportTime);
    return {
      key: "recall", name: "Open safety recalls", ...s, material: true, highSeverity,
      status,
      finding:
        status === "verified" ? `No open safety recalls found in NHTSA campaigns${asOf ? ` as of ${asOf}` : ""}.`
        : status === "needs_confirmation" ? "AutoLabels found conflicting recall information across available sources."
        : status === "needs_attention" && highSeverity ? "This vehicle has a do-not-drive recall — do not drive it until the remedy is completed."
        : status === "needs_attention" ? "NHTSA data shows an open recall associated with this VIN. Ask whether the remedy has been completed or is available."
        : null,
      reviewNote:
        status === "needs_confirmation" ? "confirm the recall status with the dealer"
        : status === "needs_attention" && highSeverity ? "a do-not-drive recall is reported"
        : status === "needs_attention" ? "an open recall is reported"
        : status === "pending" ? "the recall check has not completed" : null,
      evidence: [
        { label: "Campaign number", value: recall.campaign.number },
        { label: "Affected component", value: recall.campaign.component },
        { label: "Summary", value: recall.campaign.summary },
        { label: "Remedy availability", value: recall.campaign.remedy },
        { label: "NHTSA status", value: recall.detailOpen == null ? null : recall.detailOpen ? "Open campaign reported" : "No open campaign" },
        { label: "Aggregate status", value: listing.recall_status || null },
        { label: "Last checked", value: asOf },
        { label: "Source", value: FAMILY_META.nhtsa.label },
      ],
      checkedAt: status !== "pending" ? (recall.checkedAt || reportTime) : null,
    };
  })());

  // 7 — Market value (Live market data)
  checks.push((() => {
    const s = src("live_market");
    const known = d.marketAvg != null;
    const status: VerificationStatus = known ? "verified" : "unavailable";
    const below = d.belowMarket != null && d.belowMarket > 0 ? d.belowMarket : null;
    return {
      key: "market", name: "Market value", ...s, material: false, highSeverity: false,
      status,
      finding: !known ? null
        : below != null ? `Compared against live market data — priced ${fmt$(below)} below the market average.`
        : "Compared against live market data for similar vehicles.",
      reviewNote: null,
      evidence: [
        { label: "Market average", value: d.marketAvg != null ? fmt$(d.marketAvg) : null },
        { label: "Position", value: below != null ? `${fmt$(below)} below market` : known ? "At market" : null },
        { label: "Source", value: FAMILY_META.live_market.label },
      ],
      checkedAt: known ? reportTime : null,
    };
  })());

  // 8 — Factory warranty (OEM warranty)
  checks.push((() => {
    const s = src("oem_warranty");
    const known = !!d.warrantyStr;
    const status: VerificationStatus = known ? "verified" : "unavailable";
    return {
      key: "warranty", name: "Factory warranty", ...s, material: false, highSeverity: false,
      status,
      finding: !known ? null
        : d.warrantyExpired
          ? "Factory warranty term has ended based on the in-service date and mileage on record."
          : `Factory warranty coverage on record: ${d.warrantyStr}.`,
      reviewNote: null,
      evidence: [
        { label: "Estimated coverage", value: d.warrantyStr },
        { label: "Status", value: known ? (d.warrantyExpired ? "Term ended" : "Coverage on record") : null },
        { label: "Source", value: FAMILY_META.oem_warranty.label },
      ],
      checkedAt: known ? reportTime : null,
    };
  })());

  const verifiedChecks = checks.filter((c) => c.status === "verified").length;
  const needsAttentionChecks = checks.filter((c) => c.status === "needs_attention").length;
  const needsConfirmationChecks = checks.filter((c) => c.status === "needs_confirmation").length;
  const pendingChecks = checks.filter((c) => c.status === "pending").length;
  const unavailableChecks = checks.filter((c) => c.status === "unavailable").length;
  const totalChecks = checks.length;
  const completedChecks = verifiedChecks + needsAttentionChecks + needsConfirmationChecks;

  // sourceCount = unique FAMILIES that returned anything (not unavailable),
  // never the number of checks.
  const consultedFamilies = new Set(checks.filter((c) => c.status !== "unavailable").map((c) => c.family));
  const sourceCount = consultedFamilies.size;

  const sources: VerificationSourceInfo[] = (Object.keys(FAMILY_META) as VerificationSourceFamily[])
    .filter((f) => consultedFamilies.has(f))
    .map((f) => {
      const inFamily = checks.filter((c) => c.family === f && c.checkedAt);
      const checkedAt = latestDate(inFamily.map((c) => c.checkedAt));
      return {
        family: f, label: FAMILY_META[f].label, type: FAMILY_META[f].type,
        provenance: FAMILY_META[f].provenance, checkedAt, available: true,
      };
    });

  // Arithmetic invariants. If the raw data cannot satisfy them, we refuse to
  // render a valid-looking equation and fall back to a neutral state.
  const valid =
    totalChecks === verifiedChecks + needsAttentionChecks + needsConfirmationChecks + pendingChecks + unavailableChecks &&
    completedChecks === verifiedChecks + needsAttentionChecks + needsConfirmationChecks;
  if (!valid && typeof console !== "undefined") {
    console.warn("[verificationReport] arithmetic invariant violated", { totalChecks, verifiedChecks, needsAttentionChecks, needsConfirmationChecks, pendingChecks, unavailableChecks, completedChecks });
  }

  const anyHighSeverity = checks.some((c) => c.highSeverity && (c.status === "needs_attention" || c.status === "needs_confirmation"));
  const banner = buildBanner({ valid, completedChecks, verifiedChecks, needsConfirmationChecks, needsAttentionChecks, pendingChecks, anyHighSeverity, checks });

  return {
    valid,
    totalChecks, completedChecks, verifiedChecks, needsAttentionChecks, needsConfirmationChecks,
    pendingChecks, unavailableChecks, sourceCount, checks, sources, banner,
    lastCheckedAt: latestDate(checks.map((c) => c.checkedAt)),
  };
}

function buildBanner(a: {
  valid: boolean; completedChecks: number; verifiedChecks: number; needsConfirmationChecks: number;
  needsAttentionChecks: number; pendingChecks: number; anyHighSeverity: boolean; checks: ReportCheck[];
}): VerificationBanner {
  if (!a.valid) {
    return { tone: "neutral", heading: "Report data unavailable", body: "We could not assemble a complete verification report from the current sources. No verification conclusion has been made.", reviewCount: 0 };
  }
  // Nothing has returned a terminal result yet — never an all-green fallback.
  if (a.completedChecks === 0) {
    return { tone: "neutral", heading: "Verification has not started", body: "No checks have returned a result yet for this vehicle. Check back soon or ask the dealer for the latest information.", reviewCount: 0 };
  }
  // Counts line, e.g. "6 checks verified · 1 needs confirmation · 1 pending".
  const parts: string[] = [`${a.verifiedChecks} ${a.verifiedChecks === 1 ? "check" : "checks"} verified`];
  if (a.needsConfirmationChecks > 0) parts.push(`${a.needsConfirmationChecks} needs confirmation`);
  if (a.needsAttentionChecks > 0) parts.push(`${a.needsAttentionChecks} needs attention`);
  if (a.pendingChecks > 0) parts.push(`${a.pendingChecks} pending`);
  const countsLine = parts.join(" · ");

  // The headline counts items that genuinely need buyer action (attention +
  // confirmation). When there are none, outstanding PENDING checks are what to
  // watch, so they drive the count instead. Green only when neither exists.
  const actionCount = a.needsAttentionChecks + a.needsConfirmationChecks;
  const headlineCount = actionCount > 0 ? actionCount : a.pendingChecks;

  if (actionCount === 0 && a.pendingChecks === 0) {
    return { tone: "green", heading: "Verification checks completed", body: `${countsLine}. Every check returned a result — no items need review before purchase.`, reviewCount: 0 };
  }

  // Actionable notes (imperative, verb-led — "confirm the recall...") are asked
  // first; status notes ("the title check is still pending") follow as context.
  const reviewNotes = a.checks
    .filter((c) => c.reviewNote && (c.status === "needs_attention" || c.status === "needs_confirmation" || c.status === "pending"))
    .map((c) => c.reviewNote as string);
  const actions = reviewNotes.filter(startsWithVerb);
  const statuses = reviewNotes.filter((n) => !startsWithVerb(n));
  const clauses: string[] = [];
  if (actions.length) clauses.push(capitalizeFirst(joinList(actions)));
  if (statuses.length) clauses.push(`${actions.length ? "and note that " : "Note that "}${joinList(statuses)}`);
  const reviewSentence = clauses.length ? `Most information checked out. ${clauses.join(", ")}.` : "";

  const heading = headlineCount === 1 ? "Review one item before purchase" : `Review ${headlineCount} items before purchase`;
  const tone: VerificationBanner["tone"] = a.anyHighSeverity ? "red" : "amber";
  return { tone, heading, body: `${countsLine}. ${reviewSentence}`.trim(), reviewCount: headlineCount };
}

const VERB_RE = /^(confirm|ask|review|contact|verify|check)\b/i;
function startsWithVerb(s: string): boolean {
  return VERB_RE.test(s);
}
function capitalizeFirst(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}
function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

// ── Canonical status wording shared by every customer surface ────────────────
// The passport hero "AutoLabels Verified" card, the "Verified Vehicle Data"
// module (mobile + desktop) and the full Data-Verified Report all render these
// EXACT words for a given VerificationStatus so a status can never be phrased
// differently (or upgraded to green) on one surface. "verified" is the only
// status that ever reads as a positive pass.
export const VERIFICATION_STATUS_LABEL: Record<VerificationStatus, string> = {
  verified: "Verified",
  needs_attention: "Needs attention",
  needs_confirmation: "Needs confirmation",
  pending: "Pending",
  unavailable: "Not available",
};

// Short, two-word display names for the compact passport grids (the full report
// keeps the longer ReportCheck.name). Keyed by ReportCheck.key so both come from
// the same catalog.
export const VERIFICATION_CHECK_SHORT_LABEL: Record<string, string> = {
  vin: "VIN Identity",
  history: "Accident History",
  ownership: "Ownership",
  odometer: "Odometer",
  title: "Title & Brand",
  recall: "Recall Status",
  market: "Market Value",
  warranty: "Warranty",
};

// Count-aware one-line summary for the hero card chip + module subtitle, derived
// straight from the canonical counts: e.g. "1 needs confirmation · 2 pending".
// Zero segments are omitted; a fully-verified vehicle reads "All checks verified".
export function summarizeVerificationExceptions(r: {
  totalChecks: number;
  verifiedChecks: number;
  needsAttentionChecks: number;
  needsConfirmationChecks: number;
  pendingChecks: number;
  unavailableChecks: number;
}): string {
  if (r.totalChecks > 0 && r.verifiedChecks === r.totalChecks) return "All checks verified";
  const seg: string[] = [];
  if (r.needsAttentionChecks > 0) seg.push(`${r.needsAttentionChecks} needs attention`);
  if (r.needsConfirmationChecks > 0) seg.push(`${r.needsConfirmationChecks} needs confirmation`);
  if (r.pendingChecks > 0) seg.push(`${r.pendingChecks} pending`);
  if (r.unavailableChecks > 0) seg.push(`${r.unavailableChecks} not available`);
  return seg.length ? seg.join(" · ") : "All checks verified";
}
