// GENERATED — do not edit.
// Mirror of src/lib/market/dealerGroup.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
export type GroupMappingConfidence = "authoritative_id" | "provider_name" | "name_match" | "none";
export interface DealershipGroupIdentity {
    groupId: string | null;
    groupName: string | null;
    subGroupId: string | null;
    subGroupName: string | null;
    source: "marketcheck_feed" | "marketcheck_directory" | "tenant_config" | "none";
    mappingConfidence: GroupMappingConfidence;
    checkedAt: string | null;
    reasons: string[];
}
export interface GroupIdentityInput {
    mcDealership?: unknown;
    dealerGroupName?: unknown;
    tenantGroupNames?: unknown;
    observedAt?: string | null;
}
const str = (v: unknown): string | null => {
    const s = typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
    return s || null;
};
const normalizeName = (v: unknown): string => String(v ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export function resolveDealershipGroup(input: GroupIdentityInput): DealershipGroupIdentity {
    const reasons: string[] = [];
    const md = input.mcDealership && typeof input.mcDealership === "object" ? input.mcDealership as Record<string, unknown> : {};
    const groupId = str(md.mc_dealership_group_id);
    const groupName = str(md.mc_dealership_group_name) ?? str(input.dealerGroupName);
    const subGroupId = str(md.mc_sub_dealership_group_id);
    const subGroupName = str(md.mc_sub_dealership_group_name);
    const checkedAt = input.observedAt ?? null;
    if (groupId) {
        reasons.push("provider_group_id_present");
        return { groupId, groupName, subGroupId, subGroupName, source: "marketcheck_feed", mappingConfidence: "authoritative_id", checkedAt, reasons };
    }
    if (groupName) {
        reasons.push("provider_group_name_only");
        return { groupId: null, groupName, subGroupId, subGroupName, source: "marketcheck_feed", mappingConfidence: "provider_name", checkedAt, reasons };
    }
    const tenantNames = Array.isArray(input.tenantGroupNames) ? input.tenantGroupNames.map(normalizeName).filter(Boolean) : [];
    const dealerName = normalizeName(md.name);
    const hit = tenantNames.find((n) => dealerName && (dealerName.includes(n) || n.includes(dealerName)));
    if (hit) {
        reasons.push("tenant_name_match_last_resort");
        return { groupId: null, groupName: hit, subGroupId: null, subGroupName: null, source: "tenant_config", mappingConfidence: "name_match", checkedAt, reasons };
    }
    reasons.push("no_group_evidence");
    return { groupId: null, groupName: null, subGroupId: null, subGroupName: null, source: "none", mappingConfidence: "none", checkedAt, reasons };
}
export const sameDealershipGroup = (a: DealershipGroupIdentity, b: DealershipGroupIdentity): boolean => a.mappingConfidence === "authoritative_id" && b.mappingConfidence === "authoritative_id" && a.groupId === b.groupId;
export const DEALER_GROUP_MAY_INFLUENCE = ["market_context", "acquisition_intelligence", "management_analytics"] as const;
export const dealerGroupMayInfluence = (conclusion: string): boolean => (DEALER_GROUP_MAY_INFLUENCE as readonly string[]).includes(conclusion);
