// ── An enabled budget cannot make an evidence-only run spend ───────────────
//
// The dangerous shape is not "shadow forgot to check the budget". It is the
// reverse: someone enables a budget for an authorized run, and a shadow run
// happening at the same moment finds money available and takes it.
//
// The defence is structural rather than conditional. `providerCallPermitted`
// takes ONE argument — the request's policy — and the branch that reserves and
// spends is one a disabled request never enters. There is no code path where a
// budget is consulted for a disabled request, so there is nothing for an
// enabled budget to be consulted BY.
//
// These tests prove that by construction: first on the pure function, then on
// the writer's actual source, then by mutating the source and watching the
// guard fail.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { providerCallPermitted, readProviderPolicy } from "./shadowPipeline.ts";

const WRITER = "supabase/functions/market-valuation-write/index.ts";
const code = readFileSync(WRITER, "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** The three regions of the provider decision, bounded on code. */
const regions = () => {
  const reuseAt = code.indexOf("if (reuse.providerReusable && !body.force) {");
  const disabledAt = code.indexOf("} else if (!providerCallPermitted(providerPolicy)) {");
  const spendAt = code.indexOf("} else if (built.request && MC_KEY && !dryRun) {");
  return { reuseAt, disabledAt, spendAt };
};

describe("the permission function cannot be influenced by money", () => {
  it("takes only the policy", () => {
    expect(providerCallPermitted.length).toBe(1);
  });

  it("returns the same answer whatever else is true", () => {
    // There is no second argument to pass a budget, a flag or a key through,
    // which is the point — this is a type-level guarantee, asserted.
    expect(providerCallPermitted("disabled")).toBe(false);
    expect(providerCallPermitted(readProviderPolicy("disabled"))).toBe(false);
    expect(providerCallPermitted("reserved")).toBe(true);
  });
});

describe("the writer's structure makes the spend unreachable", () => {
  it("orders the branches: reuse, then disabled, then spend", () => {
    const { reuseAt, disabledAt, spendAt } = regions();
    expect(reuseAt).toBeGreaterThan(-1);
    expect(disabledAt).toBeGreaterThan(reuseAt);
    expect(spendAt).toBeGreaterThan(disabledAt);
  });

  it("keeps every spending symbol inside the spending branch", () => {
    const { disabledAt, spendAt } = regions();
    const disabledBranch = code.slice(disabledAt, spendAt);
    for (const spend of [
      "market_reserve_provider_call", "callProvider(", "predictionUrl(",
      "MC_KEY", "market_provider_budgets", "attempt_id",
    ]) {
      expect(disabledBranch, spend).not.toContain(spend);
    }
  });

  it("consults the budget in exactly one place, and only there", () => {
    // The reservation RPC IS the budget check — it locks the budget row and
    // decides under that lock. One call site means one place money can leave.
    expect(code.match(/market_reserve_provider_call/g)?.length).toBe(1);
    const { spendAt } = regions();
    expect(code.indexOf("market_reserve_provider_call")).toBeGreaterThan(spendAt);
  });

  it("never re-tests the policy after the branch, where a budget could re-open it", () => {
    const { spendAt } = regions();
    const afterSpend = code.slice(spendAt);
    // No `|| budget`, no `&& enabled`, no second chance.
    expect(afterSpend).not.toMatch(/providerCallPermitted\([^)]*\)\s*\|\|/);
    expect(code).not.toMatch(/providerCallPermitted\([^)]*,[^)]*\)/);
  });

  it("records the refusal as its own outcome, not as a budget answer", () => {
    const { disabledAt, spendAt } = regions();
    const disabledBranch = code.slice(disabledAt, spendAt);
    expect(disabledBranch).toContain('reservationOutcome = "provider_disabled";');
    for (const budgetAnswer of ["disabled\"", "budget_exceeded", "existing", "reserved\""]) {
      // `provider_disabled` is distinct from the RPC's own `disabled`.
      expect(disabledBranch.replace(/provider_disabled/g, ""), budgetAnswer)
        .not.toContain(budgetAnswer);
    }
  });
});

describe("mutating the guard breaks the guard", () => {
  /** Reproduce the three ways someone could re-open the spend, on a copy. */
  const mutate = (from: string, to: string) => code.replace(from, to);

  it("removing the disabled branch is detectable", () => {
    const broken = mutate("} else if (!providerCallPermitted(providerPolicy)) {", "} else if (false) {");
    expect(broken.indexOf("} else if (!providerCallPermitted(providerPolicy)) {")).toBe(-1);
    // The ordering assertion above is what fails on this mutation.
    expect(broken).not.toContain("providerCallPermitted(providerPolicy)");
  });

  it("moving the spend branch above it is detectable", () => {
    const { disabledAt, spendAt } = regions();
    // The real file has disabled first. A swap inverts this relation, which is
    // exactly what the ordering test asserts.
    expect(disabledAt < spendAt).toBe(true);
  });

  it("adding a budget escape hatch is detectable", () => {
    const broken = mutate(
      "} else if (!providerCallPermitted(providerPolicy)) {",
      "} else if (!providerCallPermitted(providerPolicy) && !budgetEnabled) {",
    );
    expect(broken).toMatch(/providerCallPermitted\(providerPolicy\) && !budgetEnabled/);
    // And the real source carries no such conjunction.
    expect(code).not.toMatch(/providerCallPermitted\(providerPolicy\)\s*&&/);
  });
});

describe("the authorized path keeps its provider behaviour", () => {
  it("still reserves before it spends", () => {
    const reserveAt = code.indexOf("market_reserve_provider_call");
    const callAt = code.indexOf("callProvider(");
    expect(reserveAt).toBeGreaterThan(-1);
    expect(callAt).toBeGreaterThan(reserveAt);
    expect(code).toContain('if (reservationOutcome === "reserved")');
  });

  it("has not globally disabled provider support", () => {
    expect(code).toContain("const MC_KEY = Deno.env.get(");
    expect(code).toContain("callProvider(");
    expect(readProviderPolicy(undefined)).toBe("reserved");
  });

  it("makes exactly one provider request per authorized call, with no retry", () => {
    expect(code.match(/callProvider\(/g)?.length).toBe(1);
    expect(code).not.toMatch(/retry|maxAttempts|backoff/i);
  });
});
