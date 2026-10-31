import { describe, it, expect } from "vitest";
import { derivePassport } from "@/lib/passportV2Data";
import type { VehicleListing } from "@/hooks/useVehicleListing";
import { normalizeEstimatorConfig, resolveEstimate } from "./estimator";
import { vehicleFromListing } from "@/pages/admin/views/brand/paymentEstimator/data";
import { projectPublicPaymentEstimator } from "../../../supabase/functions/_shared/paymentEstimatorProjection";
import { PE_PUBLISHED } from "@/pages/admin/fixtures/paymentEstimator";

// The admin preview and the customer Passport must show the same number for
// the same vehicle and settings. Synthetic listings only.

const row = (over: Record<string, unknown>) => ({ id: "l1", vin: "EXMPL000000000001", ymm: "2023 Example Sedan", trim: "SE", condition: "used", mileage: 24000, ...over });

const both = (listing: Record<string, unknown>, ctx: { price_display_mode: string; advertised_excludes_doc_fee: boolean | null }) => {
  const config = normalizeEstimatorConfig(PE_PUBLISHED);
  const projected = projectPublicPaymentEstimator({ enabled: true, config: PE_PUBLISHED, version: 3 });
  const passport = derivePassport({ ...listing, ...ctx, payment_estimator: projected } as unknown as VehicleListing);
  const v = vehicleFromListing(listing, ctx);
  const preview = resolveEstimate({ ...config, enabled: true }, { modelYear: v.modelYear, sellingPrice: v.sellingPrice }, {}, { validate: "matched" });
  return { passport, preview, v };
};

describe("admin preview agrees with the customer Passport", () => {
  it("fee-inclusive price (website sale price mode): same price, rule, term, APR and payment", () => {
    const { passport, preview, v } = both(row({ price: 27500, doc_fee: 499 }), { price_display_mode: "website_sale_price", advertised_excludes_doc_fee: null });
    expect(v.sellingPrice).toBe(passport.price);
    expect(preview.status).toBe("available");
    expect(passport.paymentEstimate.status).toBe("available");
    if (preview.status !== "available" || passport.paymentEstimate.status !== "available") return;
    expect(passport.paymentEstimate.ruleLabel).toBe(preview.ruleLabel);
    expect(passport.paymentEstimate.termMonths).toBe(preview.termMonths);
    expect(passport.paymentEstimate.aprPercent).toBe(preview.aprPercent);
    expect(passport.estMonthly).toBe(preview.monthlyPayment);
  });

  it("fee-exclusive advertised price: both use the same basis and never add the fee twice", () => {
    const listing = row({ price: 28499, advertised_price_before_doc: 28000, doc_fee: 499 });
    const ctx = { price_display_mode: "advertised_before_doc", advertised_excludes_doc_fee: true };
    const { passport, preview, v } = both(listing, ctx);
    expect(v.sellingPrice).toBe(passport.price);
    if (preview.status !== "available") throw new Error("expected an estimate");
    expect(passport.estMonthly).toBe(preview.monthlyPayment);
    expect(preview.sellingPrice).toBe(passport.price);
    expect(v.includesDocFee).toBe(false);
  });

  it("a model year with no rule shows no number on either side", () => {
    const { passport, preview } = both(row({ ymm: "2012 Example Sedan", price: 9000 }), { price_display_mode: "website_sale_price", advertised_excludes_doc_fee: null });
    expect(preview.status).toBe("unavailable");
    expect(passport.estMonthly).toBeNull();
    expect(passport.paymentAssumptions).toBe("");
  });

  it("an estimator that is off yields no Passport estimate while its rules are kept", () => {
    const projected = projectPublicPaymentEstimator({ enabled: false, config: { ...PE_PUBLISHED, enabled: false }, version: 4 });
    const passport = derivePassport({ ...row({ price: 27500 }), payment_estimator: projected } as unknown as VehicleListing);
    expect(passport.estMonthly).toBeNull();
    expect(normalizeEstimatorConfig({ ...PE_PUBLISHED, enabled: false }).rules).toHaveLength(3);
  });
});
