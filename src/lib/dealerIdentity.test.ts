import { describe, it, expect } from "vitest";
import {
  assessIdentityOverflow,
  formatDealerPhone,
  normalizeDealerWebsite,
  resolveDealerIdentity,
  isPlatformLogoAsset,
  type DealerIdentityStore,
} from "./dealerIdentity";

const settings = {
  dealer_name: "Example Auto Group",
  dealer_address: "1 Group Way",
  dealer_city: "Springfield",
  dealer_state: "CT",
  dealer_zip: "06101",
  dealer_phone: "8605551212",
  dealer_logo_url: "https://cdn.example.com/group.png",
  used_inventory_url: "https://www.exampledealer.com/inventory/used?source=autolabels",
};

const store = (over: Partial<DealerIdentityStore>): DealerIdentityStore => ({
  id: "loc-1", name: "Example Import", address: "150 Weston Street", city: "Hartford",
  state: "CT", zip: "06120", phone: "2035095054", logo_url: "https://cdn.example.com/import.png",
  is_active: true, ...over,
});

describe("formatDealerPhone", () => {
  it("formats a 10-digit US number", () => {
    expect(formatDealerPhone("8605551212")).toBe("(860) 555-1212");
    expect(formatDealerPhone("860-555-1212")).toBe("(860) 555-1212");
    expect(formatDealerPhone("+1 (860) 555 1212")).toBe("(860) 555-1212");
  });

  it("returns empty for missing or placeholder numbers rather than inventing one", () => {
    expect(formatDealerPhone("")).toBe("");
    expect(formatDealerPhone(null)).toBe("");
    expect(formatDealerPhone("0000000000")).toBe("");
    expect(formatDealerPhone("5555555555")).toBe("");
  });

  it("passes through a number it cannot confidently reformat", () => {
    expect(formatDealerPhone("860-555-1212 x204")).toBe("860-555-1212 x204");
  });
});

describe("normalizeDealerWebsite", () => {
  it("strips protocol, inventory path, and tracking params", () => {
    expect(normalizeDealerWebsite("https://www.harteinfiniti.com/inventory/used?source=autolabels"))
      .toEqual({ display: "www.harteinfiniti.com", href: "https://www.harteinfiniti.com" });
  });

  it("strips a query string from a bare domain", () => {
    expect(normalizeDealerWebsite("https://harteinfiniti.com/?utm_source=autolabels").display)
      .toBe("harteinfiniti.com");
  });

  it("collapses a VDP url to the domain", () => {
    expect(normalizeDealerWebsite("https://www.exampledealer.com/vehicles/used/12345").display)
      .toBe("www.exampledealer.com");
  });

  it("preserves www when the dealer configured it, and drops it when they did not", () => {
    expect(normalizeDealerWebsite("www.exampledealer.com").display).toBe("www.exampledealer.com");
    expect(normalizeDealerWebsite("exampledealer.com").display).toBe("exampledealer.com");
  });

  it("keeps an intentionally configured landing page path", () => {
    expect(normalizeDealerWebsite("https://exampledealer.com/shop", { isLandingPage: true }))
      .toEqual({ display: "exampledealer.com/shop", href: "https://exampledealer.com/shop" });
  });

  it("never keeps an inventory path even when flagged as a landing page", () => {
    expect(normalizeDealerWebsite("https://exampledealer.com/inventory/used", { isLandingPage: true }).display)
      .toBe("exampledealer.com");
  });

  it("drops fragments and trailing slashes", () => {
    expect(normalizeDealerWebsite("https://exampledealer.com/#hours").display).toBe("exampledealer.com");
    expect(normalizeDealerWebsite("https://exampledealer.com/").display).toBe("exampledealer.com");
  });

  it("returns empty for junk rather than printing it", () => {
    expect(normalizeDealerWebsite("not a url").display).toBe("");
    expect(normalizeDealerWebsite("").display).toBe("");
  });
});

describe("resolveDealerIdentity", () => {
  it("prefers the location the vehicle is assigned to over the user's active location", () => {
    const stores = [store({ id: "loc-1", name: "Example Import" }), store({ id: "loc-2", name: "Example Honda", phone: "8601110000", logo_url: "https://cdn.example.com/honda.png" })];
    const id = resolveDealerIdentity({ settings, stores, vehicleStoreId: "loc-1", activeStoreId: "loc-2" });
    expect(id.displayName).toBe("Example Import");
    expect(id.phone).toBe("(203) 509-5054");
    expect(id.logoUrl).toBe("https://cdn.example.com/import.png");
    expect(id.sources.name).toBe("vehicle_location");
  });

  it("uses the location public name rather than the parent group name", () => {
    const stores = [store({ public_name: "Example Import" })];
    const id = resolveDealerIdentity({ settings, stores, vehicleStoreId: "loc-1" });
    expect(id.displayName).toBe("Example Import");
    expect(id.displayName).not.toBe(settings.dealer_name);
  });

  it("falls back per field, so a location missing a phone inherits the tenant number", () => {
    const stores = [store({ phone: "" })];
    const id = resolveDealerIdentity({ settings, stores, vehicleStoreId: "loc-1" });
    expect(id.phone).toBe("(860) 555-1212");
    expect(id.sources.phone).toBe("tenant");
    expect(id.sources.name).toBe("vehicle_location");
  });

  it("falls back to the active location, then the default location, then the tenant", () => {
    const stores = [store({ id: "loc-1" }), store({ id: "loc-2", name: "Example Honda" })];
    expect(resolveDealerIdentity({ settings, stores, activeStoreId: "loc-2" }).sources.name).toBe("active_location");
    expect(resolveDealerIdentity({ settings, stores }).displayName).toBe("Example Import");
    expect(resolveDealerIdentity({ settings, stores: [] }).displayName).toBe("Example Auto Group");
  });

  it("never falls back to an inactive location", () => {
    const id = resolveDealerIdentity({ settings, stores: [store({ is_active: false })], vehicleStoreId: "loc-1" });
    expect(id.displayName).toBe("Example Auto Group");
  });

  it("normalizes the tenant inventory url down to the bare domain", () => {
    const id = resolveDealerIdentity({ settings, stores: [] });
    expect(id.websiteDisplay).toBe("www.exampledealer.com");
  });

  it("prefers a configured landing page over the inventory feed url", () => {
    const id = resolveDealerIdentity({
      settings: { ...settings, public_landing_url: "https://exampledealer.com/shop" },
      stores: [],
    });
    expect(id.websiteDisplay).toBe("exampledealer.com/shop");
    expect(id.websiteHref).toBe("https://exampledealer.com/shop");
  });

  it("builds a two-line address from the resolved location", () => {
    const id = resolveDealerIdentity({ settings, stores: [store({})], vehicleStoreId: "loc-1" });
    expect(id.addressLine1).toBe("150 Weston Street");
    expect(id.addressLine2).toBe("Hartford, CT 06120");
  });

  it("warns instead of inventing missing information", () => {
    const id = resolveDealerIdentity({ settings: {}, stores: [] });
    const codes = id.warnings.map((w) => w.code);
    expect(codes).toContain("missing_phone");
    expect(codes).toContain("missing_logo");
    expect(codes).toContain("missing_website");
    expect(id.phone).toBe("");
    expect(id.logoUrl).toBe("");
  });

  it("flags a vehicle with no location assignment when the group has several", () => {
    const stores = [store({ id: "loc-1" }), store({ id: "loc-2" })];
    const id = resolveDealerIdentity({ settings, stores, vehicleAssigned: false });
    expect(id.warnings.map((w) => w.code)).toContain("unassigned_vehicle");
  });

  it("keeps one tenant's stores from leaking into another's identity", () => {
    // The resolver only ever sees the stores the caller passed, so an empty
    // list can never surface another dealership's branding.
    const id = resolveDealerIdentity({ settings: { dealer_name: "Only Mine" }, stores: [], vehicleStoreId: "loc-from-other-tenant" });
    expect(id.displayName).toBe("Only Mine");
    expect(id.locationId).toBe("");
  });
});

describe("assessIdentityOverflow", () => {
  const identity = (over: Partial<ReturnType<typeof resolveDealerIdentity>>) =>
    ({ ...resolveDealerIdentity({ settings, stores: [store({})], vehicleStoreId: "loc-1" }), ...over });

  it("passes a normal dealership block", () => {
    expect(assessIdentityOverflow(identity({})).overflows).toBe(false);
  });

  it("flags an unbreakable word that cannot fit the column", () => {
    const result = assessIdentityOverflow(identity({ displayName: "Exampledealershipgroupofgreaterhartfordandsurroundingtowns" }));
    expect(result.overflows).toBe(true);
    expect(result.offending).toHaveLength(1);
    expect(result.message).toContain("too long to print safely");
  });

  it("flags a block that would wrap past the safe line count", () => {
    const result = assessIdentityOverflow(identity({
      displayName: "Example Premier Automotive Group of Greater Hartford and Springfield",
      addressLine1: "1500 Northwest Industrial Park Boulevard, Building C, Suite 2200",
      addressLine2: "New Britain Township, Connecticut 06120-4471",
    }));
    expect(result.overflows).toBe(true);
  });

  it("does not warn merely because an optional line is missing", () => {
    expect(assessIdentityOverflow(identity({ phone: "", websiteDisplay: "" })).overflows).toBe(false);
  });
});


describe("a platform brand asset is never a dealership logo", () => {
  // TenantContext defaults a tenant with no uploaded logo to
  // "/autolabels-mark.svg", and the placeholder reaches store rows through
  // onboarding and the Autocurb mirror. Printed on an addendum it reads as
  // though AutoLabels sold the car.
  it("recognises the AutoLabels and Autocurb marks", () => {
    for (const v of [
      "/autolabels-mark.svg", "/logo-mark.svg", "/logo-full.svg",
      "https://autolabels.io/autolabels-logo.svg", "/autocurb-logo.svg",
      "/favicon.ico", "/apple-touch-icon.svg", "/AutoLabels-Mark.SVG",
    ]) expect(isPlatformLogoAsset(v), v).toBe(true);
  });

  it("leaves a dealership's own upload alone", () => {
    for (const v of [
      "https://cdn.example.com/harte-infiniti.png", "", null, undefined,
      "https://x.supabase.co/storage/v1/object/public/dealer-logos/t/logo.png",
    ]) expect(isPlatformLogoAsset(v), String(v)).toBe(false);
  });

  it("skips a location whose logo is the platform placeholder", () => {
    const id = resolveDealerIdentity({
      settings, stores: [store({ logo_url: "/autolabels-mark.svg" })], activeStoreId: "loc-1",
    });
    expect(id.logoUrl).toBe("https://cdn.example.com/group.png");
    expect(id.sources.logo).toBe("tenant");
  });

  it("reports a missing logo rather than falling back to the platform mark", () => {
    const id = resolveDealerIdentity({
      settings: { ...settings, dealer_logo_url: "/autolabels-mark.svg" },
      stores: [store({ logo_url: "/logo-mark.svg" })], activeStoreId: "loc-1",
    });
    expect(id.logoUrl).toBe("");
    expect(id.warnings.map((w) => w.code)).toContain("missing_logo");
  });
});

describe("account-level identity, for documents that are dealership letterhead", () => {
  it("keeps the Branding-page name and logo separate from the location chain", () => {
    const id = resolveDealerIdentity({
      settings, stores: [store({ name: "Example Auto Group Hartford" })], activeStoreId: "loc-1",
    });
    // The location still wins for the resolved identity the stickers use...
    expect(id.displayName).toBe("Example Auto Group Hartford");
    expect(id.logoUrl).toBe("https://cdn.example.com/import.png");
    // ...while the addendum masthead reads the account-level values.
    expect(id.tenantName).toBe("Example Auto Group");
    expect(id.tenantLogoUrl).toBe("https://cdn.example.com/group.png");
  });

  it("falls back to the tenant name, then to the resolved name", () => {
    expect(resolveDealerIdentity({
      settings: { ...settings, dealer_name: undefined }, tenantName: "Tenant Row Name",
    }).tenantName).toBe("Tenant Row Name");
    expect(resolveDealerIdentity({
      settings: { ...settings, dealer_name: undefined }, stores: [store({})], activeStoreId: "loc-1",
    }).tenantName).toBe("Example Import");
  });
});
