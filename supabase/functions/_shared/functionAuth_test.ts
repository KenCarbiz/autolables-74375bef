// ── Executed authentication proof (Deno) ───────────────────────────────────
//
// The vitest suite next door covers the pure policy, but it cannot import
// `@supabase/server` — so until now the ACCEPT path was argued from source
// reading rather than executed. That is the wrong half to leave unproven: a
// mistake in the mode string or the key set does not fail loudly, it 401s
// every trusted caller.
//
// This file runs the real verifier against the real request shapes, offline.
// Every case uses `env` overrides, so nothing here reaches the network, needs
// a project, or touches a real credential.
//
//   deno test supabase/functions/_shared/functionAuth_test.ts
//
// Named `_test.ts` (Deno's convention) rather than `.test.ts` so vitest's
// `supabase/functions/_shared/**/*.test.ts` glob does not try to run it.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createSupabaseContext } from "https://esm.sh/@supabase/server@1.6.0";
import { buildSecretKeySet, credentialCarrier } from "./functionAuth.ts";

const URL_ = "https://project.supabase.co";
const SECRET = "sb_secret_gate14d_offline_fixture";
const PUBLISHABLE = "sb_publishable_gate14d_offline_fixture";
const LEGACY_SERVICE = "eyJhbGciOiJIUzI1NiJ9.legacy-service-role-fixture.sig";

/** Exactly what the writer passes, so the test cannot drift from production. */
const verify = (req: Request, secretKeys: Record<string, string>) =>
  createSupabaseContext(credentialCarrier(req), {
    auth: ["secret:*", "user"],
    env: { url: URL_, secretKeys, publishableKeys: { web: PUBLISHABLE }, jwks: null },
  });

const post = (headers: Record<string, string>) =>
  new Request("https://project.supabase.co/functions/v1/market-valuation-write", {
    method: "POST",
    headers,
    body: JSON.stringify({ vin: "3PCAJ5FB1SF109708", tenant_id: "t" }),
  });

Deno.test("a managed secret in the apikey header is accepted", async () => {
  const { data, error } = await verify(post({ apikey: SECRET }), { current: SECRET });
  assertEquals(error, null);
  assertEquals(data?.authMode, "secret");
});

Deno.test("the proxy's Authorization-only credential is mirrored and accepted", async () => {
  // marketcheck-market-pricing sends no apikey header. This is the case that
  // would have taken the live proxy down.
  const { data, error } = await verify(
    post({ Authorization: `Bearer ${LEGACY_SERVICE}` }),
    { service_role: LEGACY_SERVICE },
  );
  assertEquals(error, null);
  assertEquals(data?.authMode, "secret");
});

Deno.test("a second live key is accepted during a rotation", async () => {
  const keys = { current: SECRET, previous: "sb_secret_previous_fixture" };
  for (const value of Object.values(keys)) {
    const { data, error } = await verify(post({ apikey: value }), keys);
    assertEquals(error, null);
    assertEquals(data?.authMode, "secret");
  }
});

Deno.test("the wildcard is what makes a named key set match", async () => {
  // Plain "secret" resolves to the key literally named `default`. Without the
  // `:*` a named set matches nothing — this asserts the failure directly so
  // the reason is on the record rather than in a comment.
  const named = { current: SECRET };
  const withoutWildcard = await createSupabaseContext(
    credentialCarrier(post({ apikey: SECRET })),
    { auth: ["secret", "user"], env: { url: URL_, secretKeys: named, jwks: null } },
  );
  assert(withoutWildcard.error !== null, "plain secret mode must not match a named key");

  const withWildcard = await verify(post({ apikey: SECRET }), named);
  assertEquals(withWildcard.error, null);
});

Deno.test("no credentials is 401, not an accident", async () => {
  const { data, error } = await verify(post({}), { current: SECRET });
  assert(error !== null);
  assertEquals(data, null);
  assertEquals(error?.status, 401);
});

Deno.test("a wrong or malformed secret is rejected", async () => {
  for (const bad of ["sb_secret_not_the_configured_one", "garbage", "Bearer", " "]) {
    const { error } = await verify(post({ apikey: bad }), { current: SECRET });
    assert(error !== null, `expected rejection for ${JSON.stringify(bad)}`);
  }
});

Deno.test("a publishable key never authenticates as a service caller", async () => {
  // In either header slot. This is the one that would hand every browser
  // visitor a service credential.
  //
  // Annotated, not asserted: two object literals with different keys infer a
  // union whose members carry `undefined` for the key they lack, which is not
  // assignable to Record<string, string>.
  const slots: Record<string, string>[] = [
    { apikey: PUBLISHABLE },
    { Authorization: `Bearer ${PUBLISHABLE}` },
  ];
  for (const headers of slots) {
    const { data, error } = await verify(post(headers), { current: SECRET });
    assert(error !== null, "publishable key must not be accepted");
    assertEquals(data, null);
  }
});

Deno.test("a legacy anon-shaped JWT is rejected when it is not a configured secret", async () => {
  const anon = "eyJhbGciOiJIUzI1NiJ9.anon-fixture.sig";
  const { error } = await verify(post({ Authorization: `Bearer ${anon}` }), { current: SECRET });
  assert(error !== null);
});

Deno.test("an empty key set trusts nothing", async () => {
  const { error } = await verify(post({ apikey: SECRET }), buildSecretKeySet(() => undefined));
  assert(error !== null, "an unconfigured deployment must not accept a credential");
});

Deno.test("no credential is echoed in the failure it produces", async () => {
  const { error } = await verify(post({ apikey: SECRET }), { current: "sb_secret_other" });
  assert(error !== null);
  const serialized = JSON.stringify(error?.toJSON?.() ?? String(error));
  assert(!serialized.includes(SECRET), "the presented key must not appear in the error");
  assert(!serialized.includes("sb_secret_other"), "the configured key must not appear in the error");
});
