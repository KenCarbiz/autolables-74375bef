// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  sealEnvelope,
  signEnvelope,
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
} from "./delivery.ts";
import { makeTarget, ReferenceGateway, type TargetEndpoint } from "./harness.ts";
import { draftEnvelope, keyOf, syntheticRegistry, T0 } from "./fixtures.ts";

type Proj = { statuses: Record<string, string[]> };
const effect = (p: Proj, e: EnvelopeV2) => {
  if (e.vehicle.episode_id === "ep-unknown")
    return { ok: false as const, reason: "unknown_episode" };
  (p.statuses[e.aggregate.id] ??= []).push(
    `${e.aggregate.revision}:${String(e.payload["status"] ?? e.event_type)}`,
  );
  return { ok: true as const };
};

function world(opts: { crash?: () => boolean; dropAck?: () => boolean } = {}) {
  const reg = syntheticRegistry();
  const inbox = new MemoryInbox<Proj>("autocurb", { statuses: {} }, effect);
  const target = makeTarget("autocurb", inbox, reg, keyOf(reg, "ac-dev-1"), undefined, {
    crashAfterEffect: opts.crash,
    dropAck: opts.dropAck,
  });
  const targets = new Map<AppId, TargetEndpoint>([["autocurb", target]]);
  const gw = new ReferenceGateway(reg, keyOf(reg, "gw-dev-1"), targets);
  const outbox = new MemoryOutbox<{ n: number }>({ n: 0 });
  let i = 0;
  const transport = async (r: OutboxRow) => {
    const h = await signEnvelope(
      r.body,
      r.envelope,
      keyOf(reg, "al-dev-1"),
      clock.now,
      `src_nonce_${r.event_id.slice(0, 8)}_${i++}`,
    );
    return gw.admit(h, r.body, clock.now);
  };
  const clock = { now: T0 };
  return { reg, inbox, gw, outbox, transport, clock };
}

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

async function pump(w: ReturnType<typeof world>, worker = "w1") {
  for (const r of w.outbox.claim(worker, w.clock.now, 50))
    await w.outbox.deliver(r, worker, w.transport, w.reg.keys, w.clock.now, () => 0);
}

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
    expect(w.outbox.rows.get(envelope.event_id)?.state).toBe("pending");
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
        event_id: a.envelope.event_id,
      }),
      payload: { status: "sold", stock_number: "SYN1001", changed_at: "2027-01-15T15:00:00Z" },
    });
    await expect(
      w.outbox.transaction(async (_s, enqueue) => {
        await enqueue(b.envelope, b.body);
      }),
    ).rejects.toThrow("event_id_conflict");
  });
});

describe("acknowledgment levels", () => {
  it("advances to consumer_committed only after admission, inbox and commit receipts verify", async () => {
    const w = world();
    const a = await ev(1);
    await w.outbox.transaction(async (_s, enqueue) => {
      await enqueue(a.envelope, a.body);
    });
    await pump(w);
    const row = w.outbox.rows.get(a.envelope.event_id)!;
    expect(row.state).toBe("consumer_committed");
    expect(row.receipts.map((r) => r.kind)).toEqual([
      "gateway_admission",
      "target_inbox",
      "consumer_commit",
    ]);
    expect(w.inbox.projection.statuses["episode-syn-1"]).toEqual(["1:frontline"]);
  });

  it("does not treat HTTP 200 without receipts as delivered (acknowledgment loss)", async () => {
    let drop = true;
    const w = world({ dropAck: () => drop });
    const a = await ev(1);
    await w.outbox.transaction(async (_s, enqueue) => {
      await enqueue(a.envelope, a.body);
    });
    await pump(w);
    const row = w.outbox.rows.get(a.envelope.event_id)!;
    expect(row.state).toBe("retry_wait");
    expect(row.last_error).toBe("ack_missing");
    // The target already committed. Recovery must not apply the effect twice.
    expect(w.inbox.effectsApplied.get(a.envelope.event_id)).toBe(1);
    drop = false;
    w.clock.now = row.next_attempt_at;
    await pump(w);
    expect(row.state).toBe("consumer_committed");
    expect(row.receipts.find((r) => r.kind === "consumer_commit")?.outcome).toBe("duplicate");
    expect(w.inbox.effectsApplied.get(a.envelope.event_id)).toBe(1);
  });

  it("rejects a forged receipt", async () => {
    const w = world();
    const a = await ev(1);
    await w.outbox.transaction(async (_s, enqueue) => {
      await enqueue(a.envelope, a.body);
    });
    const forging = async (r: OutboxRow) => {
      const res = await w.transport(r);
      return {
        ...res,
        receipts: (res.receipts ?? []).map((x) =>
          x.kind === "consumer_commit" ? { ...x, signature: "0".repeat(64) } : x,
        ),
      };
    };
    for (const r of w.outbox.claim("w1", w.clock.now, 5))
      await w.outbox.deliver(r, "w1", forging, w.reg.keys, w.clock.now, () => 0);
    expect(w.outbox.rows.get(a.envelope.event_id)!.last_error).toBe("ack_bad_signature");
  });
});

describe("crash recovery", () => {
  it("a crash before the target commit leaves no trace; the retry applies exactly once", async () => {
    let crash = true;
    const w = world({ crash: () => crash });
    const a = await ev(1);
    await w.outbox.transaction(async (_s, enqueue) => {
      await enqueue(a.envelope, a.body);
    });
    await pump(w);
    expect(w.inbox.rows.size).toBe(0);
    expect(w.inbox.projection.statuses).toEqual({});
    expect(w.outbox.rows.get(a.envelope.event_id)!.state).toBe("retry_wait");
    crash = false;
    w.clock.now += 3600;
    await pump(w);
    expect(w.outbox.rows.get(a.envelope.event_id)!.state).toBe("consumer_committed");
    expect(w.inbox.effectsApplied.get(a.envelope.event_id)).toBe(1);
  });

  it("a worker that dies mid-flight loses its lease and another worker completes the row once", async () => {
    const w = world();
    const a = await ev(1);
    await w.outbox.transaction(async (_s, enqueue) => {
      await enqueue(a.envelope, a.body);
    });
    expect(w.outbox.claim("w1", w.clock.now, 5)).toHaveLength(1);
    expect(w.outbox.claim("w2", w.clock.now, 5)).toHaveLength(0);
    w.clock.now += 61;
    const r = w.outbox.claim("w2", w.clock.now, 5)[0]!;
    expect(r.lease_owner).toBe("w2");
    expect(await w.outbox.deliver(r, "w1", w.transport, w.reg.keys, w.clock.now)).toBe("in_flight");
    expect(await w.outbox.deliver(r, "w2", w.transport, w.reg.keys, w.clock.now)).toBe(
      "consumer_committed",
    );
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
        rows.map((r) => w.outbox.deliver(r, wk, w.transport, w.reg.keys, w.clock.now, () => 0)),
      ),
    );
    for (let k = 0; k < 4; k++) {
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
  const deliverDirect = async (
    w: ReturnType<typeof world>,
    sealed: { envelope: EnvelopeV2; body: string },
  ) =>
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
    const res = await deliverDirect(w, stale);
    expect(res.receipts?.find((r) => r.kind === "target_inbox")?.outcome).toBe("stale_ignored");
    expect(w.inbox.projection.statuses["episode-syn-1"]).toEqual(["1:frontline", "2:sold"]);
  });

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
    const direct = w.inbox.receive(
      {
        envelope: conflict.envelope,
        body_sha256: "x",
        key_id: "gw-dev-1",
        signer: "gateway",
        connection_id: "c",
        duplicate_delivery: false,
      },
      w.clock.now,
    );
    expect(direct.outcome).toBe("quarantined");
    expect(w.inbox.projection.statuses["episode-syn-1"]).toEqual(["1:frontline"]);
  });
});

describe("retry, dead letter and reconciliation", () => {
  it("bounds backoff and dead-letters after the attempt limit without deleting evidence", async () => {
    expect(backoffSeconds(1, () => 0)).toBe(2);
    expect(backoffSeconds(50, () => 0.999)).toBeLessThanOrEqual(RETRY.capSec);
    const w = world();
    const a = await ev(1);
    await w.outbox.transaction(async (_s, enqueue) => {
      await enqueue(a.envelope, a.body);
    });
    const down = async () => ({ http_status: 503 });
    for (let k = 0; k < RETRY.maxAttempts; k++) {
      for (const r of w.outbox.claim("w1", w.clock.now, 1))
        await w.outbox.deliver(r, "w1", down, w.reg.keys, w.clock.now, () => 0);
      w.clock.now += RETRY.capSec + 1;
    }
    const row = w.outbox.rows.get(a.envelope.event_id)!;
    expect(row.state).toBe("dead_letter");
    expect(w.outbox.audit.filter((x) => x.event_id === a.envelope.event_id).length).toBeGreaterThan(
      RETRY.maxAttempts,
    );
    expect(w.outbox.redrive(a.envelope.event_id, "ops-syn-1", w.clock.now)).toBe(true);
    await pump(w);
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
    const lossy = async (r: OutboxRow) => {
      const res = await w.transport(r);
      if (r.event_id === r1.envelope.event_id && !dropped) {
        dropped = true;
        return { http_status: 200 };
      }
      return res;
    };
    for (const r of w.outbox.claim("w1", w.clock.now, 2))
      await w.outbox.deliver(r, "w1", lossy, w.reg.keys, w.clock.now, () => 0);
    for (const r of w.outbox.claim("w1", w.clock.now, 1))
      await w.outbox.deliver(r, "w1", lossy, w.reg.keys, w.clock.now, () => 0);
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
