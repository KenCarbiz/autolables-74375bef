// ── Shared passport verification derivation ─────────────────────────────────
// ONE governed source of truth for "how many checks exist, how many are
// complete, and whether a material check is pending" — consumed by BOTH the
// mobile and desktop passport layers so they can never diverge. `d.verifyRows`
// is pre-filtered to completed rows only, so it cannot answer "what's pending";
// this reconstructs the full category set from the governed PassportData fields.
//
// Governance: a pending MATERIAL check (VIN / title / recall) can never roll up
// into an all-complete state; missing data is "pending", never "verified".

import type { PassportData } from "@/lib/passportV2Data";
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
