import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The clean-title detector lives in the edge function, which is outside
// tsconfig's `include`, so it is exercised here against the deployed source
// text. mc_attributes.carfax_clean_title is null on every vehicle MarketCheck
// sends, and the passport prints this flag as "Clean Title — no salvage, flood,
// or lemon". A regression that made it fire on "title loans" or on a financing
// disclaimer would put an unearned title claim in front of a shopper.

const SRC = readFileSync(
  join(__dirname, "../../../supabase/functions/crawl-advertised-prices/index.ts"),
  "utf8",
);

const literal = (name: string): RegExp => {
  const m = new RegExp(`const ${name} =\\s*\\n?\\s*(/.*?/[a-z]*);`, "s").exec(SRC);
  if (!m) throw new Error(`${name} not found in the crawler`);
  const body = m[1].slice(1, m[1].lastIndexOf("/"));
  return new RegExp(body, m[1].slice(m[1].lastIndexOf("/") + 1));
};

function buildDetector() {
  const parts = SRC.match(/const CLEAN_TITLE_RE = new RegExp\(\s*\[([\s\S]*?)\]\.join\("\|"\),\s*"gi",\s*\)/);
  if (!parts) throw new Error("CLEAN_TITLE_RE not found in the crawler");
  const CLEAN_TITLE_RE = new RegExp(
    [...parts[1].matchAll(/String\.raw`([^`]*)`/g)].map((m) => m[1]).join("|"),
    "gi",
  );
  const CONDITION = literal("CLEAN_TITLE_CONDITION_RE");
  const PROCESS = literal("CLEAN_TITLE_PROCESS_RE");
  // Mirrors stripNavigationLinks: an anchor pointing at a listing page is
  // navigation, and its label is not a claim about this car.
  const listingHref = /const LISTING_HREF_RE =\s*\n?\s*(\/.*?\/[a-z]*);/s.exec(SRC);
  if (!listingHref) throw new Error("LISTING_HREF_RE not found in the crawl source");
  const LISTING_HREF_RE = new RegExp(
    listingHref[1].slice(1, listingHref[1].lastIndexOf("/")),
    listingHref[1].slice(listingHref[1].lastIndexOf("/") + 1),
  );
  const descBlock = /const DESCRIPTION_BLOCK_RE = new RegExp\(([\s\S]*?)\s*,\s*"gi",?\s*\);/.exec(SRC);
  if (!descBlock) throw new Error("DESCRIPTION_BLOCK_RE not found in the crawl source");
  const DESCRIPTION_BLOCK_RE = new RegExp(
    [...descBlock[1].matchAll(/String\.raw`([^`]*)`/g)].map((m) => m[1]).join(""),
    "gi",
  );
  const strip = (html: string): string =>
    html
      .replace(/<a\b([^>]*)>([\s\S]{0,400}?)<\/a>/gi, (whole, attrs: string) => {
        const href = /href=["']([^"']*)["']/i.exec(attrs)?.[1] ?? "";
        return href && LISTING_HREF_RE.test(href) ? " " : whole;
      })
      .replace(DESCRIPTION_BLOCK_RE, " ");
  // Mirrors detectCleanTitleBadge.
  return (raw: string): boolean => {
    const html = strip(raw);
    const attrs = [...html.matchAll(/(?:alt|title)=["']([^"']{0,120})["']/gi)].map((m) => m[1]);
    const text = `${html.replace(/<[^>]+>/g, " ")} | ${attrs.join(" | ")}`
      .replace(/&nbsp;?/gi, " ").replace(/\s+/g, " ");
    CLEAN_TITLE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = CLEAN_TITLE_RE.exec(text))) {
      const end = m.index + m[0].length;
      if (CONDITION.test(text.slice(Math.max(0, m.index - 40), m.index))) continue;
      if (PROCESS.test(text.slice(end, end + 28))) continue;
      return true;
    }
    return false;
  };
}

describe("dealer VDP clean-title detector (T1)", () => {
  const detect = buildDetector();

  it("fires on the badge wording a shopper actually sees", () => {
    expect(detect(`<span class="badge">Clean Title</span>`)).toBe(true);
    expect(detect(`<li>Clean Title History</li>`)).toBe(true);
    expect(detect(`<p>Clean vehicle title, sold new here.</p>`)).toBe(true);
  });

  it("reads a title row out of a spec table, with or without a colon", () => {
    expect(detect(`<dt>Title Status</dt><dd>Clean</dd>`)).toBe(true);
    expect(detect(`<li><strong>Title:</strong> Clean</li>`)).toBe(true);
    expect(detect(`<tr><td>Title Brand</td><td>None</td></tr>`)).toBe(true);
    expect(detect(`<div>No title brands reported</div>`)).toBe(true);
  });

  it("fires on the CARFAX badge cluster and on badge alt text", () => {
    expect(detect(
      `<div class="cfx">CARFAX 1-Owner &middot; No Accidents or Damage Reported &middot; Clean Title &middot; Personal Use</div>`,
    )).toBe(true);
    expect(detect(`<img src="/cfx.svg" alt="CARFAX Clean Title Reported">`)).toBe(true);
  });
});

describe("what the detector refuses to read as a clean title (T2)", () => {
  const detect = buildDetector();

  it("does not fire on 'clean' about anything but the title", () => {
    // The whole reason the two concepts must be adjacent: "clean" is on every
    // used-car page there is.
    expect(detect(`<p>Clean interior, freshly detailed, clean CARFAX.</p>`)).toBe(false);
    expect(detect(`<span>Non-Smoker</span><span>Clean, low-mileage trade</span>`)).toBe(false);
  });

  it("does not fire on 'title' used for anything but this car's title brand", () => {
    expect(detect(`<nav><a href="/title-loans">Title Loans</a><a href="/clean-cars">Clean Cars</a></nav>`)).toBe(false);
    expect(detect(`<p>We will clean up your title paperwork before delivery.</p>`)).toBe(false);
    expect(detect(`<p>Our team handles clean title transfers at the DMV desk.</p>`)).toBe(false);
  });

  it("does not read a finance disclaimer as a claim about this car", () => {
    expect(detect(`<small>Approval requires a clean title and proof of insurance.</small>`)).toBe(false);
    expect(detect(`<small>Trade-in value assumes a clean title.</small>`)).toBe(false);
    expect(detect(`<small>All vehicles are clean title unless otherwise noted.</small>`)).toBe(false);
  });

  it("never reads a branded title as a clean one", () => {
    expect(detect(`<dt>Title Status</dt><dd>Salvage</dd>`)).toBe(false);
    expect(detect(`<li>Rebuilt title, priced accordingly</li>`)).toBe(false);
    expect(detect(`<p>Flood damage reported on the title.</p>`)).toBe(false);
  });

  it("is positive-only: an ordinary used VDP asserts nothing", () => {
    // Absence of the badge is not evidence of a brand. This is the case that
    // must stay false, because false here means "we did not read it", not
    // "this car is branded".
    expect(detect(`<h1>2023 INFINITI QX60 LUXE AWD</h1><p>One owner, no accidents.</p>`)).toBe(false);
  });

  it("still fires when a real badge shares the page with a disclaimer", () => {
    expect(detect(`
      <span class="badge">Clean Title</span>
      <small>Financing approval requires a clean title.</small>
    `)).toBe(true);
  });
});

describe("what the crawl records (T3)", () => {
  const block = () => {
    const start = SRC.indexOf("if (detectCleanTitleBadge(html))");
    if (start < 0) throw new Error("clean-title backfill not found in the crawler");
    return SRC.slice(start, start + 1200);
  };

  it("records its own source so a page confirmation stays distinct from a feed flag", () => {
    expect(block()).toContain('clean_title_source: "dealer_vdp"');
  });

  it("only ever asserts the positive — it never writes false", () => {
    expect(block()).toContain("carfax_clean_title: true");
    expect(block()).not.toContain("carfax_clean_title: false");
  });

  it("never overwrites an existing flag or a contradicting title brand", () => {
    const b = block();
    expect(b).toContain("mct.carfax_clean_title !== true");
    expect(b).toContain("mct.carfax_clean_title === false");
    expect(b).toMatch(/mct\.title_brand \?\? mct\.title_status/);
    expect(b).toContain("!contradicted");
  });

  it("only trusts the dealer's own site, not a marketplace page", () => {
    const gate = SRC.lastIndexOf('=== "website"', SRC.indexOf("if (detectCleanTitleBadge(html))"));
    expect(gate).toBeGreaterThan(-1);
  });

  it("never fails a price run over it", () => {
    const after = SRC.slice(SRC.indexOf("if (detectCleanTitleBadge(html))"));
    expect(after.slice(0, 1400)).toMatch(/catch \{/);
  });
});
