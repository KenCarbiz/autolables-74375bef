import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  FORBIDDEN_SOLD_PHRASES, INFERRED_SOLD_PRICE_LABEL, assertInferredSoldWording, checkInferredSoldWording,
  isAcceptableSoldColumnName,
} from "./soldLanguage.ts";

describe("inferred sold evidence is never described as a transaction", () => {
  it.each(FORBIDDEN_SOLD_PHRASES)("rejects copy containing %s", (phrase) => {
    const check = checkInferredSoldWording(`Priced below the ${phrase} of similar vehicles`);
    expect(check.ok).toBe(false);
    expect(check.offending).toContain(phrase);
    expect(() => assertInferredSoldWording(`Priced below the ${phrase}`)).toThrow(/transaction/);
  });

  it("accepts the approved vocabulary", () => {
    for (const copy of [
      "Priced $500 below the typical last advertised price before sale",
      "Median last advertised price of 12 inferred sold listings in CT, last 90 days",
      "14 similar vehicles inferred sold in CT in the last 90 days",
      "Similar vehicles typically leave the market within ~21 days here",
      INFERRED_SOLD_PRICE_LABEL,
    ]) {
      expect(checkInferredSoldWording(copy).ok, copy).toBe(true);
      expect(assertInferredSoldWording(copy)).toBe(copy);
    }
  });

  it("treats a disclaimer as a disclaimer, not a claim", () => {
    expect(checkInferredSoldWording("This is not a transaction price; it is the last advertised price.").ok).toBe(true);
    expect(checkInferredSoldWording("Never a transaction price").ok).toBe(true);
  });

  it("is empty-safe", () => {
    expect(checkInferredSoldWording(null).ok).toBe(true);
    expect(checkInferredSoldWording("").ok).toBe(true);
  });

  it("rejects column names that assert a transaction", () => {
    expect(isAcceptableSoldColumnName("inferred_sold_price_median")).toBe(true);
    expect(isAcceptableSoldColumnName("last_advertised_price")).toBe(true);
    for (const bad of ["transaction_price", "actual_sale_price_median", "final_sale_amount", "customer_paid_price", "sold_for"]) {
      expect(isAcceptableSoldColumnName(bad), bad).toBe(false);
    }
  });
});

// Regression guard over the surfaces that render sold_stats to customers. The
// scan reads string literals and JSX text only, so a code comment explaining
// the rule cannot trip it, and a negated disclaimer is allowed by the checker.
describe("customer surfaces built on sold_stats use the approved vocabulary", () => {
  const FILES = [
    "src/lib/passportV2Data.ts",
    "src/components/passport/PassportPanel.tsx",
  ];

  const stringLiterals = (src: string): string[] => {
    const out: string[] = [];
    for (const m of src.matchAll(/`((?:[^`\\]|\\.)*)`|"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g)) {
      out.push(m[1] ?? m[2] ?? m[3] ?? "");
    }
    for (const m of src.matchAll(/>([^<>{}]{8,})</g)) out.push(m[1]);
    return out;
  };

  it.each(FILES)("%s carries no transaction-price wording", (file) => {
    const src = readFileSync(file, "utf8").replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    const offenders = stringLiterals(src)
      .map((s) => ({ s, check: checkInferredSoldWording(s) }))
      .filter((x) => !x.check.ok)
      .map((x) => `${x.check.offending.join(",")}: ${x.s.slice(0, 80)}`);
    expect(offenders).toEqual([]);
  });
});
