// ──────────────────────────────────────────────────────────────────────
// Vehicle passport DATA CONTRACT — the single, versioned seam between the
// raw NeoVIN/feed decode stored on vehicle_listings and everything the
// passport renders for equipment & specs.
//
// WHY THIS EXISTS. A NeoVIN decode hiccup once silently blanked the Equipment
// and Specifications slide-outs: a timeout fell back to the basic decoder,
// `options` was written null, readBuildSheet returned null, the panel collapsed
// to an empty state — with no signal that anything had regressed. This module
// makes that failure mode IMPOSSIBLE to hit silently:
//
//   1. One entry point. buildVehiclePassportDataContract() composes the existing
//      (individually tested) normalizers — buildEquipmentPanelData, readBuildSheet,
//      listingEquipment — into one object the UI renders from. Change the shape
//      here, in one tested place, not in a 2000-line panel component.
//   2. A health report. assessEquipmentHealth() grades the decode (rich → partial
//      → thin → missing) and emits human flags ("NeoVIN decoded no installed
//      options", "build sheet is typical-for-trim, not VIN-specific"). A vehicle
//      that USED to be rich and drops to missing flips its health — visible in the
//      admin Decode Health readout — instead of failing quietly.
//   3. Graceful degradation, never a silent blank. `equipment` is always a
//      non-null object; the health status tells the surface whether to trust it.
//
// The contract is VERSIONED. Bump the version and the anti-regression suite in
// dataContract.test.ts when the shape changes, so a decode/shape regression
// fails a test rather than a customer's screen.
// ──────────────────────────────────────────────────────────────────────

import type { VehicleListing } from "@/hooks/useVehicleListing";
import { listingEquipment, type PassportData } from "@/lib/passportV2Data";
import { readBuildSheet, type ShopperBuildSheet } from "@/lib/buildSheet";
import { buildEquipmentPanelData, type EquipmentPanelData } from "@/lib/equipmentPanel";

export const VEHICLE_PASSPORT_CONTRACT_VERSION = "vehicle-passport-v1";

export type DataHealthStatus = "rich" | "partial" | "thin" | "missing";

export interface DataHealthSection {
  key: string;
  label: string;
  status: DataHealthStatus;
  count: number;
  detail: string;
}

export interface DataHealthReport {
  // The worst status across the customer-critical sections (equipment + specs).
  status: DataHealthStatus;
  decodedAt: string | null; // mc_attributes.specs_decoded_at
  generic: boolean; // build sheet was a typical-for-trim fallback, not VIN-specific
  sections: DataHealthSection[];
  flags: string[]; // human-readable regression/quality signals
}

export interface VehiclePassportDataContract {
  version: typeof VEHICLE_PASSPORT_CONTRACT_VERSION;
  // Always a non-null object — buildEquipmentPanelData never throws and never
  // returns null; an empty decode yields empty arrays, not a missing shape.
  equipment: EquipmentPanelData;
  buildSheet: ShopperBuildSheet | null;
  equipmentList: string[]; // the flat, customer-facing, de-noised equipment list
  health: DataHealthReport;
}

type McAttrs = Record<string, unknown>;

const mcOf = (listing: VehicleListing): McAttrs => {
  const raw = (listing as unknown as { mc_attributes?: unknown }).mc_attributes;
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as McAttrs) : {};
};

const str = (v: unknown): string | null => {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
};

// The flat spec fields that make the Specifications panel worth opening. Identity
// (year/make/model/VIN) always renders, so specs are never truly empty; this
// measures the DECODED depth beyond identity.
const SPEC_FIELDS = [
  "engine", "engine_size", "cylinders", "horsepower", "transmission", "drivetrain",
  "fuel_type", "city_mpg", "highway_mpg", "combined_mpg", "body_type", "doors",
  "seating", "std_seating", "exterior_color", "interior_color",
];

const gradeCount = (n: number, rich: number, partial: number, thin: number): DataHealthStatus =>
  n >= rich ? "rich" : n >= partial ? "partial" : n >= thin ? "thin" : "missing";

// Worst-of ordering for rolling section statuses up to an overall status.
const STATUS_RANK: Record<DataHealthStatus, number> = { rich: 3, partial: 2, thin: 1, missing: 0 };
const worst = (a: DataHealthStatus, b: DataHealthStatus): DataHealthStatus =>
  STATUS_RANK[a] <= STATUS_RANK[b] ? a : b;

export function assessDataHealth(
  listing: VehicleListing,
  // Only the two count fields are read, so both the full contract and the
  // listing-only admin path (which has no PassportData) can call this.
  equipment: { factoryFeatureCount: number; packageCount: number },
  buildSheet: ShopperBuildSheet | null,
  equipmentList: string[],
): DataHealthReport {
  const mc = mcOf(listing);
  const flags: string[] = [];

  // ── Equipment section. Distinguish "never decoded" (null) from "decoded but
  // empty" ([]) — the two failure modes need different fixes (run NeoVIN vs the
  // VIN genuinely has no rich options). ──
  const rawOptions = mc.options;
  const optionsNeverDecoded = rawOptions == null; // null → NeoVIN never answered
  const optionsDecodedEmpty = Array.isArray(rawOptions) && rawOptions.length === 0;
  const equipCount = Math.max(equipmentList.length, equipment.factoryFeatureCount);
  const equipStatus = gradeCount(equipCount, 8, 3, 1);
  if (optionsNeverDecoded) flags.push("Equipment not yet decoded — NeoVIN has not run for this VIN.");
  else if (optionsDecodedEmpty && equipCount === 0) flags.push("NeoVIN decoded no installed options for this VIN.");
  if (buildSheet?.generic) flags.push("Build sheet is typical-for-trim (generic), not VIN-specific.");

  // ── Specs section. Count decoded flat spec fields present beyond identity. ──
  const specPresent = SPEC_FIELDS.filter((k) => str(mc[k]) != null).length;
  const specStatus = gradeCount(specPresent, 8, 4, 1);
  if (specPresent === 0) flags.push("No decoded specifications — showing identity only.");

  // decodedAt is the on-demand NeoVIN timestamp — most listings carry feed
  // equipment/specs without one, so its absence is NOT flagged as a problem;
  // it is shown for context when present.
  const decodedAt = str(mc.specs_decoded_at);

  const sections: DataHealthSection[] = [
    {
      key: "equipment",
      label: "Equipment & options",
      status: equipStatus,
      count: equipCount,
      detail: optionsNeverDecoded
        ? "Not decoded yet"
        : `${equipCount} customer-facing item(s) · ${equipment.packageCount} package(s)`,
    },
    {
      key: "specs",
      label: "Technical specifications",
      status: specStatus,
      count: specPresent,
      detail: `${specPresent}/${SPEC_FIELDS.length} decoded spec fields`,
    },
    {
      key: "buildSheet",
      // A VIN-specific build sheet is the richest tier but a bonus — most
      // listings run on feed equipment alone, so "absent" is informational
      // (thin), not an alarm (missing).
      label: "Build sheet",
      status: buildSheet ? (buildSheet.generic ? "partial" : "rich") : "thin",
      count: buildSheet ? buildSheet.keyFeatureCount + buildSheet.standardCount : 0,
      detail: buildSheet
        ? buildSheet.generic
          ? "Typical-for-trim fallback"
          : "VIN-specific build sheet"
        : "Feed equipment only (no VIN-specific build sheet)",
    },
  ];

  // Overall status is the worst of the two customer-critical sections; the build
  // sheet is a bonus, not a gate (many good listings ship without one).
  const status = worst(equipStatus, specStatus);

  return { status, decodedAt, generic: !!buildSheet?.generic, sections, flags };
}

// The single call the passport (and admin) uses. Pure: no I/O, no throws.
export function buildVehiclePassportDataContract(
  listing: VehicleListing,
  d: PassportData,
): VehiclePassportDataContract {
  const equipment = buildEquipmentPanelData(listing, d);
  const buildSheet = readBuildSheet(listing);
  const equipmentList = listingEquipment(listing);
  const health = assessDataHealth(listing, equipment, buildSheet, equipmentList);
  return {
    version: VEHICLE_PASSPORT_CONTRACT_VERSION,
    equipment,
    buildSheet,
    equipmentList,
    health,
  };
}

// Listing-only health assessment for the admin Decode Health readout, which has
// no PassportData. Mirrors buildEquipmentPanelData's factoryFeatureCount logic
// (build-sheet counts when present, else the flat equipment list) so the admin
// grade matches what the customer panel would render.
export function assessListingDecodeHealth(listing: VehicleListing): DataHealthReport {
  const buildSheet = readBuildSheet(listing);
  const equipmentList = listingEquipment(listing);
  const factoryFeatureCount = buildSheet
    ? buildSheet.keyFeatureCount + buildSheet.standardCount
    : equipmentList.length;
  const packageCount = buildSheet?.packages.length ?? 0;
  return assessDataHealth(listing, { factoryFeatureCount, packageCount }, buildSheet, equipmentList);
}

// Compact one-word summary + tone for the admin Decode Health chip.
export const HEALTH_TONE: Record<DataHealthStatus, { label: string; tone: "good" | "warn" | "bad" }> = {
  rich: { label: "Rich", tone: "good" },
  partial: { label: "Partial", tone: "warn" },
  thin: { label: "Thin", tone: "warn" },
  missing: { label: "Missing", tone: "bad" },
};
