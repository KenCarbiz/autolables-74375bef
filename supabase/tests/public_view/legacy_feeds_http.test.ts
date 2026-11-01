// The three legacy feed functions, run from their real source against the
// scratch database: tenant scoping, freshness, idempotent retries and the
// archived-listing hold.
import assert from "node:assert/strict";
import postgres from "npm:postgres@3.4.9";
import { sign } from "../../functions/_shared/integrations/signing.ts";
import { canonicalGetTarget } from "../../functions/_shared/legacyFeeds/auth.ts";

const BASE = Deno.env.get("PUBLIC_VIEW_URL") ?? "";
const DB = Deno.env.get("PUBLIC_VIEW_DB_URL") ?? "";
const opts = { sanitizeOps: false, sanitizeResources: false, ignore: !BASE || !DB || Deno.env.get("WITH_FOUNDATION") === "0" };
const sql = DB ? postgres(DB, { max: 2, onnotice: () => {} }) : (null as unknown as ReturnType<typeof postgres>);
const A = "a0000000-0000-4000-8000-00000000000a";
const B = "b0000000-0000-4000-8000-00000000000b";
const now = () => Math.floor(Date.now() / 1000);

async function signedPost(fn: string, keyId: string, secret: string, body: unknown, extra: Record<string, string> = {}, ts = now()) {
  const raw = JSON.stringify(body);
  return fetch(`${BASE}/functions/v1/${fn}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json", "X-Rooftop-Key-Id": keyId, "X-Rooftop-Timestamp": String(ts),
      "X-Rooftop-Signature": await sign(secret, ts, keyId, raw), ...extra,
    },
    body: raw,
  });
}
const curb = (body: unknown, extra: Record<string, string> = {}, ts?: number) =>
  signedPost("autocurb-sync", "key_a_curb", "synthetic-secret-a-curb", body, extra, ts);
const listing = async (vin: string) => (await sql`select tenant_id, status, price, updated_at from public.vehicle_listings where vin = ${vin}`)[0];

Deno.test({ name: "autocurb-sync: dealer A's key naming dealer B is refused and B is untouched", ...opts, fn: async () => {
  const before = await listing("1FTFW1E50MFB00001");
  const res = await curb({ autocurb_tenant_id: "ac-dealer-b", vehicles: [{ vin: "1FTFW1E50MFB00001", price: 1 }] }, { "Idempotency-Key": "x-tenant-1" });
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error, "tenant_mismatch");
  const after = await listing("1FTFW1E50MFB00001");
  assert.equal(after.price, before.price);
  assert.deepEqual(after.updated_at, before.updated_at);
} });

Deno.test({ name: "autocurb-sync: a retried legitimate push is acknowledged once, with no second write", ...opts, fn: async () => {
  const body = { autocurb_tenant_id: "ac-dealer-a", vehicles: [{ vin: "1FTFW1E50MFA00001", price: 29500 }] };
  const first = await curb(body, { "Idempotency-Key": "push-0001" });
  assert.equal(first.status, 200, await first.clone().text());
  const firstBody = await first.json();
  assert.equal(firstBody.upserted, 1, JSON.stringify(firstBody));
  const written = await listing("1FTFW1E50MFA00001");
  assert.equal(Number(written.price), 29500);
  await sql`update public.vehicle_listings set price = 31000 where vin = '1FTFW1E50MFA00001'`;
  const retry = await curb(body, { "Idempotency-Key": "push-0001" }, now() + 2);
  assert.equal(retry.status, 200);
  assert.equal(retry.headers.get("idempotent-replay"), "true");
  assert.equal((await retry.json()).upserted, 1);
  assert.equal(Number((await listing("1FTFW1E50MFA00001")).price), 31000, "the replay must not write the old price again");
} });

Deno.test({ name: "autocurb-sync: a stale signed request is rejected before any read", ...opts, fn: async () => {
  const res = await curb({ autocurb_tenant_id: "ac-dealer-a", vehicles: [{ vin: "1FTFW1E50MFA00001", price: 1 }] }, { "Idempotency-Key": "stale-1" }, now() - 600);
  assert.equal(res.status, 401);
  assert.notEqual(Number((await listing("1FTFW1E50MFA00001")).price), 1);
} });

Deno.test({ name: "autocurb-sync: an archived listing is held for review, not updated or reactivated", ...opts, fn: async () => {
  const before = await listing("1FTFW1E50MFA00002");
  const res = await curb({ autocurb_tenant_id: "ac-dealer-a", vehicles: [{ vin: "1FTFW1E50MFA00002", price: 99 }] }, { "Idempotency-Key": "arch-1" });
  assert.equal(res.status, 200, await res.clone().text());
  const body = await res.json();
  assert.equal(body.upserted, 0);
  assert.equal(body.held.length, 1);
  assert.equal(body.held[0].reason, "archived_listing_requires_review");
  const after = await listing("1FTFW1E50MFA00002");
  assert.equal(after.status, "archived");
  assert.equal(after.price, before.price);
  const reviews = await sql`select status, detected_source from public.vehicle_reappearance_reviews where tenant_id = ${A} and vin = '1FTFW1E50MFA00002'`;
  assert.equal(reviews.length, 1, JSON.stringify(body));
  assert.equal(reviews[0].status, "open");
} });

Deno.test({ name: "autocurb-sync: legacy shared-secret callers keep working until the dealer is cut over", ...opts, fn: async () => {
  const raw = JSON.stringify({ autocurb_tenant_id: "ac-dealer-a", vehicles: [] });
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("synthetic-legacy-curb-secret"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw))), (b) => b.toString(16).padStart(2, "0")).join("");
  const send = () => fetch(`${BASE}/functions/v1/autocurb-sync`, { method: "POST", headers: { "Content-Type": "application/json", "X-Autocurb-Signature": `sha256=${mac}` }, body: raw });
  const ok = await send();
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("x-autolabels-auth-deprecated"), "legacy-shared-secret");
  await ok.body?.cancel();
  await sql`update public.legacy_feed_bindings set legacy_unsigned = 'rejected' where tenant_id = ${A} and feed = 'autocurb_sync'`;
  try {
    const refused = await send();
    assert.equal(refused.status, 401);
    assert.equal((await refused.json()).error, "legacy_auth_retired");
  } finally {
    await sql`update public.legacy_feed_bindings set legacy_unsigned = 'allowed' where tenant_id = ${A} and feed = 'autocurb_sync'`;
  }
} });

Deno.test({ name: "dms-webhook: dealer A's key cannot write into dealer B named in X-Dms-Tenant", ...opts, fn: async () => {
  const res = await signedPost("dms-webhook?provider=vauto", "key_a_dms", "synthetic-secret-a-dms",
    { vehicles: [{ vin: "1FTFW1E50MFB00001", price: 2 }] }, { "X-Dms-Tenant": B, "Idempotency-Key": "dms-x-1" });
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error, "tenant_mismatch");
  assert.equal(Number((await listing("1FTFW1E50MFB00001")).price), 45000);
} });

Deno.test({ name: "autofilm-feed: dealer A's key reads A's live lot only, and cannot read B", ...opts, fn: async () => {
  const get = async (tenant: string) => {
    const url = new URL(`${BASE}/functions/v1/autofilm-feed?tenant_id=${tenant}`);
    const ts = now();
    const target = canonicalGetTarget(url.pathname, url.search, "autofilm-feed");
    return fetch(url, { headers: { "X-Rooftop-Key-Id": "key_a_film", "X-Rooftop-Timestamp": String(ts), "X-Rooftop-Signature": await sign("synthetic-secret-a-film", ts, "key_a_film", `GET ${target}`) } });
  };
  const other = await get(B);
  assert.equal(other.status, 403);
  await other.body?.cancel();
  const own = await get(A);
  assert.equal(own.status, 200);
  const vins = ((await own.json()).vehicles as Array<{ vin: string }>).map((v) => v.vin);
  assert.ok(vins.includes("1FTFW1E50MFA00001"));
  assert.ok(!vins.includes("1FTFW1E50MFA00002"), "archived listing is not current inventory");
  assert.ok(!vins.includes("1FTFW1E50MFB00001"));
} });

Deno.test({ name: "close db", ...opts, fn: async () => { await sql.end(); } });
