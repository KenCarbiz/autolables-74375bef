import { fmt$ } from "@/lib/passportV2Data";
import type { SalePriceCard } from "@/lib/priceModel";

// ──────────────────────────────────────────────────────────────
// VehiclePriceBreakdown — the customer-facing pricing area on the
// Vehicle Passport: a "Today's Sale Price" headline over the itemized
// breakdown card. Pure presentation over a pre-validated SalePriceCard
// (see buildSalePriceCard). It renders NO price math of its own.
//
// The math ladder (image 2):
//   NEW:      MSRP − rebates − Dealer Discount = Vehicle Selling Price
//   USED/CPO: Market Value    − Dealer Discount = Vehicle Selling Price
//   + Dealer Doc Fee = Total Advertised Price  (== the big headline)
//
// The card renders whenever the total reconciles; each row renders
// individually and the minimum truthful card is Vehicle Selling Price →
// Total Advertised Price. It never disappears because an optional row is
// missing, and never repeats the total as three identical rows.
// ──────────────────────────────────────────────────────────────

const PRIMARY = "#0D1B2A";
const MUTED = "#71819A";
const DISCOUNT = "#16A34A";
const BORDER = "#DDE4ED";

interface Props {
  card: SalePriceCard;
  heading?: string;
  priceClassName?: string;
}

const Row = ({ label, value, bold, color }: { label: string; value: string; bold?: boolean; color: string }) => (
  <div className="flex items-baseline justify-between gap-4">
    <span className={`text-[13.5px] ${bold ? "font-bold" : "font-medium"}`} style={{ color: bold ? PRIMARY : color }}>{label}</span>
    <span className={`text-[14px] tabular-nums ${bold ? "font-extrabold" : "font-semibold"}`} style={{ color }}>{value}</span>
  </div>
);

const VehiclePriceBreakdown = ({ card, heading = "Today's Sale Price", priceClassName = "text-[32px]" }: Props) => {
  // Renders whenever the total reconciles. Optional rows (anchor, rebates,
  // discount, fee) render individually; the minimum truthful card is Vehicle
  // Selling Price → Total Advertised Price. Only a non-reconciling/non-finite
  // total suppresses it.
  const showCard = card.reconciles && Number.isFinite(card.totalAdvertisedPrice);
  return (
    <div data-module="price-breakdown">
      <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: MUTED }}>{heading}</div>
      <div className={`mt-0.5 ${priceClassName} font-extrabold tabular-nums leading-none`} style={{ color: PRIMARY }}>{fmt$(card.totalAdvertisedPrice)}</div>

      {showCard && (
        <div className="mt-3 rounded-2xl bg-white p-4" style={{ border: `1px solid ${BORDER}` }}>
          {card.lines.length > 0 && (
            <>
              <div className="space-y-2.5">
                {card.lines.map((l) => (
                  <Row
                    key={l.key}
                    label={l.label}
                    value={l.role === "discount" ? `−${fmt$(l.amount)}` : fmt$(l.amount)}
                    color={l.role === "discount" ? DISCOUNT : MUTED}
                  />
                ))}
              </div>
              <div className="my-3 border-t" style={{ borderColor: BORDER }} />
            </>
          )}

          <Row label="Vehicle Selling Price" value={fmt$(card.vehicleSellingPrice)} bold color={PRIMARY} />

          {card.feeAmount != null && card.feeLabel && (
            <div className="mt-2.5">
              <Row label={`+ ${card.feeLabel}`} value={fmt$(card.feeAmount)} color={MUTED} />
            </div>
          )}

          <div className="my-3 border-t" style={{ borderColor: BORDER }} />
          <Row label="Total Advertised Price" value={fmt$(card.totalAdvertisedPrice)} bold color={PRIMARY} />

          {card.showSavings && card.customerSavings != null && (
            <div className="mt-2.5 flex items-baseline justify-between gap-4">
              <span className="text-[13.5px] font-bold" style={{ color: DISCOUNT }}>You Save</span>
              <span className="text-[14px] tabular-nums font-extrabold" style={{ color: DISCOUNT }}>{fmt$(card.customerSavings)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default VehiclePriceBreakdown;
