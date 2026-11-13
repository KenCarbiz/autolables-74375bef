// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/oem/referenceVariants.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
import type { OemId } from "./identity.ts";
export const REFERENCE_VARIANT_REGISTRY_VERSION = "1.0.0";
export const REFERENCE_FIGMA_FILE_KEY = "bNby4OyBUWhkHvVTbldgy4";
export type PaperSize = "LETTER_LANDSCAPE" | "TABLOID_LANDSCAPE";
export const PAPER_SIZES: Record<PaperSize, {
    widthPt: number;
    heightPt: number;
    label: string;
}> = {
    LETTER_LANDSCAPE: { widthPt: 792, heightPt: 612, label: "US Letter landscape (11 x 8.5 in)" },
    TABLOID_LANDSCAPE: { widthPt: 1224, heightPt: 792, label: "17 x 11 in landscape" },
};
export type Powertrain = "GASOLINE" | "HYBRID" | "PLUG_IN_HYBRID" | "FLEX_FUEL_E85";
export type EnvironmentPanel = "EPA_GASOLINE_MPG" | "EPA_HYBRID_MPG" | "EPA_PHEV_DUAL_MODE" | "CARB_ENVIRONMENTAL";
export type Drivetrain = "AWD" | "4WD" | "RWD" | "FWD";
export interface ReferenceVariant {
    key: string;
    version: string;
    make: string;
    oemId: OemId | null;
    modelYear: number;
    models: string[];
    excludedModels?: string[];
    trimTokens: string[];
    conflictingTrimTokens: string[];
    drivetrain: Drivetrain;
    powertrain: Powertrain;
    market: "US";
    paperSize: PaperSize;
    environmentPanel: EnvironmentPanel;
    partsContentPanel: boolean;
    figma: {
        master: string;
        review: string;
        map: string;
    };
    requiredEvidence: string[];
    sourceGaps: string[];
    layoutStatus: "pending" | "implemented";
}
const COMMON_EVIDENCE = [
    "vin_identity_matches_request",
    "model_year_make_model_trim_match",
    "powertrain_configuration_match",
];
export const REFERENCE_VARIANTS: readonly ReferenceVariant[] = [
    {
        key: "infiniti-2026-qx60-sport-awd",
        version: "1.0.0",
        make: "INFINITI",
        oemId: "INFINITI",
        modelYear: 2026,
        models: ["QX60"],
        trimTokens: ["SPORT"],
        conflictingTrimTokens: ["PURE", "LUXE", "AUTOGRAPH"],
        drivetrain: "AWD",
        powertrain: "GASOLINE",
        market: "US",
        paperSize: "LETTER_LANDSCAPE",
        environmentPanel: "EPA_GASOLINE_MPG",
        partsContentPanel: true,
        figma: { master: "2:12", review: "2:148", map: "41:273" },
        requiredEvidence: [...COMMON_EVIDENCE, "epa_record_exact_configuration", "aala_model_year_carline_match"],
        sourceGaps: ["VIN-specific final assembly and engine/transmission origin need evidence beyond the AALA carline row."],
        layoutStatus: "implemented",
    },
    {
        key: "nissan-2026-pathfinder-platinum-4wd",
        version: "1.0.0",
        make: "NISSAN",
        oemId: "NISSAN",
        modelYear: 2026,
        models: ["PATHFINDER"],
        trimTokens: ["PLATINUM"],
        conflictingTrimTokens: ["S", "SV", "SL", "ROCKCREEK"],
        drivetrain: "4WD",
        powertrain: "GASOLINE",
        market: "US",
        paperSize: "LETTER_LANDSCAPE",
        environmentPanel: "EPA_GASOLINE_MPG",
        partsContentPanel: true,
        figma: { master: "24:167", review: "24:621", map: "41:379" },
        requiredEvidence: [...COMMON_EVIDENCE, "epa_record_exact_configuration", "aala_model_year_carline_match"],
        sourceGaps: ["2026 Pathfinder AALA match is pending; 2025 percentages must never be reused."],
        layoutStatus: "implemented",
    },
    {
        key: "hyundai-2026-santa-fe-hybrid-se-awd",
        version: "1.0.0",
        make: "HYUNDAI",
        oemId: "HYUNDAI",
        modelYear: 2026,
        models: ["SANTAFE", "SANTAFEHYBRID"],
        excludedModels: ["SANTAFEPLUGINHYBRID", "SANTAFEPHEV", "SANTACRUZ"],
        trimTokens: ["SE"],
        conflictingTrimTokens: ["SEL", "LIMITED", "CALLIGRAPHY", "XRT", "BLUE"],
        drivetrain: "AWD",
        powertrain: "HYBRID",
        market: "US",
        paperSize: "TABLOID_LANDSCAPE",
        environmentPanel: "EPA_HYBRID_MPG",
        partsContentPanel: true,
        figma: { master: "25:605", review: "25:812", map: "41:485" },
        requiredEvidence: [...COMMON_EVIDENCE, "epa_record_exact_configuration", "aala_model_year_carline_match", "oem_model_year_warranty_terms"],
        sourceGaps: ["Generic numbered text slots need a semantic crosswalk.", "Original warranty terms need an OEM model-year source."],
        layoutStatus: "implemented",
    },
    {
        key: "mitsubishi-2025-outlander-se-s-awc",
        version: "1.0.0",
        make: "MITSUBISHI",
        oemId: null,
        modelYear: 2025,
        models: ["OUTLANDER"],
        excludedModels: ["OUTLANDERPHEV", "OUTLANDERPLUGINHYBRID", "OUTLANDERSPORT"],
        trimTokens: ["SE"],
        conflictingTrimTokens: ["ES", "SEL", "RALLIART", "TRAILEDITION", "BLACKEDITION"],
        drivetrain: "AWD",
        powertrain: "GASOLINE",
        market: "US",
        paperSize: "TABLOID_LANDSCAPE",
        environmentPanel: "EPA_GASOLINE_MPG",
        partsContentPanel: true,
        figma: { master: "25:1619", review: "25:1906", map: "41:591" },
        requiredEvidence: [...COMMON_EVIDENCE, "epa_record_exact_configuration", "aala_model_year_carline_match"],
        sourceGaps: [
            "Original reference is portrait and was rotated for the landscape template; verify physical size.",
            "Model-year AALA does not prove VIN-specific final assembly.",
        ],
        layoutStatus: "implemented",
    },
    {
        key: "jeep-2024-grand-cherokee-4xe-phev",
        version: "1.0.0",
        make: "JEEP",
        oemId: "JEEP",
        modelYear: 2024,
        models: ["GRANDCHEROKEE", "GRANDCHEROKEE4XE"],
        excludedModels: ["GRANDCHEROKEEL", "GRANDCHEROKEEWK"],
        trimTokens: ["4XE"],
        conflictingTrimTokens: ["TRAILHAWK", "OVERLAND", "SUMMIT", "RESERVE", "ANNIVERSARY", "BASECAMP", "LIMITED"],
        drivetrain: "4WD",
        powertrain: "PLUG_IN_HYBRID",
        market: "US",
        paperSize: "TABLOID_LANDSCAPE",
        environmentPanel: "EPA_PHEV_DUAL_MODE",
        partsContentPanel: true,
        figma: { master: "25:3070", review: "25:3334", map: "41:697" },
        requiredEvidence: [...COMMON_EVIDENCE, "epa_phev_label_mode_fields_validated", "aala_model_year_carline_match"],
        sourceGaps: [
            "PHEV label-mode fields need real-record validation before the dual-mode panel prints.",
            "AALA engine/transmission alternatives cannot be chosen by carline alone.",
        ],
        layoutStatus: "implemented",
    },
    {
        key: "chrysler-2024-pacifica-select-phev",
        version: "1.0.0",
        make: "CHRYSLER",
        oemId: "CHRYSLER",
        modelYear: 2024,
        models: ["PACIFICA", "PACIFICAHYBRID", "PACIFICAPLUGINHYBRID"],
        excludedModels: ["VOYAGER", "GRANDCARAVAN"],
        trimTokens: ["SELECT"],
        conflictingTrimTokens: ["TOURING", "LIMITED", "PINNACLE", "PREMIUM"],
        drivetrain: "FWD",
        powertrain: "PLUG_IN_HYBRID",
        market: "US",
        paperSize: "TABLOID_LANDSCAPE",
        environmentPanel: "EPA_PHEV_DUAL_MODE",
        partsContentPanel: true,
        figma: { master: "25:4667", review: "25:4945", map: "41:803" },
        requiredEvidence: [...COMMON_EVIDENCE, "epa_phev_label_mode_fields_validated", "aala_model_year_carline_match"],
        sourceGaps: [
            "Trim/model-year compatibility and PHEV label semantics need fixtures.",
            "Package membership (S Appearance) must not charge a package and its contents twice.",
        ],
        layoutStatus: "implemented",
    },
    {
        key: "ford-2025-transit-250-cargo-rwd-e85-carb",
        version: "1.0.0",
        make: "FORD",
        oemId: "FORD",
        modelYear: 2025,
        models: ["TRANSIT", "TRANSIT250", "TRANSITCARGOVAN", "TRANSIT250CARGOVAN"],
        excludedModels: ["TRANSITCONNECT", "ETRANSIT", "TRANSITCHASSIS", "TRANSITCUTAWAY"],
        trimTokens: ["250", "CARGO"],
        conflictingTrimTokens: ["150", "350", "350HD", "PASSENGER", "CREW", "TRAIL"],
        drivetrain: "RWD",
        powertrain: "FLEX_FUEL_E85",
        market: "US",
        paperSize: "TABLOID_LANDSCAPE",
        environmentPanel: "CARB_ENVIRONMENTAL",
        partsContentPanel: false,
        figma: { master: "25:7587", review: "25:7819", map: "41:909" },
        requiredEvidence: [...COMMON_EVIDENCE, "carb_configuration_matched_source"],
        sourceGaps: [
            "CARB letter ratings need an authoritative configuration-matched source; EPA scores are never converted.",
            "Passenger MPG and AALA panels do not apply without an applicability source.",
        ],
        layoutStatus: "implemented",
    },
];
export interface ReferenceVariantInput {
    make: string | null;
    modelYear: number | null;
    model: string | null;
    trim: string | null;
    drivetrain: string | null;
    fuelType: string | null;
}
export type ReferenceVariantStatus = "matched" | "review_required" | "unsupported";
export interface ReferenceVariantResolution {
    status: ReferenceVariantStatus;
    variant: ReferenceVariant | null;
    candidates: string[];
    reasons: string[];
    rendering: "variant_layout" | "generic_reproduction_layout";
}
export const normalizeToken = (s: string | null | undefined): string => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]+/g, "");
const trimWords = (s: string | null | undefined): string[] => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim().split(" ").filter(Boolean);
export function normalizeDrivetrain(raw: string | null | undefined): Drivetrain | null {
    const t = normalizeToken(raw);
    if (!t)
        return null;
    if (/^(AWD|ALLWHEELDRIVE|SAWC|SUPERALLWHEELCONTROL|INTELLIGENTAWD)$/.test(t) || t.includes("ALLWHEEL"))
        return "AWD";
    if (/^(4WD|4X4|FOURWHEELDRIVE|4WHEELDRIVE)$/.test(t) || t.includes("FOURWHEEL"))
        return "4WD";
    if (/^(RWD|REARWHEELDRIVE|4X2REAR)$/.test(t) || t.includes("REARWHEEL"))
        return "RWD";
    if (/^(FWD|FRONTWHEELDRIVE)$/.test(t) || t.includes("FRONTWHEEL"))
        return "FWD";
    return null;
}
export function normalizePowertrain(raw: string | null | undefined): Powertrain | null {
    const t = normalizeToken(raw);
    if (!t)
        return null;
    if (/PLUGIN|PHEV/.test(t) || /(GAS|GASOLINE|PREMIUM|REGULAR|MIDGRADE)ANDELECTRICITY$/.test(t))
        return "PLUG_IN_HYBRID";
    if (/E85|FLEXFUEL|FFV/.test(t))
        return "FLEX_FUEL_E85";
    if (/HYBRID|HEV/.test(t))
        return "HYBRID";
    if (/^(GAS|GASOLINE|REGULARUNLEADED|PREMIUMUNLEADED|UNLEADED|PETROL)/.test(t))
        return "GASOLINE";
    if (/^(PREMIUM|REGULAR|MIDGRADE)(GAS|GASOLINE|UNLEADED)?$/.test(t))
        return "GASOLINE";
    return null;
}
const DRIVE_EQUIVALENTS: Partial<Record<Drivetrain, Drivetrain[]>> = {
    "4WD": ["4WD", "AWD"],
};
export function resolveReferenceVariant(input: ReferenceVariantInput): ReferenceVariantResolution {
    const reasons: string[] = [];
    const generic = (status: ReferenceVariantStatus, candidates: string[] = []): ReferenceVariantResolution => ({
        status,
        variant: null,
        candidates,
        reasons,
        rendering: "generic_reproduction_layout",
    });
    const make = normalizeToken(input.make);
    if (!make || !input.modelYear) {
        reasons.push("make and model year are required to match a reference variant");
        return generic("unsupported");
    }
    const model = normalizeToken(input.model);
    const byMake = REFERENCE_VARIANTS.filter((v) => v.make === make && v.modelYear === input.modelYear);
    const candidates = byMake.filter((v) => {
        if (!model)
            return false;
        if (v.excludedModels?.some((m) => model.startsWith(m)))
            return false;
        return v.models.some((m) => model === m || model.startsWith(m));
    });
    if (!candidates.length) {
        reasons.push(`no reference variant for ${make} ${input.modelYear} ${input.model ?? "(model unknown)"}`);
        return generic("unsupported");
    }
    const words = trimWords(`${input.model ?? ""} ${input.trim ?? ""}`);
    const drive = normalizeDrivetrain(input.drivetrain);
    const power = normalizePowertrain(input.fuelType);
    for (const v of candidates) {
        const miss: string[] = [];
        for (const tok of v.trimTokens)
            if (!words.includes(tok))
                miss.push(`trim does not include ${tok}`);
        const conflicts = v.conflictingTrimTokens.filter((tok) => words.includes(tok));
        if (conflicts.length)
            miss.push(`trim names a different trim (${conflicts.join(", ")})`);
        const acceptedDrive = DRIVE_EQUIVALENTS[v.drivetrain] ?? [v.drivetrain];
        if (!drive)
            miss.push("drivetrain unknown");
        else if (!acceptedDrive.includes(drive))
            miss.push(`drivetrain ${drive} is not ${v.drivetrain}`);
        if (!power)
            miss.push("powertrain unknown");
        else if (power !== v.powertrain)
            miss.push(`powertrain ${power} is not ${v.powertrain}`);
        if (!miss.length) {
            return {
                status: "matched",
                variant: v,
                candidates: [v.key],
                reasons: [`matched reference variant ${v.key}`],
                rendering: v.layoutStatus === "implemented" ? "variant_layout" : "generic_reproduction_layout",
            };
        }
        reasons.push(`${v.key}: ${miss.join("; ")}`);
    }
    return generic("review_required", candidates.map((v) => v.key));
}
export function getReferenceVariant(key: string): ReferenceVariant | null {
    return REFERENCE_VARIANTS.find((v) => v.key === key) ?? null;
}
