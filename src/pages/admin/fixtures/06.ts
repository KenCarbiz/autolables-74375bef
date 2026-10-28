import type { AdminScreenFixture } from "./index";
import { ADMIN_CHILD_ROUTES } from "@/lib/admin/sections";
import { FEE_REVIEW_FIXTURE, PRICE_RULES_FIXTURE, PRICING_FIXTURE_NOW } from "./pricingFixtureData";

// Screen 06: Fee Change Review over the Price rules page.
export const SCREEN_06: AdminScreenFixture = {
  childPath: ADMIN_CHILD_ROUTES.feeReview,
  fixture: {
    label: "06 Pricing & Products: Fee change review",
    now: PRICING_FIXTURE_NOW,
    views: { "price-rules": PRICE_RULES_FIXTURE, "fee-review": FEE_REVIEW_FIXTURE },
  },
};
