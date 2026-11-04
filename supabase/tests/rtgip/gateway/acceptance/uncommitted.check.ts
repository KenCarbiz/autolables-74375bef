/** GW-F1: held and quarantined target outcomes are recorded as evidence and do not burn the retry budget. */
import { dispatcherStep, type DeliveryLease } from "../../src/lib/gateway/rtgip2/dispatcher.server";
import type { ReceiptV2 } from "../../src/lib/gateway/rtgip2/receipt";
import { checker, now, openDb, TENANT } from "./harness";
import { setup } from "./harness";

const sql = openDb();
const { check, report } = checker("gw_f1_uncommitted");
try {
  const h = await setup(sql);
  const step = (l: DeliveryLease, send: () => Promise<unknown[]>, record = true) =>
    dispatcherStep(
      "acc-worker",
      {
        registry: async () => h.registry,
        now,
        claim: async () => [l],
        gatewayKey: async () => h.gateway,
        nonce: () => `acc_fwd_${crypto.randomUUID()}`,
        send,
        complete: h.store.complete,
        fail: h.store.fail,
        ...(record ? { recordUncommitted: h.store.recordUncommitted } : {}),
      },
      true,
    );
  const dispatch = async (id: string) => (await sql`SELECT * FROM gw_r2_dispatch WHERE delivery_id=${id}`)[0]!;
  const due = (id: string) =>
    sql`UPDATE gw_r2_dispatch SET lease_until=clock_timestamp()-interval '1 second',next_attempt_at=clock_timestamp()-interval '1 second' WHERE delivery_id=${id}`;

  // Held, then committed once the predecessor arrives.
  const a1 = await h.admit(1);
  const [row1] = await h.claim();
  check("first delivery leased", !!row1);
  const l1 = h.lease(row1!, a1);
  const held = await h.targetReceipt(l1, "target_inbox", "held", a1.admission);
  check("held inbox recorded", (await step(l1, async () => [held]))[0] === "held");
  let d = await dispatch(l1.delivery_id);
  check("held parks the delivery as target_persisted", d["state"] === "target_persisted" && d["token"] === null);
  check("held charges no attempt", Number(d["attempts"]) === 0);
  check(
    "held evidence stored once",
    Number((await sql`SELECT count(*) n FROM gw_r2_uncommitted_receipts WHERE delivery_id=${l1.delivery_id} AND outcome='held'`)[0]!["n"]) === 1,
  );
  check("held audited", Number((await sql`SELECT count(*) n FROM gw_r2_audit WHERE delivery_id=${l1.delivery_id} AND action='held'`)[0]!["n"]) === 1);
  check("held lease is fenced afterwards", (await h.store.recordUncommitted(l1, held)) === "lost_lease");
  check("held delivery is not reclaimed before its backoff", (await h.claim()).length === 0);
  const a2 = await h.admit(2);
  await due(l1.delivery_id);
  const reclaimed = await h.claim();
  check("held delivery blocks its lane: only it is reclaimed", reclaimed.length === 1 && reclaimed[0]!["delivery_id"] === l1.delivery_id);
  const l1b = h.lease(reclaimed[0]!, a1);
  check("reclaim advances the generation", l1b.generation === l1.generation + 1);
  const inbox = await h.targetReceipt(l1b, "target_inbox", "applied", a1.admission);
  const commit = await h.targetReceipt(l1b, "consumer_commit", "applied", inbox);
  check("held delivery later commits", (await step(l1b, async () => [inbox, commit]))[0] === "committed");
  check(
    "committed chain is one receipt per stage",
    Number((await sql`SELECT count(*) n FROM gw_r2_receipts WHERE delivery_id=${l1.delivery_id}`)[0]!["n"]) === 3,
  );

  // Quarantined, then redriven by an admin with a case reference.
  const [row2] = await h.claim();
  check("successor leased after the held head committed", row2?.["delivery_id"] !== undefined && row2["delivery_id"] !== l1.delivery_id);
  const l2 = h.lease(row2!, a2);
  const quarantined = await h.targetReceipt(l2, "target_inbox", "quarantined", a2.admission);
  check("quarantined inbox recorded", (await step(l2, async () => [quarantined]))[0] === "quarantined");
  d = await dispatch(l2.delivery_id);
  check("quarantine is terminal until redrive", d["state"] === "quarantined" && d["last_reason"] === "target_quarantined");
  check("quarantine replay is an exact retry", (await h.store.recordUncommitted(l2, quarantined)) === "exact_retry");
  const other: ReceiptV2 = await h.targetReceipt(l2, "target_inbox", "held", a2.admission);
  check("different evidence on a quarantined delivery conflicts", (await h.store.recordUncommitted(l2, other)) === "conflict");
  check("quarantined delivery is not claimed", (await h.claim()).length === 0);
  const actor = crypto.randomUUID();
  await sql`INSERT INTO gw_tenant_members(user_id,tenant_id,role) VALUES(${actor},${TENANT},'admin')`;
  await sql.begin(async (tx) => {
    await tx`SELECT set_config('request.jwt.claims',${JSON.stringify({ sub: actor, role: "authenticated" })},true)`;
    await tx.unsafe("SET LOCAL ROLE authenticated");
    await tx`SELECT gw_r2_redrive(${l2.delivery_id},'CASE-ACC-1')`;
  });
  const [row3] = await h.claim();
  check("redriven delivery is claimable", row3?.["delivery_id"] === l2.delivery_id);
  const l2b = h.lease(row3!, a2);
  const inbox2 = await h.targetReceipt(l2b, "target_inbox", "applied", a2.admission);
  const commit2 = await h.targetReceipt(l2b, "consumer_commit", "applied", inbox2);
  check("redriven delivery commits after quarantine", (await step(l2b, async () => [inbox2, commit2]))[0] === "committed");
  check(
    "quarantine evidence survives the later commit",
    Number((await sql`SELECT count(*) n FROM gw_r2_uncommitted_receipts WHERE delivery_id=${l2.delivery_id}`)[0]!["n"]) === 1,
  );

  // Refusals.
  const a3 = await h.admit(3);
  const [row4] = await h.claim();
  const l3 = h.lease(row4!, a3);
  const q3 = await h.targetReceipt(l3, "target_inbox", "quarantined", a3.admission);
  const c3 = await h.targetReceipt(l3, "consumer_commit", "applied", q3);
  check("a commit paired with a quarantined inbox is not completed", (await step(l3, async () => [q3, c3]))[0] === "retry");
  await due(l3.delivery_id);
  const l3b = h.lease((await h.claim())[0]!, a3);
  const applied = await h.targetReceipt(l3b, "target_inbox", "applied", a3.admission);
  check("an applied inbox cannot be recorded as uncommitted", (await h.store.recordUncommitted(l3b, applied)) === "invalid_chain");
  const qWrongPrev = await h.targetReceipt(l3b, "target_inbox", "quarantined", applied);
  check("uncommitted evidence must chain to the admission", (await h.store.recordUncommitted(l3b, qWrongPrev)) === "invalid_chain");
  check(
    "without the GW-F1 port a lone inbox still retries",
    (await step(l3b, async () => [await h.targetReceipt(l3b, "target_inbox", "held", a3.admission)], false))[0] === "retry",
  );
  check(
    "browser cannot record uncommitted evidence",
    !(await sql`SELECT has_function_privilege('authenticated','gw_r2_record_uncommitted(text,bigint,uuid,jsonb,text)','execute') ok`)[0]!["ok"],
  );
  let immutable = false;
  try {
    await sql`DELETE FROM gw_r2_uncommitted_receipts`;
  } catch {
    immutable = true;
  }
  check("uncommitted evidence is append-only", immutable);
  report();
} finally {
  await sql.end();
}
