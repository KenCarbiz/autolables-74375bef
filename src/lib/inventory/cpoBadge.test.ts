import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The CPO detector lives in the edge function, which is outside tsconfig's
// `include`, so it is exercised here against the deployed source text. The
// description engine refuses CPO language on a feed flag alone; this detector
// is the independent confirmation that unblocks it, so a regression that makes
// it fire on "certified technicians" would put an unearned warranty claim into
// customer-facing copy.

const SRC = readFileSync(
  join(__dirname, "../../../supabase/functions/crawl-advertised-prices/index.ts"),
  "utf8",
);

function buildDetector() {
  const cpo = SRC.match(/const CPO_RE = new RegExp\(\s*\[([\s\S]*?)\]\.join\("\|"\),\s*"i",\s*\)/);
  const generic = SRC.match(/const GENERIC_CERT_RE = (\/.*\/i);/);
  if (!cpo || !generic) throw new Error("CPO detector not found in crawl source");
  const parts = [...cpo[1].matchAll(/String\.raw`([^`]*)`/g)].map((m) => m[1]);
  const CPO_RE = new RegExp(parts.join("|"), "i");
  // eslint-disable-next-line no-eval
  const GENERIC_CERT_RE = eval(generic[1]) as RegExp;
  return (html: string) =>
    CPO_RE.test(html) &&
    !(GENERIC_CERT_RE.test(html) && !/certified\s+pre[-\s]?owned/i.test(html));
}

describe("dealer VDP certification detector (C1)", () => {
  const detect = buildDetector();

  it("fires on the manufacturer certification wording a shopper sees", () => {
    expect(detect("<h2>INFINITI Certified Pre-Owned</h2>")).toBe(true);
    expect(detect("<span>Certified Pre Owned</span>")).toBe(true);
    expect(detect("<p>Factory-Certified with warranty</p>")).toBe(true);
  });

  it("does NOT fire on a generic certified-technicians footer", () => {
    // This is the failure that would matter: a service-department footer
    // appears on every VDP, and would certify the whole lot.
    expect(detect("<footer>Our certified technicians service every make</footer>")).toBe(false);
    expect(detect("<p>A certified dealer you can trust</p>")).toBe(false);
  });

  it("still fires when a real CPO badge sits on a page that also has that footer", () => {
    expect(detect(`
      <h2>INFINITI Certified Pre-Owned</h2>
      <footer>Our certified technicians service every make</footer>
    `)).toBe(true);
  });

  it("is positive-only: an ordinary used page certifies nothing", () => {
    expect(detect("<h1>2023 INFINITI QX60 LUXE AWD</h1><p>Clean, one owner.</p>")).toBe(false);
  });
});

describe("what the crawl records (C2)", () => {
  it("records its own source so it is distinguishable from the feed flag", () => {
    expect(SRC).toContain('source: "dealer_vdp"');
    expect(SRC).toContain("verified_at:");
  });

  it("never names a certification program it did not read", () => {
    const block = SRC.slice(SRC.indexOf("if (detectCpoBadge(html))"), SRC.indexOf("if (detectOneOwnerBadge(html))"));
    expect(block).not.toContain("program:");
  });

  it("does not overwrite a certification that already has a source", () => {
    const block = SRC.slice(SRC.indexOf("if (detectCpoBadge(html))"), SRC.indexOf("if (detectOneOwnerBadge(html))"));
    expect(block).toContain("if (!cert.source)");
  });
});
