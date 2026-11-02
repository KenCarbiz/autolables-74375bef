// @vitest-environment node
// Receipt and dispatch policy when permissions change after admission and before the
// acknowledgment reaches the source. The same rules are enforced by the proposed SQL
// (outbox_claim / outbox_advance) and tested there in supabase/tests/rtgip/pg_concurrency.sh.
import { describe, expect, it } from "vitest";
import {
  sealEnvelope,
  signEnvelope,
  type AppId,
  type EnvelopeV2,
  type Registry,
  type ServiceConnection,
  type ServiceKey,
} from "./protocol.ts";
import {
  MemoryInbox,
  MemoryOutbox,
  RETRY,
  type OutboxRow,
  type TransportResult,
} from "./delivery.ts";
import { makeTarget, ReferenceGateway, type TargetEndpoint } from "./harness.ts";
import { connId, draftEnvelope, keyOf, syntheticRegistry, T0 } from "./fixtures.ts";

type Proj = { applied: string[] };
const CONN = connId("autolabels", "autocurb");

function world() {
  const reg = syntheticRegistry() as { connections: ServiceConnection[]; keys: ServiceKey[] };
  const inbox = new MemoryInbox<Proj>("autocurb", { applied: [] }, (p, e: EnvelopeV2) => {
    p.applied.push(e.event_id);
    return { ok: true as const };
  });
  let drop = false;
  const target = makeTarget("autocurb", inbox, reg, keyOf(reg, "ac-dev-1"), undefined, {
    dropAck: () => drop,
  });
  const gw = new ReferenceGateway(
    reg,
    keyOf(reg, "gw-dev-1"),
    new Map<AppId, TargetEndpoint>([["autocurb", target]]),
  );
  const outbox = new MemoryOutbox<{ n: number }>({ n: 0 });
  const clock = { now: T0 };
  let i = 0;
  const transport = async (r: OutboxRow): Promise<TransportResult> => {
    const h = await signEnvelope(
      r.body,
      r.envelope,
      keyOf(reg, "al-dev-1"),
      clock.now,
      `src_nonce_${r.event_id.slice(0, 8)}_${i++}`,
    );
    return gw.admit(h, r.body, clock.now);
  };
  const setConn = (patch: Partial<ServiceConnection>) => {
    reg.connections = reg.connections.map((c) =>
      c.connection_id === CONN ? { ...c, ...patch } : c,
    );
  };
  const pump = async (t = transport) => {
    for (const r of outbox.claim("w1", clock.now, 50, 60, reg))
      await outbox.deliver(r, "w1", t, reg, clock.now, () => 0);
  };
  return {
    reg: reg as Registry,
    keys: reg,
    inbox,
    outbox,
    clock,
    transport,
    setConn,
    pump,
    setDrop: (d: boolean) => (drop = d),
  };
}

async function enqueued(w: ReturnType<typeof world>) {
  const a = await sealEnvelope(draftEnvelope("autolabels", "autocurb", "inventory.status_changed"));
  await w.outbox.transaction(async (_s, enqueue) => {
    await enqueue(a.envelope, a.body);
  });
  return a.envelope.event_id;
}

describe("permission changes after admission and before acknowledgment", () => {
  it.each([
    [{ status: "suspended" as const }, "ack_connection_inactive"],
    [{ status: "revoked" as const }, "ack_connection_inactive"],
    [{ producer_enabled: false }, "ack_producer_disabled"],
    [{ reader_enabled: false }, "ack_reader_disabled"],
    [{ event_types: [] }, "ack_event_not_granted"],
    [{ purposes: [] }, "ack_purpose_not_granted"],
    [{ rooftop_ids: ["rf-nw-02"] }, "ack_connection_mismatch"],
  ] as const)(
    "%o: receipts are refused, the row pauses, the effect is never repeated",
    async (patch, reason) => {
      const w = world();
      const id = await enqueued(w);
      const losing = async (r: OutboxRow) => {
        const res = await w.transport(r);
        w.setConn(patch as Partial<ServiceConnection>);
        return res;
      };
      await w.pump(losing);
      const row = w.outbox.rows.get(id)!;
      expect(row.state).toBe("retry_wait");
      expect(row.last_error).toBe(reason);
      expect(row.attempts).toBe(0);
      expect(w.inbox.projection.applied).toEqual([id]);
    },
  );

  it("a paused row is not leased, does not spend attempts and never dead-letters", async () => {
    const w = world();
    const id = await enqueued(w);
    w.setConn({ status: "suspended" });
    for (let n = 0; n < RETRY.maxAttempts * 3; n++) {
      w.clock.now += RETRY.capSec + 1;
      await w.pump();
    }
    const row = w.outbox.rows.get(id)!;
    expect(row.state).toBe("pending");
    expect(row.attempts).toBe(0);
    expect(w.inbox.projection.applied).toEqual([]);
  });

  it("a row already leased when permission is lost pauses without spending the attempt", async () => {
    const w = world();
    const id = await enqueued(w);
    const [r] = w.outbox.claim("w1", w.clock.now, 1, 60, w.reg);
    w.setConn({ reader_enabled: false });
    expect(await w.outbox.deliver(r!, "w1", w.transport, w.reg, w.clock.now, () => 0)).toBe(
      "retry_wait",
    );
    expect(w.outbox.rows.get(id)!.attempts).toBe(0);
    expect(w.outbox.rows.get(id)!.last_error).toBe("authorization:reader_disabled");
  });

  it("restoring the grant completes the row through a committed duplicate: one effect in total", async () => {
    const w = world();
    const id = await enqueued(w);
    await w.pump(async (r) => {
      const res = await w.transport(r);
      w.setConn({ status: "suspended" });
      return res;
    });
    w.clock.now += RETRY.capSec + 1;
    await w.pump();
    expect(w.outbox.rows.get(id)!.state).toBe("retry_wait");
    w.setConn({ status: "active" });
    w.clock.now += RETRY.capSec + 1;
    await w.pump();
    const row = w.outbox.rows.get(id)!;
    expect(row.state).toBe("consumer_committed");
    expect(row.receipts.map((x) => `${x.kind}:${x.outcome}`).slice(-2)).toEqual([
      "target_inbox:duplicate",
      "consumer_commit:applied",
    ]);
    expect(w.inbox.projection.applied).toEqual([id]);
  });

  it("a key revoked before the acknowledgment is refused and keeps refusing; the effect is not repeated", async () => {
    const w = world();
    const id = await enqueued(w);
    await w.pump(async (r) => {
      const res = await w.transport(r);
      w.keys.keys = w.keys.keys.map((k) =>
        k.key_id === "ac-dev-1" ? { ...k, status: "revoked" } : k,
      );
      return res;
    });
    expect(w.outbox.rows.get(id)!.last_error).toBe("ack_key_revoked");
    // The target cannot keep signing with the revoked key: its next receipt also fails.
    w.clock.now += RETRY.capSec + 1;
    await w.pump();
    expect(w.outbox.rows.get(id)!.state).toBe("retry_wait");
    expect(w.inbox.projection.applied).toEqual([id]);
  });

  it("lost acknowledgment: the redelivery is a committed duplicate and the effect happens once", async () => {
    const w = world();
    const id = await enqueued(w);
    w.setDrop(true);
    await w.pump();
    expect(w.outbox.rows.get(id)!.state).toBe("retry_wait");
    w.setDrop(false);
    w.clock.now += RETRY.capSec + 1;
    await w.pump();
    expect(w.outbox.rows.get(id)!.state).toBe("consumer_committed");
    expect(w.inbox.projection.applied).toEqual([id]);
  });
});

describe("receipts are bound to the delivery attempt they acknowledge", () => {
  it("a receipt captured in an earlier attempt is refused in a later one", async () => {
    const w = world();
    const id = await enqueued(w);
    let captured: TransportResult | undefined;
    w.setDrop(false);
    await w.pump(async (r) => {
      captured = await w.transport(r);
      return { http_status: 503 };
    });
    expect(w.outbox.rows.get(id)!.state).toBe("retry_wait");
    w.clock.now += 3600;
    await w.pump(async () => captured!);
    const row = w.outbox.rows.get(id)!;
    expect(row.state).toBe("retry_wait");
    expect(row.last_error).toBe("ack_predates_attempt");
    expect(row.attempt_started_at).toBe(T0 + 3600);
  });

  it("a receipt within clock skew of the attempt start is accepted", async () => {
    const w = world();
    const id = await enqueued(w);
    const [r] = w.outbox.claim("w1", w.clock.now, 1, 60, w.reg);
    const early = async (row: OutboxRow) => {
      w.clock.now -= 200;
      const res = await w.transport(row);
      w.clock.now += 200;
      return res;
    };
    expect(await w.outbox.deliver(r!, "w1", early, w.reg, w.clock.now, () => 0)).toBe(
      "consumer_committed",
    );
    expect(w.outbox.rows.get(id)!.state).toBe("consumer_committed");
  });
});
