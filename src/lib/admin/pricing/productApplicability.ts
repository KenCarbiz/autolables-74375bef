import type { ProductRule } from "@/hooks/useProductRules";
import { evaluateRule, readCondition, type EligibilityStatus, type RuleEvaluation } from "@/lib/productEligibility";

// Product applicability as a reviewable draft over the existing product_rules
// model, plus the distinctions the reference keeps apart: eligible is not
// installed, installed needs proof, proof is per vehicle, and publication is
// a separate state again.

export type ConditionKey = "new" | "used" | "cpo";

export interface ApplicabilityDraft {
  conditions: Record<ConditionKey, boolean>;
  mileageMax: number | null;
  yearMin: string;
  yearMax: string;
}

export const ALL_CONDITIONS: ApplicabilityDraft["conditions"] = { new: true, used: true, cpo: true };

/**
 * The stored rule model has one condition value: new, used or all. Used
 * covers CPO, so the CPO checkbox follows Used and is shown as derived.
 */
export function draftFromRule(rule: Pick<ProductRule, "condition" | "mileage_max" | "year_min" | "year_max"> | null): ApplicabilityDraft {
  if (!rule) return { conditions: { ...ALL_CONDITIONS }, mileageMax: null, yearMin: "", yearMax: "" };
  const conditions: ApplicabilityDraft["conditions"] =
    rule.condition === "new" ? { new: true, used: false, cpo: false } : rule.condition === "used" ? { new: false, used: true, cpo: true } : { ...ALL_CONDITIONS };
  return {
    conditions,
    mileageMax: rule.mileage_max > 0 ? rule.mileage_max : null,
    yearMin: rule.year_min || "",
    yearMax: rule.year_max || "",
  };
}

export function draftToRulePatch(d: ApplicabilityDraft): Pick<ProductRule, "condition" | "mileage_max" | "year_min" | "year_max"> {
  const condition: ProductRule["condition"] = d.conditions.new && d.conditions.used ? "all" : d.conditions.new ? "new" : "used";
  return { condition, mileage_max: d.mileageMax && d.mileageMax > 0 ? Math.round(d.mileageMax) : 0, year_min: d.yearMin.trim(), year_max: d.yearMax.trim() };
}

export function validateApplicabilityDraft(d: ApplicabilityDraft): string[] {
  const errors: string[] = [];
  if (!d.conditions.new && !d.conditions.used) errors.push("Choose at least one condition.");
  if (d.mileageMax != null && (!Number.isFinite(d.mileageMax) || d.mileageMax < 0)) errors.push("Mileage limit must be zero or more.");
  const min = parseInt(d.yearMin, 10);
  const max = parseInt(d.yearMax, 10);
  if (d.yearMin && !Number.isFinite(min)) errors.push("Model year from must be a year.");
  if (d.yearMax && !Number.isFinite(max)) errors.push("Model year to must be a year.");
  if (Number.isFinite(min) && Number.isFinite(max) && min > max) errors.push("Model year range is reversed.");
  return errors;
}

/** The vehicle's condition when it is recorded and recognized; null otherwise (never assumed Used). */
export const conditionOfVehicle = (condition: string | null | undefined): ConditionKey | null => {
  const c = readCondition(condition);
  return c.kind === "known" ? c.value : null;
};

export interface SampleVehicle {
  vin: string;
  year: string | number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  condition: string | null;
  mileage: number | null;
}

/**
 * Eligibility of a sample vehicle under the draft, through the same predicate
 * the addendum builder uses (lib/productEligibility): the draft is turned
 * into the stored rule shape first, so CPO follows Used exactly as it will
 * once saved.
 */
export function vehicleEligibility(d: ApplicabilityDraft, v: SampleVehicle): RuleEvaluation {
  if (!d.conditions.new && !d.conditions.used) return { status: "excluded", reasons: ["No condition is selected."], unknown: [] };
  const rule = { makes: [], models: [], trims: [], body_styles: [], ...draftToRulePatch(d) };
  return evaluateRule(rule, { year: v.year, make: v.make, model: v.model, trim: v.trim, condition: v.condition, mileage: v.mileage });
}

/** True only when the vehicle is known to qualify; an undetermined vehicle is not eligible. */
export function vehicleEligible(d: ApplicabilityDraft, v: SampleVehicle): boolean {
  return vehicleEligibility(d, v).status === "eligible";
}

export type PriceTreatment = "installed" | "optional";

export interface PriceTreatmentSummary {
  treatment: PriceTreatment;
  includedInAdvertised: boolean;
  label: string;
  detail: string;
}

export function priceTreatmentOf(p: { badge_type: string; price_in_advertised: boolean | null; available_preinstalled?: boolean | null }): PriceTreatmentSummary {
  const installed = (p.badge_type || "installed") === "installed" && p.available_preinstalled !== false;
  if (!installed) {
    return { treatment: "optional", includedInAdvertised: false, label: "Optional accessory", detail: "Customer can choose to add at time of purchase." };
  }
  return {
    treatment: "installed",
    includedInAdvertised: p.price_in_advertised !== false,
    label: "Installed product",
    detail: p.price_in_advertised !== false ? "Added to vehicle and itemized inside the advertised price." : "Added to vehicle as a dealer-installed upcharge above the advertised price.",
  };
}

export type EvidenceItemState = "complete" | "pending" | "required" | "manager_required" | "not_required";

export interface EvidenceItem {
  key: "applicable" | "installation_proof" | "disclosure" | "approval";
  label: string;
  detail: string;
  state: EvidenceItemState;
}

export function evidenceChecklist(
  product: { badge_type: string; price_in_advertised: boolean | null; available_preinstalled?: boolean | null; disclosure: string | null; benefit_justification: string | null; contract_url: string | null },
  policy: { requireManagerApproval: boolean; requireInstallVerification: boolean },
  rulesExist: boolean,
): EvidenceItem[] {
  const treatment = priceTreatmentOf(product);
  const disclosureComplete = !!(product.disclosure ?? "").trim() && !!(product.benefit_justification ?? "").trim();
  return [
    {
      key: "applicable",
      label: "Applicable to vehicle",
      detail: rulesExist ? "Inventory must match applicability rules." : "No rules yet; the product applies to every vehicle.",
      state: "pending",
    },
    {
      key: "installation_proof",
      label: "Installation proof",
      detail: treatment.treatment === "installed" ? "Proof of installation required per vehicle." : "Not required for an optional accessory.",
      state: treatment.treatment === "installed" ? "required" : "not_required",
    },
    {
      key: "disclosure",
      label: "Disclosure",
      detail: disclosureComplete ? "Customer-facing disclosure and benefit are complete." : "Disclosure or benefit justification is missing.",
      state: disclosureComplete ? "complete" : "required",
    },
    {
      key: "approval",
      label: "Approval",
      detail: policy.requireManagerApproval ? "Manager approval required before publication." : "No manager approval gate is set.",
      state: policy.requireManagerApproval ? "manager_required" : "not_required",
    },
  ];
}

export type ProofState = "attached" | "missing" | "excluded" | "not_required" | "unknown";
export type PublicationState = "blocked" | "ready_for_review" | "publishable" | "not_published" | "unknown";

export interface SampleResult {
  vehicle: SampleVehicle;
  eligible: boolean;
  /** eligible, excluded, or undetermined when a fact the rule needs is not recorded. */
  status: EligibilityStatus;
  evaluation: RuleEvaluation;
  proof: ProofState;
  publication: PublicationState;
}

/**
 * Per-vehicle result. `proofs` is the vehicle's verified-proof count for this
 * product, or null when the read failed; a failed read is unknown, never
 * attached and never missing.
 */
export function sampleResult(
  d: ApplicabilityDraft,
  treatment: PriceTreatment,
  policy: { requireManagerApproval: boolean },
  vehicle: SampleVehicle,
  verifiedProofs: number | null,
): SampleResult {
  const evaluation = vehicleEligibility(d, vehicle);
  const base = { vehicle, status: evaluation.status, evaluation, eligible: evaluation.status === "eligible" };
  if (evaluation.status === "undetermined") return { ...base, proof: "unknown", publication: "unknown" };
  if (evaluation.status === "excluded") return { ...base, proof: "excluded", publication: "not_published" };
  if (treatment === "optional") {
    return { ...base, proof: "not_required", publication: policy.requireManagerApproval ? "ready_for_review" : "publishable" };
  }
  if (verifiedProofs == null) return { ...base, proof: "unknown", publication: "unknown" };
  if (verifiedProofs <= 0) return { ...base, proof: "missing", publication: "blocked" };
  return { ...base, proof: "attached", publication: policy.requireManagerApproval ? "ready_for_review" : "publishable" };
}

export const PROOF_LABEL: Record<ProofState, string> = {
  attached: "Proof attached",
  missing: "Missing proof",
  excluded: "Excluded",
  not_required: "Not required",
  unknown: "Unknown",
};

export const PUBLICATION_LABEL: Record<PublicationState, string> = {
  blocked: "Blocked",
  ready_for_review: "Ready for review",
  publishable: "Publishable",
  not_published: "Not published",
  unknown: "Unknown",
};

export const isDraftEqual = (a: ApplicabilityDraft, b: ApplicabilityDraft): boolean =>
  a.conditions.new === b.conditions.new && a.conditions.used === b.conditions.used && (a.mileageMax ?? 0) === (b.mileageMax ?? 0) && a.yearMin.trim() === b.yearMin.trim() && a.yearMax.trim() === b.yearMax.trim();
