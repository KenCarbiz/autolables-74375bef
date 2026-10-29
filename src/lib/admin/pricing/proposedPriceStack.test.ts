import { describe, expect, it } from "vitest";
import {
  compareWithFeed,
  readPriceStack,
  stageOf,
  type PriceStackConfig,
} from "../../../../supabase/proposed/crawl-fee-treatment/priceStack";

// Synthetic look-alikes of the dealer pricing widgets reported on 2026-10-29:
// the same stages, labels and signs, with made-up VINs, stock numbers, dealer
// label and amounts.
const VIN_A = "5XTEST0000000A001";
const VIN_B = "5XTEST0000000B002";
const VIN_OTHER = "5XTEST0000000C003";

const CFG: PriceStackConfig = { dealerPriceLabels: ["Northgate Price"], finalPriceLabels: ["Your Price"], configuredFee: 895 };

const GENERIC_DISCLAIMER =
  `<footer><p>All prices exclude tax, title, registration and conveyance fee. Prices subject to change. See dealer for details.</p></footer>`;

const widget = (vin: string, rows: [string, string][], footnote = "") => `
  <section class="vehicle-pricing" data-vin="${vin}">
    <div class="stock">Stock #T${vin.slice(-4)}</div>
    <ul class="price-stack">
      ${rows.map(([l, v]) => `<li><span class="label">${l}</span> <span class="value">${v}</span></li>`).join("\n      ")}
    </ul>
    ${footnote ? `<p class="footnote">${footnote}</p>` : ""}
  </section>`;

// Stage stack with a manufacturer incentive (the QX80 shape).
const STACK_WITH_INCENTIVE: [string, string][] = [
  ["MSRP", "$100,000"],
  ["Dealer Discount", "-$3,000"],
  ["Northgate Price", "$97,000"],
  ["Retail Cash", "-$10,000"],
  ["Conveyance Fee", "+$895"],
  ["Your Price", "$87,895"],
];
// Stage stack with no incentive (the QX60 shape).
const STACK_NO_INCENTIVE: [string, string][] = [
  ["MSRP", "$60,000"],
  ["Dealer Discount", "-$1,897"],
  ["Northgate Price", "$58,103"],
  ["Conveyance Fee", "+$895"],
  ["Your Price", "$58,998"],
];
const SIMILAR_CARD = widget(VIN_OTHER, [["Northgate Price", "$50,000"], ["Conveyance Fee", "+$895"], ["Your Price", "$50,895"]]);

const page = (body: string, footer = GENERIC_DISCLAIMER) =>
  `<html><body><h1>2027 Example SUV</h1><div>VIN: ${VIN_A}</div>${body}<aside>${SIMILAR_CARD}</aside>${footer}</body></html>`;

describe("price-stack component model (proposed, not deployed)", () => {
  it("reads every stage of an incentive stack and names the customer total, before-fee basis and dealer price", () => {
    const r = readPriceStack(page(widget(VIN_A, STACK_WITH_INCENTIVE)), VIN_A, CFG);
    expect(r.status).toBe("reconciled");
    expect(r.customerTotal).toEqual({ amount: 87895, label: "Your Price" });
    expect(r.beforeFeeAfterIncentives).toBe(87000);
    expect(r.dealerPrice).toEqual({ amount: 97000, label: "Northgate Price" });
    expect(r.msrp).toBe(100000);
    expect(r.discounts).toEqual([{ label: "Dealer Discount", amount: 3000 }]);
    expect(r.fee).toEqual({ label: "Conveyance Fee", amount: 895, includedIn: "Your Price" });
    expect(r.proof).toEqual([
      "MSRP 100000 - discounts 3000 = Northgate Price 97000",
      "Northgate Price 97000 - incentives 10000 + fee 895 = Your Price 87895",
    ]);
  });

  it("never treats an incentive as available to everyone without eligibility evidence", () => {
    const r = readPriceStack(page(widget(VIN_A, STACK_WITH_INCENTIVE)), VIN_A, CFG);
    expect(r.incentives).toEqual([{ label: "Retail Cash", amount: 10000, eligibility: "unknown", eligibilityEvidence: null }]);
    expect(r.flags).toContain("incentive_eligibility_unverified");
    expect(r.writable).toBe(false);
  });

  it("keeps the generic disclaimer apart and flags it when it contradicts the itemised fee", () => {
    const r = readPriceStack(page(widget(VIN_A, STACK_NO_INCENTIVE)), VIN_A, CFG);
    expect(r.status).toBe("reconciled");
    expect(r.disclaimers.filter((d) => d.scope === "page").map((d) => d.says)).toContain("fee_excluded");
    expect(r.disclaimers.filter((d) => d.scope === "widget")).toEqual([]);
    expect(r.flags).toEqual(["disclaimer_contradicts_widget_fee"]);
    expect(r.writable).toBe(false);
  });

  it("a stack with no incentive and no contradicting disclaimer is writable", () => {
    const r = readPriceStack(page(widget(VIN_A, STACK_NO_INCENTIVE), "<footer><p>Prices subject to change.</p></footer>"), VIN_A, CFG);
    expect(r).toMatchObject({ status: "reconciled", writable: true, flags: [], beforeFeeAfterIncentives: 58103 });
  });

  it("an incentive whose footnote requires captive financing is conditional", () => {
    const rows: [string, string][] = [
      ["MSRP", "$60,000"], ["Dealer Discount", "-$1,000"], ["Northgate Price", "$59,000"],
      ["Bonus Cash", "-$2,000"], ["Conveyance Fee", "+$895"], ["Your Price", "$57,895"],
    ];
    const r = readPriceStack(page(widget(VIN_A, rows, "Bonus Cash requires financing through the captive lender with approved credit.")), VIN_A, CFG);
    expect(r.incentives[0]).toMatchObject({ eligibility: "conditional" });
    expect(r.flags).toContain("incentive_conditional");
    expect(r.writable).toBe(false);
  });

  it("an incentive the widget states is available to all buyers is recorded as such", () => {
    const r = readPriceStack(
      page(widget(VIN_A, STACK_WITH_INCENTIVE, "Retail Cash is available to all buyers."), "<footer><p>Prices subject to change.</p></footer>"),
      VIN_A, CFG);
    expect(r.incentives[0]).toMatchObject({ eligibility: "stated_unconditional" });
    expect(r.writable).toBe(true);
  });

  it("a widget footnote that excludes the fee contradicts its own itemised fee", () => {
    const r = readPriceStack(page(widget(VIN_A, STACK_NO_INCENTIVE, "Price excludes the conveyance fee.")), VIN_A, CFG);
    expect(r.flags).toContain("widget_disclaimer_contradicts_widget_fee");
  });

  it("a stack whose arithmetic does not close is unreconciled and writes nothing", () => {
    const rows = STACK_WITH_INCENTIVE.map(([l, v]) => [l, l === "Your Price" ? "$88,395" : v] as [string, string]);
    const r = readPriceStack(page(widget(VIN_A, rows)), VIN_A, CFG);
    expect(r).toMatchObject({ status: "unreconciled", writable: false, customerTotal: null });
  });

  it("an unrecognised line leaves the stack unresolved", () => {
    const rows: [string, string][] = [["Northgate Price", "$58,103"], ["Market Adjustment", "+$2,000"], ["Conveyance Fee", "+$895"], ["Your Price", "$60,998"]];
    expect(readPriceStack(page(widget(VIN_A, rows)), VIN_A, CFG)).toMatchObject({ status: "unknown_line" });
  });

  it("the dealer's own price label is unknown until configured", () => {
    const r = readPriceStack(page(widget(VIN_A, STACK_NO_INCENTIVE)), VIN_A, { configuredFee: 895 });
    expect(r).toMatchObject({ status: "unknown_line" });
  });

  it("a fee line for a different amount is not the configured document fee", () => {
    const rows = STACK_NO_INCENTIVE.map(([l, v]) => [l, l === "Conveyance Fee" ? "+$499" : l === "Your Price" ? "$58,602" : v] as [string, string]);
    expect(readPriceStack(page(widget(VIN_A, rows)), VIN_A, CFG)).toMatchObject({ status: "fee_amount_mismatch" });
  });

  it("a page with only a single labelled price has no customer total", () => {
    const r = readPriceStack(page(widget(VIN_A, [["Selling Price", "$24,500"]])), VIN_A, CFG);
    expect(r).toMatchObject({ status: "missing_final_price", writable: false });
  });

  it("evidence is scoped to the VIN: another vehicle's card is never read", () => {
    const r = readPriceStack(page(widget(VIN_A, STACK_WITH_INCENTIVE)), VIN_A, CFG);
    expect(r.lines.map((l) => l.amount)).not.toContain(50000);
    expect(readPriceStack(page(widget(VIN_A, STACK_WITH_INCENTIVE)), VIN_OTHER, CFG).customerTotal).toEqual({ amount: 50895, label: "Your Price" });
  });

  it("a VIN that is not on the page is not read", () => {
    expect(readPriceStack(page(widget(VIN_A, STACK_NO_INCENTIVE)), VIN_B, CFG)).toMatchObject({ status: "vin_not_found" });
  });

  it("two stacks with totals in the same vehicle's region are ambiguous", () => {
    const html = page(widget(VIN_A, STACK_NO_INCENTIVE) + `<div>Lease special</div><p>Terms vary by model and are set by the lender each month for this offer.</p><p>Monthly offers change often and may not apply to this exact vehicle.</p><p>Visit the store for the latest details.</p><ul><li>Northgate Price $58,103</li><li>Your Price $57,103</li></ul>`);
    expect(readPriceStack(html, VIN_A, CFG)).toMatchObject({ status: "ambiguous_vin_scope" });
  });

  it("label and amount in separate blocks still read as one line", () => {
    const html = `<html><body><div>${VIN_A}</div>
      <div class="row"><div class="k">MSRP</div><div class="v">$60,000</div></div>
      <div class="row"><div class="k">Dealer Discount</div><div class="v">-$1,897</div></div>
      <div class="row"><div class="k">Northgate Price</div><div class="v">$58,103</div></div>
      <div class="row"><div class="k">Conveyance Fee</div><div class="v">+$895</div></div>
      <div class="row"><div class="k">Your Price</div><div class="v">$58,998</div></div></body></html>`;
    expect(readPriceStack(html, VIN_A, CFG)).toMatchObject({ status: "reconciled", customerTotal: { amount: 58998 } });
  });

  it("a fee printed below the total, not between the dealer price and the total, is not placed", () => {
    const rows: [string, string][] = [["Northgate Price", "$58,103"], ["Your Price", "$58,998"], ["Conveyance Fee", "+$895"]];
    expect(readPriceStack(page(widget(VIN_A, rows)), VIN_A, CFG)).toMatchObject({ status: "unreconciled" });
  });
});

describe("what a stored figure is, and comparison with the feed", () => {
  const r = readPriceStack(page(widget(VIN_A, STACK_WITH_INCENTIVE)), VIN_A, CFG);
  const day = (d: string) => new Date(`${d}T12:00:00Z`);

  it("names the stage a stored figure came from", () => {
    expect(stageOf(r, 97000)).toBe("dealer price before incentives and fee (Northgate Price)");
    expect(stageOf(r, 87895)).toBe("customer total (Your Price)");
    expect(stageOf(r, 87000)).toBe("after incentives, before fee");
    expect(stageOf(r, 12345)).toBeNull();
  });

  it("a feed carrying the customer total against a stored dealer-price figure is pre- versus post-incentive, not a discrepancy", () => {
    expect(compareWithFeed(r, day("2026-10-27"), { total: 87895, at: day("2026-10-27") }, 97000).result).toBe("pre_vs_post_incentive");
  });

  it("a feed that differs from the same-day customer total is a genuine difference", () => {
    expect(compareWithFeed(r, day("2026-10-27"), { total: 85895, at: day("2026-10-26") }, 97000).result).toBe("genuine_difference");
  });

  it("observations weeks apart are not compared", () => {
    expect(compareWithFeed(r, day("2026-10-27"), { total: 87895, at: day("2026-10-01") }, 97000).result).toBe("dates_not_comparable");
  });

  it("an unreconciled page is never compared", () => {
    const bad = readPriceStack(page(widget(VIN_A, [["Selling Price", "$24,500"]])), VIN_A, CFG);
    expect(compareWithFeed(bad, day("2026-10-27"), { total: 25395, at: day("2026-10-27") }, 24500).result).toBe("unresolved");
  });
});
