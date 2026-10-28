import type { AdminScreenFixture } from "./index";
import { PRODUCT_APPLICABILITY_PATH } from "@/pages/admin/childRoutes";
import { PRICING_FIXTURE_NOW, PRODUCT_APPLICABILITY_FIXTURE } from "./pricingFixtureData";

// Screen 07: Product applicability child page.
export const SCREEN_07: AdminScreenFixture = {
  childPath: PRODUCT_APPLICABILITY_PATH,
  fixture: {
    label: "07 Pricing & Products: Product applicability",
    now: PRICING_FIXTURE_NOW,
    views: { "product-applicability": PRODUCT_APPLICABILITY_FIXTURE },
  },
};
