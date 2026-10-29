// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildEvidenceRecords, canonical } from "../../../../supabase/proposed/crawl-fee-treatment/priceEvidence";
import { readPriceStack } from "../../../../supabase/proposed/crawl-fee-treatment/priceStack";
import { DEALER_LABEL, TARGET_VIN, stack, vdpPage, type Row } from "./fixtures/priceStackPages";

const ROWS: Row[] = [
  ["MSRP", "$100,000"], ["Dealer Discount", "-$3,000"], [DEALER_LABEL, "$97,000"],
  ["Retail Cash", "-$10,000"], ["Conveyance Fee", "+$895"], ["Your Price", "$87,895"],
];
const URL = `https://dealer.example.test/viewdetails/new/${TARGET_VIN.toLowerCase()}/2027-suv`;
const CFG = { dealerPriceLabels: [DEALER_LABEL], finalPriceLabels: ["Your Price"], configuredFee: 895, observedAt: new Date("2026-10-29T12:00:00Z"), pageUrl: URL };
const CTX = { tenantId: "b0000000-0000-4000-8000-0000000000e1", vin: TARGET_VIN, sourceUrl: URL, capturedAt: "2026-10-29T12:00:00Z", screenshotSha256: null };

const records = async (rows: Row[]) => {
  const html = vdpPage(stack(rows), "All prices exclude tax, title, registration and conveyance fee.");
  return buildEvidenceRecords(html, readPriceStack(html, TARGET_VIN, CFG), CTX);
};

describe("immutable price-component evidence (proposed)", () => {
  it("one record per line, per disclaimer, and a summary", async () => {
    const r = await records(ROWS);
    expect(r.map((x) => x.component_role)).toEqual(["msrp", "discount", "dealer_price", "incentive", "fee", "final_price", "disclaimer_page", "stack_summary"]);
    expect(r.every((x) => /^[0-9a-f]{64}$/.test(x.record_sha256) && /^[0-9a-f]{64}$/.test(x.page_sha256))).toBe(true);
    expect(new Set(r.map((x) => x.widget_sha256)).size).toBe(1);
  });

  it("each incentive record carries its own eligibility, terms and dates", async () => {
    const inc = (await records(ROWS)).find((x) => x.component_role === "incentive");
    expect(inc).toMatchObject({ label: "Retail Cash", amount: 10000, printed_sign: -1, details: { eligibility: "unknown", restrictions: [], expiration_date: null } });
  });

  it("the same reading hashes the same; a changed figure is a different record", async () => {
    const a = await records(ROWS);
    const b = await records(ROWS);
    expect(a.map((x) => x.record_sha256)).toEqual(b.map((x) => x.record_sha256));
    const changed = ROWS.map(([l, v]) => [l, l === "Retail Cash" ? "-$9,000" : l === "Your Price" ? "$88,895" : v] as Row);
    const c = await records(changed);
    expect(c.find((x) => x.component_role === "incentive")!.record_sha256).not.toBe(a.find((x) => x.component_role === "incentive")!.record_sha256);
  });

  it("key order never changes the canonical form", () => {
    expect(canonical({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe(canonical({ a: [2, { c: 4, d: 3 }], b: 1 }));
  });
});
