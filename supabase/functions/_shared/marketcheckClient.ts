// ──────────────────────────────────────────────────────────────────────
// MarketCheck client with an explicit environment.
//
// The sandbox (api.sandbox.marketcheck.com, MarketCheck API v4.9.0, Nov 4 2026)
// is free and accepts only sandbox keys; production is billed. This client
// makes the pairing impossible to get wrong:
//
//   * the environment is chosen by the caller, never inferred from a key;
//   * each environment has exactly one host and one key variable, and a
//     host/key from the other environment is refused before any request;
//   * production additionally requires an `admit` hook, so nothing built on
//     this client can bypass the launch-control gate (provider_call_admit_v2);
//   * the key is sent as the documented api_key query parameter and is
//     redacted from every error, log line and result this client returns.
//
// Also enforced client-side: the v4.9.0 `match` parameter contract (HTTP 400
// for anything else), the 5 requests/second limit, bounded retries on 429/5xx
// with Retry-After, and a per-client request cap.
// ──────────────────────────────────────────────────────────────────────

export type McEnvironment = "sandbox" | "production";

export const MC_HOSTS: Record<McEnvironment, string> = {
  sandbox: "https://api.sandbox.marketcheck.com/v2",
  production: "https://api.marketcheck.com/v2",
};

export const MC_KEY_VARS: Record<McEnvironment, string> = {
  sandbox: "MARKETCHECK_SANDBOX_API_KEY",
  production: "MARKETCHECK_API_KEY",
};

export const MC_BASE_URL_VARS: Record<McEnvironment, string> = {
  sandbox: "MARKETCHECK_SANDBOX_BASE_URL",
  production: "MARKETCHECK_BASE_URL",
};

/** Attributes the v4.9.0 `match` parameter accepts (anything else is HTTP 400). */
export const MATCH_ATTRIBUTES = ["year", "make", "model", "trim", "version", "build_code", "options_packages"] as const;
export type MatchAttribute = (typeof MATCH_ATTRIBUTES)[number];

export class McConfigError extends Error {
  constructor(message: string) { super(message); this.name = "McConfigError"; }
}

export class McValidationError extends Error {
  constructor(message: string) { super(message); this.name = "McValidationError"; }
}

export interface McConfig { environment: McEnvironment; baseUrl: string; apiKey: string }

const trimSlash = (s: string) => s.replace(/\/+$/, "");

/**
 * Resolve host + key for ONE environment from an env getter. Throws on a
 * missing key, a base URL that is not that environment's host, or a sandbox
 * key that is identical to the production key.
 */
export function resolveMarketcheckConfig(environment: McEnvironment, getEnv: (k: string) => string | undefined): McConfig {
  const apiKey = (getEnv(MC_KEY_VARS[environment]) ?? "").trim();
  if (!apiKey) throw new McConfigError(`${MC_KEY_VARS[environment]} is not set`);
  const configured = (getEnv(MC_BASE_URL_VARS[environment]) ?? "").trim();
  const baseUrl = trimSlash(configured || MC_HOSTS[environment]);
  if (baseUrl !== MC_HOSTS[environment]) {
    throw new McConfigError(`${MC_BASE_URL_VARS[environment]} must be ${MC_HOSTS[environment]} for the ${environment} environment`);
  }
  const other: McEnvironment = environment === "sandbox" ? "production" : "sandbox";
  const otherKey = (getEnv(MC_KEY_VARS[other]) ?? "").trim();
  if (otherKey && otherKey === apiKey) {
    throw new McConfigError(`${MC_KEY_VARS[environment]} equals ${MC_KEY_VARS[other]}: refusing a cross-environment key`);
  }
  return { environment, baseUrl, apiKey };
}

/** Validate a `match` value before it is sent. Returns the normalized value. */
export function validateMatchParam(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new McValidationError("match must be a non-empty comma-separated list");
  }
  const parts = value.split(",").map((s) => s.trim().toLowerCase());
  const bad = parts.filter((p) => !p || !(MATCH_ATTRIBUTES as readonly string[]).includes(p));
  if (bad.length) {
    throw new McValidationError(`match has unsupported attribute(s): ${bad.map((b) => b || "(empty)").join(", ")}; allowed: ${MATCH_ATTRIBUTES.join(", ")}`);
  }
  return Array.from(new Set(parts)).join(",");
}

export type McErrorKind =
  | "validation"     // 400 — our request was wrong; never retried
  | "auth"           // 401/403 — wrong key for the host, or not entitled
  | "not_found"      // 404
  | "not_supported"  // endpoint not offered in this environment (sandbox coverage)
  | "rate_limited"   // 429 after retries
  | "provider"       // 5xx after retries
  | "network"        // fetch threw / timeout
  | "budget";        // client-side request cap reached; no request sent

export interface McError { kind: McErrorKind; status: number | null; code: string | null; message: string }

export type McResult<T = unknown> =
  | { ok: true; status: number; data: T; url: string; attempts: number; environment: McEnvironment }
  | { ok: false; error: McError; url: string; attempts: number; environment: McEnvironment };

export const redactKey = (s: string): string => s.replace(/(api_key=)[^&\s"']+/gi, "$1***");

/** Classify a non-2xx response. Exported for tests and for existing callers. */
export function classifyMarketcheckError(status: number, body: unknown): McError {
  const b = (body && typeof body === "object" ? body : {}) as { code?: unknown; message?: unknown };
  const code = b.code != null ? String(b.code) : null;
  const message = redactKey(typeof b.message === "string" ? b.message : typeof body === "string" ? body.slice(0, 300) : `HTTP ${status}`);
  if (status === 400) return { kind: "validation", status, code, message };
  if (status === 401 || status === 403) return { kind: "auth", status, code, message };
  if (status === 404) {
    return { kind: /not (available|supported)|unknown (path|endpoint)|no route/i.test(message) ? "not_supported" : "not_found", status, code, message };
  }
  if (status === 429) return { kind: "rate_limited", status, code, message };
  return { kind: status >= 500 ? "provider" : "validation", status, code, message };
}

/** True for a v4.9.0 match-validation 400 ("Parameter (match) is not an allowable value"). */
export const isMatchValidationError = (e: McError): boolean =>
  e.kind === "validation" && /parameter \(match\)/i.test(e.message);

export interface McClientOptions {
  config: McConfig;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** Requests per second. The sandbox allows 5. */
  ratePerSecond?: number;
  /** Hard cap on requests this client instance will send. */
  maxRequests?: number;
  maxRetries?: number;
  timeoutMs?: number;
  /**
   * Required for production: the launch-control admission check. Returning
   * false refuses the call before anything is sent.
   */
  admit?: (path: string) => Promise<boolean>;
  onRequest?: (info: { url: string; status: number | null; attempt: number; environment: McEnvironment }) => void;
}

export class MarketcheckClient {
  readonly environment: McEnvironment;
  private readonly cfg: McConfig;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly minGapMs: number;
  private readonly maxRequests: number;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;
  private readonly admit?: (path: string) => Promise<boolean>;
  private readonly onRequest?: McClientOptions["onRequest"];
  private sent = 0;
  private nextSlot = 0;

  constructor(opts: McClientOptions) {
    const { config } = opts;
    if (config.baseUrl !== MC_HOSTS[config.environment]) {
      throw new McConfigError(`base URL ${config.baseUrl} is not the ${config.environment} host`);
    }
    if (config.environment === "production" && !opts.admit) {
      throw new McConfigError("production requires an admit hook (launch-control gate)");
    }
    this.environment = config.environment;
    this.cfg = config;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = opts.now ?? (() => Date.now());
    this.minGapMs = Math.ceil(1000 / Math.max(1, Math.min(opts.ratePerSecond ?? 5, 5)));
    this.maxRequests = opts.maxRequests ?? 100;
    this.maxRetries = opts.maxRetries ?? 3;
    this.timeoutMs = opts.timeoutMs ?? 20000;
    this.admit = opts.admit;
    this.onRequest = opts.onRequest;
  }

  get requestsSent(): number { return this.sent; }

  private async pace(): Promise<void> {
    const t = this.now();
    const wait = Math.max(0, this.nextSlot - t);
    this.nextSlot = Math.max(t, this.nextSlot) + this.minGapMs;
    if (wait > 0) await this.sleep(wait);
  }

  /** GET `path` (relative to /v2) with query params. Never throws for HTTP errors. */
  async get<T = unknown>(path: string, params: Record<string, string | number | boolean | undefined | null> = {}): Promise<McResult<T>> {
    const qp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v == null || v === "") continue;
      if (k === "api_key") throw new McConfigError("api_key is set by the client");
      qp.set(k, k === "match" ? validateMatchParam(String(v)) : String(v));
    }
    const cleanPath = path.startsWith("/") ? path : `/${path}`;
    const publicUrl = `${this.cfg.baseUrl}${cleanPath}${qp.toString() ? `?${qp}` : ""}`;
    qp.set("api_key", this.cfg.apiKey);
    const url = `${this.cfg.baseUrl}${cleanPath}?${qp}`;
    const env = this.environment;

    if (this.admit && !(await this.admit(cleanPath))) {
      return { ok: false, error: { kind: "budget", status: null, code: "not_admitted", message: "Refused by the admission gate" }, url: publicUrl, attempts: 0, environment: env };
    }

    let attempt = 0;
    let last: McError | null = null;
    while (attempt <= this.maxRetries) {
      if (this.sent >= this.maxRequests) {
        return { ok: false, error: { kind: "budget", status: null, code: "client_cap", message: `Request cap of ${this.maxRequests} reached` }, url: publicUrl, attempts: attempt, environment: env };
      }
      await this.pace();
      attempt += 1;
      this.sent += 1;
      let res: Response;
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
        try {
          res = await this.fetchImpl(url, { headers: { accept: "application/json" }, signal: ctrl.signal });
        } finally {
          clearTimeout(timer);
        }
      } catch (e) {
        this.onRequest?.({ url: publicUrl, status: null, attempt, environment: env });
        last = { kind: "network", status: null, code: null, message: redactKey(e instanceof Error ? e.message : String(e)) };
        if (attempt > this.maxRetries) break;
        await this.sleep(this.backoff(attempt, null));
        continue;
      }
      this.onRequest?.({ url: publicUrl, status: res.status, attempt, environment: env });
      const text = await res.text();
      let body: unknown = text;
      try { body = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
      if (res.ok) return { ok: true, status: res.status, data: body as T, url: publicUrl, attempts: attempt, environment: env };
      last = classifyMarketcheckError(res.status, body);
      if (last.kind !== "rate_limited" && last.kind !== "provider") break;
      if (attempt > this.maxRetries) break;
      await this.sleep(this.backoff(attempt, res.headers.get("retry-after")));
    }
    return { ok: false, error: last!, url: publicUrl, attempts: attempt, environment: env };
  }

  private backoff(attempt: number, retryAfter: string | null): number {
    const ra = retryAfter != null ? Number(retryAfter) : NaN;
    if (Number.isFinite(ra) && ra >= 0) return Math.min(ra * 1000, 30000);
    return Math.min(500 * 2 ** (attempt - 1), 8000);
  }

  searchActive(params: Record<string, string | number | boolean | undefined | null>) {
    return this.get("/search/car/active", params);
  }
  decodeBasic(vin: string) {
    return this.get(`/decode/car/${encodeURIComponent(vin)}/specs`);
  }
  decodeNeovin(vin: string) {
    return this.get(`/decode/car/neovin/${encodeURIComponent(vin)}/specs`);
  }
  history(vin: string) {
    return this.get(`/history/car/${encodeURIComponent(vin)}`);
  }
}
