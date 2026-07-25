import { describe, it, expect } from "vitest";
import {
  capabilityForHref,
  conditionLabel,
  formatCommandDate,
  formatCommandDateTime,
  isSafeCommandHref,
  resolveCommandHref,
} from "./CommandPrimitives";
import { getDealerCapabilities, type DealerCapability } from "@/lib/permissions/dealerRoleCapabilities";

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
