// ── Reading what production already stored ─────────────────────────────────
//
// Shadow mode has to run against the rows that exist today, not against the
// rows the corrected pipeline will write. Those legacy rows are thin: a
// comparable carries a heading, a trim, miles, a price, a distance and a
// dealer NAME, and nothing else. No VIN-level certification, no dealer id, no
// group, no domain, no observation time.
//
// Every one of those gaps is passed through as UNKNOWN rather than filled in.
// That is the difference between a shadow report that tells the owner what is
// missing and one that quietly manufactures the confidence it is supposed to
// be measuring.
//
// Identity uses the repository's existing parser. There is exactly one YMM
// parser in this codebase and this is not a second one: the stored headings
// carry a marketing prefix ("Used 2025 INFINITI QX50 SPORT",
// "Pre-Owned 2025 ..."), so the prefix is stripped and `parseYmm` — which
// already knows that ALFA ROMEO and LAND ROVER are two words — is called with
// the string it expects.

import { parseYmm } from "../factorySticker/ymm.ts";
import type { ComparableCandidate, SubjectCondition } from "./types.ts";

const CONDITION_PREFIX = /^(?:used|new|pre[\s-]?owned|certified(?:\s+pre[\s-]?owned)?|cpo)\s+/i;

/** Remove a listing-site condition prefix so the shared YMM parser sees a year first. */
export function stripListingConditionPrefix(heading: string | null | undefined): string {
  let text = String(heading ?? "").trim().replace(/\s+/g, " ");
  for (let i = 0; i < 3 && CONDITION_PREFIX.test(text); i++) text = text.replace(CONDITION_PREFIX, "");
  return text;
}

/** Trailing marketing tails a heading picks up: "With Navigation", "w/ Sunroof". */
const TRAILING_MARKETING = /\s+(?:with|w\/)\s+.*$/i;

export interface LegacyComparableRow {
  vin?: unknown;
  ymm?: unknown;
  trim?: unknown;
  miles?: unknown;
  price?: unknown;
  dist?: unknown;
  dealer?: unknown;
  dom?: unknown;
}

/**
 * Map one stored comparable to an engine candidate.
 *
 * `certified` is deliberately absent, not false. The legacy row never recorded
 * it, and the tier rules must be allowed to see that as "certification not
 * established" — which for a CPO subject is exactly why the QX50 has no
 * primary comparable.
 */
export function legacyComparableToCandidate(
  row: LegacyComparableRow,
  opts?: { observedAt?: string | null },
): ComparableCandidate {
  const heading = stripListingConditionPrefix(String(row.ymm ?? "")).replace(TRAILING_MARKETING, "");
  const parsed = parseYmm(heading);
  const year = /^\d{4}$/.test(parsed.year) ? Number(parsed.year) : null;
  const trim = String(row.trim ?? "").trim() || null;

  // The heading usually repeats the trim in upper case; strip it from the
  // model so "QX50 SPORT" does not become a model nothing else matches.
  let model = parsed.model.trim();
  if (trim && model.toLowerCase().endsWith(trim.toLowerCase())) {
    model = model.slice(0, model.length - trim.length).trim();
  }

  return {
    vin: row.vin,
    year,
    make: parsed.make || null,
    model: model || null,
    trim,
    mileage: row.miles,
    price: row.price,
    distanceMiles: row.dist,
    daysOnMarket: row.dom,
    dealerName: row.dealer,
    observedAt: opts?.observedAt ?? null,
    // Everything below was never stored. Unknown is the honest value.
    listingId: null,
    drivetrain: null,
    powertrain: null,
    transmission: null,
    certified: null,
    certificationProgram: null,
    dealerId: null,
    rooftopId: null,
    dealerGroupId: null,
    dealerGroupName: null,
    dealerDomain: null,
    dealerType: null,
    equipmentCodes: [],
    historyStatus: "unknown",
    conditionStatus: "unknown",
    docFeeIncluded: null,
    docFee: null,
  };
}

/** Every gap a legacy comparable set carries, so the shadow report can count them. */
export function legacyComparableGaps(rows: LegacyComparableRow[]): Record<string, number> {
  const gaps: Record<string, number> = {
    missing_certification: 0, missing_dealer_identity: 0, missing_observed_at: rows.length,
    missing_history: rows.length, missing_equipment: rows.length, missing_drivetrain: rows.length,
    missing_price_basis: rows.length,
  };
  for (const _row of rows) {
    gaps.missing_certification++;
    gaps.missing_dealer_identity++;
  }
  return gaps;
}

export const conditionToCertified = (condition: SubjectCondition | null): boolean | null =>
  condition == null ? null : condition === "cpo";
