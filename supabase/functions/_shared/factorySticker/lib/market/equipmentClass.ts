// GENERATED — do not edit.
// Mirror of src/lib/market/equipmentClass.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
const FACTORY_CODE = /^[A-Z]{1,2}[0-9]{2}$/;
const DEALER_INSTALLED = /\(\s*PIO\s*\)/i;
const COHORT_MATERIAL_TERMS = [
    "package",
    "awd",
    "all wheel drive",
    "4wd",
    "4x4",
    "fwd",
    "rwd",
    "turbo",
    "hybrid",
    "plug in",
    "plug-in",
    "electric",
    "diesel",
    "v6",
    "v8",
    "long range",
    "extended range",
    "battery",
    "third row",
    "3rd row",
    "second row captain",
    "captain chairs",
    "seating",
    "performance",
    "sport tuned",
    "towing",
    "tow package",
] as const;
const DESCRIPTIVE_TERMS = [
    "paint",
    "color",
    "colour",
    "splash guard",
    "mud flap",
    "floor mat",
    "cargo mat",
    "cargo net",
    "scuff plate",
    "kick plate",
    "wheel lock",
    "lug nut",
    "roof rail cross bar",
    "cross bars",
    "pin stripe",
    "pinstripe",
    "emblem",
    "badge",
    "window tint",
    "mirror cap",
    "door edge",
] as const;
export type EquipmentClass = "cohort_defining" | "descriptive" | "unknown";
export interface ClassifiedEquipment {
    raw: string;
    normalized: string;
    equipmentClass: EquipmentClass;
    reason: string;
}
const normalize = (v: unknown): string | null => {
    if (typeof v !== "string")
        return null;
    const s = v.trim().toLowerCase().replace(/\s+/g, " ");
    return s || null;
};
export function classifyEquipmentEntry(entry: unknown): ClassifiedEquipment | null {
    if (typeof entry !== "string")
        return null;
    const raw = entry.trim();
    const normalized = normalize(entry);
    if (!normalized)
        return null;
    if (DEALER_INSTALLED.test(raw)) {
        return { raw, normalized, equipmentClass: "descriptive", reason: "equipment_dealer_installed" };
    }
    if (FACTORY_CODE.test(raw)) {
        return { raw, normalized, equipmentClass: "cohort_defining", reason: "equipment_factory_code" };
    }
    for (const term of DESCRIPTIVE_TERMS) {
        if (normalized.includes(term)) {
            return { raw, normalized, equipmentClass: "descriptive", reason: `equipment_cosmetic_${term.replace(/\s/g, "_")}` };
        }
    }
    for (const term of COHORT_MATERIAL_TERMS) {
        if (normalized.includes(term)) {
            return { raw, normalized, equipmentClass: "cohort_defining", reason: `equipment_material_${term.replace(/[\s-]/g, "_")}` };
        }
    }
    return { raw, normalized, equipmentClass: "descriptive", reason: "equipment_not_known_material" };
}
export interface EquipmentClassification {
    cohortDefining: string[];
    descriptive: string[];
    unknown: boolean;
    reasons: string[];
}
export function classifyEquipment(entries: unknown): EquipmentClassification {
    if (!Array.isArray(entries)) {
        return { cohortDefining: [], descriptive: [], unknown: true, reasons: ["equipment_source_absent"] };
    }
    const classified = entries
        .map(classifyEquipmentEntry)
        .filter((c): c is ClassifiedEquipment => c !== null);
    if (classified.length === 0) {
        return { cohortDefining: [], descriptive: [], unknown: true, reasons: ["equipment_source_empty"] };
    }
    const cohortDefining = [...new Set(classified.filter((c) => c.equipmentClass === "cohort_defining").map((c) => c.normalized))].sort();
    const descriptive = [...new Set(classified.filter((c) => c.equipmentClass === "descriptive").map((c) => c.normalized))].sort();
    const reasons = [
        `equipment_entries_${classified.length}`,
        `equipment_cohort_defining_${cohortDefining.length}`,
        `equipment_descriptive_${descriptive.length}`,
    ];
    return { cohortDefining, descriptive, unknown: false, reasons };
}
export const MARKETING_PHRASES = [
    "fully loaded",
    "loaded",
    "every option",
    "all the bells",
    "must see",
    "like new",
    "immaculate",
    "one of a kind",
    "rare find",
] as const;
export const isMarketingCopy = (v: unknown): boolean => {
    const s = normalize(v);
    return !!s && MARKETING_PHRASES.some((p) => s.includes(p));
};
export const EQUIPMENT_CATEGORIES = [
    "factory_standard_equipment",
    "factory_available_options",
    "vin_installed_options",
    "dealer_installed_accessories",
    "unknown_unverified",
] as const;
export type EquipmentCategory = (typeof EQUIPMENT_CATEGORIES)[number];
export const INSTALLED_CATEGORIES: EquipmentCategory[] = [
    "factory_standard_equipment",
    "vin_installed_options",
    "dealer_installed_accessories",
];
export const isInstalledCategory = (c: EquipmentCategory): boolean => INSTALLED_CATEGORIES.includes(c);
export interface CategorizedEquipmentItem {
    name: string;
    category: EquipmentCategory;
    source: "neovin" | "available_options_packages" | "feed" | "dealer" | "unknown";
    code?: string;
    msrp?: number;
}
export interface EquipmentLedger {
    factory_standard_equipment: CategorizedEquipmentItem[];
    factory_available_options: CategorizedEquipmentItem[];
    vin_installed_options: CategorizedEquipmentItem[];
    dealer_installed_accessories: CategorizedEquipmentItem[];
    unknown_unverified: CategorizedEquipmentItem[];
}
export const emptyEquipmentLedger = (): EquipmentLedger => ({
    factory_standard_equipment: [],
    factory_available_options: [],
    vin_installed_options: [],
    dealer_installed_accessories: [],
    unknown_unverified: [],
});
export function fileEquipment(ledger: EquipmentLedger, item: CategorizedEquipmentItem): EquipmentLedger {
    const category: EquipmentCategory = item.source === "available_options_packages"
        ? "factory_available_options"
        : item.category;
    const filed = { ...item, category };
    return { ...ledger, [category]: [...ledger[category], filed] };
}
export function installedEquipment(ledger: EquipmentLedger): CategorizedEquipmentItem[] {
    return INSTALLED_CATEGORIES.flatMap((c) => ledger[c]);
}
export function compareConfiguration(ledger: EquipmentLedger): {
    installedNames: string[];
    availableNotInstalled: string[];
    installedNotInCatalog: string[];
} {
    const installed = new Set(installedEquipment(ledger).map((i) => i.name.trim().toLowerCase()));
    const available = new Set(ledger.factory_available_options.map((i) => i.name.trim().toLowerCase()));
    return {
        installedNames: [...installed].sort(),
        availableNotInstalled: [...available].filter((n) => !installed.has(n)).sort(),
        installedNotInCatalog: [...installed].filter((n) => !available.has(n) && available.size > 0).sort(),
    };
}
