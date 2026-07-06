// ──────────────────────────────────────────────────────────────
// Affordability math
//
// Shopper-facing payment transparency: given a vehicle price,
// estimate monthly payment at 60/72/84 months and surface the
// *lifetime cost* of the loan. CDG's recurring thesis (Q1 2026
// affordability crisis: avg $773/mo, 22.9% at 84 months) argues
// that the winning dealer publishes the payment math up front.
//
// This utility powers the AffordabilityStrip rendered on every
// public /v/<slug> shopper page.
// ──────────────────────────────────────────────────────────────

export interface AffordabilityInput {
  price: number;                // vehicle OTD price (incl. fees)
  downPayment?: number;         // customer cash down
  tradeInCredit?: number;       // net trade equity
  aprPercent?: number;          // default: current national avg
  salesTaxPercent?: number;     // default 0 (varies by state)
}

export interface AffordabilityRow {
  term_months: number;
  monthly_payment: number;
  total_of_payments: number;
  total_interest: number;
  lifetime_cost: number;        // price + tax + interest (net of trade + down)
  apr_percent: number;
}

// National averages as of Q1 2026 per CDG / Edmunds coverage.
// These are defaults only; the dealer can override per row.
export const DEFAULT_APR_PERCENT = 7.25;
export const DEFAULT_TERMS_MONTHS = [60, 72, 84] as const;

// ── Passport payment-estimate display toggles ──────────────────────────
// The dealer controls which pieces of the passport payment estimate the shopper
// sees. `payment` off hides the whole "Est. $X/mo" line; the other three toggle
// each assumption chip (term / down payment / APR) independently. Default: all
// shown. Stored on dealer_profiles.settings.passport_payment_display.
export interface PaymentDisplay {
  payment: boolean;      // the "Est. $X/mo" figure itself
  downPayment: boolean;  // the "10% down" assumption chip
  term: boolean;         // the "72 mo" assumption chip
  interestRate: boolean; // the "7.25% APR" assumption chip
}

export const DEFAULT_PAYMENT_DISPLAY: PaymentDisplay = {
  payment: true, downPayment: true, term: true, interestRate: true,
};

export function getPaymentDisplay(settings: unknown): PaymentDisplay {
  const raw = (settings as { passport_payment_display?: unknown } | null | undefined)?.passport_payment_display;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const r = raw as Record<string, unknown>;
    const b = (k: keyof PaymentDisplay) => (typeof r[k] === "boolean" ? (r[k] as boolean) : DEFAULT_PAYMENT_DISPLAY[k]);
    return { payment: b("payment"), downPayment: b("downPayment"), term: b("term"), interestRate: b("interestRate") };
  }
  return { ...DEFAULT_PAYMENT_DISPLAY };
}

// Compose the "72 mo · 10% down · 7.25% APR example" assumption line from only
// the chips the dealer left enabled. Returns "" when none are enabled.
export function buildPaymentAssumptions(
  display: PaymentDisplay,
  opts: { termMonths: number; downPercent: number; aprPercent: number },
): string {
  const parts = [
    display.term ? `${opts.termMonths} mo` : null,
    display.downPayment ? `${opts.downPercent}% down` : null,
    display.interestRate ? `${opts.aprPercent}% APR` : null,
  ].filter(Boolean) as string[];
  return parts.length ? `${parts.join(" · ")} example` : "";
}

export const estimateAffordability = (
  input: AffordabilityInput,
  terms: readonly number[] = DEFAULT_TERMS_MONTHS
): AffordabilityRow[] => {
  const apr = input.aprPercent ?? DEFAULT_APR_PERCENT;
  const tax = (input.price * (input.salesTaxPercent ?? 0)) / 100;
  const principal =
    input.price + tax - (input.downPayment ?? 0) - (input.tradeInCredit ?? 0);
  if (principal <= 0) {
    return terms.map((t) => ({
      term_months: t,
      monthly_payment: 0,
      total_of_payments: 0,
      total_interest: 0,
      lifetime_cost: Math.max(0, input.price + tax),
      apr_percent: apr,
    }));
  }
  const r = apr / 100 / 12;
  return terms.map((term) => {
    const monthly = r === 0 ? principal / term : (principal * r) / (1 - Math.pow(1 + r, -term));
    const total = monthly * term;
    const interest = total - principal;
    return {
      term_months: term,
      monthly_payment: round2(monthly),
      total_of_payments: round2(total),
      total_interest: round2(interest),
      lifetime_cost: round2(
        input.price + tax + interest - (input.tradeInCredit ?? 0)
      ),
      apr_percent: apr,
    };
  });
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export const formatCurrency = (n: number) =>
  n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

export const formatCurrencyCents = (n: number) =>
  n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
  });
