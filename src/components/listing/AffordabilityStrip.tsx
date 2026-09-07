import { useMemo, useState } from "react";
import {
  DEFAULT_APR_PERCENT,
  estimateAffordability,
  formatCurrency,
  formatCurrencyCents,
} from "@/lib/affordability";
import { Calculator, Info } from "lucide-react";

// ──────────────────────────────────────────────────────────────
// AffordabilityStrip
//
// Sits above the fold on /v/<slug>. Shows estimated payment at
// 60/72/84 months with the lifetime-cost number in plain English.
// Editable: shopper can move the down-payment, trade-in, and APR
// to make the math their own. No login required.
//
// Aligned with CDG's Q1 2026 affordability transparency thesis:
// surface the loan math BEFORE F&I so trust isn't burned in the
// box.
// ──────────────────────────────────────────────────────────────

interface Props {
  vehiclePrice: number;
  defaultDownPayment?: number;
  defaultApr?: number;
  state?: string;
}

const STATE_TAX_DEFAULTS: Record<string, number> = {
  // Approximate combined state + average local sales tax. Dealers
  // can ignore this if they don't want to publish a tax estimate.
  CA: 8.85,
  TX: 6.25,
  FL: 6.0,
  NY: 8.0,
  IL: 7.25,
  PA: 6.0,
  OH: 6.5,
  GA: 7.0,
  NC: 4.75,
  WA: 6.5,
};

export const AffordabilityStrip = ({
  vehiclePrice,
  defaultDownPayment = 2000,
  defaultApr = DEFAULT_APR_PERCENT,
  state,
}: Props) => {
  const [down, setDown] = useState(defaultDownPayment);
  const [apr, setApr] = useState(defaultApr);
  const [trade, setTrade] = useState(0);
  const [showDetails, setShowDetails] = useState(false);

  const tax = state ? STATE_TAX_DEFAULTS[state.toUpperCase()] ?? 0 : 0;

  const rows = useMemo(
    () =>
      estimateAffordability({
        price: vehiclePrice || 0,
        downPayment: down,
        tradeInCredit: trade,
        aprPercent: apr,
        salesTaxPercent: tax,
      }),
    [vehiclePrice, down, trade, apr, tax]
  );

  if (!vehiclePrice || vehiclePrice <= 0) return null;

  return (
    <section
      aria-label="Estimated monthly payment"
      className="rounded-2xl border border-border bg-white shadow-sm overflow-hidden"
    >
      <header className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-[#0B2041] to-[#1E90FF] text-white">
        <div className="flex items-center gap-2">
          <Calculator className="w-4 h-4" />
          <h3 className="text-sm font-semibold tracking-tight">Estimated Monthly Payment</h3>
        </div>
        <span className="text-[10px] uppercase tracking-label opacity-80">
          Transparent math
        </span>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-3 divide-x divide-slate-200 bg-white">
        {rows.map((r) => (
          <div key={r.term_months} className="p-4 text-center">
            <p className="text-[10px] font-bold uppercase tracking-label text-muted-foreground">
              {r.term_months} months
            </p>
            <p className="mt-1 text-2xl font-black tabular-nums text-foreground">
              {formatCurrencyCents(r.monthly_payment)}
              <span className="text-xs font-normal text-muted-foreground">/mo</span>
            </p>
            <p className="text-[10px] text-muted-foreground mt-1 tabular-nums">
              Lifetime cost {formatCurrency(r.lifetime_cost)}
            </p>
          </div>
        ))}
      </div>

      <div className="px-4 py-3 border-t border-border grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <Field
          label="Down payment"
          value={down}
          onChange={setDown}
          step={500}
          min={0}
          prefix="$"
        />
        <Field
          label="Trade equity"
          value={trade}
          onChange={setTrade}
          step={500}
          min={0}
          prefix="$"
        />
        <Field
          label="APR"
          value={apr}
          onChange={setApr}
          step={0.25}
          min={0}
          suffix="%"
        />
        {tax > 0 ? (
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-label">
              Sales tax (est.)
            </p>
            <p className="mt-1 h-9 flex items-center font-semibold text-foreground tabular-nums">
              {tax.toFixed(2)}%
            </p>
          </div>
        ) : (
          <div />
        )}
      </div>

      <button
        onClick={() => setShowDetails((v) => !v)}
        className="w-full px-4 py-2 text-[11px] text-muted-foreground hover:text-foreground border-t border-border flex items-center justify-center gap-1.5"
      >
        <Info className="w-3 h-3" />
        {showDetails ? "Hide assumptions" : "How is this calculated?"}
      </button>
      {showDetails && (
        <div className="px-4 pb-4 text-[11px] text-muted-foreground leading-relaxed bg-muted">
          Estimates use simple-interest amortization on price minus
          down + trade, plus an estimated sales-tax line for the
          state above. APR is editable; default reflects the Q1 2026
          national average for new vehicles per Edmunds. Your actual
          APR depends on credit tier and lender. This estimate is for
          shopper transparency only and is not a credit offer.
        </div>
      )}
    </section>
  );
};

interface FieldProps {
  label: string;
  value: number;
  onChange: (n: number) => void;
  step: number;
  min?: number;
  prefix?: string;
  suffix?: string;
}

const Field = ({ label, value, onChange, step, min = 0, prefix, suffix }: FieldProps) => (
  <div>
    <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-label">
      {label}
    </label>
    <div className="mt-1 relative">
      {prefix && (
        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">
          {prefix}
        </span>
      )}
      <input
        type="number"
        value={value}
        step={step}
        min={min}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          onChange(isNaN(v) ? 0 : Math.max(min, v));
        }}
        className={`w-full h-9 rounded-md border border-border bg-white text-right text-sm font-semibold text-foreground tabular-nums ${
          prefix ? "pl-5 pr-2" : "px-2"
        } focus:outline-none focus:border-[#1E90FF]`}
      />
      {suffix && (
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">
          {suffix}
        </span>
      )}
    </div>
  </div>
);

export default AffordabilityStrip;
