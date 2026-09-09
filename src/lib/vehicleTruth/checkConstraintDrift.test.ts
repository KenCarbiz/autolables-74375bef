import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SOURCE_KINDS, type FactAuthority } from "./precedence";

// The enum and the CHECK constraint drifted apart once: `dealer_vdp` and
// `history_provider` lived in precedence.ts for weeks while the tables still
// rejected them, and the write path discarded the rejection. This test reads
// the migration that closed the gap and fails the suite if the enum grows
// past it again.

const MIGRATION = readFileSync(
  join(__dirname, "../../../supabase/migrations/20260909010000_vehicle_facts_check_widen.sql"),
  "utf8",
);
const CONFLICTS_MIGRATION = readFileSync(
  join(__dirname, "../../../supabase/migrations/20260909030000_vehicle_fact_conflicts_authority_widen.sql"),
  "utf8",
);

// Exhaustive by construction: adding a FactAuthority member without listing it
// here is a type error, so the runtime list cannot lag the type.
const AUTHORITY_TABLE: Record<FactAuthority, true> = {
  manufacturer: true,
  dealer: true,
  history_provider: true,
  shared: true,
};
const FACT_AUTHORITIES = Object.keys(AUTHORITY_TABLE) as FactAuthority[];

function checkListFor(constraint: string, column: string, source: string = MIGRATION): string[] {
  const re = new RegExp(
    `ADD CONSTRAINT ${constraint} CHECK \\(${column} IN \\(([^)]*)\\)\\)`,
  );
  const m = re.exec(source);
  if (!m) throw new Error(`${constraint} not found in migration`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

describe("vehicle truth CHECK constraints track the engine enums", () => {
  it("vehicle_facts.source_kind allows every SourceKind", () => {
    const allowed = checkListFor("vehicle_facts_source_kind_check", "source_kind");
    for (const kind of SOURCE_KINDS) expect(allowed, kind).toContain(kind);
  });

  it("vehicle_source_records.source_kind allows every SourceKind", () => {
    const allowed = checkListFor("vehicle_source_records_source_kind_check", "source_kind");
    for (const kind of SOURCE_KINDS) expect(allowed, kind).toContain(kind);
  });

  it("vehicle_facts.authority allows every FactAuthority", () => {
    const allowed = checkListFor("vehicle_facts_authority_check", "authority");
    for (const authority of FACT_AUTHORITIES) expect(allowed, authority).toContain(authority);
  });

  it("vehicle_fact_conflicts.authority allows every FactAuthority", () => {
    // truth.ts writes conflict.authority into this column; it was created with
    // the three original authorities and widened by nothing.
    const allowed = checkListFor("vehicle_fact_conflicts_authority_check", "authority", CONFLICTS_MIGRATION);
    for (const authority of FACT_AUTHORITIES) expect(allowed, authority).toContain(authority);
    expect(allowed.filter((a) => !FACT_AUTHORITIES.includes(a as FactAuthority))).toEqual([]);
    expect(CONFLICTS_MIGRATION).toMatch(/pg_get_constraintdef/);
  });

  it("widens by exactly the two values the engine defines", () => {
    const sourceKinds = checkListFor("vehicle_facts_source_kind_check", "source_kind");
    expect(sourceKinds.filter((k) => !SOURCE_KINDS.includes(k as typeof SOURCE_KINDS[number]))).toEqual([]);
    const authorities = checkListFor("vehicle_facts_authority_check", "authority");
    expect(authorities.filter((a) => !FACT_AUTHORITIES.includes(a as FactAuthority))).toEqual([]);
  });

  it("verifies the live definitions after applying", () => {
    expect(MIGRATION).toMatch(/pg_get_constraintdef/);
    expect(MIGRATION).toMatch(/RAISE EXCEPTION/);
    expect(MIGRATION).toMatch(/DROP CONSTRAINT IF EXISTS vehicle_facts_source_kind_check/);
    expect(MIGRATION).toMatch(/DROP CONSTRAINT IF EXISTS vehicle_source_records_source_kind_check/);
    expect(MIGRATION).toMatch(/DROP CONSTRAINT IF EXISTS vehicle_facts_authority_check/);
  });
});
