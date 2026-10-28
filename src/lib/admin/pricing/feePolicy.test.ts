import { describe, it, expect } from "vitest";
import {
  buildFeeImpact,
  describePriceBasis,
  effectiveFee,
  feeChangeDiff,
  feeDraftFromSettings,
  feeDraftWarnings,
  isFeeDraftEqual,
  jurisdictionLabel,
  rowNeedsUpdate,
  validateFeeDraft,
  type FeeImpactRow,
} from "./feePolicy";

const row = (over: Partial<FeeImpactRow> = {}): FeeImpactRow => ({
  vin: "EXAMPLEVIN0000001",
  year: 2024,
  make: "Example",
  model: "Crossover",
  trim: "Base",
  stock: "EX-1",
  archived: false,
  advertised_price_before_doc: 30_000,
  doc_fee: 895,
  website_sale_price: 30_895,
  price_parse_status: "ok",
  ...over,
});

describe("fee draft", () => {
  it("reads the settings keys and names the jurisdiction from reference data", () => {
    expect(feeDraftFromSettings({ doc_fee_enabled: true, doc_fee_amount: "895", doc_fee_state: "ct" })).toEqual({ enabled: true, amount: 895, stateCode: "CT" });
    expect(jurisdictionLabel("CT")).toBe("Connecticut");
    expect(jurisdictionLabel("")).toBe("Not set");
    expect(describePriceBasis("website_sale_price")).toMatch(/includes document fee/);
    expect(describePriceBasis("advertised_before_doc")).toMatch(/before document fee/);
  });

  it("validates amount and jurisdiction and keeps reference caps as warnings", () => {
    expect(validateFeeDraft({ enabled: true, amount: -1, stateCode: "CT" })).toEqual(["The fee cannot be negative."]);
    expect(validateFeeDraft({ enabled: true, amount: 895.555, stateCode: "CT" })).toEqual(["Use whole cents."]);
    expect(validateFeeDraft({ enabled: true, amount: 895, stateCode: "" })).toEqual(["Choose the jurisdiction the fee is charged in."]);
    expect(validateFeeDraft({ enabled: false, amount: 0, stateCode: "" })).toEqual([]);
    expect(feeDraftWarnings({ enabled: true, amount: 100, stateCode: "CA" })).toHaveLength(1);
    expect(feeDraftWarnings({ enabled: true, amount: 100, stateCode: "CA" })[0]).toMatch(/not a reviewed rule/);
    expect(validateFeeDraft({ enabled: true, amount: 100, stateCode: "CA" })).toEqual([]);
  });

  it("applies zero when the fee is disabled", () => {
    expect(effectiveFee({ enabled: false, amount: 895, stateCode: "CT" })).toBe(0);
    expect(effectiveFee({ enabled: true, amount: 895, stateCode: "CT" })).toBe(895);
  });
});

describe("recalculation predicate", () => {
  it("touches a row only when the stored fee or total would change, in cents", () => {
    expect(rowNeedsUpdate(row(), 895)).toBe(false);
    expect(rowNeedsUpdate(row(), 925)).toBe(true);
    expect(rowNeedsUpdate(row({ website_sale_price: 30_894 }), 895)).toBe(true);
    expect(rowNeedsUpdate(row({ doc_fee: 895.004 }), 895)).toBe(false);
  });

  it("never touches a row without an advertised price", () => {
    expect(rowNeedsUpdate(row({ advertised_price_before_doc: null }), 925)).toBe(false);
  });
});

describe("fee impact dry run", () => {
  const rows = [
    row(),
    row({ vin: "EXAMPLEVIN0000002", website_sale_price: 30_895, doc_fee: 895 }),
    row({ vin: "EXAMPLEVIN0000003", archived: true }),
    row({ vin: "EXAMPLEVIN0000004", advertised_price_before_doc: null }),
    row({ vin: "EXAMPLEVIN0000005", price_parse_status: "warning" }),
  ];
  const draft = { enabled: true, amount: 925, stateCode: "CT" };

  it("counts eligible active rows, excludes archived by default and reports the exclusion", () => {
    const impact = buildFeeImpact(rows, draft);
    expect(impact.eligible).toBe(3);
    expect(impact.excludedArchived).toBe(1);
    expect(impact.includedArchived).toBe(0);
    expect(impact.noPrice).toBe(1);
    expect(impact.unchanged).toBe(0);
    expect(impact.exclusions[0]).toMatch(/archived/i);
  });

  it("reports unchanged rows and no eligible rows when the fee already matches", () => {
    const impact = buildFeeImpact(rows, { enabled: true, amount: 895, stateCode: "CT" });
    expect(impact.eligible).toBe(0);
    expect(impact.unchanged).toBe(3);
  });

  it("includes archived rows only when deliberately asked", () => {
    const impact = buildFeeImpact(rows, draft, { includeArchived: true });
    expect(impact.eligible).toBe(4);
    expect(impact.includedArchived).toBe(1);
    expect(impact.excludedArchived).toBe(0);
  });

  it("builds samples with before and after totals and keeps parser warnings visible", () => {
    const impact = buildFeeImpact(rows, draft, { sampleSize: 1 });
    expect(impact.samples).toHaveLength(1);
    expect(impact.samples[0]).toMatchObject({ vinSuffix: "000001", sellingPrice: 30_000, feeBefore: 895, feeAfter: 925, totalBefore: 30_895, totalAfter: 30_925 });
    expect(impact.parserWarnings).toBe(1);
    expect(impact.warnings[0]).toMatch(/^Advertised prices exclude the fee/);
    expect(impact.warnings.some((w) => /parser warning.*preserved/.test(w))).toBe(true);
  });

  it("treats a disabled fee as a zero fee in the dry run", () => {
    const impact = buildFeeImpact(rows, { enabled: false, amount: 925, stateCode: "CT" });
    expect(impact.eligible).toBe(3);
    expect(impact.samples[0].feeAfter).toBe(0);
    expect(impact.samples[0].totalAfter).toBe(30_000);
  });
});

describe("before and after", () => {
  it("lists the fee, jurisdiction, unchanged basis and the version step", () => {
    const rows = feeChangeDiff({ enabled: true, amount: 895, stateCode: "CT" }, { enabled: true, amount: 925, stateCode: "CT" }, "website_sale_price", 12);
    expect(rows.map((r) => [r.field, r.before, r.after, r.changed])).toEqual([
      ["Document fee", "$895", "$925", true],
      ["Jurisdiction", "Connecticut", "Connecticut", false],
      ["Price basis", "Includes fee", "Includes fee", false],
      ["Policy version", "12", "13", true],
    ]);
    expect(feeChangeDiff({ enabled: true, amount: 895, stateCode: "CT" }, { enabled: false, amount: 895, stateCode: "CT" }, "advertised_before_doc", null)[0]).toMatchObject({ after: "Disabled", changed: true });
  });

  it("compares drafts by value", () => {
    expect(isFeeDraftEqual({ enabled: true, amount: 895, stateCode: "CT" }, { enabled: true, amount: 895.0, stateCode: "CT" })).toBe(true);
    expect(isFeeDraftEqual({ enabled: true, amount: 895, stateCode: "CT" }, { enabled: true, amount: 925, stateCode: "CT" })).toBe(false);
  });
});
