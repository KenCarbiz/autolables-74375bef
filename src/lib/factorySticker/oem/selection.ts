// Deterministic OEM template selection.
//
// The identity layer (identity.ts) answers "which brand is this?" and the
// profile layer (profiles.ts) answers "which visual identity governs that
// brand for this model year?". This module is the decision layer between
// them and the orchestrator: it publishes the per-template contract
// (page geometry, required data, blocking validations) and turns a
// candidate vehicle record into an explainable selection result.
//
// It never guesses. Every path that cannot name one canonical make and
// one registered template returns a non-"selected" status with reasons,
// and the orchestrator refuses to publish on those states.

import type { OemId } from "./identity.ts";
import { OEM_REGISTRY, resolveOem } from "./identity.ts";
import { resolveThemeProfile } from "./profiles.ts";
import { PAGE_HEIGHT, PAGE_WIDTH } from "../render/layout.ts";

export type SelectionStatus =
  | "selected"
  | "manual_review"
  | "unsupported"
  | "conflict"
  | "ineligible";

export interface OemPageFormat {
  widthInches: number;
  heightInches: number;
  orientation: "portrait" | "landscape";
  /** Hard page count. Exceeding it is a Layout Overflow, not a taller page. */
  expectedPageCount: number;
  /** A continuation page is permitted for equipment-heavy builds only. */
  continuationAllowed: boolean;
}

export interface OemTemplateDefinition {
  key: string;
  displayName: string;
  canonicalMake: OemId;
  supportedMarkets: string[];
  supportedVehicleTypes: string[];
  supportedFuelTypes: string[];
  pageFormat: OemPageFormat;
  requiredDataFields: string[];
  blockingValidations: string[];
  templateVersion: string;
  layoutFamily: string;
  renderer: string;
  /** Owner acceptance state carried from the authored profile. */
  profileStatus: string;
  logoAuthorized: boolean;
}

const PT_PER_INCH = 72;

// Every template the engine ships renders through the one landscape US
// Letter document. Page geometry is declared per template anyway so a
// future portrait or non-Letter brand cannot silently inherit these.
const SHARED_PAGE_FORMAT: OemPageFormat = {
  widthInches: PAGE_WIDTH / PT_PER_INCH,
  heightInches: PAGE_HEIGHT / PT_PER_INCH,
  orientation: "landscape",
  expectedPageCount: 1,
  continuationAllowed: true,
};

// Fields the shared sticker-data contract must carry before a customer-
// facing document may be produced. Absence is a blocker, never a guess.
const SHARED_REQUIRED_FIELDS = [
  "vin",
  "identity.year",
  "identity.make",
  "identity.model",
  "pricing.baseMsrp",
  "pricing.totalMsrp",
  "passportUrl",
  "barcodePayload",
];

const SHARED_BLOCKING_VALIDATIONS = [
  "msrp_reconciles_exactly",
  "vin_matches_barcode_payload",
  "qr_is_canonical_passport_url",
  "page_geometry_matches_template",
  "no_fabricated_regulatory_data",
];

const SUPPORTED_FUEL_TYPES = [
  "gasoline", "diesel", "hybrid", "plug-in hybrid", "electric", "hydrogen",
];

const SUPPORTED_VEHICLE_TYPES = ["car", "truck", "suv", "van", "chassis_cab"];

const TEMPLATE_VERSION = "1.0.0";
const RENDERER = "factorySticker/render/layout";

const templateKeyFor = (oemId: OemId): string =>
  `oem-${oemId.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

/**
 * The registered template for a brand, or null when the brand has no
 * entry. Built from the same profile resolution the renderer uses, so a
 * registry entry can never describe a template the renderer would not
 * actually produce.
 */
export function getTemplateDefinition(
  oemId: OemId,
  modelYear?: number | null,
): OemTemplateDefinition | null {
  const identity = OEM_REGISTRY[oemId];
  if (!identity || oemId === "AUTOLABELS_FALLBACK") return null;
  const resolved = resolveThemeProfile(identity.displayName, modelYear ?? null);
  if (resolved.resolution !== "EXACT") return null;
  return {
    key: templateKeyFor(oemId),
    displayName: identity.displayName,
    canonicalMake: oemId,
    supportedMarkets: ["US"],
    supportedVehicleTypes: [...SUPPORTED_VEHICLE_TYPES],
    supportedFuelTypes: [...SUPPORTED_FUEL_TYPES],
    pageFormat: { ...SHARED_PAGE_FORMAT },
    requiredDataFields: [...SHARED_REQUIRED_FIELDS],
    blockingValidations: [...SHARED_BLOCKING_VALIDATIONS],
    templateVersion: TEMPLATE_VERSION,
    layoutFamily: resolved.profile.layoutFamily,
    renderer: RENDERER,
    profileStatus: resolved.profile.status,
    logoAuthorized: resolved.profile.logoAuthorized,
  };
}

export function listTemplateDefinitions(modelYear?: number | null): OemTemplateDefinition[] {
  return (Object.keys(OEM_REGISTRY) as OemId[])
    .map((id) => getTemplateDefinition(id, modelYear))
    .filter((d): d is OemTemplateDefinition => d !== null);
}

export interface OemTemplateSelectionInput {
  vin?: string | null;
  modelYear?: number | null;
  /** Public brand from a trusted VIN decode. The only field that may select. */
  canonicalMake?: string | null;
  /** Corporate manufacturer. Never sufficient on its own. */
  canonicalManufacturer?: string | null;
  canonicalModel?: string | null;
  market?: string | null;
  condition?: string | null;
  /** Independent trusted decodes, used to detect cross-source conflict. */
  corroboratingMakes?: Array<string | null | undefined>;
}

// Machine-readable record of every reason the selection confidence was
// reduced. `reasons` is prose for a human; this is what a downstream policy
// is allowed to branch on, so no consumer has to pattern-match sentences.
// Anything that lowers confidence MUST add a code here — a policy that reads
// this list treats an unrecognised code as disqualifying, so the fail-closed
// behaviour depends on the list being complete.
export type SelectionDowngrade =
  | "make_alias"
  | "make_fuzzy"
  | "model_year_missing"
  | "generated_fallback_profile";

export interface OemTemplateSelectionResult {
  templateKey: string | null;
  templateVersion: string | null;
  templateFamily: string | null;
  canonicalMake: OemId | null;
  confidence: number;
  selectionStatus: SelectionStatus;
  reasons: string[];
  downgrades: SelectionDowngrade[];
  conflictingFields: string[];
  sourceReferences: string[];
  definition: OemTemplateDefinition | null;
}

const CONFIDENCE_BY_RESOLUTION: Record<string, number> = {
  EXACT: 1,
  ALIAS: 0.9,
  FUZZY: 0.6,
};

/**
 * Choose the OEM template for one vehicle.
 *
 * Only a trusted public make selects. A corporate manufacturer, a dealer
 * name, a model guess or a description never does — those inputs can only
 * ever downgrade the result to manual_review or conflict.
 */
export function selectOemTemplate(
  input: OemTemplateSelectionInput,
): OemTemplateSelectionResult {
  const reasons: string[] = [];
  const downgrades: SelectionDowngrade[] = [];
  const conflictingFields: string[] = [];
  const sourceReferences: string[] = [];
  const year = input.modelYear ?? null;

  const none = (
    selectionStatus: SelectionStatus,
    confidence = 0,
    canonicalMake: OemId | null = null,
  ): OemTemplateSelectionResult => ({
    templateKey: null, templateVersion: null, templateFamily: null,
    canonicalMake, confidence, selectionStatus, reasons, downgrades,
    conflictingFields, sourceReferences, definition: null,
  });

  const market = (input.market || "US").toUpperCase();
  if (market !== "US") {
    reasons.push(`market ${market} has no registered template set`);
    return none("unsupported");
  }

  const rawMake = String(input.canonicalMake ?? "").trim();
  if (!rawMake) {
    reasons.push("no canonical make on the trusted vehicle record");
    if (input.canonicalManufacturer) {
      // Naming the parent is not naming the brand: GM does not choose
      // between Buick, Cadillac, Chevrolet and GMC.
      reasons.push(
        `corporate manufacturer ${input.canonicalManufacturer} cannot select a brand on its own`,
      );
    }
    conflictingFields.push("make");
    return none("manual_review");
  }
  sourceReferences.push("canonicalMake");

  const resolved = resolveOem(rawMake, year ?? undefined);
  if (resolved.confidence === "UNRESOLVED") {
    reasons.push(resolved.fallbackReason || `make "${rawMake}" did not resolve to a brand`);
    conflictingFields.push("make");
    return none("unsupported");
  }
  const oemId = resolved.identity.id as OemId;

  // Cross-source disagreement blocks automatic assignment outright: two
  // trusted decodes naming different brands is exactly the case where a
  // guess would put one manufacturer's design on another's vehicle.
  const others = (input.corroboratingMakes || [])
    .map((m) => String(m ?? "").trim())
    .filter(Boolean);
  for (const other of others) {
    const r = resolveOem(other, year ?? undefined);
    if (r.confidence === "UNRESOLVED") continue;
    sourceReferences.push("corroboratingMake");
    if (r.identity.id !== oemId) {
      reasons.push(
        `trusted sources disagree on make: "${rawMake}" resolves to ${oemId} but "${other}" resolves to ${r.identity.id}`,
      );
      conflictingFields.push("make");
      return none("conflict", 0, null);
    }
  }

  const definition = getTemplateDefinition(oemId, year);
  if (!definition) {
    reasons.push(`${OEM_REGISTRY[oemId]?.displayName ?? oemId} has no registered OEM template`);
    return none("unsupported", 0, oemId);
  }

  let confidence = CONFIDENCE_BY_RESOLUTION[resolved.confidence] ?? 0.5;
  if (resolved.confidence === "ALIAS") {
    reasons.push(`make matched by registered alias ("${rawMake}")`);
    downgrades.push("make_alias");
  }
  if (resolved.confidence === "FUZZY") {
    reasons.push(`make matched by normalization only ("${rawMake}"); confirm before publishing`);
    conflictingFields.push("make");
    downgrades.push("make_fuzzy");
  }
  if (year === null) {
    // A missing model year still selects, but the profile could not be
    // pinned by year, so the document is not auto-publishable.
    reasons.push("model year missing; template year-range could not be pinned");
    downgrades.push("model_year_missing");
    confidence = Math.min(confidence, 0.7);
  }
  if (definition.profileStatus === "fallback") {
    reasons.push(`${definition.displayName} is served by a generated fallback profile, not an authored one`);
    downgrades.push("generated_fallback_profile");
    confidence = Math.min(confidence, 0.7);
  }

  const selectionStatus: SelectionStatus = confidence >= 0.85
    ? "selected"
    : confidence >= 0.6
      ? "manual_review"
      : "unsupported";

  if (selectionStatus !== "selected" && !reasons.length) {
    reasons.push("selection confidence below the automatic-assignment threshold");
  }

  return {
    templateKey: definition.key,
    templateVersion: definition.templateVersion,
    templateFamily: definition.layoutFamily,
    canonicalMake: oemId,
    confidence,
    selectionStatus,
    reasons,
    downgrades,
    conflictingFields,
    sourceReferences,
    definition,
  };
}

// ── Manual template override ──────────────────────────────────────────

export interface TemplateOverrideOption {
  templateKey: string;
  label: string;
  themeVersion: string;
  layoutFamily: string;
  /** True for the template the engine would pick on its own. */
  isAutomatic: boolean;
  neutral: boolean;
}

const NEUTRAL_KEY = "oem-autolabels-fallback";

/**
 * Templates an authorized user may switch this vehicle to.
 *
 * Only the vehicle's own brand and the neutral AutoLabels template
 * qualify. Another manufacturer's design is never offered, so a Buick
 * cannot be given the Chevrolet template no matter who asks.
 */
export function listCompatibleTemplates(
  canonicalMake: OemId | null,
  modelYear?: number | null,
): TemplateOverrideOption[] {
  const options: TemplateOverrideOption[] = [];
  if (canonicalMake && canonicalMake !== "AUTOLABELS_FALLBACK") {
    const own = getTemplateDefinition(canonicalMake, modelYear ?? null);
    if (own) {
      const profile = resolveThemeProfile(OEM_REGISTRY[canonicalMake].displayName, modelYear ?? null);
      options.push({
        templateKey: own.key,
        label: `${own.displayName} OEM Window Sticker`,
        themeVersion: profile.profile.themeVersion,
        layoutFamily: own.layoutFamily,
        isAutomatic: true,
        neutral: false,
      });
    }
  }
  options.push({
    templateKey: NEUTRAL_KEY,
    label: "AutoLabels neutral template",
    themeVersion: "autolabels-neutral",
    layoutFamily: "premium-minimalist",
    isAutomatic: false,
    neutral: true,
  });
  return options;
}

export interface TemplateOverrideVerdict {
  allowed: boolean;
  reason: string | null;
  option: TemplateOverrideOption | null;
}

/**
 * Server-side gate for a manual template change. A request naming any
 * other manufacturer's template is refused outright — the canonical make
 * governs, not the operator's selection.
 */
export function validateTemplateOverride(
  canonicalMake: OemId | null,
  requestedTemplateKey: string,
  modelYear?: number | null,
): TemplateOverrideVerdict {
  const key = String(requestedTemplateKey || "").trim().toLowerCase();
  if (!key) return { allowed: false, reason: "no template requested", option: null };
  const option = listCompatibleTemplates(canonicalMake, modelYear).find((o) => o.templateKey === key);
  if (option) return { allowed: true, reason: null, option };
  const owner = (Object.keys(OEM_REGISTRY) as OemId[]).find((id) => templateKeyFor(id) === key);
  return {
    allowed: false,
    option: null,
    reason: owner
      ? `${OEM_REGISTRY[owner].displayName} is a different manufacturer's template and cannot be applied to a ${canonicalMake ? OEM_REGISTRY[canonicalMake]?.displayName ?? canonicalMake : "vehicle with no resolved make"}`
      : `"${requestedTemplateKey}" is not a registered template`,
  };
}

// ── Page geometry validation ──────────────────────────────────────────

export interface PageGeometryReport {
  pass: boolean;
  code: "OK" | "PDF_VALIDATION_FAILED" | "LAYOUT_OVERFLOW";
  reasons: string[];
}

/**
 * Validate what the renderer actually produced against the template's
 * declared geometry. Page count is checked separately from page size so
 * an equipment-heavy build reports Layout Overflow rather than a size
 * failure it did not cause.
 */
export function validatePageGeometry(
  format: OemPageFormat,
  actual: { widthPt: number; heightPt: number; pageCount: number },
  tolerancePt = 1,
): PageGeometryReport {
  const reasons: string[] = [];
  const expectedW = format.widthInches * PT_PER_INCH;
  const expectedH = format.heightInches * PT_PER_INCH;
  if (Math.abs(actual.widthPt - expectedW) > tolerancePt) {
    reasons.push(`page width ${actual.widthPt}pt does not match the template's ${expectedW}pt`);
  }
  if (Math.abs(actual.heightPt - expectedH) > tolerancePt) {
    reasons.push(`page height ${actual.heightPt}pt does not match the template's ${expectedH}pt`);
  }
  const actualOrientation = actual.widthPt >= actual.heightPt ? "landscape" : "portrait";
  if (actualOrientation !== format.orientation) {
    reasons.push(`page orientation ${actualOrientation} does not match the template's ${format.orientation}`);
  }
  if (reasons.length) return { pass: false, code: "PDF_VALIDATION_FAILED", reasons };

  const maxPages = format.expectedPageCount + (format.continuationAllowed ? 1 : 0);
  if (actual.pageCount < 1 || actual.pageCount > maxPages) {
    return {
      pass: false,
      code: "LAYOUT_OVERFLOW",
      reasons: [`rendered ${actual.pageCount} pages; the template allows at most ${maxPages}`],
    };
  }
  return { pass: true, code: "OK", reasons: [] };
}
