import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ── Passport V3 conversion-routing guard ────────────────────────────────────
// The line between a page and a drawer moved, deliberately.
//
// It used to sit around "high-intent conversion", which put Trade, Documents,
// Verification and the dealership page on full pages. That cost the shopper
// their passport — and their scroll position in it — for actions that were
// only ever "tell me more about this same car".
//
// The line now sits at TASK vs INVESTIGATION. A page is earned by a
// substantial multi-step task, a form that collects contact details, a formal
// printable report, an external document, or a different vehicle. Everything
// else opens over the passport.
//
// Trade moved the other way for a different reason: it was a page, but the
// page was a contact form, so it was neither a real appraisal nor a
// justifiable navigation. It is now a real appraisal, in a drawer.

const SRC = readFileSync(resolve(__dirname, "../VehiclePassportGoverned.tsx"), "utf8");

// These remain full pages: each is a substantial task or collects contact
// details, and each is reached through the returnTo contract.
const CONVERSION_ROUTES = ["todays-price", "reserve", "test-drive", "contact"];

describe("VehiclePassportGoverned — desktop conversion routing", () => {
  it.each(CONVERSION_ROUTES)('opens the complete V2 %s page via go("%s")', (action) => {
    expect(SRC).toContain(`go("${action}")`);
  });

  it("routes every V2 destination through the returnTo contract (buildPassportActionPath)", () => {
    // go() is implemented via buildPassportActionPath so the destination's
    // "Back to Vehicle Passport" can return to the originating /v3/:slug URL.
    expect(SRC).toContain("buildPassportActionPath");
    expect(SRC).toContain("location.pathname");
  });

  it("no longer navigates away to investigate the same vehicle", () => {
    // Trade, Documents, Verification and the dealer page are drawers now.
    for (const gone of ["trade", "documents", "verification", "dealer"]) {
      expect(SRC).not.toContain(`go("${gone}")`);
    }
  });

  it("still reaches the formal reports, in a new tab so the passport survives", () => {
    expect(SRC).toMatch(/openFullReport\("great-buy"\)/);
    expect(SRC).toMatch(/const openFullReport = \(section: "verification" \| "great-buy"\)/);
  });

  it("keeps the mobile governed action drawer unchanged", () => {
    // Mobile V3 must not be converted to route into V2 — it keeps openAction()
    // + PassportActionDrawer.
    expect(SRC).toContain("openAction(");
    expect(SRC).toContain("PassportActionDrawer");
  });

  it("never surfaces the double-counted price — the fee is included, never re-added", () => {
    // Governance: the action center shows the doc-inclusive price and discloses
    // the fee; it must not construct price + docFee anywhere.
    expect(SRC).not.toMatch(/price\s*\+\s*d\.docFee/);
  });
});
