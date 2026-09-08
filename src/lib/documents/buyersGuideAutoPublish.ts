// May this FTC Buyers Guide publish itself?
//
// The Guide's warranty box is a binding disclosure under 16 CFR Part 455, so
// the question is NOT "has a human clicked". It is "was this box DETERMINED,
// or was it guessed". create_draft_buyers_guide already answers that when it
// drafts the row, and stores the answer in data_snapshot:
//
//   forced        — the operating state's statute leaves exactly one lawful
//                   value (CT/MA/NY/NJ mileage-and-price ladders, and the
//                   implied-warranty states). Nothing for a human to decide.
//   citation      — the box was selected by a named statute even where the
//                   ladder did not force a dealer warranty (e.g. the CT
//                   §42-221 age exemption puts a 7-model-year-old car back on
//                   As-Is). Also determined by law.
//   default_ftc_warranty
//                 — the dealership's own configured position for cars the
//                   statute does not decide. That is a dealer decision made
//                   once in Admin rather than re-made per car.
//
// If none of those three is present, the draft fell through to the bare "as-is"
// default with nothing behind it. Publishing that would assert "AS IS - NO
// DEALER WARRANTY" on a vehicle where the dealership may in fact be offering
// coverage — understating a warranty is a misrepresentation, not a safe
// default — so that one case stops and names itself.
//
// Pure and dependency-free; mirrored into the edge tree by
// `bun run sync:edge-sticker`.

import { classifyCondition } from "./families.ts";

export const BUYERS_GUIDE_POLICY_VERSION = "2026-09-08.1";

/** The three boxes on the federal form. */
export type BuyersGuideBox = "as-is" | "implied" | "warranty";

export const isBuyersGuideBox = (v: unknown): v is BuyersGuideBox =>
  v === "as-is" || v === "implied" || v === "warranty";

/** Values Admin can store for `default_ftc_warranty`. */
const CONFIGURED_DEFAULTS = new Set(["as-is", "as_is", "asis", "implied", "dealer", "warranty"]);

export interface BuyersGuideSnapshot {
  box?: unknown;
  forced?: unknown;
  citation?: unknown;
  default_ftc_warranty?: unknown;
  operating_state?: unknown;
  min_pct?: unknown;
  min_duration_days?: unknown;
  min_miles?: unknown;
}

export type BuyersGuideHoldCode =
  | "NOT_A_USED_VEHICLE"
  | "UNKNOWN_BOX"
  | "BOX_NOT_DETERMINED"
  | "WARRANTY_TERMS_MISSING"
  | "HUMAN_REJECTED";

export interface BuyersGuidePublishDecision {
  publish: boolean;
  box: BuyersGuideBox | null;
  /** How the box was arrived at; travels into the document snapshot. */
  basis: "statute" | "dealer_default" | "undetermined";
  holds: BuyersGuideHoldCode[];
  reasons: string[];
}

const HOLD_REASONS: Record<BuyersGuideHoldCode, string> = {
  NOT_A_USED_VEHICLE:
    "The FTC Used Car Rule (16 CFR 455) governs used vehicles; a new vehicle has no Buyers Guide.",
  UNKNOWN_BOX:
    "The warranty box on the draft is not one of As-Is, Implied Warranties Only, or Dealer Warranty.",
  BOX_NOT_DETERMINED:
    "No state statute decides this vehicle's warranty box and the dealership has not set a default "
    + "warranty position in Admin. Set Default FTC Warranty, or choose the box on this vehicle; "
    + "publishing an unconfigured As-Is would assert a warranty position nobody chose.",
  WARRANTY_TERMS_MISSING:
    "The Dealer Warranty box is selected but the coverage percentage and term are not both on the "
    + "record, so the Guide would promise coverage without saying how much or for how long.",
  HUMAN_REJECTED:
    "A manager rejected this Buyers Guide. Automation does not re-publish a rejected document.",
};

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
};

const str = (v: unknown): string => (typeof v === "string" ? v.trim().toLowerCase() : "");

export function evaluateBuyersGuideAutoPublish(
  snapshot: BuyersGuideSnapshot | null | undefined,
  input: { condition?: string | null; humanRejected?: boolean },
): BuyersGuidePublishDecision {
  const snap = snapshot ?? {};
  const holds: BuyersGuideHoldCode[] = [];
  const box = isBuyersGuideBox(snap.box) ? snap.box : null;

  const forced = snap.forced === true || str(snap.forced) === "true";
  const citation = str(snap.citation);
  const configured = CONFIGURED_DEFAULTS.has(str(snap.default_ftc_warranty));
  const basis: BuyersGuidePublishDecision["basis"] = forced || citation
    ? "statute"
    : configured
      ? "dealer_default"
      : "undetermined";

  if (input.humanRejected) holds.push("HUMAN_REJECTED");
  const cls = classifyCondition(input.condition);
  if (cls !== "used" && cls !== "cpo") holds.push("NOT_A_USED_VEHICLE");
  if (!box) holds.push("UNKNOWN_BOX");
  if (basis === "undetermined") holds.push("BOX_NOT_DETERMINED");
  // A Dealer Warranty box promises a percentage of parts and labour for a
  // stated term. Both halves are printed on the form; neither may be blank.
  if (box === "warranty" && (num(snap.min_pct) <= 0 || (num(snap.min_duration_days) <= 0 && num(snap.min_miles) <= 0))) {
    holds.push("WARRANTY_TERMS_MISSING");
  }

  return {
    publish: holds.length === 0,
    box,
    basis,
    holds,
    reasons: holds.map((h) => HOLD_REASONS[h]),
  };
}
