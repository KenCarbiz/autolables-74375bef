// ── Who owns this listing ──────────────────────────────────────────────────
//
// The production own-dealer exclusion is two heuristics and both failed on the
// QX50: a fuzzy name comparison, and `dist === 0`. Two Harte Infiniti cars sit
// in the stored comparable set at 0.32 miles, so the distance test missed them
// and the name test did too. Five of the seven "market" comparables come from
// two rooftops, and one of those rooftops is the dealer being measured.
//
// The dist === 0 test is worse than merely weak. Neighbouring dealerships
// share a plaza and MarketCheck reports them at zero miles from each other, so
// the rule silently deletes the closest real competitors — the ones a shopper
// actually cross-shops — from the market.
//
// So identity is resolved from stable keys first (MarketCheck dealer id,
// website id, rooftop id, group id, the dealer's own domain, or an explicit
// tenant mapping), and a name match is accepted only as a last resort and is
// labelled as such so confidence can pay for it. Distance is never identity.

export type OwnershipRelation = "own_rooftop" | "own_group" | "external";
export type IdentityConfidence = "stable" | "name_only" | "none";

export interface TenantDealerIdentity {
  rooftopIds?: string[];
  dealerIds?: string[];
  websiteIds?: string[];
  domains?: string[];
  groupIds?: string[];
  /** Last-resort matching only. Never the sole basis for a confident answer. */
  names?: string[];
}

export interface ComparableIdentityFields {
  dealerId?: string | null;
  rooftopId?: string | null;
  websiteId?: string | null;
  dealerGroupId?: string | null;
  dealerDomain?: string | null;
  dealerName?: string | null;
  distanceMiles?: number | null;
}

export interface OwnershipVerdict {
  relation: OwnershipRelation;
  matchedOn: string | null;
  identityConfidence: IdentityConfidence;
  cautions: string[];
}

export const normalizeDealerName = (v: unknown): string =>
  String(v ?? "").toLowerCase().replace(/\b(inc|llc|co|corp|auto|automotive|motors?|group)\b/g, "")
    .replace(/[^a-z0-9]+/g, "");

export const normalizeDomain = (v: unknown): string =>
  String(v ?? "").toLowerCase().trim()
    .replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");

const has = (list: string[] | undefined, value: string | null | undefined): boolean => {
  if (!list?.length || !value) return false;
  const needle = String(value).trim().toLowerCase();
  return list.some((x) => String(x).trim().toLowerCase() === needle);
};

/**
 * Decide whether a listing belongs to the dealer we are measuring.
 *
 * A name-only match still returns own_rooftop — keeping a dealer's own car out
 * of its own market is the safer error — but it reports `name_only` so the
 * confidence engine can require stable identity before allowing a red verdict.
 */
export function classifyOwnership(
  comp: ComparableIdentityFields,
  identity: TenantDealerIdentity,
): OwnershipVerdict {
  const cautions: string[] = [];

  if (has(identity.rooftopIds, comp.rooftopId)) return ok("own_rooftop", "rooftop_id", "stable", cautions);
  if (has(identity.dealerIds, comp.dealerId)) return ok("own_rooftop", "dealer_id", "stable", cautions);
  if (has(identity.websiteIds, comp.websiteId)) return ok("own_rooftop", "website_id", "stable", cautions);
  if (identity.domains?.length && normalizeDomain(comp.dealerDomain)
      && identity.domains.map(normalizeDomain).includes(normalizeDomain(comp.dealerDomain))) {
    return ok("own_rooftop", "dealer_domain", "stable", cautions);
  }
  if (has(identity.groupIds, comp.dealerGroupId)) return ok("own_group", "dealer_group_id", "stable", cautions);

  const name = normalizeDealerName(comp.dealerName);
  if (name && identity.names?.length) {
    for (const own of identity.names.map(normalizeDealerName)) {
      if (!own) continue;
      if (own === name || (own.length >= 6 && name.length >= 6 && (name.includes(own) || own.includes(name)))) {
        cautions.push("own_rooftop_matched_by_name_only");
        return ok("own_rooftop", "dealer_name", "name_only", cautions);
      }
    }
  }

  // Distance is not identity. A competitor across the plaza is still a
  // competitor, and it is recorded so the explanation can say we checked.
  if (comp.distanceMiles != null && comp.distanceMiles <= 0.5) {
    cautions.push("adjacent_rooftop_kept_as_external");
  }

  const stableKey = comp.rooftopId || comp.dealerId || comp.websiteId || normalizeDomain(comp.dealerDomain);
  return {
    relation: "external",
    matchedOn: null,
    identityConfidence: stableKey ? "stable" : "none",
    cautions: stableKey ? cautions : [...cautions, "comparable_has_no_stable_dealer_identity"],
  };
}

function ok(
  relation: OwnershipRelation, matchedOn: string,
  identityConfidence: IdentityConfidence, cautions: string[],
): OwnershipVerdict {
  return { relation, matchedOn, identityConfidence, cautions };
}

/**
 * The key a concentration cap counts by.
 *
 * Stable id first; a normalized name is the fallback so two spellings of one
 * rooftop still collapse into one source rather than counting as two
 * independent opinions.
 */
export function rooftopKey(comp: ComparableIdentityFields): string {
  return (
    comp.rooftopId?.trim()
    || comp.dealerId?.trim()
    || comp.websiteId?.trim()
    || normalizeDomain(comp.dealerDomain)
    || normalizeDealerName(comp.dealerName)
    || "unknown_rooftop"
  );
}

/** Group key, falling back to the rooftop when no group is known — a rooftop is its own group of one. */
export function groupKey(comp: ComparableIdentityFields): string {
  return comp.dealerGroupId?.trim() || rooftopKey(comp);
}

/** True when at least one comparable actually carried a group id. */
export const groupIdsKnown = (comps: ComparableIdentityFields[]): boolean =>
  comps.some((c) => !!c.dealerGroupId?.trim());
