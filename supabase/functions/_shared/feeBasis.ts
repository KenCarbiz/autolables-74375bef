// The fee basis of one website price observation, kept in four separate parts:
//
//   observed   the figure and the label the page printed, as read;
//   dealer     the dealership's configured interpretation (its settings), read
//              exactly as the doc-fee basis policy reads it;
//   page       what the page itself shows about the fee: an itemised stack, a
//              fee line with a labelled total, or wording beside the price;
//   derived    before-fee price, fee and sale price computed from one of them,
//              with the basis that was used named.
//
// A dealer setting is an interpretation, never page evidence. Derived values
// may replace the listing's pricing fields only when the page itself verifies
// the basis and agrees with the dealer's configuration (or no fee applies).
// Everything else is recorded and held: the observation is kept, the listing
// is not touched, and the tenant's fee settings are never changed here.

import {
  disclosureEvidence, labelEvidence, priceStackEvidence, resolveCondition, sourceBasisEvidence,
  type FeeEvidence, type PageCondition,
} from "./feeTreatment.ts";
import { publicPriceDecision, type PriceStackResult } from "./priceStack.ts";

export type DealerBasis = "includes_fee" | "before_fee" | "unconfigured" | "conflict";

export interface DealerInterpretation {
  basis: DealerBasis;
  source: string;
  condition: PageCondition | null;
  feeAmount: number;
}

export type FeeBasisStatus =
  | "page_verified"
  | "not_applicable"
  | "dealer_configured_unverified"
  | "conflict"
  | "held_for_review"
  | "unresolved";

export interface DerivedPricing {
  advertised_price_before_doc: number;
  doc_fee: number;
  website_sale_price: number;
  retail_cash?: number | null;
  dealer_discount?: number | null;
}

export interface FeeBasisRecord {
  version: string;
  observed: { amount: number; label: string | null; source: string; section: string | null };
  dealer: DealerInterpretation;
  page: {
    says: "includes_fee" | "excludes_fee" | "contradictory" | null;
    decisive: FeeEvidence[];
    corroborating: FeeEvidence[];
    /** Page-wide wording away from the price: recorded, never decisive. */
    context: FeeEvidence[];
    stack: { status: string; flags: string[]; proof: string[]; reason: string | null } | null;
  };
  otherSources: FeeEvidence[];
  status: FeeBasisStatus;
  reasons: string[];
  derived: DerivedPricing | null;
  derivedFrom: "page" | "stack" | "dealer_setting" | "no_fee" | null;
  promote: boolean;
}

export const FEE_BASIS_VERSION = "fee-basis/2026-10-30";

const near = (a: number, b: number) => Math.abs(a - b) <= 1;

const settingBool = (v: unknown): boolean | null | "unreadable" => {
  if (v === undefined || v === null) return null;
  if (v === true || v === false) return v;
  const s = String(v).trim().toLowerCase();
  if (s === "true") return true;
  if (s === "false") return false;
  return "unreadable";
};

// Mirrors public.doc_fee_basis (the doc-fee basis policy): only an explicit,
// readable setting decides; missing, unreadable or contradictory settings
// leave the basis unconfigured or in conflict. A condition-specific setting,
// when the dealership has one for this page's condition, is the more specific
// statement of the same interpretation.
export function dealerInterpretation(settings: Record<string, unknown>, condition: PageCondition | null): DealerInterpretation {
  const feeOn = settingBool(settings.doc_fee_enabled) === true;
  const amount = Number(settings.doc_fee_amount);
  const feeAmount = feeOn && Number.isFinite(amount) && amount > 0 ? amount : 0;
  const byCond = settings.advertised_includes_doc_fee_by_condition;
  if (condition && byCond && typeof byCond === "object" && !Array.isArray(byCond)) {
    const v = settingBool((byCond as Record<string, unknown>)[condition]);
    if (v === "unreadable") return { basis: "unconfigured", source: "unreadable_condition_setting", condition, feeAmount };
    if (v != null) return { basis: v ? "includes_fee" : "before_fee", source: `advertised_includes_doc_fee_by_condition.${condition}`, condition, feeAmount };
  }
  const inc = settingBool(settings.advertised_includes_doc_fee);
  const exc = settingBool(settings.advertised_excludes_doc_fee);
  if (inc === "unreadable" || exc === "unreadable") return { basis: "unconfigured", source: "unreadable_setting", condition, feeAmount };
  if (inc != null && exc != null && inc === exc) return { basis: "conflict", source: "settings_conflict", condition, feeAmount };
  if (inc != null) return { basis: inc ? "includes_fee" : "before_fee", source: "advertised_includes_doc_fee", condition, feeAmount };
  if (exc != null) return { basis: exc ? "before_fee" : "includes_fee", source: "advertised_excludes_doc_fee", condition, feeAmount };
  return { basis: "unconfigured", source: "not_set", condition, feeAmount };
}

const splitFor = (observed: number, fee: number, includes: boolean): DerivedPricing => includes
  ? { advertised_price_before_doc: observed - fee, doc_fee: fee, website_sale_price: observed }
  : { advertised_price_before_doc: observed, doc_fee: fee, website_sale_price: observed + fee };

export interface FeeBasisInput {
  observed: { amount: number; label: string | null; source: string; section: string | null };
  settings: Record<string, unknown>;
  pageUrl: string;
  listingCondition?: string | null;
  /** Visible text of the vehicle's pricing section: its widget, or the text around the figure. */
  sectionText: string;
  /** Visible text of the rest of the vehicle's page. */
  pageText: string;
  stack?: PriceStackResult | null;
  feed?: { price: number | null; includesFees: boolean | null } | null;
}

export function decideFeeBasis(i: FeeBasisInput): FeeBasisRecord {
  const { condition, conflict: conditionConflict } = resolveCondition(i.pageUrl, i.listingCondition);
  const dealer = dealerInterpretation(i.settings, condition);
  const fee = dealer.feeAmount;
  const observed = i.observed.amount;
  const decisive: FeeEvidence[] = [];
  const corroborating: FeeEvidence[] = [...labelEvidence(i.observed.label)];
  const context: FeeEvidence[] = disclosureEvidence(i.pageText).map((e) => ({ ...e, strength: "context" as const }));
  const otherSources = sourceBasisEvidence(observed, i.feed ?? null);
  const stack = i.stack ?? null;
  const reasons: string[] = [];
  if (conditionConflict) reasons.push("the page address and the listing disagree on the vehicle's condition");

  if (fee > 0) {
    if (stack?.status === "reconciled" && stack.fee) {
      if (stack.advertisedTotal && near(observed, stack.advertisedTotal.amount)) {
        decisive.push({ kind: "price_stack", says: "includes_fee", strength: "decisive", detail: `itemised: ${stack.fee.label} ${stack.fee.amount} sits inside ${stack.advertisedTotal.label} ${stack.advertisedTotal.amount}` });
      } else if (stack.dealerPrice && near(observed, stack.dealerPrice.amount)) {
        decisive.push({ kind: "price_stack", says: "excludes_fee", strength: "decisive", detail: `itemised: ${stack.dealerPrice.label} ${stack.dealerPrice.amount} is before ${stack.fee.label} ${stack.fee.amount}` });
      }
    }
    decisive.push(...priceStackEvidence(i.sectionText, observed, fee, i.observed.label));
    decisive.push(...disclosureEvidence(i.sectionText));
  }
  const saysSet = new Set(decisive.map((e) => e.says));
  const says = saysSet.size > 1 ? "contradictory" : saysSet.size === 1 ? [...saysSet][0] : null;
  const stackInfo = stack && stack.status !== "no_stack"
    ? { status: stack.status, flags: [...stack.flags], proof: [...stack.proof], reason: stack.reason }
    : null;

  const record = (status: FeeBasisStatus, derived: DerivedPricing | null, derivedFrom: FeeBasisRecord["derivedFrom"], more: string[] = []): FeeBasisRecord => ({
    version: FEE_BASIS_VERSION,
    observed: i.observed,
    dealer,
    page: { says, decisive, corroborating, context, stack: stackInfo },
    otherSources,
    status,
    reasons: [...reasons, ...more],
    derived,
    derivedFrom,
    promote: (status === "page_verified" || status === "not_applicable") && !conditionConflict,
  });

  // An itemised widget that belongs to this vehicle decides on its own
  // arithmetic, or holds the vehicle when it cannot.
  if (stack && stack.status !== "no_stack" && stack.status !== "missing_final_price" && stack.status !== "vin_not_found") {
    if (stack.status !== "reconciled") return record("unresolved", null, null, [`the vehicle's price widget is ${stack.status}${stack.reason ? `: ${stack.reason}` : ""}`]);
    const decision = publicPriceDecision(stack);
    if (!decision.publishable || !decision.primary) {
      return record("held_for_review", null, null, decision.reasons.length ? decision.reasons : ["the price widget is held for review"]);
    }
    const total = decision.primary.amount;
    const stackFee = stack.fee?.amount ?? 0;
    return record("page_verified", {
      advertised_price_before_doc: total - stackFee, doc_fee: stackFee, website_sale_price: total,
      retail_cash: stack.incentives.filter((x) => x.eligibility === "verified_general" && x.expired !== true).reduce((a, x) => a + x.amount, 0) || null,
      dealer_discount: stack.discounts.reduce((a, x) => a + x.amount, 0) || null,
    }, "stack", stack.proof);
  }

  if (fee <= 0) return record("not_applicable", { advertised_price_before_doc: observed, doc_fee: 0, website_sale_price: observed }, "no_fee", ["no document fee is configured"]);
  if (says === "contradictory") return record("unresolved", null, null, ["the page's own fee statements contradict each other"]);

  const dealerSays = dealer.basis === "includes_fee" ? "includes_fee" : dealer.basis === "before_fee" ? "excludes_fee" : null;
  if (says) {
    const byPage = splitFor(observed, fee, says === "includes_fee");
    if (dealer.basis === "unconfigured") return record("unresolved", byPage, "page", [`the page shows the price ${says === "includes_fee" ? "includes" : "excludes"} the fee; the dealership has not configured its fee basis`]);
    if (dealer.basis === "conflict" || dealerSays !== says) {
      return record("conflict", byPage, "page", [`the page shows the price ${says === "includes_fee" ? "includes" : "excludes"} the fee; the dealership's setting (${dealer.source}) says ${dealer.basis}`]);
    }
    return record("page_verified", byPage, "page", ["the page's own fee evidence agrees with the dealership's setting"]);
  }
  if (dealerSays) {
    return record("dealer_configured_unverified", splitFor(observed, fee, dealerSays === "includes_fee"), "dealer_setting",
      [`no fee evidence on the page; derived from the dealership's setting (${dealer.source}), not verified by the page`]);
  }
  return record("unresolved", null, null, ["no fee evidence on the page and no configured fee basis"]);
}

// The text a fee statement must sit in to count as evidence for this figure:
// the vehicle's widget, or a window around the figure on the scoped page.
export function sectionAround(text: string, amount: number, radius = 400): { section: string; rest: string } {
  const printed = amount.toLocaleString("en-US");
  const at = text.search(new RegExp(`\\$\\s?${printed.replace(/,/g, ",?")}(?![\\d])`));
  if (at < 0) return { section: "", rest: text };
  const from = Math.max(0, at - radius);
  const to = Math.min(text.length, at + radius);
  return { section: text.slice(from, to), rest: text.slice(0, from) + " " + text.slice(to) };
}
