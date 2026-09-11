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
  constantTimeEquals, matchesLegacyServiceRole,
  DENY_UNAUTHENTICATED, DENY_NOT_A_MEMBER, DENY_MISCONFIGURED,
} from "./functionAuth.ts";

/** Source with comments removed, so a guard cannot fire on documentation. */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

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
    // The env var is READ again by the legacy compatibility path, which is
    // fine and necessary. What must never come back is deciding trust with a
    // string comparison against it.
    expect(code).not.toMatch(/auth\s*!==\s*SERVICE_KEY/);
    expect(code).not.toMatch(/===\s*SERVICE_KEY/);
    expect(code).not.toMatch(/[!=]==\s*Deno\.env\.get\(/);
    expect(code).not.toContain("SERVICE_KEY ||");
    // and the old unverified fallback is gone with it
    expect(code).not.toContain("auth.getUser(");
    // the only use of the canonical key is the constant-time matcher
    expect(code).toContain("matchesLegacyServiceRole(");
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

  it("logs only the failure code and non-secret shape, never a credential", () => {
    const code = writerCode();
    expect(code).toContain('console.error("writer_auth_denied", error.code,');
    expect(code).not.toMatch(/console\.(log|error|warn)\([^)]*\berror\.toJSON\(\)/);
    // Presence booleans are fine and are why this diagnostic exists; the
    // credential VALUES are what must never reach a log.
    expect(code).not.toMatch(/presented\.apikey\s*[,}]/);
    expect(code).not.toMatch(/presented\.token\s*[,}]/);
    expect(code).not.toMatch(/(apikey|token)(\.slice|\.substring|\.length)/);
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

// ── Legacy service-role compatibility ──────────────────────────────────────
//
// The modern verifier answers INVALID_API_KEY for a legacy JWT-shaped
// service_role key, which is this project's canonical credential. The
// compatibility path accepts that ONE value and nothing that merely resembles
// it. These tests are the difference between "a narrow compatibility shim" and
// "a second way in".

const CANONICAL =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJvbGUiOiJzZXJ2aWNlX3JvbGUifQ.canonical-fixture-signature";

const creds = (h: Record<string, string>) => readCredentials(new Request("https://x/f", { headers: h }));

describe("constant-time comparison", () => {
  it("is true only for identical strings", async () => {
    expect(await constantTimeEquals(CANONICAL, CANONICAL)).toBe(true);
    expect(await constantTimeEquals(CANONICAL, CANONICAL + "x")).toBe(false);
    expect(await constantTimeEquals("a", "b")).toBe(false);
  });

  it("absorbs a length difference instead of exiting early on it", async () => {
    // Both operands are digested to 32 bytes before anything is compared, so
    // "wrong length" and "wrong content" are indistinguishable to a caller.
    expect(await constantTimeEquals("short", "a-much-longer-value-entirely")).toBe(false);
    expect(await constantTimeEquals(CANONICAL, CANONICAL.slice(0, 10))).toBe(false);
  });

  it("treats an absent operand as no match, never as a match", async () => {
    expect(await constantTimeEquals("", "")).toBe(false);
    expect(await constantTimeEquals("", CANONICAL)).toBe(false);
    expect(await constantTimeEquals(CANONICAL, "")).toBe(false);
  });
});

describe("legacy service-role compatibility", () => {
  it("accepts the canonical key in the apikey header", async () => {
    expect(await matchesLegacyServiceRole(creds({ apikey: CANONICAL }), CANONICAL)).toBe(true);
  });

  it("accepts the canonical key as Authorization-only, preserving the proxy contract", async () => {
    // marketcheck-market-pricing sends no apikey header and must keep working.
    expect(await matchesLegacyServiceRole(
      creds({ Authorization: `Bearer ${CANONICAL}` }), CANONICAL,
    )).toBe(true);
  });

  it("rejects a different project's legacy service-role JWT", async () => {
    const otherProject =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJvbGUiOiJzZXJ2aWNlX3JvbGUifQ.a-different-projects-signature";
    expect(await matchesLegacyServiceRole(creds({ apikey: otherProject }), CANONICAL)).toBe(false);
  });

  it("rejects a legacy anon JWT", async () => {
    const anon =
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJvbGUiOiJhbm9uIn0.anon-fixture-signature";
    expect(await matchesLegacyServiceRole(creds({ apikey: anon }), CANONICAL)).toBe(false);
    expect(await matchesLegacyServiceRole(creds({ Authorization: `Bearer ${anon}` }), CANONICAL)).toBe(false);
  });

  it("rejects the canonical key with its final character altered", async () => {
    const altered = CANONICAL.slice(0, -1) + (CANONICAL.endsWith("e") ? "f" : "e");
    expect(altered).not.toBe(CANONICAL);
    expect(await matchesLegacyServiceRole(creds({ apikey: altered }), CANONICAL)).toBe(false);
  });

  it("rejects a truncated key", async () => {
    expect(await matchesLegacyServiceRole(creds({ apikey: CANONICAL.slice(0, -1) }), CANONICAL)).toBe(false);
    expect(await matchesLegacyServiceRole(creds({ apikey: CANONICAL.slice(0, 20) }), CANONICAL)).toBe(false);
  });

  it("rejects an empty credential", async () => {
    expect(await matchesLegacyServiceRole(creds({ apikey: "" }), CANONICAL)).toBe(false);
    expect(await matchesLegacyServiceRole(creds({}), CANONICAL)).toBe(false);
  });

  it("is unavailable, not permissive, when the runtime has no service-role key", async () => {
    for (const configured of [undefined, null, "", "   "]) {
      expect(await matchesLegacyServiceRole(creds({ apikey: CANONICAL }), configured)).toBe(false);
    }
  });

  it("does not accept a forged privileged claim", async () => {
    // The payload says service_role. Nothing reads it, so it buys nothing.
    const forged = [
      "eyJhbGciOiJub25lIn0",
      btoa(JSON.stringify({ iss: "supabase", role: "service_role", admin: true })),
      "forged",
    ].join(".");
    expect(await matchesLegacyServiceRole(creds({ apikey: forged }), CANONICAL)).toBe(false);
    expect(await matchesLegacyServiceRole(creds({ Authorization: `Bearer ${forged}` }), CANONICAL)).toBe(false);
  });

  it("never returns true for a credential that is merely shaped like the real one", async () => {
    const sameLength = "x".repeat(CANONICAL.length);
    expect(sameLength.length).toBe(CANONICAL.length);
    expect(await matchesLegacyServiceRole(creds({ apikey: sameLength }), CANONICAL)).toBe(false);
  });
});

describe("the removed defect stays removed", () => {
  it("no direct equality against the service-role key returns an authorization", () => {
    // Comments are stripped first. Both files DOCUMENT the deleted line, and a
    // guard that fires on its own documentation teaches people to delete the
    // documentation.
    const src = stripComments(
      writerSrc() + "\n" + readFileSync("supabase/functions/_shared/functionAuth.ts", "utf8"),
    );
    expect(src).not.toMatch(/auth\s*!==\s*SERVICE_KEY/);
    expect(src).not.toMatch(/auth\s*===\s*SERVICE_KEY/);
    expect(src).not.toMatch(/[!=]==\s*Deno\.env\.get\(\s*["']SUPABASE_SERVICE_ROLE_KEY["']\s*\)/);
    expect(src).not.toMatch(/SERVICE_ROLE_KEY["']\s*\)\s*[!=]==/);
  });

  it("the legacy comparison is the keyed-digest one, not a string compare", () => {
    const mod = readFileSync("supabase/functions/_shared/functionAuth.ts", "utf8");
    const fn = mod.slice(mod.indexOf("export async function matchesLegacyServiceRole"));
    const body = fn.slice(0, fn.indexOf("\n}"));
    expect(body).toContain("constantTimeEquals");
    expect(body).not.toMatch(/[!=]==\s*configured/);
  });

  it("authentication is resolved before any spend, reservation or commit", () => {
    const src = writerSrc();
    const auth = src.indexOf("const caller = await authenticateCaller(");
    for (const later of [
      "market_reserve_provider_call", "callProvider(", "market_valuation_commit",
      'from("vehicle_listings").update(',
    ]) {
      expect(src.indexOf(later)).toBeGreaterThan(auth);
    }
  });

  it("logs no credential, only presence and configuration shape", () => {
    const src = writerSrc();
    const log = src.slice(src.indexOf('console.error("writer_auth_denied"'));
    const block = log.slice(0, log.indexOf("});") + 3);
    expect(block).toContain("apikey_present");
    expect(block).not.toMatch(/presented\.(apikey|token)\s*[,})]/);
    expect(block).not.toContain("SECRET_KEYS[");
    expect(block).not.toMatch(/\.slice\(/);
    // A COUNT of configured keys is fine; the LENGTH of a presented credential
    // is not — it narrows the search space for whoever reads the logs.
    expect(block).not.toMatch(/presented\.(apikey|token)\s*\.\s*length/);
    expect(block).not.toMatch(/\b(apikey|token|credential)_length\b/);
  });
});
