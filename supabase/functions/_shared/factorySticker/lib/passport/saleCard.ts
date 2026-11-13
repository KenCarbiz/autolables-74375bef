// GENERATED — do not edit.
// Mirror of src/lib/passport/saleCard.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
import type { PassportData } from "../passportV2Data.ts";
import { buildSalePriceCard, type PricingVehicleType, type SalePriceCard } from "../priceModel.ts";
export function buildPassportSaleCard(d: PassportData, condition: string | null | undefined): SalePriceCard | null {
    const price = d.price;
    const c = String(condition || "").toLowerCase();
    const isNew = c === "new";
    const vehicleType: PricingVehicleType = isNew ? "new" : (c === "cpo" || c.includes("certified")) ? "cpo" : "used";
    const docFeeVal = d.docFee != null && d.docFee > 0 ? d.docFee : 0;
    const vehicleSellingPrice = price != null ? (d.priceIncludesDoc ? price - docFeeVal : price) : null;
    const totalAdvertised = vehicleSellingPrice != null ? vehicleSellingPrice + docFeeVal : null;
    if (price == null || vehicleSellingPrice == null || totalAdvertised == null)
        return null;
    const factoryRebates: {
        key: string;
        label: string;
        amount: number;
    }[] = [];
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
