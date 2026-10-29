import { describe, it, expect } from "vitest";
import { budgetPayload, isMissingSchema, parseEmails, parsePhones, parseThresholds, percentUsed, type BudgetForm } from "./providerBudgets";

const form = (o: Partial<BudgetForm> = {}): BudgetForm => ({
  tenantId: "t1", provider: "*", mode: "alert_only", callCap: "", usdCap: "250", thresholds: "80, 100", notes: "", ...o,
});

describe("Budgets & alerts form rules", () => {
  it("reads email recipients, dropping duplicates and naming bad ones", () => {
    expect(parseEmails("A@example.com, a@example.com\nops@example.com")).toEqual({ ok: ["a@example.com", "ops@example.com"], invalid: [] });
    expect(parseEmails("nope").invalid).toEqual(["nope"]);
  });

  it("reads text message recipients into E.164, accepting US numbers as typed", () => {
    expect(parsePhones("(555) 010-0000, +447700900123").ok).toEqual(["+15550100000", "+447700900123"]);
    expect(parsePhones("1 555 010 0000").ok).toEqual(["+15550100000"]);
    expect(parsePhones("12345").invalid).toEqual(["12345"]);
  });

  it("reads alert points as sorted whole percentages", () => {
    expect(parseThresholds("100, 50%, 80")).toEqual({ ok: [50, 80, 100], error: null });
    expect(parseThresholds("0").error).toMatch(/1 to 200/);
    expect(parseThresholds("10 20 30 40 50 60").error).toMatch(/five/);
    expect(parseThresholds("")).toEqual({ ok: [], error: null });
  });

  it("builds the save payload and refuses a budget with no limit", () => {
    expect(budgetPayload(form({ usdCap: "$1,250.505", callCap: "300" })).payload).toMatchObject({
      p_tenant_id: "t1", p_provider: "*", p_mode: "alert_only", p_monthly_call_cap: 300, p_monthly_usd_cap: 1250.51, p_alert_thresholds: [80, 100],
    });
    expect(budgetPayload(form({ usdCap: "" })).error).toMatch(/call limit, a dollar limit, or both/);
    expect(budgetPayload(form({ usdCap: "", mode: "off" })).error).toBeNull();
    expect(budgetPayload(form({ callCap: "2.5" })).error).toMatch(/whole number/);
    expect(budgetPayload(form({ tenantId: "" })).error).toMatch(/dealership/);
  });

  it("measures use as the larger of the two limits", () => {
    expect(percentUsed(50, 9, 100, 10)).toBe(90);
    expect(percentUsed(50, 9, null, null)).toBeNull();
    expect(percentUsed(0, 0, 0, null)).toBe(100);
  });

  it("recognises the answers of a database without the migration", () => {
    expect(isMissingSchema({ code: "PGRST202", message: "Could not find the function" })).toBe(true);
    expect(isMissingSchema({ code: "42P01", message: 'relation "x" does not exist' })).toBe(true);
    expect(isMissingSchema({ code: "42501", message: "platform admin required" })).toBe(false);
    expect(isMissingSchema(null)).toBe(false);
  });
});
