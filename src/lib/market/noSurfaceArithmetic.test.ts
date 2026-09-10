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
