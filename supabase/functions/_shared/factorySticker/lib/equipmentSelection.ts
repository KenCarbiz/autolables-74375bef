// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/equipmentSelection.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
import type { EquipmentCategory } from "./types.ts";
export interface ClassifiedItem {
    item: string;
    category: EquipmentCategory;
    order: number;
    key: boolean;
}
export interface EquipmentLine {
    text: string;
    category: EquipmentCategory;
    sources: string[];
    order: number;
    score: number;
}
const VEHICLE_CLASS = /^(?:(?:full|mid|compact|subcompact|large|small|executive|luxury|midsize|premium)[ -]?(?:size)?\s+)+(?:crossover\s+)?(?:suv|sedan|coupe|truck|pickup|wagon|van|minivan|hatchback|convertible|crossover|cuv)s?$/i;
export const isVehicleClassLabel = (item: string): boolean => VEHICLE_CLASS.test(item.trim());
const POSITIONS = ["front", "rear", "left", "right", "driver", "passenger", "second row", "third row"];
const POSITION_RE = new RegExp(`^(${POSITIONS.join("|")})\\s+(.+)$`, "i");
const PREFIX_RE = /^(.{3,}?)\s*(?:-\s*|\(\s*)([^()]+?)\)?$/;
const norm = (s: string): string => s.replace(/\s+/g, " ").trim();
const key = (s: string): string => norm(s).toLowerCase();
interface Draft {
    text: string;
    category: EquipmentCategory;
    sources: ClassifiedItem[];
}
function normalize(items: ClassifiedItem[]): Draft[] {
    const seen = new Set<string>();
    const unique = items.filter((i) => {
        const k = key(i.item);
        if (!k || seen.has(k))
            return false;
        seen.add(k);
        return true;
    });
    const used = new Set<ClassifiedItem>();
    const drafts: Draft[] = [];
    const byRest = new Map<string, ClassifiedItem[]>();
    for (const i of unique) {
        const m = POSITION_RE.exec(norm(i.item));
        if (!m)
            continue;
        const k = `${i.category}|${m[2].toLowerCase()}`;
        byRest.set(k, [...(byRest.get(k) ?? []), i]);
    }
    const merged = new Map<ClassifiedItem, Draft | null>();
    for (const group of byRest.values()) {
        const positions = group.map((i) => POSITION_RE.exec(norm(i.item))![1].toLowerCase());
        if (group.length < 2 || new Set(positions).size !== group.length)
            continue;
        const rest = POSITION_RE.exec(norm(group[0].item))![2];
        const labels = [...group].sort((a, b) => a.order - b.order)
            .map((i) => POSITION_RE.exec(norm(i.item))![1].replace(/^./, (c) => c.toUpperCase()));
        const draft: Draft = { text: `${labels.join("/")} ${rest}`, category: group[0].category, sources: group };
        group.forEach((i, idx) => { used.add(i); merged.set(i, idx === 0 ? draft : null); });
    }
    const byPrefix = new Map<string, Array<{
        i: ClassifiedItem;
        prefix: string;
        suffix: string;
    }>>();
    for (const i of unique) {
        if (used.has(i))
            continue;
        const m = PREFIX_RE.exec(norm(i.item));
        if (!m || m[1].length < 5 || !/^[A-Z0-9]/.test(m[2].trim()))
            continue;
        const k = `${i.category}|${m[1].toLowerCase()}`;
        byPrefix.set(k, [...(byPrefix.get(k) ?? []), { i, prefix: m[1], suffix: m[2].trim() }]);
    }
    for (const group of byPrefix.values()) {
        if (group.length < 2)
            continue;
        const draft: Draft = {
            text: `${group[0].prefix}: ${group.map((g) => g.suffix).join(", ")}`,
            category: group[0].i.category,
            sources: group.map((g) => g.i),
        };
        group.forEach((g, idx) => { used.add(g.i); merged.set(g.i, idx === 0 ? draft : null); });
    }
    for (const i of unique) {
        if (!used.has(i))
            drafts.push({ text: norm(i.item), category: i.category, sources: [i] });
        else {
            const d = merged.get(i);
            if (d)
                drafts.push(d);
        }
    }
    return drafts;
}
const CATEGORY_BASE: Record<EquipmentCategory, number> = {
    POWERTRAIN: 20,
    SAFETY_SECURITY: 15,
    TECHNOLOGY: 12,
    COMFORT_CONVENIENCE: 10,
    INTERIOR: 5,
    EXTERIOR: 5,
    FUNCTIONAL: 0,
    OTHER: -5,
};
const MARQUEE: Array<[
    RegExp,
    number
]> = [
    [/engine|transmission|drive ?type|turbo|horsepower|all.wheel|four.wheel|\bawd\b|\b4wd\b|hybrid|cylinder/i, 60],
    [/adaptive cruise|collision|lane|blind spot|emergency braking|airbag|propilot|driver assist|pedestrian|cross traffic|parking assist|surround|360|camera|autonomous/i, 50],
    [/carplay|android auto|navigation|touch ?screen|bose|audio|speakers|wireless charging|head-up|wi-?fi|bluetooth|satellite/i, 45],
    [/heated|ventilated|cooled|massage|leather|memory|power (?:front )?seat|keyless|remote start|climate|zone air|steering wheel/i, 40],
    [/roof|sunroof|moonroof|panoramic/i, 40],
    [/\balloy\b|\bwheels?\b|\btires?\b/i, 30],
];
const TRIVIA: Array<[
    RegExp,
    number
]> = [
    [/\b\d+(?:\.\d+)?\s*(?:in|mm|cm|lbs?|gal|cu ?ft|kg|l)\b|width|length|height|wheelbase|track|weight|capacity|turning|curb/i, 80],
    [/\bisofix\b|\blatch\b|\bspare\b|tire repair|cargo area (?:light|lamp)|\bjack\b|\bglove\b|cup holder|grab handle|sun ?visor|vanity|coat hook|floor mat|assist handle/i, 70],
];
export function scoreEquipment(text: string, category: EquipmentCategory, key: boolean): number {
    let score = (key ? 100 : 0) + CATEGORY_BASE[category];
    score += Math.max(0, ...MARQUEE.filter(([re]) => re.test(text)).map(([, w]) => w));
    score -= Math.max(0, ...TRIVIA.filter(([re]) => re.test(text)).map(([, w]) => w));
    return score;
}
export interface EquipmentSelectionBase {
    lines: EquipmentLine[];
    total: number;
}
export function normalizeEquipment(items: ClassifiedItem[]): EquipmentSelectionBase {
    const seen = new Set<string>();
    let total = 0;
    for (const i of items) {
        const k = key(i.item);
        if (k && !seen.has(k)) {
            seen.add(k);
            total++;
        }
    }
    const lines = normalize(items.filter((i) => !isVehicleClassLabel(i.item))).map((d) => ({
        text: d.text,
        category: d.category,
        sources: d.sources.map((s) => s.item),
        order: Math.min(...d.sources.map((s) => s.order)),
        score: Math.max(...d.sources.map((s) => scoreEquipment(d.text, d.category, s.key))),
    }));
    return { lines: lines.sort((a, b) => a.order - b.order), total };
}
const CATEGORY_SEQUENCE: EquipmentCategory[] = [
    "POWERTRAIN",
    "FUNCTIONAL",
    "COMFORT_CONVENIENCE",
    "SAFETY_SECURITY",
    "TECHNOLOGY",
    "EXTERIOR",
    "INTERIOR",
    "OTHER",
];
export function selectEquipment(lines: EquipmentLine[], count: number): EquipmentLine[] {
    const top = [...lines]
        .sort((a, b) => b.score - a.score || a.order - b.order)
        .slice(0, Math.max(0, count));
    return top.sort((a, b) => CATEGORY_SEQUENCE.indexOf(a.category) - CATEGORY_SEQUENCE.indexOf(b.category) || a.order - b.order);
}
export const SELECTED_EQUIPMENT_NOTE = "Selected standard equipment shown. Scan for complete vehicle specifications.";
