import type { AdminScreenFixture } from "./index";
import type { BrandBFixture, FixtureState } from "@/pages/admin/views/brand/editor/useBrandEditor";
import type { Store } from "@/types/tenant";

// Wave B, Dealership & Brand (Identity, Appearance, Hours & Contact, Why Buy). Every value is synthetic: the
// dealership, phones, ratings and dates are obviously fake and never feed a production default. State variants are
// chosen with ?state=empty|error|readonly|dirty|invalid|review.

const store: Store = {
  id: "store-example-1",
  tenant_id: "tenant-example",
  name: "Example INFINITI of Sampleville",
  slug: "example-infiniti",
  address: "",
  city: "Sampleville",
  state: "CT",
  zip: "",
  phone: "",
  logo_url: "",
  tagline: "",
  primary_color: "",
  created_at: "2026-01-01T00:00:00Z",
  is_active: true,
};

const LOGO = "data:image/svg+xml;utf8," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="72" viewBox="0 0 240 72"><rect width="240" height="72" rx="8" fill="#2457D6"/><text x="120" y="46" font-family="Arial" font-size="26" font-weight="700" text-anchor="middle" fill="#FFFFFF">EXAMPLE</text></svg>',
);

const baseSettings = {
  dealer_name: "Example INFINITI",
  dealer_tagline: "Sample tagline for design review",
  why_buy_here: "Sample promise: a fixture sentence that is not a real claim.",
  warranty_programs: "",
  dealer_city: "Sampleville",
  dealer_state: "CT",
  dealer_zip: "00000",
  dealer_address: "1 Example Way",
  dealer_timezone: "America/New_York",
  dealer_logo_url: LOGO,
  primary_color: "#2457D6",
  dealer_phone: "(860) 555-0142",
  dealer_website_url: "https://www.example.test",
  public_landing_url: "",
  dealer_principal: "Sample Principal",
  dealer_license_number: "FIXTURE-0001",
  dealer_hours: "Mon to Fri 9:00 AM to 7:00 PM\nSat 9:00 AM to 5:00 PM\nSun closed",
  dealer_years_in_business: "12",
  dealer_family_owned: "yes",
  dealer_satisfaction: "97%",
  dealer_google_rating: "4.8",
  dealer_google_count: "1200",
  dealer_bbb_rating: "A+",
  dealer_review_sources: "Fixture Reviews | 4.9 | Sample quote for design review.\nSample Guide | 4.6 | A second sample quote.",
  dealer_certifications: "Sample Award of Excellence, Fixture Satisfaction Award",
  dealer_service_location: "onsite",
  dealer_service_address: "",
  dealer_delivery: "local",
  dealer_financing: "yes",
  dealer_services: "Online scheduling, Express service",
  dealer_amenities: "Customer lounge, EV charging",
  dealer_advisor_name: "Sample Advisor",
  dealer_advisor_title: "Sample Specialist",
  dealer_advisor_photo: "",
  dealer_advisor_response: "Sample response note",
  mobile_slideout_cta_variant: "dealer_availability",
  why_buy_profile: {
    version: 1,
    reviews: [
      { id: "review-a", source: "Fixture Reviews", rating: "4.9", quote: "Sample quote for design review.", asOf: "2026-10-01" },
      { id: "review-b", source: "Sample Guide", rating: "4.6", quote: "A second sample quote.", asOf: "2026-09-15" },
    ],
    awards: [{ id: "award-a", name: "Sample Award of Excellence", issuer: "Sample Maker" }],
    reputation: { googleAsOf: "2026-10-20", bbbAsOf: "2026-10-01", satisfactionSource: "Fixture survey", satisfactionAsOf: "2026-08-01" },
  },
  passport_agents: [
    { id: "agent-a", name: "Sample Advisor", title: "Sample Specialist", smsNumber: "(860) 555-0143", status: "available", acceptsPassportLeads: true, workingHours: [] },
  ],
} as unknown as BrandBFixture["settings"];

const emptySettings = {
  dealer_name: "", dealer_tagline: "", why_buy_here: "", warranty_programs: "", dealer_city: "", dealer_state: "", dealer_zip: "", dealer_address: "",
  dealer_timezone: "", dealer_logo_url: "", primary_color: "", dealer_phone: "", dealer_website_url: "", public_landing_url: "", dealer_principal: "",
  dealer_license_number: "", dealer_hours: "", dealer_years_in_business: "", dealer_family_owned: "", dealer_satisfaction: "", dealer_google_rating: "",
  dealer_google_count: "", dealer_bbb_rating: "", dealer_review_sources: "", dealer_certifications: "", dealer_service_location: "", dealer_service_address: "",
  dealer_delivery: "", dealer_financing: "", dealer_services: "", dealer_amenities: "", dealer_advisor_name: "", dealer_advisor_title: "", dealer_advisor_photo: "",
  dealer_advisor_response: "", why_buy_profile: null, passport_agents: [],
} as unknown as BrandBFixture["settings"];

const rooftops = [{ id: "store-example-1", displayName: "Example INFINITI of Sampleville", legalName: "Example Motors of Sampleville LLC", city: "Sampleville", state: "CT" }];

type Variants = NonNullable<BrandBFixture["variants"]>;
const common: Variants = {
  empty: { settings: emptySettings, rooftops: [], secondaryColor: "" },
  error: { settings: emptySettings },
  readonly: {},
};

const make = (tabId: string, label: string, variants: Variants): AdminScreenFixture => {
  const brand: BrandBFixture = { tenantName: "Example Auto Group", activeStoreId: store.id, stores: [store], settings: baseSettings, secondaryColor: "#0F766E", rooftops, variants: { ...common, ...variants } as Partial<Record<FixtureState, never>> };
  return { tabId, fixture: { label, now: Date.parse("2026-11-07T12:00:00Z"), views: { brand } } };
};

export const WAVE_B_BRAND_FIXTURES: Record<string, AdminScreenFixture> = {
  "v3-identity": make("identity", "Identity", {
    dirty: { seed: { dealer_name: "Example INFINITI Sampleville", dealer_timezone: "America/Chicago" } },
    invalid: { seed: { dealer_name: "", dealer_state: "ZZ" } },
    review: { seed: { dealer_name: "Example INFINITI Sampleville", dealer_city: "Sampleton" } },
  }),
  "v3-appearance": make("appearance", "Appearance", {
    dirty: { seed: { primary_color: "#0F766E", secondary_color: "#B45309" } },
    invalid: { seed: { primary_color: "#24G7", secondary_color: "blue" } },
    review: { seed: { primary_color: "#0F766E", dealer_logo_url: "" } },
  }),
  "v3-hours-contact": make("hours-contact", "Hours and contact", {
    dirty: { seed: { dealer_hours: "Mon to Sat 9:00 AM to 6:00 PM\nSun closed" } },
    invalid: { seed: { dealer_phone: "86", dealer_zip: "ABC" } },
    review: { seed: { dealer_hours: "Mon to Sat 9:00 AM to 6:00 PM\nSun closed", dealer_phone: "(860) 555-0199" } },
  }),
  "v3-why-buy": make("why-buy", "Why buy", {
    dirty: { seed: { dealer_tagline: "Another sample tagline", amenities: ["Customer lounge", "EV charging", "Kids area"] } },
    invalid: { seed: { dealer_bbb_rating: "B", reviews: [{ id: "review-x", source: "Fixture Reviews", rating: "9", quote: "", asOf: "" }] } },
    review: { seed: { dealer_google_rating: "4.7", reputation: { googleAsOf: "2026-11-07", bbbAsOf: "2026-10-01", satisfactionSource: "Fixture survey", satisfactionAsOf: "2026-08-01" } } },
  }),
};
