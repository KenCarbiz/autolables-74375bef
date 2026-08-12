import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The landing page renders the real SaturdayPremiumAddendum, not a replica of
// it, so what the showcase gets wrong is a data problem rather than a drawing
// problem. It shipped once with the masthead falling back to "HARTE INFINITI
// INC." set in type and the Lifetime Powertrain panel as plain text, because
// neither asset had been filed yet.

const root = join(__dirname, "../..");
const landing = readFileSync(join(__dirname, "Landing.tsx"), "utf8");

const ASSETS = [
  "public/harte-infiniti-logo.png",
  "public/lifetime-powertrain-warranty.png",
];

describe("the showcase addendum prints real artwork", () => {
  for (const asset of ASSETS) {
    it(`${asset} is in the build`, () => {
      // A referenced file that isn't committed prints as a hole on a 4.5x11
      // sheet — worse than the text fallback it replaced.
      expect(existsSync(join(root, asset)), `${asset} missing`).toBe(true);
    });
  }

  it("the masthead uses the dealership's own logo", () => {
    expect(landing).toMatch(/logoUrl: "\/harte-infiniti-logo\.png"/);
    // logoEnabled:false is what forced the wordmark fallback.
    expect(landing.slice(landing.indexOf("SHOWCASE_ADDENDUM"), landing.indexOf("SHOWCASE_ADDENDUM") + 900))
      .not.toMatch(/logoEnabled: false/);
  });

  it("the Lifetime Powertrain panel carries the stamp", () => {
    expect(landing).toMatch(/imageUrl: "\/lifetime-powertrain-warranty\.png"/);
    expect(landing).toMatch(/displayStyle: "image_text" as const/);
  });

  it("keeps Ask for details beside the stamp", () => {
    // displayStyle "image" drops the text column, and that line is the pointer
    // to the written limited warranty a "lifetime" claim has to carry
    // (16 CFR 239.4).
    const vp = landing.slice(landing.indexOf('id: "lifetime-powertrain"'));
    expect(vp.slice(0, 700)).toMatch(/showOnSticker|showAskForDetails: true/);
  });

  it("references no path with a space in it", () => {
    // The files landed as "Harte Infiniti logo with heart road.png"; an
    // unencoded space in a src is a 404 on some static hosts.
    for (const m of landing.matchAll(/(?:logoUrl|imageUrl): "([^"]+)"/g)) {
      expect(m[1], m[1]).not.toMatch(/\s/);
    }
  });
});
