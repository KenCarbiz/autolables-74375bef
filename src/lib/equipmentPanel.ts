// ──────────────────────────────────────────────────────────────────────
// Equipment Intelligence Panel data layer — turns raw decoded equipment
// into the UI-ready value story: headline option value, stat counts,
// benefit-driven featured highlights, shopper categories, curated options
// summary, and customer-love reasons. All fields are real-data gated; the
// panel never fabricates equipment.
// ──────────────────────────────────────────────────────────────────────

import type { VehicleListing } from "@/hooks/useVehicleListing";
import { listingEquipment, type PassportData } from "@/lib/passportV2Data";
import { readBuildSheet } from "@/lib/buildSheet";
import { getEquipmentIcon, EQUIPMENT_ICON_REGISTRY, type EquipmentIconDef } from "@/lib/equipmentIcons";

export interface FeaturedEquipmentItem {
  id: string;
  title: string;
  benefit: string;
  icon: EquipmentIconDef;
}

export interface InstalledPackage {
  id: string;
  name: string;
  description?: string;
  value?: number;
  contents: string[];
}

export interface FactoryOption { id: string; name: string; value?: number }

export interface EquipmentCategory {
  id: string;
  name: string;
  icon: EquipmentIconDef;
  items: string[];
}

export interface CustomerLoveReason { id: string; title: string; description: string }

export interface EquipmentPanelData {
  optionValue: number | null;
  factoryFeatureCount: number;
  packageCount: number;
  dealerAddonCount: number;
  generic: boolean;
  featuredHighlights: FeaturedEquipmentItem[];
  installedPackages: InstalledPackage[];
  factoryOptionsSummary: FactoryOption[];
  categories: EquipmentCategory[];
  customerLoveReasons: CustomerLoveReason[];
  completeFactoryEquipment: [string, string[]][];
  accessories: string[];
}

// Shopper-facing category buckets, mapped from the numbered equipment icon
// registry so classification stays consistent with the icon key.
// Every icon class maps to exactly one bucket, so the full decoded set always
// has a home. The final "More Features" bucket catches only the generic
// fallback icon (65) — features the classifier could not place — so nothing is
// ever dropped or silently folded into an unrelated category.
const PANEL_CATEGORIES: { id: string; name: string; iconNum: number; nums: Set<number> }[] = [
  { id: "performance", name: "Performance & Drivetrain", iconNum: 1, nums: new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) },
  { id: "comfort", name: "Comfort & Interior", iconNum: 21, nums: new Set([20, 21, 22, 23, 24, 25, 26, 47, 48, 49, 50, 51, 52]) },
  { id: "technology", name: "Technology & Audio", iconNum: 28, nums: new Set([27, 28, 29, 30, 31, 32, 33, 42, 43, 44, 45, 46, 57]) },
  { id: "safety", name: "Safety & Driver Assistance", iconNum: 41, nums: new Set([34, 35, 36, 37, 38, 39, 40, 41]) },
  { id: "exterior", name: "Exterior Styling", iconNum: 13, nums: new Set([13, 14, 15, 16, 17, 18, 19, 58]) },
  { id: "convenience", name: "Convenience", iconNum: 54, nums: new Set([53, 54, 55, 56, 59, 60, 61, 62, 63, 64]) },
  { id: "more", name: "More Features", iconNum: 59, nums: new Set([65]) },
];

// Curated benefit copy per icon class — plain-English customer language,
// never the raw decode label alone.
const BENEFIT_BY_NUM: Record<number, { suffix?: string; benefit: string }> = {
  1: { suffix: " Performance", benefit: "Smooth, powerful acceleration" },
  2: { benefit: "Responsive turbocharged power" },
  3: { benefit: "Efficiency without compromise" },
  4: { benefit: "Electric driving, lower running costs" },
  5: { suffix: " Confidence", benefit: "Added traction in any condition" },
  8: { benefit: "Control when you want it" },
  10: { suffix: " Efficiency", benefit: "Great balance of power and economy" },
  13: { benefit: "A finish that stands out" },
  14: { benefit: "Upgraded finish for a luxury look" },
  22: { benefit: "Premium seating comfort" },
  23: { benefit: "Comfort for you and passengers" },
  24: { benefit: "Stay cool on warm days" },
  26: { benefit: "Room for the whole crew" },
  27: { benefit: "Built-in guidance wherever you go" },
  29: { benefit: "Your iPhone, on the big screen" },
  30: { benefit: "Your Android, on the big screen" },
  33: { benefit: "Warm it up before you get in" },
  34: { benefit: "Alerts for what you can't see" },
  35: { benefit: "Helps keep you centered" },
  36: { benefit: "Watches the road ahead" },
  37: { benefit: "See everything behind you" },
  39: { benefit: "Relaxed highway driving" },
  42: { benefit: "Crystal-clear sound experience" },
  43: { benefit: "Crystal-clear sound experience" },
  48: { benefit: "Everyone rides at their temperature" },
  49: { benefit: "Warm hands on cold mornings" },
  50: { benefit: "Open-air driving at the touch of a button" },
  51: { benefit: "Big sky views for every seat" },
  53: { benefit: "Hands-full loading made easy" },
  54: { benefit: "Walk up, get in, drive" },
};

const CATEGORY_FALLBACK_BENEFIT: Record<string, string> = {
  performance: "Capability you can feel",
  comfort: "Enjoy every mile in comfort",
  technology: "Stay connected and in control",
  safety: "Peace of mind on every drive",
  exterior: "Styling that stands out",
  convenience: "Small touches that save time",
  more: "Additional equipment on this build",
};

const bucketFor = (num: number) => PANEL_CATEGORIES.find((c) => c.nums.has(num)) ?? PANEL_CATEGORIES[PANEL_CATEGORIES.length - 1];

// Highlight priority: features shoppers ask about first.
const HIGHLIGHT_PRIORITY = [1, 5, 8, 10, 27, 43, 42, 23, 14, 51, 50, 34, 39, 37, 22, 29, 4, 3, 49, 53, 54];

// Print curation — a window label cannot fit a 200-line decode dump. Rank
// lines by shopper value (icon-key highlight priority, then any classified
// feature, then generic), keep at most two lines per icon class so the list
// stays diverse, and cap it; the QR carries the complete list.
export function curatePrintEquipment(items: string[], max = 24): { shown: string[]; remainder: number } {
  const clean = items.map((s) => s.trim()).filter(Boolean);
  if (clean.length <= max) return { shown: clean, remainder: 0 };
  const classified = clean.map((name, i) => ({ name, i, icon: getEquipmentIcon(name) }));
  const prio = (n: number) => {
    const p = HIGHLIGHT_PRIORITY.indexOf(n);
    return p === -1 ? (n === 65 ? 2000 : 1000) : p;
  };
  const ranked = [...classified].sort((a, b) => prio(a.icon.num) - prio(b.icon.num) || a.i - b.i);
  const perClass: Record<number, number> = {};
  const shown: typeof ranked = [];
  for (const x of ranked) {
    if (shown.length >= max) break;
    const c = perClass[x.icon.num] ?? 0;
    if (x.icon.num !== 65 && c >= 2) continue;
    perClass[x.icon.num] = c + 1;
    shown.push(x);
  }
  for (const x of ranked) {
    if (shown.length >= max) break;
    if (!shown.includes(x)) shown.push(x);
  }
  return { shown: shown.map((x) => x.name), remainder: clean.length - shown.length };
}

export function buildEquipmentPanelData(listing: VehicleListing, d: PassportData): EquipmentPanelData {
  const sheet = readBuildSheet(listing);
  const allEquipment = listingEquipment(listing);
  const accessories = (listing.available_accessories || []).map((a) => (typeof a === "string" ? a : a?.name)).filter(Boolean) as string[];
  const factoryFeatureCount = sheet ? sheet.keyFeatureCount + sheet.standardCount : allEquipment.length;

  // Classify every equipment string once.
  const classified = allEquipment.map((name) => ({ name, icon: getEquipmentIcon(name) }));

  // Categories with real members only.
  const categories: EquipmentCategory[] = PANEL_CATEGORIES.map((c) => ({
    id: c.id,
    name: c.name,
    icon: EQUIPMENT_ICON_REGISTRY[c.iconNum],
    items: classified.filter((x) => bucketFor(x.icon.num).id === c.id).map((x) => x.name),
  })).filter((c) => c.items.length > 0);

  // Featured highlights: start from the passport's curated highlight chips,
  // then fill from priority-classified equipment. Dedup by icon class.
  const seen = new Set<number>();
  const featured: FeaturedEquipmentItem[] = [];
  const push = (name: string, icon: EquipmentIconDef) => {
    if (featured.length >= 8 || seen.has(icon.num) || icon.num === 65) return;
    seen.add(icon.num);
    const copy = BENEFIT_BY_NUM[icon.num];
    const title = copy?.suffix && !name.toLowerCase().includes(copy.suffix.trim().toLowerCase()) ? `${name}${copy.suffix}` : name;
    featured.push({ id: `${icon.num}-${name}`, title, benefit: copy?.benefit ?? CATEGORY_FALLBACK_BENEFIT[bucketFor(icon.num).id], icon });
  };
  for (const h of d.highlights) push(h.label, getEquipmentIcon({ name: h.label, category: h.sub }));
  for (const num of HIGHLIGHT_PRIORITY) {
    if (featured.length >= 8) break;
    const hit = classified.find((x) => x.icon.num === num);
    if (hit) push(hit.name, hit.icon);
  }
  for (const x of classified) { if (featured.length >= 8) break; push(x.name, x.icon); }

  const installedPackages: InstalledPackage[] = (sheet?.packages ?? []).map((p, i) => ({
    id: `${i}-${p.name}`, name: p.name, value: p.msrp ?? undefined, contents: p.contents,
  }));

  const factoryOptionsSummary: FactoryOption[] = (sheet?.options ?? []).map((o, i) => ({ id: `${i}-${o.name}`, name: o.name, value: o.msrp ?? undefined }));

  // Customer-love reasons — verified signals only, phrased as benefits.
  const premium = /luxe|autograph|limited|platinum|premium|touring|signature|reserve|titanium|sensory|denali/i.test(listing.trim || "");
  const has = (id: string) => categories.some((c) => c.id === id);
  const customerLoveReasons: CustomerLoveReason[] = ([
    has("safety") ? { id: "safety", title: "Advanced safety technology", description: "Peace of mind on every drive" } : null,
    has("comfort") ? { id: "comfort", title: "Premium comfort and convenience", description: "Enjoy every mile in comfort" } : null,
    has("technology") ? { id: "tech", title: "Modern technology and connectivity", description: "Stay connected and in control" } : null,
    premium ? { id: "luxury", title: "Luxury-grade appointments", description: "Refined details throughout" } : null,
    (d.belowMarket ?? 0) > 0 ? { id: "value", title: "Exceptional value vs. market", description: "More features, better value" } : null,
  ] as (CustomerLoveReason | null)[]).filter(Boolean) as CustomerLoveReason[];

  return {
    optionValue: sheet?.estValue ?? null,
    factoryFeatureCount,
    packageCount: installedPackages.length,
    dealerAddonCount: accessories.length,
    generic: !!sheet?.generic,
    featuredHighlights: featured,
    installedPackages,
    factoryOptionsSummary,
    categories,
    customerLoveReasons,
    completeFactoryEquipment: sheet?.standard ?? [],
    accessories,
  };
}
