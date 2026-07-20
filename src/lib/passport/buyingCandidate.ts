// ── Governed buying recommendation ──────────────────────────────────────────
// The headline conclusion is conditioned on BOTH the price position and any
// pending MATERIAL verification. It can never read a bare "Strong Buying
// Candidate" while the price is above normalized market value or a material
// check (title / recall / odometer) is still pending — the specific reasons are
// always stated, and the primary CTA follows the conclusion.

import { fmt$ } from "@/lib/passportV2Data";

export interface BuyingCandidateInput {
  advertisedPrice: number | null;
  normalizedMarketValue: number | null;
  /** Labels of pending MATERIAL verification categories (from the verification summary). */
  pendingMaterialLabels: string[];
  /** Only flag "above market" past this dollar tolerance (avoids noise on rounding). */
  aboveMarketTolerance?: number;
}

export interface BuyingCandidateResult {
  headline: "Strong Buying Candidate" | "Candidate With Questions";
  hasQuestions: boolean;
  concerns: string[];
  aboveMarket: number | null;
  aboveMarketPct: number | null;
  subcopy: string;
  primaryCtaLabel: "Reserve This Vehicle" | "Ask Dealer About This Vehicle";
}

export function resolveBuyingCandidate(input: BuyingCandidateInput): BuyingCandidateResult {
  const tol = input.aboveMarketTolerance ?? 250;
  const { advertisedPrice: price, normalizedMarketValue: nmv } = input;
  const aboveMarket = price != null && nmv != null && price - nmv > tol ? price - nmv : null;
  const aboveMarketPct = aboveMarket != null && nmv ? Math.round((aboveMarket / nmv) * 1000) / 10 : null;

  const concerns: string[] = [];
  if (input.pendingMaterialLabels.length) {
    const names = input.pendingMaterialLabels.join(" and ");
    concerns.push(`${names} ${input.pendingMaterialLabels.length === 1 ? "check is" : "checks are"} still pending`);
  }
  if (aboveMarket != null) {
    concerns.push(`Price is ${fmt$(aboveMarket)} above normalized market value${aboveMarketPct != null ? ` (${aboveMarketPct}%)` : ""}`);
  }

  const hasQuestions = concerns.length > 0;
  return {
    headline: hasQuestions ? "Candidate With Questions" : "Strong Buying Candidate",
    hasQuestions,
    concerns,
    aboveMarket,
    aboveMarketPct,
    subcopy: hasQuestions
      ? `Dealer verification and vehicle history are favorable. ${concerns.join(". ")}.`
      : "Pricing, verification and market position compare favorably.",
    primaryCtaLabel: hasQuestions ? "Ask Dealer About This Vehicle" : "Reserve This Vehicle",
  };
}
