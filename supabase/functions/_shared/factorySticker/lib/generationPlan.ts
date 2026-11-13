// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/generationPlan.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
import { evaluateStickerEligibility, type StickerEligibilityResult } from "./oem/eligibility.ts";
import { selectOemTemplate, validatePageGeometry, validateTemplateOverride, type OemTemplateSelectionResult, type TemplateOverrideOption, } from "./oem/selection.ts";
import { resolveReferenceVariant, type ReferenceVariantResolution } from "./oem/referenceVariants.ts";
import { resolveRenderProfile, templateRoutingFacts, type FactoryStickerRenderData, type FactoryStickerTheme } from "./render/contract.ts";
import { withCatalogEquipment } from "./render/catalogEquipment.ts";
import { withCatalogEpaGuard } from "./render/catalogNeovin.ts";
import type { CatalogResolution } from "./oem/templateCatalog.ts";
import { fitOk } from "./render/layout.ts";
import { checkRenderedCompleteness, type CompletenessReport } from "./render/completeness.ts";
import type { ResolvedThemeProfile } from "./oem/profiles.ts";
import { evaluateAutoPublish, reconcileMsrp, type AutoPublishDecision, type MsrpReconciliation } from "./autoPublish.ts";
export interface NormalizedForPlan {
    data: FactoryStickerRenderData;
    confidence: "HIGH" | "MEDIUM" | "LOW";
    baseMsrp: number | null;
    destinationCharge: number | null;
    optionsTotal: number | null;
    statedTotalMsrp: number | null;
    unverifiedOptions?: string[];
}
export interface StoredTemplateOverride {
    template_key?: string;
    layout_family?: string;
    theme_version?: string;
    reason?: string;
}
export interface GenerationPlanInput {
    vin: string;
    condition: string;
    corroboratingCondition: string | null;
    corroboratingMake: string | null;
    manufacturer: string | null;
    stickerSettings: Record<string, unknown>;
    dealerSettings: Record<string, unknown>;
    normalized: NormalizedForPlan;
    templateVersion: string;
    storedOverride: StoredTemplateOverride | null;
}
export type GenerationPlan = {
    kind: "ineligible";
    eligibility: StickerEligibilityResult;
} | {
    kind: "selection_blocked";
    eligibility: StickerEligibilityResult;
    selection: OemTemplateSelectionResult;
    referenceVariant: ReferenceVariantResolution;
    code: "OEM_TEMPLATE_CONFLICT" | "OEM_TEMPLATE_UNSUPPORTED";
    reason: string;
} | {
    kind: "ready";
    eligibility: StickerEligibilityResult;
    selection: OemTemplateSelectionResult;
    referenceVariant: ReferenceVariantResolution;
    storedOverride: StoredTemplateOverride | null;
    overrideDiscarded: {
        requested: string;
        reason: string | null;
    } | null;
    appliedOverride: TemplateOverrideOption | null;
    make: string;
    canonicalOemId: string | null;
    profile: ResolvedThemeProfile;
    profileFamily: string;
    theme: FactoryStickerTheme;
    reconciliation: MsrpReconciliation;
    templateRouting: CatalogResolution & {
        servedByApprovedMaster: boolean;
    };
};
export function planGeneration(input: GenerationPlanInput): GenerationPlan {
    const { normalized, stickerSettings, dealerSettings } = input;
    const eligibility = evaluateStickerEligibility({
        condition: input.condition,
        corroboratingConditions: [input.corroboratingCondition],
        settings: {
            enabled: stickerSettings.enabled !== false,
            used_reproduction: stickerSettings.used_reproduction !== false,
        },
        hasVinSpecificBuildData: !normalized.data.generic,
        hasManufacturerPricing: !!normalized.baseMsrp && !!normalized.statedTotalMsrp,
    });
    if (!eligibility.eligible)
        return { kind: "ineligible", eligibility };
    const make = normalized.data.identity.make;
    const modelYearNum = Number(normalized.data.identity.year);
    const modelYear = Number.isFinite(modelYearNum) ? modelYearNum : null;
    const selection = selectOemTemplate({
        vin: input.vin,
        modelYear,
        canonicalMake: make,
        canonicalManufacturer: input.manufacturer,
        canonicalModel: normalized.data.identity.model,
        market: "US",
        condition: input.condition,
        corroboratingMakes: [input.corroboratingMake],
    });
    const referenceVariant = resolveReferenceVariant({
        make,
        modelYear,
        model: normalized.data.identity.model,
        trim: normalized.data.identity.trim,
        drivetrain: normalized.data.mechanical?.drivetrain ?? null,
        fuelType: normalized.data.epa?.fuelType ?? null,
    });
    if (selection.selectionStatus === "unsupported" || selection.selectionStatus === "conflict") {
        const code = selection.selectionStatus === "conflict"
            ? "OEM_TEMPLATE_CONFLICT" as const : "OEM_TEMPLATE_UNSUPPORTED" as const;
        return {
            kind: "selection_blocked",
            eligibility,
            selection,
            referenceVariant,
            code,
            reason: `${code}: ${selection.reasons.join("; ") || "no registered template for this vehicle"}`,
        };
    }
    const storedOverride = input.storedOverride;
    const overrideVerdict = storedOverride?.template_key
        ? validateTemplateOverride(selection.canonicalMake, storedOverride.template_key, modelYear)
        : null;
    const appliedOverride = overrideVerdict?.allowed ? overrideVerdict.option : null;
    const overrideDiscarded = storedOverride?.template_key && !overrideVerdict?.allowed
        ? { requested: storedOverride.template_key, reason: overrideVerdict?.reason ?? null } : null;
    const canonicalOemId = make ? make.toLowerCase().replace(/[^a-z0-9]+/g, "-") : null;
    const profile = resolveRenderProfile(normalized.data);
    const profileFamily = appliedOverride && !appliedOverride.isAutomatic
        ? appliedOverride.layoutFamily
        : profile.profile.layoutFamily;
    const theme: FactoryStickerTheme = {
        oemThemeId: canonicalOemId ? `oem-${canonicalOemId}` : "oem-neutral",
        oemThemeVersion: appliedOverride && !appliedOverride.isAutomatic
            ? appliedOverride.themeVersion : profile.profile.themeVersion,
        canonicalOemId,
        templateFamilyId: profileFamily,
        templateVersion: input.templateVersion,
        logoAssetId: String(dealerSettings.dealer_logo_url ?? dealerSettings.logo_url ?? "").trim() || null,
        logoAssetVersion: null,
        templateOverrideKey: appliedOverride && !appliedOverride.isAutomatic
            ? appliedOverride.templateKey : null,
    };
    const reconciliation = reconcileMsrp({
        baseMsrp: normalized.baseMsrp,
        optionsTotal: normalized.optionsTotal,
        destinationCharge: normalized.destinationCharge,
        statedTotalMsrp: normalized.statedTotalMsrp,
    });
    return {
        kind: "ready",
        eligibility,
        selection,
        referenceVariant,
        storedOverride,
        overrideDiscarded,
        appliedOverride,
        make,
        canonicalOemId,
        profile,
        profileFamily,
        theme,
        reconciliation,
        templateRouting: templateRoutingFacts(normalized.data),
    };
}
export interface RenderedLayoutFacts {
    pages: number;
    widthPt: number;
    heightPt: number;
    drawnStrings: string[];
    printedEquipment: string[];
    fit?: {
        ok: boolean;
        detail?: string;
        equipmentScope?: "full" | "selected";
        equipmentCounts?: {
            printed: number;
            total: number;
            lines: number;
        };
        figmaMaster?: boolean;
    };
}
export interface RenderAssessment {
    qaChecks: Record<string, boolean>;
    qaPass: boolean;
    geometry: ReturnType<typeof validatePageGeometry>;
    completeness: CompletenessReport;
    decision: AutoPublishDecision;
}
type ReadyPlan = Extract<GenerationPlan, {
    kind: "ready";
}>;
export function assessRenderedSticker(input: {
    vin: string;
    hasBuildSheet: boolean;
    normalized: NormalizedForPlan;
    plan: ReadyPlan;
    canonicalPassportUrl: string | null;
    layout: RenderedLayoutFacts;
}): RenderAssessment {
    const { normalized, plan, layout, vin, canonicalPassportUrl } = input;
    const { selection, eligibility, appliedOverride, reconciliation } = plan;
    const drawn = layout.drawnStrings || [];
    const catalogTemplate = plan.templateRouting.status === "approved_match" && !plan.templateRouting.servedByApprovedMaster
        ? plan.templateRouting.template : null;
    const pageFormat = catalogTemplate
        ? {
            widthInches: catalogTemplate.page.widthPt / 72,
            heightInches: catalogTemplate.page.heightPt / 72,
            orientation: catalogTemplate.page.orientation,
            expectedPageCount: 1,
        }
        : selection.definition?.pageFormat ?? null;
    const geometry = pageFormat
        ? validatePageGeometry(pageFormat, {
            widthPt: Number(layout.widthPt ?? 0),
            heightPt: Number(layout.heightPt ?? 0),
            pageCount: Number(layout.pages ?? 0),
        })
        : { pass: true, code: "OK" as const, reasons: [] };
    const completenessData = catalogTemplate
        ? withCatalogEpaGuard(withCatalogEquipment(normalized.data, catalogTemplate.id)) : normalized.data;
    const completeness = checkRenderedCompleteness(completenessData, {
        width: Number(layout.widthPt ?? 0),
        height: Number(layout.heightPt ?? 0),
        mode: "STANDARD",
        pages: [],
        drawnStrings: drawn,
        printedEquipment: layout.printedEquipment || [],
        fontFamilies: { heading: "", body: "", numeric: "" },
        fit: { ...fitOk(0, 0), ...(layout.fit?.equipmentScope ? { equipmentScope: layout.fit.equipmentScope } : {}), ...(layout.fit?.equipmentCounts ? { equipmentCounts: layout.fit.equipmentCounts } : {}), ...(layout.fit?.figmaMaster ? { figmaMaster: true } : {}) },
    });
    const qaChecks = {
        vin_drawn: drawn.includes(vin),
        content_complete: completeness.pass,
        barcode_is_vin: normalized.data.barcodePayload === vin,
        qr_is_canonical_passport: !!canonicalPassportUrl && normalized.data.passportUrl === canonicalPassportUrl,
        page_count_ok: geometry.pass,
        one_page_fit_ok: layout.fit ? layout.fit.ok : true,
    };
    const decision = evaluateAutoPublish({
        hasBuildSheet: input.hasBuildSheet,
        eligibility: {
            eligible: eligibility.eligible,
            status: eligibility.status,
            reasons: eligibility.reasons,
        },
        selection: {
            selectionStatus: selection.selectionStatus,
            downgrades: selection.downgrades,
            conflictingFields: selection.conflictingFields,
            hasTemplateDefinition: !!selection.definition,
        },
        templateOverrideActive: !!appliedOverride && !appliedOverride.isAutomatic,
        reconciliation,
        confidence: normalized.confidence,
        canonicalPassportUrl,
        qaChecks,
        completeness,
        geometry,
        onePageFit: layout.fit ? { ok: layout.fit.ok, detail: layout.fit.detail ?? "" } : { ok: true, detail: "" },
        unverifiedOptions: normalized.unverifiedOptions ?? [],
        epaAvailable: completenessData.epa != null,
        epaConflict: normalized.data.neovin?.epaConflict ?? null,
    });
    return {
        qaChecks,
        qaPass: Object.values(qaChecks).every(Boolean),
        geometry,
        completeness,
        decision,
    };
}
