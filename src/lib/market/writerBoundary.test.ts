// One writer, enforced by a scan.
//
// Three functions used to write a market decision. `vehicle-enrich` wrote it
// nightly, `marketcheck-market-pricing` wrote it on demand with different
// thresholds, and neither knew about the other, so whichever ran last decided
// what a dealer saw that morning. Making `market-valuation-write` the owner is
// only durable if a fourth writer cannot quietly appear.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const FUNCTIONS_DIR = "supabase/functions";
const SOLE_WRITER = "market-valuation-write";

/** Columns that carry a market VERDICT. Only the writer may set them. */
const VERDICT_COLUMNS = [
  "market_value", "market_position", "market_checked_at", "market_payload",
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      // The mirrored pure engine is library code, not a writer.
      if (full.includes("_shared/factorySticker")) continue;
      walk(full, out);
      continue;
    }
    if (full.endsWith(".ts")) out.push(full);
  }
  return out;
}

/**
 * A line that ASSIGNS a verdict column a real value.
 *
 * Reading one, echoing a stored row back in a response, or writing an explicit
 * null are all fine — the rule is about who DECIDES the number.
 */
const WRITE_PATTERNS = VERDICT_COLUMNS.map(
  (c) => new RegExp(
    // The whitespace lives INSIDE the lookaheads. Written as `\\s*:\\s*(?!null)`
    // the engine simply backtracks the whitespace and the lookahead passes at
    // the space, so `market_value: null` reads as a write.
    `(patch\\.${c}\\s*=(?!\\s*null\\b)`
    + `|["']?${c}["']?\\s*:(?!\\s*null\\b)(?!\\s*[A-Za-z_$][\\w$]*[.?]))`,
  ),
);

describe("only market-valuation-write decides a market verdict", () => {
  const files = walk(FUNCTIONS_DIR);

  it("scans the edge function tree", () => {
    expect(files.length).toBeGreaterThan(40);
  });

  it("the sole writer exists", () => {
    expect(files.some((f) => f.includes(`${SOLE_WRITER}/index.ts`))).toBe(true);
  });

  it("no other edge function writes a market verdict column", () => {
    const offenders: string[] = [];
    for (const file of files) {
      if (file.includes(SOLE_WRITER)) continue;
      const body = readFileSync(file, "utf8");
      body.split("\n").forEach((line, i) => {
        const trimmed = line.trimStart();
        if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;
        // Reading a column is fine. Only an assignment is a write.
        if (/\.select\(|from\("vehicle_listings"\)\s*$/.test(line)) return;
        if (WRITE_PATTERNS.some((re) => re.test(line))) {
          offenders.push(`${file}:${i + 1}  ${trimmed.slice(0, 110)}`);
        }
      });
    }
    expect(offenders, `a second market writer has appeared:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("vehicle-enrich no longer decides the market question", () => {
    const body = readFileSync(`${FUNCTIONS_DIR}/vehicle-enrich/index.ts`, "utf8");
    expect(body).toContain("SINGLE-WRITER BOUNDARY");
    expect(body).not.toMatch(/patch\.market_position\s*=/);
    expect(body).not.toMatch(/patch\.market_value\s*=/);
    // And it no longer carries its own "at market" thresholds.
    expect(body).not.toMatch(/mv \* 0\.97|mv \* 1\.03/);
  });

  it("marketcheck-market-pricing is a proxy with no formula of its own", () => {
    const body = readFileSync(`${FUNCTIONS_DIR}/marketcheck-market-pricing/index.ts`, "utf8");
    expect(body).toContain("market-valuation-write");
    expect(body).not.toMatch(/great_deal|good_deal|fair_deal/);
    expect(body).not.toMatch(/car_type/);
    expect(body).not.toMatch(/predict\/car\/price/);
  });

  it("the writer sends certification and never a car_type substitute", () => {
    const body = readFileSync(`${FUNCTIONS_DIR}/${SOLE_WRITER}/index.ts`, "utf8");
    expect(body).toContain("buildPredictionRequest");
    expect(body).not.toMatch(/car_type/);
  });

  it("the writer reserves before it spends", () => {
    const body = readFileSync(`${FUNCTIONS_DIR}/${SOLE_WRITER}/index.ts`, "utf8");
    const reserveAt = body.indexOf("market_reserve_provider_call");
    const callAt = body.indexOf("callProvider(predictionUrl");
    expect(reserveAt).toBeGreaterThan(-1);
    expect(callAt).toBeGreaterThan(reserveAt);
  });

  it("the writer commits the decision and its evidence in one call", () => {
    const body = readFileSync(`${FUNCTIONS_DIR}/${SOLE_WRITER}/index.ts`, "utf8");
    expect(body).toContain("market_valuation_commit");
    expect(body).toContain("p_comparables");
  });

  it("the writer only touches compatibility columns under the admin flag", () => {
    const body = readFileSync(`${FUNCTIONS_DIR}/${SOLE_WRITER}/index.ts`, "utf8");
    const flagAt = body.indexOf('readMarketFlag(settings, "market_value_v2_admin")');
    const updateAt = body.indexOf('from("vehicle_listings").update');
    expect(flagAt).toBeGreaterThan(-1);
    expect(updateAt).toBeGreaterThan(flagAt);
  });

  it("a transient provider failure keeps the last-good answer", () => {
    const body = readFileSync(`${FUNCTIONS_DIR}/${SOLE_WRITER}/index.ts`, "utf8");
    expect(body).toContain("resolveProviderFreshness");
    expect(body).toContain("provider_valuation");
  });
});

// Deno is not available in this environment, so the writer cannot be
// type-checked the way the browser bundle is. This is the substitute: every
// relative import it makes must resolve to a file that actually exists in the
// mirrored tree, extension included. It catches the failure mode a missing
// Deno check would otherwise let through — a rename in src/lib/market that the
// mirror carried but the edge function did not follow.
describe("the writer's imports resolve in the edge tree", () => {
  const WRITER = `${FUNCTIONS_DIR}/${SOLE_WRITER}/index.ts`;
  const body = readFileSync(WRITER, "utf8");
  const specifiers = [...body.matchAll(/from\s+"(\.[^"]+)"/g)].map((m) => m[1]);

  it("imports something", () => {
    expect(specifiers.length).toBeGreaterThan(5);
  });

  it("every relative import is extension-qualified for Deno", () => {
    for (const spec of specifiers) expect(spec, spec).toMatch(/\.ts$/);
  });

  it("every relative import points at a file that exists", () => {
    const dir = `${FUNCTIONS_DIR}/${SOLE_WRITER}`;
    const missing = specifiers.filter((spec) => {
      const resolved = join(dir, spec);
      try { return !statSync(resolved).isFile(); } catch { return true; }
    });
    expect(missing, `unresolved imports:\n${missing.join("\n")}`).toEqual([]);
  });

  it("the retired proxy's imports resolve too", () => {
    const proxy = readFileSync(`${FUNCTIONS_DIR}/marketcheck-market-pricing/index.ts`, "utf8");
    for (const m of proxy.matchAll(/from\s+"(\.[^"]+)"/g)) {
      const resolved = join(`${FUNCTIONS_DIR}/marketcheck-market-pricing`, m[1]);
      expect(() => statSync(resolved), m[1]).not.toThrow();
    }
  });
});
