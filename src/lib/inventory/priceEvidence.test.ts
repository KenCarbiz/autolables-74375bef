import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// AutoLabels writes the vehicle descriptions that appear on dealer websites.
// Those descriptions talk about money. The crawler then reads those same pages
// to establish what the dealer independently advertised -- so any price
// extracted from the description block is us citing ourselves, and unlike the
// badge detectors this one PERSISTS and RENDERS: extractPriceComponents feeds
// dealer_discount / website_sale_price, which reach the customer passport as a
// "Dealer Discount" line.
//
// The extractors live in the edge function, outside tsconfig's include, so they
// are reconstructed here from the deployed source -- the same approach as
// cpoBadge.test.ts and dealerVdpBadges.test.ts.

const SRC = readFileSync(
  join(__dirname, "../../../supabase/functions/crawl-advertised-prices/index.ts"),
  "utf8",
);
const FIXTURE = readFileSync(
  join(__dirname, "__fixtures__/harte-vdp-1c6srfft2nn400176.html"),
  "utf8",
);

// Mirrors priceEvidenceHtml: description prose out, navigation left in.
const descBlock = /const DESCRIPTION_BLOCK_RE = new RegExp\(([\s\S]*?)\s*,\s*"gi",?\s*\);/.exec(SRC);
if (!descBlock) throw new Error("DESCRIPTION_BLOCK_RE not found in the crawl source");
const DESCRIPTION_BLOCK_RE = new RegExp(
  [...descBlock[1].matchAll(/String\.raw`([^`]*)`/g)].map((m) => m[1]).join(""),
  "gi",
);
const priceEvidenceHtml = (html: string) => html.replace(DESCRIPTION_BLOCK_RE, " ");

// Deliberately wider than the crawler's own moneyRe, which ignores bare
// three-digit values: a test helper that shares the code's blind spots cannot
// see what the code drops.
const money = (s: string): number[] =>
  [...s.matchAll(/\$\s?(\d{1,3}(?:,\d{3})+|\d{3,6})/g)].map((m) => Number(m[1].replace(/,/g, "")));

const wrapDescription = (inner: string) =>
  `<div class="pt-1 px-1 pb-3 vehicle-description">${inner}</div>`;

describe("our own copy is removed before any price is read", () => {
  it("drops the window-sticker MSRP sentence AutoLabels wrote", () => {
    // Verbatim from the live Harte VDP. $56,945 is a number we published about
    // a document we do not hold, sitting on the dealer's page as if it were
    // theirs.
    expect(FIXTURE).toContain("$56,945");
    expect(money(priceEvidenceHtml(FIXTURE))).not.toContain(56945);
  });

  it("keeps every number in the dealer's own price stack", () => {
    // The strip must not cost us the data we came for.
    const kept = money(priceEvidenceHtml(FIXTURE));
    expect(kept).toContain(36925); // Market Value
    expect(kept).toContain(25876); // Sale Price
    expect(kept).toContain(24981); // disclaimer selling price
    expect(kept).toContain(2498);  // down payment (present, and correctly ignored downstream)
  });

  it("removes generated 'savings' copy that extractPriceComponents would match", () => {
    // valueForLabel is first-match-wins with no rejection list, and its
    // dealerDiscount alternation includes a bare "savings".
    const page = wrapDescription("Total savings of $4,000 on this vehicle.")
      + '<span>Dealer Discount</span><span>$1,200</span>';
    const kept = money(priceEvidenceHtml(page));
    expect(kept).not.toContain(4000);
    expect(kept).toContain(1200);
  });

  it("removes generated 'discount' copy too", () => {
    const page = wrapDescription("A manufacturer discount of $7,500 applies.")
      + '<span>Conveyance Fee</span><span>$895</span>';
    const kept = money(priceEvidenceHtml(page));
    expect(kept).not.toContain(7500);
    expect(kept).toContain(895);
  });

  it("leaves the real dealer discount line untouched", () => {
    const page = '<span class="msrp-text">Discount</span><span>-$11,944</span>';
    expect(money(priceEvidenceHtml(page))).toContain(11944);
  });

  it("leaves the finance down payment where it is", () => {
    // $2,498 must survive the strip: it is the dealer's own markup, and the
    // protection against it becoming a price is the extractor's scoring, not
    // this strip. Removing it here would hide a real extraction bug.
    const page = '<div class="ft-13">$2,498.00 down payment</div>';
    expect(money(priceEvidenceHtml(page))).toContain(2498);
  });
});

describe("navigation is deliberately NOT stripped for prices", () => {
  it("keeps prices inside listing anchors", () => {
    // A search or listing page carries its real prices inside exactly the
    // anchors the badge-detector strip removes. Using that strip here would
    // break discovery to fix a problem discovery does not have.
    const page = '<a href="/inventory/used/vin123"><span>Sale Price</span><span>$25,876</span></a>';
    expect(money(priceEvidenceHtml(page))).toContain(25876);
  });
});

describe("the extractors are actually wired to it", () => {
  it("every VDP price extraction call passes through priceEvidenceHtml", () => {
    // The fix that was missed the first time: evidenceHtml was applied to the
    // three badge detectors and to nothing else, so the price path -- the one
    // that persists and renders -- kept reading raw HTML.
    expect(SRC).toContain("const comp = extractPriceComponents(priceEvidenceHtml(html));");
    const rawAdvertised = [...SRC.matchAll(/extractAdvertised\(\s*(\w+)[.\w]*\s*,/g)]
      .map((m) => m[1]);
    // Discovery calls (empty VIN) may read raw HTML; every VIN-scoped call must not.
    for (const m of SRC.matchAll(/extractAdvertised\(([^)]*)\)/g)) {
      const args = m[1];
      if (/\bvin\b/.test(args) && !/""/.test(args)) {
        expect(args, `VIN-scoped extractAdvertised must strip description: ${args}`)
          .toContain("priceEvidenceHtml");
      }
    }
    expect(rawAdvertised.length).toBeGreaterThan(0);
  });

  it("keeps the badge detectors on the stricter strip", () => {
    // Badges still get navigation removed as well -- a footer "Certified
    // Pre-Owned Vehicles" link must not certify a used truck.
    expect(SRC).toContain("stripDescriptionBlocks(stripNavigationLinks(html))");
  });
});
