import { Product } from "@/hooks/useProducts";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { getDocFeeTerminology, getDocFeeForState } from "@/data/docFees";

interface TotalBarProps {
  installedTotal: number;
  optionalTotal: number;
  grandTotal: number;
  optionalItems: Product[];
  acceptedOptional: Product[];
  inkSaving?: boolean;
  vehicleCondition?: "new" | "used";
  baseMsrp?: number;       // Factory MSRP for new cars
  marketValue?: number;     // Market value for used cars
}

const TotalBar = ({ installedTotal, optionalTotal, grandTotal, optionalItems, acceptedOptional, inkSaving, vehicleCondition, baseMsrp, marketValue }: TotalBarProps) => {
  const { settings } = useDealerSettings();
  const docFeeLabel = getDocFeeTerminology(settings.doc_fee_state || "CT");
  const docFeeConfig = getDocFeeForState(settings.doc_fee_state || "CT");
  const docFeeAmount = settings.doc_fee_enabled ? (settings.doc_fee_amount || 0) : 0;
  const cappedNote = docFeeConfig?.maxFee && docFeeAmount > docFeeConfig.maxFee
    ? ` (exceeds ${settings.doc_fee_state} $${docFeeConfig.maxFee} cap)`
    : "";

  const installedWithFee = installedTotal + docFeeAmount;
  const grandWithFee = grandTotal + docFeeAmount;
  const allOptionalSum = optionalItems.reduce((s, p) => s + p.price, 0);

  const isNew = vehicleCondition === "new";
  const basePrice = isNew ? (baseMsrp || 0) : (marketValue || 0);
  const basePriceLabel = isNew ? "Manufacturer's Suggested Retail Price (MSRP)" : "Market Value";
  const totalLabel = isNew ? "Total Suggested Retail Price" : "Total Price";
  const totalAmount = basePrice + installedWithFee + (optionalTotal || 0);

  return (
    <div className={`px-3 py-2 rounded ${inkSaving ? "bg-card border border-border" : "bg-navy/5 border border-navy/20"}`}>

      {/* Base price line (MSRP or Market Value) — only if provided */}
      {basePrice > 0 && (
        <div className="flex items-baseline justify-between pb-1.5 mb-1.5 border-b border-border-custom/50">
          <p className="text-[10px] font-bold text-foreground">{basePriceLabel}</p>
          <p className="text-sm font-bold text-foreground tabular-nums">${basePrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
        </div>
      )}

      {/* Accessories / installed items */}
      <div className="flex items-baseline justify-between">
        <div>
          <p className="text-[10px] font-bold text-foreground">
            {isNew ? "Dealer-Installed Accessories" : "Pre-Installed Items (Non-Removable)"}
          </p>
          <p className="text-[8px] text-muted-foreground">
            {isNew ? "Added by dealer prior to sale" : "Included in vehicle selling price · not optional"}
          </p>
          {optionalItems.length > 0 && (
            <p className="text-[8px] text-muted-foreground mt-0.5">
              + Optional items: ${allOptionalSum.toFixed(2)} (if accepted)
            </p>
          )}
          {settings.doc_fee_enabled && docFeeAmount > 0 && (
            <p className="text-[8px] text-muted-foreground mt-0.5">
              + {docFeeLabel}: ${docFeeAmount.toFixed(2)}
              {cappedNote && <span className="text-red font-semibold">{cappedNote}</span>}
            </p>
          )}
        </div>
        <div className="text-right">
          <p className="text-[10px] font-semibold text-muted-foreground">Accessories Total</p>
          <p className="text-sm font-bold text-foreground tabular-nums">${installedWithFee.toFixed(2)}</p>
        </div>
      </div>

      {/* Grand total line */}
      {basePrice > 0 && (
        <div className="flex items-baseline justify-between mt-2 pt-2 border-t-2 border-foreground">
          <p className="text-[11px] font-extrabold text-foreground uppercase tracking-wide">{totalLabel}</p>
          <p className="text-base font-extrabold text-foreground tabular-nums">${totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
        </div>
      )}

      {/* If no base price, show the old installed total */}
      {basePrice === 0 && optionalItems.length > 0 && (
        <p className="text-[8px] text-muted-foreground mt-1">
          ${(installedWithFee + allOptionalSum).toFixed(2)} if all optional accepted
        </p>
      )}

      {/* Doc Fee disclosure line */}
      {settings.doc_fee_enabled && docFeeAmount > 0 && (
        <div className="mt-1 pt-1 border-t border-border-custom/50">
          <p className="text-[7px] text-muted-foreground leading-tight">
            <strong>{docFeeLabel}:</strong> A {docFeeLabel.toLowerCase()} of ${docFeeAmount.toFixed(2)} is charged to cover the cost of processing documents related to the sale of this vehicle. This {docFeeLabel.toLowerCase()} is a charge by the dealer and is not a tax or government fee.
            {docFeeConfig?.notes && ` ${docFeeConfig.notes}.`}
          </p>
        </div>
      )}
    </div>
  );
};

export default TotalBar;
