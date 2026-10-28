import type { AdminScreenFixture } from "./index";
import { PRICE_RULES_FIXTURE, PRICING_FIXTURE_NOW } from "./pricingFixtureData";

// Screen 05: Pricing & Products, Price rules.
export const SCREEN_05: AdminScreenFixture = {
  tabId: "price-rules",
  fixture: {
    label: "05 Pricing & Products: Price rules",
    now: PRICING_FIXTURE_NOW,
    views: { "price-rules": PRICE_RULES_FIXTURE },
  },
};
