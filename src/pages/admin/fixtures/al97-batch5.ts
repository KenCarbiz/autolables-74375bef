import type { AdminScreenFixture } from "./index";
import { ADMIN_CHILD_ROUTES } from "@/lib/admin/sections";
import type { Store } from "@/types/tenant";
import type { BrandFixture } from "@/pages/admin/views/brand/useBrandForm";
import type { StoreIdentityFixture } from "@/pages/admin/children/StoreIdentityPage";
import type { EstimatorFixture, PreviewVehicle } from "@/pages/admin/views/brand/paymentEstimator/data";

// AL97 screens 06 and 17. Synthetic design fixtures only: the store, rates and
// vehicles are invented for the parity harness ($30,000, $3,000 down, 72
// months at 7.90% resolves to $472.08), are labelled synthetic on screen and
// are never written anywhere.

const NOW = Date.parse("2026-10-31T18:00:00Z");
const label = (id: string) => ({ "fixture.label": "PROPOSED TARGET · SYNTHETIC DESIGN FIXTURE · NOT A LIVE SCREENSHOT", "fixture.id": `AL97 / ${id}` });
const terms = (rows: Array<[number, boolean, number | null]>) => rows.map(([months, enabled, aprPercent]) => ({ months, enabled, aprPercent }));
const vehicle = (id: string, modelYear: number, sellingPrice: number): PreviewVehicle => ({
  id, label: `${modelYear} Example vehicle`, vin: null, condition: "used", mileage: null, modelYear, sellingPrice, includesDocFee: false,
});

const MID = { id: "r-2022", enabled: true, startYear: 2022, endYear: 2024, defaultTermMonths: 72, terms: terms([[48, true, 7.5], [60, true, 7.5], [72, true, 7.9], [84, false, null]]) };
const NEW = { id: "r-2025", enabled: true, startYear: 2025, endYear: 2027, defaultTermMonths: 72, terms: terms([[48, true, 6.9], [60, true, 6.9], [72, true, 7.5], [84, false, null]]) };
const OLD = { id: "r-2018", enabled: true, startYear: 2018, endYear: 2021, defaultTermMonths: 60, terms: terms([[48, true, 9.9], [60, true, 9.9], [72, false, null], [84, false, null]]) };
const draft = (rules: unknown[], aprOverride: boolean) => ({
  enabled: true,
  downPayment: { mode: "percent", amount: null, percent: 10 },
  shopperControls: { downPayment: true, term: true, aprOverride },
  rules,
});

const estimator = (slice: Partial<EstimatorFixture>): EstimatorFixture => ({
  storeName: "Harte INFINITI",
  storeId: "store-al97",
  published: { config: null, version: 0 },
  vehicles: [vehicle("1", 2024, 30000), vehicle("2", 2016, 12000)],
  canManage: true,
  priceContext: { price_display_mode: "website_sale_price", advertised_excludes_doc_fee: false },
  ...slice,
});

const screen = (label: string, views: Record<string, unknown>): AdminScreenFixture => ({
  childPath: ADMIN_CHILD_ROUTES.paymentAssumptions,
  fixture: { label, now: NOW, views },
});

const COPY = { "pay.account": "Harte Auto Group", "pay.vehicle": "ILLUSTRATIVE VEHICLE" };

export const AL97_06 = screen("AL97 06 Payment estimator", {
  "payment-estimator": estimator({ draft: draft([MID, NEW, OLD], false) }),
  "al97-copy": {
    ...COPY, ...label("06"),
    "pay.banner": "Illustrative configuration below. No APR, term or down payment is supplied automatically.",
    "pay.values": "Example values only", "pay.ranges": "example year",
  },
});

export const AL97_17 = screen("AL97 17 Payment estimator review", {
  "payment-estimator": estimator({ draft: draft([MID], true), openReview: true }),
  "al97-copy": {
    ...COPY, ...label("17"),
    "pay.reviewNote": "illustrative draft", "pay.reviewTitle": "Illustrative assumptions",
    "pay.reviewDetail": "Rates below are example values supplied for this design; do not publish them.",
    "pay.coverage": "Computed from current store inventory", "pay.unmatched": "No estimate; do not use a fallback APR",
  },
});

const STORE: Store = {
  id: "store-al97", tenant_id: "t-al97", name: "Harte INFINITI", slug: "harte-infiniti", address: "150 Weston St", city: "Hartford", state: "CT", zip: "06120",
  phone: "", logo_url: "", tagline: "", primary_color: "", created_at: "2026-10-01T00:00:00Z", is_active: true,
};

export const AL97_05: AdminScreenFixture = {
  childPath: ADMIN_CHILD_ROUTES.storeIdentity,
  fixture: {
    label: "AL97 05 Store identity and scope", now: NOW,
    views: {
      brand: {
        settings: { dealer_name: "Harte INFINITI", dealer_address: "150 Weston St", dealer_city: "Hartford", dealer_state: "CT", dealer_zip: "06120" },
        tenantName: "Harte Auto Group", stores: [STORE], activeStoreId: STORE.id,
      } satisfies BrandFixture,
      "al97-identity": { registry: 6 } satisfies StoreIdentityFixture,
      "al97-copy": label("05"),
    },
  },
};

export const AL97_06_PILOT: AdminScreenFixture = { childPath: ADMIN_CHILD_ROUTES.paymentEstimator, fixture: { ...AL97_06.fixture, label: "AL97 06 Payment estimator (pilot route)" } };
