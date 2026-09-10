// ── Caller authentication: the contract, not the library ───────────────────
//
// `@supabase/server` does the verifying and is not re-tested here. What IS
// tested is everything around it that we own and that a mistake in would be
// silent: which keys are trusted, where a credential is read from, what a
// verified identity is then allowed to do, and — by source guard — that the
// writer still cannot reach money before any of it has run.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  SECRET_KEY_ENV_NAMES, FORBIDDEN_SECRET_ENV_NAMES,
  buildSecretKeySet, credentialCarrier, decideUserAuthorization,
  denyForVerifierStatus, jwksSource, readCredentials, redactCredentials,
  DENY_UNAUTHENTICATED, DENY_NOT_A_MEMBER, DENY_MISCONFIGURED,
} from "./functionAuth.ts";

const WRITER = "supabase/functions/market-valuation-write/index.ts";
const writerSrc = () => readFileSync(WRITER, "utf8");

/**
 * The writer with whole-line comments removed.
 *
 * The negative guards below are about what the function DOES, and the file
 * documents the defect it replaced by name. Asserting against raw text would
 * force the explanation to be deleted to keep the test green — which is the
 * wrong trade: the comment is why the next person does not reintroduce it.
 * Only full-line comments are stripped, so `https://` inside an import is
 * untouched.
 */
const writerCode = () =>
  writerSrc()
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"));
    })
    .join("\n");

const envOf = (map: Record<string, string>) => (name: string) => map[name];

const SERVICE_ROLE = "eyJhbGciOiJIUzI1NiJ9.service-role-fixture.signature";
const PUBLISHABLE = "eyJhbGciOiJIUzI1NiJ9.publishable-fixture.signature";
const MODERN_SECRET = "sb_secret_fixture_abcdefghijklmnop";

// ── Which keys are trusted ─────────────────────────────────────────────────

describe("trusted secret key set", () => {
  it("is a set, so a rotation can keep two keys live at once", () => {
    const keys = buildSecretKeySet(envOf({
      SUPABASE_SECRET_KEYS: JSON.stringify({ current: MODERN_SECRET, previous: "sb_secret_old_key_value" }),
      SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE,
    }));
    expect(Object.keys(keys).sort()).toEqual(["current", "previous", "service_role"]);
    expect(Object.values(keys)).toContain(MODERN_SECRET);
    expect(Object.values(keys)).toContain(SERVICE_ROLE);
  });

  it("keeps the platform service-role key trusted, so existing callers survive", () => {
    // The live marketcheck-market-pricing proxy sends exactly this credential
    // and must not be redeployed as part of this change.
    const keys = buildSecretKeySet(envOf({ SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE }));
    expect(Object.values(keys)).toEqual([SERVICE_ROLE]);
  });

  it("never trusts a publishable or anon key, whatever it is named", () => {
    const keys = buildSecretKeySet(envOf({
      SUPABASE_ANON_KEY: PUBLISHABLE,
      SUPABASE_PUBLISHABLE_KEY: PUBLISHABLE,
      SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ web: PUBLISHABLE }),
    }));
    expect(keys).toEqual({});
    for (const forbidden of FORBIDDEN_SECRET_ENV_NAMES) {
      expect(SECRET_KEY_ENV_NAMES as readonly string[]).not.toContain(forbidden);
    }
  });

  it("survives a malformed rotation blob without widening trust", () => {
    expect(buildSecretKeySet(envOf({ SUPABASE_SECRET_KEYS: "{not json" }))).toEqual({});
    expect(buildSecretKeySet(envOf({ SUPABASE_SECRET_KEYS: '["array"]' }))).toEqual({});
    expect(buildSecretKeySet(envOf({ SUPABASE_SECRET_KEYS: '{"blank":""}' }))).toEqual({});
  });

  it("is empty when nothing is configured, so nothing is trusted by default", () => {
    expect(buildSecretKeySet(envOf({}))).toEqual({});
  });
});

// ── Where a credential is read from ────────────────────────────────────────

describe("credential presentation", () => {
  const post = (headers: Record<string, string>) =>
    new Request("https://example.test/market-valuation-write", { method: "POST", headers });

  it("reads a bearer token and an apikey header", () => {
    const c = readCredentials(post({ Authorization: `Bearer ${SERVICE_ROLE}`, apikey: MODERN_SECRET }));
    expect(c.token).toBe(SERVICE_ROLE);
    expect(c.apikey).toBe(MODERN_SECRET);
  });

  it("mirrors a lone bearer into apikey, so the live proxy keeps working", () => {
    // The proxy sends Authorization only. Secret mode reads apikey only.
    const carrier = credentialCarrier(post({ Authorization: `Bearer ${SERVICE_ROLE}` }));
    expect(carrier.headers.get("apikey")).toBe(SERVICE_ROLE);
    expect(carrier.headers.get("authorization")).toBe(`Bearer ${SERVICE_ROLE}`);
  });

  it("never overwrites an apikey the caller actually sent", () => {
    const carrier = credentialCarrier(post({ Authorization: `Bearer ${SERVICE_ROLE}`, apikey: MODERN_SECRET }));
    expect(carrier.headers.get("apikey")).toBe(MODERN_SECRET);
  });

  it("invents no credential when the caller presented none", () => {
    const carrier = credentialCarrier(post({}));
    expect(carrier.headers.get("apikey")).toBeNull();
    expect(carrier.headers.get("authorization")).toBeNull();
  });

  it("carries headers only, leaving the handler's body untouched", async () => {
    const req = new Request("https://example.test/x", {
      method: "POST",
      headers: { Authorization: `Bearer ${SERVICE_ROLE}`, "content-type": "application/json" },
      body: JSON.stringify({ vin: "3PCAJ5FB1SF109708" }),
    });
    const carrier = credentialCarrier(req);
    expect(carrier.method).toBe("GET");
    expect(req.bodyUsed).toBe(false);
    // The handler can still read its own body afterwards.
    await expect(req.json()).resolves.toEqual({ vin: "3PCAJ5FB1SF109708" });
  });

  it("ignores a non-bearer authorization scheme", () => {
    expect(readCredentials(post({ Authorization: `Basic ${SERVICE_ROLE}` })).token).toBeNull();
  });
});

// ── Where user tokens are verified ─────────────────────────────────────────

describe("jwks source", () => {
  it("falls back to the project's published endpoint, which the platform does not set", () => {
    expect(jwksSource(envOf({ SUPABASE_URL: "https://onnbmmdbrsgytfozfozn.supabase.co" })))
      .toBe("https://onnbmmdbrsgytfozfozn.supabase.co/auth/v1/.well-known/jwks.json");
  });

  it("prefers an explicitly configured url", () => {
    expect(jwksSource(envOf({ SUPABASE_JWKS_URL: "https://x/jwks", SUPABASE_URL: "https://x.supabase.co" })))
      .toBe("https://x/jwks");
  });

  it("returns a url and never an inline key set", () => {
    // An inline SUPABASE_JWKS would have to be asserted into JSONWebKeySet —
    // an unchecked claim about a security-critical value. The remote form
    // needs no such claim.
    const src = jwksSource(envOf({ SUPABASE_JWKS: '{"keys":[]}', SUPABASE_URL: "https://x.supabase.co" }));
    expect(src).toBe("https://x.supabase.co/auth/v1/.well-known/jwks.json");
  });

  it("is null when there is nothing to verify against", () => {
    expect(jwksSource(envOf({}))).toBeNull();
  });
});

// ── What a verified identity may do ────────────────────────────────────────

describe("tenant authorization for a verified user", () => {
  it("lets a platform admin act on any tenant", () => {
    expect(decideUserAuthorization({ userId: "u1", isPlatformAdmin: true, isTenantMember: false }))
      .toEqual({ ok: true, mode: "user", userId: "u1" });
  });

  it("lets a member act on their own tenant", () => {
    expect(decideUserAuthorization({ userId: "u2", isPlatformAdmin: false, isTenantMember: true }))
      .toEqual({ ok: true, mode: "user", userId: "u2" });
  });

  it("refuses a signed-in stranger with 403, not 401", () => {
    // The distinction matters: they authenticated fine, they just do not own
    // this dealer's data.
    expect(decideUserAuthorization({ userId: "u3", isPlatformAdmin: false, isTenantMember: false }))
      .toEqual(DENY_NOT_A_MEMBER);
  });

  it("refuses a verified token that identifies no user", () => {
    expect(decideUserAuthorization({ userId: null, isPlatformAdmin: true, isTenantMember: true }))
      .toEqual(DENY_UNAUTHENTICATED);
  });
});

describe("verifier failures map to responses", () => {
  it("answers 401 for anything the caller got wrong, without saying which half", () => {
    for (const status of [400, 401, 403, undefined, null]) {
      expect(denyForVerifierStatus(status as number)).toEqual(DENY_UNAUTHENTICATED);
    }
    expect(DENY_UNAUTHENTICATED.error).toBe("authentication required");
  });

  it("answers 500 for a server misconfiguration rather than blaming the caller", () => {
    // Answering 401 to "no keys are configured" is exactly how the original
    // defect stayed invisible: it looked like every caller was unauthorised.
    expect(denyForVerifierStatus(500)).toEqual(DENY_MISCONFIGURED);
    expect(DENY_MISCONFIGURED.status).toBe(500);
  });
});

describe("credential redaction", () => {
  it("strips a secret from anything about to be serialized", () => {
    const out = redactCredentials({ note: `bearer ${SERVICE_ROLE}`, nested: { k: SERVICE_ROLE } }, [SERVICE_ROLE]);
    expect(JSON.stringify(out)).not.toContain(SERVICE_ROLE);
    expect(out.nested.k).toBe("[redacted]");
  });

  it("ignores trivially short values so it cannot blank out ordinary text", () => {
    expect(redactCredentials({ a: "yes" }, ["yes"])).toEqual({ a: "yes" });
  });
});

// ── The writer still cannot reach money before authenticating ──────────────

describe("writer authentication wiring", () => {
  it("no longer decides trust by comparing against one environment variable", () => {
    const code = writerCode();
    expect(code).not.toMatch(/auth\s*!==\s*SERVICE_KEY/);
    expect(code).not.toMatch(/===\s*SERVICE_KEY/);
    expect(code).not.toContain("SERVICE_KEY");
    expect(code).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    // and the old fallback is gone with it
    expect(code).not.toContain("auth.getUser(");
  });

  it("delegates verification to the documented Supabase mechanism", () => {
    const src = writerSrc();
    expect(src).toMatch(/import \{ createSupabaseContext \} from "https:\/\/esm\.sh\/@supabase\/server@/);
    expect(src).toContain("createSupabaseContext(credentialCarrier(req)");
  });

  it("tries secret before user, and uses the wildcard so a named key set matches", () => {
    // Plain "secret" resolves to the key literally named `default`; without the
    // wildcard a named set matches nothing and 401s every trusted caller.
    expect(writerSrc()).toContain('auth: ["secret:*", "user"]');
  });

  it("authenticates before the reservation, the provider call and every insert", () => {
    const src = writerSrc();
    const authAt = src.indexOf("await authenticateCaller(");
    for (const spend of [
      "market_reserve_provider_call",
      "callProvider(",
      "market_valuation_commit",
      'from("audit_log").insert(',
    ]) {
      const at = src.indexOf(spend);
      expect(at).toBeGreaterThan(-1);
      expect(at).toBeGreaterThan(authAt);
    }
    // and the handler returns immediately when it is not satisfied
    expect(src).toMatch(/if \(!caller\.ok\) return json\(caller\.status/);
  });

  it("logs only the failure code, never a credential or the error's details", () => {
    const code = writerCode();
    expect(code).toContain('console.error("writer_auth_denied", error.code)');
    expect(code).not.toMatch(/console\.(log|error|warn)\([^)]*\berror\.toJSON\(\)/);
    expect(code).not.toMatch(/console\.(log|error|warn)\([^)]*apikey/i);
    expect(code).not.toMatch(/console\.(log|error|warn)\([^)]*Authorization/i);
  });

  it("keeps CORS preflight ahead of authentication", () => {
    const src = writerSrc();
    expect(src.indexOf("preflight(req)")).toBeLessThan(src.indexOf("await authenticateCaller("));
  });

  it("contains no secret-shaped literal", () => {
    const code = writerCode();
    expect(code).not.toMatch(/sb_secret_[A-Za-z0-9_-]{8,}/);
    expect(code).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}\./);
  });
});
