// "Your deal at a glance" — the receipt-before-signature summary that lets a
// customer (and later a juror) answer the whole transaction in one frame:
// what vehicle, what was already installed and in the price, what they
// optionally accepted, the fee, and the total. Renders on the addendum sheet
// above the line-item detail.

const money = (n: number) =>
  `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface PurchaseSummaryProps {
  ymm: string;
  vin: string;
  installedTotal: number;
  installedCount: number;
  optionalTotal: number;
  optionalAcceptedCount: number;
  optionalAvailableCount: number;
  docFee: number;
  docFeeLabel: string;
  state?: string | null;
  inkSaving?: boolean;
}

const Row = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-baseline justify-between gap-2">
    <span className="text-muted-foreground">{label}</span>
    <span className="font-semibold tabular-nums text-foreground">{value}</span>
  </div>
);

const PurchaseSummary = ({
  ymm,
  vin,
  installedTotal,
  installedCount,
  optionalTotal,
  optionalAcceptedCount,
  optionalAvailableCount,
  docFee,
  docFeeLabel,
  state,
  inkSaving,
}: PurchaseSummaryProps) => {
  const total = installedTotal + optionalTotal + docFee;
  const vinTail = vin && vin.trim().length >= 4 ? `…${vin.trim().slice(-4)}` : vin.trim();

  return (
    <div className="px-3 pt-2">
      <div className={`rounded-lg border-2 p-3 ${inkSaving ? "border-border" : "border-navy/30 bg-navy/5"}`}>
        <div className="flex items-center justify-between gap-2">
          <p className="text-[9px] font-extrabold uppercase tracking-[0.14em] text-foreground">
            Your deal at a glance
          </p>
          <span className="text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
            {state ? `${state} disclosures` : "Itemized"}
          </span>
        </div>

        <p className="text-[11px] font-semibold text-foreground mt-1">
          {ymm || "Vehicle"}
          {vinTail ? ` · VIN ${vinTail}` : ""}
        </p>

        <div className="mt-2 space-y-0.5 text-[10px]">
          <Row
            label={`Already installed (in price) · ${installedCount} item${installedCount === 1 ? "" : "s"}`}
            value={money(installedTotal)}
          />
          <Row
            label={`Optional you accepted · ${optionalAcceptedCount} of ${optionalAvailableCount}`}
            value={money(optionalTotal)}
          />
          {docFee > 0 && <Row label={`${docFeeLabel} (negotiable)`} value={money(docFee)} />}
        </div>

        <div className="mt-1.5 pt-1.5 border-t-2 border-foreground flex items-baseline justify-between">
          <span className="text-[10px] font-extrabold uppercase tracking-wide text-foreground">Addendum Total</span>
          <span className="text-sm font-extrabold tabular-nums text-foreground">{money(total)}</span>
        </div>

        <p className="text-[8px] text-muted-foreground mt-1 leading-tight">
          Pre-installed items are already on the vehicle and included in the advertised price. Optional items are your choice and are not required to buy, lease, or finance this vehicle.
        </p>
      </div>
    </div>
  );
};

export default PurchaseSummary;
