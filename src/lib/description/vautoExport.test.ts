import { describe, it, expect } from "vitest";
import {
  JURISDICTION_RULES, PROPOSED_CT_DISCLOSURE_TEMPLATE, PROPOSED_FEE_INCLUSIVE_DISCLOSURE, VAUTO_TARGET,
  buildVautoExport, checkPriceDisclosure, classifyDisclosure, clausesOf, compareRoundTrip, decideVautoExport, destinationProfiles,
  disclosureApprovalReasons, evaluateVautoText, renderDisclosure, segmentCounts, vautoApprovalGate,
} from "./vautoExport";
import {
  SYNTHETIC_APPROVED_DISCLOSURE, SYNTHETIC_CTA, SYNTHETIC_DISCLOSURE, SYNTHETIC_FACTS, SYNTHETIC_NARRATIVE, SYNTHETIC_PENDING_DISCLOSURE,
  SYNTHETIC_PRICE_ROW, SYNTHETIC_SETTINGS,
} from "./vautoSyntheticExample";

const CT = JURISDICTION_RULES.CT;
const approved = (text: string) => ({ text, version: "disc_test", approved: true });
const codes = (r: { reasons: Array<{ code: string }> }) => r.reasons.map((x) => x.code);

describe("classifyDisclosure: fee included", () => {
  it.each([
    "The advertised price includes the documentation fee; taxes and registration are additional.",
    "The advertised price includes the documentation fee, but taxes and registration are additional.",
    "Advertised price includes the dealer documentation fee. Sales tax, title and registration are additional.",
    "Price includes the $499 dealer conveyance fee. State and local taxes and registration fees are excluded.",
    "The Dealer Conveyance Fee of $499 is included in the advertised price.",
    "Prices are inclusive of the processing fee.",
    PROPOSED_CT_DISCLOSURE_TEMPLATE,
  ])("%s", (text) => expect(classifyDisclosure(text)).toBe("includes_fee"));
});

describe("classifyDisclosure: fee excluded", () => {
  it.each([
    "Price excludes tax, title, registration and dealer documentation fee.",
    "Prices do not include the $499 doc fee.",
    "Price doesn't include the dealer conveyance fee.",
    "Plus a $499 dealer conveyance fee.",
    "Sales tax, registration and the documentation fee are additional.",
    "The conveyance fee is not included in the advertised price.",
    "Advertised price is before the dealer processing fee.",
    "All prices include freight except the documentation fee.",
  ])("%s", (text) => expect(classifyDisclosure(text)).toBe("excludes_fee"));
});

describe("classifyDisclosure: silent and mixed", () => {
  it("treats a disclosure that never mentions the fee as silent, not as inclusion", () => {
    expect(classifyDisclosure("Price excludes tax, title and registration. See dealer for details.")).toBe("silent");
    expect(classifyDisclosure("State and local taxes and registration fees are excluded.")).toBe("silent");
  });
  it("flags disclosures that say both", () => {
    expect(classifyDisclosure("Price includes the doc fee. A dealer conveyance fee is additional.")).toBe("mixed");
    expect(classifyDisclosure("The advertised price includes the documentation fee; the documentation fee is additional.")).toBe("mixed");
  });
  it("splits clauses on semicolons and contrastive conjunctions but not on lists", () => {
    expect(clausesOf("A includes the fee; taxes are extra, but title is not.")).toEqual(["A includes the fee", "taxes are extra", "but title is not."]);
    expect(clausesOf("Price excludes tax, title and registration.")).toHaveLength(1);
  });
});

describe("renderDisclosure", () => {
  it("fills the fee from the vehicle and reports a missing value", () => {
    expect(renderDisclosure("Dealer Conveyance Fee: {conveyance_fee}.", 499).text).toBe("Dealer Conveyance Fee: $499.");
    expect(renderDisclosure("Dealer Conveyance Fee: {conveyance_fee}.", null).missing).toEqual(["{conveyance_fee}"]);
  });
});

describe("checkPriceDisclosure", () => {
  const base = { settings: SYNTHETIC_SETTINGS, row: SYNTHETIC_PRICE_ROW, disclosureText: PROPOSED_CT_DISCLOSURE_TEMPLATE, rules: CT };

  it("verifies a reconciling fee-inclusive row with the CT template and shows the actual fee", () => {
    const r = checkPriceDisclosure(base);
    expect(r.reasons).toEqual([]);
    expect(r.breakdown).toMatchObject({ basis: "includes_fee", sellingPrice: 28496, docFee: 499, advertisedTotal: 28995 });
    expect(r.breakdown!.sellingPrice + r.breakdown!.docFee).toBe(r.breakdown!.advertisedTotal);
    expect(r.renderedDisclosure).toContain("Dealer Conveyance Fee: $499.");
  });
  it("blocks the owner's first proposal under CT rules: no label, no amount, wrong term, no exclusion statement", () => {
    const r = checkPriceDisclosure({ ...base, disclosureText: PROPOSED_FEE_INCLUSIVE_DISCLOSURE });
    expect(codes(r)).toEqual(expect.arrayContaining(["DISCLOSURE_FEE_AMOUNT_REQUIRED", "DISCLOSURE_LABEL_REQUIRED", "DISCLOSURE_FEE_TERM", "DISCLOSURE_EXCLUSION_STATEMENT"]));
  });
  it("does not decide the basis from a label: no setting keeps it blocked", () => {
    const r = checkPriceDisclosure({ ...base, settings: { doc_fee_enabled: true, doc_fee_amount: 499, price_display_mode: "website_sale_price" } });
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
  it("blocks a stored fee that differs from the store fee", () => {
    expect(codes(checkPriceDisclosure({ ...base, row: { ...SYNTHETIC_PRICE_ROW, docFee: 599, advertisedBeforeDoc: 28396 } }))).toContain("DOC_FEE_MISMATCH");
  });
  it("blocks website evidence that contradicts the basis", () => {
    expect(codes(checkPriceDisclosure({ ...base, observed: 29494 }))).toContain("EVIDENCE_CONTRADICTS");
  });
  it("blocks an exclusion disclosure on a fee-inclusive price", () => {
    expect(codes(checkPriceDisclosure({ ...base, disclosureText: "Price excludes tax, title, registration and dealer conveyance fee." }))).toContain("DISCLOSURE_CONTRADICTS_PRICE");
  });
  it("blocks a stated amount that is not the stored fee", () => {
    expect(codes(checkPriceDisclosure({ ...base, disclosureText: PROPOSED_CT_DISCLOSURE_TEMPLATE.replace("{conveyance_fee}", "$399") }))).toContain("DISCLOSURE_FEE_AMOUNT_MISMATCH");
  });
  it("blocks a fee-additional price in Connecticut", () => {
    const r = checkPriceDisclosure({ ...base, settings: { advertised_includes_doc_fee: false, doc_fee_enabled: true, doc_fee_amount: 499 },
      row: { price: 28496, advertisedBeforeDoc: 28496, websiteSalePrice: 28995, docFee: 499 } });
    expect(codes(r)).toContain("STATE_REQUIRES_FEE_INCLUDED");
  });
});

describe("disclosure approval", () => {
  it("never treats a proposal as approved", () => {
    expect(disclosureApprovalReasons(SYNTHETIC_PENDING_DISCLOSURE, "includes_fee", CT).map((r) => r.code))
      .toEqual(expect.arrayContaining(["DISCLOSURE_NOT_APPROVED", "DISCLOSURE_NOT_LEGAL_REVIEWED", "DISCLOSURE_FORMAT_NOT_ACCEPTED"]));
    expect(disclosureApprovalReasons({ ...SYNTHETIC_APPROVED_DISCLOSURE, template: PROPOSED_FEE_INCLUSIVE_DISCLOSURE }, "includes_fee", CT).map((r) => r.code))
      .toContain("DISCLOSURE_UNREVIEWED_PROPOSAL");
  });
  it("accepts an approved, legal-reviewed disclosure for the matching basis only", () => {
    expect(disclosureApprovalReasons(SYNTHETIC_APPROVED_DISCLOSURE, "includes_fee", CT)).toEqual([]);
    expect(disclosureApprovalReasons(SYNTHETIC_APPROVED_DISCLOSURE, "before_fee", CT).map((r) => r.code)).toContain("DISCLOSURE_BASIS_MISMATCH");
    expect(disclosureApprovalReasons(null, "includes_fee", CT).map((r) => r.code)).toEqual(["DISCLOSURE_MISSING"]);
  });
});

describe("synthetic agreement example", () => {
  const price = checkPriceDisclosure({ settings: SYNTHETIC_SETTINGS, row: SYNTHETIC_PRICE_ROW, disclosureText: PROPOSED_CT_DISCLOSURE_TEMPLATE, rules: CT });
  const result = buildVautoExport({ narrative: SYNTHETIC_NARRATIVE, cta: SYNTHETIC_CTA, disclosure: approved(price.renderedDisclosure), price });

  it("price breakdown, description, disclosure and export text agree at exactly 3,921", () => {
    expect(result.reasons).toEqual([]);
    const text = result.text!;
    expect([...text].length).toBe(VAUTO_TARGET);
    expect(text.endsWith(`${SYNTHETIC_CTA} ${SYNTHETIC_DISCLOSURE}`)).toBe(true);
    expect(text.split(SYNTHETIC_DISCLOSURE).length - 1).toBe(1);
    expect(classifyDisclosure(text)).toBe(price.basis);
    const body = text.slice(0, text.length - SYNTHETIC_DISCLOSURE.length);
    expect(body).not.toMatch(/\$/);
    expect(text).toContain(`Dealer Conveyance Fee: $${price.breakdown!.docFee}.`);
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
  it("does not pad a thin draft to reach the target", () => {
    const thin = buildVautoExport({ narrative: SYNTHETIC_FACTS.slice(0, 5).map((f) => f.sentence).join(" "), cta: SYNTHETIC_CTA, disclosure: approved(SYNTHETIC_DISCLOSURE), price });
    expect(thin.text).toBeNull();
    expect(codes(thin)).toContain("EXACT_LENGTH_UNREACHABLE");
  });
  it("blocks a price written into the description", () => {
    expect(codes(buildVautoExport({ narrative: `${SYNTHETIC_NARRATIVE} Now only $28,995.`, cta: SYNTHETIC_CTA, disclosure: approved(SYNTHETIC_DISCLOSURE), price }))).toContain("PRICE_IN_DESCRIPTION");
  });
  it("approval is enabled only when everything agrees", () => {
    expect(vautoApprovalGate({ exportResult: result, canApprove: true, hasVersion: true }).enabled).toBe(true);
    expect(vautoApprovalGate({ exportResult: result, canApprove: false, hasVersion: true }).enabled).toBe(false);
  });
});

describe("decideVautoExport: the server's decision", () => {
  const price = checkPriceDisclosure({ settings: SYNTHETIC_SETTINGS, row: SYNTHETIC_PRICE_ROW, disclosureText: PROPOSED_CT_DISCLOSURE_TEMPLATE, rules: CT });
  const text = buildVautoExport({ narrative: SYNTHETIC_NARRATIVE, cta: SYNTHETIC_CTA, disclosure: approved(price.renderedDisclosure), price }).text!;
  const evidence = { factSnapshot: true, openBlockingExceptions: 0, openBlockingFindings: 0, potentiallyStale: false };
  const input = { content: text, cta: SYNTHETIC_CTA, settings: SYNTHETIC_SETTINGS, row: SYNTHETIC_PRICE_ROW, observed: 28995,
    disclosure: SYNTHETIC_APPROVED_DISCLOSURE, rules: CT, evidence, authorized: true };

  it("passes only with simulated counsel approval, evidence and authority", () => {
    const d = decideVautoExport(input);
    expect(d.reasons).toEqual([]);
    expect(d.ok).toBe(true);
    expect(d.counts.total).toBe(VAUTO_TARGET);
  });
  it.each([
    ["the disclosure is still pending legal review", { disclosure: SYNTHETIC_PENDING_DISCLOSURE }, "DISCLOSURE_NOT_APPROVED"],
    ["the caller is not authorized", { authorized: false }, "NOT_AUTHORIZED"],
    ["no evidence snapshot exists", { evidence: { ...evidence, factSnapshot: false } }, "EVIDENCE_MISSING"],
    ["a blocking exception is open", { evidence: { ...evidence, openBlockingExceptions: 1 } }, "EVIDENCE_EXCEPTIONS_OPEN"],
    ["the description is stale", { evidence: { ...evidence, potentiallyStale: true } }, "DESCRIPTION_STALE"],
    ["the stored price split is wrong", { row: { ...SYNTHETIC_PRICE_ROW, advertisedBeforeDoc: 28000 } }, "PRICE_SPLIT_MISMATCH"],
    ["the text is one character short", { content: text.replace("The interior is black cloth. ", "The interior is black cloth.") }, "EXACT_LENGTH_MISMATCH"],
    ["the stored fee changed after the export was built", { row: { ...SYNTHETIC_PRICE_ROW, docFee: 599, advertisedBeforeDoc: 28396 } }, "DISCLOSURE_PLACEMENT"],
  ])("refuses when %s", (_label, patch, code) => {
    const d = decideVautoExport({ ...input, ...(patch as object) });
    expect(d.ok).toBe(false);
    expect(d.reasons.map((r) => r.code)).toContain(code);
  });
});

describe("evaluateVautoText", () => {
  const price = checkPriceDisclosure({ settings: SYNTHETIC_SETTINGS, row: SYNTHETIC_PRICE_ROW, disclosureText: PROPOSED_CT_DISCLOSURE_TEMPLATE, rules: CT });
  const built = buildVautoExport({ narrative: SYNTHETIC_NARRATIVE, cta: SYNTHETIC_CTA, disclosure: approved(SYNTHETIC_DISCLOSURE), price });
  it("passes the exported text unchanged", () => {
    const r = evaluateVautoText({ text: built.text!, cta: SYNTHETIC_CTA, disclosure: approved(SYNTHETIC_DISCLOSURE), price });
    expect(r.reasons).toEqual([]);
  });
  it("blocks an altered disclosure", () => {
    const r = evaluateVautoText({ text: built.text!.replace("are excluded", "are extra!!"), cta: SYNTHETIC_CTA, disclosure: approved(SYNTHETIC_DISCLOSURE), price });
    expect(codes(r)).toContain("DISCLOSURE_PLACEMENT");
  });
});

describe("compareRoundTrip", () => {
  const exported = `Hello there. ${SYNTHETIC_DISCLOSURE}`;
  it("reports an identical round trip", () => {
    const r = compareRoundTrip(exported, exported, SYNTHETIC_DISCLOSURE);
    expect(r).toMatchObject({ identical: true, disclosureIntact: true, appendedSuffix: null, truncatedAt: null });
  });
  it("finds a vendor footer, a truncation and punctuation rewrites", () => {
    expect(compareRoundTrip(exported, `${exported} Powered by Vendor.`, SYNTHETIC_DISCLOSURE).appendedSuffix).toBe(" Powered by Vendor.");
    const cut = compareRoundTrip(exported, exported.slice(0, 40), SYNTHETIC_DISCLOSURE);
    expect(cut.truncatedAt).toBe(40);
    expect(cut.disclosureIntact).toBe(false);
    expect(compareRoundTrip("It's here.", "It’s here.", "").punctuationChanges).toContain("straight apostrophes became curly quotes");
  });
});

describe("segmentCounts and destination profiles", () => {
  it("splits a pasted text into narrative, CTA, disclosure and separators", () => {
    const c = segmentCounts(`Hello there. Call us. ${SYNTHETIC_DISCLOSURE}`, "Call us.", SYNTHETIC_DISCLOSURE);
    expect(c).toMatchObject({ narrative: 12, cta: 8, disclosure: SYNTHETIC_DISCLOSURE.length, separators: 2, disclosureAtEnd: true });
  });
  it("lists vAuto as an exact 3,921 export under an unverified 4,000 cap", () => {
    const [v] = destinationProfiles(["vauto"]);
    expect(v).toMatchObject({ exactTotal: 3921, characterLimit: 4000, limitVerified: false });
  });
});
