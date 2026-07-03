// ──────────────────────────────────────────────────────────────────────
// Today's Price page copy — dealer-configurable, compliance-safe.
//
// The platform default deliberately avoids negotiation-implying language
// ("best out-the-door price", "best price", "unlock price"): it suggests the
// advertised price isn't final and creates advertised-price compliance risk.
// Dealers opt into stronger wording per mode; out-the-door language renders
// ONLY when the dealer explicitly selects that mode (the selection is the
// consent), and custom copy is screened against the banned phrases unless
// the dealer flips the allow toggle.
// ──────────────────────────────────────────────────────────────────────

export type TodaysPriceMode =
  | "payment_estimate"
  | "confirm_price_availability"
  | "out_the_door_request"
  | "finance_precheck"
  | "custom";

export interface TodaysPriceCustom {
  headline: string;
  sub: string;
  cta: string;
  disclaimer: string;
  show_calculator: boolean;
  show_down: boolean;
  show_term: boolean;
  show_apr: boolean;
  allow_otd_wording: boolean;
}

export interface TodaysPriceCopy {
  mode: TodaysPriceMode;
  headline: string;
  sub: string;
  cta: string;
  reassurance: string;
  disclaimer: string;
  barLabel: string;
  showCalculator: boolean;
  showDown: boolean;
  showTerm: boolean;
  showApr: boolean;
}

export const DEFAULT_TODAYS_PRICE_CUSTOM: TodaysPriceCustom = {
  headline: "",
  sub: "",
  cta: "",
  disclaimer: "",
  show_calculator: true,
  show_down: true,
  show_term: true,
  show_apr: true,
  allow_otd_wording: false,
};

const REASSURANCE = "No obligation. A dealership representative will review your request and follow up with available payment details.";

const MODE_COPY: Record<Exclude<TodaysPriceMode, "custom">, Omit<TodaysPriceCopy, "showCalculator" | "showDown" | "showTerm" | "showApr">> = {
  payment_estimate: {
    mode: "payment_estimate",
    headline: "Today's Price",
    sub: "Personalize your payment estimate for this vehicle.",
    cta: "Request Payment Details",
    reassurance: REASSURANCE,
    disclaimer: "Estimate only, with approved credit. Excludes tax, title, registration, and dealer/state fees where applicable. Final terms are subject to lender approval and dealership confirmation.",
    barLabel: "Payment Details",
  },
  confirm_price_availability: {
    mode: "confirm_price_availability",
    headline: "Confirm Today's Price",
    sub: "Request confirmation of current availability and pricing.",
    cta: "Confirm Price & Availability",
    reassurance: "No obligation. A dealership representative will confirm availability and pricing with you directly.",
    disclaimer: "Pricing and availability are subject to dealership confirmation. Taxes, title, registration, and applicable fees may vary.",
    barLabel: "Confirm Price",
  },
  out_the_door_request: {
    mode: "out_the_door_request",
    headline: "Request Out-the-Door Details",
    sub: "Ask the dealership for taxes, fees, registration, and final purchase details.",
    cta: "Request Out-the-Door Details",
    reassurance: "No obligation. A dealership representative will follow up with the full purchase breakdown.",
    disclaimer: "Out-the-door estimates may vary based on taxes, registration, trade value, lender approval, and dealership confirmation.",
    barLabel: "OTD Details",
  },
  finance_precheck: {
    mode: "finance_precheck",
    headline: "Estimate Your Payment",
    sub: "Adjust down payment, term, and rate to explore your estimated monthly payment.",
    cta: "Request Finance Details",
    reassurance: "No obligation. A dealership finance specialist will follow up with available options.",
    disclaimer: "Estimate only, with approved credit. Final payment, rate, and terms are subject to lender approval.",
    barLabel: "Finance Details",
  },
};

// Wording that implies a hidden or negotiable price. Custom copy containing
// any of these falls back to the safe default unless the dealer explicitly
// allowed out-the-door wording.
const BANNED_WORDING = /out[\s-]?the[\s-]?door|best\s+price|lowest\s+price|hidden\s+price|unlock\s+(the\s+)?price|special\s+internet\s+price/i;

const safeCustom = (value: string, fallback: string, allow: boolean): string => {
  const v = (value || "").trim();
  if (!v) return fallback;
  if (!allow && BANNED_WORDING.test(v)) return fallback;
  return v;
};

export const resolveTodaysPrice = (raw?: { todays_price_mode?: unknown; todays_price_custom?: unknown } | null): TodaysPriceCopy => {
  const mode = (typeof raw?.todays_price_mode === "string" && raw.todays_price_mode in { ...MODE_COPY, custom: 1 }
    ? raw.todays_price_mode
    : "payment_estimate") as TodaysPriceMode;
  const custom = { ...DEFAULT_TODAYS_PRICE_CUSTOM, ...((raw?.todays_price_custom as Partial<TodaysPriceCustom>) || {}) };

  if (mode !== "custom") {
    return { ...MODE_COPY[mode], showCalculator: custom.show_calculator, showDown: custom.show_down, showTerm: custom.show_term, showApr: custom.show_apr };
  }
  const base = MODE_COPY.payment_estimate;
  const allow = custom.allow_otd_wording === true;
  return {
    mode: "custom",
    headline: safeCustom(custom.headline, base.headline, allow),
    sub: safeCustom(custom.sub, base.sub, allow),
    cta: safeCustom(custom.cta, base.cta, allow),
    reassurance: base.reassurance,
    disclaimer: safeCustom(custom.disclaimer, base.disclaimer, allow),
    barLabel: base.barLabel,
    showCalculator: custom.show_calculator,
    showDown: custom.show_down,
    showTerm: custom.show_term,
    showApr: custom.show_apr,
  };
};

export const TODAYS_PRICE_MODE_OPTIONS: { value: TodaysPriceMode; label: string; hint: string }[] = [
  { value: "payment_estimate", label: "Payment Estimate (default)", hint: "Today's Price — personalize your payment estimate. Safe for most dealers." },
  { value: "confirm_price_availability", label: "Confirm Availability + Price", hint: "Softer language — request confirmation of current availability and pricing." },
  { value: "out_the_door_request", label: "Out-the-Door Request", hint: "Explicit opt-in to OTD language — taxes, fees, registration, final details." },
  { value: "finance_precheck", label: "Finance Pre-Check", hint: "Payment-calculator-first — request finance details." },
  { value: "custom", label: "Custom copy", hint: "Write your own headline, subheadline, CTA, and disclaimer." },
];
