import { describe, it, expect, vi } from "vitest";
import {
  MarketcheckClient, MC_HOSTS, McConfigError, McValidationError, classifyMarketcheckError,
  isMatchValidationError, redactKey, resolveMarketcheckConfig, validateMatchParam,
} from "./marketcheckClient";
import { parsePredictionResponse } from "./factorySticker/lib/market/providerAdapter";

const env = (m: Record<string, string>) => (k: string) => m[k];
const SANDBOX = { environment: "sandbox" as const, baseUrl: MC_HOSTS.sandbox, apiKey: "sbx-key-123" };

const res = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });

const client = (fetchImpl: typeof fetch, extra: Partial<ConstructorParameters<typeof MarketcheckClient>[0]> = {}) =>
  new MarketcheckClient({ config: SANDBOX, fetchImpl, sleep: async () => {}, ...extra });

describe("environment isolation", () => {
  it("resolves the sandbox host with the sandbox key only", () => {
    const cfg = resolveMarketcheckConfig("sandbox", env({ MARKETCHECK_SANDBOX_API_KEY: "s", MARKETCHECK_API_KEY: "p" }));
    expect(cfg).toEqual({ environment: "sandbox", baseUrl: "https://api.sandbox.marketcheck.com/v2", apiKey: "s" });
  });

  it("refuses a production host configured for the sandbox", () => {
    expect(() => resolveMarketcheckConfig("sandbox", env({
      MARKETCHECK_SANDBOX_API_KEY: "s", MARKETCHECK_SANDBOX_BASE_URL: "https://api.marketcheck.com/v2",
    }))).toThrow(McConfigError);
  });

  it("refuses a sandbox key identical to the production key", () => {
    expect(() => resolveMarketcheckConfig("sandbox", env({ MARKETCHECK_SANDBOX_API_KEY: "same", MARKETCHECK_API_KEY: "same" }))).toThrow(/cross-environment/);
  });

  it("refuses to run without a key", () => {
    expect(() => resolveMarketcheckConfig("sandbox", env({}))).toThrow(/MARKETCHECK_SANDBOX_API_KEY/);
  });

  it("will not build a client whose host does not match its environment", () => {
    expect(() => new MarketcheckClient({ config: { ...SANDBOX, baseUrl: MC_HOSTS.production } })).toThrow(McConfigError);
  });

  it("production needs the launch-control admit hook", () => {
    expect(() => new MarketcheckClient({ config: { environment: "production", baseUrl: MC_HOSTS.production, apiKey: "p" } })).toThrow(/admit/);
  });

  it("sends only to the sandbox host and never leaks the key in results", async () => {
    const seen: string[] = [];
    const c = client(async (u) => { seen.push(String(u)); return res(200, { num_found: 0, listings: [] }); });
    const out = await c.searchActive({ rows: 1 });
    expect(seen[0].startsWith("https://api.sandbox.marketcheck.com/v2/search/car/active?")).toBe(true);
    expect(seen[0]).toContain("api_key=sbx-key-123");
    expect(out.url).not.toContain("sbx-key-123");
    expect(JSON.stringify(out)).not.toContain("sbx-key-123");
  });

  it("refuses a caller-supplied api_key", async () => {
    await expect(client(async () => res(200, {})).get("/search/car/active", { api_key: "x" })).rejects.toThrow(McConfigError);
  });
});

describe("match parameter (v4.9.0)", () => {
  it("accepts the documented attributes and normalizes them", () => {
    expect(validateMatchParam("year, MAKE,model,trim,version,build_code,options_packages,year"))
      .toBe("year,make,model,trim,version,build_code,options_packages");
  });

  it("rejects empty, unknown and blank entries before any request", async () => {
    for (const bad of ["", "  ", "year,,make", "year,color", "vin"]) expect(() => validateMatchParam(bad)).toThrow(McValidationError);
    const f = vi.fn(async () => res(200, {}));
    await expect(client(f).searchActive({ match: "year,color" })).rejects.toThrow(McValidationError);
    expect(f).not.toHaveBeenCalled();
  });

  it("recognizes the provider's own 400 for match and never retries it", async () => {
    const f = vi.fn(async () => res(400, { code: 400, message: "Request validation failed: Parameter (match) is not an allowable value" }));
    const out = await client(f).searchActive({ match: "year" });
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error.kind).toBe("validation");
      expect(isMatchValidationError(out.error)).toBe(true);
    }
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe("errors, retries and limits", () => {
  it("retries 429 honoring Retry-After, then succeeds", async () => {
    const sleeps: number[] = [];
    const f = vi.fn()
      .mockResolvedValueOnce(res(429, { message: "Too Many Requests" }, { "retry-after": "2" }))
      .mockResolvedValueOnce(res(200, { ok: 1 }));
    const out = await client(f as unknown as typeof fetch, { sleep: async (ms) => { sleeps.push(ms); } }).decodeNeovin("1HGCM82633A004352");
    expect(out.ok).toBe(true);
    expect(out.attempts).toBe(2);
    expect(sleeps).toContain(2000);
  });

  it("gives up on persistent 5xx after bounded retries", async () => {
    const f = vi.fn(async () => res(503, { message: "unavailable" }));
    const out = await client(f, { maxRetries: 2 }).history("1HGCM82633A004352");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error.kind).toBe("provider");
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("does not retry auth failures (wrong key for the host)", async () => {
    const f = vi.fn(async () => res(401, { message: "Invalid authentication credentials" }));
    const out = await client(f).decodeBasic("1HGCM82633A004352");
    expect(!out.ok && out.error.kind).toBe("auth");
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("classifies a network failure and redacts the key from its message", async () => {
    const f = vi.fn(async () => { throw new Error("connect ECONNRESET https://x/?api_key=sbx-key-123"); });
    const out = await client(f as unknown as typeof fetch, { maxRetries: 0 }).searchActive({});
    expect(!out.ok && out.error.kind).toBe("network");
    expect(JSON.stringify(out)).not.toContain("sbx-key-123");
  });

  it("stops at the client request cap without sending", async () => {
    const f = vi.fn(async () => res(200, {}));
    const c = client(f, { maxRequests: 2 });
    await c.searchActive({});
    await c.searchActive({});
    const third = await c.searchActive({});
    expect(!third.ok && third.error.kind).toBe("budget");
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("paces requests to at most 5 per second", async () => {
    let t = 0;
    const waits: number[] = [];
    const c = client(async () => res(200, {}), { now: () => t, sleep: async (ms) => { waits.push(ms); t += ms; } });
    for (let i = 0; i < 6; i++) await c.searchActive({});
    expect(t).toBeGreaterThanOrEqual(1000);
    expect(waits.every((w) => w <= 200)).toBe(true);
  });

  it("classifies the documented statuses", () => {
    expect(classifyMarketcheckError(404, { message: "Endpoint not available in sandbox" }).kind).toBe("not_supported");
    expect(classifyMarketcheckError(404, { message: "VIN not found" }).kind).toBe("not_found");
    expect(classifyMarketcheckError(403, {}).kind).toBe("auth");
    expect(redactKey("https://h/v2/x?api_key=abc&rows=1")).toBe("https://h/v2/x?api_key=***&rows=1");
  });
});

describe("MarketCheck Price generic fallback (v4.8.0)", () => {
  it("never treats generic_prices as a VIN-level valuation", () => {
    const parsed = parsePredictionResponse({
      body: { marketcheck_price: null, msrp: null, generic_prices: [{ year: 2024, make: "Toyota", model: "Camry", marketcheck_price: 25000, msrp: 28000 }] },
      requestFingerprint: "f", requestedAt: "2026-11-06T00:00:00Z", receivedAt: "2026-11-06T00:00:01Z",
    });
    expect(parsed.valuation).toBeNull();
    expect(parsed.parseErrors).toContain("generic_fallback");
  });
});
