import { fmt$ } from "@/lib/passportV2Data";
import type { SalePriceCard } from "@/lib/priceModel";

// ──────────────────────────────────────────────────────────────
// VehiclePriceBreakdown — the customer-facing pricing area on the
// Vehicle Passport: a "Today's Sale Price" headline over an itemized
// card. Pure presentation over a pre-validated SalePriceCard (see
// buildSalePriceCard). It renders NO price math of its own; it only
// lays out rows the model already reconciled.
//
// Starting row is MSRP (new) or Market Value (used/CPO), decided in
// the model. When there is nothing truthful to itemize — no anchor
// gap and no included fee — or the card fails to reconcile, only the
// headline renders (the smallest truthful presentation).
// ──────────────────────────────────────────────────────────────

const PRIMARY = "#0D1B2A";
const MUTED = "#64748B";
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
  // The card renders whenever there is a valid, reconciling final price. It never
  // disappears because an OPTIONAL row (anchor, discount, or fee) is missing —
  // each row renders individually; the minimum truthful card is Vehicle Price →
  // Today's Sale Price. Only a non-reconciling / non-finite total suppresses it.
  const showCard = card.reconciles && Number.isFinite(card.finalSalePrice);
  return (
    <div data-module="price-breakdown">
      <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: MUTED }}>{heading}</div>
      <div className={`mt-0.5 ${priceClassName} font-extrabold tabular-nums leading-none`} style={{ color: PRIMARY }}>{fmt$(card.finalSalePrice)}</div>

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

          <Row label="Vehicle Price" value={fmt$(card.vehiclePrice)} bold color={PRIMARY} />

          {card.feeAmount != null && card.feeLabel && (
            <div className="mt-2.5">
              <Row label={`+ ${card.feeLabel}`} value={fmt$(card.feeAmount)} color={MUTED} />
            </div>
          )}

          <div className="my-3 border-t" style={{ borderColor: BORDER }} />
          <Row label="Today's Sale Price" value={fmt$(card.finalSalePrice)} bold color={PRIMARY} />
        </div>
      )}
    </div>
  );
};

export default VehiclePriceBreakdown;
