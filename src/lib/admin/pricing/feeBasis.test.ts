import { describe, it, expect } from "vitest";
import { evidenceContradicts, planFeeChange, resolveFeeBasis, reviewFeeChange, roundFee, type FeeBasis, type StoredPriceRow } from "./feeBasis";
import { buildFeeImpact, validateFeeDraft, type FeeImpactRow } from "./feePolicy";
import { customerPrice } from "./previewPricing";
import { assessConsistency, type ConsistencyListing } from "./priceConsistency";
import { buildPassportSaleCard } from "@/lib/passport/saleCard";
import { resolveDisplayPrice, type PriceDisplayMode } from "@/lib/priceModel";
import type { PassportData } from "@/lib/passportV2Data";

// The fee basis contract, and the conflict traced on 2026-10-28: a vehicle
// advertised at $40,420 including an $895 fee, the fee changed to $925.
// Screen 05 previewed $39,495 + $925 = $40,420, while the deployed dry-run and
// apply wrote $39,525 + $925 = $40,450 beside an unchanged $40,420 label.
// The same values are pinned in SQL by scripts/db-verify/30_fee_basis.sql
// (policy B) and 31_fee_conflict_deployed.sql (the deployed behaviour).

const TRACED: StoredPriceRow = { price: 40_420, advertisedBeforeDoc: 39_525, websiteSalePrice: 40_420, docFee: 895 };

// The Passport, read the way passportV2Data derives it from a listing row and
// public-listing-view's flags (advertised_excludes_doc_fee is set from the
// basis setting), then buildPassportSaleCard.
const passport = (row: StoredPriceRow, mode: PriceDisplayMode, excludesFromSetting: boolean | null) => {
  const advBeforeDoc = row.advertisedBeforeDoc ?? row.price;
  const websiteSalePrice = row.websiteSalePrice ?? (advBeforeDoc != null ? advBeforeDoc + (row.docFee ?? 0) : null);
  const price = resolveDisplayPrice(
    { advertised_price_before_doc: advBeforeDoc, doc_fee: row.docFee, website_sale_price: websiteSalePrice, price: row.price, advertised_excludes_doc_fee: excludesFromSetting },
    mode,
  );
  const d = { price, priceIncludesDoc: mode === "website_sale_price", docFee: row.docFee, msrp: null, marketAvg: null, retailCash: null, dealerDiscount: null } as unknown as PassportData;
  return buildPassportSaleCard(d, "used");
};
const label = (row: StoredPriceRow) => row.price;
const impactRow = (row: StoredPriceRow, over: Partial<FeeImpactRow> = {}): FeeImpactRow => ({
  vin: "EXAMPLEVIN0040420", year: 2024, make: "Example", model: "Crossover", trim: null, stock: "EX-1", archived: false,
  price: row.price, advertised_price_before_doc: row.advertisedBeforeDoc, doc_fee: row.docFee, website_sale_price: row.websiteSalePrice, price_parse_status: "ok", ...over,
});
const draft925 = { enabled: true, amount: 925, stateCode: "CT" };

describe("fee basis authority (the same table as the SQL basis case)", () => {
  it.each<[Record<string, unknown>, FeeBasis, string]>([
    [{ advertised_includes_doc_fee: true }, "includes_fee", "advertised_includes_doc_fee"],
    [{ advertised_includes_doc_fee: "false", price_display_mode: "website_sale_price" }, "before_fee", "advertised_includes_doc_fee"],
    [{ advertised_excludes_doc_fee: false }, "includes_fee", "advertised_excludes_doc_fee"],
    [{ price_display_mode: "website_sale_price" }, "unconfigured", "not_set"],
    [{}, "unconfigured", "not_set"],
    [{ advertised_includes_doc_fee: true, advertised_excludes_doc_fee: true }, "conflict", "settings_conflict"],
    [{ advertised_includes_doc_fee: "yes" }, "unconfigured", "unreadable_setting"],
    [{ advertised_includes_doc_fee: true, advertised_excludes_doc_fee: false }, "includes_fee", "advertised_includes_doc_fee"],
    [{ advertised_includes_doc_fee: null }, "unconfigured", "not_set"],
  ])("%j -> %s from %s", (settings, basis, source) => {
    expect(resolveFeeBasis(settings)).toEqual({ basis, source });
  });

  it("never guesses: an undecided basis plans nothing and blocks the change with a reason", () => {
    for (const basis of ["unconfigured", "conflict"] as FeeBasis[]) {
      expect(planFeeChange(basis, TRACED, 925)).toMatchObject({ status: "blocked_basis", after: TRACED });
      expect(customerPrice(TRACED, 925, "website_sale_price", basis)).toBeNull();
      const review = reviewFeeChange(basis, [{ ...TRACED, archived: false }], 925);
      expect(review).toMatchObject({ change: 0, blocked: true });
      expect(review.blockReasons[0]).toMatch(basis === "conflict" ? /contradict/ : /has not set whether/);
    }
  });
});

describe("the traced conflict: $40,420 fee-inclusive, $895 -> $925 (policy B)", () => {
  it("keeps the advertised total and moves the split", () => {
    const plan = planFeeChange("includes_fee", TRACED, 925);
    expect(plan).toMatchObject({ status: "change", sellingBefore: 39_525, sellingAfter: 39_495, totalBefore: 40_420, totalAfter: 40_420, salePriceDiffers: false });
    expect(plan.after).toEqual({ price: 40_420, advertisedBeforeDoc: 39_495, websiteSalePrice: 40_420, docFee: 925 });
  });

  it.each<[PriceDisplayMode, boolean | null]>([["website_sale_price", null], ["website_sale_price", false], ["advertised_before_doc", false]])(
    "Screen 05, Screen 06, save, Label and Passport agree before and after reload (display %s, excludes flag %s)",
    (mode, excludes) => {
      expect(label(TRACED)).toBe(40_420);
      expect(passport(TRACED, mode, excludes)).toMatchObject({ vehicleSellingPrice: 39_525, feeAmount: 895, totalAdvertisedPrice: 40_420 });

      const preview = customerPrice(TRACED, 925, mode, "includes_fee");
      expect(preview).toMatchObject({ sellingPrice: 39_495, docFee: 925, total: 40_420 });

      const review = buildFeeImpact([impactRow(TRACED)], draft925, { basis: "includes_fee" });
      expect(review).toMatchObject({ blocked: false, eligible: 1 });
      expect(review.samples[0]).toMatchObject({ sellingBefore: 39_525, sellingPrice: 39_495, feeBefore: 895, feeAfter: 925, totalBefore: 40_420, totalAfter: 40_420 });

      const saved = planFeeChange("includes_fee", TRACED, 925).after;
      expect(saved).toEqual({ price: 40_420, advertisedBeforeDoc: 39_495, websiteSalePrice: 40_420, docFee: 925 });
      expect(label(saved)).toBe(40_420);
      const card = passport(saved, mode, excludes);
      expect(card).toMatchObject({ vehicleSellingPrice: 39_495, feeAmount: 925, totalAdvertisedPrice: 40_420 });
      expect(card?.totalAdvertisedPrice).toBe(preview?.total);
      expect(card?.vehicleSellingPrice).toBe(preview?.sellingPrice);

      expect(customerPrice(saved, 925, mode, "includes_fee")).toMatchObject({ sellingPrice: 39_495, docFee: 925, total: 40_420 });
      expect(buildFeeImpact([impactRow(saved)], draft925, { basis: "includes_fee" })).toMatchObject({ eligible: 0, unchanged: 1, blocked: false });
    },
  );

  it("the saved row passes the consistency check", () => {
    const saved = planFeeChange("includes_fee", TRACED, 925).after;
    const listing: ConsistencyListing = {
      id: "l", vin: "EXAMPLEVIN0040420", year: 2024, make: "Example", model: "Crossover", trim: null, stock: null, condition: "used", heroImageUrl: null,
      price: saved.price, advertisedBeforeDoc: saved.advertisedBeforeDoc, docFee: saved.docFee, websiteSalePrice: saved.websiteSalePrice,
      parseStatus: "ok", verifiedAt: "2026-10-20T06:00:00Z", vehicleFileId: null,
    };
    const a = assessConsistency(listing, { price: 40_420, capturedAt: "2026-10-21T06:00:00Z", sourceUrl: null, channel: "website" }, 925, "website_sale_price");
    expect(a).toMatchObject({ status: "consistent", label: 40_420, passport: 40_420, breakdownDelta: 0 });
  });

  it("changing back to $895 restores the original split exactly", () => {
    const saved = planFeeChange("includes_fee", TRACED, 925).after;
    expect(planFeeChange("includes_fee", saved, 895).after).toEqual(TRACED);
  });

  it("the deployed formula is what the conflict was: before-fee + fee = $40,450 beside a $40,420 label", () => {
    const exclusive: StoredPriceRow = { ...TRACED, price: 39_525 };
    expect(planFeeChange("before_fee", exclusive, 925).after).toMatchObject({ advertisedBeforeDoc: 39_525, websiteSalePrice: 40_450 });
    expect(planFeeChange("includes_fee", TRACED, 925).after.websiteSalePrice).toBe(40_420);
  });
});

describe("fee-exclusive basis: before-fee price + fee = advertised total", () => {
  const ROW: StoredPriceRow = { price: 39_525, advertisedBeforeDoc: 39_525, websiteSalePrice: 40_420, docFee: 895 };

  it("keeps the before-fee price and moves the total", () => {
    expect(planFeeChange("before_fee", ROW, 925)).toMatchObject({
      status: "change", sellingBefore: 39_525, sellingAfter: 39_525, totalBefore: 40_420, totalAfter: 40_450,
      after: { price: 39_525, advertisedBeforeDoc: 39_525, websiteSalePrice: 40_450, docFee: 925 },
    });
  });

  it.each<PriceDisplayMode>(["advertised_before_doc", "website_sale_price"])("preview, save and Passport agree (display %s)", (mode) => {
    const preview = customerPrice(ROW, 925, mode, "before_fee");
    expect(preview).toMatchObject({ sellingPrice: 39_525, docFee: 925, total: 40_450 });
    const saved = planFeeChange("before_fee", ROW, 925).after;
    expect(passport(saved, mode, true)).toMatchObject({ vehicleSellingPrice: 39_525, feeAmount: 925, totalAdvertisedPrice: 40_450 });
    expect(label(saved)).toBe(39_525);
    expect(buildFeeImpact([impactRow(saved)], draft925, { basis: "before_fee" })).toMatchObject({ eligible: 0, unchanged: 1 });
  });

  it("an inventory price that differs from the before-fee price blocks the change", () => {
    const off = { ...ROW, price: 40_000 };
    expect(planFeeChange("before_fee", off, 925)).toMatchObject({ status: "split_mismatch", after: off });
    expect(reviewFeeChange("before_fee", [{ ...off, archived: false }], 925)).toMatchObject({ blocked: true, splitMismatches: 1 });
  });
});

describe("the dealership-level block (same counts and reasons as doc_fee_change_review)", () => {
  // The Fourth Example Motors fixture in scripts/db-verify/04_fee_basis_fixture.sql.
  const FOURTH = [
    { price: 30_000, advertisedBeforeDoc: 29_105, websiteSalePrice: 30_500, docFee: 895, archived: false },
    { price: 20_000, advertisedBeforeDoc: 20_000, websiteSalePrice: 20_000, docFee: 895, archived: false },
    { price: 900, advertisedBeforeDoc: 5, websiteSalePrice: 900, docFee: 895, archived: false },
    { price: 50_000, advertisedBeforeDoc: 49_105, websiteSalePrice: 50_000, docFee: 895, archived: false, observed: 49_105 },
  ];

  it("refuses the whole change while any vehicle in scope carries a conflict", () => {
    const r = reviewFeeChange("includes_fee", FOURTH, 925);
    expect(r).toMatchObject({ blocked: true, change: 2, splitMismatches: 1, invalid: 1, salePriceDiffers: 1, evidenceConflicts: 1 });
    expect(r.blockReasons).toEqual([
      "1 vehicle(s) have a stored vehicle price that does not add up to the advertised total.",
      "1 vehicle(s) would be left with no vehicle price under this fee.",
      "1 vehicle(s) store a sale price (website_sale_price) that differs from the advertised total.",
      "1 vehicle(s) have a website observation that contradicts the configured fee basis.",
    ]);
  });

  it("counts an archived conflict only when archived stock is included", () => {
    const rows = [{ ...TRACED, archived: false }, { price: 11_000, advertisedBeforeDoc: 11_000, websiteSalePrice: 11_895, docFee: 895, archived: true }];
    expect(reviewFeeChange("includes_fee", rows, 925).blocked).toBe(false);
    expect(reviewFeeChange("includes_fee", rows, 925, true).blocked).toBe(true);
  });

  it("reads website evidence against the basis", () => {
    expect(evidenceContradicts("includes_fee", 40_420, 895, 40_420)).toBe(false);
    expect(evidenceContradicts("includes_fee", 40_420, 895, 39_525)).toBe(true);
    expect(evidenceContradicts("includes_fee", 40_420, 895, 41_315)).toBe(true);
    expect(evidenceContradicts("includes_fee", 40_420, 895, 38_000)).toBe(false);
    expect(evidenceContradicts("before_fee", 39_525, 895, 40_420)).toBe(false);
    expect(evidenceContradicts("before_fee", 39_525, 895, 38_630)).toBe(true);
    expect(evidenceContradicts("includes_fee", 40_420, 895, null)).toBe(false);
  });
});

describe("rounding, invalid values and stored-price disagreements", () => {
  it("skips a fee-inclusive row whose stored split already disagrees with its total, and blocks the change", () => {
    // As every disagreeing row in the hosted review looks: sale price = before-fee + fee, total different.
    const split: StoredPriceRow = { price: 30_000, advertisedBeforeDoc: 38_210, websiteSalePrice: 39_105, docFee: 895 };
    expect(planFeeChange("includes_fee", split, 925)).toMatchObject({ status: "split_mismatch", after: split });
    expect(buildFeeImpact([impactRow(split)], draft925, { basis: "includes_fee" })).toMatchObject({ eligible: 0, splitMismatches: 1, blocked: true, samples: [] });
    expect(customerPrice(split, 925, "website_sale_price", "includes_fee")).toMatchObject({ total: 30_000, docFee: 895, sellingPrice: 29_105 });
  });

  it("rounds a fee to cents once, the way the server does", () => {
    expect(roundFee(925.555)).toBe(925.56);
    expect(roundFee(925.554)).toBe(925.55);
    expect(planFeeChange("includes_fee", TRACED, 925.555).after).toMatchObject({ advertisedBeforeDoc: 39_494.44, docFee: 925.56, price: 40_420 });
    expect(planFeeChange("before_fee", { price: 0.1, advertisedBeforeDoc: 0.1, websiteSalePrice: null, docFee: null }, 0.2).totalAfter).toBe(0.3);
    expect(validateFeeDraft({ enabled: true, amount: 925.555, stateCode: "CT" })).toEqual(["Use whole cents."]);
  });

  it("refuses a negative fee in review and blocks a fee that would leave no vehicle price", () => {
    expect(validateFeeDraft({ enabled: true, amount: -1, stateCode: "CT" })).toEqual(["The fee cannot be negative."]);
    const small: StoredPriceRow = { price: 900, advertisedBeforeDoc: 5, websiteSalePrice: 900, docFee: 895 };
    expect(planFeeChange("includes_fee", small, 925)).toMatchObject({ status: "invalid", after: small });
    expect(customerPrice(small, 925, "website_sale_price", "includes_fee")).toBeNull();
    expect(buildFeeImpact([impactRow(small)], draft925, { basis: "includes_fee" })).toMatchObject({ eligible: 0, invalid: 1, blocked: true });
  });

  it("leaves a vehicle without a price alone and does not block on it", () => {
    expect(planFeeChange("includes_fee", { ...TRACED, price: null }, 925).status).toBe("no_price");
    expect(planFeeChange("before_fee", { ...TRACED, advertisedBeforeDoc: null }, 925).status).toBe("no_price");
    expect(reviewFeeChange("includes_fee", [{ ...TRACED, archived: false }, { price: null, advertisedBeforeDoc: null, websiteSalePrice: null, docFee: null, archived: false }], 925)).toMatchObject({ blocked: false, noPrice: 1, change: 1 });
  });

  it("reports a stored sale price that differs from the total without calling it website evidence, and never reprices from it", () => {
    const observed: StoredPriceRow = { price: 30_000, advertisedBeforeDoc: 29_105, websiteSalePrice: 30_500, docFee: 895 };
    const plan = planFeeChange("includes_fee", observed, 925);
    expect(plan).toMatchObject({ status: "change", salePriceDiffers: true, totalAfter: 30_000, after: { price: 30_000, advertisedBeforeDoc: 29_075, websiteSalePrice: 30_500, docFee: 925 } });
    const impact = buildFeeImpact([impactRow(observed)], draft925, { basis: "includes_fee" });
    expect(impact).toMatchObject({ sourceMismatches: 1, blocked: true });
    expect(impact.blockReasons).toEqual(["1 vehicle(s) store a sale price (website_sale_price) that differs from the advertised total."]);
    const listing: ConsistencyListing = {
      id: "l", vin: "EXAMPLEVIN0030000", year: 2024, make: "Example", model: "Sedan", trim: null, stock: null, condition: "used", heroImageUrl: null,
      price: 30_000, advertisedBeforeDoc: 29_105, docFee: 895, websiteSalePrice: 30_500, parseStatus: "ok", verifiedAt: null, vehicleFileId: null,
    };
    const a = assessConsistency(listing, null, 895, "website_sale_price");
    expect(a.status).toBe("mismatch");
    expect(a.detail).toMatch(/Stored sale price \$30,500 differs from the advertised total by \+\$500; its source is not verified and it is kept for review\./);
  });
});
