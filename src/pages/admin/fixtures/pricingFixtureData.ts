import { knownCount } from "@/lib/admin/health";
import { buildFeeImpact, type FeeDraft, type FeeImpactRow } from "@/lib/admin/pricing/feePolicy";
import { assessConsistency, type ConsistencyAssessment, type ConsistencyListing, type WebsiteObservation } from "@/lib/admin/pricing/priceConsistency";
import type { ProductRule } from "@/hooks/useProductRules";
import type { PriceRulesFixture } from "@/pages/admin/views/pricing/PriceRulesView";
import type { FeeReviewFixture } from "@/pages/admin/children/FeeReviewPage";
import type { ProductApplicabilityFixture } from "@/pages/admin/children/ProductApplicabilityPage";
import type { AdminProduct } from "@/pages/admin/views/pricing/pricingData";

// Synthetic Pricing & Products data for the parity harness. Every name,
// number and identifier here is invented; nothing is production data.

export const PRICING_FIXTURE_NOW = Date.UTC(2026, 9, 21, 15, 0, 0);

const MODELS = ["Crossover", "Sedan", "Pickup", "Hatch", "Utility"];
const TRIMS = ["Base", "Sport", "Premium"];
const vinOf = (n: number): string => `EXAMPLEVIN${String(n).padStart(7, "0")}`;

const listing = (n: number, over: Partial<ConsistencyListing> = {}): ConsistencyListing => {
  const selling = 18_000 + n * 525;
  return {
    id: `listing-${n}`,
    vin: vinOf(n),
    year: 2022 + (n % 4),
    make: "Example",
    model: MODELS[n % MODELS.length],
    trim: TRIMS[n % TRIMS.length],
    stock: `EX-${1000 + n}`,
    condition: n % 3 === 0 ? "new" : "used",
    heroImageUrl: null,
    price: selling,
    advertisedBeforeDoc: selling,
    docFee: 895,
    websiteSalePrice: selling + 895,
    parseStatus: "ok",
    verifiedAt: "2026-10-20T06:00:00Z",
    vehicleFileId: `file-${n}`,
    ...over,
  };
};

const observed = (price: number, capturedAt = "2026-10-21T06:05:00Z"): WebsiteObservation => ({ price, capturedAt, sourceUrl: "https://dealer.example/vdp", channel: "website" });

export const CONSISTENCY_ROWS: ConsistencyAssessment[] = [
  assessConsistency(listing(41), observed(18_000 + 41 * 525 + 895), 895, "advertised_before_doc"),
  assessConsistency(listing(32), observed(18_000 + 32 * 525 + 895, "2026-10-19T06:05:00Z"), 895, "advertised_before_doc"),
  assessConsistency(listing(58), observed(18_000 + 58 * 525 + 2_195), 895, "advertised_before_doc"),
  assessConsistency(listing(17), null, 895, "advertised_before_doc"),
  assessConsistency(listing(46), observed(18_000 + 46 * 525 + 895), 895, "advertised_before_doc"),
];

export const PRICE_RULES_FIXTURE: PriceRulesFixture = {
  policy: { stateCode: "CT", feeEnabled: true, feeAmount: 895, mode: "advertised_before_doc" },
  counts: { eligible: knownCount(48), archived: knownCount(12) },
  preview: { title: "2024 Example Crossover", trim: "Premium", stock: "EX-1041", imageUrl: null, sellingPrice: 18_000 + 41 * 525, vehicleType: "used" },
  consistency: { rows: CONSISTENCY_ROWS, truncated: false },
  websiteTerm: "Sale Price",
};

export const FEE_IMPACT_ROWS: FeeImpactRow[] = Array.from({ length: 60 }, (_, i) => {
  const n = i + 1;
  const selling = 18_000 + n * 525;
  return {
    vin: vinOf(n),
    year: 2022 + (n % 4),
    make: "Example",
    model: MODELS[n % MODELS.length],
    trim: TRIMS[n % TRIMS.length],
    stock: `EX-${1000 + n}`,
    archived: n > 48,
    advertised_price_before_doc: selling,
    doc_fee: 895,
    website_sale_price: selling + 895,
    price_parse_status: n % 17 === 0 ? "warning" : "ok",
  };
});

const FEE_BEFORE: FeeDraft = { enabled: true, amount: 895, stateCode: "CT" };
const FEE_AFTER: FeeDraft = { enabled: true, amount: 925, stateCode: "CT" };

export const FEE_REVIEW_FIXTURE: FeeReviewFixture = {
  before: FEE_BEFORE,
  after: FEE_AFTER,
  mode: "advertised_before_doc",
  scope: "active",
  version: { version: 12, source: "server" },
  preview: { impact: buildFeeImpact(FEE_IMPACT_ROWS, FEE_AFTER, { includeArchived: false }), source: "server", version: 12, truncated: false, notes: [] },
  canManage: true,
};

export const EXAMPLE_PRODUCT: AdminProduct = {
  id: "example-product-1",
  name: "Example Protection Package",
  subtitle: "Paint and fabric protection",
  warranty: "5 years",
  badge_type: "installed",
  price: 695,
  price_label: "Included in Selling Price",
  disclosure: "Pre-installed, non-removable; cost included in the selling price.",
  sort_order: 1,
  is_active: false,
  benefit_justification: "Protects the finish and interior against staining and fading.",
  price_in_advertised: true,
  disclosure_optional: null,
  benefit_justification_optional: null,
  available_preinstalled: true,
  upgrade: null,
  contract_url: "example-tenant/example-contract.pdf",
  contract_doc_type: "contract",
  price_tiers: null,
  tenant_id: "example-tenant",
};

export const EXAMPLE_RULE: ProductRule = {
  id: "example-rule-1",
  product_id: EXAMPLE_PRODUCT.id,
  year_min: "2020",
  year_max: "",
  makes: [],
  models: [],
  trims: [],
  body_styles: [],
  condition: "all",
  mileage_max: 80_000,
};

export const PRODUCT_APPLICABILITY_FIXTURE: ProductApplicabilityFixture = {
  product: EXAMPLE_PRODUCT,
  rule: EXAMPLE_RULE,
  vehicles: [
    { vin: vinOf(41), year: 2024, make: "Example", model: "Crossover", trim: "Premium", condition: "new", mileage: 12 },
    { vin: vinOf(32), year: 2023, make: "Example", model: "Sedan", trim: "Sport", condition: "used", mileage: 28_115 },
    { vin: vinOf(58), year: 2019, make: "Example", model: "Pickup", trim: "Base", condition: "used", mileage: 64_220 },
    { vin: vinOf(17), year: 2022, make: "Example", model: "Hatch", trim: "Base", condition: "cpo", mileage: 96_480 },
  ],
  proofs: { [vinOf(41)]: 1, [vinOf(32)]: 0, [vinOf(58)]: 0, [vinOf(17)]: 0 },
  policy: { requireManagerApproval: true, requireInstallVerification: true },
  rulesExist: true,
};
