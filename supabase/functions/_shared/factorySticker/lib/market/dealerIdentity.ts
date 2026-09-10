// GENERATED — do not edit.
// Mirror of src/lib/market/dealerIdentity.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
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
//
// IDENTIFIERS AND NAMES ARE DIFFERENT KINDS OF THING and the type keeps them
// apart. `groupIds` holds provider-issued group identifiers; `groupNames`
// holds a group's trading name. Putting "Harte Auto Group" in `groupIds`
// compares a name against MarketCheck's `dealer.group_id`, never matches, and
// reports itself as a stable identification while doing nothing at all — the
// worst of the three outcomes, because it is a silent false negative wearing
// a stable-identity label. `identityConfigIssues` exists to catch exactly that.

export type OwnershipRelation = "own_rooftop" | "own_group" | "external";
export type IdentityConfidence = "stable" | "name_only" | "none";

export interface TenantDealerIdentity {
  rooftopIds?: string[];
  dealerIds?: string[];
  websiteIds?: string[];
  domains?: string[];
  /**
   * Provider-issued group identifiers ONLY — MarketCheck's `dealer.group_id`
   * and equivalents. A group's trading name belongs in `groupNames`.
   */
  groupIds?: string[];
  /**
   * A group's trading name. Last-resort matching only: it can miss affiliated
   * inventory outright (a rooftop the provider labels differently) and it can
   * over-match an unrelated group that happens to share a word, so a match
   * here is reported as `name_only` and never counts as stable identity.
   */
  groupNames?: string[];
  /** Last-resort matching only. Never the sole basis for a confident answer. */
  names?: string[];
}

export interface ComparableIdentityFields {
  dealerId?: string | null;
  rooftopId?: string | null;
  websiteId?: string | null;
  dealerGroupId?: string | null;
  dealerGroupName?: string | null;
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
 * Fuzzy name equality, used for rooftop names and group names alike.
 *
 * Exact equality after normalization, or containment when both sides are long
 * enough that containment is not an accident. "Harte Auto Group" normalizes to
 * "harte", so the containment arm is deliberately unreachable for short trading
 * names — only the exact arm can match them.
 */
const nameMatches = (own: string, other: string): boolean =>
  own === other || (own.length >= 6 && other.length >= 6 && (other.includes(own) || own.includes(other)));

/**
 * Decide whether a listing belongs to the dealer we are measuring.
 *
 * A name-only match still returns own_rooftop / own_group — keeping a dealer's
 * own car out of its own market is the safer error — but it reports
 * `name_only` so the confidence engine can require stable identity before
 * allowing a red verdict.
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
      if (nameMatches(own, name)) {
        cautions.push("own_rooftop_matched_by_name_only");
        return ok("own_rooftop", "dealer_name", "name_only", cautions);
      }
    }
  }

  // Group-name fallback. It runs after the rooftop-name check so a car at the
  // measured rooftop is reported as own_rooftop rather than merely own_group.
  const groupName = normalizeDealerName(comp.dealerGroupName);
  if (groupName && identity.groupNames?.length) {
    for (const own of identity.groupNames.map(normalizeDealerName)) {
      if (!own) continue;
      if (nameMatches(own, groupName)) {
        cautions.push("own_group_matched_by_name_only");
        return ok("own_group", "dealer_group_name", "name_only", cautions);
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

/**
 * Group key, falling back to the group's normalized name and then to the
 * rooftop — a rooftop is its own group of one.
 *
 * Collapsing by name is the conservative direction: it can only merge two
 * rooftops into one counted source, never split one into two, so the error it
 * makes is to understate independence rather than to overstate it.
 */
export function groupKey(comp: ComparableIdentityFields): string {
  return comp.dealerGroupId?.trim() || normalizeDealerName(comp.dealerGroupName) || rooftopKey(comp);
}

/** True when at least one comparable actually carried a group id. */
export const groupIdsKnown = (comps: ComparableIdentityFields[]): boolean =>
  comps.some((c) => !!c.dealerGroupId?.trim());

/**
 * How well we can identify the DEALER WE ARE MEASURING — not a comparable.
 *
 * Name-only is not good enough for a high-confidence conclusion. Two Harte
 * cars sat inside Harte's own market because a name comparison was the only
 * thing standing between them and the median, and a name comparison is one
 * rebrand or one franchise-sale away from failing silently. Until a stable
 * rooftop, dealer, website, group id or domain exists for a tenant, high
 * confidence — and therefore red — stays out of reach.
 *
 * `groupNames` is a name and counts as one, no matter how many are configured.
 */
export function tenantIdentityStability(identity: TenantDealerIdentity): IdentityConfidence {
  const stable =
    (identity.rooftopIds?.length ?? 0)
    + (identity.dealerIds?.length ?? 0)
    + (identity.websiteIds?.length ?? 0)
    + (identity.domains?.length ?? 0)
    + (identity.groupIds?.length ?? 0);
  if (stable > 0) return "stable";
  const named = (identity.names?.length ?? 0) + (identity.groupNames?.length ?? 0);
  return named > 0 ? "name_only" : "none";
}

const looksLikeAName = (v: string): boolean => /[a-z]/i.test(v) && /\s/.test(v.trim());

/**
 * Configuration lint for a tenant's identity mapping.
 *
 * A trading name in `groupIds` is compared against the provider's group id,
 * never matches, and still reports itself as stable identity — so it is worth
 * naming loudly rather than discovering it as a missing exclusion months later.
 */
export function identityConfigIssues(identity: TenantDealerIdentity): string[] {
  const issues: string[] = [];
  for (const id of identity.groupIds ?? []) {
    if (looksLikeAName(String(id))) issues.push(`group_id_looks_like_a_name:${id}`);
  }
  for (const id of identity.dealerIds ?? []) {
    if (looksLikeAName(String(id))) issues.push(`dealer_id_looks_like_a_name:${id}`);
  }
  for (const id of identity.rooftopIds ?? []) {
    if (looksLikeAName(String(id))) issues.push(`rooftop_id_looks_like_a_name:${id}`);
  }
  return issues;
}
