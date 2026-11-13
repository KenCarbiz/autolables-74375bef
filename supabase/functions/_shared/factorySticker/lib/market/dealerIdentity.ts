// GENERATED — do not edit.
// Mirror of src/lib/market/dealerIdentity.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
export type OwnershipRelation = "own_rooftop" | "own_group" | "external";
export type IdentityConfidence = "stable" | "name_only" | "none";
export interface TenantDealerIdentity {
    rooftopIds?: string[];
    dealerIds?: string[];
    websiteIds?: string[];
    domains?: string[];
    groupIds?: string[];
    groupNames?: string[];
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
export const normalizeDealerName = (v: unknown): string => String(v ?? "").toLowerCase().replace(/\b(inc|llc|co|corp|auto|automotive|motors?|group)\b/g, "")
    .replace(/[^a-z0-9]+/g, "");
export const normalizeDomain = (v: unknown): string => String(v ?? "").toLowerCase().trim()
    .replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
const has = (list: string[] | undefined, value: string | null | undefined): boolean => {
    if (!list?.length || !value)
        return false;
    const needle = String(value).trim().toLowerCase();
    return list.some((x) => String(x).trim().toLowerCase() === needle);
};
const nameMatches = (own: string, other: string): boolean => own === other || (own.length >= 6 && other.length >= 6 && (other.includes(own) || own.includes(other)));
export function classifyOwnership(comp: ComparableIdentityFields, identity: TenantDealerIdentity): OwnershipVerdict {
    const cautions: string[] = [];
    if (has(identity.rooftopIds, comp.rooftopId))
        return ok("own_rooftop", "rooftop_id", "stable", cautions);
    if (has(identity.dealerIds, comp.dealerId))
        return ok("own_rooftop", "dealer_id", "stable", cautions);
    if (has(identity.websiteIds, comp.websiteId))
        return ok("own_rooftop", "website_id", "stable", cautions);
    if (identity.domains?.length && normalizeDomain(comp.dealerDomain)
        && identity.domains.map(normalizeDomain).includes(normalizeDomain(comp.dealerDomain))) {
        return ok("own_rooftop", "dealer_domain", "stable", cautions);
    }
    if (has(identity.groupIds, comp.dealerGroupId))
        return ok("own_group", "dealer_group_id", "stable", cautions);
    const name = normalizeDealerName(comp.dealerName);
    if (name && identity.names?.length) {
        for (const own of identity.names.map(normalizeDealerName)) {
            if (!own)
                continue;
            if (nameMatches(own, name)) {
                cautions.push("own_rooftop_matched_by_name_only");
                return ok("own_rooftop", "dealer_name", "name_only", cautions);
            }
        }
    }
    const groupName = normalizeDealerName(comp.dealerGroupName);
    if (groupName && identity.groupNames?.length) {
        for (const own of identity.groupNames.map(normalizeDealerName)) {
            if (!own)
                continue;
            if (nameMatches(own, groupName)) {
                cautions.push("own_group_matched_by_name_only");
                return ok("own_group", "dealer_group_name", "name_only", cautions);
            }
        }
    }
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
function ok(relation: OwnershipRelation, matchedOn: string, identityConfidence: IdentityConfidence, cautions: string[]): OwnershipVerdict {
    return { relation, matchedOn, identityConfidence, cautions };
}
export function rooftopKey(comp: ComparableIdentityFields): string {
    return (comp.rooftopId?.trim()
        || comp.dealerId?.trim()
        || comp.websiteId?.trim()
        || normalizeDomain(comp.dealerDomain)
        || normalizeDealerName(comp.dealerName)
        || "unknown_rooftop");
}
export function groupKey(comp: ComparableIdentityFields): string {
    return comp.dealerGroupId?.trim() || normalizeDealerName(comp.dealerGroupName) || rooftopKey(comp);
}
export const groupIdsKnown = (comps: ComparableIdentityFields[]): boolean => comps.some((c) => !!c.dealerGroupId?.trim());
export function tenantIdentityStability(identity: TenantDealerIdentity): IdentityConfidence {
    const stable = (identity.rooftopIds?.length ?? 0)
        + (identity.dealerIds?.length ?? 0)
        + (identity.websiteIds?.length ?? 0)
        + (identity.domains?.length ?? 0)
        + (identity.groupIds?.length ?? 0);
    if (stable > 0)
        return "stable";
    const named = (identity.names?.length ?? 0) + (identity.groupNames?.length ?? 0);
    return named > 0 ? "name_only" : "none";
}
const looksLikeAName = (v: string): boolean => /[a-z]/i.test(v) && /\s/.test(v.trim());
export function identityConfigIssues(identity: TenantDealerIdentity): string[] {
    const issues: string[] = [];
    for (const id of identity.groupIds ?? []) {
        if (looksLikeAName(String(id)))
            issues.push(`group_id_looks_like_a_name:${id}`);
    }
    for (const id of identity.dealerIds ?? []) {
        if (looksLikeAName(String(id)))
            issues.push(`dealer_id_looks_like_a_name:${id}`);
    }
    for (const id of identity.rooftopIds ?? []) {
        if (looksLikeAName(String(id)))
            issues.push(`rooftop_id_looks_like_a_name:${id}`);
    }
    return issues;
}
