import { describe, it, expect } from "vitest";
import {
  PROPOSED_FEE_INCLUSIVE_DISCLOSURE, VAUTO_TARGET, buildVautoExport, checkPriceDisclosure, classifyDisclosure,
  destinationProfiles, evaluateVautoText, segmentCounts, vautoApprovalGate,
} from "./vautoExport";
import {
  SYNTHETIC_CTA, SYNTHETIC_DISCLOSURE, SYNTHETIC_FACTS, SYNTHETIC_NARRATIVE, SYNTHETIC_PRICE_ROW, SYNTHETIC_SETTINGS,
} from "./vautoSyntheticExample";

const approved = (text: string) => ({ text, version: "disc_test", approved: true });
const codes = (r: { reasons: Array<{ code: string }> }) => r.reasons.map((x) => x.code);

describe("classifyDisclosure", () => {
  it("reads the owner's proposed wording as fee-inclusive", () => {
    expect(classifyDisclosure(PROPOSED_FEE_INCLUSIVE_DISCLOSURE)).toBe("includes_fee");
  });
  it("reads exclusion, including 'does not include', as excluding the fee", () => {
    expect(classifyDisclosure("Price excludes tax, title, registration and the dealer documentation fee.")).toBe("excludes_fee");
    expect(classifyDisclosure("Prices do not include the $499 doc fee.")).toBe("excludes_fee");
    expect(classifyDisclosure("Plus a $499 dealer fee.")).toBe("excludes_fee");
  });
  it("treats a disclosure that never mentions the fee as silent, not as inclusion", () => {
    expect(classifyDisclosure("Price excludes tax, title and registration. See dealer for details.")).toBe("silent");
  });
  it("flags a disclosure that says both", () => {
    expect(classifyDisclosure("Price includes the doc fee. A dealer fee is additional.")).toBe("mixed");
  });
});

describe("checkPriceDisclosure", () => {
  const base = { settings: SYNTHETIC_SETTINGS, row: SYNTHETIC_PRICE_ROW, disclosureText: SYNTHETIC_DISCLOSURE };

  it("verifies a reconciling fee-inclusive row with the proposed wording and shows the actual fee", () => {
    const r = checkPriceDisclosure(base);
    expect(r.verified).toBe(true);
    expect(r.breakdown).toMatchObject({ basis: "includes_fee", sellingPrice: 28496, docFee: 499, advertisedTotal: 28995 });
    expect(r.breakdown!.sellingPrice + r.breakdown!.docFee).toBe(r.breakdown!.advertisedTotal);
  });
  it("does not decide the basis from a label: no setting keeps it blocked", () => {
    const r = checkPriceDisclosure({ ...base, settings: { doc_fee_enabled: true, doc_fee_amount: 499, price_display_mode: "website_sale_price" } });
    expect(r.verified).toBe(false);
    expect(codes(r)).toContain("FEE_BASIS_UNCONFIGURED");
    expect(r.breakdown).toBeNull();
  });
  it("blocks contradicting basis settings", () => {
    expect(codes(checkPriceDisclosure({ ...base, settings: { ...SYNTHETIC_SETTINGS, advertised_excludes_doc_fee: true } }))).toContain("FEE_BASIS_CONFLICT");
  });
  it("blocks a stored split that does not add up", () => {
    const r = checkPriceDisclosure({ ...base, row: { ...SYNTHETIC_PRICE_ROW, advertisedBeforeDoc: 28000 } });
    expect(codes(r)).toContain("PRICE_SPLIT_MISMATCH");
    expect(r.breakdown).toBeNull();
  });
  it("blocks a missing selling price instead of deriving it silently", () => {
    expect(codes(checkPriceDisclosure({ ...base, row: { ...SYNTHETIC_PRICE_ROW, advertisedBeforeDoc: null } }))).toContain("PRICE_SPLIT_INCOMPLETE");
  });
  it("blocks a website sale price that differs from the advertised total", () => {
    expect(codes(checkPriceDisclosure({ ...base, row: { ...SYNTHETIC_PRICE_ROW, websiteSalePrice: 29494 } }))).toContain("SALE_PRICE_DIFFERS");
  });
  it("blocks a stored fee that differs from the dealership fee", () => {
    expect(codes(checkPriceDisclosure({ ...base, row: { ...SYNTHETIC_PRICE_ROW, docFee: 599, advertisedBeforeDoc: 28396 } }))).toContain("DOC_FEE_MISMATCH");
  });
  it("blocks website evidence that contradicts the basis", () => {
    expect(codes(checkPriceDisclosure({ ...base, observed: 29494 }))).toContain("EVIDENCE_CONTRADICTS");
  });
  it("blocks the old exclusion disclosure on a fee-inclusive price and proposes the owner's wording", () => {
    const r = checkPriceDisclosure({ ...base, disclosureText: "Price excludes tax, title, registration and dealer documentation fee." });
    expect(codes(r)).toContain("DISCLOSURE_CONTRADICTS_PRICE");
    expect(r.proposedWording).toBe(PROPOSED_FEE_INCLUSIVE_DISCLOSURE);
  });
  it("blocks a silent disclosure", () => {
    expect(codes(checkPriceDisclosure({ ...base, disclosureText: "See dealer for details." }))).toContain("DISCLOSURE_SILENT_ON_FEE");
  });
  it("blocks a disclosure that states a different fee amount", () => {
    expect(codes(checkPriceDisclosure({ ...base, disclosureText: "Advertised price includes the $399 dealer documentation fee." }))).toContain("DISCLOSURE_FEE_AMOUNT_MISMATCH");
  });
  it("has no approved wording for a before-fee price yet", () => {
    const r = checkPriceDisclosure({ settings: { advertised_includes_doc_fee: false, doc_fee_enabled: true, doc_fee_amount: 499 },
      row: { price: 28496, advertisedBeforeDoc: 28496, websiteSalePrice: 28995, docFee: 499 }, disclosureText: "See dealer for details." });
    expect(r.breakdown).toMatchObject({ basis: "before_fee", sellingPrice: 28496, advertisedTotal: 28995 });
    expect(r.proposedWording).toBeNull();
    expect(codes(r)).toContain("DISCLOSURE_SILENT_ON_FEE");
  });
});

describe("synthetic agreement example", () => {
  const price = checkPriceDisclosure({ settings: SYNTHETIC_SETTINGS, row: SYNTHETIC_PRICE_ROW, disclosureText: SYNTHETIC_DISCLOSURE });
  const result = buildVautoExport({ narrative: SYNTHETIC_NARRATIVE, cta: SYNTHETIC_CTA, disclosure: approved(SYNTHETIC_DISCLOSURE), price });

  it("price breakdown, description, disclosure and export text agree at exactly 3,921", () => {
    expect(result.reasons).toEqual([]);
    const text = result.text!;
    expect([...text].length).toBe(VAUTO_TARGET);
    expect(text.endsWith(`${SYNTHETIC_CTA} ${SYNTHETIC_DISCLOSURE}`)).toBe(true);
    expect(text.split(SYNTHETIC_DISCLOSURE).length - 1).toBe(1);
    expect(classifyDisclosure(text)).toBe(price.basis);
    expect(text).not.toMatch(/\$/);
    const c = result.counts!;
    expect(c.narrative + c.cta + c.disclosure + c.separators).toBe(VAUTO_TARGET);
    expect(c.remaining).toBe(0);
    expect(price.breakdown!.sellingPrice + price.breakdown!.docFee).toBe(price.breakdown!.advertisedTotal);
  });
  it("every exported sentence comes from a verified fact", () => {
    const body = result.text!.slice(0, result.text!.length - SYNTHETIC_CTA.length - SYNTHETIC_DISCLOSURE.length - 2);
    const sentences = SYNTHETIC_FACTS.map((f) => f.sentence);
    const kept = sentences.filter((s) => body.includes(s));
    expect(kept.join(" ").length).toBe(body.length);
    const dropped = result.droppedSentences.join(" ");
    expect(sentences.filter((s) => dropped.includes(s)).length).toBe(sentences.length - kept.length);
  });
  it("enables approval only once everything agrees", () => {
    expect(vautoApprovalGate({ exportResult: result, canApprove: true, hasVersion: true }).enabled).toBe(true);
    const conflict = checkPriceDisclosure({ settings: SYNTHETIC_SETTINGS, row: SYNTHETIC_PRICE_ROW, disclosureText: "Price excludes tax, title and the dealer documentation fee." });
    const blocked = buildVautoExport({ narrative: SYNTHETIC_NARRATIVE, cta: SYNTHETIC_CTA, disclosure: approved(conflict.statement), price: conflict });
    expect(vautoApprovalGate({ exportResult: blocked, canApprove: true, hasVersion: true }).enabled).toBe(false);
  });
  it("does not pad a thin draft to reach the target", () => {
    const thin = buildVautoExport({ narrative: SYNTHETIC_FACTS.slice(0, 5).map((f) => f.sentence).join(" "), cta: SYNTHETIC_CTA, disclosure: approved(SYNTHETIC_DISCLOSURE), price });
    expect(thin.text).toBeNull();
    expect(codes(thin)).toContain("EXACT_LENGTH_UNREACHABLE");
  });
  it("blocks a price written into the description", () => {
    const r = buildVautoExport({ narrative: `${SYNTHETIC_NARRATIVE} Now only $28,995.`, cta: SYNTHETIC_CTA, disclosure: approved(SYNTHETIC_DISCLOSURE), price });
    expect(codes(r)).toContain("PRICE_IN_DESCRIPTION");
  });
  it("blocks a draft disclosure that is not yet saved for the store", () => {
    const r = buildVautoExport({ narrative: SYNTHETIC_NARRATIVE, cta: SYNTHETIC_CTA, disclosure: { ...approved(SYNTHETIC_DISCLOSURE), approved: false }, price });
    expect(codes(r)).toContain("DISCLOSURE_NOT_APPROVED");
  });
});

describe("segmentCounts and destination profiles", () => {
  it("splits a pasted text into narrative, CTA, disclosure and separators", () => {
    const c = segmentCounts(`Hello there. Call us. ${SYNTHETIC_DISCLOSURE}`, "Call us.", SYNTHETIC_DISCLOSURE);
    expect(c).toMatchObject({ narrative: 12, cta: 8, disclosure: SYNTHETIC_DISCLOSURE.length, separators: 2, disclosureAtEnd: true });
    expect(c.remaining).toBe(VAUTO_TARGET - c.total);
  });
  it("lists vAuto as an exact 3,921 export under an unverified 4,000 cap", () => {
    const [v] = destinationProfiles(["vauto"]);
    expect(v).toMatchObject({ exactTotal: 3921, characterLimit: 4000, limitVerified: false });
    expect(v.wire).toContain("ASCII only");
  });
});

describe("evaluateVautoText", () => {
  const price = checkPriceDisclosure({ settings: SYNTHETIC_SETTINGS, row: SYNTHETIC_PRICE_ROW, disclosureText: SYNTHETIC_DISCLOSURE });
  const built = buildVautoExport({ narrative: SYNTHETIC_NARRATIVE, cta: SYNTHETIC_CTA, disclosure: approved(SYNTHETIC_DISCLOSURE), price });
  it("passes the exported text unchanged", () => {
    const r = evaluateVautoText({ text: built.text!, cta: SYNTHETIC_CTA, disclosure: approved(SYNTHETIC_DISCLOSURE), price });
    expect(r.reasons).toEqual([]);
    expect(r.text).toBe(built.text);
  });
  it("blocks a hand edit that moves off 3,921 or alters the disclosure", () => {
    const short = evaluateVautoText({ text: built.text!.replace("The interior is black cloth. ", ""), cta: SYNTHETIC_CTA, disclosure: approved(SYNTHETIC_DISCLOSURE), price });
    expect(codes(short)).toContain("EXACT_LENGTH_MISMATCH");
    const altered = evaluateVautoText({ text: built.text!.replace("are additional", "are extra!!!!"), cta: SYNTHETIC_CTA, disclosure: approved(SYNTHETIC_DISCLOSURE), price });
    expect(codes(altered)).toContain("DISCLOSURE_PLACEMENT");
  });
});
