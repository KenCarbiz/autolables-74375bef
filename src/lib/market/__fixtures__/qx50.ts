// ── The QX50, exactly as production holds it ───────────────────────────────
//
// 2025 INFINITI QX50 SPORT, CPO, 12,912 miles, Harte INFINITI, ZIP 06120.
// Every value below was read out of vehicle_listings on 2026-09-10 and is not
// illustrative. This is the permanent regression fixture: if a change to the
// engine lets this car show a red above-market warning again, the suite fails.

import type { ComparableCandidate, ProviderValuation } from "../types.ts";
import type { LegacyComparableRow } from "../legacyAdapter.ts";

export const QX50_VIN = "3PCAJ5FB1SF109708";

export const QX50_LISTING = {
  vin: QX50_VIN,
  ymm: "2025 INFINITI QX50",
  year: 2025,
  make: "INFINITI",
  model: "QX50",
  trim: "Sport",
  condition: "cpo" as const,
  mileage: 12912,
  price: 43876,
  advertisedPriceBeforeDoc: 42981,
  websiteSalePrice: 43876,
  docFee: 895,
  advertisedExcludesDocFee: false,
  dealerType: "franchise" as const,
  zip: "06120",
  dealerName: "Harte Infiniti",
};

/** What MarketCheck returned, and the flag that makes it unusable for a CPO conclusion. */
export const QX50_STORED_PROVIDER_BODY = {
  predicted_price: 39158,
  price_range: { lower_bound: 37203, upper_bound: 41513 },
  specs: { is_certified: false },
};

export const QX50_STORED_PROVIDER: ProviderValuation = {
  provider: "marketcheck",
  endpointVersion: "legacy/predict/car/price",
  selectedField: "predicted_price",
  predictedValue: 39158,
  providerRangeLow: 37203,
  providerRangeHigh: 41513,
  providerRangeMeaning: "Provider Estimated Range",
  providerCertifiedEcho: false,
  requestFingerprint: "legacy-request",
  responseHash: "legacyresponse00",
  requestedAt: "2026-09-09T08:10:27.352Z",
  receivedAt: "2026-09-09T08:10:27.352Z",
  rawResponseSanitized: QX50_STORED_PROVIDER_BODY,
};

/** The seven comparables stored against this VIN, verbatim. */
export const QX50_STORED_COMPARABLES: LegacyComparableRow[] = [
  { vin: "3PCAJ5FB8SF104621", ymm: "2025 INFINITI QX50 SPORT", trim: "Sport", miles: 11134, price: 43876, dist: 0.32, dealer: "Harte Infiniti", dom: 258 },
  { vin: "3PCAJ5FB2SF105392", ymm: "2025 INFINITI QX50 SPORT", trim: "Sport", miles: 19076, price: 40883, dist: 0.32, dealer: "Harte Infiniti", dom: 178 },
  { vin: "3PCAJ5FB3SF116353", ymm: "Used 2025 INFINITI QX50 SPORT", trim: "Sport", miles: 4591, price: 40181, dist: 94.4, dealer: "Infiniti Of Lynbrook", dom: 81 },
  { vin: "3PCAJ5FBXSF116446", ymm: "Used 2025 INFINITI QX50 SPORT", trim: "Sport", miles: 3433, price: 39898, dist: 94.4, dealer: "Infiniti Of Lynbrook", dom: 91 },
  { vin: "3PCAJ5FB3SF116465", ymm: "Used 2025 INFINITI QX50 SPORT", trim: "Sport", miles: 4194, price: 39799, dist: 94.4, dealer: "Infiniti Of Lynbrook", dom: 91 },
  { vin: "3PCAJ5FBXSF109058", ymm: "Pre-Owned 2025 INFINITI QX50 SPORT With Navigation", trim: "Sport", miles: 11711, price: 38431, dist: 10.51, dealer: "Acura Of Berlin", dom: 123 },
  { vin: "3PCAJ5FB8SF107647", ymm: "Used 2025 INFINITI QX50 SPORT", trim: "Sport", miles: 8243, price: 38000, dist: 68.58, dealer: "Smithtown Nissan", dom: 178 },
];

/** What the dealer UI shows today, and what a naive fee correction would show. */
export const QX50_CURRENT_UI = {
  displayedDifference: 43876 - 39158,      // 4718
  feeCorrectedDifference: 42981 - 39158,   // 3823
};

/** Harte's own identity. No dealer id exists in the legacy rows, so name is all there is. */
export const HARTE_IDENTITY = {
  names: ["Harte Infiniti"],
};

/**
 * The vAuto validation evidence, kept separate because it is a different
 * question: two CPO comparisons supplied by an outside tool, used to show that
 * a 105% price-to-market on two cars is still low confidence and still not red.
 */
export const VAUTO_CPO_EVIDENCE = {
  subjectComparisonPrice: 42981,
  subjectMileage: 12912,
  prices: [39487, 42186],
  mileages: [11346, 12805],
  midpoint: 40836.5,
  priceToMarketPercent: 105.3,
  differenceFromHighestComp: 795,
  qualifiedCount: 2,
};

/** The corrected request that must go out once CPO is honoured. */
export const QX50_CORRECTED_REQUEST = {
  vin: QX50_VIN,
  miles: "12912",
  dealer_type: "franchise",
  zip: "06120",
  is_certified: "true",
};

export const asCandidates = (rows: LegacyComparableRow[]): ComparableCandidate[] => rows as ComparableCandidate[];
