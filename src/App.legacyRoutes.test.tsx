import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// A dealer's world is full of links we do not control: printed QR codes on
// windshields, emailed signing links, a title clerk's bookmark, a saved search
// result. Consolidating the navigation is allowed to move where a row points;
// it is never allowed to make one of those links 404. Every path below has been
// published at some point, so each one must still resolve — as itself, or as a
// redirect to the surface that absorbed it.

const APP = readFileSync(join(__dirname, "App.tsx"), "utf8");

const routeFor = (path: string): string | null => {
  const match = APP.match(new RegExp(`<Route path="${path.replace(/[/:]/g, (c) => `\\${c}`)}" element=\\{([\\s\\S]*?)\\}\\s*/>`));
  return match ? match[1].replace(/\s+/g, " ").trim() : null;
};

describe("legacy routes still resolve", () => {
  const stillRouted = [
    // Customer-facing links printed on stickers and sent to shoppers.
    "/v/:slug",
    "/v3/:slug",
    "/vehicle/:vin",
    "/passport-v2/:vehicleSlug",
    "/passport-v3/:vehicleSlug",
    "/sign/:token",
    "/deal/:token",
    "/review/:token",
    "/inspect/:token",
    "/title/:token",
    "/ready/:token",
    "/approve/:token",
    "/install/:token",
    "/q/:token",
    // Staff destinations whose nav row moved, merged, or disappeared.
    "/leads",
    "/saved",
    "/signed",
    "/delivered",
    "/returns",
    "/signatures",
    "/queue",
    "/print-queue",
    "/create",
    "/titles",
    "/compliance",
    "/compliance-center",
    "/dashboard/document-review",
    "/dashboard/classic",
    "/dashboard/reports",
    "/dashboard/qr-analytics",
    "/new-car-sticker",
    "/new-car-sticker-legacy",
    "/description-writer",
    "/setup",
    "/dashboard-legacy",
  ];

  for (const path of stillRouted) {
    it(`keeps ${path} routed`, () => {
      expect(routeFor(path)).toBeTruthy();
    });
  }
});

describe("superseded routes redirect instead of disappearing", () => {
  it("sends the price-change review to the price section of the compliance surface", () => {
    expect(routeFor("/dashboard/document-review")).toBe('<ComplianceTabRedirect tab="price" />');
  });

  it("sends the old compliance action center to the issues section", () => {
    expect(routeFor("/compliance-center")).toBe('<ComplianceTabRedirect tab="issues" />');
  });

  it("sends the old titles page to the titles section", () => {
    expect(routeFor("/titles")).toBe('<ComplianceTabRedirect tab="titles" />');
  });

  it("carries the incoming query onto the redirect", () => {
    // /compliance-center?filter=… and ?vin=… are live links in the CT MVP
    // widget and the compliance digest email; dropping the query would land the
    // reader on the right tab looking at the wrong vehicle.
    expect(APP).toContain("const params = new URLSearchParams(search);");
    expect(APP).toContain('params.set("tab", tab);');
  });
});

describe("the role screens that had no route", () => {
  it("routes the technician, vendor, service writer, customer record and deals boards", () => {
    expect(routeFor("/home/technician")).toBe("<TechnicianHome />");
    expect(routeFor("/home/vendor")).toBe("<VendorHome />");
    expect(routeFor("/service-desk")).toBe("<ServiceWriterDesk />");
    expect(routeFor("/customers")).toBeTruthy();
    expect(routeFor("/customers/:id")).toBe("<CustomerRecord />");
    expect(routeFor("/deals")).toBe("<DealsPage />");
  });

  it("resolves home and the work queue to the vendor's own board for a vendor", () => {
    // A third-party vendor must never land on a dealer screen, from any entry
    // point: login lands on /queue for that role, and a capability redirect
    // sends them there too.
    expect(routeFor("/dashboard")).toBe("<HomeRoute />");
    expect(routeFor("/queue")).toBe("<QueueRoute />");
    expect(APP).toContain('if (mode === "vendor") return <VendorHome />;');
    expect(APP).toContain('if (navModeForRole(member?.role) === "vendor") return <VendorHome />;');
  });
});
