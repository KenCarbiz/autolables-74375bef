import { describe, it, expect, vi } from "vitest";
import {
  capabilityForHref,
  commandRowMenuItems,
  conditionLabel,
  formatCommandDate,
  formatCommandDateTime,
  isSafeCommandHref,
  resolveCommandHref,
} from "./CommandPrimitives";
import {
  dealerRoleCapabilityMap, dealerRoleHome, getDealerCapabilities,
  hasDealerCapability, type DealerCapability,
} from "@/lib/permissions/dealerRoleCapabilities";

// Every href useCommandCenter can emit, plus the two the pages emit themselves.
// A destination missing from the capability map is not "unrestricted", it is a
// live button that dead-ends on the target screen's denial card.
const EMITTED_HREFS: string[] = [
  "/k208/1N4AL3AP8JC123456",
  "/vehicle-file/veh-1?tab=documents",
  "/vehicle-file/veh-1?tab=addendum",
  "/vehicle-file/veh-1?tab=overview",
  "/vehicle-file/veh-1?tab=prep",
  "/vehicle-file/veh-1?tab=evidence",
  "/vehicle-file/veh-1?tab=deal",
  "/used-car-sticker?vehicleId=veh-1",
  "/new-car-sticker?vehicleId=veh-1",
  "/get-ready-command/veh-1",
  "/description-intelligence/veh-1",
  "/print-center/veh-1",
  "/vin-command/veh-1",
  "/ready-board",
  "/inventory",
  "/dashboard",
];

const PUBLIC_HREFS: string[] = [
  "/print/vehicle-qr/1N4AL3AP8JC123456",
  "/q/abc123",
  "/v/2025-infiniti-qx80",
];

describe("capabilityForHref", () => {
  it("maps every internal destination the command surfaces emit", () => {
    for (const href of EMITTED_HREFS) {
      expect(capabilityForHref(href), href).toBeDefined();
    }
  });

  it("leaves publicly routed destinations ungated", () => {
    for (const href of PUBLIC_HREFS) {
      expect(capabilityForHref(href), href).toBeUndefined();
    }
  });

  it("leaves absolute and mailto destinations ungated", () => {
    expect(capabilityForHref("https://files.example.com/a.pdf")).toBeUndefined();
    expect(capabilityForHref("mailto:vendor@example.com")).toBeUndefined();
    expect(capabilityForHref(undefined)).toBeUndefined();
    expect(capabilityForHref("")).toBeUndefined();
  });

  it("does not let a prefix swallow a sibling route", () => {
    expect(capabilityForHref("/inventory-v2")).toBeUndefined();
  });

  // The defect this map exists for: a role holding one of these capabilities and
  // not the other saw two behaviours in three identical column footers.
  it("splits the get-ready and inventory destinations for a service_advisor", () => {
    const caps = new Set<DealerCapability>(getDealerCapabilities("service_advisor"));
    expect(caps.has(capabilityForHref("/k208/x") as DealerCapability)).toBe(true);
    expect(caps.has(capabilityForHref("/vehicle-file/x?tab=prep") as DealerCapability)).toBe(false);
  });

  it("gates the document destinations a service_manager cannot follow", () => {
    const caps = new Set<DealerCapability>(getDealerCapabilities("service_manager"));
    expect(caps.has(capabilityForHref("/vehicle-file/x") as DealerCapability)).toBe(true);
    expect(caps.has(capabilityForHref("/description-intelligence/x") as DealerCapability)).toBe(false);
    expect(caps.has(capabilityForHref("/print-center/x") as DealerCapability)).toBe(false);
  });

  it("gates get-ready and print for a salesperson", () => {
    const caps = new Set<DealerCapability>(getDealerCapabilities("salesperson"));
    expect(caps.has(capabilityForHref("/vin-command/x") as DealerCapability)).toBe(true);
    expect(caps.has(capabilityForHref("/get-ready-command/x") as DealerCapability)).toBe(false);
    expect(caps.has(capabilityForHref("/print-center/x") as DealerCapability)).toBe(false);
  });
});

// C2: the row link and the row kebab must gate on the same fact. The test calls
// what the PAGES call — `commandRowMenuItems` for the menu, `capabilityForHref`
// for the link — rather than asserting the shared helper against itself.
describe("commandRowMenuItems", () => {
  const build = (href?: string | null) =>
    commandRowMenuItems({ href, vin: "1N4AL3AP8JC123456", go: vi.fn() });

  it("gates Open on the capability the row's View link resolves, for every emitted href", () => {
    for (const href of EMITTED_HREFS) {
      const open = build(href).find((i) => i.label === "Open");
      expect(open, href).toBeDefined();
      expect(open?.capability, href).toBe(capabilityForHref(href));
    }
  });

  it("agrees with the row link for every role in the capability map", () => {
    for (const role of Object.keys(dealerRoleCapabilityMap)) {
      for (const href of EMITTED_HREFS) {
        const open = build(href).find((i) => i.label === "Open");
        const linkCap = capabilityForHref(href);
        const linkLive = !linkCap || hasDealerCapability(role, linkCap);
        const menuLive = !open?.capability || hasDealerCapability(role, open.capability);
        expect(menuLive, `${role} → ${href}`).toBe(linkLive);
      }
    }
  });

  // The reported case: on the VIN table's Description row a service_manager saw
  // "View" disabled and the kebab's "Open" live, navigating into a denial card.
  it("blocks Open for a service_manager on the row whose View link is blocked", () => {
    const href = "/description-intelligence/veh-1";
    const open = build(href).find((i) => i.label === "Open");
    expect(hasDealerCapability("service_manager", open?.capability as DealerCapability)).toBe(false);
    expect(hasDealerCapability("service_manager", capabilityForHref(href) as DealerCapability)).toBe(false);
  });

  it("refuses an unfollowable link with the same sentence the row link states", () => {
    const open = build("javascript:alert(1)").find((i) => i.label === "Open");
    expect(open?.disabledReason).toBe("This item's link is not a web address this app can open.");
  });

  it("offers only Copy VIN when the row has no destination", () => {
    expect(build(undefined).map((i) => i.label)).toEqual(["Copy VIN"]);
  });
});

// C3: "Back to Home" is the one control on all three permission-denied cards,
// and RouteCapabilityGuard sends every denied deep link to the same place. A
// role whose home it cannot load has no way out.
describe("dealerRoleHome", () => {
  // What each home destination demands — RouteCapabilityGuard's RULES for the
  // gated ones, the sidebar's capability for the rest.
  const HOME_REQUIREMENT: Record<string, DealerCapability | null> = {
    "/dashboard": "can_view_dashboard",
    "/inventory": "can_view_inventory",
    "/queue": "can_view_work_queue",
    "/saved": "can_view_deals",
    "/ready-board": "can_view_get_ready",
    "/service": "can_view_get_ready",
    "/titles": "can_view_compliance",
    "/compliance": "can_view_compliance",
  };

  it("sends every role somewhere that role can actually load", () => {
    for (const role of [...Object.keys(dealerRoleCapabilityMap), "some_unmapped_role", "", null]) {
      const home = dealerRoleHome(role);
      const need = HOME_REQUIREMENT[home];
      expect(need, `${role} → ${home} is not a known home destination`).not.toBeUndefined();
      if (need) expect(hasDealerCapability(role, need), `${role} → ${home}`).toBe(true);
    }
  });

  it("keeps the platform admin on the dashboard", () => {
    expect(dealerRoleHome("third_party_vendor", true)).toBe("/dashboard");
  });
});

describe("isSafeCommandHref", () => {
  it("accepts relative paths and the three usable schemes", () => {
    expect(isSafeCommandHref("/print-center/veh-1")).toBe(true);
    expect(isSafeCommandHref("?tab=prep")).toBe(true);
    expect(isSafeCommandHref("https://files.example.com/a.pdf")).toBe(true);
    expect(isSafeCommandHref("mailto:vendor@example.com")).toBe(true);
    expect(isSafeCommandHref("tel:+18005551212")).toBe(true);
  });

  // generated_documents.pdf_url and qr_codes.target_url are dealer-writable.
  it("rejects in-origin script and protocol-relative destinations", () => {
    expect(isSafeCommandHref("javascript:alert(1)")).toBe(false);
    expect(isSafeCommandHref("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isSafeCommandHref("//evil.example.com/a")).toBe(false);
    expect(isSafeCommandHref("")).toBe(false);
    expect(isSafeCommandHref(null)).toBe(false);
  });
});

describe("resolveCommandHref", () => {
  it("absolutises a relative href without concatenating it", () => {
    expect(resolveCommandHref("/q/abc")).toBe(`${window.location.origin}/q/abc`);
    expect(resolveCommandHref("?tab=prep")).toContain("?tab=prep");
  });

  it("leaves an absolute href alone", () => {
    expect(resolveCommandHref("https://files.example.com/a.pdf")).toBe("https://files.example.com/a.pdf");
  });
});

describe("date formatting", () => {
  it("returns null rather than echoing an unparseable stamp", () => {
    expect(formatCommandDate("not-a-date")).toBeNull();
    expect(formatCommandDateTime("not-a-date")).toBeNull();
    expect(formatCommandDate(null)).toBeNull();
  });

  it("formats a real stamp", () => {
    expect(formatCommandDate("2026-07-25T13:45:12.482Z")).toMatch(/2026/);
    expect(formatCommandDateTime("2026-07-25T13:45:12.482Z")).toMatch(/2026/);
  });
});

describe("conditionLabel", () => {
  it("normalises casing so one car reads the same on every surface", () => {
    expect(conditionLabel("used")).toBe("Used");
    expect(conditionLabel("cpo")).toBe("CPO");
    expect(conditionLabel("  ")).toBeNull();
  });
});
