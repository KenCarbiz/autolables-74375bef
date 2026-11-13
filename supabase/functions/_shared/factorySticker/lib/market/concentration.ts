// GENERATED — do not edit.
// Mirror of src/lib/market/concentration.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
export const CONCENTRATION_CAP = 0.2;
export const MIN_SOURCES_FOR_CAP = Math.ceil(1 / CONCENTRATION_CAP);
const MAX_PASSES = 24;
const EPSILON = 1e-9;
export interface ConcentrationInput {
    key: string;
    rooftop: string;
    group: string;
    weight: number;
}
export interface ConcentrationResult {
    cappedWeights: Map<string, number>;
    rooftopShares: Record<string, number>;
    groupShares: Record<string, number>;
    topRooftopShare: number;
    topGroupShare: number;
    independentRooftopCount: number;
    independentGroupCount: number;
    cappedRooftops: string[];
    cappedGroups: string[];
    effectiveRooftopCap: number;
    effectiveGroupCap: number;
    underAllocated: boolean;
    strictConcentrationSatisfied: boolean;
}
function sharesBy(weights: Map<string, number>, items: ConcentrationInput[], pick: (i: ConcentrationInput) => string): {
    shares: Record<string, number>;
    total: number;
} {
    const total = items.reduce((a, i) => a + (weights.get(i.key) ?? 0), 0);
    const byKey = new Map<string, number>();
    for (const i of items)
        byKey.set(pick(i), (byKey.get(pick(i)) ?? 0) + (weights.get(i.key) ?? 0));
    const shares: Record<string, number> = {};
    for (const [k, v] of byKey)
        shares[k] = total > 0 ? v / total : 0;
    return { shares, total };
}
export function applyConcentrationCaps(items: ConcentrationInput[]): ConcentrationResult {
    const weights = new Map<string, number>();
    for (const i of items)
        weights.set(i.key, Math.max(0, i.weight));
    const rooftops = [...new Set(items.map((i) => i.rooftop))];
    const groups = [...new Set(items.map((i) => i.group))];
    const cappedRooftops = new Set<string>();
    const cappedGroups = new Set<string>();
    const effectiveRooftopCap = rooftops.length ? Math.max(CONCENTRATION_CAP, 1 / rooftops.length) : 1;
    const effectiveGroupCap = groups.length ? Math.max(CONCENTRATION_CAP, 1 / groups.length) : 1;
    const scopes = [
        { keys: rooftops, cap: effectiveRooftopCap, pick: (i: ConcentrationInput) => i.rooftop, capped: cappedRooftops },
        { keys: groups, cap: effectiveGroupCap, pick: (i: ConcentrationInput) => i.group, capped: cappedGroups },
    ];
    for (let pass = 0; pass < MAX_PASSES; pass++) {
        let changed = false;
        for (const scope of scopes) {
            const { shares, total } = sharesBy(weights, items, scope.pick);
            if (!(total > 0))
                continue;
            for (const key of scope.keys) {
                if ((shares[key] ?? 0) <= scope.cap + EPSILON)
                    continue;
                const members = items.filter((i) => scope.pick(i) === key);
                const current = members.reduce((a, i) => a + (weights.get(i.key) ?? 0), 0);
                const allowed = scope.cap * total;
                const factor = current > 0 ? allowed / current : 0;
                for (const m of members)
                    weights.set(m.key, (weights.get(m.key) ?? 0) * factor);
                scope.capped.add(key);
                changed = true;
            }
        }
        if (!changed)
            break;
    }
    const rooftopShares = sharesBy(weights, items, (i) => i.rooftop).shares;
    const groupShares = sharesBy(weights, items, (i) => i.group).shares;
    const contributing = (shares: Record<string, number>) => Object.values(shares).filter((s) => s > EPSILON).length;
    const top = (shares: Record<string, number>) => {
        const values = Object.values(shares);
        return values.length ? Math.max(...values) : 0;
    };
    return {
        cappedWeights: weights,
        rooftopShares,
        groupShares,
        topRooftopShare: top(rooftopShares),
        topGroupShare: top(groupShares),
        independentRooftopCount: contributing(rooftopShares),
        independentGroupCount: contributing(groupShares),
        cappedRooftops: [...cappedRooftops],
        cappedGroups: [...cappedGroups],
        effectiveRooftopCap,
        effectiveGroupCap,
        underAllocated: rooftops.length < MIN_SOURCES_FOR_CAP,
        strictConcentrationSatisfied: rooftops.length >= MIN_SOURCES_FOR_CAP
            && groups.length >= MIN_SOURCES_FOR_CAP
            && top(rooftopShares) <= CONCENTRATION_CAP + EPSILON
            && top(groupShares) <= CONCENTRATION_CAP + EPSILON,
    };
}
