// The migration is not applied, so these cannot be INSERT tests yet. They are
// the next best thing and they catch the class of defect Gate 13 found: a
// CHECK constraint that reads like a guarantee and evaluates to NULL.
//
// PostgreSQL accepts a CHECK whose expression is true OR NULL. A nullable
// column inside a conjunction is therefore a hole. Two things are asserted
// here: that the migration text carries the null-safe constructs, and that the
// red gate's LOGIC — re-implemented in JS with the same three-valued semantics
// — is false, never undefined, for every way of arriving at it short-handed.
//
// The live INSERT canaries run at Gate 14A and are written into that packet.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const SQL = readFileSync("supabase/migrations/20260910140209_d9884db9-8fc7-4d63-bd50-b5e2ba5e5002.sql", "utf8");

const EVIDENCE_TABLES = ["vehicle_market_valuations", "vehicle_market_comparables"];

describe("schema shape", () => {
  it("makes price_basis_status NOT NULL", () => {
    expect(SQL).toMatch(/price_basis_status\s+text\s+NOT NULL/);
  });

  it("carries certification_match as a three-state boolean", () => {
    expect(SQL).toMatch(/certification_match\s+boolean/);
  });

  it("keeps both fingerprints as separate columns", () => {
    expect(SQL).toMatch(/provider_request_fingerprint\s+text/);
    expect(SQL).toMatch(/valuation_input_fingerprint\s+text/);
    expect(SQL).toMatch(/vmv_fingerprints_are_distinct/);
  });

  it("records the concentration facts the review asked to be stored", () => {
    for (const col of [
      "top_rooftop_share", "top_group_share", "effective_rooftop_cap",
      "effective_group_cap", "strict_concentration_satisfied", "insufficient_market_diversity",
    ]) {
      expect(SQL).toContain(col);
    }
  });

  it("gives every comparable an evidence reference so a VIN-less row is still addressable", () => {
    expect(SQL).toMatch(/evidence_ref\s+text\s+NOT NULL/);
    expect(SQL).toContain("uq_vmc_valuation_evidence_ref");
  });
});

describe("no CHECK on evidence tables can evaluate to NULL", () => {
  // Every CHECK we wrote, extracted from the migration.
  const checks = [...SQL.matchAll(/CONSTRAINT\s+(\w+)\s+(?:UNIQUE|FOREIGN KEY|CHECK)([\s\S]*?)(?=,\n\s{2}(?:CONSTRAINT|--)|\n\);)/g)]
    .map((m) => ({ name: m[1], body: m[2] }));

  it("finds the constraints", () => {
    expect(checks.length).toBeGreaterThan(15);
  });

  it("wraps every risky conjunction in IS TRUE or uses only null-safe predicates", () => {
    const offenders: string[] = [];
    for (const { name, body } of checks) {
      if (!name.startsWith("vmv_") && !name.startsWith("vmc_") && !name.startsWith("mvmm_") && !name.startsWith("mpb_") && !name.startsWith("prr_")) continue;
      if (body.includes("UNIQUE") || body.includes("FOREIGN KEY")) continue;
      const nullSafe =
        body.includes("IS TRUE")
        // `x IN (...)` on a NOT NULL column, and IS DISTINCT FROM / IS NULL,
        // cannot produce NULL.
        || /^\s*CHECK \(\w+ IN \(/.test(body)
        || (!body.includes("=") && !body.includes(">") && !body.includes("<"));
      if (!nullSafe) offenders.push(name);
    }
    expect(offenders, `these CHECKs can evaluate to NULL and would be accepted:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("names each red requirement individually so a rejection says which one failed", () => {
    for (const c of [
      "vmv_red_requires_high_confidence", "vmv_red_requires_five_effective_comps",
      "vmv_red_requires_three_rooftops", "vmv_red_requires_rooftop_concentration",
      "vmv_red_requires_group_concentration", "vmv_red_requires_verified_price_basis",
      "vmv_red_requires_certification_match", "vmv_red_requires_market_diversity",
    ]) {
      expect(SQL).toContain(c);
    }
  });

  it("forbids an unavailable valuation from carrying a tone or a claim", () => {
    expect(SQL).toContain("vmv_unavailable_is_never_red");
    expect(SQL).toContain("vmv_unavailable_confidence_is_never_red");
    expect(SQL).toContain("vmv_unavailable_makes_no_claim");
  });

  it("forbids a certification mismatch from being stored as available or high confidence", () => {
    expect(SQL).toContain("vmv_mismatch_is_never_available");
    expect(SQL).toContain("vmv_high_confidence_requires_certification_match");
  });

  it("constrains the stored verdict and tone vocabularies", () => {
    expect(SQL).toContain("vmv_verdict_vocabulary_check");
    expect(SQL).toContain("vmv_tone_check");
    expect(SQL).toContain("Above Adjusted Market");
    expect(SQL).toContain("Market Estimate Unavailable");
  });
});

// The red gate, re-implemented with PostgreSQL's three-valued logic, so the
// truth table is pinned in the suite and not only in a query result.
type Row = {
  tone: string | null; confidence: string | null; ess: number | null; rooftops: number | null;
  topRooftop: number | null; topGroup: number | null; basis: string | null;
  certMatch: boolean | null; insufficientDiversity: boolean | null; strictConcentration: boolean | null;
};
const isDistinctFrom = (a: unknown, b: unknown) => !(a === b);
const isNotDistinctFrom = (a: unknown, b: unknown) => a === b;
const coalesce = <T,>(a: T | null | undefined, b: T): T => (a == null ? b : a);

function redGate(r: Row): boolean {
  if (isDistinctFrom(r.tone, "red")) return true;
  return (
    isNotDistinctFrom(r.confidence, "high")
    && coalesce(r.ess, 0) >= 5
    && coalesce(r.rooftops, 0) >= 3
    && coalesce(r.topRooftop, 1) <= 0.2
    && coalesce(r.topGroup, 1) <= 0.2
    && isNotDistinctFrom(r.basis, "verified")
    && r.certMatch === true
    && coalesce(r.insufficientDiversity, true) === false
    && coalesce(r.strictConcentration, false) === true
  );
}

const evidenced: Row = {
  tone: "red", confidence: "high", ess: 6, rooftops: 4, topRooftop: 0.19, topGroup: 0.19,
  basis: "verified", certMatch: true, insufficientDiversity: false, strictConcentration: true,
};

describe("red gate truth table", () => {
  it("accepts a fully evidenced red", () => {
    expect(redGate(evidenced)).toBe(true);
  });

  it("rejects the Gate 13 bypass instead of returning null", () => {
    const bypass: Row = {
      tone: "red", confidence: "low", ess: 0, rooftops: 0, topRooftop: 0.9, topGroup: 0.9,
      basis: null, certMatch: null, insufficientDiversity: true, strictConcentration: false,
    };
    const result = redGate(bypass);
    expect(result).toBe(false);
    expect(result).not.toBeNull();
    expect(result).not.toBeUndefined();
  });

  it("rejects red for every individually missing requirement", () => {
    const breakages: [string, Partial<Row>][] = [
      ["confidence not high", { confidence: "medium" }],
      ["confidence null", { confidence: null }],
      ["four effective comps", { ess: 4 }],
      ["null effective comps", { ess: null }],
      ["two rooftops", { rooftops: 2 }],
      ["null rooftops", { rooftops: null }],
      ["rooftop share over cap", { topRooftop: 0.21 }],
      ["null rooftop share", { topRooftop: null }],
      ["group share over cap", { topGroup: 0.21 }],
      ["null group share", { topGroup: null }],
      ["basis ambiguous", { basis: "ambiguous" }],
      ["basis null", { basis: null }],
      ["certification unknown", { certMatch: null }],
      ["certification mismatched", { certMatch: false }],
      ["insufficient diversity", { insufficientDiversity: true }],
      ["strict concentration unmet", { strictConcentration: false }],
      ["strict concentration null", { strictConcentration: null }],
    ];
    for (const [why, patch] of breakages) {
      expect(redGate({ ...evidenced, ...patch }), why).toBe(false);
    }
  });

  it("leaves every non-red tone alone", () => {
    for (const tone of ["neutral", "green", "amber", null]) {
      expect(redGate({ ...evidenced, tone, confidence: "low", ess: 0, certMatch: null })).toBe(true);
    }
  });
});

describe("append-only is enforced by the database, not by convention", () => {
  it("rejects UPDATE and DELETE by trigger on both evidence tables", () => {
    expect(SQL).toContain("reject_valuation_mutation");
    for (const table of EVIDENCE_TABLES) {
      expect(SQL).toMatch(new RegExp(`BEFORE UPDATE OR DELETE ON public\\.${table}`));
    }
  });

  it("keys the guard on the table owner, with no GUC a runtime role could set", () => {
    expect(SQL).toContain("current_user = v_owner");
    expect(SQL).not.toMatch(/current_setting\([^)]*allow[^)]*\)/i);
  });

  it("revokes UPDATE, DELETE and TRUNCATE from every runtime role", () => {
    for (const table of EVIDENCE_TABLES) {
      expect(SQL).toMatch(
        new RegExp(`REVOKE UPDATE, DELETE, TRUNCATE ON public\\.${table}\\s+FROM PUBLIC, anon, authenticated, service_role`),
      );
    }
  });

  it("preserves INSERT for the writer", () => {
    for (const table of EVIDENCE_TABLES) {
      expect(SQL).toMatch(new RegExp(`GRANT SELECT, INSERT ON public\\.${table}\\s+TO service_role`));
    }
  });

  it("leaves the calculated metrics table mutable on purpose", () => {
    expect(SQL).not.toMatch(/BEFORE UPDATE OR DELETE ON public\.market_value_model_metrics/);
  });

  it("puts recovery behind an owner-only procedure no runtime role may execute", () => {
    expect(SQL).toContain("admin_purge_tenant_market_evidence");
    expect(SQL).toMatch(/REVOKE ALL ON FUNCTION public\.admin_purge_tenant_market_evidence\(uuid, text\)\s+FROM PUBLIC, anon, authenticated, service_role/);
  });

  it("does not let a tenant deletion cascade through the evidence", () => {
    const cascades = [...SQL.matchAll(/REFERENCES public\.tenants\(id\) ON DELETE (\w+)/g)].map((m) => m[1]);
    expect(cascades.length).toBeGreaterThan(0);
    expect(cascades.every((c) => c === "RESTRICT")).toBe(true);
  });
});

describe("write-side tenant integrity", () => {
  it("keys the comparable ledger to its parent AND its tenant together", () => {
    expect(SQL).toContain("vmv_id_tenant_unique UNIQUE (id, tenant_id)");
    expect(SQL).toMatch(/FOREIGN KEY \(valuation_id, tenant_id\)\s+REFERENCES public\.vehicle_market_valuations \(id, tenant_id\)/);
  });

  it("forbids a weighted comparable without a VIN", () => {
    expect(SQL).toContain("vmc_voting_rows_have_a_vin");
  });
});

describe("global model metrics are not readable by dealership users", () => {
  it("requires a non-null tenant and membership, never `tenant_id IS NULL OR`", () => {
    const policy = SQL.slice(SQL.indexOf('"market_value_model_metrics tenant read"'));
    expect(policy).toContain("tenant_id IS NOT NULL");
    expect(SQL).not.toMatch(/USING \(\s*tenant_id IS NULL\s*\n?\s*OR/);
  });

  it("reserves the global set for an internal platform administrator", () => {
    expect(SQL).toContain('"market_value_model_metrics platform admin read"');
    // Through the SECURITY DEFINER helper, not a raw EXISTS on user_roles: a
    // subquery against an RLS-protected table inside a policy evaluates that
    // table's own policies, which is a policy inside a policy and the shape
    // this repository's recursion incidents came from.
    expect(SQL).toContain("public.has_role((SELECT auth.uid()), 'admin'::public.app_role)");
    expect(SQL).not.toMatch(/CREATE POLICY[\s\S]{0,400}FROM public\.user_roles/);
  });
});

describe("what a dealership is charged is not vehicle data", () => {
  // A salesperson needs the valuation. They have no business reading the
  // monthly provider budget, the cost of each paid lookup, or how much of the
  // month's spend is gone.
  const MANAGER_ONLY = ["market_provider_budgets", "provider_request_reservations"];

  it("restricts budget and reservation reads to tenant managers", () => {
    for (const table of MANAGER_ONLY) {
      expect(SQL).toContain(`"${table} manager read"`);
      expect(SQL).not.toContain(`CREATE POLICY "${table} tenant read"`);
    }
  });

  it("calls is_tenant_manager with the tenant first", () => {
    // Reversed, the helper silently returns false for everyone and the table
    // reads as empty rather than as an error — a bug with no symptom.
    // Only real call sites: the doc comment above the policy quotes the
    // declared signature, which is not a call.
    const calls = [...SQL.matchAll(/public\.is_tenant_manager\((.*)\)\n/g)].map((m) => m[1].trim());
    expect(calls.length).toBeGreaterThan(0);
    for (const args of calls) {
      expect(args).toMatch(/^tenant_id\s*,\s*\(SELECT auth\.uid\(\)\)$/);
    }
  });

  it("still lets a platform administrator see them", () => {
    for (const table of MANAGER_ONLY) {
      const policy = SQL.slice(SQL.indexOf(`"${table} manager read"`));
      expect(policy.slice(0, 400)).toContain("public.has_role((SELECT auth.uid()), 'admin'::public.app_role)");
    }
  });

  it("leaves the valuation tables readable by any tenant member", () => {
    for (const table of EVIDENCE_TABLES) {
      expect(SQL).toContain(`"${table} tenant read"`);
    }
  });
});

describe("every function pins its search path", () => {
  const FUNCTIONS = [
    "reject_valuation_mutation",
    "admin_purge_tenant_market_evidence",
    "market_reserve_provider_call",
    "market_complete_provider_call",
    "market_valuation_commit",
  ];

  it("declares SET search_path on each one", () => {
    // A trigger fires implicitly on every write, so the caller's search_path
    // is attacker-adjacent input. Pinning is defence in depth on top of the
    // schema-qualified references the bodies already use.
    const declared = [...SQL.matchAll(/SET search_path = pg_catalog, public/g)];
    expect(declared.length).toBe(FUNCTIONS.length);
  });

  it("leaves no CREATE FUNCTION without one", () => {
    const created = [...SQL.matchAll(/CREATE (?:OR REPLACE )?FUNCTION public\.(\w+)/g)].map((m) => m[1]);
    expect(new Set(created)).toEqual(new Set(FUNCTIONS));
    for (const fn of created) {
      const body = SQL.slice(SQL.indexOf(`FUNCTION public.${fn}`));
      const head = body.slice(0, body.indexOf("AS $"));
      expect(head, fn).toContain("SET search_path = pg_catalog, public");
    }
  });
});

describe("provider spend is reserved before the call, not after", () => {
  it("holds at most one live reservation per provider fingerprint", () => {
    expect(SQL).toMatch(/CREATE UNIQUE INDEX[\s\S]{0,120}uq_prr_active_fingerprint[\s\S]{0,200}WHERE status = 'reserved'/);
  });

  it("checks the budget under a row lock so two callers cannot both spend it", () => {
    expect(SQL).toContain("market_reserve_provider_call");
    expect(SQL).toMatch(/FROM public\.market_provider_budgets\s*\n?\s*WHERE tenant_id = p_tenant_id FOR UPDATE/);
  });

  it("reclaims expired reservations and reconciles actual cost", () => {
    expect(SQL).toContain("reservation_expired");
    expect(SQL).toContain("market_complete_provider_call");
    expect(SQL).toContain("actual_cost_usd");
  });

  it("commits the valuation and its evidence together", () => {
    expect(SQL).toContain("market_valuation_commit");
  });

  it("supplies the identity and timestamp the populate-record insert cannot default", () => {
    // jsonb_populate_record yields NULL for an absent key, and an explicit NULL
    // bypasses a column default — so `id` and `created_at` have to be provided.
    const fn = SQL.slice(SQL.indexOf("market_valuation_commit"));
    expect(fn).toContain("v_id      uuid := gen_random_uuid()");
    expect(fn).toMatch(/jsonb_build_object\('id', v_id::text, 'created_at', v_now\)/);
    expect(fn).toMatch(/'id', gen_random_uuid\(\)::text/);
  });

  it("keeps every RPC away from anon and authenticated", () => {
    for (const fn of ["market_reserve_provider_call", "market_complete_provider_call", "market_valuation_commit"]) {
      expect(SQL).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}[\\s\\S]{0,80}FROM PUBLIC, anon, authenticated`));
      expect(SQL).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}[\\s\\S]{0,80}TO service_role`));
    }
  });
});
