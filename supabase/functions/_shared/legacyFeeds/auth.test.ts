import { describe, expect, it } from "vitest";
import { sign, hmacHex } from "../integrations/signing.ts";
import { authenticateLegacyFeed, canonicalGetTarget, type AuthInput } from "./auth.ts";
import { runFeedWrite } from "./idempotency.ts";
import { memoryStore } from "./memoryStore.ts";
import type { LegacyFeed, SignedKeyRecord } from "./types.ts";

const NOW = 1_800_000_000;
const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const CONN_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CONN_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SECRET_A = "synthetic-secret-a";
const SECRET_B = "synthetic-secret-b";

const key = (id: string, conn: string, tenant: string, over: Partial<SignedKeyRecord> = {}): SignedKeyRecord => ({
  key_id: id, status: "active", not_after: null, connection: { id: conn, tenant_id: tenant, status: "active" }, ...over,
});

function seeded() {
  const store = memoryStore({
    keys: {
      "key-a": { record: key("key-a", CONN_A, TENANT_A), secret: SECRET_A },
      "key-b": { record: key("key-b", CONN_B, TENANT_B), secret: SECRET_B },
    },
    bindings: [
      ...(["autofilm_feed", "autocurb_sync"] as LegacyFeed[]).flatMap((feed) => [
        { connectionId: CONN_A, feed, provider: null, binding: { id: `ba-${feed}`, legacy_unsigned: "allowed" as const } },
        { connectionId: CONN_B, feed, provider: null, binding: { id: `bb-${feed}`, legacy_unsigned: "allowed" as const } },
      ]),
      { connectionId: CONN_A, feed: "dms_webhook", provider: "vauto", binding: { id: "ba-dms", legacy_unsigned: "allowed" } },
    ],
    autocurbTenants: { "ac-a": TENANT_A, "ac-b": TENANT_B },
    legacySecrets: {
      "autofilm_feed:": "legacy-lookup", "autocurb_sync:": "legacy-sync", "dms_webhook:vauto": "legacy-vauto",
    },
  });
  return store;
}

const headersOf = (h: Record<string, string>) => ({ get: (n: string) => h[n.toLowerCase()] ?? null });

async function signedInput(
  feed: LegacyFeed,
  over: { keyId?: string; secret?: string; ts?: number; rawBody?: string; target?: string; claimed?: AuthInput["claimedTenant"]; idem?: string | null; provider?: string } = {},
): Promise<AuthInput> {
  const method = feed === "autofilm_feed" ? "GET" : "POST";
  const rawBody = over.rawBody ?? (method === "GET" ? "" : JSON.stringify({ vehicles: [{ vin: "1HGCM82633A004352" }] }));
  const target = over.target ?? "/?limit=10&tenant_id=" + TENANT_A;
  const keyId = over.keyId ?? "key-a";
  const ts = over.ts ?? NOW;
  const signature = await sign(over.secret ?? SECRET_A, ts, keyId, method === "GET" ? `GET ${target}` : rawBody);
  const h: Record<string, string> = {
    "x-rooftop-key-id": keyId, "x-rooftop-timestamp": String(ts), "x-rooftop-signature": signature,
  };
  if (method === "POST" && over.idem !== null) h["idempotency-key"] = over.idem ?? "idem-1";
  return {
    feed, provider: over.provider ?? (feed === "dms_webhook" ? "vauto" : null), method, pathAndQuery: target, rawBody,
    headers: headersOf(h), nowSeconds: NOW, claimedTenant: over.claimed ?? null,
  };
}

describe("canonicalGetTarget", () => {
  it("strips up to the function name and sorts query params", () => {
    expect(canonicalGetTarget("/functions/v1/autofilm-feed", "?tenant_id=t&cursor=c&limit=5", "autofilm-feed"))
      .toBe("/?cursor=c&limit=5&tenant_id=t");
    expect(canonicalGetTarget("/autofilm-feed/vehicle/V", "?tenant_id=t", "autofilm-feed")).toBe("/vehicle/V?tenant_id=t");
  });
});

describe("signed mode", () => {
  for (const feed of ["autofilm_feed", "autocurb_sync", "dms_webhook"] as LegacyFeed[]) {
    it(`authenticates a valid ${feed} request to the key's tenant`, async () => {
      const store = seeded();
      const r = await authenticateLegacyFeed(await signedInput(feed), store);
      expect(r).toMatchObject({ ok: true, mode: "signed", tenantId: TENANT_A, connectionId: CONN_A });
    });
  }

  it("rejects dealer A's key when dealer B's tenant is named, with no write", async () => {
    const store = seeded();
    const input = await signedInput("autocurb_sync", { claimed: { kind: "autocurb_tenant_id", value: "ac-b" } });
    const r = await authenticateLegacyFeed(input, store);
    expect(r).toEqual({ ok: false, status: 403, error: "tenant_mismatch" });
    expect(store.state.receipts.size).toBe(0);
    const g = await authenticateLegacyFeed(
      await signedInput("autofilm_feed", { target: `/?tenant_id=${TENANT_B}`, claimed: { kind: "tenant_id", value: TENANT_B } }), store);
    expect(g).toEqual({ ok: false, status: 403, error: "tenant_mismatch" });
    const d = await authenticateLegacyFeed(await signedInput("dms_webhook", { claimed: { kind: "tenant_id", value: TENANT_B } }), store);
    expect(d).toEqual({ ok: false, status: 403, error: "tenant_mismatch" });
  });

  it("accepts a named tenant that matches the key", async () => {
    const r = await authenticateLegacyFeed(
      await signedInput("autocurb_sync", { claimed: { kind: "autocurb_tenant_id", value: "ac-a" } }), seeded());
    expect(r.ok).toBe(true);
  });

  it("rejects a request older than 300 seconds and one from the future", async () => {
    const old = await authenticateLegacyFeed(await signedInput("autocurb_sync", { ts: NOW - 301 }), seeded());
    expect(old).toEqual({ ok: false, status: 401, error: "stale_request" });
    const future = await authenticateLegacyFeed(await signedInput("autocurb_sync", { ts: NOW + 301 }), seeded());
    expect(future).toMatchObject({ ok: false, error: "stale_request" });
    const edge = await authenticateLegacyFeed(await signedInput("autocurb_sync", { ts: NOW - 300 }), seeded());
    expect(edge.ok).toBe(true);
  });

  it("rejects an altered body", async () => {
    const input = await signedInput("autocurb_sync");
    const r = await authenticateLegacyFeed({ ...input, rawBody: input.rawBody.replace("1HGCM", "1HGCN") }, seeded());
    expect(r).toEqual({ ok: false, status: 401, error: "unauthorized" });
  });

  it("rejects an altered GET query", async () => {
    const input = await signedInput("autofilm_feed");
    const r = await authenticateLegacyFeed({ ...input, pathAndQuery: `/?limit=10&tenant_id=${TENANT_B}` }, seeded());
    expect(r).toEqual({ ok: false, status: 401, error: "unauthorized" });
  });

  it("rejects a wrong secret, an unknown key and missing headers", async () => {
    expect((await authenticateLegacyFeed(await signedInput("autocurb_sync", { secret: SECRET_B }), seeded())).ok).toBe(false);
    expect(await authenticateLegacyFeed(await signedInput("autocurb_sync", { keyId: "nope" }), seeded()))
      .toEqual({ ok: false, status: 401, error: "unauthorized" });
    const input = await signedInput("autocurb_sync");
    const partial = { ...input, headers: headersOf({ "x-rooftop-key-id": "key-a" }) };
    expect(await authenticateLegacyFeed(partial, seeded())).toEqual({ ok: false, status: 401, error: "unauthorized" });
  });

  it("rejects revoked keys, keys past not_after and inactive connections", async () => {
    const revoked = seeded();
    revoked.state.keys["key-a"].record.status = "revoked";
    expect(await authenticateLegacyFeed(await signedInput("autocurb_sync"), revoked)).toEqual({ ok: false, status: 401, error: "unauthorized" });

    const expired = seeded();
    expired.state.keys["key-a"].record = key("key-a", CONN_A, TENANT_A, { status: "retiring", not_after: new Date((NOW - 10) * 1000).toISOString() });
    expect(await authenticateLegacyFeed(await signedInput("autocurb_sync"), expired)).toEqual({ ok: false, status: 401, error: "unauthorized" });

    const retiring = seeded();
    retiring.state.keys["key-a"].record = key("key-a", CONN_A, TENANT_A, { status: "retiring", not_after: new Date((NOW + 3600) * 1000).toISOString() });
    expect((await authenticateLegacyFeed(await signedInput("autocurb_sync"), retiring)).ok).toBe(true);

    const paused = seeded();
    paused.state.keys["key-a"].record.connection.status = "paused";
    expect(await authenticateLegacyFeed(await signedInput("autocurb_sync"), paused)).toEqual({ ok: false, status: 403, error: "connection_inactive" });
  });

  it("requires a binding for the feed and provider", async () => {
    const store = seeded();
    expect(await authenticateLegacyFeed(await signedInput("dms_webhook", { provider: "cdk" }), store))
      .toEqual({ ok: false, status: 403, error: "feed_not_bound" });
    store.state.bindings = store.state.bindings.filter((b) => b.feed !== "autocurb_sync");
    expect(await authenticateLegacyFeed(await signedInput("autocurb_sync"), store))
      .toEqual({ ok: false, status: 403, error: "feed_not_bound" });
  });

  it("requires an Idempotency-Key on writes only", async () => {
    expect(await authenticateLegacyFeed(await signedInput("autocurb_sync", { idem: null }), seeded()))
      .toEqual({ ok: false, status: 400, error: "idempotency_key_required" });
    expect(await authenticateLegacyFeed(await signedInput("autocurb_sync", { idem: "x".repeat(201) }), seeded()))
      .toMatchObject({ ok: false, status: 400 });
    expect((await authenticateLegacyFeed(await signedInput("autofilm_feed"), seeded())).ok).toBe(true);
  });
});

describe("idempotent signed writes", () => {
  it("replays a retried request with zero further writes", async () => {
    const store = seeded();
    const auth = await authenticateLegacyFeed(await signedInput("autocurb_sync"), store);
    if (!auth.ok || auth.mode !== "signed") throw new Error("auth");
    let writes = 0;
    const run = async () => { writes++; return { status: 200, body: { upserted: 1, errors: [], held: [] } }; };
    const first = await runFeedWrite(store, auth, "autocurb_sync", run);
    expect(first).toMatchObject({ status: 200, body: { upserted: 1 }, headers: {} });
    const retried = await authenticateLegacyFeed(await signedInput("autocurb_sync", { ts: NOW + 5 }), store);
    if (!retried.ok || retried.mode !== "signed") throw new Error("auth");
    const second = await runFeedWrite(store, retried, "autocurb_sync", run);
    expect(second).toMatchObject({ status: 200, body: { upserted: 1 }, headers: { "Idempotent-Replay": "true" } });
    expect(writes).toBe(1);
  });

  it("a captured request replayed in the window with a swapped Idempotency-Key does not write again", async () => {
    const store = seeded();
    const input = await signedInput("autocurb_sync");
    const auth = await authenticateLegacyFeed(input, store);
    if (!auth.ok || auth.mode !== "signed") throw new Error("auth");
    let writes = 0;
    const run = async () => { writes++; return { status: 200, body: { upserted: 1, errors: [], held: [] } }; };
    await runFeedWrite(store, auth, "autocurb_sync", run);
    const headers = { get: (n: string) => (n.toLowerCase() === "idempotency-key" ? "attacker-chosen-key" : input.headers.get(n)) };
    const replayed = await authenticateLegacyFeed({ ...input, headers }, store);
    if (!replayed.ok || replayed.mode !== "signed") throw new Error("auth");
    const out = await runFeedWrite(store, replayed, "autocurb_sync", run);
    expect(out).toMatchObject({ status: 200, headers: { "Idempotent-Replay": "true" } });
    expect(writes).toBe(1);
  });

  it("returns 409 when the key is reused with a different body", async () => {
    const store = seeded();
    const a = await authenticateLegacyFeed(await signedInput("autocurb_sync"), store);
    const b = await authenticateLegacyFeed(await signedInput("autocurb_sync", { rawBody: JSON.stringify({ vehicles: [] }) }), store);
    if (!a.ok || a.mode !== "signed" || !b.ok || b.mode !== "signed") throw new Error("auth");
    let writes = 0;
    const run = async () => { writes++; return { status: 200, body: {} }; };
    await runFeedWrite(store, a, "autocurb_sync", run);
    const out = await runFeedWrite(store, b, "autocurb_sync", run);
    expect(out).toMatchObject({ status: 409, body: { error: "idempotency_key_reused" } });
    expect(writes).toBe(1);
  });

  it("returns 409 while the first request is still processing, and stores nothing for a 5xx", async () => {
    const store = seeded();
    const a = await authenticateLegacyFeed(await signedInput("autocurb_sync"), store);
    if (!a.ok || a.mode !== "signed") throw new Error("auth");
    const pending = runFeedWrite(store, a, "autocurb_sync", async () => ({ status: 500, body: { error: "boom" } }));
    expect((await pending).status).toBe(500);
    expect(await runFeedWrite(store, a, "autocurb_sync", async () => ({ status: 200, body: {} })))
      .toMatchObject({ status: 409, body: { error: "request_in_progress" } });
  });

  it("marks legacy writes deprecated and does not claim a receipt", async () => {
    const store = seeded();
    const out = await runFeedWrite(store, { ok: true, mode: "legacy", tenantId: TENANT_A }, "autocurb_sync", async () => ({ status: 200, body: { upserted: 0 } }));
    expect(out.headers).toEqual({ "X-AutoLabels-Auth-Deprecated": "legacy-shared-secret" });
    expect(store.state.receipts.size).toBe(0);
  });
});

describe("legacy mode", () => {
  const legacyInput = async (feed: LegacyFeed, over: Partial<AuthInput> = {}): Promise<AuthInput> => {
    const rawBody = JSON.stringify({ autocurb_tenant_id: "ac-a", vehicles: [] });
    const h: Record<string, string> = {};
    if (feed === "autofilm_feed") h["x-lookup-secret"] = "legacy-lookup";
    if (feed === "autocurb_sync") h["x-autocurb-signature"] = "sha256=" + (await hmacHex("legacy-sync", rawBody));
    if (feed === "dms_webhook") h["x-dms-signature"] = "sha256=" + (await hmacHex("legacy-vauto", rawBody));
    const claimedTenant: AuthInput["claimedTenant"] = feed === "autocurb_sync"
      ? { kind: "autocurb_tenant_id", value: "ac-a" } : { kind: "tenant_id", value: TENANT_A };
    return {
      feed, provider: feed === "dms_webhook" ? "vauto" : null, method: feed === "autofilm_feed" ? "GET" : "POST",
      pathAndQuery: "", rawBody, headers: headersOf(h), nowSeconds: NOW, claimedTenant, ...over,
    };
  };

  for (const feed of ["autofilm_feed", "autocurb_sync", "dms_webhook"] as LegacyFeed[]) {
    it(`allows ${feed} by default and refuses once the binding is rejected`, async () => {
      const store = seeded();
      expect(await authenticateLegacyFeed(await legacyInput(feed), store)).toMatchObject({ ok: true, mode: "legacy", tenantId: TENANT_A });
      store.state.rejected.push({ tenantId: TENANT_A, feed, provider: feed === "dms_webhook" ? "vauto" : null });
      expect(await authenticateLegacyFeed(await legacyInput(feed), store)).toEqual({ ok: false, status: 401, error: "legacy_auth_retired" });
    });
  }

  it("keeps the old error codes", async () => {
    const store = seeded();
    const bad = (feed: LegacyFeed) => legacyInput(feed, { headers: headersOf({ "x-lookup-secret": "wrong", "x-autocurb-signature": "sha256=00", "x-dms-signature": "sha256=00" }) });
    expect(await authenticateLegacyFeed(await bad("autofilm_feed"), store)).toEqual({ ok: false, status: 401, error: "unauthorized" });
    expect(await authenticateLegacyFeed(await bad("autocurb_sync"), store)).toEqual({ ok: false, status: 401, error: "invalid signature" });
    expect(await authenticateLegacyFeed(await bad("dms_webhook"), store)).toEqual({ ok: false, status: 401, error: "invalid signature" });
    store.state.legacySecrets = {};
    expect(await authenticateLegacyFeed(await legacyInput("autofilm_feed"), store)).toEqual({ ok: false, status: 503, error: "feed not enabled" });
    expect(await authenticateLegacyFeed(await legacyInput("autocurb_sync"), store)).toEqual({ ok: false, status: 500, error: "AUTOCURB_SYNC_SECRET not configured" });
    expect(await authenticateLegacyFeed(await legacyInput("dms_webhook"), store)).toEqual({ ok: false, status: 500, error: "DMS_SECRET_VAUTO not configured" });
  });

  it("accepts the x-autofilm-key alias", async () => {
    const r = await authenticateLegacyFeed(await legacyInput("autofilm_feed", { headers: headersOf({ "x-autofilm-key": "legacy-lookup" }) }), seeded());
    expect(r.ok).toBe(true);
  });
});

describe("documented worked example", () => {
  it("matches the signatures printed in docs/vehicle-history/04-legacy-feed-transition.md", async () => {
    const secret = "synthetic-example-secret-0001";
    const body = '{"vehicles":[{"vin":"1HGCM82633A004352","price":19999}]}';
    expect(await sign(secret, "1893456000", "lf_example_key_1", body))
      .toBe("v1=d9f9f5b21d8529a8b80c09407f82d34dff549cc2ccefd1ebf8400a26e575cc18");
    const target = canonicalGetTarget("/functions/v1/autofilm-feed", "?tenant_id=11111111-1111-4111-8111-111111111111&limit=100", "autofilm-feed");
    expect(target).toBe("/?limit=100&tenant_id=11111111-1111-4111-8111-111111111111");
    expect(await sign(secret, "1893456000", "lf_example_key_1", `GET ${target}`))
      .toBe("v1=4554078e9da32578c1ecd854e4f15ab1adba232b623673c6b298c787ca8584fd");
  });
});
