// ── The reservation repair, guarded ────────────────────────────────────────
//
// `market_reserve_provider_call` could never grant a reservation. Every call
// that reached its enabled-budget path raised
//
//   42702: column reference "estimated_cost_usd" is ambiguous
//
// because `RETURNS TABLE(... estimated_cost_usd numeric ...)` makes that name
// an OUT variable and `provider_request_reservations` also has a column of
// that name.
//
// Two things kept it invisible for four gates, and both are guarded here:
//
//   1. The `disabled` short-circuit returns before the spend query, so every
//      probe run with the budget switched off returned a clean `disabled` and
//      proved nothing about the path that matters.
//   2. The writer discarded the RPC error, so a hard SQL failure arrived
//      looking like an ordinary "unavailable".

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";

const MIGRATIONS = "supabase/migrations";
const REPAIR = `${MIGRATIONS}/20260911020000_market_reserve_qualify_out_param_collision.sql`;
const WRITER = "supabase/functions/market-valuation-write/index.ts";

const read = (p: string) => readFileSync(p, "utf8");

/**
 * SQL with comments removed. These guards describe the deleted defect in
 * prose — "#variable_conflict", "GRANT" — and a guard that fires on its own
 * documentation teaches people to delete the documentation.
 */
const readCode = (p: string): string =>
  read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*--.*$/gm, "");
const sha256 = (p: string) => createHash("sha256").update(readFileSync(p)).digest("hex");

/** The OUT parameter names, which are exactly the collision surface. */
const OUT_PARAMS = [
  "outcome", "attempt_id", "estimated_cost_usd", "month_spent_usd", "month_budget_usd",
] as const;

describe("the repair migration fixes the ambiguity by qualification", () => {
  const sql = () => read(REPAIR);

  it("replaces the one function, by CREATE OR REPLACE, with its signature intact", () => {
    const s = sql();
    expect(s).toMatch(
      /CREATE OR REPLACE FUNCTION public\.market_reserve_provider_call\(/,
    );
    expect(s).toContain("RETURNS TABLE(");
    expect(s).toContain("LANGUAGE plpgsql");
    expect(s).toContain("SET search_path TO 'pg_catalog', 'public'");
    for (const name of OUT_PARAMS) expect(s).toContain(name);
  });

  it("qualifies every column in the spend query", () => {
    const s = sql();
    const spend = s.slice(s.indexOf("SELECT COALESCE(SUM("));
    const stmt = spend.slice(0, spend.indexOf(";") + 1);
    expect(stmt).toContain("prr.actual_cost_usd");
    expect(stmt).toContain("prr.estimated_cost_usd");
    expect(stmt).toContain("public.provider_request_reservations AS prr");
    expect(stmt).toContain("prr.tenant_id");
    expect(stmt).toContain("prr.reserved_at");
    expect(stmt).toContain("prr.status");
  });

  it("leaves no bare OUT-parameter column reference in the spend query", () => {
    const s = sql();
    const spend = s.slice(s.indexOf("SELECT COALESCE(SUM("));
    const stmt = spend.slice(0, spend.indexOf(";") + 1);
    // A bare `estimated_cost_usd` not preceded by `prr.` is the defect itself.
    expect(stmt).not.toMatch(/(?<!prr\.)\bestimated_cost_usd\b/);
    expect(stmt).not.toMatch(/(?<!prr\.)\bactual_cost_usd\b/);
  });

  it("does not suppress the ambiguity with a conflict directive", () => {
    // #variable_conflict would hide the NEXT collision instead of preventing
    // it. The references are fixed explicitly or not at all. Comments are
    // stripped first: the migration's own header names the directive in order
    // to rule it out.
    expect(readCode(REPAIR)).not.toMatch(/#variable_conflict/i);
  });

  it("keeps the RETURNING already-qualified, which is why attempt_id never broke", () => {
    expect(sql()).toContain("RETURNING provider_request_reservations.attempt_id");
  });

  it("preserves every decision branch and the unique_violation handler", () => {
    const s = sql();
    for (const outcome of ["disabled", "existing", "budget_exceeded", "reserved"]) {
      expect(s).toContain(`'${outcome}'::text`);
    }
    expect(s).toContain("WHEN unique_violation THEN");
    expect(s).toContain("FOR UPDATE");
  });

  it("touches nothing but the function", () => {
    const s = sql();
    for (const forbidden of [
      /CREATE\s+TABLE/i, /ALTER\s+TABLE/i, /DROP\s+TABLE/i, /DROP\s+FUNCTION/i,
      /CREATE\s+POLICY/i, /ALTER\s+POLICY/i, /DROP\s+POLICY/i,
      /ROW\s+LEVEL\s+SECURITY/i, /CREATE\s+TRIGGER/i, /CREATE\s+INDEX/i,
      /\bTRUNCATE\b/i,
    ]) {
      expect(s).not.toMatch(forbidden);
    }
  });

  it("performs no row DML outside the function body", () => {
    const s = sql();
    const body = s.slice(s.indexOf("AS $function$"), s.indexOf("$function$;") + 11);
    const outside = s.replace(body, "");
    for (const dml of [/\bINSERT\s+INTO\b/i, /\bUPDATE\s+public\./i, /\bDELETE\s+FROM\b/i]) {
      expect(outside).not.toMatch(dml);
    }
  });

  it("does not widen privileges", () => {
    // CREATE OR REPLACE preserves the existing ACL, so no grant is reissued.
    const s = readCode(REPAIR);
    expect(s).not.toMatch(/\bGRANT\b/i);
    expect(s).not.toMatch(/\bREVOKE\b/i);
    expect(s).not.toMatch(/SECURITY\s+DEFINER/i);
  });

  it("never mutates the append-only evidence tables", () => {
    const s = sql();
    for (const table of ["vehicle_market_valuations", "vehicle_market_comparables"]) {
      expect(s).not.toContain(table);
    }
  });
});

describe("the historical migrations are untouched", () => {
  it("keeps both applied Market V2 migrations byte-identical", () => {
    expect(sha256(`${MIGRATIONS}/20260910140209_d9884db9-8fc7-4d63-bd50-b5e2ba5e5002.sql`))
      .toBe("bdeb39417866aa351dd65245490f14f28df79d335139a859b11e7da64c6e0c7a");
    expect(sha256(`${MIGRATIONS}/20260910140315_62c76cbb-6d47-4745-9ebe-a8568a3b9bc4.sql`))
      .toBe("41b0a4a87c9929024ca5b05b5513107c300ccf4266fcb3cb494ef0d6a6831dd4");
  });

  it("adds exactly one migration that mentions the reservation function", () => {
    const mentions = readdirSync(MIGRATIONS)
      .filter((f) => f.endsWith(".sql"))
      .filter((f) => read(`${MIGRATIONS}/${f}`).includes("market_reserve_provider_call"));
    // The original definition, and this repair. Nothing else.
    expect(mentions.sort()).toEqual([
      "20260910140209_d9884db9-8fc7-4d63-bd50-b5e2ba5e5002.sql",
      "20260911020000_market_reserve_qualify_out_param_collision.sql",
    ]);
  });
});

describe("the writer captures the reservation error instead of discarding it", () => {
  const src = () => read(WRITER);

  it("destructures both data and error from the RPC", () => {
    const s = src();
    expect(s).toMatch(
      /const \{ data: reservation, error: reservationError \} = await admin\.rpc\(/,
    );
    // The old shape is what let a hard SQL failure look like "unavailable".
    expect(s).not.toMatch(/const \{ data: reservation \} = await admin\.rpc\(/);
  });

  it("records a distinct, sanitized reason carrying only the error code", () => {
    const s = src();
    expect(s).toMatch(/reservationOutcome = `rpc_error_\$\{reservationError\.code \?\? "unknown"\}`/);
    expect(s).toContain('console.error("reservation_rpc_failed", reservationError.code ?? "unknown")');
  });

  it("logs no message, details, hint or full error object", () => {
    const s = src();
    const line = s.slice(s.indexOf('console.error("reservation_rpc_failed"'));
    const stmt = line.slice(0, line.indexOf("\n"));
    for (const leak of [".message", ".details", ".hint", "JSON.stringify", "reservationError)"]) {
      expect(stmt).not.toContain(leak);
    }
  });

  it("is distinguishable from every real budget answer", () => {
    // disabled / existing / budget_exceeded are ANSWERS. An RPC error is the
    // absence of one, and must never be filed as any of them.
    const s = src();
    const block = s.slice(s.indexOf("if (reservationError) {"));
    const stmt = block.slice(0, block.indexOf("} else {"));
    for (const answer of ["disabled", "budget_exceeded", "existing", "not_required"]) {
      expect(stmt).not.toContain(`"${answer}"`);
    }
    expect(stmt).toContain("rpc_error_");
  });

  it("still reaches the valuation reasons and the audit row", () => {
    const s = src();
    expect(s).toMatch(/reservation_\$\{reservationOutcome\}/);
    const audit = s.slice(s.indexOf('from("audit_log").insert('));
    expect(audit.slice(0, audit.indexOf("});") + 3)).toContain("reservation: reservationOutcome");
  });

  it("fails closed: only a granted reservation reaches the provider", () => {
    const s = src();
    const errAt = s.indexOf("if (reservationError) {");
    const gateAt = s.indexOf('if (reservationOutcome === "reserved")');
    const callAt = s.indexOf("callProvider(");
    expect(errAt).toBeGreaterThan(-1);
    expect(gateAt).toBeGreaterThan(errAt);
    expect(callAt).toBeGreaterThan(gateAt);
  });

  it("introduces no retry of the RPC or the provider", () => {
    const s = src();
    expect(s.match(/admin\.rpc\(\s*"market_reserve_provider_call"/g)?.length).toBe(1);
    expect(s.match(/callProvider\(/g)?.length).toBe(1);
    expect(s).not.toMatch(/retry|maxAttempts|backoff|attempts\s*</i);
  });

  it("leaves the provider attempt not_attempted when the RPC fails", () => {
    // Nothing in the error branch touches attemptOutcome, so it keeps its
    // initial value and no provider failure is invented.
    const s = src();
    const block = s.slice(s.indexOf("if (reservationError) {"));
    expect(block.slice(0, block.indexOf("} else {"))).not.toContain("attemptOutcome");
  });

  it("never updates or deletes existing valuation or comparable evidence", () => {
    const s = src();
    for (const table of ["vehicle_market_valuations", "vehicle_market_comparables"]) {
      expect(s).not.toMatch(new RegExp(`from\\("${table}"\\)\\s*\\.\\s*(update|delete)`));
    }
    expect(s).not.toMatch(/\.delete\(\)/);
  });

  it("leaves authentication untouched and still ahead of the reservation", () => {
    const s = src();
    const authAt = s.indexOf("const caller = await authenticateCaller(");
    expect(s).toContain("matchesDedicatedInvocationKey(");
    expect(s).toContain("matchesLegacyServiceRole(");
    expect(s).toContain('auth: ["secret:*", "user"]');
    expect(s.indexOf("market_reserve_provider_call")).toBeGreaterThan(authAt);
  });
});
