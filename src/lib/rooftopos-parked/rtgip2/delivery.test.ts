// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  canonicalize,
  sealEnvelope,
  type AppId,
  type EnvelopeV2,
  type EventType,
} from "./protocol.ts";
import {
  backoffSeconds,
  MemoryInbox,
  MemoryOutbox,
  reconcile,
  RETRY,
  type OutboxRow,
  type ReceiptQueryPort,
  type Transport,
} from "./delivery.ts";
import {
  makeTarget,
  queryPort,
  ReferenceGatewayStandIn,
  signAdmission,
  sourceTransport,
  type TargetEndpoint,
} from "./harness.ts";
import { connId, draftEnvelope, keyOf, syntheticRegistry, T0 } from "./fixtures.ts";
import { receiptDraft, signReceiptV2 } from "./receipt-v2.ts";

const CONN = connId("autolabels", "autocurb");

type Proj = { statuses: Record<string, string[]> };
const effect = (p: Proj, e: EnvelopeV2) => {
  if (e.vehicle.episode_id === "ep-unknown")
    return { ok: false as const, reason: "unknown_episode" };
  (p.statuses[e.aggregate.id] ??= []).push(
    `${e.aggregate.revision}:${String(e.payload["status"] ?? e.event_type)}`,
  );
  return { ok: true as const };
};

function world(
  opts: {
    crash?: () => boolean;
    crashBeforeReceipts?: () => boolean;
    dropAck?: () => boolean;
    forward?: "inline" | "deferred";
  } = {},
) {
  const reg = syntheticRegistry();
  const inbox = new MemoryInbox<Proj>("autocurb", { statuses: {} }, effect, {
    registry: reg,
    key: keyOf(reg, "ac-dev-1"),
  });
  const target = makeTarget("autocurb", inbox, reg, undefined, {
    crashAfterEffect: opts.crash,
    crashBeforeReceipts: opts.crashBeforeReceipts,
    dropAck: opts.dropAck,
  });
  const targets = new Map<AppId, TargetEndpoint>([["autocurb", target]]);
  const gw = new ReferenceGatewayStandIn(reg, keyOf(reg, "gw-dev-1"), targets, {
    forward: opts.forward,
  });
  const outbox = new MemoryOutbox<{ n: number }>({ n: 0 }, reg);
  const clock = { now: T0 };
  const transport = sourceTransport(gw, keyOf(reg, "al-dev-1"), clock);
  const query = queryPort(gw, keyOf(reg, "al-dev-1"), clock);
  return { reg, inbox, gw, outbox, transport, query, clock };
}
type World = ReturnType<typeof world>;

const ev = (rev: number, status = "frontline", type: EventType = "inventory.status_changed") =>
  sealEnvelope(
    draftEnvelope("autolabels", "autocurb", type, {
      aggregate: {
        domain: "inventory",
        type: "episode",
        id: "episode-syn-1",
        revision: rev,
        prev_revision: rev > 1 ? rev - 1 : null,
      },
      payload: { status, stock_number: "SYN1001", changed_at: "2027-01-15T15:00:00Z" },
    }),
  );

/** One worker pass: deliver or confirm whatever is due, as the lease action says. */
async function pump(
  w: World,
  worker = "w1",
  transport: Transport = w.transport,
  query: ReceiptQueryPort = w.query,
) {
  for (const r of w.outbox.claim(worker, w.clock.now, 50)) {
    if (r.lease_action === "confirm")
      await w.outbox.confirm(r, worker, r.lease_generation, query, w.reg, w.clock.now, () => 0);
    else
      await w.outbox.deliver(r, worker, r.lease_generation, transport, w.reg, w.clock.now, () => 0);
  }
}
/** deliver, then confirm: the two steps a healthy row needs. */
async function drive(w: World, rounds = 2) {
  for (let k = 0; k < rounds; k++) {
    await pump(w);
    w.clock.now += RETRY.baseSec;
  }
}
const enqueueOne = async (w: World, sealed: Awaited<ReturnType<typeof ev>>) =>
  w.outbox.transaction(async (_s, enqueue) => {
    await enqueue(sealed.envelope, sealed.body);
  });
const chainOf = (w: World, id: string) =>
  [...w.gw.admissions.values()].find((a) => a.envelope.event_id === id)!.chain;

describe("transactional outbox", () => {
  it("commits the business change and the event together, or neither", async () => {
    const w = world();
    const { envelope, body } = await ev(1);
    await expect(
      w.outbox.transaction(async (s, enqueue) => {
        s.n = 1;
        await enqueue(envelope, body);
        throw new Error("business_rule_failed");
      }),
    ).rejects.toThrow();
    expect(w.outbox.state.n).toBe(0);
    expect(w.outbox.rows.size).toBe(0);
    await w.outbox.transaction(async (s, enqueue) => {
      s.n = 1;
      await enqueue(envelope, body);
    });
    expect(w.outbox.state.n).toBe(1);
    const row = w.outbox.rows.get(envelope.event_id)!;
    expect(row.state).toBe("pending");
    expect(row.connection_id).toBe(CONN);
    expect(row.lease_generation).toBe(0);
    expect(row.delivery_id).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is idempotent for identical bytes and refuses a conflicting event id", async () => {
    const w = world();
    const a = await ev(1);
    await w.outbox.transaction(async (_s, enqueue) => {
      await enqueue(a.envelope, a.body);
      await enqueue(a.envelope, a.body);
    });
    expect(w.outbox.rows.size).toBe(1);
    const b = await sealEnvelope({
      ...draftEnvelope("autolabels", "autocurb", "inventory.status_changed", {
        origin: a.envelope.origin,
      }),
      payload: { status: "sold", stock_number: "SYN1001", changed_at: "2027-01-15T15:00:00Z" },
    });
    await expect(
      w.outbox.transaction(async (_s, enqueue) => {
        await enqueue(b.envelope, b.body);
      }),
    ).rejects.toThrow("event_id_conflict");
  });

  it("refuses an event no producer-enabled connection covers", async () => {
    const w = world();
    const a = await sealEnvelope(
      draftEnvelope("autolabels", "autocurb", "inventory.status_changed", {
        rooftop_id: "rf-unknown",
      }),
    );
    await expect(enqueueOne(w, a)).rejects.toThrow("no_connection_for_event");
  });
});

describe("acknowledgment levels (two-step advance)", () => {
  it("admits first, then commits only after the full verified chain is fetched", async () => {
    const w = world();
    const a = await ev(1);
    await enqueueOne(w, a);
    await pump(w);
    const row = w.outbox.rows.get(a.envelope.event_id)!;
    expect(row.state).toBe("gateway_admitted");
    expect(row.receipts.map((r) => r.kind)).toEqual(["gateway_admission"]);
    expect(row.lease_owner).toBeNull();
    expect(row.next_attempt_at).toBe(T0 + RETRY.baseSec);
    w.clock.now += RETRY.baseSec;
    const [due] = w.outbox.claim("w1", w.clock.now, 5);
    expect(due!.lease_action).toBe("confirm");
    await w.outbox.confirm(due!, "w1", due!.lease_generation, w.query, w.reg, w.clock.now, () => 0);
    expect(row.state).toBe("consumer_committed");
    expect(row.receipts.map((r) => r.kind)).toEqual([
      "gateway_admission",
      "target_inbox",
      "consumer_commit",
    ]);
    expect(w.inbox.projection.statuses["episode-syn-1"]).toEqual(["1:frontline"]);
  });

  it("re-POSTing an admitted event returns the byte-identical admission receipt, stored once", async () => {
    const w = world();
    const a = await ev(1);
    await enqueueOne(w, a);
    const row = w.outbox.rows.get(a.envelope.event_id)!;
    const first = await w.transport(row);
    w.clock.now += 30;
    const second = await w.transport(row);
    expect(canonicalize(second.admission)).toBe(canonicalize(first.admission));
    expect(w.gw.admissions.size).toBe(1);
    await pump(w);
    expect(row.receipts).toHaveLength(1);
    expect(canonicalize(row.receipts[0])).toBe(canonicalize(first.admission));
  });

  it("does not treat HTTP 200 without an admission receipt as admitted", async () => {
    const w = world();
    const a = await ev(1);
    await enqueueOne(w, a);
    await pump(w, "w1", async () => ({ http_status: 200 }));
    const row = w.outbox.rows.get(a.envelope.event_id)!;
    expect(row.state).toBe("retry_wait");
    expect(row.last_error).toBe("ack_missing");
    expect(row.receipts).toEqual([]);
  });

  it("refuses an admission receipt for another delivery", async () => {
    const w = world();
    const [a, b] = await Promise.all([ev(1), ev(2, "sold")]);
    await enqueueOne(w, a);
    const other = await signAdmission(b.envelope, CONN, keyOf(w.reg, "gw-dev-1"), T0);
    await pump(w, "w1", async () => ({ http_status: 200, admission: other }));
    expect(w.outbox.rows.get(a.envelope.event_id)!.last_error).toBe("ack_wrong_event_id");
  });

  it("a lost target ACK leaves the row admitted; the Gateway re-forwards and the same receipts come back", async () => {
    let drop = true;
    const w = world({ dropAck: () => drop });
    const a = await ev(1);
    await enqueueOne(w, a);
    await drive(w);
    const row = w.outbox.rows.get(a.envelope.event_id)!;
    expect(row.state).toBe("gateway_admitted");
    expect(row.last_error).toBe("target_inbox_pending");
    expect(w.inbox.effectsApplied.get(a.envelope.event_id)).toBe(1);
    drop = false;
    await w.gw.forwardPending(w.clock.now);
    w.clock.now = row.next_attempt_at;
    await pump(w);
    expect(row.state).toBe("consumer_committed");
    expect(row.receipts[1]!.outcome).toBe("applied");
    expect(row.receipts[2]!.outcome).toBe("applied");
    expect(w.inbox.effectsApplied.get(a.envelope.event_id)).toBe(1);
  });

  it("rejects a forged receipt in the fetched chain", async () => {
    const w = world();
    const a = await ev(1);
    await enqueueOne(w, a);
    const forging: ReceiptQueryPort = async (d, e) =>
      (await w.query(d, e)).map((x) =>
        x.kind === "consumer_commit" ? { ...x, signature: "0".repeat(64) } : x,
      );
    await pump(w);
    w.clock.now += RETRY.baseSec;
    await pump(w, "w1", w.transport, forging);
    const row = w.outbox.rows.get(a.envelope.event_id)!;
    expect(row.state).toBe("gateway_admitted");
    expect(row.last_error).toBe("ack_bad_signature");
  });

  it("refuses a chain whose first receipt is not the stored admission", async () => {
    const w = world();
    const a = await ev(1);
    await enqueueOne(w, a);
    await pump(w);
    const row = w.outbox.rows.get(a.envelope.event_id)!;
    const alt = await signReceiptV2(
      await receiptDraft(
        {
          envelope: a.envelope,
          connection_id: CONN,
          delivery_id: row.delivery_id,
          kind: "gateway_admission",
        },
        "admitted",
        T0 + 1,
        null,
      ),
      keyOf(w.reg, "gw-dev-1"),
    );
    row.receipts = [alt];
    w.clock.now += RETRY.baseSec;
    await pump(w);
    expect(row.state).toBe("gateway_admitted");
    expect(row.last_error).toBe("ack_admission_mismatch");
  });

  it("a quarantined inbox receipt ends the row as target_quarantined with no commit receipt", async () => {
    const w = world();
    const bad = await sealEnvelope({
      ...draftEnvelope("autolabels", "autocurb", "inventory.status_changed"),
      vehicle: { vin: "1HGCM82633A004352", instance_id: "inst-syn-0001", episode_id: "ep-unknown" },
    });
    await enqueueOne(w, bad);
    await drive(w);
    const row = w.outbox.rows.get(bad.envelope.event_id)!;
    expect(row.state).toBe("target_quarantined");
    expect(row.receipts.map((r) => `${r.kind}:${r.outcome}`)).toEqual([
      "gateway_admission:admitted",
      "target_inbox:quarantined",
    ]);
  });

  it("a held inbox receipt keeps the row admitted, backs off, and dead-letters only on attempts", async () => {
    const w = world();
    const r2 = await ev(2, "sold");
    await enqueueOne(w, r2);
    await pump(w);
    const row = w.outbox.rows.get(r2.envelope.event_id)!;
    expect(chainOf(w, r2.envelope.event_id).map((x) => x.outcome)).toEqual(["admitted", "held"]);
    for (let k = 0; k < RETRY.maxAttempts + 2 && (row.state as string) !== "dead_letter"; k++) {
      w.clock.now += RETRY.capSec + 1;
      await pump(w);
      if ((row.state as string) !== "dead_letter") {
        expect(row.state).toBe("gateway_admitted");
        expect(row.last_error).toBe("target_held_awaiting_predecessor");
      }
    }
    expect(row.state).toBe("dead_letter");
    expect(row.attempts).toBe(RETRY.maxAttempts);
    expect(row.receipts.map((x) => x.kind)).toEqual(["gateway_admission"]);
  });

  it("a held event released by its predecessor commits through a duplicate inbox receipt", async () => {
    const w = world();
    const [r1, r2] = await Promise.all([ev(1, "in_recon"), ev(2, "sold")]);
    await enqueueOne(w, r2);
    await drive(w);
    await enqueueOne(w, r1);
    await drive(w);
    await w.gw.forwardPending(w.clock.now);
    w.clock.now += RETRY.capSec + 1;
    await pump(w);
    const row2 = w.outbox.rows.get(r2.envelope.event_id)!;
    expect(row2.state).toBe("consumer_committed");
    expect(row2.receipts.map((x) => `${x.kind}:${x.outcome}`)).toEqual([
      "gateway_admission:admitted",
      "target_inbox:duplicate",
      "consumer_commit:applied",
    ]);
    expect(w.inbox.projection.statuses["episode-syn-1"]).toEqual(["1:in_recon", "2:sold"]);
    expect(w.inbox.effectsApplied.get(r2.envelope.event_id)).toBe(1);
  });
});

describe("lease-generation fencing", () => {
  it("a late advance or fail from a worker whose lease was re-claimed is refused; the new holder's result stands", async () => {
    const w = world();
    const a = await ev(1);
    await enqueueOne(w, a);
    const [claimedA] = w.outbox.claim("wA", w.clock.now, 1);
    const genA = claimedA!.lease_generation;
    expect(genA).toBe(1);
    expect(w.outbox.claim("wB", w.clock.now, 1)).toHaveLength(0);
    w.clock.now += 61;
    const [claimedB] = w.outbox.claim("wB", w.clock.now, 1);
    const genB = claimedB!.lease_generation;
    expect(genB).toBe(2);
    const row = w.outbox.rows.get(a.envelope.event_id)!;
    expect(await w.outbox.deliver(row, "wB", genB, w.transport, w.reg, w.clock.now, () => 0)).toBe(
      "gateway_admitted",
    );
    const snapshot = JSON.stringify(row);
    const auditLen = w.outbox.audit.length;
    expect(await w.outbox.deliver(row, "wA", genA, w.transport, w.reg, w.clock.now, () => 0)).toBe(
      "lost_lease",
    );
    expect(w.outbox.fail(row, "wA", genA, "late_failure", w.clock.now)).toBe("lost_lease");
    expect(w.outbox.fail(row, "wB", genA, "right_worker_old_generation", w.clock.now)).toBe(
      "lost_lease",
    );
    expect(JSON.stringify(row)).toBe(snapshot);
    expect(w.outbox.audit.slice(auditLen).every((x) => x.detail.startsWith("lost_lease"))).toBe(
      true,
    );
    expect(row.state).toBe("gateway_admitted");
  });

  it("a stale confirm is refused the same way", async () => {
    const w = world();
    const a = await ev(1);
    await enqueueOne(w, a);
    await drive(w, 1);
    const row = w.outbox.rows.get(a.envelope.event_id)!;
    const genA = w.outbox.claim("wA", w.clock.now + RETRY.baseSec, 1)[0]!.lease_generation;
    const genB = w.outbox.claim("wB", w.clock.now + RETRY.baseSec + 61, 1)[0]!.lease_generation;
    expect(genB).toBe(genA + 1);
    expect(await w.outbox.confirm(row, "wA", genA, w.query, w.reg, w.clock.now + 70, () => 0)).toBe(
      "lost_lease",
    );
    expect(row.state).toBe("gateway_admitted");
    expect(await w.outbox.confirm(row, "wB", genB, w.query, w.reg, w.clock.now + 70, () => 0)).toBe(
      "consumer_committed",
    );
  });
});

describe("crash recovery", () => {
  it("a crash before the target commit leaves no trace; the retry applies exactly once", async () => {
    let crash = true;
    const w = world({ crash: () => crash });
    const a = await ev(1);
    await enqueueOne(w, a);
    await drive(w);
    expect(w.inbox.rows.size).toBe(0);
    expect(w.inbox.deliveries.size).toBe(0);
    expect(w.inbox.projection.statuses).toEqual({});
    const row = w.outbox.rows.get(a.envelope.event_id)!;
    expect(row.state).toBe("gateway_admitted");
    crash = false;
    await w.gw.forwardPending(w.clock.now);
    w.clock.now += 3600;
    await pump(w);
    expect(row.state).toBe("consumer_committed");
    expect(w.inbox.effectsApplied.get(a.envelope.event_id)).toBe(1);
  });

  it("a crash after the commit but before the receipts were stored re-signs byte-identical receipts from the stored issue time", async () => {
    let crash = true;
    const w = world({ crashBeforeReceipts: () => crash });
    const a = await ev(1);
    await enqueueOne(w, a);
    await pump(w);
    expect(w.inbox.effectsApplied.get(a.envelope.event_id)).toBe(1);
    const stored = [...w.inbox.deliveries.values()][0]!;
    expect(stored.receipts).toBeNull();
    const issued = stored.issued_at;
    crash = false;
    w.clock.now += 120;
    await w.gw.forwardPending(w.clock.now);
    const first = chainOf(w, a.envelope.event_id);
    expect(first.map((x) => x.issued_at)).toEqual([T0, issued, issued]);
    w.clock.now += 120;
    const again = await w.inbox.receive(
      {
        envelope: a.envelope,
        body_sha256: "x",
        key_id: "gw-dev-1",
        signer: "gateway",
        connection_id: CONN,
        duplicate_delivery: false,
      },
      first[0]!,
      w.clock.now,
    );
    expect(canonicalize(again.receipts)).toBe(canonicalize(first.slice(1)));
    expect(w.inbox.effectsApplied.get(a.envelope.event_id)).toBe(1);
  });

  it("a worker that dies mid-flight loses its lease and another worker completes the row once", async () => {
    const w = world();
    const a = await ev(1);
    await enqueueOne(w, a);
    const [c1] = w.outbox.claim("w1", w.clock.now, 5);
    expect(c1).toBeTruthy();
    expect(w.outbox.claim("w2", w.clock.now, 5)).toHaveLength(0);
    w.clock.now += 61;
    const r = w.outbox.claim("w2", w.clock.now, 5)[0]!;
    expect(r.lease_owner).toBe("w2");
    expect(
      await w.outbox.deliver(r, "w1", c1!.lease_generation, w.transport, w.reg, w.clock.now),
    ).toBe("lost_lease");
    expect(
      await w.outbox.deliver(r, "w2", r.lease_generation, w.transport, w.reg, w.clock.now),
    ).toBe("gateway_admitted");
    w.clock.now += RETRY.baseSec;
    await pump(w, "w2");
    expect(r.state).toBe("consumer_committed");
    expect(w.inbox.effectsApplied.get(a.envelope.event_id)).toBe(1);
  });

  it("in-memory concurrency simulation: parallel workers never double-apply", async () => {
    const w = world();
    const st = ["in_stock", "in_recon", "frontline", "pending_sale", "sold"];
    const evs = await Promise.all([1, 2, 3, 4, 5].map((n) => ev(n, st[n - 1])));
    await w.outbox.transaction(async (_s, enqueue) => {
      for (const e of evs) await enqueue(e.envelope, e.body);
    });
    const batches = ["w1", "w2", "w3"].map((wk) => ({
      wk,
      rows: w.outbox.claim(wk, w.clock.now, 2),
    }));
    await Promise.all(
      batches.flatMap(({ wk, rows }) =>
        rows.map((r) =>
          w.outbox.deliver(r, wk, r.lease_generation, w.transport, w.reg, w.clock.now, () => 0),
        ),
      ),
    );
    for (let k = 0; k < 6; k++) {
      w.clock.now += 1000;
      await pump(w);
    }
    expect(w.inbox.projection.statuses["episode-syn-1"]).toEqual([
      "1:in_stock",
      "2:in_recon",
      "3:frontline",
      "4:pending_sale",
      "5:sold",
    ]);
    for (const e of evs) expect(w.inbox.effectsApplied.get(e.envelope.event_id)).toBe(1);
  });
});

describe("revision ordering", () => {
  const deliverDirect = async (w: World, sealed: { envelope: EnvelopeV2; body: string }) =>
    w.transport({
      body: sealed.body,
      envelope: sealed.envelope,
      event_id: sealed.envelope.event_id,
    } as OutboxRow);

  it("holds an out-of-order revision and drains it when the predecessor commits", async () => {
    const w = world();
    const [r1, r2, r3] = await Promise.all([ev(1, "in_recon"), ev(2, "frontline"), ev(3, "sold")]);
    await deliverDirect(w, r3);
    await deliverDirect(w, r2);
    expect(w.inbox.heldCount()).toBe(2);
    expect(w.inbox.projection.statuses).toEqual({});
    await deliverDirect(w, r1);
    expect(w.inbox.heldCount()).toBe(0);
    expect(w.inbox.projection.statuses["episode-syn-1"]).toEqual([
      "1:in_recon",
      "2:frontline",
      "3:sold",
    ]);
  });

  it("ignores a stale revision without overwriting newer state, and records it", async () => {
    const w = world();
    const [r1, r2] = await Promise.all([ev(1, "frontline"), ev(2, "sold")]);
    await deliverDirect(w, r1);
    await deliverDirect(w, r2);
    const stale = await sealEnvelope({
      ...r1.envelope,
      event_id: "11111111-2222-4333-8444-555555555555",
      origin: { ...r1.envelope.origin, event_id: "11111111-2222-4333-8444-555555555555" },
      payload: { ...r1.envelope.payload, status: "frontline" },
    });
    await deliverDirect(w, stale);
    const chain = chainOf(w, stale.envelope.event_id);
    expect(chain.map((x) => `${x.kind}:${x.outcome}`)).toEqual([
      "gateway_admission:admitted",
      "target_inbox:stale_ignored",
      "consumer_commit:stale_ignored",
    ]);
    expect(w.inbox.projection.statuses["episode-syn-1"]).toEqual(["1:frontline", "2:sold"]);
  });

  const direct = async (w: World, envelope: EnvelopeV2) =>
    w.inbox.receive(
      {
        envelope,
        body_sha256: "x",
        key_id: "gw-dev-1",
        signer: "gateway",
        connection_id: CONN,
        duplicate_delivery: false,
      },
      await signAdmission(envelope, CONN, keyOf(w.reg, "gw-dev-1"), w.clock.now),
      w.clock.now,
    );

  it("quarantines a conflicting duplicate and keeps the original effect", async () => {
    const w = world();
    const r1 = await ev(1, "frontline");
    await deliverDirect(w, r1);
    const conflict = await sealEnvelope({
      ...r1.envelope,
      payload: { ...r1.envelope.payload, status: "sold" },
    });
    const res = await deliverDirect(w, conflict);
    // The Gateway refuses a second body under an admitted event id before it reaches the target.
    expect(res).toMatchObject({ http_status: 409, reason: "admission_conflict" });
    // If a conflicting copy reaches the inbox by another path, it is quarantined, never applied.
    const out = await direct(w, conflict.envelope);
    expect(out.outcome).toBe("quarantined");
    expect(out.receipts.map((x) => `${x.kind}:${x.outcome}`)).toEqual(["target_inbox:quarantined"]);
    expect(w.inbox.projection.statuses["episode-syn-1"]).toEqual(["1:frontline"]);
  });

  it("quarantines a changed envelope under the same event id even when the payload is identical", async () => {
    const w = world();
    const r1 = await ev(1, "frontline");
    await deliverDirect(w, r1);
    const changed = { ...r1.envelope, correlation_id: "corr-tampered" };
    expect(await direct(w, changed)).toMatchObject({
      outcome: "quarantined",
      reason: "conflicting_duplicate",
      committed: false,
    });
    // The same delivery again returns the stored decision, not a new one.
    expect(await direct(w, r1.envelope)).toMatchObject({ outcome: "applied", committed: true });
    expect(w.inbox.projection.statuses["episode-syn-1"]).toEqual(["1:frontline"]);
  });

  it("returns the stored receipts byte for byte on a redelivery of the same delivery", async () => {
    const w = world();
    const r1 = await ev(1);
    await deliverDirect(w, r1);
    const first = chainOf(w, r1.envelope.event_id);
    w.clock.now += 500;
    const again = await w.inbox.receive(
      {
        envelope: r1.envelope,
        body_sha256: "x",
        key_id: "gw-dev-1",
        signer: "gateway",
        connection_id: CONN,
        duplicate_delivery: false,
      },
      first[0]!,
      w.clock.now,
    );
    expect(canonicalize(again.receipts)).toBe(canonicalize(first.slice(1)));
    expect(again.outcome).toBe("applied");
  });

  it("a different delivery of an already committed event gets a duplicate receipt and the original commit outcome", async () => {
    const w = world();
    const r1 = await ev(1);
    await deliverDirect(w, r1);
    const otherConn = `${CONN}-renamed`;
    const v = {
      envelope: r1.envelope,
      body_sha256: "x",
      key_id: "gw-dev-1",
      signer: "gateway" as const,
      connection_id: otherConn,
      duplicate_delivery: false,
    };
    const renamed = {
      connections: w.reg.connections.map((c) =>
        c.connection_id === CONN ? { ...c, connection_id: otherConn } : c,
      ),
      keys: w.reg.keys.map((k) => ({
        ...k,
        connection_ids: k.connection_ids.map((c) => (c === CONN ? otherConn : c)),
      })),
    };
    const inbox2 = new MemoryInbox<Proj>("autocurb", w.inbox.projection, effect, {
      registry: renamed,
      key: keyOf(renamed, "ac-dev-1"),
    });
    inbox2.rows = w.inbox.rows;
    inbox2.watermarks = w.inbox.watermarks;
    const out = await inbox2.receive(
      v,
      await signAdmission(r1.envelope, otherConn, keyOf(renamed, "gw-dev-1"), w.clock.now),
      w.clock.now,
    );
    expect(out.receipts.map((x) => `${x.kind}:${x.outcome}`)).toEqual([
      "target_inbox:duplicate",
      "consumer_commit:applied",
    ]);
  });
});

describe("retry, dead letter and reconciliation", () => {
  it("bounds backoff and dead-letters after the attempt limit without deleting evidence", async () => {
    expect(backoffSeconds(1, () => 0)).toBe(2);
    expect(backoffSeconds(50, () => 0.999)).toBeLessThanOrEqual(RETRY.capSec);
    const w = world();
    const a = await ev(1);
    await enqueueOne(w, a);
    const down: Transport = async () => ({ http_status: 503 });
    for (let k = 0; k < RETRY.maxAttempts; k++) {
      await pump(w, "w1", down);
      w.clock.now += RETRY.capSec + 1;
    }
    const row = w.outbox.rows.get(a.envelope.event_id)!;
    expect(row.state).toBe("dead_letter");
    expect(w.outbox.audit.filter((x) => x.event_id === a.envelope.event_id).length).toBeGreaterThan(
      RETRY.maxAttempts,
    );
    expect(w.outbox.redrive(a.envelope.event_id, "ops-syn-1", w.clock.now)).toBe(true);
    await drive(w);
    expect(row.state).toBe("consumer_committed");
  });

  it("reconciliation reports gaps, quarantine and unacknowledged commits, and changes nothing", async () => {
    const w = world();
    const [r1, r2, r3] = await Promise.all([ev(1), ev(2), ev(3)]);
    const bad = await sealEnvelope({
      ...draftEnvelope("autolabels", "autocurb", "inventory.status_changed"),
      aggregate: {
        domain: "inventory",
        type: "episode",
        id: "episode-syn-9",
        revision: 1,
        prev_revision: null,
      },
      vehicle: { vin: "1HGCM82633A004352", instance_id: "inst-syn-0001", episode_id: "ep-unknown" },
    });
    await w.outbox.transaction(async (_s, enqueue) => {
      for (const e of [r1, r3, bad]) await enqueue(e.envelope, e.body);
      await enqueue(r2.envelope, r2.body);
    });
    let dropped = false;
    const lossy: Transport = async (r) => {
      const res = await w.transport(r);
      if (r.event_id === r1.envelope.event_id && !dropped) {
        dropped = true;
        return { http_status: 200 };
      }
      return res;
    };
    for (const r of w.outbox.claim("w1", w.clock.now, 2))
      await w.outbox.deliver(r, "w1", r.lease_generation, lossy, w.reg, w.clock.now, () => 0);
    for (const r of w.outbox.claim("w1", w.clock.now, 1))
      await w.outbox.deliver(r, "w1", r.lease_generation, lossy, w.reg, w.clock.now, () => 0);
    w.clock.now += RETRY.baseSec;
    w.outbox.rows.get(r2.envelope.event_id)!.next_attempt_at = Number.MAX_SAFE_INTEGER;
    for (const r of w.outbox.claim("w1", w.clock.now, 5))
      if (r.lease_action === "confirm")
        await w.outbox.confirm(r, "w1", r.lease_generation, w.query, w.reg, w.clock.now, () => 0);
      else
        await w.outbox.deliver(
          r,
          "w1",
          r.lease_generation,
          w.transport,
          w.reg,
          w.clock.now,
          () => 0,
        );
    const before = JSON.stringify([...w.inbox.rows.entries()]);
    const rep = reconcile(w.outbox.rows.values(), w.inbox as MemoryInbox<unknown>, "autocurb");
    expect(JSON.stringify([...w.inbox.rows.entries()])).toBe(before);
    expect(rep.checked).toBe(4);
    expect(rep.unacked_but_committed).toContain(r1.envelope.event_id);
    expect(rep.revision_gaps).toContain(r3.envelope.event_id);
    expect(rep.quarantined).toContain(bad.envelope.event_id);
    expect(rep.missing_at_target).toEqual([]);
    expect(rep.duplicate_effects).toEqual([]);
    expect(rep.invalid_ack).toEqual([]);
    expect(w.outbox.rows.get(bad.envelope.event_id)!.state).toBe("target_quarantined");
  });
});
