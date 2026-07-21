import type { PassportData } from "@/lib/passportV2Data";
import { buildSalePriceCard, type PricingVehicleType, type SalePriceCard } from "@/lib/priceModel";

// ──────────────────────────────────────────────────────────────
// buildPassportSaleCard — the ONE mapper from derived PassportData to the
// canonical SalePriceCard. Both the live V3 passport and the governed passport
// call this so their pricing numbers, labels and savings can never diverge.
//
// The nightly-scraped Total Advertised Price ALWAYS includes the doc fee, so we
// work backward: Vehicle Selling Price = Total − Doc Fee. When the tenant
// advertises before-doc, the total is price + fee; when the price already
// includes the fee, price IS the total. Nothing here is fabricated — a missing
// MSRP / Market Value simply yields no anchor ladder.
// ──────────────────────────────────────────────────────────────
export function buildPassportSaleCard(d: PassportData, condition: string | null | undefined): SalePriceCard | null {
  const price = d.price;
  const c = String(condition || "").toLowerCase();
  const isNew = c === "new";
  const vehicleType: PricingVehicleType = isNew ? "new" : (c === "cpo" || c.includes("certified")) ? "cpo" : "used";

  const docFeeVal = d.docFee != null && d.docFee > 0 ? d.docFee : 0;
  const vehicleSellingPrice = price != null ? (d.priceIncludesDoc ? price - docFeeVal : price) : null;
  const totalAdvertised = vehicleSellingPrice != null ? vehicleSellingPrice + docFeeVal : null;
  if (price == null || vehicleSellingPrice == null || totalAdvertised == null) return null;

  // NEW-vehicle factory rebates included in the advertised price. Only real,
  // captured amounts — never fabricated.
  const factoryRebates: { key: string; label: string; amount: number }[] = [];
  if (isNew && d.retailCash != null && d.retailCash > 0) {
    factoryRebates.push({ key: "retail_cash", label: "Retail Cash", amount: d.retailCash });
  }

  return buildSalePriceCard({
    vehicleType,
    msrp: d.msrp,
    marketValue: d.marketAvg,
    vehicleSellingPrice,
    totalAdvertisedPrice: totalAdvertised,
    docFee: docFeeVal,
    factoryRebates,
    documentedDealerDiscount: d.dealerDiscount,
  });
}
