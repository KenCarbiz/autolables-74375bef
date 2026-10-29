import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resetSupabaseSpy, spyResponses } from "@/test/mocks/supabaseSpy";

vi.mock("@/integrations/supabase/client", async () => {
  const m = await import("@/test/mocks/supabaseSpy");
  return { supabase: m.supabaseSpy };
});

import { resolveFeeBasis, type StoredPriceRow } from "./feeBasis";
import { customerPrice } from "./previewPricing";
import { loadFeePreview } from "@/pages/admin/views/pricing/pricingData";
import { buildPassportSaleCard } from "@/lib/passport/saleCard";
import { resolveDisplayPrice, type PriceDisplayMode } from "@/lib/priceModel";
import type { PassportData } from "@/lib/passportV2Data";

// What a reload reads after policy B ran in the isolated database: Third
// Example Motors after two rounds of concurrent applies and a final apply at
// $925, exported by scripts/db-verify/40_concurrency.sh (synthetic data).
// Rerun `scripts/db-verify/run.sh --policy-b` to refresh it.
interface ExportRow { vin_suffix: string; archived: boolean; price: number | null; advertised_price_before_doc: number | null; doc_fee: number | null; website_sale_price: number | null }
const exported = JSON.parse(readFileSync(resolve(__dirname, "../../../../scripts/admin-parity/evidence/pricing/policy-b-reload.json"), "utf8")) as {
  settings: Record<string, unknown>;
  rows: ExportRow[];
  preview_at_saved_fee: Record<string, unknown>;
  preview_draft_950: Record<string, unknown> & { samples: Array<Record<string, number | string | boolean>> };
};
const mode = exported.settings.price_display_mode as PriceDisplayMode;
const basis = resolveFeeBasis(exported.settings).basis;
const stored = (r: ExportRow): StoredPriceRow => ({ price: r.price, advertisedBeforeDoc: r.advertised_price_before_doc, websiteSalePrice: r.website_sale_price, docFee: r.doc_fee });
const passport = (r: ExportRow) => {
  const price = resolveDisplayPrice({ advertised_price_before_doc: r.advertised_price_before_doc, doc_fee: r.doc_fee, website_sale_price: r.website_sale_price, price: r.price, advertised_excludes_doc_fee: false }, mode);
  return buildPassportSaleCard({ price, priceIncludesDoc: mode === "website_sale_price", docFee: r.doc_fee, msrp: null, marketAvg: null, retailCash: null, dealerDiscount: null } as unknown as PassportData, "used");
};
const active = exported.rows.filter((r) => !r.archived && r.price != null);
const draft = (amount: number) => ({ enabled: true, amount, stateCode: "CT" });

beforeEach(() => resetSupabaseSpy());

describe("rows saved by the isolated database, reloaded", () => {
  it("is the fee-inclusive dealership at $925 with every active split adding up", () => {
    expect(basis).toBe("includes_fee");
    expect(exported.settings.doc_fee_amount).toBe(925);
    expect(active.map((r) => r.vin_suffix)).toEqual(["025000", "040420"]);
    for (const r of active) expect((r.advertised_price_before_doc ?? 0) + (r.doc_fee ?? 0)).toBe(r.price);
  });

  it.each(active.map((r) => [r.vin_suffix, r] as const))("Label, Passport and the Screen 05 preview agree for %s", (_, r) => {
    const card = passport(r);
    const preview = customerPrice(stored(r), 925, mode, basis);
    expect(card).toMatchObject({ totalAdvertisedPrice: r.price, vehicleSellingPrice: r.advertised_price_before_doc, feeAmount: 925 });
    expect(preview).toMatchObject({ total: r.price, sellingPrice: r.advertised_price_before_doc, docFee: 925 });
  });

  it("the traced vehicle reads $39,495 + $925 = $40,420 everywhere", () => {
    const traced = active.find((r) => r.vin_suffix === "040420") as ExportRow;
    expect(traced).toMatchObject({ price: 40_420, advertised_price_before_doc: 39_495, doc_fee: 925, website_sale_price: 40_420 });
    expect(passport(traced)).toMatchObject({ vehicleSellingPrice: 39_495, feeAmount: 925, totalAdvertisedPrice: 40_420 });
  });

  it("Screen 06 at the saved fee: nothing to change and nothing blocked", async () => {
    spyResponses.rpcs.admin_doc_fee_change_preview = { data: exported.preview_at_saved_fee, error: null };
    const p = await loadFeePreview("tenant-3", draft(925), false, basis);
    expect(p.blocked).toBeNull();
    expect(p.impact).toMatchObject({ eligible: 0, unchanged: 2, samples: [] });
  });

  it("Screen 06 for a $950 draft: the database's own dry-run matches the Screen 05 preview of the same draft", async () => {
    spyResponses.rpcs.admin_doc_fee_change_preview = { data: exported.preview_draft_950, error: null };
    const p = await loadFeePreview("tenant-3", draft(950), false, basis);
    expect(p.blocked).toBeNull();
    for (const s of p.impact.samples) {
      const r = active.find((x) => x.vin_suffix === s.vinSuffix) as ExportRow;
      const preview = customerPrice(stored(r), 950, mode, basis);
      expect(s.totalAfter).toBe(r.price);
      expect(s.totalBefore).toBe(r.price);
      expect(preview).toMatchObject({ total: s.totalAfter, sellingPrice: s.sellingPrice, docFee: 950 });
    }
  });
});
