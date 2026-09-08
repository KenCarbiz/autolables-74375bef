import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Every claim the crawler harvests off a dealer's own VDP, pinned against a
// real one. The detectors were written from screenshots and prose descriptions
// of dealer pages; this is the first genuine markup they have been run on, and
// it immediately found a false positive that would have certified an entire
// used lot (see the nav-link case below).
//
// The detectors live in the edge function, which is outside tsconfig's
// `include`, so they are reconstructed here from the deployed source text --
// the same approach as cpoBadge.test.ts and cleanTitleBadge.test.ts.

const SRC = readFileSync(
  join(__dirname, "../../../supabase/functions/crawl-advertised-prices/index.ts"),
  "utf8",
);
const VDP = readFileSync(
  join(__dirname, "__fixtures__/harte-vdp-1c6srfft2nn400176.html"),
  "utf8",
);
const VIN = "1C6SRFFT2NN400176";

const literal = (name: string): RegExp => {
  const m = new RegExp(`const ${name} =\\s*\\n?\\s*(/.*?/[a-z]*);`, "s").exec(SRC);
  if (!m) throw new Error(`${name} not found in the crawler`);
  const body = m[1].slice(1, m[1].lastIndexOf("/"));
  return new RegExp(body, m[1].slice(m[1].lastIndexOf("/") + 1));
};
// A RegExp assembled from String.raw pieces joined by "+" rather than by "|".
const concatenated = (name: string, flags: string): RegExp => {
  const m = new RegExp(`const ${name} = new RegExp\\(([\\s\\S]*?)\\s*,\\s*"${flags}",?\\s*\\);`).exec(SRC);
  if (!m) throw new Error(`${name} not found in the crawler`);
  return new RegExp([...m[1].matchAll(/String\.raw`([^`]*)`/g)].map((x) => x[1]).join(""), flags);
};

const joined = (name: string, flags: string): RegExp => {
  const m = new RegExp(
    `const ${name} = new RegExp\\(\\s*\\[([\\s\\S]*?)\\]\\.join\\("\\|"\\),\\s*"${flags}",?\\s*\\)`,
  ).exec(SRC);
  if (!m) throw new Error(`${name} not found in the crawler`);
  return new RegExp([...m[1].matchAll(/String\.raw`([^`]*)`/g)].map((x) => x[1]).join("|"), flags);
};

// Mirrors evidenceHtml: navigation labels and description prose are removed
// before any badge is read.
const LISTING_HREF_RE = literal("LISTING_HREF_RE");
const DESCRIPTION_BLOCK_RE = concatenated("DESCRIPTION_BLOCK_RE", "gi");
const strip = (html: string): string =>
  html
    .replace(/<a\b([^>]*)>([\s\S]{0,400}?)<\/a>/gi, (whole, attrs: string) => {
      const href = /href=["']([^"']*)["']/i.exec(attrs)?.[1] ?? "";
      return href && LISTING_HREF_RE.test(href) ? " " : whole;
    })
    .replace(DESCRIPTION_BLOCK_RE, " ");

const ONE_OWNER_RE = joined("ONE_OWNER_RE", "i");
const detectOneOwnerBadge = (html: string) => ONE_OWNER_RE.test(strip(html));

const CPO_RE = joined("CPO_RE", "i");
const GENERIC_CERT_RE = literal("GENERIC_CERT_RE");
const detectCpoBadge = (raw: string) => {
  const html = strip(raw);
  return CPO_RE.test(html) && !(GENERIC_CERT_RE.test(html) && !/certified\s+pre[-\s]?owned/i.test(html));
};

const CLEAN_TITLE_RE = joined("CLEAN_TITLE_RE", "gi");
const CLEAN_TITLE_CONDITION_RE = literal("CLEAN_TITLE_CONDITION_RE");
const CLEAN_TITLE_PROCESS_RE = literal("CLEAN_TITLE_PROCESS_RE");
const detectCleanTitleBadge = (raw: string): boolean => {
  const html = strip(raw);
  const attrs = [...html.matchAll(/(?:alt|title)=["']([^"']{0,120})["']/gi)].map((m) => m[1]);
  const text = `${html.replace(/<[^>]+>/g, " ")} | ${attrs.join(" | ")}`
    .replace(/&nbsp;?/gi, " ").replace(/\s+/g, " ");
  CLEAN_TITLE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CLEAN_TITLE_RE.exec(text))) {
    const end = m.index + m[0].length;
    if (CLEAN_TITLE_CONDITION_RE.test(text.slice(Math.max(0, m.index - 40), m.index))) continue;
    if (CLEAN_TITLE_PROCESS_RE.test(text.slice(end, end + 28))) continue;
    return true;
  }
  return false;
};

const CARFAX_TOKEN_RE = literal("CARFAX_TOKEN_RE");
const extractCarfaxToken = (html: string) => {
  CARFAX_TOKEN_RE.lastIndex = 0;
  return CARFAX_TOKEN_RE.exec(html)?.[0] ?? null;
};

describe("a real Harte INFINITI VDP", () => {
  it("yields the dealer's own CARFAX report link", () => {
    // The tokenized dealer link, not a marketplace's. This is the field sitting
    // at 1 of 132 because the crawl has been down since 2026-08-24.
    expect(extractCarfaxToken(VDP)).toBe(
      "https://www.carfax.com/vehiclehistory/ar20/j11zJk1vYp3AqeNKRvMX_Lom88VXmCuLWYIeBXXCz1ammP3eKPHFN86hSsS8j1Xa0zwxyY-OF7luYJzo1Dz1X17FnxCug1NVtg4",
    );
    expect(VDP).toContain(VIN);
  });

  it("still reads one-owner after the description is discarded", () => {
    // Survives because the evidence is third-party: CARFAX's own badge art
    // (alt="carfax-oneowner", served from partnerstatic.carfax.com) and
    // CarStory's independent "CARFAX One-Owner" panel.
    expect(detectOneOwnerBadge(VDP)).toBe(true);
    expect(strip(VDP)).not.toContain("one-owner commercial vehicle");
    expect(strip(VDP)).toContain('alt="carfax-oneowner"');
  });

  it("does NOT take clean title from a description we wrote ourselves", () => {
    // "no title brands" is on this page exactly once, inside the description
    // block -- which is AutoLabels-generated copy syndicated back to the dealer
    // site (unrendered markdown: "## 2022 Ram 1500", "**VIN:** ..."). Reading it
    // back as a verified flag would launder our own output into a source of
    // truth, and the passport prints this flag as a title-brand claim.
    expect(VDP).toContain("no title brands");
    expect(detectCleanTitleBadge(VDP)).toBe(false);

    // The same sentence outside a description block is still evidence.
    expect(detectCleanTitleBadge("<p>CARFAX reports no title brands.</p>")).toBe(true);
  });

  it("does NOT certify this used truck off the footer inventory nav", () => {
    // The regression this fixture exists for. Every page on a Team Velocity
    // site carries <a href="/inventory/cpo">Certified Pre-Owned Vehicles</a>,
    // so a whole-document match certified all 132 vehicles as manufacturer-
    // backed -- a warranty claim the dealer never made.
    expect(CPO_RE.test(VDP)).toBe(true);
    expect(detectCpoBadge(VDP)).toBe(false);
  });
});

describe("navigation stripping", () => {
  it("drops labels of links that point at listing pages", () => {
    expect(detectCpoBadge('<a href="/inventory/cpo">Certified Pre-Owned Vehicles</a>')).toBe(false);
    expect(detectCpoBadge('<a href="https://d.com/inventory/used">Certified Pre-Owned</a>')).toBe(false);
    expect(detectOneOwnerBadge('<a href="/inventory/specials">CARFAX One-Owner Specials</a>')).toBe(false);
  });

  it("keeps claims a real CPO page makes about the car itself", () => {
    expect(detectCpoBadge('<h1>Certified 2023 INFINITI QX60</h1><h2>INFINITI Certified Pre-Owned</h2>')).toBe(true);
    expect(detectCpoBadge('<a href="/inventory/cpo">Certified Pre-Owned Vehicles</a><h2>Factory-Certified with warranty</h2>')).toBe(true);
  });

  it("leaves the CARFAX report anchor alone", () => {
    // /vehiclehistory/ must not read as a "vehicles" listing path.
    expect(strip(VDP)).toContain("carfax.com/vehiclehistory/ar20/");
  });
});
