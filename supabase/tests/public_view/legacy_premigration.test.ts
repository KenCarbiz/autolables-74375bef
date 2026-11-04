// Deploy-order safety: the new legacy feed code running BEFORE its migration
// (20261109010000) exists. Existing shared-secret callers must keep working,
// a wrong secret must still fail, and an archived listing must still not be
// rewritten. Runs only in the WITH_FOUNDATION=0 database (no proposed SQL).
import assert from "node:assert/strict";
import postgres from "npm:postgres@3.4.9";

const BASE = Deno.env.get("PUBLIC_VIEW_URL") ?? "";
const DB = Deno.env.get("PUBLIC_VIEW_DB_URL") ?? "";
const opts = { sanitizeOps: false, sanitizeResources: false, ignore: !BASE || !DB || Deno.env.get("WITH_FOUNDATION") !== "0" };
const sql = DB ? postgres(DB, { max: 2, onnotice: () => {} }) : (null as unknown as ReturnType<typeof postgres>);
const T = "c0000000-0000-4000-8000-00000000000c";
const LIVE = "1FTFW1E50MFC00001";
const GONE = "1FTFW1E50MFC00002";

async function hmac(secret: string, raw: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return Array.from(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw))), (b) => b.toString(16).padStart(2, "0")).join("");
}
const row = async (vin: string) => (await sql`select status, price, archived_at from public.vehicle_listings where vin = ${vin}`)[0];

Deno.test({ name: "setup: one synthetic dealer, a live and an archived listing", ...opts, fn: async () => {
  await sql`insert into public.tenants (id, name, slug, autocurb_tenant_id) values (${T}, 'Synthetic Legacy Dealer', 'synthetic-legacy-dealer', 'ac-legacy-c') on conflict do nothing`;
  await sql`insert into public.vehicle_listings (tenant_id, store_id, vin, slug, ymm, price, status, published_at, archived_at, archive_reason, dealer_snapshot)
    values (${T}, ${T}, ${LIVE}, 'legacy-live', '2021 Ford F-150', 30000, 'published', now() - interval '9 days', null, null, '{}'),
           (${T}, ${T}, ${GONE}, 'legacy-gone', '2020 Ford F-150', 25000, 'archived', now() - interval '60 days', now() - interval '5 days', 'left_feed', '{}')
    on conflict do nothing`;
} });

Deno.test({ name: "autocurb-sync legacy push still applies to a live listing; archived is held, not rewritten", ...opts, fn: async () => {
  const raw = JSON.stringify({ autocurb_tenant_id: "ac-legacy-c", vehicles: [{ vin: LIVE, price: 30500 }, { vin: GONE, price: 1 }] });
  const res = await fetch(`${BASE}/functions/v1/autocurb-sync`, { method: "POST", headers: { "Content-Type": "application/json", "X-Autocurb-Signature": `sha256=${await hmac("synthetic-legacy-curb-secret", raw)}` }, body: raw });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(res.headers.get("x-autolabels-auth-deprecated"), "legacy-shared-secret");
  assert.equal(body.upserted, 1);
  assert.deepEqual((body.held as Array<{ vin: string }>).map((h) => h.vin), [GONE]);
  assert.equal(Number((await row(LIVE)).price), 30500);
  const gone = await row(GONE);
  assert.equal(gone.status, "archived");
  assert.equal(Number(gone.price), 25000);
} });

Deno.test({ name: "autocurb-sync with a wrong shared secret is still refused", ...opts, fn: async () => {
  const raw = JSON.stringify({ autocurb_tenant_id: "ac-legacy-c", vehicles: [{ vin: LIVE, price: 1 }] });
  const res = await fetch(`${BASE}/functions/v1/autocurb-sync`, { method: "POST", headers: { "Content-Type": "application/json", "X-Autocurb-Signature": `sha256=${await hmac("not-the-secret", raw)}` }, body: raw });
  assert.equal(res.status, 401);
  await res.body?.cancel();
  assert.equal(Number((await row(LIVE)).price), 30500);
} });

Deno.test({ name: "dms-webhook legacy push still applies", ...opts, fn: async () => {
  const raw = JSON.stringify({ vehicles: [{ vin: LIVE, price: 30900 }] });
  const res = await fetch(`${BASE}/functions/v1/dms-webhook?provider=generic`, { method: "POST", headers: { "Content-Type": "application/json", "X-Dms-Tenant": T, "X-Dms-Signature": `sha256=${await hmac("synthetic-legacy-generic-secret", raw)}` }, body: raw });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(Number((await row(LIVE)).price), 30900);
} });

Deno.test({ name: "autofilm-feed legacy lookup still answers with the live lot only", ...opts, fn: async () => {
  const res = await fetch(`${BASE}/functions/v1/autofilm-feed?tenant_id=${T}`, { headers: { "x-lookup-secret": "synthetic-legacy-lookup-secret" } });
  const body = await res.json();
  assert.equal(res.status, 200, JSON.stringify(body));
  const vins = (body.vehicles as Array<{ vin: string }>).map((v) => v.vin);
  assert.ok(vins.includes(LIVE));
  assert.ok(!vins.includes(GONE));
  const bad = await fetch(`${BASE}/functions/v1/autofilm-feed?tenant_id=${T}`, { headers: { "x-lookup-secret": "wrong" } });
  assert.equal(bad.status, 401);
  await bad.body?.cancel();
} });

Deno.test({ name: "close db", ...opts, fn: async () => { await sql.end(); } });
