// A guard, not a unit test.
//
// The defect this whole engine exists to end was never one bad formula. It was
// eight components each doing their own subtraction against whichever price
// column was nearest, which is how one QX50 came to read "$4,718 above
// market", "Fair Market" and "At market · verified" on a single page.
//
// Moving the arithmetic into src/lib/market is only worth anything if it
// cannot quietly move back out. This scans the app for a price being
// subtracted from a market value outside the engine and fails the suite if one
// reappears — including in a file nobody thought to review.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["src/components", "src/pages", "src/hooks", "src/lib"];
const EXEMPT_DIRS = ["src/lib/market"];
const EXEMPT_FILES: string[] = [];

/** A market value on either side of a + or -, anywhere but the engine. */
const ARITHMETIC = [
  /market_value\s*[-+]/,
  /[-+]\s*(?:Number\()?\s*\w*\.?market_value/,
  /marketAvg\s*[-+]/,
  /[-+]\s*(?:d\.)?marketAvg/,
  /marketValue\s*[-+]\s*price/,
];

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (EXEMPT_DIRS.some((d) => full.startsWith(d))) continue;
      walk(full, out);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry) || entry.endsWith(".test.ts") || entry.endsWith(".test.tsx")) continue;
    if (EXEMPT_FILES.includes(full)) continue;
    out.push(full);
  }
  return out;
}

describe("no surface calculates its own market position", () => {
  const files = ROOTS.flatMap((r) => walk(r));

  it("scans a meaningful number of files", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it("finds no market arithmetic outside src/lib/market", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const body = readFileSync(file, "utf8");
      body.split("\n").forEach((line, i) => {
        if (line.trimStart().startsWith("//") || line.trimStart().startsWith("*")) return;
        if (ARITHMETIC.some((re) => re.test(line))) offenders.push(`${file}:${i + 1}  ${line.trim().slice(0, 120)}`);
      });
    }
    expect(offenders, `market arithmetic must live in src/lib/market:\n${offenders.join("\n")}`).toEqual([]);
  });
});

// Part two: the same guard for PRESENTATION. Centralising the labels and
// colours is only worth something if a component cannot quietly grow its own
// table again — which is exactly how five of them ended up disagreeing.
describe("no surface picks its own market label or colour", () => {
  const files = ROOTS.flatMap((r) => walk(r));

  /** A file that renders a market position must go through the shared map. */
  const MARKET_POSITION = /market_position/;
  /**
   * A local table keyed on the legacy position vocabulary. The value has to
   * look like a label or a class — `below_market: 2300` is a price-history
   * FIELD, not a second opinion about what to call it.
   */
  const LOCAL_MAP = /(?<![A-Za-z_])(great_deal|good_deal|fair_deal|above_market|below_market|at_market)\s*:\s*[{"']/;
  /** A colour chosen from a market position or difference in the same expression. */
  const LOCAL_COLOUR =
    /(market_position|marketPosition|belowMarket|aboveMarket)[^\n]{0,120}(bg-(emerald|amber|red|blue|slate)-|text-(emerald|amber|red|blue|slate)-)/;

  it("defines no local position-to-label table outside the engine", () => {
    const offenders = files.filter((f) => {
      const body = readFileSync(f, "utf8");
      return LOCAL_MAP.test(body);
    });
    expect(offenders, `these files keep their own market label table:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("chooses no colour directly from a market position or difference", () => {
    const offenders: string[] = [];
    for (const f of files) {
      readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        if (line.trimStart().startsWith("//") || line.trimStart().startsWith("*")) return;
        // A line that consults the shared map is not choosing for itself —
        // that is the whole point of routing through it.
        const consultsMap = /presentLegacyPosition|presentMarketView|presentVerdict|\.classes\.|marketPresentationTone/.test(line);
        if (LOCAL_COLOUR.test(line) && !consultsMap) offenders.push(`${f}:${i + 1}`);
      });
    }
    expect(offenders, `these lines pick a market colour locally:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("every surface that reads market_position imports the shared presentation", () => {
    const offenders: string[] = [];
    for (const f of files) {
      const body = readFileSync(f, "utf8");
      if (!MARKET_POSITION.test(body)) continue;
      // Files that only pass the column through (selects, type declarations,
      // fixtures) neither label nor colour it.
      const rendersIt = /presentLegacyPosition|presentMarketView|presentVerdict/.test(body);
      // A type declaration (`market_position?: string`) or a select list
      // carries the column without judging it.
      const merelyCarriesIt =
        !/market_position\s*===|market_position\s*\?[^:]|\[\s*.*market_position.*\s*\]/.test(body);
      if (!rendersIt && !merelyCarriesIt) offenders.push(f);
    }
    expect(offenders, `these surfaces judge market_position without the shared map:\n${offenders.join("\n")}`).toEqual([]);
  });
});
