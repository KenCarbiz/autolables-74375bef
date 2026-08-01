import { describe, it, expect } from "vitest";
import {
  formatDealerPhone,
  normalizeDealerWebsite,
  resolveDealerIdentity,
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
