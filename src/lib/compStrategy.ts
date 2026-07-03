// ──────────────────────────────────────────────────────────────────────
// Customer-facing comp strategy — comps are sales-support, not market
// research. The default "value_building" mode only shows comparable
// vehicles priced at or above this vehicle (up to a sanity ceiling) that
// are similar enough to be a fair comparison, so the panel always supports
// "this vehicle is priced well against similar or higher-priced
// alternatives" and never merchandises cheaper competing inventory.
// Dealers can widen to balanced_market or all_comps in admin. Filtering
// only ever removes real comps — nothing here fabricates data.
// ──────────────────────────────────────────────────────────────────────

export type CompStrategy = "value_building" | "balanced_market" | "all_comps";

export interface MarketDemandCompSettings {
  compStrategy: CompStrategy;
  showLocalCompetitionMap: boolean;
  showComparableVehiclesTable: boolean;
  localCompMapRadiusMiles: 25 | 50 | 100;
  minimumCompPriceRatio: number;
  maximumCompPriceRatio: number;
  includeLowerPricedComps: boolean;
  lowerPricedCompTolerancePercent: number;
  requireSimilarMileageBand: boolean;
  mileageBandPercent: number;
  requireSameTrimWhenAvailable: boolean;
  requireSameDrivetrainWhenAvailable: boolean;
  showCompetitorDealerNames: boolean;
  showCompetitorExactLocations: boolean;
}

export const DEFAULT_COMP_SETTINGS: MarketDemandCompSettings = {
  compStrategy: "value_building",
  showLocalCompetitionMap: false,
  showComparableVehiclesTable: true,
  localCompMapRadiusMiles: 50,
  minimumCompPriceRatio: 1.0,
  maximumCompPriceRatio: 1.35,
  includeLowerPricedComps: false,
  lowerPricedCompTolerancePercent: 3,
  requireSimilarMileageBand: true,
  mileageBandPercent: 25,
  requireSameTrimWhenAvailable: true,
  requireSameDrivetrainWhenAvailable: true,
  showCompetitorDealerNames: false,
  showCompetitorExactLocations: false,
};

export const resolveCompSettings = (partial?: Partial<MarketDemandCompSettings> | null): MarketDemandCompSettings =>
  ({ ...DEFAULT_COMP_SETTINGS, ...(partial || {}) });

export interface CompLike {
  price?: number | null;
  miles?: number | null;
  trim?: string | null;
  drivetrain?: string | null;
  distanceMiles?: number | null;
  daysOnMarket?: number | null;
}

export interface CompSubject {
  price?: number | null;
  mileage?: number | null;
  trim?: string | null;
  drivetrain?: string | null;
}

export const normalizeTrim = (t?: string | null): string =>
  String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

export const normalizeDrivetrain = (dt?: string | null): string => {
  const s = String(dt || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (/^(4wd|4x4|fourwheeldrive)$/.test(s)) return "4wd";
  if (/^(awd|allwheeldrive)$/.test(s)) return "awd";
  if (/^(fwd|frontwheeldrive)$/.test(s)) return "fwd";
  if (/^(rwd|rearwheeldrive)$/.test(s)) return "rwd";
  return s;
};

export const isWithinMileageBand = (compMiles: number | null | undefined, ourMiles: number | null | undefined, bandPercent: number): boolean => {
  if (compMiles == null || ourMiles == null || ourMiles <= 0) return true; // no data → don't exclude
  const band = ourMiles * (bandPercent / 100);
  return Math.abs(compMiles - ourMiles) <= band;
};

// Strategy-dependent filter. value_building never lets a cheaper comp
// through unless the dealer explicitly enabled the small tolerance.
export function filterCompsForValueStory<T extends CompLike>(
  comps: T[], vehicle: CompSubject, settings: MarketDemandCompSettings,
): T[] {
  if (settings.compStrategy === "all_comps") return comps;
  const ourPrice = vehicle.price ?? null;
  return comps.filter((comp) => {
    let priceOk = true;
    if (ourPrice != null && ourPrice > 0 && comp.price != null) {
      if (settings.compStrategy === "value_building") {
        const floor = settings.includeLowerPricedComps
          ? ourPrice * (1 - settings.lowerPricedCompTolerancePercent / 100)
          : ourPrice * settings.minimumCompPriceRatio;
        priceOk = comp.price >= floor && comp.price <= ourPrice * settings.maximumCompPriceRatio;
      } else {
        // balanced_market — a broader but still relevant band.
        priceOk = comp.price >= ourPrice * 0.8 && comp.price <= ourPrice * settings.maximumCompPriceRatio;
      }
    }
    const mileageOk = !settings.requireSimilarMileageBand ||
      isWithinMileageBand(comp.miles, vehicle.mileage, settings.mileageBandPercent);
    const trimOk = settings.compStrategy !== "value_building" || !settings.requireSameTrimWhenAvailable ||
      !vehicle.trim || !comp.trim || normalizeTrim(comp.trim) === normalizeTrim(vehicle.trim);
    const drivetrainOk = settings.compStrategy !== "value_building" || !settings.requireSameDrivetrainWhenAvailable ||
      !vehicle.drivetrain || !comp.drivetrain || normalizeDrivetrain(comp.drivetrain) === normalizeDrivetrain(vehicle.drivetrain);
    return priceOk && mileageOk && trimOk && drivetrainOk;
  });
}

// Rank the surviving comps by how well they support the value story.
export function scoreCompForValueStory(comp: CompLike, vehicle: CompSubject): number {
  let score = 0;
  if (vehicle.trim && comp.trim && normalizeTrim(comp.trim) === normalizeTrim(vehicle.trim)) score += 30;
  if (vehicle.drivetrain && comp.drivetrain && normalizeDrivetrain(comp.drivetrain) === normalizeDrivetrain(vehicle.drivetrain)) score += 20;
  if (isWithinMileageBand(comp.miles, vehicle.mileage, 25) && comp.miles != null && vehicle.mileage != null) score += 20;
  if (vehicle.price != null && comp.price != null && comp.price >= vehicle.price) score += 25;
  if (vehicle.price != null && comp.price != null && comp.price > vehicle.price) score += 10;
  if (comp.distanceMiles != null && comp.distanceMiles <= 25) score += 10;
  if (comp.daysOnMarket != null && comp.daysOnMarket <= 90) score += 5;
  return score;
}

export function rankCompsForValueStory<T extends CompLike>(comps: T[], vehicle: CompSubject): T[] {
  return [...comps].sort((a, b) => scoreCompForValueStory(b, vehicle) - scoreCompForValueStory(a, vehicle));
}

export const COMP_STRATEGY_OPTIONS: { value: CompStrategy; label: string; help: string }[] = [
  { value: "value_building", label: "Value Building (recommended)", help: "Shows similar vehicles priced at or above this vehicle, or close enough to support the value story." },
  { value: "balanced_market", label: "Balanced Market", help: "Shows a broader set of similar vehicles above and below this vehicle." },
  { value: "all_comps", label: "All Comps", help: "Shows all matching comparable vehicles. Use carefully — this can expose lower-priced competing inventory." },
];
