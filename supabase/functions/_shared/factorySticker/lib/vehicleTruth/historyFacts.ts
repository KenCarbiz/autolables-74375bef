// GENERATED — do not edit.
// Mirror of src/lib/vehicleTruth/historyFacts.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// Resolved vehicle-history facts, for anything that shows a trust badge.
//
// The badges read bare booleans off `mc_attributes` until now:
// `mc.carfax_1_owner === true` renders "1-Owner Vehicle",
// `mc.carfax_clean_title === true` renders "Clean Title — no salvage, flood,
// or lemon". That treats every writer as equally credible, and one of the
// writers was us: a description AutoLabels generated, syndicated onto the
// dealer's site, scraped back off it, and promoted to a verified title claim.
//
// The precedence engine already had the rule that prevents this — AI
// inference is capped at LOW and "may never be treated as fact" — but the
// badges never asked it. This module is the ask.

import type { Confidence, ResolvedFact, SourceKind } from "./precedence.ts";
import { resolveFact } from "./precedence.ts";
import { candidatesFromHistory, type IngestOptions, type TruthListingRow } from "./ingest.ts";

export const HISTORY_FACT_KEYS = [
  "carfax_one_owner",
  "carfax_clean_title",
  "certified_pre_owned",
  "owner_count",
  "title_brand",
] as const;

export type HistoryFactKey = (typeof HISTORY_FACT_KEYS)[number];

export type HistoryFacts = Partial<Record<HistoryFactKey, ResolvedFact>>;

export function resolveHistoryFacts(
  listing: TruthListingRow,
  options: IngestOptions = {},
): HistoryFacts {
  const byKey = new Map<string, Parameters<typeof resolveFact>[0]>();
  for (const c of candidatesFromHistory(listing, options)) {
    const arr = byKey.get(c.factKey) ?? [];
    arr.push(c);
    byKey.set(c.factKey, arr);
  }
  const out: HistoryFacts = {};
  for (const key of HISTORY_FACT_KEYS) {
    const resolved = resolveFact(byKey.get(key) ?? []);
    if (resolved) out[key] = resolved;
  }
  return out;
}

/**
 * May this fact be shown to a shopper as a trust badge?
 *
 * The line is drawn at LOW. Everything above it was asserted by someone who
 * is not the seller — a history provider, or that provider's badge on the
 * dealer's page. LOW is what the engine assigns to inference and to
 * provenance nobody recognises, and neither of those has standing to put a
 * claim about accidents or title brands in front of a buyer.
 *
 * A false value never renders either. These badges are positive-only by
 * construction: "1-Owner Vehicle" has a meaning, "not a 1-Owner Vehicle" is
 * not a badge, and the absence of a finding is not a finding.
 */
export function isBadgeworthy(fact: ResolvedFact | undefined): boolean {
  if (!fact) return false;
  if (fact.value !== true) return false;
  return fact.confidence !== "LOW" && fact.confidence !== "UNVERIFIED";
}

/**
 * What a shopper may be told about how solid a shown fact is.
 *
 * VERIFIED and HIGH come from the history provider itself. MEDIUM is a badge
 * we read off the dealer's page rather than the report behind it — true as
 * far as it goes, and honest to label as the dealer's own published claim.
 */
export function badgeAttribution(fact: ResolvedFact): string | null {
  switch (fact.confidence) {
    case "VERIFIED":
    case "HIGH":
      return null;
    case "MEDIUM":
      return fact.source === "dealer_vdp" ? "Per dealer listing" : "Unconfirmed";
    default:
      return "Unconfirmed";
  }
}

export type { Confidence, ResolvedFact, SourceKind };
