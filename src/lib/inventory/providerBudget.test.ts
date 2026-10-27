import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  decideAdmission, outcomeForAnswer, parseAdmitRow, PROVIDER_CALL_OUTCOMES,
} from "../../../supabase/functions/_shared/providerBudgetPolicy";

describe("decideAdmission", () => {
  const base = { cap: 5000, reserve: 250, enabled: true };

  it("admits anything while the gate is off", () => {
    expect(decideAdmission({ ...base, enabled: false, monthCalls: 99999, essential: false })).toEqual({ admitted: true, reason: "ungated" });
  });

  it("admits ordinary calls under cap minus reserve and refuses them inside the reserve", () => {
    expect(decideAdmission({ ...base, monthCalls: 4749, essential: false }).admitted).toBe(true);
    expect(decideAdmission({ ...base, monthCalls: 4750, essential: false })).toEqual({ admitted: false, reason: "reserve_for_essential" });
  });

  it("admits essential calls up to the cap and refuses everyone at the cap", () => {
    expect(decideAdmission({ ...base, monthCalls: 4999, essential: true }).admitted).toBe(true);
    expect(decideAdmission({ ...base, monthCalls: 5000, essential: true })).toEqual({ admitted: false, reason: "monthly_cap" });
    expect(decideAdmission({ ...base, monthCalls: 5000, essential: false })).toEqual({ admitted: false, reason: "monthly_cap" });
  });
});

describe("outcomeForAnswer", () => {
  it("tells the monthly quota from a rate limit, and names the rest", () => {
    expect(outcomeForAnswer(429, '{"message":"Monthly API quota exhausted"}')).toBe("refused_quota");
    expect(outcomeForAnswer(429, "Too many requests")).toBe("refused_rate");
    expect(outcomeForAnswer(200)).toBe("ok");
    expect(outcomeForAnswer(404)).toBe("no_result");
    expect(outcomeForAnswer(401)).toBe("refused_auth");
    expect(outcomeForAnswer(503)).toBe("provider_error");
    expect(outcomeForAnswer(null)).toBe("transport_error");
    expect(outcomeForAnswer(0)).toBe("transport_error");
  });

  it("only ever returns a ledger outcome", () => {
    for (const s of [200, 204, 301, 400, 401, 404, 429, 500, null]) {
      expect(PROVIDER_CALL_OUTCOMES).toContain(outcomeForAnswer(s));
    }
  });
});

describe("parseAdmitRow", () => {
  it("reads the RPC row, as a row or a one-row array", () => {
    const row = { admitted: false, event_id: "42", month_calls: 4750, monthly_call_cap: 5000, reserve_for_essential: 250, reason: "reserve_for_essential" };
    expect(parseAdmitRow(row)).toEqual({ admitted: false, eventId: 42, monthCalls: 4750, cap: 5000, reserve: 250, reason: "reserve_for_essential" });
    expect(parseAdmitRow([row])?.eventId).toBe(42);
  });

  it("treats a missing or malformed answer as an unavailable gate", () => {
    expect(parseAdmitRow(null)).toBeNull();
    expect(parseAdmitRow([])).toBeNull();
    expect(parseAdmitRow({ admitted: true, reason: "???" })?.reason).toBe("gate_unavailable");
  });
});

describe("the SQL gate states the same rule", () => {
  const sql = readFileSync("supabase/migrations/20261027205000_provider_call_budget.sql", "utf8");

  it("counts the month without the gate's own refusals and serialises on the budget row", () => {
    expect(sql).toMatch(/WHERE provider = p_provider AND at >= v_month AND outcome <> 'budget_denied'/);
    expect(sql).toMatch(/WHERE provider = p_provider FOR UPDATE/);
  });

  it("holds the reserve for essential calls only", () => {
    expect(sql).toMatch(/IF v_count >= v_budget\.monthly_call_cap THEN\s+v_reason := 'monthly_cap';/);
    expect(sql).toMatch(/ELSIF NOT p_essential AND v_count >= v_budget\.monthly_call_cap - v_budget\.reserve_for_essential THEN\s+v_reason := 'reserve_for_essential';/);
  });

  it("seeds the plan's cap and keeps the ledger append-only for everyone but the service role", () => {
    expect(sql).toMatch(/VALUES \('marketcheck', 5000, 250, true,/);
    expect(sql).toMatch(/REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public\.provider_call_events\s+FROM authenticated;/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.provider_call_admit\(text, text, text, boolean, uuid, text, numeric\) TO service_role;/);
    expect(sql).toMatch(/WHERE user_id = \(SELECT auth\.uid\(\)\)/);
    expect(sql).toMatch(/TO authenticated\s+USING \(\s+tenant_id IN/);
  });

  it("keeps the ledger's outcome vocabulary in step with the policy module", () => {
    for (const o of PROVIDER_CALL_OUTCOMES) expect(sql).toContain(`'${o}'`);
  });
});
