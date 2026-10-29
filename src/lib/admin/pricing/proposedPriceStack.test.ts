import { describe, expect, it } from "vitest";
import {
  compareWithFeed,
  publicPriceDecision,
  readPriceStack,
  stageOf,
  type PriceStackConfig,
} from "../../../../supabase/functions/_shared/priceStack";
import {
  DEALER_LABEL,
  OTHER_VIN,
  OTHER_VIN_2,
  SRP_VIN_BELOW_PRICE,
  TARGET_VIN,
  cpoPage,
  duplicateWidgetsPage,
  stack,
  usedPageSinglePrice,
  usedPageWithFee,
  vdpPage,
  type Row,
} from "./fixtures/priceStackPages";

// Synthetic look-alikes of the dealer stacks reported on 2026-10-29 (made-up
// VINs, labels and amounts) inside page structures modelled on common dealer
// platform markup. Captured, sanitised pages replace these once the dealer
// domain is reachable from the test environment (see readiness gate G2).

const OBSERVED = new Date("2026-10-29T12:00:00Z");
const CFG: PriceStackConfig = {
  dealerPriceLabels: [DEALER_LABEL], finalPriceLabels: ["Your Price"], configuredFee: 895,
  observedAt: OBSERVED, pageUrl: `https://dealer.example.test/viewdetails/new/${TARGET_VIN.toLowerCase()}/2027-suv`,
};
const INCENTIVE_STACK: Row[] = [
  ["MSRP", "$100,000"], ["Dealer Discount", "-$3,000"], [DEALER_LABEL, "$97,000"],
  ["Retail Cash", "-$10,000"], ["Conveyance Fee", "+$895"], ["Your Price", "$87,895"],
];
const PLAIN_STACK: Row[] = [
  ["MSRP", "$60,000"], ["Dealer Discount", "-$1,897"], [DEALER_LABEL, "$58,103"], ["Conveyance Fee", "+$895"], ["Your Price", "$58,998"],
];
const FEE_EXCLUDED_FOOTER = "All prices exclude tax, title, registration and conveyance fee. See dealer for details.";
const NEUTRAL_FOOTER = "Prices subject to change.";

describe("component attribution, not text distance", () => {
  it("a detail page: the main widget is the page vehicle's; carousel cards are not read", () => {
    const r = readPriceStack(vdpPage(stack(INCENTIVE_STACK), NEUTRAL_FOOTER), TARGET_VIN, CFG);
    expect(r.status).toBe("reconciled");
    expect(r.advertisedTotal).toEqual({ amount: 87895, label: "Your Price" });
    expect(r.lines.map((l) => l.amount)).not.toContain(50000);
  });

  it("a carousel card on the same page is its own vehicle's", () => {
    const r = readPriceStack(vdpPage(stack(INCENTIVE_STACK), NEUTRAL_FOOTER), OTHER_VIN, { ...CFG, pageUrl: undefined });
    expect(r).toMatchObject({ status: "reconciled", advertisedTotal: { amount: 50895 } });
  });

  it("an inventory list that prints the VIN below the price attributes each stack to its own card", () => {
    // Text-distance scoping would hand the second card's stack to the first VIN.
    expect(readPriceStack(SRP_VIN_BELOW_PRICE, OTHER_VIN, { ...CFG, pageUrl: undefined })).toMatchObject({ status: "reconciled", advertisedTotal: { amount: 50895 } });
    expect(readPriceStack(SRP_VIN_BELOW_PRICE, OTHER_VIN_2, { ...CFG, pageUrl: undefined })).toMatchObject({ status: "reconciled", advertisedTotal: { amount: 40895 } });
  });

  it("identical mobile and desktop copies of one widget are one stack", () => {
    const r = readPriceStack(duplicateWidgetsPage(stack(PLAIN_STACK), stack(PLAIN_STACK)), TARGET_VIN, CFG);
    expect(r.status).toBe("reconciled");
    expect(r.flags).toContain("duplicate_widgets_consistent");
  });

  it("two differing widgets for the same VIN are ambiguous", () => {
    const other: Row[] = PLAIN_STACK.map(([l, v]) => [l, l === "Your Price" ? "$57,998" : v === "$58,103" ? "$57,103" : v === "-$1,897" ? "-$2,897" : v]);
    expect(readPriceStack(duplicateWidgetsPage(stack(PLAIN_STACK), stack(other)), TARGET_VIN, CFG)).toMatchObject({ status: "ambiguous_vin_scope" });
  });

  it("source evidence that is unavailable is never guessed", () => {
    expect(readPriceStack("", TARGET_VIN, { ...CFG, pageUrl: undefined })).toMatchObject({ status: "vin_not_found" });
    expect(readPriceStack(vdpPage("<div>Call for price</div>", NEUTRAL_FOOTER), TARGET_VIN, CFG)).toMatchObject({ status: "no_stack" });
  });
});

describe("new, used and CPO pages", () => {
  it("new: every stage named, with the arithmetic proof", () => {
    const r = readPriceStack(vdpPage(stack(INCENTIVE_STACK), NEUTRAL_FOOTER), TARGET_VIN, CFG);
    expect(r.msrp).toBe(100000);
    expect(r.discounts).toEqual([{ label: "Dealer Discount", amount: 3000 }]);
    expect(r.dealerPrice).toEqual({ amount: 97000, label: DEALER_LABEL });
    expect(r.fee).toEqual({ label: "Conveyance Fee", amount: 895, includedIn: "Your Price" });
    expect(r.proof).toEqual([
      `MSRP 100000 - discounts 3000 = ${DEALER_LABEL} 97000`,
      `${DEALER_LABEL} 97000 - incentives 10000 + fee 895 = Your Price 87895`,
    ]);
  });

  it("used: a single labelled price is not a stack", () => {
    expect(readPriceStack(usedPageSinglePrice, TARGET_VIN, CFG)).toMatchObject({ status: "no_stack" });
  });

  it("used: a price and a fee with no customer total has no total to place the fee in", () => {
    expect(readPriceStack(usedPageWithFee, TARGET_VIN, CFG)).toMatchObject({ status: "missing_final_price" });
  });

  it("CPO: a fee-only stack reconciles and, with nothing to hold, is writable", () => {
    const r = readPriceStack(cpoPage, TARGET_VIN, { ...CFG, pageUrl: undefined });
    expect(r).toMatchObject({ status: "reconciled", writable: true, generallyAvailableTotal: 42895, marketComparisonBasis: 42000 });
  });
});

describe("each incentive on its own evidence", () => {
  it("no evidence: eligibility unknown, held, never generally available", () => {
    const r = readPriceStack(vdpPage(stack(INCENTIVE_STACK), NEUTRAL_FOOTER), TARGET_VIN, CFG);
    expect(r.incentives).toHaveLength(1);
    expect(r.incentives[0]).toMatchObject({ name: "Retail Cash", amount: 10000, eligibility: "unknown", restrictions: [], expired: null });
    expect(r.flags).toContain("incentive_eligibility_unverified");
    expect(r.writable).toBe(false);
    expect(r.generallyAvailableTotal).toBe(97895);
    expect(r.marketComparisonBasis).toBe(97000);
  });

  it("a footnote marker binds terms to its offer only; the other offer gets none", () => {
    const rows: Row[] = [
      ["MSRP", "$60,000"], [DEALER_LABEL, "$60,000"], ["Retail Cash", "-$1,000"], ["Bonus Cash*", "-$2,000"],
      ["Conveyance Fee", "+$895"], ["Your Price", "$57,895"],
    ];
    const r = readPriceStack(vdpPage(stack(rows, "* Bonus Cash requires financing through the captive lender with approved credit. Expires 11/30/2026."), NEUTRAL_FOOTER), TARGET_VIN, CFG);
    const [retail, bonus] = r.incentives;
    expect(retail).toMatchObject({ name: "Retail Cash", eligibility: "unknown", restrictions: [] });
    expect(bonus).toMatchObject({ name: "Bonus Cash", eligibility: "conditional", expirationDate: "2026-11-30", expired: false });
    expect(bonus.restrictions).toEqual(expect.arrayContaining(["financing_required", "credit_approval"]));
    expect(r.flags).toEqual(expect.arrayContaining(["incentive_eligibility_unverified", "incentive_conditional"]));
  });

  it("a generic page statement never establishes eligibility", () => {
    const r = readPriceStack(vdpPage(stack(INCENTIVE_STACK), "All offers are available to all buyers. Prices subject to change."), TARGET_VIN, CFG);
    expect(r.incentives[0].eligibility).toBe("unknown");
  });

  it("the widget saying an offer is for everyone is recorded but not verified", () => {
    const r = readPriceStack(vdpPage(stack(INCENTIVE_STACK, "Retail Cash is available to all buyers."), NEUTRAL_FOOTER), TARGET_VIN, CFG);
    expect(r.incentives[0].eligibility).toBe("stated_general_unverified");
    expect(r.writable).toBe(false);
    expect(r.generallyAvailableTotal).toBe(97895);
  });

  it("only a verified program record makes an offer generally available", () => {
    const r = readPriceStack(vdpPage(stack(INCENTIVE_STACK), NEUTRAL_FOOTER), TARGET_VIN, {
      ...CFG, programRecords: [{ name: "Retail Cash", amount: 10000, generallyAvailable: true, expirationDate: "2026-11-30", source: "OEM program file (dealer-approved)" }],
    });
    expect(r.incentives[0]).toMatchObject({ eligibility: "verified_general", expired: false });
    expect(r.writable).toBe(true);
    expect(r.generallyAvailableTotal).toBe(87895);
  });

  it("an expired offer is flagged and never counted", () => {
    const r = readPriceStack(vdpPage(stack(INCENTIVE_STACK.map(([l, v]) => [l === "Retail Cash" ? "Retail Cash*" : l, v] as Row), "* Retail Cash offer ends 10/15/2026."), NEUTRAL_FOOTER), TARGET_VIN, {
      ...CFG, programRecords: [{ name: "Retail Cash", amount: 10000, generallyAvailable: true, expirationDate: "2026-10-15", source: "OEM program file" }],
    });
    expect(r.incentives[0]).toMatchObject({ expirationDate: "2026-10-15", expired: true });
    expect(r.flags).toContain("incentive_expired");
    expect(r.generallyAvailableTotal).toBe(97895);
  });

  it("offers that cannot be combined, applied together, are held", () => {
    const rows: Row[] = [
      ["MSRP", "$60,000"], [DEALER_LABEL, "$60,000"], ["Retail Cash", "-$1,000"], ["Loyalty Cash†", "-$1,500"],
      ["Conveyance Fee", "+$895"], ["Your Price", "$58,395"],
    ];
    const r = readPriceStack(vdpPage(stack(rows, "† Loyalty Cash for current owners; cannot be combined with Retail Cash."), NEUTRAL_FOOTER), TARGET_VIN, CFG);
    expect(r.incentives[1]).toMatchObject({ eligibility: "conditional", combinability: "exclusive" });
    expect(r.incentives[1].restrictions).toContain("loyalty");
    expect(r.flags).toContain("incentives_mutually_exclusive");
  });
});

describe("disclaimers: page-wide kept apart from the widget, contradictions flagged", () => {
  it("a page footer that excludes the fee contradicts an itemised total that includes it", () => {
    const r = readPriceStack(vdpPage(stack(PLAIN_STACK), FEE_EXCLUDED_FOOTER), TARGET_VIN, CFG);
    expect(r.status).toBe("reconciled");
    expect(r.disclaimers.find((d) => d.says === "fee_excluded")).toMatchObject({ scope: "page" });
    expect(r.disclaimers.filter((d) => d.scope === "widget")).toEqual([]);
    expect(r.flags).toEqual(["disclaimer_contradicts_widget_fee"]);
    expect(r.writable).toBe(false);
  });

  it("a widget footnote that excludes the fee contradicts its own stack", () => {
    const r = readPriceStack(vdpPage(stack(PLAIN_STACK, "Price excludes the conveyance fee."), NEUTRAL_FOOTER), TARGET_VIN, CFG);
    expect(r.flags).toContain("widget_disclaimer_contradicts_widget_fee");
  });

  it("with nothing to hold, the plain stack is writable", () => {
    expect(readPriceStack(vdpPage(stack(PLAIN_STACK), NEUTRAL_FOOTER), TARGET_VIN, CFG)).toMatchObject({ status: "reconciled", writable: true, flags: [] });
  });
});

describe("stacks that do not prove themselves", () => {
  it("arithmetic that does not close", () => {
    const rows = INCENTIVE_STACK.map(([l, v]) => [l, l === "Your Price" ? "$88,395" : v] as Row);
    expect(readPriceStack(vdpPage(stack(rows), NEUTRAL_FOOTER), TARGET_VIN, CFG)).toMatchObject({ status: "unreconciled", advertisedTotal: null });
  });
  it("an unrecognised line", () => {
    const rows: Row[] = [[DEALER_LABEL, "$58,103"], ["Market Adjustment", "+$2,000"], ["Conveyance Fee", "+$895"], ["Your Price", "$60,998"]];
    expect(readPriceStack(vdpPage(stack(rows), NEUTRAL_FOOTER), TARGET_VIN, CFG)).toMatchObject({ status: "unknown_line" });
  });
  it("the dealer's price label before it is configured", () => {
    expect(readPriceStack(vdpPage(stack(PLAIN_STACK), NEUTRAL_FOOTER), TARGET_VIN, { configuredFee: 895, pageUrl: CFG.pageUrl })).toMatchObject({ status: "unknown_line" });
  });
  it("a fee line for another amount", () => {
    const rows = PLAIN_STACK.map(([l, v]) => [l, l === "Conveyance Fee" ? "+$499" : l === "Your Price" ? "$58,602" : v] as Row);
    expect(readPriceStack(vdpPage(stack(rows), NEUTRAL_FOOTER), TARGET_VIN, CFG)).toMatchObject({ status: "fee_amount_mismatch" });
  });
  it("a fee printed below the total", () => {
    const rows: Row[] = [[DEALER_LABEL, "$58,103"], ["Your Price", "$58,998"], ["Conveyance Fee", "+$895"]];
    expect(readPriceStack(vdpPage(stack(rows), NEUTRAL_FOOTER), TARGET_VIN, CFG)).toMatchObject({ status: "unreconciled" });
  });
});

describe("public price policy", () => {
  it("unknown eligibility: the primary price is the generally available all-in total; the offer is shown only separately", () => {
    const d = publicPriceDecision(readPriceStack(vdpPage(stack(INCENTIVE_STACK), FEE_EXCLUDED_FOOTER), TARGET_VIN, CFG));
    expect(d.publishable).toBe(false);
    expect(d.primary).toEqual({ amount: 97895, label: "Price", includesFee: true });
    expect(d.conditionalOffers).toEqual([{ name: "Retail Cash", amount: 10000, priceWithOffer: 87895, qualifications: ["eligibility not verified"], expires: null }]);
    expect(d.dealerAdvertisedTotal).toEqual({ amount: 87895, label: "Your Price" });
    expect(d.marketComparisonBasis).toBe(97000);
    expect(d.scoreConfidence).toBe("limited");
  });

  it("an unresolved page publishes nothing and supports no score", () => {
    const d = publicPriceDecision(readPriceStack(usedPageSinglePrice, TARGET_VIN, CFG));
    expect(d).toMatchObject({ publishable: false, primary: null, marketComparisonBasis: null, scoreConfidence: "none" });
  });

  it("a verified offer with nothing else held is published at the dealer's total with normal confidence", () => {
    const d = publicPriceDecision(readPriceStack(vdpPage(stack(INCENTIVE_STACK), NEUTRAL_FOOTER), TARGET_VIN, {
      ...CFG, programRecords: [{ name: "Retail Cash", amount: 10000, generallyAvailable: true, source: "OEM program file" }],
    }));
    expect(d).toMatchObject({ publishable: true, primary: { amount: 87895 }, dealerAdvertisedTotal: null, conditionalOffers: [], scoreConfidence: "normal" });
  });
});

describe("stored figures and the feed", () => {
  const r = readPriceStack(vdpPage(stack(INCENTIVE_STACK), NEUTRAL_FOOTER), TARGET_VIN, CFG);
  const day = (d: string) => new Date(`${d}T12:00:00Z`);
  it("names the stage of a stored figure", () => {
    expect(stageOf(r, 97000)).toBe(`dealer price before incentives and fee (${DEALER_LABEL})`);
    expect(stageOf(r, 87895)).toBe("advertised customer total (Your Price)");
    expect(stageOf(r, 87000)).toBe("after incentives, before fee");
    expect(stageOf(r, 12345)).toBeNull();
  });
  it("pre- versus post-incentive is not a discrepancy", () => {
    expect(compareWithFeed(r, day("2026-10-27"), { total: 87895, at: day("2026-10-27") }, 97000).result).toBe("pre_vs_post_incentive");
  });
  it("a same-window difference is genuine", () => {
    expect(compareWithFeed(r, day("2026-10-27"), { total: 85895, at: day("2026-10-26") }, 97000).result).toBe("genuine_difference");
  });
  it("observations weeks apart are not compared", () => {
    expect(compareWithFeed(r, day("2026-10-27"), { total: 87895, at: day("2026-10-01") }, 97000).result).toBe("dates_not_comparable");
  });
});

describe("sanitising a captured page keeps its structure and arithmetic", async () => {
  const { sanitizePage } = await import("../../../../supabase/proposed/crawl-fee-treatment/sanitizePage");
  const captured = vdpPage(stack(INCENTIVE_STACK), FEE_EXCLUDED_FOOTER).replace("Example Motors", "Real Dealer Motors");
  const { html, vinMap } = sanitizePage(captured, { replacements: [["Real Dealer Motors", "Example Motors"]], priceOffset: 7000 });
  const vin = vinMap[TARGET_VIN];

  it("no original VIN or dealer name survives", () => {
    expect(html).not.toContain(TARGET_VIN);
    expect(html.toLowerCase()).not.toContain(TARGET_VIN.toLowerCase());
    expect(html).not.toContain("Real Dealer Motors");
  });

  it("the stack still reconciles, stages shifted and adjustments kept", () => {
    const r = readPriceStack(html, vin, { ...CFG, pageUrl: `https://dealer.example.test/viewdetails/new/${vin.toLowerCase()}/2027-suv` });
    expect(r.status).toBe("reconciled");
    expect(r.advertisedTotal?.amount).toBe(94895);
    expect(r.dealerPrice?.amount).toBe(104000);
    expect(r.incentives[0].amount).toBe(10000);
    expect(r.fee?.amount).toBe(895);
    expect(r.flags).toContain("disclaimer_contradicts_widget_fee");
  });
});
