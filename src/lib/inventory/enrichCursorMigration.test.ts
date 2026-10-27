// The migrations are applied through the Lovable migration path, not from
// here, so the cursor cannot be exercised against Postgres in this suite.
// These assertions hold the migration text to the rules that stop the sweep
// from buying the whole lot every day: active inventory only, a per-vehicle
// age floor, no market_value trigger, and an unanswered VIN recall re-asked
// on the retry window rather than on every pass.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (name: string) => readFileSync(`supabase/migrations/${name}`, "utf8");
const bodyOf = (sql: string) => sql.slice(sql.indexOf("AS $function$"), sql.indexOf("$function$;"));

const V1 = read("20261027200000_enrich_batch_once_per_day_active_only.sql");
const SQL = read("20261027203000_enrich_batch_recall_retry_window.sql");
const body = bodyOf(SQL);

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

  it("still reaches a VIN with no comparables or no build sheet", () => {
    expect(body).toMatch(/jsonb_array_length\(coalesce\(vl\.comparables, '\[\]'::jsonb\)\) = 0/);
    expect(body).toMatch(/NOT \(coalesce\(vl\.mc_attributes, '\{\}'::jsonb\) \? 'build_sheet'\)/);
  });

  it("reaches a VIN whose recall has never been attempted", () => {
    expect(body).toMatch(/vl\.recall_status IS NULL\s+AND \(\s+vl\.recall_check IS NULL/);
    expect(body).toMatch(/\(vl\.recall_check->>'attempted_at'\) IS NULL/);
  });

  it("re-asks an attempted, unanswered recall only after the retry window", () => {
    expect(body).toMatch(
      /\(vl\.recall_check->>'attempted_at'\)::timestamptz\s+< now\(\) - make_interval\(days => greatest\(coalesce\(p_recall_retry_days, 30\), 1\)\)/,
    );
    const recallClause = body.slice(body.indexOf("vl.recall_status IS NULL"), body.indexOf("OR vl.comparables IS NULL"));
    expect(recallClause).not.toMatch(/recall_status IS NULL\s*\n\s*OR/);
  });

  it("keeps the build-sheet clauses in step with shouldDecodeVin", () => {
    expect(body).toMatch(/specs_attempts'\)::int, 0\) < 3/);
    expect(body).toMatch(/specs_no_build_sheet/);
    expect(body).toMatch(/specs_strict_attempted/);
  });

  it("defaults both windows so the existing two-argument callers keep working", () => {
    expect(SQL).toMatch(/p_min_age_hours integer DEFAULT 20/);
    expect(SQL).toMatch(/p_recall_retry_days integer DEFAULT 30/);
    expect(SQL).toMatch(/DROP FUNCTION IF EXISTS public\.next_enrich_batch\(timestamp with time zone, integer, integer\)/);
  });

  it("supersedes the first cursor migration without changing its other rules", () => {
    const v1 = bodyOf(V1);
    expect(V1).toMatch(/DROP FUNCTION IF EXISTS public\.next_enrich_batch\(timestamp with time zone, integer\)/);
    for (const rule of [
      /vl\.archived_at IS NULL/,
      /vl\.enriched_at < p_sweep_start/,
      /jsonb_array_length\(coalesce\(vl\.comparables, '\[\]'::jsonb\)\) = 0/,
      /specs_strict_attempted/,
    ]) {
      expect(v1).toMatch(rule);
      expect(body).toMatch(rule);
    }
  });

  it("is callable by the service role only", () => {
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.next_enrich_batch\(timestamptz, integer, integer, integer\) FROM PUBLIC, anon, authenticated/);
    expect(SQL).toMatch(/GRANT EXECUTE ON FUNCTION public\.next_enrich_batch\(timestamptz, integer, integer, integer\) TO service_role/);
  });
});
