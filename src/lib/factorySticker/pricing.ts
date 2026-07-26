import type { PriceStatus, StickerPricing } from "./types";

export class PricingInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PricingInputError";
  }
}

export interface PricedComponent {
  name: string;
  price?: number;
  priceStatus: PriceStatus;
  oemCredit?: boolean;
}

export interface MsrpReconciliationInput {
  baseMsrp?: number;
  destinationCharge?: number;
  sourceReportedTotalMsrp?: number;
  packages: PricedComponent[];
  options: PricedComponent[];
}

export interface MsrpReconciliation extends StickerPricing {
  notes: string[];
}

export const MATCHED_MAX_DIFF = 5;
export const MINOR_VARIATION_MAX_DIFF = 100;

const round2 = (n: number): number => Math.round(n * 100) / 100;

const assertHeadlineAmount = (label: string, value: number | undefined): void => {
  if (value === undefined) return;
  if (!Number.isFinite(value)) throw new PricingInputError(`${label} must be a finite number`);
  if (value < 0) throw new PricingInputError(`${label} must not be negative`);
};

const sumPriced = (items: PricedComponent[], kind: string): number | undefined => {
  let sum = 0;
  let pricedCount = 0;
  for (const item of items) {
    if (item.price !== undefined) {
      if (!Number.isFinite(item.price)) {
        throw new PricingInputError(`${kind} "${item.name}" has a non-finite price`);
      }
      if (item.price < 0 && item.oemCredit !== true) {
        throw new PricingInputError(
          `${kind} "${item.name}" has a negative price and is not flagged oemCredit`,
        );
      }
    }
    if (item.priceStatus === "PRICED" && item.price !== undefined) {
      sum += item.price;
      pricedCount += 1;
    }
  }
  return pricedCount > 0 ? round2(sum) : undefined;
};

export function derivePriceStatus(raw: {
  price?: number;
  explicitIncluded?: boolean;
  explicitNoCharge?: boolean;
  oemCredit?: boolean;
}): { price?: number; priceStatus: PriceStatus } {
  if (raw.explicitIncluded === true) return { priceStatus: "INCLUDED" };
  if (raw.price === 0 || raw.explicitNoCharge === true) {
    return raw.price === 0 ? { price: 0, priceStatus: "NO_CHARGE" } : { priceStatus: "NO_CHARGE" };
  }
  if (raw.price !== undefined && Number.isFinite(raw.price)) {
    if (raw.price > 0) return { price: raw.price, priceStatus: "PRICED" };
    if (raw.price < 0 && raw.oemCredit === true) return { price: raw.price, priceStatus: "PRICED" };
  }
  return { priceStatus: "UNAVAILABLE" };
}

export function reconcileMsrp(input: MsrpReconciliationInput): MsrpReconciliation {
  assertHeadlineAmount("baseMsrp", input.baseMsrp);
  assertHeadlineAmount("destinationCharge", input.destinationCharge);
  assertHeadlineAmount("sourceReportedTotalMsrp", input.sourceReportedTotalMsrp);

  const notes: string[] = [];
  const packagesTotal = sumPriced(input.packages, "package");
  const optionsTotal = sumPriced(input.options, "option");
  const factoryInstalledTotal =
    packagesTotal === undefined && optionsTotal === undefined
      ? undefined
      : round2((packagesTotal ?? 0) + (optionsTotal ?? 0));

  const base: MsrpReconciliation = {
    currency: "USD",
    ...(input.baseMsrp !== undefined ? { baseMsrp: input.baseMsrp } : {}),
    ...(packagesTotal !== undefined ? { packagesTotal } : {}),
    ...(optionsTotal !== undefined ? { optionsTotal } : {}),
    ...(factoryInstalledTotal !== undefined ? { factoryInstalledTotal } : {}),
    ...(input.destinationCharge !== undefined ? { destinationCharge: input.destinationCharge } : {}),
    ...(input.sourceReportedTotalMsrp !== undefined
      ? { sourceReportedTotalMsrp: input.sourceReportedTotalMsrp }
      : {}),
    reconciliationStatus: "INSUFFICIENT_DATA",
    notes,
  };

  if (input.baseMsrp === undefined) {
    notes.push("baseMsrp unavailable; total MSRP cannot be calculated");
    return base;
  }

  const calculatedTotalMsrp = round2(
    input.baseMsrp + (factoryInstalledTotal ?? 0) + (input.destinationCharge ?? 0),
  );
  base.calculatedTotalMsrp = calculatedTotalMsrp;

  if (input.destinationCharge === undefined) {
    notes.push("destinationCharge unavailable; total calculated without it");
  }

  if (input.sourceReportedTotalMsrp === undefined) {
    if (input.destinationCharge !== undefined) {
      notes.push("sourceReportedTotalMsrp unavailable; total calculated from components");
      base.reconciliationStatus = "MATCHED";
    } else {
      notes.push("sourceReportedTotalMsrp and destinationCharge both unavailable; total cannot be verified");
      base.reconciliationStatus = "REVIEW_REQUIRED";
    }
    return base;
  }

  const diff = round2(calculatedTotalMsrp - input.sourceReportedTotalMsrp);
  base.reconciliationDifference = diff;
  const abs = Math.abs(diff);
  if (abs <= MATCHED_MAX_DIFF) {
    base.reconciliationStatus = "MATCHED";
  } else if (abs <= MINOR_VARIATION_MAX_DIFF) {
    base.reconciliationStatus = "MINOR_VARIATION";
  } else {
    base.reconciliationStatus = "REVIEW_REQUIRED";
    if (input.destinationCharge === undefined) {
      notes.push("difference may be an unreported destination charge");
    }
  }
  return base;
}
