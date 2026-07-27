// GENERATED — do not edit.
// Mirror of src/lib/documents/families.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// Vehicle document families.
//
// AutoLabels produces five different vehicle documents. They share
// infrastructure — identity, storage, versioning, PDF, QR, Vehicle File,
// Passport, audit — and share nothing else. Each has its own purpose,
// eligibility, data rules, template, title and disclosure, and none of
// them satisfies another's requirement.
//
// The distinction that matters most: an OEM manufacturer-style
// reproduction is a transparency document about the FACTORY's equipment
// and pricing. An addendum is about what the DEALERSHIP added. An FTC
// Buyers Guide is a federally required used-vehicle disclosure. Mixing
// them is not a presentation choice, it is a compliance failure.

export type DocumentFamilyId =
  | "oem_window_sticker_reproduction"
  | "new_vehicle_addendum"
  | "used_vehicle_addendum"
  | "ftc_buyers_guide"
  | "used_vehicle_window_sticker";

export type VehicleConditionClass = "new" | "used" | "cpo" | "unknown";

/** How a family applies to a given vehicle. */
export type Applicability = "required" | "eligible" | "supplemental" | "not_applicable";

export interface DocumentFamily {
  id: DocumentFamilyId;
  /** Stable document_type written to generated_documents. */
  documentType: string;
  /** Legacy document_type values that resolve to this family. */
  legacyTypes: string[];
  /** Name shown to dealership staff. */
  adminTitle: string;
  /** Name shown to shoppers on the Passport. */
  customerTitle: string;
  shortDescription: string;
  /** Search helpers only — never the document's name. */
  aliases: string[];
  /** Required verbatim wording, or null when the template owns it. */
  disclosure: string | null;
  /** Content that must never appear in this family. */
  prohibited: string[];
  /** Permission prefix; actions are `${prefix}.view` etc. */
  permissionPrefix: string;
  /** Route of the studio that produces it. */
  studioRoute: string;
  /** May a Passport QR be printed on it? */
  passportQrAllowed: boolean;
}

const DEALER_PRODUCT_ITEMS = [
  "dealer doc fee", "dealer discount", "dealer markup", "market adjustment",
  "advertised price", "rebates", "conditional incentives", "trade assistance",
  "finance incentives", "dealer protection products", "ceramic coating",
  "VIN etch", "tire-and-wheel products", "door-edge products",
  "dealer-installed accessories", "FTC warranty-selection language",
];

export const DOCUMENT_FAMILIES: Record<DocumentFamilyId, DocumentFamily> = {
  oem_window_sticker_reproduction: {
    id: "oem_window_sticker_reproduction",
    documentType: "oem_window_sticker_reproduction",
    legacyTypes: ["factory_sticker"],
    adminTitle: "OEM Window Sticker",
    customerTitle: "Original Equipment & MSRP Window Sticker",
    shortDescription:
      "VIN-specific manufacturer equipment, options, pricing, fuel-economy, warranty and assembly information.",
    aliases: ["monroney", "factory sticker", "window sticker", "msrp sticker", "build record"],
    disclosure:
      "AutoLabels manufacturer-style reproduction generated from verified vehicle data. Not an original manufacturer-issued Monroney label.",
    prohibited: DEALER_PRODUCT_ITEMS,
    permissionPrefix: "oem_sticker",
    studioRoute: "/window-sticker-studio",
    passportQrAllowed: true,
  },
  new_vehicle_addendum: {
    id: "new_vehicle_addendum",
    documentType: "new_vehicle_addendum",
    legacyTypes: ["addendum"],
    adminTitle: "New Vehicle Addendum",
    customerTitle: "Added-Equipment Addendum",
    shortDescription: "Dealer-installed equipment, protection products and adjustments on a new vehicle.",
    aliases: ["addendum", "supplemental sticker", "market adjustment", "dealer add"],
    disclosure: null,
    prohibited: ["factory options presented as dealer-installed", "manufacturer MSRP restated as an addendum item"],
    permissionPrefix: "addendum",
    studioRoute: "/addendum",
    passportQrAllowed: true,
  },
  used_vehicle_addendum: {
    id: "used_vehicle_addendum",
    documentType: "used_vehicle_addendum",
    legacyTypes: ["addendum"],
    adminTitle: "Used Vehicle Addendum",
    customerTitle: "Added-Equipment Addendum",
    shortDescription: "Dealer-installed equipment and protection products on a used vehicle.",
    aliases: ["addendum", "used addendum", "dealer add"],
    disclosure: null,
    prohibited: ["factory equipment presented as dealer-installed", "the same product listed twice"],
    permissionPrefix: "addendum",
    studioRoute: "/addendum",
    passportQrAllowed: true,
  },
  ftc_buyers_guide: {
    id: "ftc_buyers_guide",
    documentType: "ftc_buyers_guide",
    legacyTypes: ["buyers_guide"],
    // Staff say "warranty sticker"; the document's name is the FTC Buyers
    // Guide and stays that everywhere it is recorded or displayed.
    adminTitle: "FTC Buyers Guide",
    customerTitle: "FTC Buyers Guide",
    shortDescription: "Federally required used-vehicle warranty disclosure.",
    aliases: ["warranty sticker", "as is sticker", "buyers guide", "16 CFR 455"],
    disclosure: null,
    prohibited: ["manufacturer MSRP presentation", "OEM branding", "merchandising content"],
    permissionPrefix: "buyers_guide",
    studioRoute: "/buyers-guide",
    passportQrAllowed: false,
  },
  used_vehicle_window_sticker: {
    id: "used_vehicle_window_sticker",
    documentType: "used_vehicle_window_sticker",
    legacyTypes: ["window"],
    adminTitle: "Used Car Window Sticker",
    customerTitle: "Used Vehicle Equipment & Information",
    shortDescription: "AutoLabels used-vehicle equipment and information summary.",
    aliases: ["used car sticker", "merchandising sticker", "equipment sticker"],
    disclosure: null,
    prohibited: [
      "manufacturer branding that implies an OEM-issued document",
      "fabricated factory option pricing",
    ],
    permissionPrefix: "used_car_sticker",
    studioRoute: "/used-car-sticker",
    passportQrAllowed: true,
  },
};

export const DOCUMENT_FAMILY_IDS = Object.keys(DOCUMENT_FAMILIES) as DocumentFamilyId[];

export function classifyCondition(raw: string | null | undefined): VehicleConditionClass {
  const v = String(raw ?? "").trim().toLowerCase();
  if (!v) return "unknown";
  if (v === "new") return "new";
  if (v === "cpo" || v.includes("certified")) return "cpo";
  if (v === "used" || v === "pre-owned" || v === "preowned") return "used";
  return "unknown";
}

export interface FamilyApplicability {
  family: DocumentFamilyId;
  applicability: Applicability;
  reason: string;
}

/**
 * Which documents apply to this vehicle.
 *
 * A new vehicle has no Buyers Guide and no used-car sticker. A used
 * vehicle requires a Buyers Guide, and an OEM reproduction is only ever
 * supplemental there — it never stands in for a required disclosure.
 */
export function applicableFamilies(condition: string | null | undefined): FamilyApplicability[] {
  const cls = classifyCondition(condition);
  if (cls === "unknown") {
    return DOCUMENT_FAMILY_IDS.map((family) => ({
      family,
      applicability: "not_applicable" as const,
      reason: "vehicle condition is unresolved; document eligibility cannot be decided",
    }));
  }
  const isNew = cls === "new";
  return [
    {
      family: "oem_window_sticker_reproduction",
      applicability: isNew ? "eligible" : "supplemental",
      reason: isNew
        ? "manufacturer equipment and MSRP reference for a new vehicle"
        : "supplemental original-equipment history; never replaces a required used-vehicle disclosure",
    },
    {
      family: "new_vehicle_addendum",
      applicability: isNew ? "eligible" : "not_applicable",
      reason: isNew ? "dealer-added equipment on a new vehicle" : "new-vehicle document",
    },
    {
      family: "used_vehicle_addendum",
      applicability: isNew ? "not_applicable" : "eligible",
      reason: isNew ? "used-vehicle document" : "dealer-added equipment on a used vehicle",
    },
    {
      family: "ftc_buyers_guide",
      applicability: isNew ? "not_applicable" : "required",
      reason: isNew
        ? "the FTC Used Car Rule applies to used vehicles"
        : "required on every used vehicle offered for sale",
    },
    {
      family: "used_vehicle_window_sticker",
      applicability: isNew ? "not_applicable" : "eligible",
      reason: isNew ? "used-vehicle document" : "AutoLabels used-vehicle equipment summary",
    },
  ];
}

/** Resolve a stored document_type — current or legacy — to its family. */
export function familyForDocumentType(
  documentType: string | null | undefined,
  condition?: string | null,
): DocumentFamily | null {
  const type = String(documentType ?? "").trim().toLowerCase();
  if (!type) return null;
  const direct = DOCUMENT_FAMILY_IDS.find((id) => DOCUMENT_FAMILIES[id].documentType === type);
  if (direct) return DOCUMENT_FAMILIES[direct];
  // "addendum" is ambiguous on its own: the vehicle's condition decides
  // which addendum family it belongs to.
  if (type === "addendum") {
    return classifyCondition(condition) === "new"
      ? DOCUMENT_FAMILIES.new_vehicle_addendum
      : DOCUMENT_FAMILIES.used_vehicle_addendum;
  }
  const legacy = DOCUMENT_FAMILY_IDS.find((id) => DOCUMENT_FAMILIES[id].legacyTypes.includes(type));
  return legacy ? DOCUMENT_FAMILIES[legacy] : null;
}

/**
 * Whether a family's requirement can be considered met by a document of
 * another family. It never can — this exists so callers ask the question
 * explicitly rather than assuming.
 */
export function satisfiesRequirement(
  requirement: DocumentFamilyId,
  produced: DocumentFamilyId,
): boolean {
  return requirement === produced;
}
