export const complianceVinParam = (raw: string | undefined): string =>
  (raw ?? "").toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "").slice(0, 17);

export const priceReviewHref = (vin: string): string => `/compliance/price-review/${vin}`;
export const vinDefenseHref = (vin: string): string => `/compliance/vin-defense/${vin}`;
