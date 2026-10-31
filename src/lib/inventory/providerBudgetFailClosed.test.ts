import { describe, it, expect, vi } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { admitProviderCall } from "../../../supabase/functions/_shared/providerBudget";
import { decideLaneAdmission, laneOf, parseAdmitRow } from "../../../supabase/functions/_shared/providerBudgetPolicy";

const URL_WITH_KEY = "https://api.marketcheck.com/v2/search/car/active?api_key=SECRET-KEY-123&vin=1HGCM82633A004352";
const rpcAnswer = (answer: { data?: unknown; error?: unknown } | Error) => {
  const rpc = vi.fn(async (fn: string) => {
    if (fn === "provider_reserve") return { data: { reserved: true, request_id: "r1" }, error: null };
    if (fn !== "provider_call_admit") return { data: null, error: null };
    if (answer instanceof Error) throw answer;
    return { data: answer.data ?? null, error: answer.error ?? null };
  });
  return { rpc };
};

describe("the provider gate fails closed", () => {
  it("no gate at all: refused, nothing asked", async () => {
    const r = await admitProviderCall(null, { url: URL_WITH_KEY, caller: "t" });
    expect(r).toMatchObject({ admitted: false, reason: "gate_unavailable" });
  });

  it("a database error, a thrown client or an unreadable answer: refused", async () => {
    for (const a of [{ error: { message: "connection refused" } }, new Error("socket hang up"), { data: null }, { data: [{ admitted: "yes" }] }, { data: [{ admitted: true, reason: "???" }] }]) {
      const r = await admitProviderCall(rpcAnswer(a), { url: URL_WITH_KEY, caller: "t" });
      expect(r.admitted).toBe(false);
      expect(r.reason).toBe("gate_unavailable");
    }
  });

  it("the inventory feed is refused too when the gate cannot answer", async () => {
    const r = await admitProviderCall(rpcAnswer({ error: { message: "timeout" } }), { url: URL_WITH_KEY, caller: "marketcheck-sync", essential: true });
    expect(r.admitted).toBe(false);
  });

  it("an 'ungated' admission (no budget for the provider) is refused and its reservation closed as refused", async () => {
    const admin = rpcAnswer({ data: [{ admitted: true, event_id: 41, reason: "ungated" }] });
    const r = await admitProviderCall(admin, { url: "https://api.firecrawl.dev/v2/scrape", caller: "crawl", provider: "firecrawl", product: "scrape" });
    expect(r).toMatchObject({ admitted: false, reason: "unconfigured", eventId: 41 });
    expect(admin.rpc).toHaveBeenCalledWith("provider_call_record", expect.objectContaining({ p_event_id: 41, p_outcome: "budget_denied" }));
  });

  it("a clear admission is admitted", async () => {
    const r = await admitProviderCall(rpcAnswer({ data: [{ admitted: true, event_id: 7, month_calls: 3, monthly_call_cap: 10, reason: "admitted" }] }), { url: URL_WITH_KEY, caller: "t" });
    expect(r).toMatchObject({ admitted: true, eventId: 7, reason: "admitted" });
  });

  it("never sends the URL or its API key to the database or the log", async () => {
    const admin = rpcAnswer({ data: [{ admitted: false, event_id: 8, reason: "lane_cap" }] });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await admitProviderCall(admin, { url: URL_WITH_KEY, caller: "t", tenantId: "t1", vin: "1HGCM82633A004352" });
    expect(JSON.stringify(admin.rpc.mock.calls)).not.toMatch(/SECRET-KEY-123|api_key|https?:/);
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/SECRET-KEY-123|api_key/);
    warn.mockRestore();
  });

  it("reads every lane refusal reason", () => {
    for (const reason of ["unconfigured", "disabled", "lane_cap", "lane_usd_cap", "unpriced", "tenant_budget", "monthly_cap"]) {
      expect(parseAdmitRow({ admitted: false, event_id: 1, reason })?.reason).toBe(reason);
    }
  });
});

describe("lane decisions", () => {
  const on = { enabled: true, monthlyCallCap: 10, monthlyUsdCap: null };
  it("missing or disabled lanes refuse", () => {
    expect(decideLaneAdmission(null, { calls: 0, usd: 0 }, null)).toEqual({ admitted: false, reason: "unconfigured" });
    expect(decideLaneAdmission({ ...on, enabled: false }, { calls: 0, usd: 0 }, null)).toEqual({ admitted: false, reason: "disabled" });
  });
  it("an exhausted lane refuses; under the cap admits", () => {
    expect(decideLaneAdmission(on, { calls: 9, usd: 0 }, null).admitted).toBe(true);
    expect(decideLaneAdmission(on, { calls: 10, usd: 0 }, null)).toEqual({ admitted: false, reason: "lane_cap" });
  });
  it("a dollar limit refuses a call it cannot price, and one that would go over", () => {
    const usd = { enabled: true, monthlyCallCap: null, monthlyUsdCap: 1 };
    expect(decideLaneAdmission(usd, { calls: 0, usd: 0 }, null)).toEqual({ admitted: false, reason: "unpriced" });
    expect(decideLaneAdmission(usd, { calls: 0, usd: 0.5 }, 0.5).admitted).toBe(true);
    expect(decideLaneAdmission(usd, { calls: 0, usd: 0.6 }, 0.5)).toEqual({ admitted: false, reason: "lane_usd_cap" });
  });
  it("the feed and enrichment are different lanes", () => {
    expect([laneOf(true), laneOf(false)]).toEqual(["essential_sync", "enrichment"]);
  });
});

describe("callers have no fail-open path", () => {
  it("no caller skips the gate when its budget context is missing", () => {
    for (const f of ["vehicle-enrich", "marketcheck-sync", "marketcheck-comps", "marketcheck-specs"]) {
      const src = readFileSync(`supabase/functions/${f}/index.ts`, "utf8");
      expect(src, f).not.toMatch(/budgetCtx\s*\?\s*await admitProviderCall/);
      expect(src, f).not.toMatch(/if \(gate && !gate\.admitted\)/);
    }
    const crawl = readFileSync("supabase/functions/crawl-advertised-prices/index.ts", "utf8");
    expect(crawl).toMatch(/if \(!budget\) return \{ render: null, formats, pacedWaitMs, rateLimitRetries, gaveUp: "budget_refused" \};/);
  });

  it("every function that calls a paid provider goes through the gate", () => {
    const PAID = /api\.marketcheck\.com|mc-api\.marketcheck\.com|api\.firecrawl\.dev|places\.googleapis\.com|blackbookcloud\.com|vinaudit\.com|monroneylabels\.com/;
    const GATED = /admitProviderCall|gatedSearchFetch/;
    const SEPARATELY_GUARDED = new Set<string>();
    const ungated = readdirSync("supabase/functions", { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith("_") && existsSync(`supabase/functions/${d.name}/index.ts`))
      .map((d) => d.name)
      .filter((f) => PAID.test(readFileSync(`supabase/functions/${f}/index.ts`, "utf8")))
      .filter((f) => !GATED.test(readFileSync(`supabase/functions/${f}/index.ts`, "utf8")) && !SEPARATELY_GUARDED.has(f));
    expect(ungated).toEqual([]);
  });

  it("the newly gated callers ask before they send", () => {
    const order = (f: string, gate: string, send: string) => {
      const src = readFileSync(`supabase/functions/${f}/index.ts`, "utf8");
      expect(src.indexOf(gate), `${f}: gate`).toBeGreaterThan(-1);
      expect(src.indexOf(gate), f).toBeLessThan(src.indexOf(send, src.indexOf(gate)));
    };
    order("firecrawl-scrape", "admitProviderCall(admin", 'fetch("https://api.firecrawl.dev/v1/scrape"');
    order("google-reviews", "admitProviderCall(admin", "fetch(url, init)");
    order("marketcheck-recalls", "admitProviderCall(budgetCtx?.admin", "httpGet(url)");
    order("marketcheck-incentives", "admitProviderCall(budgetCtx?.admin", "fetch(url)");
    order("marketcheck-title-report", "admitProviderCall(admin", "fetch(endpoint(kind, vin)");
    order("market-valuation-write", "admitProviderCall(admin", "await callProvider(url)");
    const reviews = readFileSync("supabase/functions/google-reviews/index.ts", "utf8");
    expect(reviews.match(/\bfetch\(/g)).toHaveLength(1);
  });
});

describe("the proposed SQL states the same policy", () => {
  const sql = readFileSync("supabase/proposed/20261106000000_provider_budget_fail_closed.sql", "utf8");
  const admit = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION public.provider_call_admit("), sql.indexOf("CREATE OR REPLACE FUNCTION public.provider_call_record("));

  it("locks the lane before counting, and refuses a missing or disabled lane", () => {
    expect(admit.indexOf("FOR UPDATE")).toBeLessThan(admit.indexOf("FROM public.provider_call_events e"));
    expect(admit).toMatch(/IF NOT FOUND THEN\s+v_reason := 'unconfigured';\s+ELSIF NOT v_lb\.enabled THEN\s+v_reason := 'disabled';/);
  });

  it("counts each lane on its own and has no essential bypass", () => {
    expect(admit).toMatch(/e\.essential = p_essential/);
    expect(admit).not.toMatch(/block_essential|NOT p_essential/);
  });

  it("seeds every lane disabled with no limit", () => {
    const seed = sql.slice(sql.indexOf("INSERT INTO public.provider_lane_budgets"), sql.indexOf("ON CONFLICT (provider, lane) DO NOTHING"));
    expect(seed).not.toMatch(/true|\d{2,}/);
    expect(sql).toMatch(/enabled\s+boolean NOT NULL DEFAULT false/);
  });

  it("stores no URL or key (code, not comments)", () => {
    const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(code).not.toMatch(/api_key|\burl\b|token/i);
  });
});

describe("a public Passport load never buys comparables", () => {
  const src = readFileSync("supabase/functions/marketcheck-comps/index.ts", "utf8");
  it("an anonymous caller is served the cache or the pending state before any paid call", () => {
    const refuse = src.indexOf("if (!(await callerMayRefresh(");
    expect(refuse).toBeGreaterThan(-1);
    expect(refuse).toBeLessThan(src.indexOf("admitProviderCall(admin"));
    expect(src).toMatch(/reason: "not_cached"/);
  });
  it("only a tenant member, a platform admin or the service role may refresh", () => {
    const fn = src.slice(src.indexOf("async function callerMayRefresh"), src.indexOf("Deno.serve"));
    expect(fn).toMatch(/if \(!auth\) return false;/);
    expect(fn).toMatch(/tenant_members/);
    expect(fn).toMatch(/user_roles/);
    expect(fn).toMatch(/SERVICE_KEY/);
  });
});
