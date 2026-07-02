interface FinancingImpactProps {
  addOnTotal: number;
  inkSaving?: boolean;
  // Dealer-configured illustrative APR; falls back to market-typical rates.
  apr?: number | null;
}

/**
 * FTC-recommended disclosure showing the impact of add-on products
 * on financing. Shows the total cost over common loan terms so the
 * customer understands what the add-ons cost over time.
 *
 * This satisfies the "express, informed consent" requirement where
 * the consumer must see "all fees and costs over the period of
 * repayment with and without the product or service."
 */
const FinancingImpact = ({ addOnTotal, inkSaving, apr }: FinancingImpactProps) => {
  if (addOnTotal <= 0) return null;

  // Common auto loan APRs and terms for disclosure
  const dealerApr = typeof apr === "number" && apr > 0 && apr < 36 ? apr : null;
  const scenarios = [
    { term: 48, apr: dealerApr ?? 6.5 },
    { term: 60, apr: dealerApr ?? 6.5 },
    { term: 72, apr: dealerApr ?? 7.0 },
  ].map((s) => ({ ...s, label: `${s.term} mo / ${s.apr}% APR` }));

  return (
    <div className={`px-3 py-2 rounded ${inkSaving ? "bg-card border border-border" : "bg-amber-50/50 border border-amber-200/50"}`}>
      <p className="text-[8px] font-bold text-foreground mb-1">
        Financing Impact Disclosure
      </p>
      <p className="text-[7px] text-muted-foreground mb-1.5 leading-tight">
        If these add-on products are included in your financing, below is the
        estimated additional cost over the life of the loan at common rates.
        Your actual rate and terms may differ. Ask your finance manager for exact figures.
      </p>
      <div className="grid grid-cols-3 gap-2">
        {scenarios.map((s) => {
          const monthlyRate = s.apr / 100 / 12;
          const monthlyPayment =
            (addOnTotal * monthlyRate * Math.pow(1 + monthlyRate, s.term)) /
            (Math.pow(1 + monthlyRate, s.term) - 1);
          const totalPaid = monthlyPayment * s.term;
          const totalInterest = totalPaid - addOnTotal;

          return (
            <div key={s.term} className="text-center">
              <p className="text-[7px] text-muted-foreground">{s.label}</p>
              <p className="text-[9px] font-bold text-foreground">
                +${monthlyPayment.toFixed(2)}/mo
              </p>
              <p className="text-[6px] text-muted-foreground">
                ${totalPaid.toFixed(0)} total (+${totalInterest.toFixed(0)} interest)
              </p>
            </div>
          );
        })}
      </div>
      <p className="text-[6px] text-muted-foreground mt-1 leading-tight">
        Add-on total without financing: ${addOnTotal.toFixed(2)}. Rates shown are
        illustrative only and do not constitute a financing offer. Actual financing
        terms are determined by your lender.
      </p>
    </div>
  );
};

export default FinancingImpact;
