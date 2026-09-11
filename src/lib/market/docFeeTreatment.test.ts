// ── Harte's price truth, as executable policy ──────────────────────────────
//
// Ken's decision, 2026-09-11: the advertised website sale price INCLUDES the
// mandatory $895 documentation fee. The fee may be itemized for transparency;
// it may never be added on top. There is no mandatory dealer add-on beyond the
// advertised price.
//
//   $43,876  customer-advertised price, and the customer's total
//   $  895   documentation fee, itemized INSIDE that number
//   $42,981  internal fee-exclusive comparison basis, never shown as a price
//   $44,771  the number that must never exist
//
// FTC guidance requires an advertised vehicle price to contain every mandatory
// fee the consumer must pay, which is why the includes form is canonical
// rather than merely conventional.
// https://www.ftc.gov/news-events/news/press-releases/2026/03/ftc-warns-97-auto-dealership-groups-about-deceptive-pricing

import { describe, it, expect } from "vitest";
import {
  parseConfiguredBoolean, resolveDocFeeTreatment, resolvePriceBasis,
  splitAdvertisedPrice, isDoubleCountedTotal, isInternalComparisonPrice,
  DOC_FEE_INCLUDES_SETTING, DOC_FEE_EXCLUDES_SETTING,
} from "./priceBasis.ts";

const ADVERTISED = 43_876;
const DOC_FEE = 895;
const COMPARISON = 42_981;
const DOUBLE_COUNTED = 44_771;

/** The QX50 as the row actually holds it, with Ken's verified add-on answer. */
const harteQX50 = (overrides: Record<string, unknown> = {}) => ({
  price: ADVERTISED,
  advertisedPriceBeforeDoc: COMPARISON,
  websiteSalePrice: ADVERTISED,
  docFee: DOC_FEE,
  // Verified $0: no mandatory dealer add-on beyond the advertised price.
  // Zero is an ANSWER, and placement of zero cannot move a total.
  tenantMandatoryAddOns: { amountUsd: 0, verified: true, includedInDisplayedPrice: true },
  ...overrides,
});

describe("parseConfiguredBoolean", () => {
  it("accepts both spellings of each answer", () => {
    for (const yes of [true, "true", "TRUE", " True ", "  true"]) {
      expect(parseConfiguredBoolean(yes), String(yes)).toBe(true);
    }
    for (const no of [false, "false", "FALSE", " False ", "  false"]) {
      expect(parseConfiguredBoolean(no), String(no)).toBe(false);
    }
  });

  it("treats everything else as unknown, never as a default", () => {
    // "false" is a truthy string, 0 is falsy, "yes" is neither — every one of
    // these has produced a real bug somewhere in this codebase.
    const junk = [null, undefined, 0, 1, -1, NaN, "", " ", "yes", "no", "y", "n",
      "1", "0", "t", "f", "TRUEISH", [], ["true"], {}, { value: true }];
    for (const v of junk) expect(parseConfiguredBoolean(v), JSON.stringify(v)).toBeNull();
  });
});

describe("resolveDocFeeTreatment", () => {
  it("reads Harte's stored string as the canonical includes answer", () => {
    const t = resolveDocFeeTreatment({ [DOC_FEE_INCLUDES_SETTING]: "true" });
    expect(t.advertisedIncludesDocFee).toBe(true);
    expect(t.source).toBe("includes_setting");
    expect(t.conflict).toBe(false);
  });

  it("derives the excludes representation as the explicit inverse", () => {
    // Ken's rule 10: derive, never read a second stored key and hope.
    expect(resolveDocFeeTreatment({ [DOC_FEE_INCLUDES_SETTING]: true }).advertisedExcludesDocFee)
      .toBe(false);
    expect(resolveDocFeeTreatment({ [DOC_FEE_INCLUDES_SETTING]: false }).advertisedExcludesDocFee)
      .toBe(true);
  });

  it("normalizes boolean and string identically in both directions", () => {
    for (const [a, b] of [[true, "true"], [false, "false"]] as const) {
      const asBool = resolveDocFeeTreatment({ [DOC_FEE_INCLUDES_SETTING]: a });
      const asText = resolveDocFeeTreatment({ [DOC_FEE_INCLUDES_SETTING]: b });
      expect(asText.advertisedIncludesDocFee).toBe(asBool.advertisedIncludesDocFee);
      expect(asText.advertisedExcludesDocFee).toBe(asBool.advertisedExcludesDocFee);
      expect(asText.source).toBe(asBool.source);
    }
  });

  it("honours the legacy excludes key only when it genuinely exists", () => {
    const legacy = resolveDocFeeTreatment({ [DOC_FEE_EXCLUDES_SETTING]: false });
    expect(legacy.source).toBe("excludes_setting");
    expect(legacy.advertisedIncludesDocFee).toBe(true);

    // An ABSENT key is not a configured false. `?? null` cannot tell these
    // apart, which is the whole reason the resolver checks for the key.
    expect(resolveDocFeeTreatment({ dealer_zip: "06120" }).source).toBe("unknown");
  });

  it("accepts both keys when they agree", () => {
    const t = resolveDocFeeTreatment({
      [DOC_FEE_INCLUDES_SETTING]: "true", [DOC_FEE_EXCLUDES_SETTING]: false,
    });
    expect(t.source).toBe("both_settings_agree");
    expect(t.advertisedIncludesDocFee).toBe(true);
    expect(t.conflict).toBe(false);
  });

  it("returns ambiguous when the two keys contradict each other", () => {
    for (const pair of [
      { [DOC_FEE_INCLUDES_SETTING]: true, [DOC_FEE_EXCLUDES_SETTING]: true },
      { [DOC_FEE_INCLUDES_SETTING]: "false", [DOC_FEE_EXCLUDES_SETTING]: "false" },
    ]) {
      const t = resolveDocFeeTreatment(pair);
      expect(t.conflict, JSON.stringify(pair)).toBe(true);
      expect(t.source).toBe("conflict");
      expect(t.advertisedIncludesDocFee).toBeNull();
      expect(t.advertisedExcludesDocFee).toBeNull();
      expect(t.reasons).toContain("doc_fee_treatment_conflict");
    }
  });

  it("keeps a malformed value unknown and says so", () => {
    const t = resolveDocFeeTreatment({ [DOC_FEE_INCLUDES_SETTING]: 1 });
    expect(t.advertisedIncludesDocFee).toBeNull();
    expect(t.source).toBe("unknown");
    expect(t.reasons).toContain(`${DOC_FEE_INCLUDES_SETTING}_unreadable`);
  });

  it("falls through to the readable key when the preferred one is malformed", () => {
    const t = resolveDocFeeTreatment({
      [DOC_FEE_INCLUDES_SETTING]: "yes", [DOC_FEE_EXCLUDES_SETTING]: "false",
    });
    expect(t.source).toBe("excludes_setting");
    expect(t.advertisedIncludesDocFee).toBe(true);
    expect(t.reasons).toContain(`${DOC_FEE_INCLUDES_SETTING}_unreadable`);
  });

  it("never defaults a missing or non-object configuration", () => {
    for (const s of [null, undefined, {}, [], "true", 42]) {
      const t = resolveDocFeeTreatment(s);
      expect(t.advertisedIncludesDocFee, JSON.stringify(s)).toBeNull();
      expect(t.advertisedExcludesDocFee).toBeNull();
      expect(t.conflict).toBe(false);
    }
  });
});

describe("the Harte QX50 price identity", () => {
  const treatment = resolveDocFeeTreatment({ [DOC_FEE_INCLUDES_SETTING]: "true" });
  const basis = resolvePriceBasis(
    harteQX50({ advertisedExcludesDocFee: treatment.advertisedExcludesDocFee }),
  );
  const split = splitAdvertisedPrice(basis);

  it("verifies the basis outright once the treatment is configured", () => {
    // Configured, not inferred: the inference reason must be absent.
    expect(basis.basisStatus).toBe("verified");
    expect(basis.advertisedIncludesDocFee).toBe(true);
    expect(basis.basisReasons).not.toContain("fee_treatment_inferred_from_stored_prices");
    expect(basis.basisReasons).not.toContain("fee_treatment_unknown");
  });

  it("keeps the customer-advertised price at $43,876", () => {
    expect(split.customerAdvertisedPrice).toBe(ADVERTISED);
    expect(split.advertisedPriceIncludingDealerFees).toBe(ADVERTISED);
    expect(basis.displayedTotalPrice).toBe(ADVERTISED);
  });

  it("does not claim $43,876 is a transaction total", () => {
    // Every DEALER fee is inside it; no government charge is. Sales tax, title
    // and registration all sit outside, so this is not a drive-out price and
    // must not be named as one.
    expect(split.excludesGovernmentCharges).toBe(true);
    expect(split.reasons).toContain("advertised_price_excludes_government_charges");
    expect(Object.keys(split)).not.toContain("customerTotalDue");
    expect(Object.keys(split)).not.toContain("totalDue");
    expect(Object.keys(split)).not.toContain("outTheDoorPrice");
  });

  it("itemizes the $895 fee INSIDE that price", () => {
    expect(split.documentationFeeInsideAdvertisedPrice).toBe(DOC_FEE);
    expect(split.reasons).toContain(`documentation_fee_itemized_inside_advertised_price_${DOC_FEE}`);
  });

  it("derives the internal comparison basis as 43,876 − 895 = 42,981", () => {
    expect(split.internalComparisonPrice).toBe(COMPARISON);
    expect(ADVERTISED - DOC_FEE).toBe(COMPARISON);
    expect(basis.vehicleComparisonPrice).toBe(COMPARISON);
  });

  it("resolves the mandatory add-on to a verified $0, not to unknown", () => {
    expect(basis.mandatoryDealerAddOns).toBe(0);
    expect(basis.mandatoryAddOnSource).toBe("tenant_default");
    expect(basis.basisReasons).not.toContain("mandatory_add_on_treatment_unknown");
    // $0 changes no total, so the customer owes the advertised price and
    // nothing else.
    expect(basis.totalWithMandatoryAddOns).toBe(ADVERTISED);
  });

  it("produces $44,771 nowhere", () => {
    const everyNumber = [
      basis.displayedTotalPrice, basis.vehicleComparisonPrice, basis.advertisedPriceBeforeDoc,
      basis.totalWithMandatoryAddOns, basis.docFee, basis.mandatoryDealerAddOns,
      split.customerAdvertisedPrice, split.advertisedPriceIncludingDealerFees,
      split.internalComparisonPrice, split.documentationFeeInsideAdvertisedPrice,
    ];
    for (const n of everyNumber) expect(n).not.toBe(DOUBLE_COUNTED);
    expect(isDoubleCountedTotal(split, DOUBLE_COUNTED)).toBe(true);
    expect(isDoubleCountedTotal(split, ADVERTISED)).toBe(false);
  });

  it("never lets the internal comparison price stand in for the advertised price", () => {
    expect(split.customerAdvertisedPrice).not.toBe(split.internalComparisonPrice);
    expect(isInternalComparisonPrice(split, COMPARISON)).toBe(true);
    expect(isInternalComparisonPrice(split, ADVERTISED)).toBe(false);
    // The gap between the two is exactly the fee, and nothing else.
    expect((split.customerAdvertisedPrice as number) - (split.internalComparisonPrice as number))
      .toBe(DOC_FEE);
  });

  it("reaches the same numbers from the string setting as from the boolean", () => {
    const fromBoolean = resolveDocFeeTreatment({ [DOC_FEE_INCLUDES_SETTING]: true });
    const b = resolvePriceBasis(
      harteQX50({ advertisedExcludesDocFee: fromBoolean.advertisedExcludesDocFee }),
    );
    expect(b.displayedTotalPrice).toBe(basis.displayedTotalPrice);
    expect(b.vehicleComparisonPrice).toBe(basis.vehicleComparisonPrice);
    expect(b.basisStatus).toBe(basis.basisStatus);
  });
});

describe("the polarity tamper guards", () => {
  it("carries the configured polarity into the basis rather than inferring it", () => {
    for (const [excludes, includes] of [[false, true], [true, false]] as const) {
      const b = resolvePriceBasis(harteQX50({ advertisedExcludesDocFee: excludes }));
      expect(b.advertisedIncludesDocFee, String(excludes)).toBe(includes);
      expect(b.provenance.advertised_excludes_doc_fee).toBe(excludes);
      expect(b.basisReasons).not.toContain("fee_treatment_inferred_from_stored_prices");
    }
  });

  it("records WHY the polarity error survived: on this row it changes nothing", () => {
    // Worth stating rather than assuming. Harte's listing carries BOTH the
    // fee-inclusive price (43,876) and the fee-exclusive advertised leg
    // (42,981), and 42,981 + 895 = 43,876 reconciles under either reading. So
    // the wrong key produced the right numbers here, which is exactly why four
    // gates passed over it. The defect is real; its blast radius is the rows
    // where the two columns do not both exist.
    const asIncludes = resolvePriceBasis(harteQX50({ advertisedExcludesDocFee: false }));
    const asExcludes = resolvePriceBasis(harteQX50({ advertisedExcludesDocFee: true }));
    expect(asExcludes.displayedTotalPrice).toBe(asIncludes.displayedTotalPrice);
    expect(asExcludes.vehicleComparisonPrice).toBe(asIncludes.vehicleComparisonPrice);
    expect(asIncludes.basisStatus).toBe("verified");
  });

  it("refuses to treat an excluded fee as itemized inside the advertised price", () => {
    // A dealer who genuinely advertises fee-exclusive: displayed = advertised
    // + fee is CORRECT for them, and the fee is outside, not inside. The split
    // must not report it as itemized within the advertised price, because that
    // is the claim that licenses subtracting it again later.
    const excludesDealer = resolvePriceBasis({
      price: null, advertisedPriceBeforeDoc: COMPARISON, websiteSalePrice: null,
      docFee: DOC_FEE, advertisedExcludesDocFee: true,
      tenantMandatoryAddOns: { amountUsd: 0, verified: true, includedInDisplayedPrice: true },
    });
    const split = splitAdvertisedPrice(excludesDealer);
    expect(split.documentationFeeInsideAdvertisedPrice).toBeNull();
    expect(split.reasons).toContain("documentation_fee_outside_advertised_price");
    // And still no second addition: the fee is counted once.
    expect(split.advertisedPriceIncludingDealerFees).toBe(split.customerAdvertisedPrice);
    expect(split.customerAdvertisedPrice).toBe(ADVERTISED);
  });

  it("an unknown treatment does not silently become an answer", () => {
    const unknown = resolvePriceBasis(harteQX50({
      advertisedExcludesDocFee: null, advertisedPriceBeforeDoc: null,
    }));
    expect(unknown.basisStatus).not.toBe("verified");
  });

  it("keeps the two prices in distinctly named fields", () => {
    const basis = resolvePriceBasis(harteQX50({ advertisedExcludesDocFee: false }));
    const split = splitAdvertisedPrice(basis);
    // A rename that collapsed these into one field would make this pass only
    // if the two values were equal, which for a fee-bearing tenant they are not.
    expect(Object.keys(split)).toContain("customerAdvertisedPrice");
    expect(Object.keys(split)).toContain("internalComparisonPrice");
    expect(split.customerAdvertisedPrice).not.toBe(split.internalComparisonPrice);
  });
});
