import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { shouldDecodeVin, MAX_SPEC_ATTEMPTS } from "../../../supabase/functions/_shared/factorySticker/lib/sourceData.ts";

// enrich-sweep decodes the factory build sheet as a piggyback inside its
// per-VIN loop, but next_enrich_batch only handed it vehicles missing
// market_value, recall_status or comparables. Once a car had all three — which
// every car on Harte's lot does — it stopped being selected, and the decode
// inside the loop could never run for it again.
//
// 23 INFINITI VINs were attempted once on 2026-07-28, failed before recording
// why, and were never retried in the six weeks after. INFINITI is the store's
// primary franchise; with no build sheet those cars have no factory options,
// no base MSRP, and nothing for a walkaround to describe.

const sql = readFileSync(
  join(__dirname, "../../../supabase/migrations/20260905220000_enrich_batch_includes_specs_decode.sql"),
  "utf8",
);

describe("the sweep can reach a VIN that only needs its build sheet", () => {
  it("keeps what it always selected", () => {
    // The enrichment fields are still the primary reason to visit a vehicle;
    // this widens the net, it does not replace it.
    expect(sql).toMatch(/vl\.market_value IS NULL OR vl\.recall_status IS NULL OR vl\.comparables IS NULL/);
  });

  it("adds vehicles whose only outstanding work is the decode", () => {
    expect(sql).toMatch(/NOT \(coalesce\(vl\.mc_attributes, '\{\}'::jsonb\) \? 'build_sheet'\)/);
  });

  it("respects the same attempt cap the code enforces", () => {
    // A cap in SQL that disagreed with the one in shouldDecodeVin would either
    // keep paying past the limit or retire a VIN early.
    expect(MAX_SPEC_ATTEMPTS).toBe(3);
    expect((sql.match(/specs_attempts'\)::int, 0\) < 3/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it("never re-asks a VIN the provider said it cannot decode", () => {
    expect(sql).toMatch(/specs_no_build_sheet'\)::boolean, false\) = false/);
  });

  it("allows the one strict retry a generic sheet is owed", () => {
    expect(sql).toMatch(/build_sheet'->>'generic'\)::boolean, false\) = true/);
    expect(sql).toMatch(/specs_strict_attempted'\)::boolean, false\) = false/);
  });
});

describe("the SQL clause and shouldDecodeVin agree", () => {
  // A row selected by SQL and refused by the code wastes a hop. A row refused
  // by SQL can never be decoded at all — which is the bug being fixed. These
  // hold the two to the same answer.
  const sqlWouldSelect = (mc: Record<string, unknown>): boolean => {
    const attempts = Number(mc.specs_attempts ?? 0) || 0;
    const noSheet = !("build_sheet" in mc);
    const said = mc.specs_no_build_sheet === true;
    const generic = (mc.build_sheet as { generic?: boolean } | undefined)?.generic === true;
    const strict = mc.specs_strict_attempted === true;
    return (noSheet && attempts < 3 && !said) || (generic && !strict && attempts < 3);
  };

  const CASES: Array<[string, Record<string, unknown>]> = [
    ["never attempted", {}],
    ["attempted once, no sheet", { specs_attempts: 1 }],
    ["the 23 INFINITIs: stamped but attempts null", { specs_attempted_at: "2026-07-28T17:36:17.537Z" }],
    ["at the cap", { specs_attempts: 3 }],
    ["past the cap", { specs_attempts: 5 }],
    ["decoded properly", { build_sheet: { source: "neovin", generic: false } }],
    ["generic, never asked strictly", { build_sheet: { generic: true } }],
    ["generic, already asked strictly", { build_sheet: { generic: true }, specs_strict_attempted: true }],
    ["generic but at the cap", { build_sheet: { generic: true }, specs_attempts: 3 }],
  ];

  for (const [label, mc] of CASES) {
    it(`agrees on: ${label}`, () => {
      expect(sqlWouldSelect(mc)).toBe(shouldDecodeVin(mc as never).decode);
    });
  }

  it("differs on the one case where it must — a provider refusal", () => {
    // shouldDecodeVin does not know about specs_no_build_sheet; the sweep's
    // stamping writes it and the SQL honours it, so the row is never offered.
    // Selecting it would be a paid call for an answer already given.
    const refused = { specs_no_build_sheet: true };
    expect(sqlWouldSelect(refused)).toBe(false);
    expect(shouldDecodeVin(refused as never).decode).toBe(true);
  });
});
