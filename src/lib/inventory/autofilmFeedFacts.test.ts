import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { factAuthority } from "../vehicleTruth/precedence";

// autofilm-feed runs under Deno and imports `serve` by URL, so it cannot be
// loaded here. The exclusion predicate is read out of the source text and
// evaluated against the real factAuthority instead, the same way
// cpoBadge.test.ts exercises the crawl detector.
//
// The defect this guards: the detail payload carries the live listing row
// (current price, mileage) AND the fact ledger, and on 2026-09-09 the ledger's
// advertised_price was stale on 99 of 119 live VINs while labelled VERIFIED.
// Two prices in one payload, VERIFIED on the wrong one.

const SRC = readFileSync(
  join(__dirname, "../../../supabase/functions/autofilm-feed/index.ts"),
  "utf8",
);

function buildPredicate(): (factKey: unknown) => boolean {
  const m = /const isDealerControlledFact = (\(factKey: unknown\) => .*);\n/.exec(SRC);
  if (!m) throw new Error("isDealerControlledFact not found in autofilm-feed source");
  const expr = m[1].replace(/: unknown/g, "");
  return new Function("factAuthority", `return ${expr};`)(factAuthority);
}

describe("autofilm-feed detail facts", () => {
  it("decides dealer control through the engine, not a hardcoded key list", () => {
    expect(SRC).toMatch(
      /import \{ factAuthority \} from "\.\.\/_shared\/factorySticker\/lib\/vehicleTruth\/precedence\.ts";/,
    );
    expect(SRC).toMatch(/\.filter\(\(f\) => !isDealerControlledFact\(f\.fact_key\)\)/);
  });

  it("excludes dealer-controlled facts and keeps factory and history facts", () => {
    const isDealerControlled = buildPredicate();
    const ledger = [
      { fact_key: "advertised_price" },
      { fact_key: "mileage" },
      { fact_key: "stock_number" },
      { fact_key: "doc_fee" },
      { fact_key: "engine" },
      { fact_key: "drivetrain" },
      { fact_key: "transmission" },
      { fact_key: "total_msrp" },
      { fact_key: "carfax_one_owner" },
      { fact_key: "trim" },
    ];
    const kept = ledger.filter((f) => !isDealerControlled(f.fact_key)).map((f) => f.fact_key);
    expect(kept).toEqual([
      "engine", "drivetrain", "transmission", "total_msrp", "carfax_one_owner", "trim",
    ]);
    expect(ledger.length - kept.length).toBe(4);
  });

  it("tolerates a null fact_key rather than crashing the detail call", () => {
    const isDealerControlled = buildPredicate();
    expect(isDealerControlled(null)).toBe(false);
    expect(isDealerControlled(undefined)).toBe(false);
  });

  it("reports the exclusion count in the response", () => {
    expect(SRC).toMatch(/const facts_excluded_dealer_controlled = factRows\.length - facts\.length;/);
    expect(SRC).toMatch(/^\s+facts_excluded_dealer_controlled,$/m);
  });

  it("does not carry a facts block on the list endpoint", () => {
    const listReturn = SRC.slice(SRC.lastIndexOf("return json(200, {"));
    expect(listReturn).not.toMatch(/facts/);
  });
});
