import type { AdminFixture } from "@/lib/admin/dataSource";
import { ADMIN_CHILD_ROUTES } from "@/lib/admin/sections";
import type { EstimatorFixture, PreviewVehicle } from "@/pages/admin/views/brand/paymentEstimator/data";
import { FIXTURE_02 } from "./02";
import type { AdminScreenFixture } from "./index";

// Synthetic screens for the payment estimator. Store names, VINs, prices and
// rates are invented for screenshots and are never written anywhere.

const NOW = Date.parse("2026-10-31T14:00:00Z");

const vehicle = (id: string, label: string, modelYear: number | null, sellingPrice: number | null, condition = "used", mileage: number | null = 24000): PreviewVehicle => ({
  id, label, vin: `EXMPL0000000${id.padStart(5, "0")}`, condition, mileage, modelYear, sellingPrice, includesDocFee: true,
});

export const PE_VEHICLES: PreviewVehicle[] = [
  vehicle("1", "2023 Example Sedan SE", 2023, 27500),
  vehicle("2", "2024 Example Crossover LX", 2024, 31995, "cpo", 11800),
  vehicle("3", "2026 Example Pickup XL", 2026, 48900, "new", 12),
  vehicle("4", "2019 Example Hatchback", 2019, 15400, "used", 68200),
  vehicle("5", "2016 Example Wagon", 2016, 9800, "used", 112400),
  vehicle("6", "Example Coupe (year unknown)", null, 18500),
];

const terms = (rows: Array<[number, boolean, number | null]>) => rows.map(([months, enabled, aprPercent]) => ({ months, enabled, aprPercent }));

export const PE_PUBLISHED = {
  enabled: true,
  downPayment: { mode: "percent", amount: 2000, percent: 10 },
  shopperControls: { downPayment: true, term: true, aprOverride: true },
  rules: [
    { id: "r-new", enabled: true, startYear: 2025, endYear: 2027, defaultTermMonths: 72, terms: terms([[36, true, 5.9], [48, true, 6.25], [60, true, 6.49], [72, true, 6.99], [84, false, null]]) },
    { id: "r-mid", enabled: true, startYear: 2020, endYear: 2024, defaultTermMonths: 60, terms: terms([[36, true, 7.49], [48, true, 7.75], [60, true, 7.99], [72, true, 8.49]]) },
    { id: "r-old", enabled: true, startYear: 2017, endYear: 2019, defaultTermMonths: 48, terms: terms([[36, true, 9.49], [48, true, 9.99], [60, false, null]]) },
  ],
};

const base: EstimatorFixture = {
  storeName: "Example Motors North",
  storeId: "store-north",
  otherStores: [{ id: "store-south", name: "Example Motors South" }],
  published: { config: PE_PUBLISHED, version: 3, updatedAt: "2026-10-28T15:42:00Z" },
  vehicles: PE_VEHICLES,
  canManage: true,
  priceContext: { price_display_mode: "website_sale_price", advertised_excludes_doc_fee: false },
};

const screen = (label: string, slice: Partial<EstimatorFixture>): AdminScreenFixture => ({
  childPath: ADMIN_CHILD_ROUTES.paymentEstimator,
  fixture: { label, now: NOW, views: { "payment-estimator": { ...base, ...slice } } } satisfies AdminFixture,
});

const draftWith = (patch: Record<string, unknown>) => ({ ...PE_PUBLISHED, ...patch });

export const PAYMENT_ESTIMATOR_FIXTURES: Record<string, AdminScreenFixture> = {
  "pe-defaults": screen("Payment estimator: availability & defaults", { section: "availability" }),
  "pe-rates": screen("Payment estimator: terms & rates", { section: "rates" }),
  "pe-price": screen("Payment estimator: price & disclosures", { section: "price" }),
  "pe-publish": screen("Payment estimator: preview & publish", { section: "publish" }),
  "pe-rule-edit": screen("Payment estimator: edit year range", { section: "rates", openRuleId: "r-mid" }),
  "pe-rule-add": screen("Payment estimator: add year range", { section: "rates", openRuleId: "new" }),
  "pe-review": screen("Payment estimator: review changes", {
    section: "rates",
    draft: draftWith({
      downPayment: { mode: "amount", amount: 2500, percent: 10 },
      rules: [PE_PUBLISHED.rules[0], { ...PE_PUBLISHED.rules[1], terms: terms([[36, true, 7.49], [48, true, 7.75], [60, true, 7.49], [72, true, 8.49], [84, true, 8.99]]) }, PE_PUBLISHED.rules[2]],
    }),
    openReview: true,
  }),
  "pe-validation": screen("Payment estimator: validation", {
    section: "rates",
    draft: draftWith({
      downPayment: { mode: "percent", amount: 2000, percent: 120 },
      rules: [PE_PUBLISHED.rules[0], { ...PE_PUBLISHED.rules[1], endYear: 2025, terms: terms([[36, true, 7.49], [48, true, null], [60, false, 7.99], [72, true, 8.49]]) }, PE_PUBLISHED.rules[2]],
    }),
  }),
  "pe-unavailable": screen("Payment estimator: unavailable estimate", {
    section: "publish",
    vehicles: [vehicle("5", "2016 Example Wagon", 2016, 9800, "used", 112400), ...PE_VEHICLES.filter((v) => v.id !== "5")],
  }),
  "pe-empty": screen("Payment estimator: first setup, no inventory", { published: undefined, vehicles: [], section: "availability" }),
  "pe-readonly": screen("Payment estimator: view only", { canManage: false, section: "rates" }),
  "pe-other-store": screen("Payment estimator: second store, separate settings", {
    storeName: "Example Motors South", storeId: "store-south", otherStores: [{ id: "store-north", name: "Example Motors North" }],
    published: { config: { ...PE_PUBLISHED, enabled: false, rules: [PE_PUBLISHED.rules[1]] }, version: 1, updatedAt: "2026-10-12T13:05:00Z" },
    section: "rates",
  }),
  "pe-document-defaults": {
    tabId: "document-defaults",
    fixture: { ...FIXTURE_02.fixture, label: "Document defaults with estimator entry", views: { ...FIXTURE_02.fixture.views, "document-defaults": { paymentEstimator: base } } },
  },
};
