import { describe, it, expect } from "vitest";
import {
  CREDIT_USAGE_ENDPOINT,
  fetchCreditUsage,
  pickRenderKey,
  selectRenderKey,
} from "../../../supabase/functions/_shared/renderKey";

// Two keys were configured; the preferred one belonged to a team at -11
// credits while the other held 1,316. Every render since 2026-09-06 was
// refused at 402 and the owner's dashboard, showing the second team, said the
// account was healthy. The choice is now made from the provider's own answer.

const usage = (remaining: number | null, status = 200) =>
  async () => ({ status, text: async () => JSON.stringify({ success: true, data: { remainingCredits: remaining, planCredits: 1000, billingPeriodEnd: "2026-10-04T12:33:21.031Z" } }) });

describe("pickRenderKey", () => {
  it("prefers the key with the most credits, whatever its configured order", () => {
    expect(pickRenderKey([{ env: "A", remaining: -11 }, { env: "B", remaining: 1316 }])).toEqual({ index: 1, reason: "most_credits" });
    expect(pickRenderKey([{ env: "A", remaining: 900 }, { env: "B", remaining: 1316 }])).toEqual({ index: 1, reason: "most_credits" });
    expect(pickRenderKey([{ env: "A", remaining: 1316 }, { env: "B", remaining: 900 }])).toEqual({ index: 0, reason: "most_credits" });
  });

  it("keeps configuration order on a tie", () => {
    expect(pickRenderKey([{ env: "A", remaining: 5 }, { env: "B", remaining: 5 }]).index).toBe(0);
  });

  it("treats zero and negative balances as unable to pay", () => {
    expect(pickRenderKey([{ env: "A", remaining: 0 }, { env: "B", remaining: 1 }]).index).toBe(1);
    expect(pickRenderKey([{ env: "A", remaining: -11 }, { env: "B", remaining: 0 }])).toEqual({ index: 0, reason: "all_exhausted_kept_first" });
  });

  it("keeps the first key when nothing could be read, so the refusal is still recorded", () => {
    expect(pickRenderKey([{ env: "A", remaining: null }, { env: "B", remaining: null }])).toEqual({ index: 0, reason: "unknown_kept_first" });
    // One unreadable, one exhausted: still no positive balance anywhere.
    expect(pickRenderKey([{ env: "A", remaining: null }, { env: "B", remaining: -3 }])).toEqual({ index: 0, reason: "all_exhausted_kept_first" });
  });

  it("does not ask the provider when there is only one key", () => {
    expect(pickRenderKey([{ env: "A", remaining: null }])).toEqual({ index: 0, reason: "only_key" });
    expect(pickRenderKey([])).toEqual({ index: -1, reason: "none_configured" });
  });
});

describe("fetchCreditUsage", () => {
  it("reads the provider's balance fields and nothing else", async () => {
    let calledWith: { url: string; auth: string | undefined } | null = null;
    const u = await fetchCreditUsage("fc-secret", async (url, init) => {
      calledWith = { url, auth: init?.headers?.Authorization };
      return usage(1316)();
    });
    expect(calledWith).toEqual({ url: CREDIT_USAGE_ENDPOINT, auth: "Bearer fc-secret" });
    expect(u).toEqual({ status: 200, remaining: 1316, plan: 1000, periodEnd: "2026-10-04T12:33:21.031Z", error: null });
  });

  it("reports a non-200 or malformed answer as unreadable, never as a balance", async () => {
    const bad = await fetchCreditUsage("k", async () => ({ status: 401, text: async () => '{"success":false,"error":"Unauthorized"}' }));
    expect(bad.remaining).toBeNull();
    expect(bad.status).toBe(401);
    expect(bad.error).toContain("Unauthorized");
    const html = await fetchCreditUsage("k", async () => ({ status: 200, text: async () => "<html>gateway</html>" }));
    expect(html.remaining).toBeNull();
    expect(html.error).toContain("gateway");
  });

  it("never throws on a network failure", async () => {
    const u = await fetchCreditUsage("k", async () => { throw new Error("ECONNRESET"); });
    expect(u).toEqual({ status: null, remaining: null, plan: null, periodEnd: null, error: "Error: ECONNRESET" });
  });
});

describe("selectRenderKey", () => {
  it("returns the paying key and names it by env, never by value", async () => {
    const calls: string[] = [];
    const choice = await selectRenderKey(
      [{ env: "FIRECRAWL_API_KEY_1", key: "fc-one" }, { env: "FIRECRAWL_API_KEY", key: "fc-two" }],
      async (_url, init) => {
        calls.push(init?.headers?.Authorization ?? "");
        return (init?.headers?.Authorization === "Bearer fc-one" ? usage(-11) : usage(1316))();
      },
    );
    expect(choice.key).toBe("fc-two");
    expect(choice.env).toBe("FIRECRAWL_API_KEY");
    expect(choice.reason).toBe("most_credits");
    expect(choice.remaining).toBe(1316);
    expect(calls.sort()).toEqual(["Bearer fc-one", "Bearer fc-two"]);
    expect(JSON.stringify(choice.checked)).not.toContain("fc-");
    expect(choice.checked.map((c) => [c.env, c.remaining])).toEqual([["FIRECRAWL_API_KEY_1", -11], ["FIRECRAWL_API_KEY", 1316]]);
  });

  it("skips the provider call entirely for a single key", async () => {
    let called = false;
    const choice = await selectRenderKey([{ env: "FIRECRAWL_API_KEY", key: "fc-only" }], async () => { called = true; return usage(0)(); });
    expect(called).toBe(false);
    expect(choice).toMatchObject({ key: "fc-only", env: "FIRECRAWL_API_KEY", reason: "only_key" });
  });

  it("keeps the first key, and says why, when every team is exhausted", async () => {
    const choice = await selectRenderKey(
      [{ env: "FIRECRAWL_API_KEY_1", key: "fc-one" }, { env: "FIRECRAWL_API_KEY", key: "fc-two" }],
      usage(0),
    );
    expect(choice.key).toBe("fc-one");
    expect(choice.reason).toBe("all_exhausted_kept_first");
  });
});
