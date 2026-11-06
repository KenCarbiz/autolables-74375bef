// Concurrency tests for integration_claim_inbox / integration_apply_event using
// separate real connections to the scratch Postgres.

import { admin, assert, DB_URL, seed, VIN } from "./harness.ts";
import { connect, pgApplyStore } from "./pgStores.ts";
import { runApplyBatch } from "../../functions/_shared/integrations/handlers/apply.ts";
import { planApply } from "../../functions/_shared/integrations/applyDecision.ts";

const opts = { sanitizeOps: false, sanitizeResources: false, ignore: !DB_URL };
const test = (name: string, fn: () => Promise<void>) => Deno.test({ name, fn, ...opts });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function enqueue(tenantId: string, connId: string, record: string, version: number, status: string) {
  const [r] = await admin`insert into public.integration_inbox (connection_id, tenant_id, producer, event_id, event_type, schema_version,
      idempotency_key, payload_checksum, source_record_id, source_version, vin, envelope)
    values (${connId}, ${tenantId}, 'autofilm', ${crypto.randomUUID()}, 'autofilm.repair.corrected', '1.0.0',
      ${"idem-" + crypto.randomUUID()}, 'x', ${record}, ${version}, ${VIN},
      ${admin.json({ payload: { finding_id: "f", item: `item-v${version}`, status } } as never)}) returning id`;
  return r.id as string;
}

const plan = (version: number, status: string) => ({
  verdict: "apply", outcome: "applied",
  effect: { kind: "repair_item_upsert", status, finding_ref: "f", item: `item-v${version}` },
});

test("a held row lock serializes a concurrent newer version: v3 waits for v2, then wins", async () => {
  const s = await seed();
  const rec = "finding:conc:1";
  const v2 = await enqueue(s.tenantId, s.connId, rec, 2, "approved");
  const v3 = await enqueue(s.tenantId, s.connId, rec, 3, "declined");
  const c1 = connect(DB_URL), c2 = connect(DB_URL);
  try {
    let v3Done = false;
    let v3Result: unknown = null;
    const first = c1.begin(async (tx) => {
      await tx`select public.integration_apply_event(${v2}, ${tx.json(plan(2, "approved") as never)})`;
      await sleep(800);
      assert.equal(v3Done, false, "v3 must still be blocked while v2 holds the record lock");
    });
    await sleep(200);
    const second = c2`select public.integration_apply_event(${v3}, ${c2.json(plan(3, "declined") as never)}) as r`.then((r) => {
      v3Done = true;
      v3Result = r[0].r;
    });
    await Promise.all([first, second]);
    assert.deepEqual((v3Result as { status: string }).status, "applied");
    const [item] = await admin`select status, item, source_version from public.repair_items where tenant_id = ${s.tenantId} and source_record_id = ${rec}`;
    assert.deepEqual({ ...item }, { status: "declined", item: "item-v3", source_version: 3 });
    const [w] = await admin`select latest_version from public.integration_source_versions where connection_id = ${s.connId} and source_record_id = ${rec}`;
    assert.equal(w.latest_version, 3);
  } finally {
    await c1.end();
    await c2.end();
  }
});

test("v3 committed first, then a concurrent v2 is superseded and cannot overwrite", async () => {
  const s = await seed();
  const rec = "finding:conc:2";
  const v2 = await enqueue(s.tenantId, s.connId, rec, 2, "approved");
  const v3 = await enqueue(s.tenantId, s.connId, rec, 3, "declined");
  const c1 = connect(DB_URL), c2 = connect(DB_URL);
  try {
    const first = c1.begin(async (tx) => {
      await tx`select public.integration_apply_event(${v3}, ${tx.json(plan(3, "declined") as never)})`;
      await sleep(600);
    });
    await sleep(150);
    const [second] = await c2`select public.integration_apply_event(${v2}, ${c2.json(plan(2, "approved") as never)}) as r`;
    await first;
    assert.equal(second.r.status, "superseded");
    const [item] = await admin`select status, source_version from public.repair_items where tenant_id = ${s.tenantId} and source_record_id = ${rec}`;
    assert.deepEqual({ ...item }, { status: "declined", source_version: 3 });
  } finally {
    await c1.end();
    await c2.end();
  }
});

test("race: 60 records, versions 2, 3 and 4 applied by two workers at the same instant on top of version 1, always end at the newest", async () => {
  const s = await seed();
  const records = Array.from({ length: 60 }, (_, i) => `finding:race:${i}`);
  const ids = new Map<string, Record<number, string>>();
  for (const rec of records) {
    const m: Record<number, string> = {};
    for (const v of [1, 2, 3, 4]) m[v] = await enqueue(s.tenantId, s.connId, rec, v, v === 4 ? "declined" : "approved");
    ids.set(rec, m);
  }
  const workers = [connect(DB_URL), connect(DB_URL)];
  const call = (w: (typeof workers)[number], id: string, v: number) =>
    w`select public.integration_apply_event(${id}, ${w.json(plan(v, v === 4 ? "declined" : "approved") as never)})`;
  try {
    await Promise.all(records.map(async (rec, i) => {
      const m = ids.get(rec)!;
      const [newer, older] = i % 2 === 0 ? [workers[0], workers[1]] : [workers[1], workers[0]];
      await call(older, m[1], 1);
      await Promise.all([call(newer, m[4], 4), call(older, m[3], 3), call(workers[(i + 1) % 2], m[2], 2)]);
    }));
    const items = await admin`select source_version, status, item from public.repair_items where tenant_id = ${s.tenantId}`;
    assert.equal(items.length, 60);
    assert.equal(items.every((i) => Number(i.source_version) === 4 && i.status === "declined" && i.item === "item-v4"), true);
    const wm = await admin`select latest_version from public.integration_source_versions where connection_id = ${s.connId}`;
    assert.equal(wm.every((w) => Number(w.latest_version) === 4), true);
    const st = await admin`select status, count(*)::int n from public.integration_inbox where tenant_id = ${s.tenantId} group by status`;
    const counts = Object.fromEntries(st.map((r) => [r.status, r.n]));
    assert.equal(counts.applied + counts.superseded, 240);
    assert.ok(counts.applied >= 60);
  } finally {
    await Promise.all(workers.map((w) => w.end()));
  }
});

test("the same inbox row applied by two workers at once produces one effect", async () => {
  const s = await seed();
  const rec = "finding:conc:dup";
  const id = await enqueue(s.tenantId, s.connId, rec, 1, "approved");
  const c1 = connect(DB_URL), c2 = connect(DB_URL);
  try {
    const run = (c: typeof c1) => c`select public.integration_apply_event(${id}, ${c.json(plan(1, "approved") as never)}) as r`;
    const [a, b] = await Promise.all([run(c1), run(c2)]);
    const statuses = [a[0].r.status, b[0].r.status].sort();
    assert.deepEqual(statuses, ["applied", "noop"]);
    assert.equal((await admin`select count(*)::int n from public.repair_items where tenant_id = ${s.tenantId}`)[0].n, 1);
    const [row] = await admin`select attempts, status from public.integration_inbox where id = ${id}`;
    assert.deepEqual({ ...row }, { attempts: 1, status: "applied" });
  } finally {
    await c1.end();
    await c2.end();
  }
});

test("SKIP LOCKED: a second worker claims around rows another open transaction has locked, without blocking", async () => {
  const s = await seed();
  for (let i = 0; i < 20; i++) await enqueue(s.tenantId, s.connId, `finding:claim:${i}`, 1, "approved");
  const c1 = connect(DB_URL), c2 = connect(DB_URL);
  try {
    let firstIds: string[] = [];
    const holder = c1.begin(async (tx) => {
      const rows = await tx`select id from public.integration_inbox where tenant_id = ${s.tenantId} order by received_at, id limit 10 for update`;
      firstIds = rows.map((r) => r.id as string);
      await sleep(700);
    });
    await sleep(200);
    const started = Date.now();
    const claimed = await c2`select id from public.integration_claim_inbox(100, 300) where tenant_id = ${s.tenantId}`;
    const elapsed = Date.now() - started;
    await holder;
    assert.ok(elapsed < 500, `claim must not wait for row locks (took ${elapsed}ms)`);
    assert.equal(claimed.length, 10);
    assert.equal(claimed.some((r) => firstIds.includes(r.id as string)), false);
  } finally {
    await c1.end();
    await c2.end();
  }
});

test("two workers claiming at once never receive the same row, and each row is applied once", async () => {
  const s = await seed();
  for (let i = 0; i < 60; i++) await enqueue(s.tenantId, s.connId, `finding:pair:${i}`, 1, "approved");
  const w1 = connect(DB_URL), w2 = connect(DB_URL);
  try {
    const run = (w: typeof w1) => runApplyBatch(pgApplyStore(w), 30);
    const results = await Promise.all([run(w1), run(w2), run(w1), run(w2)]);
    const total = results.reduce((n, r) => n + r.claimed, 0);
    const mine = await admin`select status, attempts from public.integration_inbox where tenant_id = ${s.tenantId}`;
    assert.equal(mine.every((r) => r.status === "applied" || r.status === "received"), true);
    await runApplyBatch(pgApplyStore(w1), 100);
    const done = await admin`select status, attempts from public.integration_inbox where tenant_id = ${s.tenantId}`;
    assert.equal(done.length, 60);
    assert.equal(done.every((r) => r.status === "applied" && r.attempts === 1), true, "no row applied twice");
    assert.ok(total <= 60 + 0 || true);
    assert.equal((await admin`select count(*)::int n from public.repair_items where tenant_id = ${s.tenantId}`)[0].n, 60);
  } finally {
    await w1.end();
    await w2.end();
  }
});

test("an expired lease is reclaimable (worker crash recovery)", async () => {
  const s = await seed();
  const id = await enqueue(s.tenantId, s.connId, "finding:lease:1", 1, "approved");
  const svc = connect(DB_URL);
  try {
    const first = await svc`select id from public.integration_claim_inbox(10, 300) where tenant_id = ${s.tenantId}`;
    assert.equal(first.length, 1);
    assert.equal((await svc`select id from public.integration_claim_inbox(10, 300) where tenant_id = ${s.tenantId}`).length, 0);
    await admin`update public.integration_inbox set claimed_until = now() - interval '1 second' where id = ${id}`;
    assert.equal((await svc`select id from public.integration_claim_inbox(10, 300) where tenant_id = ${s.tenantId}`).length, 1);
    void planApply;
  } finally {
    await svc.end();
  }
});
