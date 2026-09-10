// ── Edge function caller authentication: the parts that are pure ───────────
//
// The defect this replaces: `market-valuation-write` decided a caller was
// trusted with
//
//     if (!SERVICE_KEY || auth !== SERVICE_KEY) { ...fall back to getUser... }
//
// One literal `!==` against one environment variable. Three things are wrong
// with that and each of them is a production outage waiting for a Tuesday:
//
//   1. It admits exactly one credential. Rotating the project's key, or
//      issuing a second one, 401s every trusted caller until the env var is
//      edited — and the failure looks like a broken function, not a key
//      change.
//   2. It is a variable-time comparison on a secret.
//   3. It only ever reads `Authorization`. A caller presenting a modern
//      `sb_secret_*` key in the `apikey` header — where Supabase's own SDK
//      puts it — is not recognised at all, falls through to `getUser()`,
//      which cannot resolve an API key to a user, and gets a 401 that says
//      "authentication required" while the credential was perfectly valid.
//
// Verification itself now belongs to `@supabase/server`. This module holds
// only the pieces that must be decided before or after that call, so they can
// be unit-tested without a Deno runtime and without a network:
//
//   * which keys count as trusted secrets (a rotatable SET, never one value),
//   * where the JWKS comes from,
//   * how a request whose credential rides only `Authorization` is normalised,
//   * what a verified identity is then allowed to do.
//
// A word on what "not exact equality" can and cannot mean. A modern Supabase
// secret key is an OPAQUE string, not a signed token: there is no signature to
// check and no issuer to ask, so the only possible test is membership in the
// set of keys this deployment was configured to trust. What changes here is
// that it is a set rather than a single variable, compared in constant time by
// the library, and drawn from a namespace that publishable keys can never
// enter. User JWTs are different and are genuinely verified — signature, and a
// `sub` claim — which is why an anon token cannot masquerade as a service
// caller no matter which header it arrives in.

/** A credential presented by a caller. Never logged, never serialised. */
export interface PresentedCredentials {
  token: string | null;
  apikey: string | null;
}

export const readCredentials = (req: Request): PresentedCredentials => {
  const header = req.headers.get("authorization");
  const token = header?.toLowerCase().startsWith("bearer ") ? header.slice(7) || null : null;
  return { token, apikey: req.headers.get("apikey") };
};

/**
 * Environment names that may carry a TRUSTED SERVER credential.
 *
 * `SUPABASE_SERVICE_ROLE_KEY` is last and is present for continuity: it is what
 * the platform injects today and what this repo's own callers already send.
 * `SUPABASE_SECRET_KEYS` (a JSON map) is first because it is the only one of
 * the three that expresses more than one live key, which is what makes a
 * rotation survivable.
 *
 * `SUPABASE_ANON_KEY` and `SUPABASE_PUBLISHABLE_KEY*` are deliberately absent
 * and must stay absent. A publishable key is handed to browsers; if one ever
 * entered this set, every visitor to the marketing site would hold a service
 * credential.
 */
export const SECRET_KEY_ENV_NAMES = [
  "SUPABASE_SECRET_KEYS",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

/** Names that must never be treated as a server credential. */
export const FORBIDDEN_SECRET_ENV_NAMES = [
  "SUPABASE_ANON_KEY",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_PUBLISHABLE_KEYS",
] as const;

export type EnvReader = (name: string) => string | undefined;

/**
 * Build the trusted-secret key set.
 *
 * `SUPABASE_SECRET_KEYS` is a JSON object of `{ name: key }`, matching the
 * shape `@supabase/server` reads, so multiple keys can be live at once during
 * a rotation. The singular names contribute one entry each. Malformed JSON
 * yields no entries rather than an exception: a bad rotation blob must not
 * take the function down, and it must not silently widen trust either.
 */
export function buildSecretKeySet(env: EnvReader): Record<string, string> {
  const keys: Record<string, string> = {};

  const plural = (env("SUPABASE_SECRET_KEYS") || "").trim();
  if (plural) {
    try {
      const parsed = JSON.parse(plural);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
          if (typeof value === "string" && value.trim()) keys[name] = value;
        }
      }
    } catch {
      // Deliberately silent about the CONTENT; the caller logs the name only.
    }
  }

  const singular = (env("SUPABASE_SECRET_KEY") || "").trim();
  if (singular) keys.secret_key = singular;

  const serviceRole = (env("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
  if (serviceRole) keys.service_role = serviceRole;

  return keys;
}

/**
 * The URL user JWTs are verified against.
 *
 * The platform does not set `SUPABASE_JWKS*`, so without a fallback the `user`
 * mode would be skipped as "not configured" and every signed-in caller would
 * be turned away. The project's published JWKS endpoint is the documented
 * source and needs no secret to read.
 *
 * A URL, deliberately, and never an inline key set. `SUPABASE_JWKS` would
 * arrive as a JSON string, and turning that into the `JSONWebKeySet` the
 * verifier expects means asserting that parsed JSON really is an array of
 * `JWK` — an unchecked claim about a security-critical value. The remote form
 * needs no such claim, and the library fetches and caches it itself. Nothing
 * in this project sets the inline variable; supporting it halfway would be
 * worse than not supporting it.
 */
export function jwksSource(env: EnvReader): string | null {
  const explicit = (env("SUPABASE_JWKS_URL") || "").trim();
  if (explicit) return explicit;
  const base = (env("SUPABASE_URL") || "").trim().replace(/\/+$/, "");
  return base ? `${base}/auth/v1/.well-known/jwks.json` : null;
}

/**
 * Mirror a bearer credential into the `apikey` header when none was sent.
 *
 * Supabase's own SDK sends an API key in BOTH `apikey` and `Authorization`,
 * and `@supabase/server` reads secrets only from `apikey`. This repo's
 * `marketcheck-market-pricing` proxy — which is live and which this change is
 * forbidden to redeploy — sends only `Authorization: Bearer <key>`. Without
 * this normalisation the proxy would start receiving 401s the moment the new
 * authentication shipped: a self-inflicted outage in the name of a fix.
 *
 * This does not decide anything. It presents the same credential in the slot
 * the verifier reads, and the verifier still has to accept it.
 *
 * The result is a HEADER-ONLY request. The verifier reads `authorization` and
 * `apikey` and nothing else, and the handler has already consumed the real
 * body by the time it authenticates — so copying the body here would either
 * throw ("body already used") or silently steal it from the handler.
 */
export function credentialCarrier(req: Request): Request {
  const { token, apikey } = readCredentials(req);
  const headers = new Headers();
  const authorization = req.headers.get("authorization");
  if (authorization) headers.set("authorization", authorization);
  if (apikey) headers.set("apikey", apikey);
  else if (token) headers.set("apikey", token);
  return new Request(req.url, { method: "GET", headers });
}

// ── What a verified identity may then do ───────────────────────────────────

export type WriterAuthMode = "secret" | "user";

export interface AuthorizedCaller {
  ok: true;
  mode: WriterAuthMode;
  /** Null for a trusted server caller; a user id for an end user. */
  userId: string | null;
}

export interface DeniedCaller {
  ok: false;
  status: 401 | 403 | 500;
  error: string;
}

export type CallerDecision = AuthorizedCaller | DeniedCaller;

export const DENY_UNAUTHENTICATED: DeniedCaller = {
  ok: false, status: 401, error: "authentication required",
};
export const DENY_NOT_A_MEMBER: DeniedCaller = {
  ok: false, status: 403, error: "not a member of this tenant",
};
export const DENY_MISCONFIGURED: DeniedCaller = {
  ok: false, status: 500, error: "authentication misconfigured",
};

/**
 * Map a verifier failure onto a response.
 *
 * A caller-side failure is 401 and says nothing about why — naming the reason
 * would tell an attacker which half of the credential was wrong. A server-side
 * failure (no keys configured at all) is 500, because answering 401 to a
 * misconfiguration is precisely how the original defect stayed invisible: it
 * looked like every caller was unauthorised rather than like the function was
 * misconfigured.
 */
export const denyForVerifierStatus = (status: number | null | undefined): DeniedCaller =>
  (status ?? 401) >= 500 ? DENY_MISCONFIGURED : DENY_UNAUTHENTICATED;

/**
 * Tenant authorisation for a verified END USER. Unchanged in substance from
 * what this function has always done: a platform admin may act on any tenant,
 * anyone else must be a member of the one they named.
 *
 * A trusted server credential does not reach here — it is not acting as a
 * person, and there is no membership row to find.
 */
export function decideUserAuthorization(input: {
  userId: string | null | undefined;
  isPlatformAdmin: boolean;
  isTenantMember: boolean;
}): CallerDecision {
  if (!input.userId) return DENY_UNAUTHENTICATED;
  if (input.isPlatformAdmin) return { ok: true, mode: "user", userId: input.userId };
  if (input.isTenantMember) return { ok: true, mode: "user", userId: input.userId };
  return DENY_NOT_A_MEMBER;
}

/**
 * Nothing that reaches a log, an audit row or a response may carry a
 * credential. Used by the guard tests and by the writer's failure logging,
 * which records the verifier's error CODE and never its details.
 */
export function redactCredentials<T>(value: T, secrets: string[]): T {
  const live = secrets.filter((s) => typeof s === "string" && s.length >= 8);
  if (!live.length) return value;
  let json = JSON.stringify(value);
  if (json === undefined) return value;
  for (const secret of live) json = json.split(secret).join("[redacted]");
  return JSON.parse(json) as T;
}
