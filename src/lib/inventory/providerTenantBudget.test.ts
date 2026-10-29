import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  decideTenantAdmission, parseAdmitRow, tenantBudgetPercent, thresholdsReached, type TenantBudget,
} from "../../../supabase/functions/_shared/providerBudgetPolicy";
import {
  composeAlert, isSettled, MAX_ATTEMPTS, planDelivery, type AlertSettings, type BudgetAlertRow,
} from "../../../supabase/functions/_shared/budgetAlerts";
import { classifyCrawlOutcome, CRAWL_OUTCOMES } from "../../../supabase/functions/_shared/crawlOutcome";
import {
  classifyHarvest, classifySticker, harvestChargesProvider, persistedLinkOutcome, stickerChargesProvider, stickerStampsChecked,
} from "../../../supabase/functions/_shared/packetBackfill";
import { crawlOutcomeToCall } from "@/lib/admin/integrations/providers";

const budget = (o: Partial<TenantBudget> = {}): TenantBudget => ({
  provider: "firecrawl", mode: "enforce", monthlyCallCap: 100, monthlyUsdCap: null, alertThresholds: [80, 100], blockEssential: false, ...o,
});

describe("dealership budget admission", () => {
  const used = (calls: number, usd = 0) => () => ({ calls, usd });

  it("admits under the limit and refuses at it when enforced", () => {
    expect(decideTenantAdmission([budget()], used(99), false, null)).toEqual({ admitted: true, refusedBy: null });
    expect(decideTenantAdmission([budget()], used(100), false, null)).toEqual({ admitted: false, refusedBy: "firecrawl" });
  });

  it("never refuses in alert-only mode", () => {
    expect(decideTenantAdmission([budget({ mode: "alert_only" })], used(10_000), false, null).admitted).toBe(true);
  });

  it("lets the essential feed through an enforced limit unless the feed is blocked too", () => {
    expect(decideTenantAdmission([budget()], used(100), true, null).admitted).toBe(true);
    expect(decideTenantAdmission([budget({ blockEssential: true })], used(100), true, null).admitted).toBe(false);
  });

  it("counts this call's price against a dollar limit", () => {
    const b = budget({ monthlyCallCap: null, monthlyUsdCap: 10 });
    expect(decideTenantAdmission([b], used(5, 9.99), false, 0.01).admitted).toBe(true);
    expect(decideTenantAdmission([b], used(5, 9.99), false, 0.02).admitted).toBe(false);
  });

  it("applies the all-providers budget alongside the provider's own", () => {
    const all = budget({ provider: "*", monthlyCallCap: 50 });
    const own = budget({ monthlyCallCap: 1000 });
    const usage = (p: string) => (p === "*" ? { calls: 50, usd: 0 } : { calls: 10, usd: 0 });
    expect(decideTenantAdmission([own, all], usage, false, null)).toEqual({ admitted: false, refusedBy: "*" });
  });

  it("reports the thresholds reached, the larger of calls and dollars", () => {
    const b = budget({ monthlyCallCap: 100, monthlyUsdCap: 10, alertThresholds: [50, 80, 100] });
    expect(tenantBudgetPercent(b, { calls: 10, usd: 8.5 })).toBeCloseTo(85);
    expect(thresholdsReached(b, { calls: 10, usd: 8.5 })).toEqual([50, 80]);
    expect(thresholdsReached(budget({ mode: "off" }), { calls: 1000, usd: 0 })).toEqual([]);
    expect(thresholdsReached(budget({ monthlyCallCap: 0 }), { calls: 0, usd: 0 })).toEqual([80, 100]);
  });

  it("reads the gate's tenant_budget refusal instead of treating it as an unavailable gate", () => {
    expect(parseAdmitRow({ admitted: false, event_id: 7, month_calls: 100, monthly_call_cap: 100, reason: "tenant_budget" })?.reason).toBe("tenant_budget");
  });
});

describe("alert delivery plan", () => {
  const s = (o: Partial<AlertSettings> = {}): AlertSettings => ({
    email_enabled: true, sms_enabled: true, email_recipients: ["a@example.com"], sms_recipients: ["+15550100000"], ...o,
  });
  const fresh = { email_status: null, sms_status: null };

  it("sends on both channels at once when both are on", () => {
    expect(planDelivery(fresh, s())).toEqual({ send: ["email", "sms"], settled: {} });
  });

  it("sends by email only or text only, and records the other as off", () => {
    expect(planDelivery(fresh, s({ sms_enabled: false }))).toEqual({ send: ["email"], settled: { sms: "disabled" } });
    expect(planDelivery(fresh, s({ email_enabled: false }))).toEqual({ send: ["sms"], settled: { email: "disabled" } });
  });

  it("sends nothing when both are off, and the alert settles at once", () => {
    const p = planDelivery(fresh, s({ email_enabled: false, sms_enabled: false }));
    expect(p.send).toEqual([]);
    expect(isSettled(p.settled.email ?? null, p.settled.sms ?? null, 0)).toBe(true);
  });

  it("retries only the channel that failed and never resends a sent one", () => {
    expect(planDelivery({ email_status: "sent", sms_status: "failed" }, s()).send).toEqual(["sms"]);
    expect(isSettled("sent", "failed", 1)).toBe(false);
    expect(isSettled("sent", "failed", MAX_ATTEMPTS)).toBe(true);
  });

  it("records a switched-on channel with no recipients without sending", () => {
    expect(planDelivery(fresh, s({ sms_recipients: [] }))).toEqual({ send: ["email"], settled: { sms: "no_recipients" } });
  });

  it("composes a message that names the dealership, provider and use, and escapes markup", () => {
    const a: BudgetAlertRow = {
      id: 1, tenant_id: "t", provider: "*", month: "2026-11-01", kind: "threshold", threshold: 80, mode: "alert_only",
      calls: 80, usd: "8.00", monthly_call_cap: 100, monthly_usd_cap: "10.00", caller: "crawl-advertised-prices",
      email_status: null, sms_status: null, attempts: 0,
    };
    const esc = (v: unknown) => String(v).replace(/</g, "&lt;");
    const m = composeAlert(a, "<b>Lot</b> Motors", "https://example.test/platform-admin?tab=budgets", esc);
    expect(m.subject).toContain("all providers budget at 80%");
    expect(m.text).toContain("80 of 100 calls, $8.00 of $10.00");
    expect(m.text).toContain("November 2026");
    expect(m.html).toContain("&lt;b>Lot&lt;/b> Motors");
    expect(m.html).not.toContain("<b>Lot</b>");
    const denied = composeAlert({ ...a, kind: "call_denied", mode: "enforce", provider: "firecrawl" }, "Lot", "u", esc);
    expect(denied.subject).toContain("calls are being refused");
  });
});

describe("a budget refusal is named, never mistaken for a provider answer", () => {
  it("crawl ledger: render_budget_refused, mapped to budget_denied on the health card", () => {
    expect(CRAWL_OUTCOMES).toContain("render_budget_refused");
    const c = classifyCrawlOutcome({
      captured: false, reason: null, cheapStatus: 403, renderAttempted: false, renderStatus: null, renderError: null,
      renderConfigured: true, renderBudgetRefused: true,
    });
    expect(c.outcome).toBe("render_budget_refused");
    expect(crawlOutcomeToCall("render_budget_refused")).toBe("budget_denied");
  });

  it("packet backfill: a refused sticker is neither charged nor stamped as having no sticker", () => {
    const o = classifySticker({ ok: true, data: { ok: false, error: "budget_refused" } } as never);
    expect(o).toBe("budget_refused");
    expect(stickerChargesProvider(o)).toBe(false);
    expect(stickerStampsChecked(o)).toBe(false);
  });

  it("packet backfill: a refused brochure search is neither charged nor cached", () => {
    const o = classifyHarvest({ ok: true, data: { ok: false, error: "budget_refused" } } as never);
    expect(o).toBe("budget_refused");
    expect(harvestChargesProvider(o)).toBe(false);
    expect(persistedLinkOutcome(o)).toBeNull();
  });
});

describe("the proposed SQL states the same rules", () => {
  const sql = readFileSync("supabase/proposed/20261103000000_provider_tenant_budgets.sql", "utf8");
  const admit = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.provider_call_admit("));

  it("checks the dealership before the platform budget, and keeps the platform rule unchanged", () => {
    expect(admit.indexOf("provider_tenant_budgets")).toBeLessThan(admit.indexOf("FROM public.provider_call_budgets"));
    expect(admit).toMatch(/IF v_over AND v_tb\.mode = 'enforce' AND \(NOT p_essential OR v_tb\.block_essential\) THEN/);
    expect(admit).toMatch(/'tenant_budget'::text/);
    expect(admit).toMatch(/IF v_count >= v_budget\.monthly_call_cap THEN\s+v_reason := 'monthly_cap';/);
    expect(admit).toMatch(/ELSIF NOT p_essential AND v_count >= v_budget\.monthly_call_cap - v_budget\.reserve_for_essential THEN/);
  });

  it("queues each alert once per dealership, provider, month, kind and threshold", () => {
    expect(sql).toMatch(/CONSTRAINT provider_budget_alerts_once UNIQUE \(tenant_id, provider, month, kind, threshold\)/);
    expect(sql.match(/ON CONFLICT ON CONSTRAINT provider_budget_alerts_once DO NOTHING/g)?.length).toBe(2);
  });

  it("follows the canonical policy shape and writes only through audited admin functions", () => {
    const policies = sql.match(/CREATE POLICY[\s\S]*?;/g) || [];
    expect(policies.length).toBe(4);
    for (const p of policies) {
      expect(p).toMatch(/TO authenticated/);
      expect(p).toMatch(/\(SELECT auth\.uid\(\)\)/);
      expect(p).toMatch(/FOR SELECT/);
    }
    for (const fn of ["platform_set_tenant_budget", "platform_delete_tenant_budget", "platform_set_unit_price", "platform_set_alert_settings"]) {
      const body = sql.slice(sql.indexOf(`FUNCTION public.${fn}(`));
      expect(body.slice(0, body.indexOf("END $$"))).toMatch(/platform_require_admin\(\)[\s\S]*INSERT INTO public\.audit_log/);
    }
  });

  it("defines the delivery schedule without starting it", () => {
    expect(sql).toMatch(/FUNCTION public\.schedule_provider_budget_alerts/);
    expect(sql.replace(/CREATE OR REPLACE FUNCTION public\.schedule_provider_budget_alerts[\s\S]*?END \$\$;/, "")).not.toMatch(/cron\.schedule\(/);
  });
});
