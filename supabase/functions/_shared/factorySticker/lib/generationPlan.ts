// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/generationPlan.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// The decision steps of one factory-sticker generation, as pure functions.
//
// factory-sticker-orchestrate reads saved data, calls these, and persists
// what they return. They hold no I/O so the exact path production takes —
// eligibility, template selection, reference-variant match, override gate,
// MSRP reconciliation, render QA and the auto-publish verdict — can be run
// against real inventory in a test instead of being inferred.

import { evaluateStickerEligibility, type StickerEligibilityResult } from "./oem/eligibility.ts";
import {
  selectOemTemplate, validatePageGeometry, validateTemplateOverride,
  type OemTemplateSelectionResult, type TemplateOverrideOption,
} from "./oem/selection.ts";
import { resolveReferenceVariant, type ReferenceVariantResolution } from "./oem/referenceVariants.ts";
import { resolveRenderProfile, type FactoryStickerRenderData, type FactoryStickerTheme } from "./render/contract.ts";
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
}

export interface StoredTemplateOverride {
  template_key?: string;
  layout_family?: string;
  theme_version?: string;
  reason?: string;
}

export interface GenerationPlanInput {
  vin: string;
  /** listing.condition, lower-cased. */
  condition: string;
  /** mc_attributes.condition, an independent corroborating signal. */
  corroboratingCondition: string | null;
  /** mc_attributes.make, an independent corroborating signal. */
  corroboratingMake: string | null;
  /** build_sheet.manufacturer. */
  manufacturer: string | null;
  /** dealer_profiles.settings.factory_sticker. */
  stickerSettings: Record<string, unknown>;
  /** dealer_profiles.settings, for the dealer logo reference. */
  dealerSettings: Record<string, unknown>;
  normalized: NormalizedForPlan;
  templateVersion: string;
  storedOverride: StoredTemplateOverride | null;
}

export type GenerationPlan =
  | { kind: "ineligible"; eligibility: StickerEligibilityResult }
  | {
    kind: "selection_blocked";
    eligibility: StickerEligibilityResult;
    selection: OemTemplateSelectionResult;
    referenceVariant: ReferenceVariantResolution;
    code: "OEM_TEMPLATE_CONFLICT" | "OEM_TEMPLATE_UNSUPPORTED";
    reason: string;
  }
  | {
    kind: "ready";
    eligibility: StickerEligibilityResult;
    selection: OemTemplateSelectionResult;
    referenceVariant: ReferenceVariantResolution;
    storedOverride: StoredTemplateOverride | null;
    overrideDiscarded: { requested: string; reason: string | null } | null;
    appliedOverride: TemplateOverrideOption | null;
    make: string;
    canonicalOemId: string | null;
    profile: ResolvedThemeProfile;
    profileFamily: string;
    theme: FactoryStickerTheme;
    reconciliation: MsrpReconciliation;
  };

export function planGeneration(input: GenerationPlanInput): GenerationPlan {
  const { normalized, stickerSettings, dealerSettings } = input;

  const eligibility = evaluateStickerEligibility({
    condition: input.condition,
    corroboratingConditions: [input.corroboratingCondition],
    settings: {
      enabled: stickerSettings.enabled !== false,
      // Opt-OUT, matching DEFAULT_FACTORY_STICKER_SETTINGS: a tenant that has
      // never opened the Factory Sticker panel has no `factory_sticker` key.
      used_reproduction: stickerSettings.used_reproduction !== false,
    },
    hasVinSpecificBuildData: !normalized.data.generic,
    hasManufacturerPricing: !!normalized.baseMsrp && !!normalized.statedTotalMsrp,
  });
  if (!eligibility.eligible) return { kind: "ineligible", eligibility };

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
      kind: "selection_blocked", eligibility, selection, referenceVariant, code,
      reason: `${code}: ${selection.reasons.join("; ") || "no registered template for this vehicle"}`,
    };
  }

  // An authorized manual override replaces the automatic choice, but only one
  // the compatibility gate still accepts: a stale override naming a template
  // that is no longer valid for this make is discarded, never applied.
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
    kind: "ready", eligibility, selection, referenceVariant, storedOverride,
    overrideDiscarded, appliedOverride, make, canonicalOemId, profile,
    profileFamily, theme, reconciliation,
  };
}

export interface RenderedLayoutFacts {
  pages: number;
  widthPt: number;
  heightPt: number;
  drawnStrings: string[];
  printedEquipment: string[];
  /** Absent on a legacy payload; treated as a pass so old callers still run. */
  fit?: { ok: boolean; detail?: string };
}

export interface RenderAssessment {
  qaChecks: Record<string, boolean>;
  qaPass: boolean;
  geometry: ReturnType<typeof validatePageGeometry>;
  completeness: CompletenessReport;
  decision: AutoPublishDecision;
}

type ReadyPlan = Extract<GenerationPlan, { kind: "ready" }>;

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
  // Page geometry is checked against the template's own declared format, not
  // a shared assumption: a portrait template must never pass because the
  // landscape one would have.
  const geometry = selection.definition
    ? validatePageGeometry(selection.definition.pageFormat, {
      widthPt: Number(layout.widthPt ?? 0),
      heightPt: Number(layout.heightPt ?? 0),
      pageCount: Number(layout.pages ?? 0),
    })
    : { pass: true, code: "OK" as const, reasons: [] };
  // Fit is never trusted. The manifest states everything the document is
  // required to print and the render is checked against it.
  const completeness = checkRenderedCompleteness(normalized.data, {
    width: Number(layout.widthPt ?? 0),
    height: Number(layout.heightPt ?? 0),
    mode: "STANDARD",
    pages: [],
    drawnStrings: drawn,
    printedEquipment: layout.printedEquipment || [],
    fontFamilies: { heading: "", body: "", numeric: "" },
    fit: fitOk(0, 0),
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
  });
  return {
    qaChecks,
    qaPass: Object.values(qaChecks).every(Boolean),
    geometry, completeness, decision,
  };
}
