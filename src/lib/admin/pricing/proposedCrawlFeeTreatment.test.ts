import { describe, expect, it } from "vitest";
import {
  breakdownFor,
  conditionFromUrl,
  decideFeeTreatment,
  disclosureEvidence,
  type DealerFeeSettings,
  type PageFeeInput,
} from "../../../../supabase/functions/_shared/feeTreatment";

const NEW_URL = "https://www.example-dealer.test/viewdetails/new/5n1test0000000001/2027-suv";
const USED_URL = "https://www.example-dealer.test/viewdetails/used/1hgtest0000000002/2019-sedan";
const CPO_URL = "https://www.example-dealer.test/viewdetails/cpo/3pctest0000000003/2023-suv";

const TENANT_WIDE: DealerFeeSettings = { doc_fee_enabled: true, doc_fee_amount: 895, advertised_includes_doc_fee: true };
const BY_CONDITION: DealerFeeSettings = {
  ...TENANT_WIDE,
  advertised_includes_doc_fee_by_condition: { new: false, used: true, cpo: true },
};

const page = (over: Partial<PageFeeInput>): PageFeeInput => ({
  url: NEW_URL,
  text: "",
  extractedPrice: 60000,
  matchedLabel: "Selling Price",
  listingCondition: "new",
  settings: TENANT_WIDE,
  feed: null,
  ...over,
});

describe("per-page fee treatment (proposed, not deployed)", () => {
  it("a new-vehicle price stack with a fee line and a labelled total decides before-fee", () => {
    const d = decideFeeTreatment(page({
      text: "MSRP $62,000 Dealer Discount $2,000 Selling Price $60,000 Conveyance Fee $895 Total Price $60,895",
      settings: BY_CONDITION,
    }));
    expect(d.status).toBe("decided");
    expect(d.status === "decided" && d.treatment).toBe("excludes_fee");
    expect(breakdownFor(d, 60000, 895)).toEqual({ advertised_price_before_doc: 60000, doc_fee: 895, website_sale_price: 60895 });
  });

  it("a used page disclosure that the price includes the fee decides fee-inclusive", () => {
    const d = decideFeeTreatment(page({
      url: USED_URL, listingCondition: "used", extractedPrice: 29353, settings: BY_CONDITION,
      text: "Selling Price $29,353. Price includes $895 conveyance fee. Excludes tax, title and registration.",
    }));
    expect(d.status === "decided" && d.treatment).toBe("includes_fee");
    expect(breakdownFor(d, 29353, 895)).toEqual({ advertised_price_before_doc: 28458, doc_fee: 895, website_sale_price: 29353 });
  });

  it("page wording that contradicts the tenant-wide setting is left unresolved, never corrected", () => {
    const d = decideFeeTreatment(page({ text: "Selling Price $60,000 plus $895 dealer conveyance fee, tax and registration." }));
    expect(d).toMatchObject({ status: "unresolved", reason: "contradictory" });
    expect(breakdownFor(d, 60000, 895)).toBeNull();
  });

  it("the same page decides once the dealer declares the new-vehicle treatment", () => {
    const d = decideFeeTreatment(page({ settings: BY_CONDITION, text: "Selling Price $60,000 plus $895 dealer conveyance fee, tax and registration." }));
    expect(d.status === "decided" && d.treatment).toBe("excludes_fee");
  });

  it("the tenant-wide setting alone never decides (the class A defect)", () => {
    expect(decideFeeTreatment(page({ text: "Selling Price $60,000" }))).toMatchObject({ status: "unresolved", reason: "no_evidence" });
  });

  it("a condition-specific setting needs a corroborating item", () => {
    expect(decideFeeTreatment(page({ settings: BY_CONDITION, text: "Selling Price $60,000" })))
      .toMatchObject({ status: "unresolved", reason: "insufficient_evidence" });
  });

  it("a condition-specific setting plus the feed's own basis for the identical figure decides", () => {
    const d = decideFeeTreatment(page({
      url: USED_URL, listingCondition: "used", extractedPrice: 22876, settings: BY_CONDITION,
      text: "Selling Price $22,876", feed: { price: 22876, includesFees: true },
    }));
    expect(d.status === "decided" && d.treatment).toBe("includes_fee");
  });

  it("a figure that equals the feed price minus the fee is not evidence of anything", () => {
    const d = decideFeeTreatment(page({ extractedPrice: 60000, text: "Selling Price $60,000", feed: { price: 60895, includesFees: true } }));
    expect(d).toMatchObject({ status: "unresolved", reason: "no_evidence" });
    expect(d.evidence.filter((e) => e.kind === "source_basis")).toHaveLength(0);
  });

  it("a page address and listing condition that disagree leave the page unresolved", () => {
    expect(decideFeeTreatment(page({ listingCondition: "used", settings: BY_CONDITION })))
      .toMatchObject({ status: "unresolved", reason: "condition_conflict" });
  });

  it("an unknown condition is unresolved", () => {
    expect(decideFeeTreatment(page({ url: "https://www.example-dealer.test/vehicle/12345", listingCondition: null })))
      .toMatchObject({ status: "unresolved", reason: "condition_unknown" });
  });

  it("no configured fee means nothing to place", () => {
    expect(decideFeeTreatment(page({ settings: { doc_fee_enabled: false, advertised_includes_doc_fee: true } })))
      .toMatchObject({ status: "unresolved", reason: "no_fee_configured" });
  });

  it("two disclosures that disagree are contradictory even with a declared setting", () => {
    const d = decideFeeTreatment(page({
      settings: BY_CONDITION,
      text: "Price includes the documentation fee. Selling price $60,000 plus $895 doc fee.",
    }));
    expect(d).toMatchObject({ status: "unresolved", reason: "contradictory" });
  });

  it("a fee line for a different amount is not the document fee", () => {
    const d = decideFeeTreatment(page({ settings: BY_CONDITION, text: "Selling Price $60,000 Processing Fee $499 Total Price $60,499" }));
    expect(d.evidence.filter((e) => e.kind === "price_stack")).toHaveLength(0);
    expect(d).toMatchObject({ status: "unresolved", reason: "insufficient_evidence" });
  });

  it("a price label corroborates a declared setting", () => {
    const d = decideFeeTreatment(page({ url: CPO_URL, listingCondition: "cpo", settings: BY_CONDITION, matchedLabel: "Price incl. fees", text: "" }));
    expect(d.status === "decided" && d.treatment).toBe("includes_fee");
  });
});

describe("disclosure wording", () => {
  it("an inclusion clause followed by an exclusion of the fee reads as exclusion only", () => {
    const ev = disclosureEvidence("Price includes all rebates and incentives, excludes tax, title and dealer conveyance fee.");
    expect(ev.map((e) => e.says)).toEqual(["excludes_fee"]);
  });

  it("'does not include' is an exclusion", () => {
    expect(disclosureEvidence("Advertised price does not include the $895 documentation fee.").map((e) => e.says)).toEqual(["excludes_fee"]);
  });

  it("'fee is extra' is an exclusion and 'fee included' an inclusion", () => {
    expect(disclosureEvidence("Doc fee is extra.").map((e) => e.says)).toEqual(["excludes_fee"]);
    expect(disclosureEvidence("Conveyance fee included.").map((e) => e.says)).toEqual(["includes_fee"]);
  });

  it("a discount that mentions the dealer is not a fee", () => {
    expect(disclosureEvidence("Includes dealer discount of $1,500.")).toEqual([]);
  });
});

describe("page condition from the address", () => {
  it.each([
    [NEW_URL, "new"],
    [USED_URL, "used"],
    [CPO_URL, "cpo"],
    ["https://www.example-dealer.test/certified-pre-owned/x", "cpo"],
    ["https://www.example-dealer.test/inventory/12345", null],
  ])("%s -> %s", (url, want) => expect(conditionFromUrl(url)).toBe(want));
});
