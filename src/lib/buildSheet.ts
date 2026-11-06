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

/**
 * How sure we are that a factory option is on THIS VIN.
 *  - installed: the provider listed it for the VIN and did not mark it unverified.
 *  - not_verified: the provider returned it with verified=false — available for
 *    the model, NOT proven installed. Never rendered as installed equipment.
 */
export type OptionInstallBasis = "installed" | "not_verified";

export interface BuildSheetPackage {
  name: string; msrp?: number; contents: string[]; kind: PackageKind;
  code?: string; confidence?: string; portInstalled?: boolean; basis?: OptionInstallBasis;
}
export interface BuildSheetOption {
  name: string; msrp?: number;
  code?: string; confidence?: string; portInstalled?: boolean; basis?: OptionInstallBasis;
  /** Equipment the provider attributes to this option code (installed with it). */
  contents?: string[];
}

export type MsrpReconciliation = "reconciled" | "conflict" | "incomplete";

/** Factory MSRP ladder: base + installed options + destination = total. */
export interface FactoryMsrp {
  baseMsrp: number | null;
  destination: number | null;
  optionsTotal: number | null;
  totalMsrp: number | null;
  status: MsrpReconciliation;
  /** total - (base + options + destination), when every term is known. */
  delta: number | null;
  /** Provider's own options subtotal, when it sent one. */
  providerOptionsTotal: number | null;
  notes: string[];
}

export interface FactoryColor { name?: string; code?: string; msrp?: number }

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
  /** Returned by the provider with verified=false: available, not proven installed. */
  notVerified: BuildSheetOption[];
  keyFeatures: [string, string[]][];   // shopper-ordered [category, items]
  standard: [string, string[]][];      // shopper-ordered, STANDARD equipment only
  /** Equipment attributed to an option code that matched no listed option. */
  optionEquipment: [string, string[]][];
  standardCount: number;
  keyFeatureCount: number;
  generic: boolean;                    // typical-for-trim fallback — label, never assert
  estValue: number | null;             // sum of known INSTALLED package + option MSRPs
  msrp: FactoryMsrp;
  colors: { exterior?: FactoryColor; interior?: FactoryColor } | null;
  assembly: { plant?: string; country?: string; city?: string } | null;
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

// NeoVIN keys its feature maps by option code ("E08", "M93", "300") as well as
// "STANDARD". A code-keyed group is equipment that arrived WITH that option, so
// it is never standard equipment and never belongs in a category bucket.
const isOptionCodeKey = (k: string, codes: Set<string>): boolean =>
  codes.has(k) || (/^[A-Z0-9]{2,4}$/.test(k) && /\d/.test(k));

// Merge feed categories into canonical buckets, denoise, and order for shoppers.
const toOrderedGroups = (map: unknown, codes: Set<string> = new Set()): [string, string[]][] => {
  const buckets: Record<string, string[]> = {};
  if (map && typeof map === "object" && !Array.isArray(map)) {
    for (const [cat, items] of Object.entries(map as Record<string, unknown>)) {
      if (!Array.isArray(items) || isOptionCodeKey(cat, codes)) continue;
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

const codeGroups = (map: unknown, codes: Set<string>): Map<string, string[]> => {
  const out = new Map<string, string[]>();
  if (!map || typeof map !== "object" || Array.isArray(map)) return out;
  for (const [cat, items] of Object.entries(map as Record<string, unknown>)) {
    if (!Array.isArray(items) || !isOptionCodeKey(cat, codes)) continue;
    const names = cleanEquipmentList(items.map((x) => String(x ?? "").trim()).filter(Boolean));
    if (names.length) out.set(cat, Array.from(new Set([...(out.get(cat) ?? []), ...names])));
  }
  return out;
};

const num = (v: unknown): number | undefined => {
  const n = typeof v === "string" ? Number(v.replace(/[,$\s]/g, "")) : Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

const strOf = (v: unknown): string | undefined => {
  const s = typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
  return s || undefined;
};

// An option name that is only a code ("L92") carries nothing a shopper can read.
const BARE_CODE_RE = /^[A-Z]{1,3}\d{1,4}$/;
const PIO_RE = /\(PIO\)|port.?install/i;

interface RawItem { name: string; code?: string; msrp?: number; confidence?: string; verified: boolean | null; type?: string; contents: string[] }

const rawItem = (x: Record<string, unknown> | null | undefined): RawItem | null => {
  const name = String(x?.name ?? "").trim();
  if (!name) return null;
  const v = x?.verified;
  return {
    name,
    code: strOf(x?.code),
    msrp: num(x?.msrp),
    confidence: strOf(x?.confidence),
    verified: v === true || v === "true" ? true : v === false || v === "false" ? false : null,
    type: strOf(x?.type),
    contents: (Array.isArray(x?.contents) ? x!.contents as unknown[] : []).map((c) => String(c ?? "").trim()).filter(Boolean),
  };
};

const TOLERANCE = 1;

export function reconcileFactoryMsrp(input: {
  baseMsrp?: number | null; destination?: number | null; totalMsrp?: number | null;
  optionsTotal?: number | null; providerOptionsTotal?: number | null;
}): FactoryMsrp {
  const baseMsrp = input.baseMsrp ?? null;
  const destination = input.destination ?? null;
  const totalMsrp = input.totalMsrp ?? null;
  const optionsTotal = input.optionsTotal ?? null;
  const providerOptionsTotal = input.providerOptionsTotal ?? null;
  const notes: string[] = [];
  if (baseMsrp == null || totalMsrp == null) {
    return { baseMsrp, destination, optionsTotal, totalMsrp, status: "incomplete", delta: null, providerOptionsTotal, notes: ["Base or total MSRP not provided."] };
  }
  const opts = optionsTotal ?? 0;
  const delta = Math.round(totalMsrp - (baseMsrp + opts + (destination ?? 0)));
  let status: MsrpReconciliation = Math.abs(delta) <= TOLERANCE ? "reconciled" : "conflict";
  if (status === "conflict") notes.push(`Base + options + destination is ${delta > 0 ? "short of" : "over"} the total MSRP by $${Math.abs(delta).toLocaleString()}.`);
  if (providerOptionsTotal != null && optionsTotal != null && Math.abs(providerOptionsTotal - optionsTotal) > TOLERANCE) {
    status = "conflict";
    notes.push(`Itemized option prices ($${optionsTotal.toLocaleString()}) differ from the provider's options subtotal ($${providerOptionsTotal.toLocaleString()}).`);
  }
  if (destination == null) notes.push("Destination charge not provided.");
  return { baseMsrp, destination, optionsTotal, totalMsrp, status, delta, providerOptionsTotal, notes };
}

export function readBuildSheet(listing: VehicleListing): ShopperBuildSheet | null {
  const mc = (listing.mc_attributes || {}) as Record<string, unknown>;
  const raw = mc.build_sheet as Record<string, unknown> | null | undefined;
  if (!raw || typeof raw !== "object") return null;

  const rawPackages = (Array.isArray(raw.packages) ? raw.packages : []).map((p) => rawItem(p as Record<string, unknown>)).filter((x): x is RawItem => !!x);
  const rawOptions = (Array.isArray(raw.options) ? raw.options : []).map((o) => rawItem(o as Record<string, unknown>)).filter((x): x is RawItem => !!x);
  // A provider "P"/package-typed row is a package even when it was stored with
  // the options (structuredSheet only routes on the word "package").
  const asPackage = (o: RawItem) => o.type === "P" || /package/i.test(o.type ?? "");
  const allPkgs = [...rawPackages, ...rawOptions.filter(asPackage)];
  const allOpts = rawOptions.filter((o) => !asPackage(o));

  const codes = new Set([...allPkgs, ...allOpts].map((x) => x.code).filter((c): c is string => !!c));
  const byCodeStd = codeGroups(raw.standard, codes);
  const byCodeKey = codeGroups(raw.key_features, codes);
  const contentsFor = (code?: string): string[] => code
    ? Array.from(new Set([...(byCodeKey.get(code) ?? []), ...(byCodeStd.get(code) ?? [])]))
    : [];
  const usedCodes = new Set<string>();
  const basisOf = (x: RawItem): OptionInstallBasis => (x.verified === false ? "not_verified" : "installed");

  const packages: BuildSheetPackage[] = [];
  const notVerified: BuildSheetOption[] = [];
  const seen = new Set<string>();
  for (const p of allPkgs) {
    const key = `${p.code ?? ""}|${p.name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (p.code) usedCodes.add(p.code);
    const contents = cleanEquipmentList(Array.from(new Set([...p.contents, ...contentsFor(p.code)])));
    const row = {
      name: p.name, msrp: p.msrp, contents, kind: classifyPackage(p.name),
      ...(p.code ? { code: p.code } : {}), ...(p.confidence ? { confidence: p.confidence } : {}),
      portInstalled: PIO_RE.test(p.name), basis: basisOf(p),
    };
    if (row.basis === "not_verified") notVerified.push(row); else packages.push(row);
  }
  // Build-defining groups first, then capability packages, biggest MSRP first
  // within each kind — the $3,500 equipment group leads, the wheel locks trail.
  packages.sort((a, b) =>
    PACKAGE_KIND_ORDER.indexOf(a.kind) - PACKAGE_KIND_ORDER.indexOf(b.kind)
    || (b.msrp ?? 0) - (a.msrp ?? 0)
    || a.name.localeCompare(b.name));

  // Factory options are priced line items, not marketing features: they are
  // NOT run through the equipment noise filter, which drops paint
  // ("...Pearl", "...Metallic") and emissions rows that carry a real MSRP.
  const options: BuildSheetOption[] = [];
  for (const o of allOpts) {
    if (BARE_CODE_RE.test(o.name)) continue;
    const key = `${o.code ?? ""}|${o.name.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (o.code) usedCodes.add(o.code);
    const contents = contentsFor(o.code);
    const row: BuildSheetOption = {
      name: o.name, msrp: o.msrp,
      ...(o.code ? { code: o.code } : {}), ...(o.confidence ? { confidence: o.confidence } : {}),
      portInstalled: PIO_RE.test(o.name), basis: basisOf(o),
      ...(contents.length ? { contents } : {}),
    };
    if (row.basis === "not_verified") notVerified.push(row); else options.push(row);
  }

  const keyFeatures = toOrderedGroups(raw.key_features, codes);
  const standard = toOrderedGroups(raw.standard, codes);
  const optionEquipment: [string, string[]][] = [];
  for (const code of new Set([...byCodeKey.keys(), ...byCodeStd.keys()])) {
    if (usedCodes.has(code)) continue;
    const items = contentsFor(code);
    if (items.length) optionEquipment.push([`Option ${code}`, items]);
  }
  const keyFeatureCount = keyFeatures.reduce((a, [, items]) => a + items.length, 0);
  const standardCount = standard.reduce((a, [, items]) => a + items.length, 0);

  const pricing = (raw.pricing && typeof raw.pricing === "object" ? raw.pricing : {}) as Record<string, unknown>;
  const installedMsrps = [...packages.map((p) => p.msrp), ...options.map((o) => o.msrp)].filter((n): n is number => n != null);
  const optionsTotal = installedMsrps.length ? installedMsrps.reduce((a, b) => a + b, 0) : (packages.length || options.length ? 0 : null);
  const msrp = reconcileFactoryMsrp({
    baseMsrp: num(pricing.base_msrp) ?? num(mc.base_msrp) ?? null,
    destination: num(pricing.destination_charge) ?? num(mc.delivery_charges) ?? null,
    totalMsrp: num(pricing.total_msrp) ?? num(mc.total_msrp) ?? null,
    optionsTotal,
    providerOptionsTotal: num(raw.installed_options_msrp) ?? null,
  });

  const colorsRaw = (raw.colors && typeof raw.colors === "object" ? raw.colors : null) as Record<string, Record<string, unknown>> | null;
  const colorOf = (c?: Record<string, unknown>): FactoryColor | undefined => {
    if (!c) return undefined;
    const out: FactoryColor = { ...(strOf(c.name) ? { name: strOf(c.name) } : {}), ...(strOf(c.code) ? { code: strOf(c.code) } : {}), ...(num(c.msrp) ? { msrp: num(c.msrp) } : {}) };
    return Object.keys(out).length ? out : undefined;
  };
  const exterior = colorOf(colorsRaw?.exterior);
  const interior = colorOf(colorsRaw?.interior);
  const assemblyRaw = (raw.assembly && typeof raw.assembly === "object" ? raw.assembly : null) as Record<string, unknown> | null;
  const assembly = assemblyRaw || strOf(mc.made_in)
    ? { ...(strOf(assemblyRaw?.plant) ? { plant: strOf(assemblyRaw?.plant) } : {}), country: strOf(assemblyRaw?.country) ?? strOf(mc.made_in), ...(strOf(assemblyRaw?.city) ? { city: strOf(assemblyRaw?.city) } : {}) }
    : null;

  const hasMsrp = msrp.baseMsrp != null || msrp.totalMsrp != null;
  if (!packages.length && !options.length && !notVerified.length && !keyFeatureCount && !standardCount && !optionEquipment.length && !hasMsrp) return null;

  return {
    packages,
    options,
    notVerified,
    keyFeatures,
    standard,
    optionEquipment,
    standardCount,
    keyFeatureCount,
    generic: raw.generic === true,
    estValue: installedMsrps.length ? installedMsrps.reduce((a, b) => a + b, 0) : null,
    msrp,
    colors: exterior || interior ? { ...(exterior ? { exterior } : {}), ...(interior ? { interior } : {}) } : null,
    assembly,
  };
}
