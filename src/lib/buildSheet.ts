// ── Shopper build sheet — reads mc_attributes.build_sheet ────────────────────
// marketcheck-specs stores the NeoVIN decode as tiers (packages / installed
// options / high-value features / standard features) instead of one flat list.
// This normalizes that structure for the passport: denoises every list through
// cleanEquipmentList, maps feed categories to shopper-priority categories
// (safety first), and totals visible option value. Returns null when a vehicle
// has no structured decode so callers can fall back to the flat list.

import { cleanEquipmentList } from "@/lib/passportV2Data";
import type { VehicleListing } from "@/hooks/useVehicleListing";

export type PackageKind =
  | "Equipment Group"
  | "Towing & Hauling"
  | "Off-Road"
  | "Safety & Technology"
  | "Comfort & Convenience"
  | "Appearance & Wheels"
  | "Protection & Utility"
  | "Other Packages";

export interface BuildSheetPackage { name: string; msrp?: number; contents: string[]; kind: PackageKind }
export interface BuildSheetOption { name: string; msrp?: number }

// Domestic trucks carry a dozen-plus packages, so classification is what keeps
// the section readable: the build-defining equipment group leads, then the
// capability packages shoppers cross-shop on (towing, off-road), then the rest.
const PACKAGE_KINDS: [RegExp, PackageKind][] = [
  // Ford 301A/302A/502A, GM Preferred Equipment Group, Ram Level 1/2 groups.
  [/equipment group|preferred equipment|\b[1-9]0[0-9]a\b|\blevel [1-4]\b(?=.*(group|package))|package level/i, "Equipment Group"],
  [/tow|trailer|haul|gooseneck|fifth.?wheel|payload|camper/i, "Towing & Hauling"],
  [/off.?road|fx4|z71|zr2|at4|trail|tremor|sasquatch|rebel|rocky ridge|skid plate|4x4 pkg/i, "Off-Road"],
  [/safety|technology|tech pkg|tech package|driver assist|co.?pilot|super cruise|active safety|camera/i, "Safety & Technology"],
  [/comfort|convenience|cold weather|climate|heated|ventilated|luxury|premium interior/i, "Comfort & Convenience"],
  [/appearance|chrome|black(out| out| appearance)|monochrome|sport appearance|wheel|graphics|stripe|midnight|redline/i, "Appearance & Wheels"],
  [/protection|bed ?liner|bedliner|bed utility|floor liner|mud flap|cargo|security|interior protection/i, "Protection & Utility"],
];
export const PACKAGE_KIND_ORDER: PackageKind[] = [
  "Equipment Group", "Towing & Hauling", "Off-Road", "Safety & Technology",
  "Comfort & Convenience", "Appearance & Wheels", "Protection & Utility", "Other Packages",
];

export const classifyPackage = (name: string): PackageKind => {
  for (const [re, kind] of PACKAGE_KINDS) if (re.test(name)) return kind;
  return "Other Packages";
};

export interface ShopperBuildSheet {
  packages: BuildSheetPackage[];
  options: BuildSheetOption[];
  keyFeatures: [string, string[]][];   // shopper-ordered [category, items]
  standard: [string, string[]][];      // shopper-ordered, full reference list
  standardCount: number;
  keyFeatureCount: number;
  generic: boolean;                    // typical-for-trim fallback — label, never assert
  estValue: number | null;             // sum of known package + option MSRPs
}

// Feed category names vary ("adas", "Infotainment", "safety_features", …) — map
// them onto the categories shoppers actually scan, in research priority order.
const CANON: [RegExp, string][] = [
  [/safety|airbag|driver.?assist|adas|collision|lane|blind|brake|camera|parking/i, "Safety & Driver Assistance"],
  [/tech|connect|infotain|navigation|telematic|instrument|display|phone|charging|usb/i, "Technology & Connectivity"],
  [/comfort|convenien|climate|keyless|remote|storage|cargo|access/i, "Comfort & Convenience"],
  [/seat|interior|upholster/i, "Seating & Interior"],
  [/exterior|light|wheel|tire|roof|glass|mirror|body|paint/i, "Exterior & Lighting"],
  [/performance|engine|motor|drivetrain|transmission|suspension|steering|tow|capab|mechanical|off.?road|battery/i, "Performance & Capability"],
  [/audio|entertainment|speaker|sound|radio/i, "Audio & Entertainment"],
];
const SHOPPER_ORDER = [
  "Safety & Driver Assistance", "Technology & Connectivity", "Comfort & Convenience",
  "Seating & Interior", "Exterior & Lighting", "Performance & Capability",
  "Audio & Entertainment", "Other",
];

const canonCategory = (raw: string): string => {
  for (const [re, label] of CANON) if (re.test(raw)) return label;
  return "Other";
};

// Merge feed categories into canonical buckets, denoise, and order for shoppers.
const toOrderedGroups = (map: unknown): [string, string[]][] => {
  const buckets: Record<string, string[]> = {};
  if (map && typeof map === "object" && !Array.isArray(map)) {
    for (const [cat, items] of Object.entries(map as Record<string, unknown>)) {
      if (!Array.isArray(items)) continue;
      const names = cleanEquipmentList(items.map((x) => String(x ?? "").trim()).filter(Boolean));
      if (!names.length) continue;
      const key = canonCategory(cat);
      buckets[key] = [...(buckets[key] ?? []), ...names];
    }
  }
  // Dedup across merged feed categories, preserve shopper order.
  return SHOPPER_ORDER
    .filter((k) => buckets[k]?.length)
    .map((k) => [k, Array.from(new Set(buckets[k]))] as [string, string[]]);
};

const num = (v: unknown): number | undefined => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

export function readBuildSheet(listing: VehicleListing): ShopperBuildSheet | null {
  const mc = (listing.mc_attributes || {}) as Record<string, unknown>;
  const raw = mc.build_sheet as Record<string, unknown> | null | undefined;
  if (!raw || typeof raw !== "object") return null;

  const packages: BuildSheetPackage[] = (Array.isArray(raw.packages) ? raw.packages : [])
    .map((p: Record<string, unknown>) => {
      const name = String(p?.name ?? "").trim();
      return {
        name,
        msrp: num(p?.msrp),
        contents: cleanEquipmentList((Array.isArray(p?.contents) ? p.contents : []).map((c) => String(c ?? "").trim()).filter(Boolean)),
        kind: classifyPackage(name),
      };
    })
    .filter((p) => p.name)
    // Build-defining groups first, then capability packages, biggest MSRP first
    // within each kind — the $3,500 equipment group leads, the wheel locks trail.
    .sort((a, b) =>
      PACKAGE_KIND_ORDER.indexOf(a.kind) - PACKAGE_KIND_ORDER.indexOf(b.kind)
      || (b.msrp ?? 0) - (a.msrp ?? 0)
      || a.name.localeCompare(b.name));

  const options: BuildSheetOption[] = cleanEquipmentList(
    (Array.isArray(raw.options) ? raw.options : []).map((o: Record<string, unknown>) => String(o?.name ?? "").trim()),
  ).map((name) => {
    const src = (Array.isArray(raw.options) ? raw.options : []).find((o: Record<string, unknown>) => String(o?.name ?? "").trim() === name) as Record<string, unknown> | undefined;
    return { name, msrp: num(src?.msrp) };
  });

  const keyFeatures = toOrderedGroups(raw.key_features);
  const standard = toOrderedGroups(raw.standard);
  const keyFeatureCount = keyFeatures.reduce((a, [, items]) => a + items.length, 0);
  const standardCount = standard.reduce((a, [, items]) => a + items.length, 0);

  if (!packages.length && !options.length && !keyFeatureCount && !standardCount) return null;

  const msrps = [...packages.map((p) => p.msrp), ...options.map((o) => o.msrp)].filter((n): n is number => n != null);
  return {
    packages,
    options,
    keyFeatures,
    standard,
    standardCount,
    keyFeatureCount,
    generic: raw.generic === true,
    estValue: msrps.length ? msrps.reduce((a, b) => a + b, 0) : null,
  };
}
