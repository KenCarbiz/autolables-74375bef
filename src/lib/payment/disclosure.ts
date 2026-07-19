export type CreditTier = "excellent" | "good" | "fair" | "rebuilding";
export const EXCLUDED_CHARGES: readonly string[] = ["Sales tax","Title & registration","Dealer documentation / conveyance fee","Optional add-ons & protection products","Trade-in equity or payoff"];
export const EXCLUDED_CHARGES_SUMMARY = "This estimate excludes sales tax, title, registration, dealer fees, optional add-ons, and any trade equity — each can materially change your monthly payment.";
export interface AprPresentation { label: "Example APR" | "Estimated APR" | "Dealer-offered APR"; value: string; disclosure: string; source: string; asOf: string | null; }
export function presentApr(aprPercent: number, opts?: { verifiedDealerOffer?: boolean; source?: string; asOf?: string | null }): AprPresentation {
  const verified = !!opts?.verifiedDealerOffer;
  return { label: verified ? "Dealer-offered APR" : "Example APR", value: `${aprPercent.toFixed(2).replace(/\.00$/, "")}%`, disclosure: verified ? "Rate confirmed by the dealership for this request." : "Example rate for illustration only — not a personalized offer. Your actual APR depends on lender approval and credit.", source: opts?.source ?? (verified ? "Dealer offer" : "AutoLabels example rate"), asOf: opts?.asOf ?? null };
}
export const CREDIT_TIER_DISCLOSURE = "Choosing a credit range adjusts this example only. It is not a credit application or decision, and no credit check is performed.";
export function creditImpactCopy(performsCreditInquiry: boolean): string { return performsCreditInquiry ? "A soft credit inquiry may be used to tailor available options." : "This does not affect your credit score."; }
export interface DueAtSigning { known: number; components: { label: string; amount: number }[]; excludes: string[]; note: string; }
export function estimateDueAtSigning(input: { downPayment: number; firstMonthPayment?: number | null; dealerDocFee?: number | null }): DueAtSigning {
  const components: { label: string; amount: number }[] = [{ label: "Down payment", amount: Math.max(0, input.downPayment || 0) }];
  if (input.firstMonthPayment && input.firstMonthPayment > 0) components.push({ label: "First month (est.)", amount: input.firstMonthPayment });
  if (input.dealerDocFee && input.dealerDocFee > 0) components.push({ label: "Dealer doc fee", amount: input.dealerDocFee });
  const known = components.reduce((s, c) => s + c.amount, 0);
  return { known, components, excludes: ["Sales tax", "Title & registration"], note: "Estimated cash due at signing. Taxes and registration are additional and confirmed by the dealer." };
}
export function smsConsentCopy(dealerName: string): string { const name = (dealerName || "the dealership").trim(); return `By selecting Text and submitting, you agree to receive text messages from ${name} about this vehicle at the number provided. Message frequency varies. Message and data rates may apply. Reply STOP to opt out, HELP for help. Consent is not a condition of purchase.`; }
export function contactConsentCopy(dealerName: string, method: "call" | "text" | "email"): string { const name = (dealerName || "the dealership").trim(); if (method === "text") return smsConsentCopy(name); if (method === "call") return `By submitting, you agree that ${name} may call you about this vehicle at the number provided.`; return `By submitting, you agree that ${name} may email you about this vehicle at the address provided.`; }
export interface PaymentCalculationSnapshot { vin: string; vehiclePrice: number; downPayment: number; termMonths: number; exampleAprPercent: number; aprIsVerifiedOffer: boolean; estMonthlyPayment: number; amountFinanced: number; creditTier: CreditTier | null; dueAtSigningKnown: number; excludedCharges: string[]; preferredContact: "call" | "text" | "email"; calcVersion: string; calculatedAt: string; }
export const PAYMENT_CALC_VERSION = "v1";
export interface PaymentCalcChange { field: "down_payment" | "term" | "example_apr" | "credit_profile"; from: string | number | null; to: string | number | null; est_payment_from: number | null; est_payment_to: number | null; calc_version: string; }
