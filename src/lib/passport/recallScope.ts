// ──────────────────────────────────────────────────────────────────────
// VIN-scope recall truth — the one predicate every public surface uses to
// decide whether this VIN may be shown as recall-clear.
//
// Owner-locked semantics: a VIN is VERIFIED_CLEAR only when a VIN-specific
// lookup positively answered for that VIN. A provider 404, an empty response
// body, and a model-level NHTSA answer are all ABSENCE of evidence, never
// evidence of absence — they degrade to UNKNOWN. Model-scope campaign context
// may raise a warning but must never clear a VIN.
//
// This is why a stored recall_status of "clear" is not sufficient on its own.
// marketcheck-recalls treats a 404 from its endpoint ladder as "no recalls"
// and persists "clear", so the column carries clears for VINs no provider ever
// answered for. Three published cars were showing customers "No open safety
// recalls found in NHTSA campaigns" on exactly that basis — a claim attributed
// to NHTSA for data NHTSA never returned. Returned campaign records are the
// only proof in the public payload that a provider actually knew the VIN.
// ──────────────────────────────────────────────────────────────────────
import type { ListingRecallCheck } from "@/hooks/useVehicleListing";

export type VinRecallState = "open" | "verified_clear" | "unknown";

export interface RecallScopeInput {
  recall_status?: string | null;
  open_recall_count?: number | null;
  recall_check?: ListingRecallCheck | null;
}

export function vinRecallState(listing: RecallScopeInput): VinRecallState {
  const rc = listing.recall_check || null;
  // An open recall is never downgraded — a known campaign outranks any
  // absence-shaped answer, whichever scope reported it.
  if (rc?.has_open === true) return "open";
  if ((listing.open_recall_count ?? 0) > 0) return "open";
  if (listing.recall_status === "open_recalls") return "open";
  // Campaign records came back for this VIN and none of them is open. That is
  // the only shape in the public payload that proves a real VIN-level answer
  // rather than a 404, an empty body, or a model-year lookup that found
  // nothing on file.
  if ((rc?.campaigns?.length ?? 0) > 0) return "verified_clear";
  return "unknown";
}

// True only when this VIN may be presented to a customer as recall-clear.
export const vinRecallClear = (listing: RecallScopeInput): boolean =>
  vinRecallState(listing) === "verified_clear";

// True when a VIN-scope answer exists at all (clear or open). An UNKNOWN VIN
// has no completed check, so it must never count toward a verified tally or
// render as a finished step.
export const vinRecallAnswered = (listing: RecallScopeInput): boolean =>
  vinRecallState(listing) !== "unknown";
