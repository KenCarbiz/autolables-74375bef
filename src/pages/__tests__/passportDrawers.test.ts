import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PASSPORT_PANEL_KEYS, isPassportPanelKey } from "@/components/passport/passportPanelKeys";

// The passport is the shopper's home base. Investigating the SAME vehicle
// (warranty, history, equipment, specs, dealer, verification, documents) must
// open over it; only a substantial task, a contact form, a formal printable
// report, an external document, or a different vehicle earns a page.
//
// These assert the wiring at the call sites, because "it opened a drawer" is a
// property of which handler a button was given.

const ROOT = join(__dirname, "..", "..", "..");
const passport = readFileSync(join(ROOT, "src/pages/VehiclePassportGoverned.tsx"), "utf8");
const panels = readFileSync(join(ROOT, "src/components/passport/passportTrustPanels.tsx"), "utf8");
const slideOver = readFileSync(join(ROOT, "src/components/passport/PassportSlideOver.tsx"), "utf8");
const trade = readFileSync(join(ROOT, "src/components/passport/PassportTradeDrawer.tsx"), "utf8");
const dispatcher = readFileSync(join(ROOT, "src/components/passport/PassportPanel.tsx"), "utf8");

describe("informational actions open a drawer, not a page", () => {
  it("registers one panel key per informational destination", () => {
    for (const k of ["title-brand", "vehicle-history", "verification-categories", "documents", "dealer-profile"]) {
      expect(isPassportPanelKey(k)).toBe(true);
    }
  });

  it("keeps the existing working drawers untouched", () => {
    // Price History and Similar Vehicles were already correct; they must not
    // have been converted back to pages.
    for (const k of ["price-history", "comparable-vehicles", "market-price", "factory-warranty", "equipment", "key-specs", "ownership-timeline"]) {
      expect(PASSPORT_PANEL_KEYS).toContain(k);
    }
    expect(passport).toMatch(/openPanel\("price-history"\)/);
    expect(passport).toMatch(/openPanel\("comparable-vehicles"\)/);
  });

  it("sends Title & Brand review to its own drawer", () => {
    expect(passport).toMatch(/openPanel\(key === "title" \? "title-brand"/);
  });

  it("sends vehicle-history review to the history drawer", () => {
    expect(passport).toMatch(/"vehicle-history" : "verification-categories"/);
  });

  it("opens View All Categories as a drawer rather than the full report", () => {
    expect(passport).toMatch(/onClick=\{\(\) => openPanel\("verification-categories"\)\}[^]{0,200}View all categories/);
  });

  it("routes BOTH Documents entry points to the same drawer", () => {
    // The Customer Action Center tile and the "All Documents" link.
    const tile = passport.match(/label: "Documents", icon: FileText, onClick: \(\) => openPanel\("documents"\)/g) ?? [];
    const all = passport.match(/onAllDocuments=\{\(\) => openPanel\("documents"\)\}/g) ?? [];
    expect(tile.length).toBe(2);   // mobile + desktop action centres
    expect(all.length).toBe(2);    // mobile + desktop module cards
  });

  it("opens the dealer drawer instead of the dealership page", () => {
    expect(passport).toMatch(/openPanel\("dealer-profile"\)/);
    expect(passport).not.toMatch(/go\("dealer"\)/);
  });

  it("no longer navigates to the verification page from the passport body", () => {
    expect(passport).not.toMatch(/go\("verification"\)/);
  });
});

describe("a formal report keeps the passport alive behind it", () => {
  it("opens the full report in a new tab", () => {
    expect(passport).toMatch(/window\.open\(url, "_blank", "noopener"\)/);
  });

  it("renames the buying-report link so the destination is clear", () => {
    expect(passport).toMatch(/Open Full Buying Report/);
    expect(passport).not.toMatch(/See full buying report/);
    expect(passport).not.toMatch(/View full buying report/);
  });

  it("still offers the full verification report from inside the drawers", () => {
    expect(panels).toMatch(/label: "Open Full Verification Report"/);
  });
});

describe("the drawer state lives in the URL", () => {
  it("reads the open drawer from ?panel=", () => {
    expect(passport).toMatch(/isPassportPanelKey\(search\.get\("panel"\)\)/);
  });

  it("pushes a history entry on open so Back closes the drawer", () => {
    expect(passport).toMatch(/next\.set\("panel", k\);[\s\S]{0,60}setSearch\(next, \{ replace: false \}\)/);
  });

  it("replaces on close so a closed drawer leaves no forward entry", () => {
    expect(passport).toMatch(/next\.delete\("panel"\);[\s\S]{0,60}setSearch\(next, \{ replace: true \}\)/);
  });

  it("does not remount the passport to open a drawer", () => {
    // No navigate() in the open/close path — that is what would drop scroll
    // position and refetch the listing.
    const openFn = passport.slice(passport.indexOf("const openPanel"), passport.indexOf("const openTrade"));
    expect(openFn).not.toMatch(/navigate\(/);
  });
});

describe("drawer mechanics meet the accessibility bar", () => {
  it("is a labelled modal dialog", () => {
    expect(slideOver).toMatch(/role="dialog"/);
    expect(slideOver).toMatch(/aria-modal="true"/);
    expect(slideOver).toMatch(/aria-label=\{title\}/);
  });

  it("closes on Escape and traps Tab", () => {
    expect(slideOver).toMatch(/if \(e\.key === "Escape"\)/);
    expect(slideOver).toMatch(/if \(e\.shiftKey && document\.activeElement === first\)/);
  });

  it("locks body scroll and scrolls the drawer independently", () => {
    expect(slideOver).toMatch(/body\.style\.overflow = "hidden"/);
    expect(slideOver).toMatch(/flex-1 overflow-y-auto/);
  });

  it("gives the passport its exact scroll position back on close", () => {
    // `overflow: hidden` alone collapses the document, so the browser clamps
    // scrollY on the way in and there is nothing to restore on the way out —
    // opening a drawer deep in the passport and closing it returned the shopper
    // near the top. Pinning the body holds the position; the cleanup restores it.
    expect(slideOver).toMatch(/const y = window\.scrollY;/);
    expect(slideOver).toMatch(/body\.style\.position = "fixed";/);
    expect(slideOver).toMatch(/body\.style\.top = `-\$\{y\}px`;/);
    expect(slideOver).toMatch(/window\.scrollTo\(0, y\);/);
  });

  it("keeps a sticky header and an optional sticky footer", () => {
    expect(slideOver).toMatch(/shrink-0 bg-white border-b/);
    expect(slideOver).toMatch(/shrink-0 bg-white border-t/);
  });

  it("respects the mobile safe area in the footer", () => {
    expect(slideOver).toMatch(/env\(safe-area-inset-bottom\)/);
  });

  it("sits in the 560-680px band on desktop and full-width on mobile", () => {
    expect(slideOver).toMatch(/w-full bg-\[#F6F7F9\]/);
    expect(slideOver).toMatch(/md:w-\[600px\] xl:w-\[660px\] 2xl:w-\[680px\]/);
  });
});

describe("the document drawer cannot scroll the page sideways", () => {
  it("lets long titles wrap instead of widening the drawer", () => {
    expect(panels).toMatch(/break-words/);
  });

  it("constrains the grid and its cells", () => {
    expect(panels).toMatch(/grid grid-cols-1 sm:grid-cols-2 gap-3 min-w-0/);
    expect(panels).toMatch(/min-w-0 flex-1 flex flex-col/);
  });

  it("does not repeat the passport section menu inside the drawer", () => {
    expect(panels).not.toMatch(/PASSPORT_NAV/);
    expect(panels).not.toMatch(/Ownership Timeline/);
  });

  it("opens external documents in a new tab with safe link attributes", () => {
    const anchors = panels.match(/target="_blank"/g) ?? [];
    const safe = panels.match(/rel="noopener noreferrer"/g) ?? [];
    expect(anchors.length).toBeGreaterThan(0);
    expect(safe.length).toBe(anchors.length);
  });

  it("keeps 'why this matters' as supporting text, not a competing action", () => {
    expect(panels).toMatch(/<summary[^>]*>[\s\S]{0,120}Why this matters/);
  });
});

describe("pending is never dressed up as a result", () => {
  it("says explicitly that pending is not a negative finding", () => {
    expect(panels).toMatch(/Pending is not a negative result/);
  });

  it("describes an unavailable source as a gap in records, not a clean bill", () => {
    expect(panels).toMatch(/a gap in the records, not a finding about the car/);
  });

  it("renders the canonical status wording rather than its own", () => {
    expect(panels).toMatch(/VERIFICATION_STATUS_LABEL\[status\]/);
    expect(panels).not.toMatch(/"Looks good"|"All clear"/);
  });

  it("shows each source's own last-checked date, not the render time", () => {
    expect(panels).toMatch(/Last checked:/);
    expect(panels).toMatch(/\{when \?\? \(check\.status === "pending" \? "Refresh pending" : "Not recorded"\)\}/);
    // The date comes off the check, never off a new Date() at render time.
    const src = panels.slice(panels.indexOf("const SourceLine"), panels.indexOf("const EvidenceList"));
    expect(src).toMatch(/fmtDate\(check\.checkedAt\)/);
    expect(src).not.toMatch(/Date\.now\(\)/);
  });
});

describe("the trade flow appraises a vehicle instead of harvesting contacts", () => {
  it("asks what the shopper drives before who they are", () => {
    const order = ["identify", "details", "result", "contact"];
    const positions = order.map((s) => trade.indexOf(`case "${s}":`));
    expect(positions.every((p) => p > -1)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it("identifies by VIN or plate + state", () => {
    expect(trade).toMatch(/setMode\(m\)/);
    expect(trade).toMatch(/By licence plate/);
    expect(trade).toMatch(/const VIN_RE = \/\^\[A-HJ-NPR-Z0-9\]\{17\}\$\//);
  });

  it("captures mileage and condition", () => {
    expect(trade).toMatch(/label="Current mileage"/);
    expect(trade).toMatch(/const CONDITIONS/);
  });

  it("computes no value of its own", () => {
    // Every number shown comes from the provider response. There is no local
    // estimate, multiplier, or depreciation curve anywhere in this file.
    const render = trade.slice(trade.indexOf('case "result":'), trade.indexOf('case "contact":'));
    expect(render).toMatch(/valuation\?\.available && valuation\.low != null/);
    expect(trade).not.toMatch(/0\.8[0-9]?\s*\*/);
    expect(trade).not.toMatch(/estimatedValue\s*=/);
  });

  it("offers only what it can deliver when no valuation came back", () => {
    expect(trade).toMatch(/valuation\?\.available \? "Apply this to my deal" : "Ask About My Trade"/);
    expect(trade).toMatch(/we're not going to guess at a number/);
  });

  it("says a range is a guide, not an offer", () => {
    expect(trade).toMatch(/This is a guide, not an offer/);
  });

  it("keeps A2P-compliant consent language", () => {
    expect(trade).toMatch(/Reply STOP to opt out/);
    expect(trade).toMatch(/Consent is\s*\n?\s*not a condition of purchase/);
  });

  it("carries the purchase vehicle into the appraisal record", () => {
    expect(trade).toMatch(/purchase_vin: listing\.vin/);
    expect(trade).toMatch(/store_id: listing\.store_id/);
    expect(trade).toMatch(/source_page:/);
    expect(trade).toMatch(/campaign:/);
  });

  it("tracks the funnel without shipping personal details", () => {
    for (const e of ["trade_appraisal_started", "trade_vehicle_identified", "trade_valuation_viewed", "lead_submitted"]) {
      expect(passport + trade).toContain(e);
    }
    const calls = trade.match(/track\("[a-z_]+", \{[^}]*\}\)/g) ?? [];
    for (const c of calls) {
      expect(c).not.toMatch(/name|email|phone|contact/);
    }
  });
});

describe("the Customer Action Center says what it does", () => {
  it("has retired See My Price everywhere on this passport", () => {
    expect(passport).not.toMatch(/See My Price/);
  });

  it("names the payment builder", () => {
    expect(passport).toMatch(/label: "Build My Payment"/);
    expect(passport).toMatch(/Build My Payment <ChevronRight/);
  });

  it("leads with Schedule Test Drive, then Reserve", () => {
    expect(passport).toMatch(/const actPrimary = \{ label: "Schedule Test Drive"/);
    expect(passport).toMatch(/const actReserve = \{ label: "Reserve This Vehicle"/);
    expect(passport.indexOf("const actPrimary")).toBeLessThan(passport.indexOf("const actReserve"));
  });

  it("pairs Value My Trade with Build My Payment, then the lower-emphasis row", () => {
    const g1 = passport.slice(passport.indexOf("const actGrid1"), passport.indexOf("const actGrid2"));
    expect(g1).toMatch(/Value My Trade/);
    expect(g1).toMatch(/Build My Payment/);
    const g2 = passport.slice(passport.indexOf("const actGrid2"), passport.indexOf("const actUtility"));
    expect(g2).toMatch(/Ask a Question/);
    expect(g2).toMatch(/Documents/);
  });

  it("keeps Save, Share and Watch Price in the utility row", () => {
    const u = passport.slice(passport.indexOf("const actUtility"), passport.indexOf("const label3"));
    expect(u).toMatch(/Save/);
    expect(u).toMatch(/Share/);
    expect(u).toMatch(/Watch Price/);
  });

  it("does not claim a server save when the state is device-local", () => {
    expect(passport).toMatch(/Saved to your list on this device/);
  });
});

describe("only one persistent CTA system is on screen", () => {
  it("hides the floating dock while the action centre is visible", () => {
    expect(passport).toMatch(/\{!actionCenterInView && <PassportCtaDock/);
  });

  it("observes the action centre rather than guessing from scroll position", () => {
    expect(passport).toMatch(/const ob = new IntersectionObserver\(\(\[e\]\) => setActionCenterInView\(e\.isIntersecting\)/);
    expect(passport).toMatch(/<div ref=\{actionCenterRef\}/);
  });

  it("keeps the mobile sticky rail, where no action centre is pinned", () => {
    expect(passport).toMatch(/\{!isDesktop && stickyCfg\.enabled && \(/);
  });
});

describe("the dispatcher routes trust keys without duplicating the shell", () => {
  it("delegates to one builder and falls back to the original", () => {
    expect(dispatcher).toMatch(/isTrustPanelKey\(key\)/);
    expect(dispatcher).toMatch(/buildTrustPanel\(key, \{/);
  });

  it("reuses the single PassportSlideOver shell", () => {
    expect(dispatcher).toMatch(/<PassportSlideOver/);
    // No second drawer implementation anywhere in the panels module.
    expect(panels).not.toMatch(/role="dialog"/);
    expect(panels).not.toMatch(/fixed inset-0/);
  });
});
