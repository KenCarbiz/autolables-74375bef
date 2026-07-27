// Material-change detection.
//
// A snapshot is the unit of truth, so the question "did anything actually
// change?" decides whether a new one exists at all. Get it wrong in one
// direction and every nightly scrape mints a duplicate snapshot and
// regenerates every document; get it wrong in the other and a corrected
// MSRP never reaches the sticker.
//
// So the comparison is explicit about which fields are material, and
// which downstream document families each one affects — a warranty
// correction must not regenerate the OEM sticker, and a margin change
// must not repurchase provider data.

import { sha256HexSync, stableStringify } from "../factorySticker/fingerprint.ts";

export type DocumentFamilyKey =
  | "oem_window_sticker_reproduction"
  | "new_vehicle_addendum"
  | "used_vehicle_addendum"
  | "ftc_buyers_guide"
  | "used_vehicle_window_sticker"
  | "description"
  | "passport";

export interface MaterialFieldRule {
  /** Dot path into the snapshot. */
  field: string;
  label: string;
  affects: DocumentFamilyKey[];
}

// Only these fields make a snapshot new. Everything else is presentation,
// navigation or bookkeeping.
export const MATERIAL_FIELDS: MaterialFieldRule[] = [
  { field: "condition", label: "New/used classification", affects: ["oem_window_sticker_reproduction", "new_vehicle_addendum", "used_vehicle_addendum", "ftc_buyers_guide", "used_vehicle_window_sticker", "description", "passport"] },
  { field: "identity.manufacturer", label: "Manufacturer", affects: ["oem_window_sticker_reproduction", "description"] },
  { field: "identity.make", label: "Make", affects: ["oem_window_sticker_reproduction", "description", "passport"] },
  { field: "identity.modelYear", label: "Model year", affects: ["oem_window_sticker_reproduction", "description", "passport"] },
  { field: "identity.model", label: "Model", affects: ["oem_window_sticker_reproduction", "used_vehicle_window_sticker", "description", "passport"] },
  { field: "identity.trim", label: "Trim", affects: ["oem_window_sticker_reproduction", "used_vehicle_window_sticker", "description", "passport"] },
  { field: "identity.bodyConfiguration", label: "Body configuration", affects: ["oem_window_sticker_reproduction", "description"] },
  { field: "identity.stockNumber", label: "Stock number", affects: ["oem_window_sticker_reproduction", "new_vehicle_addendum", "used_vehicle_addendum", "used_vehicle_window_sticker"] },

  { field: "mechanical.engine", label: "Engine", affects: ["oem_window_sticker_reproduction", "used_vehicle_window_sticker", "description"] },
  { field: "mechanical.transmission", label: "Transmission", affects: ["oem_window_sticker_reproduction", "used_vehicle_window_sticker", "description"] },
  { field: "mechanical.drivetrain", label: "Drivetrain", affects: ["oem_window_sticker_reproduction", "used_vehicle_window_sticker", "description"] },
  { field: "mechanical.fuelType", label: "Fuel type", affects: ["oem_window_sticker_reproduction", "used_vehicle_window_sticker", "description"] },

  { field: "colors.exterior", label: "Exterior colour", affects: ["oem_window_sticker_reproduction", "used_vehicle_window_sticker", "description"] },
  { field: "colors.interior", label: "Interior colour", affects: ["oem_window_sticker_reproduction", "used_vehicle_window_sticker", "description"] },

  { field: "equipment.standard", label: "Standard equipment", affects: ["oem_window_sticker_reproduction", "used_vehicle_window_sticker", "description"] },
  { field: "equipment.factoryOptions", label: "Factory options", affects: ["oem_window_sticker_reproduction", "used_vehicle_window_sticker", "description"] },
  { field: "equipment.factoryPackages", label: "Factory packages", affects: ["oem_window_sticker_reproduction", "used_vehicle_window_sticker", "description"] },
  // Dealer-installed equipment belongs to the addendum, never to the
  // manufacturer reproduction.
  { field: "equipment.dealerInstalled", label: "Dealer-installed equipment", affects: ["new_vehicle_addendum", "used_vehicle_addendum", "description"] },

  { field: "pricing.baseMsrp", label: "Base MSRP", affects: ["oem_window_sticker_reproduction"] },
  { field: "pricing.destinationCharge", label: "Destination charge", affects: ["oem_window_sticker_reproduction"] },
  { field: "pricing.totalMsrp", label: "Total MSRP", affects: ["oem_window_sticker_reproduction"] },
  { field: "pricing.factoryOptionsTotal", label: "Factory option pricing", affects: ["oem_window_sticker_reproduction"] },
  // Dealer pricing never touches the manufacturer document.
  { field: "pricing.advertisedPrice", label: "Advertised price", affects: ["used_vehicle_window_sticker", "description", "passport"] },

  { field: "mileage", label: "Mileage", affects: ["used_vehicle_window_sticker", "used_vehicle_addendum", "description", "passport"] },
  { field: "warranty.selection", label: "Warranty selection", affects: ["ftc_buyers_guide"] },
];

const MATERIAL_BY_FIELD = new Map(MATERIAL_FIELDS.map((r) => [r.field, r]));

export interface FieldChange {
  field: string;
  label: string;
  previous: unknown;
  next: unknown;
  affects: DocumentFamilyKey[];
}

export interface MaterialChangeResult {
  material: boolean;
  changes: FieldChange[];
  /** Every family any changed field touches, deduplicated. */
  affectedFamilies: DocumentFamilyKey[];
  /** Fields that differ but are not material — recorded, not acted on. */
  immaterialFields: string[];
}

function readPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, part) => {
    if (acc && typeof acc === "object" && part in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, obj);
}

const equal = (a: unknown, b: unknown): boolean =>
  stableStringify(a) === stableStringify(b);

/**
 * Content checksum for a snapshot.
 *
 * Reuses the engine's existing canonical serializer and SHA-256 rather
 * than introducing a second hashing convention — the repo already treats
 * `content_hash` as "SHA-256 of the canonical payload", and a snapshot is
 * exactly that.
 */
export function contentChecksum(value: unknown): string {
  return sha256HexSync(stableStringify(value));
}

export { stableStringify };

/**
 * Compare a candidate snapshot against the current one.
 *
 * `material: false` means reuse the existing snapshot — no new version, no
 * regeneration, and above all no provider re-purchase.
 */
export function detectMaterialChange(
  current: unknown,
  candidate: unknown,
): MaterialChangeResult {
  if (!current) {
    return {
      material: true,
      changes: [],
      affectedFamilies: [...new Set(MATERIAL_FIELDS.flatMap((r) => r.affects))],
      immaterialFields: [],
    };
  }

  const changes: FieldChange[] = [];
  for (const rule of MATERIAL_FIELDS) {
    const previous = readPath(current, rule.field);
    const next = readPath(candidate, rule.field);
    // An absent value in the candidate is not a change: a provider that
    // stopped answering must never erase a fact we already hold.
    if (next === undefined) continue;
    if (!equal(previous, next)) {
      changes.push({ field: rule.field, label: rule.label, previous, next, affects: rule.affects });
    }
  }

  const immaterialFields: string[] = [];
  if (!changes.length && !equal(current, candidate)) {
    for (const key of collectPaths(candidate)) {
      if (MATERIAL_BY_FIELD.has(key)) continue;
      if (!equal(readPath(current, key), readPath(candidate, key))) immaterialFields.push(key);
    }
  }

  return {
    material: changes.length > 0,
    changes,
    affectedFamilies: [...new Set(changes.flatMap((c) => c.affects))],
    immaterialFields,
  };
}

function collectPaths(obj: unknown, prefix = "", out: string[] = []): string[] {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return out;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) collectPaths(v, path, out);
    else out.push(path);
  }
  return out;
}
