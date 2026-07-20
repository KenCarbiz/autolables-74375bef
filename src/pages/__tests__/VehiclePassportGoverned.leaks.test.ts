import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ── Phase D non-regression guard ────────────────────────────────────────────
// A shopper on the governed V3 passport must never be routed into the V2 detail
// pages (/v/:slug/<action>). Primary/secondary actions open the governed V3
// action drawer via openAction(...) instead. This test fails if any action
// re-introduces a go("<v2-action>") leak.

const SRC = readFileSync(resolve(__dirname, "../VehiclePassportGoverned.tsx"), "utf8");

// Actions whose only governed destination is the V3 action drawer — they must
// NEVER appear as go("...") (which navigates into VehiclePassportV2Detail).
const FORBIDDEN_ACTION_ROUTES = [
  "reserve",
  "test-drive",
  "trade",
  "contact",
  "todays-price",
  "check-availability",
  "text",
];

describe("VehiclePassportGoverned — no V3→V2 action route leaks", () => {
  it.each(FORBIDDEN_ACTION_ROUTES)('never calls go("%s") — must use the governed V3 action drawer', (action) => {
    expect(SRC).not.toContain(`go("${action}")`);
  });

  it("routes actions through the governed openAction() drawer", () => {
    expect(SRC).toContain("openAction(");
    expect(SRC).toContain("PassportActionDrawer");
  });

  it("still allows governed V3-in-flow destination pages (verification / great-buy / dealer)", () => {
    // These render dedicated governed pages, not the V2 detail passport, so they
    // remain acceptable in-flow routes.
    expect(SRC).toMatch(/go\("(verification|great-buy|dealer)"\)/);
  });
});
