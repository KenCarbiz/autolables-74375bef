// ── Which equipment defines a market, and which merely describes a car ─────
//
// Grounded in what Harte's inventory actually holds. Across 2,004 option
// entries on 288 vehicles (692 distinct):
//
//   641  factory option codes      M93, B10, E10, N96, B94
//   507  marked "(PIO)"            port/dealer-installed accessories
//   856  other free text           of which 188 mention "Package"
//
// Two failure modes, and they pull in opposite directions:
//
//   FALSE POSITIVE — a base car and a loaded car share a cohort because the
//   difference was filed as noise. That is how a $38k car gets compared to a
//   $45k one.
//
//   FALSE NEGATIVE — two identical cars refuse each other because one feed
//   listed "Splash Guards" and the other did not. Splash guards are not a
//   market.
//
// So the rule is drawn where the data already draws it. A port-installed
// accessory is something the DEALER added after the car was built; it is not
// part of the factory configuration a market prices. A factory option code is.
//
// Nothing here infers. An option absent from one car's list is ABSENT, never
// "probably present because the same trim usually has it".

/** Factory option codes as this feed emits them: one or two letters, two digits. */
const FACTORY_CODE = /^[A-Z]{1,2}[0-9]{2}$/;

/** Port- or dealer-installed. The feed marks these itself. */
const DEALER_INSTALLED = /\(\s*PIO\s*\)/i;

/**
 * Free-text equipment that is cohort-material when it is NOT dealer-installed.
 *
 * Deliberately short. Each term names something a market actually prices
 * differently, and anything not listed is treated as descriptive — the
 * conservative direction for a false-negative, and the correct direction for a
 * false-positive.
 */
const COHORT_MATERIAL_TERMS = [
  "package",
  "awd", "all wheel drive", "4wd", "4x4", "fwd", "rwd",
  "turbo", "hybrid", "plug in", "plug-in", "electric", "diesel", "v6", "v8",
  "long range", "extended range", "battery",
  "third row", "3rd row", "second row captain", "captain chairs", "seating",
  "performance", "sport tuned", "towing", "tow package",
] as const;

/**
 * Free text that is cosmetic or trivial even when it is not PIO-marked.
 *
 * Checked BEFORE the material terms so "Premium Paint" cannot be promoted by
 * a term match, and so a dealer accessory listed without its PIO marker still
 * lands on the right side.
 */
const DESCRIPTIVE_TERMS = [
  "paint", "color", "colour",
  "splash guard", "mud flap", "floor mat", "cargo mat", "cargo net",
  "scuff plate", "kick plate", "wheel lock", "lug nut",
  "roof rail cross bar", "cross bars", "pin stripe", "pinstripe",
  "emblem", "badge", "window tint", "mirror cap", "door edge",
] as const;

export type EquipmentClass = "cohort_defining" | "descriptive" | "unknown";

export interface ClassifiedEquipment {
  raw: string;
  normalized: string;
  equipmentClass: EquipmentClass;
  reason: string;
}

const normalize = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase().replace(/\s+/g, " ");
  return s || null;
};

/** Classify one equipment entry. Never guesses; unreadable input is unknown. */
export function classifyEquipmentEntry(entry: unknown): ClassifiedEquipment | null {
  if (typeof entry !== "string") return null;
  const raw = entry.trim();
  const normalized = normalize(entry);
  if (!normalized) return null;

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
  /** Only these reach the cohort signature. Sorted and deduplicated. */
  cohortDefining: string[];
  descriptive: string[];
  /** True when there was no readable equipment evidence at all. */
  unknown: boolean;
  reasons: string[];
}

/**
 * Classify a vehicle's equipment list.
 *
 * An absent, non-array or empty list is UNKNOWN — not "no options". The
 * difference matters: unknown may not be compared, while an empty factory
 * configuration is a real configuration.
 */
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

  const cohortDefining = [...new Set(
    classified.filter((c) => c.equipmentClass === "cohort_defining").map((c) => c.normalized),
  )].sort();
  const descriptive = [...new Set(
    classified.filter((c) => c.equipmentClass === "descriptive").map((c) => c.normalized),
  )].sort();

  const reasons = [
    `equipment_entries_${classified.length}`,
    `equipment_cohort_defining_${cohortDefining.length}`,
    `equipment_descriptive_${descriptive.length}`,
  ];
  // A list that decoded to nothing cohort-defining is still EVIDENCE — the car
  // genuinely has no material factory options beyond its trim — so it is not
  // unknown. Silence and "none" are different answers.
  return { cohortDefining, descriptive, unknown: false, reasons };
}

/**
 * Marketing copy is never equipment truth.
 *
 * "Fully loaded", "every option", "must see" are sentences. This exists so the
 * refusal is a named, tested behaviour rather than an absence.
 */
export const MARKETING_PHRASES = [
  "fully loaded", "loaded", "every option", "all the bells", "must see",
  "like new", "immaculate", "one of a kind", "rare find",
] as const;

export const isMarketingCopy = (v: unknown): boolean => {
  const s = normalize(v);
  return !!s && MARKETING_PHRASES.some((p) => s.includes(p));
};
