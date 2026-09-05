import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  LENGTH_POLICY, preferredLengthBand, buildFactSnapshot, validateContent,
} from "../../../supabase/functions/_shared/description-core.ts";

// Harte's stored settings said min_length 3750 / max_length 3922 /
// warranty_language_allowed false, and the platform overrode all three at
// runtime. Code compensating forever for a row that reads wrong is a trap: the
// settings screen shows a dealer numbers the writer ignores. The migration
// corrects the row. These tests hold the migration and the resolver to the
// same numbers, so the two can never drift apart again silently.

const MIGRATION = "20260905233000_harte_description_settings_correction.sql";
const sql = readFileSync(join(__dirname, "../../../supabase/migrations", MIGRATION), "utf8");

const HARTE = "3f0f97f5-4151-4e32-88ef-e2d6fc5a3142";
const STALE = { min_length: 3750, max_length: 3922, warranty_language_allowed: false };

/** The values the migration actually writes, read out of the migration itself. */
function storedAfterMigration() {
  const set = sql.slice(sql.indexOf("SET min_length"), sql.indexOf("WHERE tenant_id"));
  const num = (col: string) => {
    const m = set.match(new RegExp(`${col}\\s*=\\s*(\\d+)`));
    if (!m) throw new Error(`${col} is not assigned in the migration`);
    return Number(m[1]);
  };
  return {
    min_length: num("min_length"),
    max_length: num("max_length"),
    warranty_language_allowed: /warranty_language_allowed\s*=\s*true/.test(set),
    assignments: [...set.matchAll(/^\s*(?:SET\s+)?([a-z_]+)\s*=/gm)].map((m) => m[1]),
  };
}

describe("the migration corrects one row and nothing else", () => {
  it("names exactly one tenant, and it is Harte", () => {
    const ids = new Set(sql.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g) || []);
    expect([...ids]).toEqual([HARTE]);
  });

  it("writes only the three columns it is meant to write", () => {
    expect(storedAfterMigration().assignments.sort())
      .toEqual(["max_length", "min_length", "warranty_language_allowed"]);
  });

  it("only fires while the row still holds the stale values", () => {
    // A dealer who edits these settings before the migration lands must win.
    const guard = sql.slice(sql.indexOf("WHERE tenant_id"), sql.indexOf("GET DIAGNOSTICS"));
    expect(guard).toMatch(/min_length\s*=\s*3750/);
    expect(guard).toMatch(/max_length\s*=\s*3922/);
    expect(guard).toMatch(/warranty_language_allowed\s*=\s*false/);
  });

  it("records what the values were", () => {
    for (const v of ["3750", "3922"]) expect(sql).toContain(v);
    expect(sql).toMatch(/INSERT INTO public\.audit_log/);
    expect(sql).toMatch(/'before', v_before/);
  });

  it("requeues the cases the change affects", () => {
    // Settings that change generated output changed; the cases have to be
    // reconsidered, exactly as save_description_settings does by hand.
    expect(sql).toMatch(/enqueue_description_config_change\(v_tenant\)/);
  });

  it("leaves the absolute ceiling in application policy", () => {
    // 4500 is a platform safety limit. A dealership must not be able to raise
    // it by typing a bigger number into a settings column.
    expect(sql).not.toContain(String(LENGTH_POLICY.absoluteMax));
  });
});

describe("after the migration the stored row IS the resolved row", () => {
  const stored = storedAfterMigration();

  it("stores the values the owner set", () => {
    expect(stored.min_length).toBe(1800);
    expect(stored.max_length).toBe(3800);
    expect(stored.warranty_language_allowed).toBe(true);
  });

  it("resolves the stored band to itself, with no override left", () => {
    // This is the whole point of the migration: what the dealer sees on the
    // settings screen is what the writer is told.
    expect(preferredLengthBand(stored))
      .toEqual({ min: stored.min_length, max: stored.max_length });
  });

  it("the stale band did NOT resolve to itself — which is why this exists", () => {
    expect(preferredLengthBand(STALE))
      .toEqual({ min: LENGTH_POLICY.preferredMin, max: LENGTH_POLICY.preferredMax });
  });

  it("sits inside the platform's soft band rather than fighting it", () => {
    expect(stored.min_length).toBeGreaterThanOrEqual(LENGTH_POLICY.softMin);
    expect(stored.max_length).toBeLessThanOrEqual(LENGTH_POLICY.softMax);
  });
});

// ── The two things 1800 and true must NOT come to mean ────────────────

const LISTING = {
  vin: "JN8AZ3CC5T9624253",
  ymm: "2027 INFINITI QX80",
  condition: "used",
  mileage: 12408,
  mc_attributes: { year: 2027, make: "INFINITI", model: "QX80" },
};

describe("1800 is a target, not a gate", () => {
  const stored = storedAfterMigration();

  it("does not refuse a shorter description", () => {
    const snap = buildFactSnapshot(LISTING, stored, null);
    const short = "Stop by or call to schedule a test drive of this QX80.";
    const findings = validateContent(short, snap, stored);
    const length = findings.filter((f) => f.validator_code === "LENGTH_BELOW_MINIMUM");
    expect(length).toHaveLength(1);
    expect(length[0].blocking).toBe(false);
    expect(findings.some((f) => f.blocking)).toBe(false);
  });
});

describe("true is permission to state coverage, not to claim it", () => {
  const stored = storedAfterMigration();

  it("states coverage the record actually proves", () => {
    const snap = buildFactSnapshot(
      { ...LISTING, warranty_info: { program: "INFINITI Limited", months_remaining: 44, miles_remaining: 48000 } },
      stored, null);
    const fact = (snap.facts as Record<string, { value?: unknown } | undefined>).warranty_eligible;
    expect(String(fact?.value ?? "")).toContain("44 months remaining");
  });

  it("still says nothing for a vehicle with no coverage on file", () => {
    // The flag being true must not turn into "mention a warranty anyway".
    const snap = buildFactSnapshot({ ...LISTING, warranty_info: {} }, stored, null);
    expect((snap.facts as Record<string, unknown>).warranty_eligible).toBeFalsy();
  });
});
