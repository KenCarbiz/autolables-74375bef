// The vAuto export gate, shared by the admin page and the server export path
// (description-export) so both apply the same rules. Pure: no network, no
// database. The server is authoritative; the page only previews.
//
// The description writer never sees a price, so the only price statement in a
// vAuto export is the store disclosure. It has to agree with how the stored
// price is actually built: the dealership's explicit fee-basis setting and the
// vehicle's stored selling price, documentation fee and advertised total. A
// price label alone never decides it. Anything ambiguous blocks the export.

import { countText, fitNarrativeExact, type ApprovedDisclosure, type WireProfile } from "./description-exact-fit.ts";
import { checkChannelPolicy, provenanceFor, resolveChannelPolicy, type ChannelPolicy, type PolicyFinding } from "./description-channel-policy.ts";

export const VAUTO_CHANNEL = "vauto";
export const VAUTO_TARGET = 3921;
export const VAUTO_GATE_VERSION = "vauto_gate_2";

/**
 * The owner's first proposal (2026-11-01). A candidate only: it is not legally
 * approved and is never treated as an approved disclosure by the gate.
 */
export const PROPOSED_FEE_INCLUSIVE_DISCLOSURE =
  "Advertised price includes the dealer documentation fee. Sales tax, title and registration are additional.";

/**
 * The wording proposed for counsel's review for Connecticut stores with a
 * fee-inclusive advertised price. Not approved; {conveyance_fee} is filled
 * from the vehicle's stored fee.
 */
export const PROPOSED_CT_DISCLOSURE_TEMPLATE =
  "The advertised price includes the Dealer Conveyance Fee. Dealer Conveyance Fee: {conveyance_fee}. This fee is negotiable and is not payable to the State of Connecticut. State and local taxes and registration fees are excluded from the advertised price.";

export interface BlockReason { code: string; message: string }

// ---------------------------------------------------------------------------
// Fee basis. Mirrors src/lib/admin/pricing/feeBasis.ts rule for rule; the
// parity test in src/lib/description/vautoGateParity.test.ts keeps them equal.

export type FeeBasis = "includes_fee" | "before_fee" | "unconfigured" | "conflict";
export type FeeBasisSource = "advertised_includes_doc_fee" | "advertised_excludes_doc_fee" | "not_set" | "unreadable_setting" | "settings_conflict";

export interface StoredPriceRow {
  price: number | null;
  advertisedBeforeDoc: number | null;
  websiteSalePrice: number | null;
  docFee: number | null;
}

export function configuredBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const s = value.trim().toLowerCase();
    if (s === "true") return true;
    if (s === "false") return false;
  }
  return null;
}

const present = (bag: Record<string, unknown>, key: string): boolean => Object.prototype.hasOwnProperty.call(bag, key) && bag[key] != null;

export function resolveFeeBasis(settings: unknown): { basis: FeeBasis; source: FeeBasisSource } {
  const bag = settings != null && typeof settings === "object" && !Array.isArray(settings) ? (settings as Record<string, unknown>) : {};
  const hasInc = present(bag, "advertised_includes_doc_fee");
  const hasExc = present(bag, "advertised_excludes_doc_fee");
  const inc = hasInc ? configuredBoolean(bag.advertised_includes_doc_fee) : null;
  const exc = hasExc ? configuredBoolean(bag.advertised_excludes_doc_fee) : null;
  if ((hasInc && inc == null) || (hasExc && exc == null)) return { basis: "unconfigured", source: "unreadable_setting" };
  if (inc != null && exc != null && inc === exc) return { basis: "conflict", source: "settings_conflict" };
  if (inc != null) return { basis: inc ? "includes_fee" : "before_fee", source: "advertised_includes_doc_fee" };
  if (exc != null) return { basis: exc ? "before_fee" : "includes_fee", source: "advertised_excludes_doc_fee" };
  return { basis: "unconfigured", source: "not_set" };
}

const cents = (n: number): number => Math.round(n * 100);
export const roundFee = (n: number | null | undefined): number => (n == null || !Number.isFinite(n) ? 0 : cents(n) / 100);
const sub = (a: number, b: number): number => (cents(a) - cents(b)) / 100;
const add = (a: number, b: number): number => (cents(a) + cents(b)) / 100;
const differs = (a: number | null, b: number | null): boolean => (a == null || b == null ? a !== b : cents(a) !== cents(b));

export type SplitStatus = "consistent" | "incomplete" | "no_price" | "split_mismatch" | "invalid" | "blocked_basis";

/** Does the stored row reconcile under the basis with its own stored fee? */
export function reconcileRow(basis: FeeBasis, row: StoredPriceRow): { status: SplitStatus; selling: number | null; total: number | null; salePriceDiffers: boolean } {
  const fee = roundFee(row.docFee);
  if (basis !== "includes_fee" && basis !== "before_fee") return { status: "blocked_basis", selling: null, total: null, salePriceDiffers: false };
  if (basis === "includes_fee") {
    if (row.price == null || !Number.isFinite(row.price) || row.price <= 0) return { status: "no_price", selling: null, total: null, salePriceDiffers: false };
    const salePriceDiffers = row.websiteSalePrice != null && differs(row.websiteSalePrice, row.price);
    if (row.advertisedBeforeDoc != null && differs(add(row.advertisedBeforeDoc, row.docFee ?? 0), row.price)) {
      return { status: "split_mismatch", selling: row.advertisedBeforeDoc, total: row.price, salePriceDiffers };
    }
    const selling = sub(row.price, fee);
    if (selling <= 0) return { status: "invalid", selling, total: row.price, salePriceDiffers };
    const complete = !differs(row.docFee, fee) && !differs(row.advertisedBeforeDoc, selling);
    return { status: complete ? "consistent" : "incomplete", selling, total: row.price, salePriceDiffers };
  }
  if (row.advertisedBeforeDoc == null || !Number.isFinite(row.advertisedBeforeDoc)) return { status: "no_price", selling: null, total: null, salePriceDiffers: false };
  if (row.price != null && differs(row.price, row.advertisedBeforeDoc)) return { status: "split_mismatch", selling: row.advertisedBeforeDoc, total: row.websiteSalePrice, salePriceDiffers: false };
  const total = add(row.advertisedBeforeDoc, fee);
  if (row.advertisedBeforeDoc <= 0) return { status: "invalid", selling: row.advertisedBeforeDoc, total, salePriceDiffers: false };
  const complete = !differs(row.docFee, fee) && !differs(row.websiteSalePrice, total);
  return { status: complete ? "consistent" : "incomplete", selling: row.advertisedBeforeDoc, total, salePriceDiffers: false };
}

/** Same rule as evidenceContradicts in feeBasis.ts and doc_fee_evidence_contradicts. */
export function evidenceContradicts(basis: FeeBasis, price: number | null, docFee: number | null, observed: number | null | undefined): boolean {
  if (observed == null || price == null || docFee == null || docFee <= 0) return false;
  const near = (a: number, b: number) => Math.abs(a - b) < 1;
  if (basis === "includes_fee") return !near(observed, price) && (near(observed, price + docFee) || near(observed, price - docFee));
  if (basis === "before_fee") return near(observed, price - docFee);
  return false;
}

// ---------------------------------------------------------------------------
// Disclosure classifier. Works clause by clause: a semicolon, a full stop or
// a contrastive "but/while/however/whereas" ends a clause, so "the price
// includes the documentation fee; taxes are additional" reads the fee as
// included. Inside a clause, the nearest inclusion or exclusion marker before
// the fee decides; with none, a predicate after it ("the fee is additional",
// "is included") decides. Silence is never read as inclusion.

export type DisclosureFeeStatement = "includes_fee" | "excludes_fee" | "silent" | "mixed";

const FEE_WORD = "(?:doc(?:ument(?:ation)?)?|conveyance|processing|administrative|admin|dealer\\s+service)";
const FEE_NOUN_SRC = `\\b(?:dealer\\s+)?${FEE_WORD}(?:\\s*(?:\\/|and|or|&)\\s*${FEE_WORD})?\\s+(?:fee|fees|charge|charges)\\b|\\bdealer\\s+fees?\\b`;
const FEE_NOUN = new RegExp(FEE_NOUN_SRC, "i");
const FEE_NOUN_G = () => new RegExp(FEE_NOUN_SRC, "gi");

const EXCLUDE_MARKERS = [
  "does not include", "do not include", "doesn't include", "don't include", "did not include", "not including", "not inclusive of",
  "excludes", "exclude", "excluding", "excluded from", "exclusive of", "except", "plus", "in addition to", "on top of", "before",
  "does not reflect", "do not reflect", "net of",
];
const INCLUDE_MARKERS = ["includes", "include", "including", "included in", "inclusive of", "reflects", "reflect", "contains", "covers"];
const AFTER_EXCLUDED = /^[^.;]*?\b(?:is|are|will be|shall be)\s+(?:not\s+included|excluded|additional|extra|separate|charged\s+separately|added|not\s+part\s+of)\b|^[^.;]*?\bnot\s+included\b/;
const AFTER_INCLUDED = /^[^.;]*?\b(?:is|are)\s+(?:already\s+)?included\b|^[^.;]*?\bincluded\s+in\s+the\b/;

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+").replace(/'/g, "['\u2019]");
const markerRe = (words: string[]) => new RegExp(`\\b(?:${words.map(esc).join("|")})\\b`, "gi");

export function clausesOf(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+|;\s*|\s*[,:]?\s+(?=(?:but|while|however|whereas|although)\b)|\s+-{1,2}\s+|\s+\u2014\s+/i)
    .map((c) => c.trim())
    .filter(Boolean);
}

function clausePolarity(clause: string): "includes_fee" | "excludes_fee" | null {
  const lc = clause.toLowerCase();
  let result: "includes_fee" | "excludes_fee" | null = null;
  for (const m of lc.matchAll(FEE_NOUN_G())) {
    const at = m.index ?? 0;
    const left = lc.slice(0, at);
    let best = -1;
    let pol: "includes_fee" | "excludes_fee" | null = null;
    // Exclusion phrases are matched first and win a tie, so "does not include" is never read as "include".
    for (const x of left.matchAll(markerRe(EXCLUDE_MARKERS))) { const p = (x.index ?? 0) + x[0].length; if (p > best) { best = p; pol = "excludes_fee"; } }
    for (const x of left.matchAll(markerRe(INCLUDE_MARKERS))) {
      const start = x.index ?? 0;
      const p = start + x[0].length;
      const negated = /\b(?:not|n't|never)\s*$/.test(left.slice(0, start));
      if (p > best) { best = p; pol = negated ? "excludes_fee" : "includes_fee"; }
    }
    if (!pol) {
      const right = lc.slice(at + m[0].length);
      if (AFTER_EXCLUDED.test(right)) pol = "excludes_fee";
      else if (AFTER_INCLUDED.test(right)) pol = "includes_fee";
    }
    if (pol && result && pol !== result) return null;
    if (pol) result = pol;
  }
  return result;
}

/** What the disclosure says about the documentation or conveyance fee. */
export function classifyDisclosure(text: string): DisclosureFeeStatement {
  let inc = false;
  let exc = false;
  let mixedClause = false;
  for (const c of clausesOf(text)) {
    if (!FEE_NOUN.test(c)) continue;
    const p = clausePolarity(c);
    if (p === "includes_fee") inc = true;
    else if (p === "excludes_fee") exc = true;
    else if (p === null && FEE_NOUN.test(c) && (markerRe(EXCLUDE_MARKERS).test(c.toLowerCase()) && markerRe(INCLUDE_MARKERS).test(c.toLowerCase()))) mixedClause = true;
  }
  if ((inc && exc) || mixedClause) return "mixed";
  if (inc) return "includes_fee";
  if (exc) return "excludes_fee";
  return "silent";
}

export const mentionsFee = (text: string): boolean => FEE_NOUN.test(text);

const money = (n: number): string => `$${n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
export const formatMoney = money;
export const amountsIn = (text: string): number[] =>
  [...text.matchAll(/\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/g)].map((m) => Number(`${m[1].replace(/,/g, "")}.${m[2] ?? "0"}`));
const centsEq = (a: number, b: number) => Math.round(a * 100) === Math.round(b * 100);

// ---------------------------------------------------------------------------
// Store disclosures: legal-reviewed, versioned, per store. A template may carry
// {conveyance_fee}, rendered with the vehicle's stored fee, so the exported
// sentence always states the fee actually charged.

export type DisclosureStatus = "draft" | "pending_legal_review" | "approved" | "retired";

export interface StoreDisclosure {
  /** dealer_stores.id, or null for the dealership-wide default. */
  storeId: string | null;
  basis: "includes_fee" | "before_fee";
  template: string;
  /** Content hash of the template; any edit is a new version. */
  version: string;
  status: DisclosureStatus;
  legalReviewedBy: string | null;
  legalReviewedAt: string | null;
  legalReference: string | null;
  /** Counsel accepted this wording in a plain-text, single-line export (no bold type). */
  plainTextFormatAccepted: boolean;
  approvedBy: string | null;
  approvedAt: string | null;
}

export const DISCLOSURE_PLACEHOLDERS = ["{conveyance_fee}"] as const;

export function renderDisclosure(template: string, fee: number | null): { text: string; missing: string[] } {
  const missing: string[] = [];
  const text = template.replace(/\{([a-z_]+)\}/g, (all, key: string) => {
    if (key === "conveyance_fee" && fee != null && Number.isFinite(fee)) return money(roundFee(fee));
    missing.push(all);
    return all;
  });
  return { text: text.trim(), missing };
}

/**
 * State rules the rendered disclosure must satisfy. The Connecticut entry
 * follows research on Conn. Gen. Stat. 14-62 and 14-62a as amended by Public
 * Act 26-24 (effective 2026-10-01); it is not legal advice and stays pending
 * until dealership counsel approves it.
 */
export interface JurisdictionRules {
  state: string;
  /** The advertised price must include the fee; a fee-additional price is blocked. */
  feeMustBeIncluded: boolean;
  /** The rendered disclosure must state the stored fee amount. */
  requireFeeAmount: boolean;
  /** When set, the amount must sit immediately after this exact label. */
  requiredLabel: string | null;
  /** The fee must be named with one of these terms. */
  feeTerms: string[];
  /** A statement that these items are excluded from the advertised price. */
  exclusionStatement: { pattern: RegExp; describe: string } | null;
  /** The statute specifies bold type the plain-text export cannot carry; counsel must accept the format. */
  typographyRequirement: string | null;
  source: string;
}

export const JURISDICTION_RULES: Record<string, JurisdictionRules> = {
  CT: {
    state: "CT",
    feeMustBeIncluded: true,
    requireFeeAmount: true,
    requiredLabel: "Dealer Conveyance Fee",
    feeTerms: ["dealer conveyance fee", "conveyance fee", "processing fee"],
    exclusionStatement: {
      pattern: /\b(?:state|local)\b[^.;]*\btax(?:es)?\b[^.;]*\bregistration\s+fees?\b[^.;]*\b(?:excluded|not\s+included|additional)\b/i,
      describe: "that state or local taxes and registration fees are excluded from the advertised price",
    },
    typographyRequirement: "Conn. Gen. Stat. 14-62a calls for the fee amount and the exclusion statement in at least eight-point bold type.",
    source: "Conn. Gen. Stat. 14-62(b) and 14-62a as amended by P.A. 26-24 (eff. 2026-10-01). Research: /mnt/project-files/drivesignal/ct-disclosure-research.md. Pending counsel.",
  },
};

export const DEFAULT_RULES: JurisdictionRules = {
  state: "*", feeMustBeIncluded: false, requireFeeAmount: true, requiredLabel: null, feeTerms: ["fee"], exclusionStatement: null, typographyRequirement: null,
  source: "Conservative default until the store's state rules are configured.",
};

export const rulesFor = (state: string | null | undefined): JurisdictionRules => JURISDICTION_RULES[String(state ?? "").toUpperCase()] ?? DEFAULT_RULES;

// ---------------------------------------------------------------------------
// The price and disclosure check.

export interface PriceBreakdown {
  basis: "includes_fee" | "before_fee";
  sellingPrice: number;
  docFee: number;
  advertisedTotal: number;
  sources: { sellingPrice: string; docFee: string; advertisedTotal: string };
}

export interface PriceDisclosureCheck {
  verified: boolean;
  basis: FeeBasis;
  basisSource: FeeBasisSource;
  breakdown: PriceBreakdown | null;
  statement: DisclosureFeeStatement;
  /** The disclosure as rendered for this vehicle. */
  renderedDisclosure: string;
  reasons: BlockReason[];
}

export interface PriceDisclosureInput {
  /** The effective settings for the vehicle's store (store override over dealership). */
  settings: unknown;
  row: StoredPriceRow | null;
  observed?: number | null;
  /** The disclosure template, or plain text, under review. */
  disclosureText: string;
  rules?: JurisdictionRules;
}

export function checkPriceDisclosure(i: PriceDisclosureInput): PriceDisclosureCheck {
  const { basis, source } = resolveFeeBasis(i.settings);
  const rules = i.rules ?? DEFAULT_RULES;
  const rendered = renderDisclosure(i.disclosureText, i.row?.docFee ?? null);
  const statement = classifyDisclosure(rendered.text);
  const reasons: BlockReason[] = [];
  const out = (breakdown: PriceBreakdown | null): PriceDisclosureCheck =>
    ({ verified: reasons.length === 0, basis, basisSource: source, breakdown, statement, renderedDisclosure: rendered.text, reasons });

  if (basis === "unconfigured") reasons.push({ code: "FEE_BASIS_UNCONFIGURED",
    message: source === "unreadable_setting"
      ? "The store's fee basis setting cannot be read, so it is unknown whether the advertised price includes the fee."
      : "The store has not set whether its advertised price includes the fee." });
  if (basis === "conflict") reasons.push({ code: "FEE_BASIS_CONFLICT", message: "The store's two fee basis settings contradict each other." });
  if (basis !== "includes_fee" && basis !== "before_fee") return out(null);

  const row = i.row;
  if (!row) { reasons.push({ code: "NO_PRICE_ROW", message: "No stored price was found for this vehicle." }); return out(null); }

  const bag = (i.settings && typeof i.settings === "object" ? i.settings : {}) as Record<string, unknown>;
  const feeEnabled = configuredBoolean(bag.doc_fee_enabled);
  const configuredFee = Number(bag.doc_fee_amount);
  if (row.docFee == null || !Number.isFinite(row.docFee)) {
    reasons.push({ code: "DOC_FEE_MISSING", message: "The vehicle has no stored fee, so the advertised total cannot be checked." });
  } else if (feeEnabled === false && row.docFee > 0) {
    reasons.push({ code: "DOC_FEE_DISABLED_BUT_STORED", message: `The fee is turned off for the store, but this vehicle stores a ${money(row.docFee)} fee.` });
  } else if (feeEnabled === true && Number.isFinite(configuredFee) && !centsEq(roundFee(configuredFee), roundFee(row.docFee))) {
    reasons.push({ code: "DOC_FEE_MISMATCH", message: `The store's fee is ${money(configuredFee)}, but this vehicle stores ${money(row.docFee)}.` });
  }

  const r = reconcileRow(basis, row);
  if (r.status === "no_price" || r.status === "invalid") {
    reasons.push({ code: "NO_PRICE", message: basis === "includes_fee"
      ? "The vehicle has no usable stored advertised total (price)."
      : "The vehicle has no usable stored price before the fee (advertised_price_before_doc)." });
  }
  if (r.status === "split_mismatch") {
    reasons.push({ code: "PRICE_SPLIT_MISMATCH", message: basis === "includes_fee"
      ? `The stored selling price ${money(row.advertisedBeforeDoc ?? 0)} plus the ${money(row.docFee ?? 0)} fee does not equal the stored advertised total ${money(row.price ?? 0)}.`
      : `The stored price ${money(row.price ?? 0)} differs from the stored price before the fee ${money(row.advertisedBeforeDoc ?? 0)}.` });
  }
  if (r.status === "incomplete") {
    reasons.push({ code: "PRICE_SPLIT_INCOMPLETE", message: basis === "includes_fee"
      ? "The stored selling price is missing or does not reconcile with the advertised total minus the fee."
      : "The stored advertised total (website_sale_price) is missing or is not the price before the fee plus the fee." });
  }
  if (basis === "includes_fee" && r.salePriceDiffers) {
    reasons.push({ code: "SALE_PRICE_DIFFERS", message: `The stored website sale price ${money(row.websiteSalePrice ?? 0)} differs from the advertised total ${money(row.price ?? 0)}.` });
  }
  if (evidenceContradicts(basis, row.price, row.docFee, i.observed)) {
    reasons.push({ code: "EVIDENCE_CONTRADICTS", message: `The latest website observation (${money(i.observed ?? 0)}) contradicts the configured fee basis.` });
  }

  const breakdown: PriceBreakdown | null = r.status === "consistent" && r.selling != null && r.total != null
    ? { basis, sellingPrice: r.selling, docFee: roundFee(row.docFee), advertisedTotal: r.total,
        sources: { sellingPrice: "advertised_price_before_doc", docFee: "doc_fee", advertisedTotal: basis === "includes_fee" ? "price" : "website_sale_price" } }
    : null;

  if (rendered.missing.length) {
    reasons.push({ code: "DISCLOSURE_PLACEHOLDER_UNFILLED", message: `The disclosure template uses ${rendered.missing.join(", ")}, which has no stored value for this vehicle.` });
  }
  const says = basis === "includes_fee" ? "includes" : "excludes";
  if (statement === "mixed") {
    reasons.push({ code: "DISCLOSURE_MIXED", message: "The disclosure both includes and excludes the fee." });
  } else if ((basis === "includes_fee" && statement === "excludes_fee") || (basis === "before_fee" && statement === "includes_fee")) {
    reasons.push({ code: "DISCLOSURE_CONTRADICTS_PRICE",
      message: `The disclosure says the price ${statement === "includes_fee" ? "includes" : "excludes"} the fee, but the stored price ${says} it.` });
  } else if (statement === "silent") {
    reasons.push({ code: "DISCLOSURE_SILENT_ON_FEE", message: basis === "includes_fee"
      ? "The disclosure does not say the advertised price includes the fee."
      : "The disclosure does not say the fee is added to the advertised price." });
  }
  const who = rules.state === "*" ? "The default rules" : `${rules.state} rules`;
  if (rules.feeMustBeIncluded && basis === "before_fee" && (row.docFee ?? 0) > 0) {
    reasons.push({ code: "STATE_REQUIRES_FEE_INCLUDED", message: `${who} require the advertised price to include the fee, but this store adds it on top.` });
  }
  const amounts = amountsIn(rendered.text);
  const feeAmountStated = row.docFee != null && amounts.some((a) => centsEq(a, row.docFee ?? 0));
  if (row.docFee != null && amounts.length && mentionsFee(rendered.text) && !feeAmountStated) {
    reasons.push({ code: "DISCLOSURE_FEE_AMOUNT_MISMATCH", message: `The disclosure states a fee amount that is not the stored ${money(row.docFee)} fee.` });
  } else if (rules.requireFeeAmount && (row.docFee ?? 0) > 0 && !feeAmountStated) {
    reasons.push({ code: "DISCLOSURE_FEE_AMOUNT_REQUIRED", message: `${who} require the disclosure to state the ${money(row.docFee ?? 0)} fee amount.` });
  }
  if (rules.requiredLabel && (row.docFee ?? 0) > 0) {
    const label = new RegExp(`${esc(rules.requiredLabel)}\\s*(?::|of|is|-)?\\s*\\$\\s?([\\d,]+(?:\\.\\d{1,2})?)`, "i").exec(rendered.text);
    if (!label || !centsEq(Number(label[1].replace(/,/g, "")), row.docFee ?? 0)) {
      reasons.push({ code: "DISCLOSURE_LABEL_REQUIRED", message: `${who} require the fee amount immediately next to the label "${rules.requiredLabel}" (for example "${rules.requiredLabel}: ${money(row.docFee ?? 0)}").` });
    }
  }
  if (mentionsFee(rendered.text) && !rules.feeTerms.some((t) => rendered.text.toLowerCase().includes(t))) {
    reasons.push({ code: "DISCLOSURE_FEE_TERM", message: `${who} name the fee as one of: ${rules.feeTerms.join(", ")}.` });
  }
  if (rules.exclusionStatement && !rules.exclusionStatement.pattern.test(rendered.text)) {
    reasons.push({ code: "DISCLOSURE_EXCLUSION_STATEMENT", message: `${who} require a statement ${rules.exclusionStatement.describe}.` });
  }
  return out(breakdown);
}

/** The approval status of a store disclosure, as the gate reads it. */
export function disclosureApprovalReasons(d: StoreDisclosure | null, basis: FeeBasis, rules: JurisdictionRules = DEFAULT_RULES): BlockReason[] {
  if (!d) return [{ code: "DISCLOSURE_MISSING", message: "The store has no disclosure for this fee basis. vAuto requires the complete disclosure inside the 3,921 characters." }];
  const out: BlockReason[] = [];
  if (d.status !== "approved") out.push({ code: "DISCLOSURE_NOT_APPROVED", message: `The store disclosure is ${d.status.replace(/_/g, " ")}; only an approved, legal-reviewed disclosure can be exported.` });
  if (!d.legalReviewedAt || !d.legalReviewedBy) out.push({ code: "DISCLOSURE_NOT_LEGAL_REVIEWED", message: "The store disclosure has no recorded legal review." });
  if ((basis === "includes_fee" || basis === "before_fee") && d.basis !== basis) out.push({ code: "DISCLOSURE_BASIS_MISMATCH", message: `The store disclosure was approved for a ${d.basis === "includes_fee" ? "fee-inclusive" : "fee-additional"} price, but this vehicle's price is not.` });
  if (rules.typographyRequirement && !d.plainTextFormatAccepted) out.push({ code: "DISCLOSURE_FORMAT_NOT_ACCEPTED", message: `${rules.typographyRequirement} vAuto takes plain text, so counsel must record that this wording is acceptable in that format.` });
  if (d.template.trim() === PROPOSED_FEE_INCLUSIVE_DISCLOSURE) out.push({ code: "DISCLOSURE_UNREVIEWED_PROPOSAL", message: "This is the unreviewed 2026-11-01 proposal; it cannot be exported until counsel approves dealership wording." });
  return out;
}

// ---------------------------------------------------------------------------
// Counting, fitting and evaluating the export text.

export const vautoPolicy = (): ChannelPolicy => resolveChannelPolicy(VAUTO_CHANNEL)!;

export const vautoWireProfile = (p: ChannelPolicy = vautoPolicy()): WireProfile => ({
  exactTotal: p.exactTotal ?? VAUTO_TARGET, localMax: p.characterLimit, singleLine: !!p.singleLine, asciiOnly: !!p.asciiOnly, countUnit: "codePoints",
});

export interface SegmentCounts {
  total: number;
  narrative: number;
  cta: number;
  disclosure: number;
  separators: number;
  target: number;
  /** Positive: characters short of the target. Negative: over it. */
  remaining: number;
  disclosureAtEnd: boolean;
  disclosureOccurrences: number;
}

export function segmentCounts(text: string, cta: string | null, disclosure: string, target = VAUTO_TARGET): SegmentCounts {
  const len = (s: string) => countText(s).codePoints;
  const legal = disclosure.trim();
  const total = len(text);
  const occurrences = legal ? text.split(legal).length - 1 : 0;
  let rest = text;
  let d = 0; let c = 0; let sep = 0;
  const atEnd = !!legal && text.endsWith(legal);
  if (atEnd) { d = len(legal); rest = rest.slice(0, rest.length - legal.length); if (rest.endsWith(" ")) { sep += 1; rest = rest.slice(0, -1); } }
  const ctaText = (cta ?? "").trim();
  if (ctaText && rest.endsWith(ctaText)) { c = len(ctaText); rest = rest.slice(0, rest.length - ctaText.length); if (rest.endsWith(" ")) { sep += 1; rest = rest.slice(0, -1); } }
  return { total, narrative: len(rest), cta: c, disclosure: d, separators: sep, target, remaining: target - total, disclosureAtEnd: atEnd, disclosureOccurrences: occurrences };
}

export interface VautoExportResult {
  /** The text that would be exported, or null when it is blocked. */
  text: string | null;
  counts: SegmentCounts | null;
  findings: PolicyFinding[];
  droppedSentences: string[];
  reasons: BlockReason[];
}

/** The evidence state of the version under review, read by the server from the case. */
export interface EvidenceState {
  factSnapshot: boolean;
  openBlockingExceptions: number;
  openBlockingFindings: number;
  potentiallyStale: boolean;
}

export function evidenceReasons(e: EvidenceState | null): BlockReason[] {
  if (!e) return [{ code: "EVIDENCE_UNKNOWN", message: "The evidence behind this description could not be read." }];
  const out: BlockReason[] = [];
  if (!e.factSnapshot) out.push({ code: "EVIDENCE_MISSING", message: "No verified fact snapshot is stored for this description." });
  if (e.openBlockingExceptions > 0) out.push({ code: "EVIDENCE_EXCEPTIONS_OPEN", message: `${e.openBlockingExceptions} blocking description exception(s) are open for this vehicle.` });
  if (e.openBlockingFindings > 0) out.push({ code: "VALIDATION_FINDINGS_OPEN", message: `${e.openBlockingFindings} blocking validation finding(s) are open for this version.` });
  if (e.potentiallyStale) out.push({ code: "DESCRIPTION_STALE", message: "The vehicle's data changed after this description was generated. Regenerate it before export." });
  return out;
}

function textReasons(text: string, cta: string | null, legal: string): { counts: SegmentCounts; findings: PolicyFinding[]; reasons: BlockReason[] } {
  const policy = vautoPolicy();
  const reasons: BlockReason[] = [];
  const counts = segmentCounts(text, cta, legal);
  const body = legal ? text.split(legal).join(" ") : text;
  const priceInText = amountsIn(body);
  if (priceInText.length) reasons.push({ code: "PRICE_IN_DESCRIPTION", message: `vAuto descriptions carry no price outside the disclosure, but the text states ${priceInText.map(money).join(", ")}.` });
  const findings = checkChannelPolicy(text, policy, { disclosure: legal });
  for (const f of findings) if (f.severity === "blocking") reasons.push({ code: f.code, message: f.message });
  if (/[\r\n]/.test(text)) reasons.push({ code: "LINE_BREAKS", message: "vAuto takes a single line; the text contains line breaks." });
  if (legal && (counts.disclosureOccurrences !== 1 || !counts.disclosureAtEnd)) reasons.push({ code: "DISCLOSURE_PLACEMENT", message: "The disclosure must appear once, complete and unchanged, at the end of the export." });
  return { counts, findings, reasons };
}

const disclosureFor = (disclosure: ApprovedDisclosure): BlockReason[] => {
  const out: BlockReason[] = [];
  if (!disclosure.text.trim()) out.push({ code: "DISCLOSURE_MISSING", message: "The store has no disclosure; vAuto requires the complete disclosure in the 3,921 characters." });
  if (!disclosure.approved) out.push({ code: "DISCLOSURE_NOT_APPROVED", message: "The disclosure is not an approved, legal-reviewed store disclosure." });
  return out;
};

/** Builds the exact 3,921-character text from an evidence-backed narrative, then checks it. Never pads. */
export function buildVautoExport(args: { narrative: string; cta: string | null; disclosure: ApprovedDisclosure; price: PriceDisclosureCheck }): VautoExportResult {
  const reasons: BlockReason[] = [...args.price.reasons, ...disclosureFor(args.disclosure)];
  const draftPrices = amountsIn(`${args.narrative} ${args.cta ?? ""}`);
  if (draftPrices.length) reasons.push({ code: "PRICE_IN_DESCRIPTION", message: `vAuto descriptions carry no price outside the disclosure, but the draft states ${draftPrices.map(money).join(", ")}.` });
  const fit = fitNarrativeExact({ narrative: args.narrative, cta: args.cta, disclosure: args.disclosure, profile: vautoWireProfile() });
  if (!fit.ok || !fit.text) {
    reasons.push({ code: fit.code ?? "EXACT_FIT_FAILED", message: fit.code === "EXACT_LENGTH_UNREACHABLE"
      ? `No combination of whole, verified sentences reaches exactly ${VAUTO_TARGET} characters. Add verified content; the export is never padded or cut mid-sentence.`
      : fit.message ?? "The export could not be fitted." });
    return { text: null, counts: null, findings: [], droppedSentences: [], reasons };
  }
  const t = textReasons(fit.text, args.cta, args.disclosure.text.trim());
  for (const r of t.reasons) if (!reasons.some((x) => x.code === r.code)) reasons.push(r);
  return { text: fit.text, counts: t.counts, findings: t.findings, droppedSentences: (fit.meta.droppedSentences as string[] | undefined) ?? [], reasons };
}

/** Checks a stored or hand-edited vAuto text exactly as it would be exported. */
export function evaluateVautoText(args: { text: string; cta: string | null; disclosure: ApprovedDisclosure; price: PriceDisclosureCheck; evidence?: EvidenceState | null }): VautoExportResult {
  const reasons: BlockReason[] = [...args.price.reasons, ...disclosureFor(args.disclosure)];
  if (args.evidence !== undefined) reasons.push(...evidenceReasons(args.evidence));
  const t = textReasons(args.text, args.cta, args.disclosure.text.trim());
  reasons.push(...t.reasons);
  return { text: reasons.length ? null : args.text, counts: t.counts, findings: t.findings, droppedSentences: [], reasons };
}

export interface ApprovalGate { enabled: boolean; reasons: BlockReason[] }

export function vautoApprovalGate(args: { exportResult: VautoExportResult; canApprove: boolean; hasVersion: boolean }): ApprovalGate {
  const reasons = [...args.exportResult.reasons];
  if (!args.hasVersion) reasons.push({ code: "NO_VERSION", message: "There is no generated description version for this vehicle to approve." });
  if (!args.canApprove) reasons.push({ code: "NO_PERMISSION", message: "Your role cannot approve descriptions." });
  return { enabled: reasons.length === 0, reasons };
}

// ---------------------------------------------------------------------------
// The server's full decision for one stored vAuto version.

export interface ServerGateInput {
  content: string;
  cta: string | null;
  settings: unknown;
  row: StoredPriceRow | null;
  observed: number | null;
  disclosure: StoreDisclosure | null;
  rules: JurisdictionRules;
  evidence: EvidenceState | null;
  authorized: boolean;
}

export interface ServerGateDecision {
  ok: boolean;
  gateVersion: string;
  reasons: BlockReason[];
  counts: SegmentCounts;
  breakdown: PriceBreakdown | null;
  renderedDisclosure: string;
  disclosureVersion: string | null;
}

export function decideVautoExport(i: ServerGateInput): ServerGateDecision {
  const template = i.disclosure?.template ?? "";
  const price = checkPriceDisclosure({ settings: i.settings, row: i.row, observed: i.observed, disclosureText: template, rules: i.rules });
  const approval = disclosureApprovalReasons(i.disclosure, price.basis, i.rules);
  const result = evaluateVautoText({
    text: i.content, cta: i.cta, price, evidence: i.evidence,
    disclosure: { text: price.renderedDisclosure, version: i.disclosure?.version ?? "none", approved: approval.length === 0 },
  });
  const reasons = [...approval, ...result.reasons.filter((r) => r.code !== "DISCLOSURE_NOT_APPROVED" || approval.length === 0)];
  if (!i.authorized) reasons.push({ code: "NOT_AUTHORIZED", message: "Your role cannot approve or export descriptions for this store." });
  const seen = new Set<string>();
  const unique = reasons.filter((r) => { const k = `${r.code}:${r.message}`; if (seen.has(k)) return false; seen.add(k); return true; });
  return { ok: unique.length === 0, gateVersion: VAUTO_GATE_VERSION, reasons: unique, counts: result.counts ?? segmentCounts(i.content, i.cta, price.renderedDisclosure),
    breakdown: price.breakdown, renderedDisclosure: price.renderedDisclosure, disclosureVersion: i.disclosure?.version ?? null };
}

// ---------------------------------------------------------------------------
// vAuto round trip: compare what was exported with what vAuto or a listing
// site shows, so a vendor footer, a punctuation rewrite or a cut is visible.

export interface RoundTripReport {
  exportedCount: number;
  observedCount: number;
  identical: boolean;
  appendedSuffix: string | null;
  prependedPrefix: string | null;
  truncatedAt: number | null;
  disclosureIntact: boolean;
  firstDifference: { index: number; exported: string; observed: string } | null;
  punctuationChanges: string[];
}

export function compareRoundTrip(exported: string, observed: string, disclosure: string): RoundTripReport {
  const ex = exported;
  const ob = observed.replace(/\r\n?/g, "\n");
  const exportedCount = countText(ex).codePoints;
  const observedCount = countText(ob).codePoints;
  const identical = ex === ob;
  let i = 0;
  while (i < ex.length && i < ob.length && ex[i] === ob[i]) i++;
  const firstDifference = identical || i === Math.min(ex.length, ob.length) && ex.length <= ob.length
    ? null
    : { index: i, exported: ex.slice(Math.max(0, i - 20), i + 40), observed: ob.slice(Math.max(0, i - 20), i + 40) };
  const appendedSuffix = !identical && ob.startsWith(ex) ? ob.slice(ex.length) : null;
  const pi = ob.indexOf(ex);
  const prependedPrefix = pi > 0 ? ob.slice(0, pi) : null;
  const truncatedAt = !identical && ex.startsWith(ob) ? ob.length : null;
  const legal = disclosure.trim();
  const disclosureIntact = !!legal && ob.includes(legal);
  const punctuationChanges: string[] = [];
  const pairs: Array<[RegExp, string]> = [[/[\u2018\u2019]/, "straight apostrophes became curly quotes"], [/[\u201C\u201D]/, "straight quotes became curly quotes"],
    [/[\u2013\u2014]/, "hyphens became dashes"], [/\u00A0/, "spaces became non-breaking spaces"], [/&amp;|&#\d+;/, "characters were HTML-escaped"]];
  for (const [re, label] of pairs) if (re.test(ob) && !re.test(ex)) punctuationChanges.push(label);
  return { exportedCount, observedCount, identical, appendedSuffix, prependedPrefix, truncatedAt, disclosureIntact, firstDifference, punctuationChanges };
}

// ---------------------------------------------------------------------------
// Destination profiles for display.

export interface DestinationProfile {
  key: string;
  label: string;
  characterLimit: number;
  exactTotal: number | null;
  limitVerified: boolean;
  recommended: string;
  deliveryMode: string;
  wire: string;
  source: string;
}

export function destinationProfiles(keys: string[]): DestinationProfile[] {
  return keys.flatMap((k) => {
    const p = resolveChannelPolicy(k);
    if (!p) return [];
    const wire = [p.singleLine ? "single line" : "paragraphs", p.asciiOnly ? "ASCII only" : "Unicode", p.htmlAllowed ? "HTML" : "plain text"].join(", ");
    return [{ key: p.key, label: p.label, characterLimit: p.characterLimit, exactTotal: p.exactTotal ?? null, limitVerified: p.limitVerified,
      recommended: `${p.recommendedMin.toLocaleString("en-US")} to ${p.recommendedMax.toLocaleString("en-US")}`, deliveryMode: p.deliveryMode, wire,
      source: provenanceFor(k)?.sourceNote ?? "" }];
  });
}
