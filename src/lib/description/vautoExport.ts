import {
  countText, fitNarrativeExact, type ApprovedDisclosure, type WireProfile,
} from "../../../supabase/functions/_shared/description-exact-fit";
import {
  checkChannelPolicy, provenanceFor, resolveChannelPolicy, type ChannelPolicy, type PolicyFinding,
} from "../../../supabase/functions/_shared/description-channel-policy";
import {
  evidenceContradicts, planFeeChange, resolveFeeBasis, roundFee, type FeeBasis, type FeeBasisSource, type StoredPriceRow,
} from "@/lib/admin/pricing/feeBasis";
import { parseConfiguredBoolean } from "@/lib/market/priceBasis";

// The vAuto export gate. The description writer never sees a price, so the
// only price statement in a vAuto export is the store disclosure. That
// statement has to agree with how the stored price is actually built, which
// is read from the dealership's explicit fee-basis setting and the vehicle's
// stored selling price, documentation fee and advertised total; a price label
// alone never decides it. Anything ambiguous blocks the export and is shown.

export const VAUTO_CHANNEL = "vauto";
export const VAUTO_TARGET = 3921;

/** The owner's proposed wording for a verified fee-inclusive advertised price (2026-11-01). Not yet approved. */
export const PROPOSED_FEE_INCLUSIVE_DISCLOSURE =
  "Advertised price includes the dealer documentation fee. Sales tax, title and registration are additional.";

export interface BlockReason { code: string; message: string }

export type DisclosureFeeStatement = "includes_fee" | "excludes_fee" | "silent" | "mixed";

const FEE_NOUN = /\b(doc(?:ument(?:ation)?)?|dealer|conveyance|processing|administrative|admin)\s+(?:documentation\s+)?fees?\b|\bdoc\s+fees?\b/;
const EXCLUDES = /\b(excludes?|excluding|does not include|do not include|doesn't include|don't include|not included|not include|plus|in addition to|additional|extra|on top of)\b/;
const INCLUDES = /\b(includes?|including|included|inclusive of)\b/;

const sentencesOf = (text: string): string[] => text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);

/** What the disclosure says about the documentation fee, sentence by sentence. Silence is not inclusion. */
export function classifyDisclosure(text: string): DisclosureFeeStatement {
  let inc = false;
  let exc = false;
  for (const s of sentencesOf(text.toLowerCase())) {
    if (!FEE_NOUN.test(s)) continue;
    if (EXCLUDES.test(s)) exc = true;
    else if (INCLUDES.test(s)) inc = true;
  }
  if (inc && exc) return "mixed";
  if (inc) return "includes_fee";
  if (exc) return "excludes_fee";
  return "silent";
}

const money = (n: number): string => `$${n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
const amountsIn = (text: string): number[] =>
  [...text.matchAll(/\$\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/g)].map((m) => Number(`${m[1].replace(/,/g, "")}.${m[2] ?? "0"}`));

export interface PriceBreakdown {
  basis: "includes_fee" | "before_fee";
  sellingPrice: number;
  docFee: number;
  advertisedTotal: number;
  /** The stored column each figure came from. */
  sources: { sellingPrice: string; docFee: string; advertisedTotal: string };
}

export interface PriceDisclosureCheck {
  verified: boolean;
  basis: FeeBasis;
  basisSource: FeeBasisSource;
  breakdown: PriceBreakdown | null;
  statement: DisclosureFeeStatement;
  /** The wording the store disclosure should carry, when one has been proposed for this basis. */
  proposedWording: string | null;
  reasons: BlockReason[];
}

export interface PriceDisclosureInput {
  /** dealer_profiles.settings, as stored. */
  settings: unknown;
  row: StoredPriceRow | null;
  /** The latest website observation for this VIN, when one was read. */
  observed?: number | null;
  disclosureText: string;
}

const centsEq = (a: number, b: number) => Math.round(a * 100) === Math.round(b * 100);

export function checkPriceDisclosure(i: PriceDisclosureInput): PriceDisclosureCheck {
  const { basis, source } = resolveFeeBasis(i.settings);
  const statement = classifyDisclosure(i.disclosureText);
  const reasons: BlockReason[] = [];
  const out = (breakdown: PriceBreakdown | null, proposedWording: string | null): PriceDisclosureCheck =>
    ({ verified: reasons.length === 0, basis, basisSource: source, breakdown, statement, proposedWording, reasons });

  if (basis === "unconfigured") reasons.push({ code: "FEE_BASIS_UNCONFIGURED",
    message: source === "unreadable_setting"
      ? "The dealership's fee basis setting cannot be read, so it is unknown whether the advertised price includes the documentation fee."
      : "The dealership has not set whether its advertised price includes the documentation fee." });
  if (basis === "conflict") reasons.push({ code: "FEE_BASIS_CONFLICT",
    message: "The dealership's two fee basis settings contradict each other." });
  if (basis !== "includes_fee" && basis !== "before_fee") return out(null, null);

  const row = i.row;
  if (!row) { reasons.push({ code: "NO_PRICE_ROW", message: "No stored price was found for this vehicle." }); return out(null, null); }

  const bag = (i.settings && typeof i.settings === "object" ? i.settings : {}) as Record<string, unknown>;
  const feeEnabled = parseConfiguredBoolean(bag.doc_fee_enabled);
  const configuredFee = Number(bag.doc_fee_amount);
  if (row.docFee == null || !Number.isFinite(row.docFee)) {
    reasons.push({ code: "DOC_FEE_MISSING", message: "The vehicle has no stored documentation fee, so the advertised total cannot be checked." });
  } else if (feeEnabled === false && row.docFee > 0) {
    reasons.push({ code: "DOC_FEE_DISABLED_BUT_STORED", message: `The documentation fee is turned off for the dealership, but this vehicle stores a ${money(row.docFee)} fee.` });
  } else if (feeEnabled === true && Number.isFinite(configuredFee) && !centsEq(roundFee(configuredFee), roundFee(row.docFee))) {
    reasons.push({ code: "DOC_FEE_MISMATCH", message: `The dealership's documentation fee is ${money(configuredFee)}, but this vehicle stores ${money(row.docFee)}.` });
  }

  const plan = planFeeChange(basis, row, row.docFee ?? 0);
  if (plan.status === "no_price" || plan.status === "invalid") {
    reasons.push({ code: "NO_PRICE", message: basis === "includes_fee"
      ? "The vehicle has no stored advertised total (price)."
      : "The vehicle has no stored price before the documentation fee (advertised_price_before_doc)." });
  }
  if (plan.status === "split_mismatch") {
    reasons.push({ code: "PRICE_SPLIT_MISMATCH", message: basis === "includes_fee"
      ? `The stored selling price ${money(row.advertisedBeforeDoc ?? 0)} plus the ${money(row.docFee ?? 0)} fee does not equal the stored advertised total ${money(row.price ?? 0)}.`
      : `The stored price ${money(row.price ?? 0)} differs from the stored price before the fee ${money(row.advertisedBeforeDoc ?? 0)}.` });
  }
  if (plan.status === "change") {
    reasons.push({ code: "PRICE_SPLIT_INCOMPLETE", message: basis === "includes_fee"
      ? "The stored selling price is missing or does not reconcile with the advertised total minus the fee."
      : "The stored advertised total (website_sale_price) is missing or is not the price before the fee plus the fee." });
  }
  if (basis === "includes_fee" && plan.salePriceDiffers) {
    reasons.push({ code: "SALE_PRICE_DIFFERS", message: `The stored website sale price ${money(row.websiteSalePrice ?? 0)} differs from the advertised total ${money(row.price ?? 0)}.` });
  }
  if (evidenceContradicts(basis, row.price, row.docFee, i.observed)) {
    reasons.push({ code: "EVIDENCE_CONTRADICTS", message: `The latest website observation (${money(i.observed ?? 0)}) contradicts the configured fee basis.` });
  }

  let breakdown: PriceBreakdown | null = null;
  if (plan.status === "unchanged") {
    breakdown = basis === "includes_fee"
      ? { basis, sellingPrice: plan.sellingAfter ?? 0, docFee: roundFee(row.docFee), advertisedTotal: row.price ?? 0,
          sources: { sellingPrice: "advertised_price_before_doc", docFee: "doc_fee", advertisedTotal: "price" } }
      : { basis, sellingPrice: row.advertisedBeforeDoc ?? 0, docFee: roundFee(row.docFee), advertisedTotal: plan.totalAfter ?? 0,
          sources: { sellingPrice: "advertised_price_before_doc", docFee: "doc_fee", advertisedTotal: "website_sale_price" } };
  }

  const proposedWording = basis === "includes_fee" ? PROPOSED_FEE_INCLUSIVE_DISCLOSURE : null;
  const says = basis === "includes_fee" ? "includes" : "excludes";
  if (statement === "mixed") {
    reasons.push({ code: "DISCLOSURE_MIXED", message: "The store disclosure both includes and excludes the documentation fee." });
  } else if ((basis === "includes_fee" && statement === "excludes_fee") || (basis === "before_fee" && statement === "includes_fee")) {
    reasons.push({ code: "DISCLOSURE_CONTRADICTS_PRICE",
      message: `The store disclosure says the price ${statement === "includes_fee" ? "includes" : "excludes"} the documentation fee, but the stored price ${says} it.` });
  } else if (statement === "silent") {
    reasons.push({ code: "DISCLOSURE_SILENT_ON_FEE", message: basis === "includes_fee"
      ? "The store disclosure does not say the advertised price includes the documentation fee."
      : "The store disclosure does not say the documentation fee is added to the advertised price. No wording has been approved for this basis yet." });
  }
  const feeAmounts = amountsIn(i.disclosureText);
  if (row.docFee != null && feeAmounts.length && FEE_NOUN.test(i.disclosureText.toLowerCase()) && !feeAmounts.some((a) => centsEq(a, row.docFee ?? 0))) {
    reasons.push({ code: "DISCLOSURE_FEE_AMOUNT_MISMATCH", message: `The store disclosure states a fee amount that is not the stored ${money(row.docFee)} fee.` });
  }
  return out(breakdown, proposedWording);
}

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

/** The live counter: how a vAuto text splits into narrative, CTA, disclosure and joining spaces. */
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

/** Builds the exact 3,921-character vAuto text from an evidence-backed narrative, then checks it. Never pads. */
export function buildVautoExport(args: {
  narrative: string;
  cta: string | null;
  disclosure: ApprovedDisclosure;
  price: PriceDisclosureCheck;
}): VautoExportResult {
  const policy = vautoPolicy();
  const reasons: BlockReason[] = [...args.price.reasons];
  if (!args.disclosure.text.trim()) reasons.push({ code: "DISCLOSURE_MISSING", message: "The store has no disclosure; vAuto requires the complete disclosure in the 3,921 characters." });
  if (!args.disclosure.approved) reasons.push({ code: "DISCLOSURE_NOT_APPROVED", message: "The disclosure shown is a draft. Save it as the store disclosure before the export can be approved." });
  const priceInText = amountsIn(`${args.narrative} ${args.cta ?? ""}`);
  if (priceInText.length) reasons.push({ code: "PRICE_IN_DESCRIPTION", message: `vAuto descriptions carry no price, but the draft states ${priceInText.map(money).join(", ")}.` });

  const fit = fitNarrativeExact({ narrative: args.narrative, cta: args.cta, disclosure: args.disclosure, profile: vautoWireProfile(policy) });
  if (!fit.ok || !fit.text) {
    reasons.push({ code: fit.code ?? "EXACT_FIT_FAILED", message: fit.code === "EXACT_LENGTH_UNREACHABLE"
      ? `No combination of whole, verified sentences reaches exactly ${VAUTO_TARGET} characters. Add verified content; the export is never padded or cut mid-sentence.`
      : fit.message ?? "The export could not be fitted." });
    return { text: null, counts: null, findings: [], droppedSentences: [], reasons };
  }
  const findings = checkChannelPolicy(fit.text, policy);
  for (const f of findings) if (f.severity === "blocking") reasons.push({ code: f.code, message: f.message });
  const counts = segmentCounts(fit.text, args.cta, args.disclosure.text);
  if (counts.disclosureOccurrences !== 1 || !counts.disclosureAtEnd) reasons.push({ code: "DISCLOSURE_PLACEMENT", message: "The disclosure must appear once, complete, at the end of the export." });
  return { text: fit.text, counts, findings, droppedSentences: (fit.meta.droppedSentences as string[] | undefined) ?? [], reasons };
}

/** Checks a stored or hand-edited vAuto text as it would be exported. Same reasons as the build. */
export function evaluateVautoText(args: { text: string; cta: string | null; disclosure: ApprovedDisclosure; price: PriceDisclosureCheck }): VautoExportResult {
  const policy = vautoPolicy();
  const reasons: BlockReason[] = [...args.price.reasons];
  const legal = args.disclosure.text.trim();
  if (!legal) reasons.push({ code: "DISCLOSURE_MISSING", message: "The store has no disclosure; vAuto requires the complete disclosure in the 3,921 characters." });
  if (!args.disclosure.approved) reasons.push({ code: "DISCLOSURE_NOT_APPROVED", message: "The disclosure shown is a draft. Save it as the store disclosure before the export can be approved." });
  const counts = segmentCounts(args.text, args.cta, legal);
  const body = legal ? args.text.split(legal).join(" ") : args.text;
  const priceInText = amountsIn(body);
  if (priceInText.length) reasons.push({ code: "PRICE_IN_DESCRIPTION", message: `vAuto descriptions carry no price, but the text states ${priceInText.map(money).join(", ")}.` });
  const findings = checkChannelPolicy(args.text, policy);
  for (const f of findings) if (f.severity === "blocking") reasons.push({ code: f.code, message: f.message });
  if (/[\r\n]/.test(args.text)) reasons.push({ code: "LINE_BREAKS", message: "vAuto takes a single line; the text contains line breaks." });
  if (legal && (counts.disclosureOccurrences !== 1 || !counts.disclosureAtEnd)) reasons.push({ code: "DISCLOSURE_PLACEMENT", message: "The disclosure must appear once, complete and unchanged, at the end of the export." });
  return { text: reasons.length ? null : args.text, counts, findings, droppedSentences: [], reasons };
}

export interface ApprovalGate { enabled: boolean; reasons: BlockReason[] }

export function vautoApprovalGate(args: { exportResult: VautoExportResult; canApprove: boolean; hasVersion: boolean }): ApprovalGate {
  const reasons = [...args.exportResult.reasons];
  if (!args.hasVersion) reasons.push({ code: "NO_VERSION", message: "There is no generated description version for this vehicle to approve." });
  if (!args.canApprove) reasons.push({ code: "NO_PERMISSION", message: "Your role cannot approve descriptions." });
  return { enabled: reasons.length === 0, reasons };
}

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

export const formatMoney = money;
