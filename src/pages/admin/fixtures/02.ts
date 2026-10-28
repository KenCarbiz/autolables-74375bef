import type { AdminScreenFixture } from "./index";
import type { BrandFixture } from "@/pages/admin/views/brand/useBrandForm";

// Screen 02, Dealership & Brand (Identity tab). Synthetic dealership; no
// production name, address, logo or contact appears here.

const brand: BrandFixture = {
  tenantName: "Example Auto Group",
  activeStoreId: "store-example-1",
  stores: [
    {
      id: "store-example-1",
      tenant_id: "tenant-example",
      name: "Example INFINITI",
      slug: "example-infiniti",
      address: "",
      city: "Example City",
      state: "CT",
      zip: "",
      phone: "",
      logo_url: "",
      tagline: "",
      primary_color: "",
      created_at: "2026-01-01T00:00:00Z",
      is_active: true,
    },
  ],
  settings: {
    dealer_name: "Example INFINITI",
    dealer_tagline: "",
    dealer_city: "Example City",
    dealer_state: "CT",
    dealer_timezone: "America/New_York",
    dealer_logo_url: "",
    primary_color: "#2457D6",
    dealer_website_url: "https://www.example.test",
    dealer_phone: "",
  },
};

export const FIXTURE_02: AdminScreenFixture = {
  tabId: "identity",
  fixture: {
    label: "02 Dealership & Brand",
    now: Date.parse("2026-10-28T12:00:00Z"),
    views: { brand },
  },
};
