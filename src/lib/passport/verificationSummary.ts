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
import { deriveRecallView, type RecallView } from "@/lib/vehicleTruth/recallView";

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
  const recall = d.recall ?? deriveRecallView(listing);
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
    // A MODEL-level NHTSA answer can never complete this check. With no
    // VIN-level result the category stays pending — the state this summary
    // already refuses to roll up into an all-complete badge.
    cat("recall", "Recall", recall.vin.checkComplete, "verified", "government", true),
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
  /**
   * A named dealer has staked their own claim on this, and no source contradicts
   * it. Deliberately NOT "verified": a franchise store that never retails
   * branded titles is stating a policy about its lot, not evidence about this
   * VIN. Presenting the two identically would make AutoLabels the author of a
   * per-VIN title claim it never checked — and title branding is a legally
   * disclosable fact. The dealer's name carries it, which is where the claim is
   * both defensible and correctly placed.
   *
   * Attestation only ever fills the ABSENCE of data. Any reported brand wins.
   */
  | "dealer_attested"
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
  /**
   * Recall check only: WHICH recall answer this is. Status alone cannot carry
   * it — a model-level campaign and a VIN-confirmed open campaign both warn
   * (needs_attention), and "unavailable" and "never checked" both stay
   * pending. Every heading and next step about a recall is worded from this,
   * so an unavailable lookup can never be phrased as an open recall (L01).
   */
  recallOutcome?: RecallOutcome;
}

/**
 * The exact recall answer behind the customer-facing recall check (L01).
 *   do_not_drive   do-not-drive language on record (any scope)
 *   conflict       one store reports clear while another reports a campaign
 *   vin_open       a VIN-level source reports an open campaign on THIS VIN
 *   model_context  a campaign is on record for the model line (or an unscoped
 *                  count) but no VIN-level source has confirmed this VIN
 *   vin_clear      a VIN-level source answered clear (vin.clearClaimAllowed)
 *   stale          a VIN-level answer exists but is out of date
 *   unavailable    a lookup was attempted and returned no usable VIN answer
 *   not_checked    no recall lookup is on record at any scope
 */
export type RecallOutcome =
  | "do_not_drive"
  | "conflict"
  | "vin_open"
  | "model_context"
  | "vin_clear"
  | "stale"
  | "unavailable"
  | "not_checked";

export function recallOutcomeOf(v: RecallView): RecallOutcome {
  if (v.doNotDrive) return "do_not_drive";
  if (v.conflict) return "conflict";
  if (v.vin.state === "OPEN") return "vin_open";
  if (v.riskSignalled) return "model_context";
  if (v.vin.clearClaimAllowed) return "vin_clear";
  if (v.vin.state === "STALE") return "stale";
  if (v.vin.attemptedAt || v.vin.source || v.model) return "unavailable";
  return "not_checked";
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
  /** Positive, but the dealer is the author. Counted apart from verifiedChecks
   *  so a shopper is never told N sources checked when one of them was us. */
  dealerAttestedChecks: number;
  needsAttentionChecks: number;
  needsConfirmationChecks: number;
  pendingChecks: number;
  unavailableChecks: number;
  /**
   * INDEPENDENT source families that returned anything. The dealer's own
   * records are never counted here (L02) — see `dealerSourceUsed`.
   */
  sourceCount: number;
  /** True when at least one check rests on the dealer's own statement. */
  dealerSourceUsed: boolean;
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

type DecodeBag = { mc_attributes?: Record<string, unknown> | null; key_specs?: Record<string, unknown> | null };

/** Which decode returned data for this VIN, or null when none has. */
export function vinDecodeEvidence(listing: VehicleListing): string | null {
  const l = listing as unknown as DecodeBag;
  const mc = (l.mc_attributes ?? {}) as Record<string, unknown>;
  if (typeof mc.specs_decoded_at === "string" && mc.specs_decoded_at) return `VIN decode (${String(mc.specs_source || "provider")})`;
  if (mc.build_sheet && typeof mc.build_sheet === "object") return "VIN build sheet";
  if (typeof mc.make === "string" && mc.make && typeof mc.model === "string" && mc.model) return "Provider VIN record";
  if (l.key_specs && typeof l.key_specs === "object" && Object.keys(l.key_specs).length > 0) return "Decoded specifications";
  return null;
}

/** The decode was tried the full number of times and returned nothing. */
function vinDecodeExhausted(listing: VehicleListing): boolean {
  const mc = ((listing as unknown as DecodeBag).mc_attributes ?? {}) as Record<string, unknown>;
  return Number(mc.specs_attempts) >= 3;
}

const isValidVin = (vin: string | null | undefined): boolean =>
  !!vin && /^[A-HJ-NPR-Z0-9]{17}$/i.test(vin);

const milesFmt = (n: number) => n.toLocaleString();
const dateFmt = (iso: string | null): string | null =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : null;

interface RecallSignals {
  view: RecallView;
  campaign: { number: string | null; component: string | null; summary: string | null; remedy: string | null };
}

function readRecall(listing: VehicleListing): RecallSignals {
  // deriveRecallView tolerates every writer's field names, so a
  // MarketCheck-sourced campaign (nhtsaCampaignNumber / title / description)
  // renders the same detail as an NHTSA or manual one.
  const view = deriveRecallView(listing);
  const first = view.campaigns[0] || null;
  return {
    view,
    campaign: {
      number: first?.number ?? null,
      component: first?.component ?? null,
      summary: first?.summary ?? null,
      remedy: first?.remedy ?? null,
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
    // "Decoded" means a VIN decode actually returned data for this VIN. A
    // year/make/model typed into the dealer feed is not a decode, so on its
    // own it no longer verifies the identity check.
    const decodedFrom = vinDecodeEvidence(listing);
    const decoded = decodedFrom != null && !!listing.ymm;
    const valid = isValidVin(listing.vin);
    const status: VerificationStatus = valid && decoded ? "verified"
      : !listing.vin ? "unavailable"
      : valid && vinDecodeExhausted(listing) ? "unavailable"
      : "pending";
    return {
      key: "vin", name: "VIN and vehicle identity", ...s, material: true, highSeverity: false,
      status,
      finding: status === "verified"
        ? `VIN decodes to the listed ${listing.ymm}${listing.trim ? ` ${listing.trim}` : ""} and passed 17-character format validation.`
        : status === "pending" ? null : null,
      reviewNote: null,
      evidence: [
        { label: "VIN", value: listing.vin || null },
        { label: "Format check", value: valid ? "Valid 17-character VIN" : listing.vin ? "Not confirmed" : null },
        { label: "Decoded vehicle", value: decoded ? `${listing.ymm}${listing.trim ? ` ${listing.trim}` : ""}` : null },
        { label: "Decode result", value: decoded ? decodedFrom : status === "unavailable" && listing.vin ? "The VIN decode returned no data" : null },
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
    // Without any history record there is nothing to corroborate the reading
    // against and no lookup in flight, so the check is unavailable, not
    // pending: "pending" is reserved for a result that is still expected.
    const status: VerificationStatus =
      miles == null || !historyConsulted ? "unavailable" : "verified";
    return {
      key: "odometer", name: "Odometer reading", ...s, material: true, highSeverity: false,
      status,
      finding: status === "verified"
        ? `Odometer reads ${milesFmt(miles as number)} mi with no rollback indicators in the available records.`
        : null,
      reviewNote: null,
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
    // Order is the whole safeguard. A reported brand is evaluated FIRST, so a
    // dealer policy can never bury one: attestation only ever answers a
    // question no source answered.
    const status: VerificationStatus =
      d.titleStatus === "branded" ? "needs_attention"
        : d.titleStatus === "clean" ? "verified"
        : d.titlePolicyAttested ? "dealer_attested"
        : "pending";
    // When the dealer pulled the national title record (NMVTIS) and attested,
    // cite that authoritative source + the verification date explicitly.
    const nmvtis = d.titleVerifiedSource === "nmvtis";
    const verifiedOn = nmvtis ? dateFmt(d.titleVerifiedAt) : null;
    return {
      key: "title", name: "Title and brand", ...s,
      // A dealer statement is the dealer's record, not independent history:
      // it is filed under the dealer family so it is never counted among the
      // independent sources or listed under "Independent history" (L02).
      ...(status === "dealer_attested" ? src("dealer") : {}),
      material: true, highSeverity: false,
      status,
      finding: status === "verified"
        // Describe the DATA RESULT, not a guarantee — "no brands reported" is
        // accurate; "clean/guaranteed" over-claims (NMVTIS usage guidance).
        ? nmvtis
          ? `No title brands were reported in the NMVTIS title data${verifiedOn ? ` returned on ${verifiedOn}` : ""} — no salvage, flood, lemon, or rebuilt records found. Reviewed by the dealer.`
          : "Clean title on record — no salvage, flood, lemon, or rebuilt brands found."
        : status === "needs_attention"
          ? "A title brand is on record for this vehicle — review the brand details with the dealer."
        : status === "dealer_attested"
          // Says exactly what it is and what it is not, and names the author.
          ? `${d.titlePolicyAttestedBy ?? "This dealer"} states they do not retail branded-title vehicles, and no source has reported a brand on this VIN. This is the dealer's own statement, not an independent title-record check.`
          : null,
      reviewNote: status === "pending"
        ? "the title and brand check is still pending"
        : status === "needs_attention" ? "a title brand is on record" : null,
      evidence: [
        { label: "Title status", value: d.titleStatus === "clean" ? "Clean" : d.titleStatus === "branded" ? "Brand on record" : null },
        { label: "Brands checked", value: status !== "pending" ? "Salvage, flood, lemon, rebuilt" : null },
        { label: "Verification", value: nmvtis ? `Dealer-verified via NMVTIS${verifiedOn ? ` on ${verifiedOn}` : ""}` : status === "dealer_attested" ? "Dealer statement — no title record was pulled for this VIN" : null },
        { label: "Source", value: status === "dealer_attested" ? (d.titlePolicyAttestedBy ?? "The selling dealer") : nmvtis ? "NMVTIS national title record" : FAMILY_META.vehicle_history.label },
        // Required NMVTIS caveat — disclosed wherever the NMVTIS-derived result appears.
        { label: "Note", value: nmvtis ? "NMVTIS title data may be incomplete; state participation and reporting timeframes vary. Not a substitute for an independent inspection." : null },
      ],
      checkedAt: status !== "pending" ? (nmvtis ? (d.titleVerifiedAt || reportTime) : reportTime) : null,
    };
  })());

  // 6 — Open safety recalls (NHTSA) — MATERIAL
  checks.push((() => {
    const s = src("nhtsa");
    // Two scopes, never one. NHTSA answers for a year/make/model; only a
    // VIN-level source can verify THIS car. So "verified" requires
    // `vin.clearClaimAllowed`, and a model-level zero — including NHTSA's
    // legitimate NO_MODEL_CAMPAIGNS_FOUND — leaves the check pending with the
    // model finding shown as the model-level context it is.
    const v = recall.view;
    const model = v.model;
    let status: VerificationStatus;
    let highSeverity = false;
    if (v.doNotDrive) { status = "needs_attention"; highSeverity = true; }
    else if (v.conflict) status = "needs_confirmation";
    else if (v.riskSignalled) status = "needs_attention";
    else if (v.vin.clearClaimAllowed) status = "verified";
    // A VIN lookup that ran and returned nothing usable is unavailable. Only a
    // lookup that has not run yet, or a result that has gone stale and is due
    // a refresh, is pending. Neither is ever "no recalls".
    else if (recallOutcomeOf(v) === "unavailable" && v.vin.source != null) status = "unavailable";
    else status = "pending";
    const outcome = recallOutcomeOf(v);
    const asOf = dateFmt(v.vin.checkedAt ?? model?.checkedAt ?? null);
    const modelContext = model
      ? `${model.label} — ${model.detail}`
      : "No recall lookup has returned a result for this vehicle.";
    return {
      key: "recall", name: "Open safety recalls", ...s, material: true, highSeverity,
      status,
      finding:
        status === "verified" ? `No open safety recalls were returned for this VIN${asOf ? ` as of ${asOf}` : ""}.`
        : status === "needs_confirmation" ? "AutoLabels found conflicting recall information across available sources."
        : status === "needs_attention" && highSeverity ? "This vehicle has a do-not-drive recall — do not drive it until the remedy is completed."
        : outcome === "vin_open" ? `An open safety recall is reported for this VIN. ${modelContext} Ask the dealer whether the remedy has been completed or is available.`
        : status === "needs_attention" ? `Recall campaigns are on record for this model, but no source has confirmed whether this VIN is affected. ${modelContext}`
        : outcome === "stale" ? `The last VIN-level recall check is out of date, so it no longer confirms this VIN's status. ${modelContext}`
        : outcome === "not_checked" ? "No recall lookup has been run for this VIN yet."
        : `Recall verification is unavailable for this VIN. ${modelContext}`,
      reviewNote:
        status === "needs_confirmation" ? "confirm the recall status with the dealer"
        : status === "needs_attention" && highSeverity ? "a do-not-drive recall is reported"
        : outcome === "vin_open" ? "an open recall is reported for this VIN"
        : status === "needs_attention" ? "ask whether this VIN is part of the recall campaigns on its model"
        : status === "pending" ? "the VIN recall check has not returned a result yet" : null,
      evidence: [
        { label: "Campaign number", value: recall.campaign.number },
        { label: "Affected component", value: recall.campaign.component },
        { label: "Summary", value: recall.campaign.summary },
        { label: "Remedy availability", value: recall.campaign.remedy },
        { label: "VIN-level verification", value: v.vin.label },
        { label: "Model-level campaign context", value: model ? model.label : null },
        { label: "Open recalls on this VIN", value: v.vin.openCount == null ? null : String(v.vin.openCount) },
        { label: "Last checked", value: asOf },
        { label: "Source", value: v.vin.source ?? model?.source ?? FAMILY_META.nhtsa.label },
      ],
      checkedAt: status !== "pending" ? (v.vin.checkedAt ?? model?.checkedAt ?? reportTime) : null,
      recallOutcome: outcome,
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
  const dealerAttestedChecks = checks.filter((c) => c.status === "dealer_attested").length;
  const needsAttentionChecks = checks.filter((c) => c.status === "needs_attention").length;
  const needsConfirmationChecks = checks.filter((c) => c.status === "needs_confirmation").length;
  const pendingChecks = checks.filter((c) => c.status === "pending").length;
  const unavailableChecks = checks.filter((c) => c.status === "unavailable").length;
  const totalChecks = checks.length;
  const completedChecks = verifiedChecks + dealerAttestedChecks + needsAttentionChecks + needsConfirmationChecks;

  // sourceCount = unique INDEPENDENT families that returned anything (not
  // unavailable), never the number of checks. A pending check consulted
  // nothing, so it is not a source either. The dealer family is reported
  // separately — the dealer is not an independent source (L02).
  const consultedFamilies = new Set(
    checks.filter((c) => c.status !== "unavailable" && c.status !== "pending").map((c) => c.family),
  );
  const dealerSourceUsed = consultedFamilies.has("dealer");
  const sourceCount = [...consultedFamilies].filter((f) => f !== "dealer").length;

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
    totalChecks === verifiedChecks + dealerAttestedChecks + needsAttentionChecks + needsConfirmationChecks + pendingChecks + unavailableChecks &&
    completedChecks === verifiedChecks + dealerAttestedChecks + needsAttentionChecks + needsConfirmationChecks;
  if (!valid && typeof console !== "undefined") {
    console.warn("[verificationReport] arithmetic invariant violated", { totalChecks, verifiedChecks, dealerAttestedChecks, needsAttentionChecks, needsConfirmationChecks, pendingChecks, unavailableChecks, completedChecks });
  }

  const anyHighSeverity = checks.some((c) => c.highSeverity && (c.status === "needs_attention" || c.status === "needs_confirmation"));
  const banner = buildBanner({ valid, completedChecks, verifiedChecks, dealerAttestedChecks, needsConfirmationChecks, needsAttentionChecks, pendingChecks, unavailableChecks, anyHighSeverity, checks });

  return {
    valid,
    totalChecks, completedChecks, verifiedChecks, dealerAttestedChecks, needsAttentionChecks, needsConfirmationChecks,
    pendingChecks, unavailableChecks, sourceCount, dealerSourceUsed, checks, sources, banner,
    lastCheckedAt: latestDate(checks.map((c) => c.checkedAt)),
  };
}

function buildBanner(a: {
  valid: boolean; completedChecks: number; verifiedChecks: number; dealerAttestedChecks: number; needsConfirmationChecks: number;
  needsAttentionChecks: number; pendingChecks: number; unavailableChecks: number; anyHighSeverity: boolean; checks: ReportCheck[];
}): VerificationBanner {
  if (!a.valid) {
    return { tone: "neutral", heading: "Report data unavailable", body: "We could not assemble a complete verification report from the current sources. No verification conclusion has been made.", reviewCount: 0 };
  }
  // Nothing has returned a terminal result yet — never an all-green fallback.
  if (a.completedChecks === 0) {
    return { tone: "neutral", heading: "Verification has not started", body: "No checks have returned a result yet for this vehicle. Check back soon or ask the dealer for the latest information.", reviewCount: 0 };
  }
  // Counts line, e.g. "3 checks verified · 1 dealer attested · 1 pending ·
  // 3 not available" — every non-zero status, so the line always adds up to
  // the total (L02).
  const parts: string[] = [`${a.verifiedChecks} ${a.verifiedChecks === 1 ? "check" : "checks"} verified`];
  if (a.dealerAttestedChecks > 0) parts.push(`${a.dealerAttestedChecks} dealer attested`);
  if (a.needsConfirmationChecks > 0) parts.push(`${a.needsConfirmationChecks} needs confirmation`);
  if (a.needsAttentionChecks > 0) parts.push(`${a.needsAttentionChecks} needs attention`);
  if (a.pendingChecks > 0) parts.push(`${a.pendingChecks} pending`);
  if (a.unavailableChecks > 0) parts.push(`${a.unavailableChecks} not available`);
  const countsLine = parts.join(" · ");

  // The headline counts ONLY items that ask something of the buyer (attention
  // + confirmation). Pending and unavailable checks are reported as what they
  // are, never folded into a "review" count, and nothing reads green unless
  // every check in scope returned an independent or attested result.
  const actionCount = a.needsAttentionChecks + a.needsConfirmationChecks;
  const settled = a.verifiedChecks + a.dealerAttestedChecks;
  const total = settled + actionCount + a.pendingChecks + a.unavailableChecks;
  const progress = `${a.verifiedChecks} of ${total} ${total === 1 ? "check" : "checks"} verified`;

  if (actionCount === 0) {
    if (a.pendingChecks === 0 && a.unavailableChecks === 0) {
      return {
        tone: "green",
        heading: "Verification checks completed",
        body: `${countsLine}. Every check returned a result, and none needs review before purchase.`,
        reviewCount: 0,
      };
    }
    const which = a.pendingChecks > 0 && a.unavailableChecks > 0 ? "pending or not available"
      : a.pendingChecks > 0 ? "pending" : "not available";
    return {
      tone: "neutral",
      heading: progress,
      body: `${countsLine}. No source reported a problem. Checks marked ${which} have no result and are not counted as verified.`,
      reviewCount: 0,
    };
  }

  // Actionable notes (imperative, verb-led — "confirm the recall...") are asked
  // first; status notes ("a title brand is on record") follow as context.
  const reviewNotes = a.checks
    .filter((c) => c.reviewNote && (c.status === "needs_attention" || c.status === "needs_confirmation"))
    .map((c) => c.reviewNote as string);
  const actions = reviewNotes.filter(startsWithVerb);
  const statuses = reviewNotes.filter((n) => !startsWithVerb(n));
  const clauses: string[] = [];
  if (actions.length) clauses.push(capitalizeFirst(joinList(actions)));
  if (statuses.length) clauses.push(`${actions.length ? "and note that " : "Note that "}${joinList(statuses)}`);
  const reviewSentence = clauses.length ? `${clauses.join(", ")}.` : "";

  const heading = actionCount === 1 ? "Review one item before purchase" : `Review ${actionCount} items before purchase`;
  const tone: VerificationBanner["tone"] = a.anyHighSeverity ? "red" : "amber";
  return { tone, heading, body: `${countsLine}. ${reviewSentence}`.trim(), reviewCount: actionCount };
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
// status that ever reads as an INDEPENDENTLY sourced pass; "dealer_attested"
// reads as a positive too, but it names the dealer so a shopper can tell who is
// standing behind it.
// A check that reads as SETTLED — nothing is asked of the shopper. Verified is
// an independent source; dealer_attested is the dealer's own statement. Neither
// belongs in a "needs review" bucket, so every surface asks this question here
// rather than testing `status === "verified"` on its own.
export const isSettledCheck = (s: VerificationStatus): boolean =>
  s === "verified" || s === "dealer_attested";

export const VERIFICATION_STATUS_LABEL: Record<VerificationStatus, string> = {

  verified: "Verified",
  dealer_attested: "Dealer attested",
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
  dealerAttestedChecks?: number;
  needsAttentionChecks: number;
  needsConfirmationChecks: number;
  pendingChecks: number;
  unavailableChecks: number;
}): string {
  if (r.totalChecks > 0 && r.verifiedChecks === r.totalChecks) return "All checks verified";
  const seg: string[] = [];
  if ((r.dealerAttestedChecks ?? 0) > 0) seg.push(`${r.dealerAttestedChecks} dealer attested`);
  if (r.needsAttentionChecks > 0) seg.push(`${r.needsAttentionChecks} needs attention`);
  if (r.needsConfirmationChecks > 0) seg.push(`${r.needsConfirmationChecks} needs confirmation`);
  if (r.pendingChecks > 0) seg.push(`${r.pendingChecks} pending`);
  if (r.unavailableChecks > 0) seg.push(`${r.unavailableChecks} not available`);
  return seg.length ? seg.join(" · ") : "All checks verified";
}

// ── One status inventory for every summary surface (L02) ────────────────────
// The hero card, the module subtitle, the report rail and the mobile tiles all
// read these, so a dealer statement can never be counted as "verified" on one
// surface and as "dealer attested" on another, and every surface adds up to
// the same total.

export interface StatusCount { status: VerificationStatus; count: number; label: string }

const SEGMENT_ORDER: VerificationStatus[] = ["verified", "dealer_attested", "needs_attention", "needs_confirmation", "pending", "unavailable"];

export function verificationStatusCounts(r: VerificationReport): StatusCount[] {
  const n: Record<VerificationStatus, number> = {
    verified: r.verifiedChecks,
    dealer_attested: r.dealerAttestedChecks ?? 0,
    needs_attention: r.needsAttentionChecks,
    needs_confirmation: r.needsConfirmationChecks,
    pending: r.pendingChecks,
    unavailable: r.unavailableChecks,
  };
  return SEGMENT_ORDER.map((status) => ({ status, count: n[status], label: VERIFICATION_STATUS_LABEL[status] })).filter((s) => s.count > 0);
}

/** "3 verified · 1 dealer attested · 1 pending · 3 not available". */
export function verificationCountsLine(r: VerificationReport): string {
  return verificationStatusCounts(r)
    .map((s) => `${s.count} ${s.status === "unavailable" ? "not available" : s.label.toLowerCase()}`)
    .join(" · ");
}

/**
 * The hero subtitle, e.g. "4 of 8 checks verified". Never "8 checks
 * completed": only independently verified checks are counted here.
 */
export function verificationScopeLine(r: VerificationReport): string {
  const total = r.totalChecks;
  return `${r.verifiedChecks} of ${total} ${total === 1 ? "check" : "checks"} verified`;
}

/**
 * Versioned identity of a report: the same VIN, the same source snapshot and
 * the same report version always produce the same statuses and counts. Shown
 * on the report and the printed PDF so two copies can be compared.
 */
export const VERIFICATION_REPORT_VERSION = "2026-11-07.1";

export function verificationSnapshotKey(r: VerificationReport, vin: string | null | undefined): string {
  const statuses = r.checks.map((c) => `${c.key}:${c.status}`).join(",");
  let h = 0;
  for (let i = 0; i < statuses.length; i++) h = (h * 31 + statuses.charCodeAt(i)) >>> 0;
  return `${VERIFICATION_REPORT_VERSION}/${(vin || "novin").toUpperCase()}/${r.lastCheckedAt ?? "unchecked"}/${h.toString(36)}`;
}

// ── Recall wording, one place (L01) ─────────────────────────────────────────

/** Headline for the recall check on any customer surface. */
export function recallHeadline(c: Pick<ReportCheck, "status" | "highSeverity" | "recallOutcome">): string {
  if (c.status === "needs_confirmation") return "Recall status needs confirmation";
  if (c.highSeverity) return "Do-not-drive recall reported";
  switch (c.recallOutcome) {
    case "vin_open": return "Open safety recall found";
    case "model_context": return "Recall campaigns on this model";
    case "vin_clear": return "No open recalls for this VIN";
    case "stale": return "Recall check out of date";
    case "not_checked": return "Recall check not run yet";
    case "unavailable": return "Recall not verified for this VIN";
    default:
      // A report built before recallOutcome existed: status is all we have,
      // and only needs_attention may ever be worded as an open recall.
      return c.status === "needs_attention" ? "Open safety recall found" : c.status === "verified" ? "No open recalls for this VIN" : "Recall not verified for this VIN";
  }
}

/** True only when a recall is CONFIRMED on this VIN (or do-not-drive). */
export const recallConfirmedOpen = (c: Pick<ReportCheck, "status" | "highSeverity" | "recallOutcome"> | undefined): boolean =>
  !!c && (c.highSeverity || c.recallOutcome === "vin_open" || (c.recallOutcome == null && c.status === "needs_attention"));

/**
 * The "What should I do next?" list, derived from the report alone and shared
 * by the desktop page, the mobile page and the print document. Recall steps
 * come from the exact recall outcome: an unavailable lookup asks for a VIN
 * check; it never mentions "the open recall" or a remedy (L01).
 */
export function deriveNextSteps(report: VerificationReport): string[] {
  const steps: string[] = [];
  const recall = report.checks.find((c) => c.key === "recall");
  if (recall && !isSettledCheck(recall.status)) {
    const o = recall.recallOutcome;
    if (recall.highSeverity || o === "do_not_drive") {
      steps.push("Do not drive this vehicle until the dealer shows the recall remedy has been completed.");
      steps.push("Ask the dealer for the recall repair record before you take delivery.");
    } else if (recall.status === "needs_confirmation" || o === "conflict") {
      steps.push("Ask the dealer to confirm this VIN's recall status — the available sources disagree.");
    } else if (o === "vin_open" || (o == null && recall.status === "needs_attention")) {
      steps.push("Ask the dealer about the open recall on this VIN and whether the remedy is available.");
      steps.push("Confirm the recall remedy has been completed before you take delivery.");
    } else if (o === "model_context") {
      steps.push("Ask the dealer whether this VIN is included in the recall campaigns reported for its model.");
    } else {
      steps.push("Ask the dealer for a VIN-level recall check — no source has confirmed this VIN's recall status yet.");
    }
  }
  const title = report.checks.find((c) => c.key === "title");
  if (title?.status === "dealer_attested") {
    steps.push("The title status is the dealer's own statement. Ask for the title record if you want it independently confirmed.");
  }
  report.checks
    .filter((c) => !isSettledCheck(c.status) && c.status !== "unavailable" && c.key !== "recall")
    .forEach((c) => {
      if (c.key === "title") steps.push("Review the title and brand details with the dealer once that check completes.");
      else steps.push(`Ask the dealer about ${c.name.toLowerCase()}.`);
    });
  if (report.checks.some((c) => c.status === "unavailable")) steps.push("Ask the dealer for the records behind any checks marked not available.");
  if (steps.length === 0) steps.push("Review the verified checks above — every completed check returned a clear result.");
  steps.push("Keep this report for your records. It reflects the source data as of the date shown.");
  return steps;
}
