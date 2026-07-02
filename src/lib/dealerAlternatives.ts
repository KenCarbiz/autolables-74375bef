// ── Same-rooftop alternatives — package-aware, intent-aware positioning ──────
// The passport never shows a customer other dealers' cars. When a shopper wants
// to compare, we offer the TENANT'S own stock, tiered by public-listing-view:
//   tier 1 — same model, any condition (a new car's pre-owned twin included)
//   tier 2 — same make
//   tier 3 — competitive set: same body type / price band from the lot
// This ranks each alternative against the vehicle being viewed and writes the
// one-line positioning a salesperson would say ("Pre-owned option — save
// $6,400", "More equipment — +$2,450 in factory options"), then re-orders by
// the shopper's session intent (price / equipment / coverage).

import type { VehicleListing } from "@/hooks/useVehicleListing";
import { readBuildSheet } from "@/lib/buildSheet";
import { fmt$ } from "@/lib/passportV2Data";
import { getShopperIntent, type ShopperIntent } from "@/lib/shopperIntent";

export type AlternativeTag =
  | "Pre-owned option"
  | "Certified pre-owned"
  | "Brand new option"
  | "More equipment"
  | "Save"
  | "Lower package level"
  | "Similar build"
  | "Also in stock";

export interface DealerAlternative {
  slug: string;
  ymm: string | null;
  trim: string | null;
  price: number | null;
  mileage: number | null;
  condition: string | null;
  image: string | null;
  sameModel: boolean;
  tier: number;                        // 1 same model · 2 same make · 3 competitive set
  packageCount: number | null;
  optionValue: number | null;
  topPackages: string[];
  tag: AlternativeTag;
  tagDetail: string | null;
  tone: "blue" | "green" | "violet" | "neutral";
}

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

export function readDealerAlternatives(
  listing: VehicleListing,
  intent: ShopperIntent | null = getShopperIntent(),
): DealerAlternative[] {
  const raw = (listing as unknown as { dealer_similar?: unknown }).dealer_similar;
  if (!Array.isArray(raw) || !raw.length) return [];

  const curSheet = readBuildSheet(listing);
  const curValue = curSheet?.estValue ?? null;
  const curPkgs = curSheet?.packages.length ?? null;
  const curPrice = listing.price ?? null;
  const curCond = (listing.condition || "").toLowerCase();

  const alts = raw
    .map((r): DealerAlternative | null => {
      const s = r as Record<string, unknown>;
      const slug = String(s.slug || "").trim();
      if (!slug) return null;
      const price = num(s.price);
      const optionValue = num(s.option_value);
      const packageCount = typeof s.package_count === "number" ? s.package_count : null;
      const cond = String(s.condition || "").toLowerCase();
      const sameModel = s.same_model === true;
      const tier = typeof s.tier === "number" ? s.tier : sameModel ? 1 : 2;

      const valueDiff = optionValue != null && curValue != null ? optionValue - curValue : null;
      const pkgDiff = packageCount != null && curPkgs != null ? packageCount - curPkgs : null;
      const priceDiff = price != null && curPrice != null ? price - curPrice : null;
      const saveDetail = priceDiff != null && priceDiff < -300 ? `Save ${fmt$(Math.abs(priceDiff))}` : null;

      // Positioning priority: cross-condition twin (the strongest offer) →
      // package delta → price delta.
      let tag: AlternativeTag = "Also in stock";
      let tagDetail: string | null = null;
      let tone: DealerAlternative["tone"] = "neutral";

      if (sameModel && cond && curCond && cond !== curCond) {
        if (curCond === "new" && cond === "cpo") { tag = "Certified pre-owned"; tone = "violet"; tagDetail = saveDetail; }
        else if (curCond === "new" && cond === "used") { tag = "Pre-owned option"; tone = "green"; tagDetail = saveDetail; }
        else if (cond === "new") { tag = "Brand new option"; tone = "blue"; tagDetail = priceDiff != null && priceDiff > 300 ? `${fmt$(priceDiff)} more` : null; }
        else if (cond === "cpo") { tag = "Certified pre-owned"; tone = "violet"; tagDetail = saveDetail; }
      }
      if (tag === "Also in stock") {
        if (valueDiff != null && valueDiff > 300) {
          tag = "More equipment"; tone = "blue";
          tagDetail = `+${fmt$(valueDiff)} in factory options`;
        } else if (valueDiff != null && valueDiff < -300) {
          if (saveDetail) { tag = "Save"; tone = "green"; tagDetail = saveDetail; }
          else { tag = "Lower package level"; tone = "neutral"; }
        } else if (pkgDiff != null && pkgDiff > 0) {
          tag = "More equipment"; tone = "blue";
          tagDetail = `${pkgDiff} more factory package${pkgDiff === 1 ? "" : "s"}`;
        } else if (pkgDiff != null && pkgDiff < 0 && saveDetail) {
          tag = "Save"; tone = "green"; tagDetail = saveDetail;
        } else if (valueDiff != null || pkgDiff != null) {
          tag = "Similar build"; tone = "neutral"; tagDetail = saveDetail;
        } else if (saveDetail) {
          tag = "Save"; tone = "green"; tagDetail = saveDetail;
        }
      }

      return {
        slug,
        ymm: (s.ymm as string) ?? null,
        trim: (s.trim as string) ?? null,
        price,
        mileage: typeof s.mileage === "number" ? s.mileage : null,
        condition: (s.condition as string) ?? null,
        image: (s.image as string) ?? null,
        sameModel, tier, packageCount, optionValue,
        topPackages: Array.isArray(s.top_packages) ? (s.top_packages as string[]).filter(Boolean) : [],
        tag, tagDetail, tone,
      };
    })
    .filter((a): a is DealerAlternative => a != null);

  // Intent boost: the shopper's session behavior decides what leads. Price
  // shoppers see savings first, feature shoppers see higher-packaged builds,
  // coverage shoppers see CPO / newer options.
  const boost = (a: DealerAlternative): number => {
    if (intent === "price") return a.tag === "Save" || (a.tagDetail?.startsWith("Save") ?? false) ? -1 : 0;
    if (intent === "equipment") return a.tag === "More equipment" ? -1 : 0;
    if (intent === "coverage") return a.tag === "Certified pre-owned" || a.tag === "Brand new option" ? -1 : 0;
    return 0;
  };

  return alts.sort((a, b) =>
    a.tier - b.tier
    || boost(a) - boost(b)
    || Number(b.tag === "More equipment") - Number(a.tag === "More equipment")
    || (a.price ?? 0) - (b.price ?? 0));
}
