import type { AdminScreenFixture } from "./index";
import { CONSISTENCY_ROWS, PRICE_RULES_FIXTURE, PRICING_FIXTURE_NOW } from "./pricingFixtureData";

// Screen 05: Pricing & Products, Price rules. The customer preview shows the
// first consistency row's vehicle (its stored prices and stock number), so it
// carries that vehicle's name too. Screen 06 keeps the shared fixture as it was
// accepted.
const previewVehicle = CONSISTENCY_ROWS[0].listing;

export const SCREEN_05: AdminScreenFixture = {
  tabId: "price-rules",
  fixture: {
    label: "05 Pricing & Products: Price rules",
    now: PRICING_FIXTURE_NOW,
    views: {
      "price-rules": {
        ...PRICE_RULES_FIXTURE,
        preview: { ...PRICE_RULES_FIXTURE.preview, title: `${previewVehicle.year} ${previewVehicle.make} ${previewVehicle.model}`, trim: previewVehicle.trim },
      },
    },
  },
};
