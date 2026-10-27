// The migration is applied through the Lovable migration path, not from here,
// so the cursor cannot be exercised against Postgres in this suite. These
// assertions hold the migration text to the three rules that stop the sweep
// from buying the whole lot twice a day: active inventory only, a per-vehicle
// age floor, and no market_value trigger.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const SQL = readFileSync(
  "supabase/migrations/20261027200000_enrich_batch_once_per_day_active_only.sql",
  "utf8",
);

const body = SQL.slice(SQL.indexOf("AS $function$"), SQL.indexOf("$function$;"));

describe("next_enrich_batch cursor", () => {
  it("offers only unarchived listings", () => {
    expect(body).toMatch(/vl\.archived_at IS NULL/);
  });

  it("never offers a vehicle enriched inside the age floor", () => {
    expect(body).toMatch(/vl\.enriched_at < now\(\) - make_interval\(hours => greatest\(coalesce\(p_min_age_hours, 20\), 1\)\)/);
  });

  it("keeps the sweep-start cursor so one sweep still terminates", () => {
    expect(body).toMatch(/vl\.enriched_at < p_sweep_start/);
  });

  it("does not treat market_value as an enrichment trigger", () => {
    expect(body).not.toMatch(/market_value/);
  });

  it("still reaches a VIN with no recall answer, no comparables, or no build sheet", () => {
    expect(body).toMatch(/vl\.recall_status IS NULL/);
    expect(body).toMatch(/jsonb_array_length\(coalesce\(vl\.comparables, '\[\]'::jsonb\)\) = 0/);
    expect(body).toMatch(/NOT \(coalesce\(vl\.mc_attributes, '\{\}'::jsonb\) \? 'build_sheet'\)/);
  });

  it("keeps the build-sheet clauses in step with shouldDecodeVin", () => {
    expect(body).toMatch(/specs_attempts'\)::int, 0\) < 3/);
    expect(body).toMatch(/specs_no_build_sheet/);
    expect(body).toMatch(/specs_strict_attempted/);
  });

  it("defaults the floor so existing two-argument callers keep working", () => {
    expect(SQL).toMatch(/p_min_age_hours integer DEFAULT 20/);
    expect(SQL).toMatch(/DROP FUNCTION IF EXISTS public\.next_enrich_batch\(timestamp with time zone, integer\)/);
  });

  it("is callable by the service role only", () => {
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.next_enrich_batch\(timestamptz, integer, integer\) FROM PUBLIC, anon, authenticated/);
    expect(SQL).toMatch(/GRANT EXECUTE ON FUNCTION public\.next_enrich_batch\(timestamptz, integer, integer\) TO service_role/);
  });
});
