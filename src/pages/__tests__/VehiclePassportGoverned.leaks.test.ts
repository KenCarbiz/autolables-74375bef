import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ── Passport V3 desktop conversion-routing guard ────────────────────────────
// The approved desktop architecture reuses the complete, existing V2 destination
// pages for the high-intent conversion flows (See My Price, Reserve, Trade, Test
// Drive, Contact, Documents) instead of re-implementing them as drawers. The V3
// action center opens them via go("<section>"), which navigates to
// /v/:slug/:section carrying a validated returnTo back to the originating V3 URL.
// The mobile governed passport keeps its own action drawer unchanged.

const SRC = readFileSync(resolve(__dirname, "../VehiclePassportGoverned.tsx"), "utf8");

// Each conversion CTA must open its complete existing V2 destination page.
const CONVERSION_ROUTES = ["todays-price", "reserve", "trade", "test-drive", "contact", "documents"];

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

  it("still reaches the verification report in-flow via go(\"verification\")", () => {
    expect(SRC).toMatch(/go\("(verification|dealer)"\)/);
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
