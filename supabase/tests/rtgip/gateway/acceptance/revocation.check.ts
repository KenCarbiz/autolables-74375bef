/**
 * Section 6: mapping and connection revocation racing every Gateway RPC that relies on them.
 * Each RPC takes FOR SHARE on the mapping and connection rows, so a revocation and an admit / claim /
 * complete / record_uncommitted serialize: whichever commits first wins, and the loser sees it.
 */
import { receiptDigest, type ReceiptV2 } from "../../src/lib/gateway/rtgip2/receipt";
import type { DeliveryLease } from "../../src/lib/gateway/rtgip2/dispatcher.server";
import { checker, connection, openDb, setup, type Sql } from "./harness";

const sql = openDb();
const { check, report } = checker("section6_revocation_concurrency");

type Reserved = Awaited<ReturnType<Sql["reserve"]>>;
async function callOn(conn: Sql | Reserved, name: string, args: unknown[]): Promise<unknown> {
  const params = args.map((v) => (v && typeof v === "object" ? JSON.stringify(v) : v)) as (string | number | null)[];
  const casts = args.map((v, i) => `$${i + 1}${v && typeof v === "object" ? "::text::jsonb" : ""}`).join(",");
  return (await conn.unsafe(`SELECT public.${name}(${casts}) AS r`, params))[0]?.["r"];
}
async function waitsOnLock(fragment: string): Promise<boolean> {
  for (let i = 0; i < 40; i++) {
    const rows = await sql`SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock' AND query ILIKE ${`%${fragment}%`}`;
    if (rows.length) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}
const settledWithin = <T>(p: Promise<T>, ms: number) =>
  Promise.race([p.then(() => true, () => true), new Promise<boolean>((r) => setTimeout(() => r(false), ms))]);

try {
  const h = await setup(sql);
  let seq = 0;
  async function inflight(tag: string) {
    const ep = `rev-${tag}-${++seq}`;
    await h.addMapping("acc-instance", ep);
    const a = await h.admit(1, `rev-origin-${ep}`, "acc-instance", ep);
    const rows = await h.claim();
    const row = rows.find((r) => r["delivery_id"] !== undefined);
    if (!row) throw new Error(`no lease for ${ep}`);
    const l = h.lease(row, a);
    const inbox = await h.targetReceipt(l, "target_inbox", "applied", a.admission);
    const commit = await h.targetReceipt(l, "consumer_commit", "applied", inbox);
    return { ep, a, l, inbox, commit };
  }
  const completeArgs = async (l: DeliveryLease, inbox: ReceiptV2, commit: ReceiptV2) => [
    l.delivery_id, l.generation, l.token, inbox, await receiptDigest(inbox), commit, await receiptDigest(commit),
  ];
  const revokeSql = (ep: string) => `UPDATE gw_r2_mappings SET status='revoked' WHERE connection_id='${connection}' AND episode_id='${ep}'`;
  const state = async (id: string) => (await sql`SELECT state FROM gw_r2_dispatch WHERE delivery_id=${id}`)[0]!["state"];
  const receipts = async (id: string) => Number((await sql`SELECT count(*) n FROM gw_r2_receipts WHERE delivery_id=${id}`)[0]!["n"]);

  // 1. Revocation first: complete waits on the mapping lock, then refuses.
  {
    const d = await inflight("revoke-first");
    const rv = await sql.reserve();
    await rv.unsafe("BEGIN");
    await rv.unsafe(revokeSql(d.ep));
    const pending = callOn(sql, "gw_r2_complete", await completeArgs(d.l, d.inbox, d.commit));
    check("complete blocks behind an uncommitted mapping revocation", await waitsOnLock("gw_r2_complete"));
    check("complete has not returned while the revocation is open", !(await settledWithin(pending, 200)));
    await rv.unsafe("COMMIT");
    rv.release();
    check("complete after the revocation commits is forbidden", (await pending) === "forbidden");
    check("forbidden completion stores no target receipts", (await receipts(d.l.delivery_id)) === 1 && (await state(d.l.delivery_id)) === "leased");
  }

  // 2. Completion first: the revocation waits for it, and the commit stands.
  {
    const d = await inflight("complete-first");
    const cp = await sql.reserve();
    await cp.unsafe("BEGIN");
    const r = await callOn(cp, "gw_r2_complete", await completeArgs(d.l, d.inbox, d.commit));
    check("completion inside an open transaction commits", r === "committed");
    const rv = await sql.reserve();
    let blocked = false;
    try {
      await rv.unsafe("SET lock_timeout = '300ms'");
      await rv.unsafe(revokeSql(d.ep));
    } catch (e) {
      blocked = (e as { code?: string }).code === "55P03";
    }
    check("revocation cannot pass an in-flight completion", blocked);
    await cp.unsafe("COMMIT");
    cp.release();
    await rv.unsafe("SET lock_timeout = 0");
    await rv.unsafe(revokeSql(d.ep));
    rv.release();
    check("completion that won the race stays committed with its chain", (await state(d.l.delivery_id)) === "committed" && (await receipts(d.l.delivery_id)) === 3);
  }

  // 3. Revocation first against claim: the claimer waits, then skips the delivery.
  {
    const ep = `rev-claim-${++seq}`;
    await h.addMapping("acc-instance", ep);
    const a = await h.admit(1, `rev-origin-${ep}`, "acc-instance", ep);
    const rv = await sql.reserve();
    await rv.unsafe("BEGIN");
    await rv.unsafe(revokeSql(ep));
    const pending = h.claim("claim-racer");
    check("claim blocks behind an uncommitted mapping revocation", await waitsOnLock("gw_r2_claim"));
    await rv.unsafe("COMMIT");
    rv.release();
    const rows = await pending;
    const id = (await sql`SELECT delivery_id FROM gw_r2_admissions WHERE event_id=${a.envelope.event_id}::uuid`)[0]!["delivery_id"] as string;
    check("claim after the revocation does not lease the delivery", !rows.some((r) => r["delivery_id"] === id) && (await state(id)) === "pending");
  }

  // 4. Revocation first against admission: the admission waits, then refuses with no row.
  {
    const ep = `rev-admit-${++seq}`;
    await h.addMapping("acc-instance", ep);
    const rv = await sql.reserve();
    await rv.unsafe("BEGIN");
    await rv.unsafe(revokeSql(ep));
    const pending = h.admit(1, `rev-origin-${ep}`, "acc-instance", ep).then(() => "admitted", () => "refused");
    check("admission blocks behind an uncommitted mapping revocation", await waitsOnLock("gw_r2_admit"));
    await rv.unsafe("COMMIT");
    rv.release();
    check("admission after the revocation commits is refused", (await pending) === "refused");
    check(
      "refused admission leaves no admission and no nonce",
      Number((await sql`SELECT count(*) n FROM gw_r2_admissions WHERE envelope#>>'{vehicle,episode_id}'=${ep}`)[0]!["n"]) === 0,
    );
  }

  // 5. Revocation first against uncommitted evidence (GW-F1).
  {
    const d = await inflight("uncommitted");
    const held = await h.targetReceipt(d.l, "target_inbox", "held", d.a.admission);
    const rv = await sql.reserve();
    await rv.unsafe("BEGIN");
    await rv.unsafe(revokeSql(d.ep));
    const pending = callOn(sql, "gw_r2_record_uncommitted", [d.l.delivery_id, d.l.generation, d.l.token, held, await receiptDigest(held)]);
    check("held evidence blocks behind an uncommitted revocation", await waitsOnLock("gw_r2_record_uncommitted"));
    await rv.unsafe("COMMIT");
    rv.release();
    check("held evidence after the revocation is forbidden", (await pending) === "forbidden");
  }

  // 6. Unsynchronized races: whichever wins, the result is all-or-nothing.
  {
    let committed = 0;
    let forbidden = 0;
    for (let i = 0; i < 12; i++) {
      const d = await inflight("race");
      const args = await completeArgs(d.l, d.inbox, d.commit);
      const jitter = () => new Promise((res) => setTimeout(res, Math.floor(Math.random() * 6)));
      // Alternate which side starts first, with jitter, so both outcomes occur.
      const [r] =
        i % 2 === 0
          ? await Promise.all([callOn(sql, "gw_r2_complete", args), jitter().then(() => sql.unsafe(revokeSql(d.ep)))])
          : await Promise.all([jitter().then(() => callOn(sql, "gw_r2_complete", args)), sql.unsafe(revokeSql(d.ep))]);
      const n = await receipts(d.l.delivery_id);
      const s = await state(d.l.delivery_id);
      if (r === "committed") {
        committed++;
        check(`race ${i}: commit carries the whole chain`, n === 3 && s === "committed");
      } else {
        forbidden++;
        check(`race ${i}: refusal stores nothing`, r === "forbidden" && n === 1 && s === "leased");
      }
    }
    check("12 unsynchronized races resolved without error", committed + forbidden === 12);
    console.log(JSON.stringify({ races: 12, committed, forbidden }));
  }

  // 7. Connection revocation (last: it stops every delivery on the connection).
  {
    const d = await inflight("connection");
    const rv = await sql.reserve();
    await rv.unsafe("BEGIN");
    await rv.unsafe(`UPDATE gw_r2_connections SET status='revoked' WHERE id='${connection}'`);
    const pending = callOn(sql, "gw_r2_complete", await completeArgs(d.l, d.inbox, d.commit));
    check("complete blocks behind an uncommitted connection revocation", await waitsOnLock("gw_r2_complete"));
    await rv.unsafe("COMMIT");
    rv.release();
    check("complete after connection revocation is forbidden", (await pending) === "forbidden");
    check("no delivery on the revoked connection can be claimed", (await h.claim("post-revoke")).length === 0);
  }
  report();
} finally {
  await sql.end();
}
