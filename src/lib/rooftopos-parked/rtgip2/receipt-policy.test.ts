// @vitest-environment node
// Receipt and dispatch policy when permissions change after admission and before the
// acknowledgment reaches the source. The same rules are enforced by the proposed SQL
// (outbox_claim / outbox_advance) and tested there in supabase/tests/rtgip/pg_concurrency.sh.
import { describe, expect, it } from "vitest";
import {
  sealEnvelope,
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
  type ReceiptQueryPort,
  type Transport,
} from "./delivery.ts";
import {
  makeTarget,
  queryPort,
  ReferenceGatewayStandIn,
  sourceTransport,
  type TargetEndpoint,
} from "./harness.ts";
import { connId, draftEnvelope, keyOf, syntheticRegistry, T0 } from "./fixtures.ts";

type Proj = { applied: string[] };
const CONN = connId("autolabels", "autocurb");

function world() {
  const reg = syntheticRegistry() as { connections: ServiceConnection[]; keys: ServiceKey[] };
  const inbox = new MemoryInbox<Proj>(
    "autocurb",
    { applied: [] },
    (p, e: EnvelopeV2) => {
      p.applied.push(e.event_id);
      return { ok: true as const };
    },
    { registry: reg, key: keyOf(reg, "ac-dev-1") },
  );
  let drop = false;
  const target = makeTarget("autocurb", inbox, reg, undefined, { dropAck: () => drop });
  const gw = new ReferenceGatewayStandIn(
    reg,
    keyOf(reg, "gw-dev-1"),
    new Map<AppId, TargetEndpoint>([["autocurb", target]]),
  );
  const outbox = new MemoryOutbox<{ n: number }>({ n: 0 }, reg);
  const clock = { now: T0 };
  const transport = sourceTransport(gw, keyOf(reg, "al-dev-1"), clock);
  const query = queryPort(gw, keyOf(reg, "al-dev-1"), clock);
  const setConn = (patch: Partial<ServiceConnection>) => {
    reg.connections = reg.connections.map((c) =>
      c.connection_id === CONN ? { ...c, ...patch } : c,
    );
  };
  const pump = async (t: Transport = transport, q: ReceiptQueryPort = query) => {
    for (const r of outbox.claim("w1", clock.now, 50, 60, reg)) {
      if (r.lease_action === "confirm")
        await outbox.confirm(r, "w1", r.lease_generation, q, reg, clock.now, () => 0);
      else await outbox.deliver(r, "w1", r.lease_generation, t, reg, clock.now, () => 0);
    }
  };
  return {
    reg: reg as Registry,
    keys: reg,
    inbox,
    gw,
    outbox,
    clock,
    transport,
    query,
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
    [{ status: "suspended" as const }],
    [{ status: "revoked" as const }],
    [{ producer_enabled: false }],
    [{ reader_enabled: false }],
    [{ event_types: [] }],
    [{ purposes: [] }],
    [{ rooftop_ids: ["rf-nw-02"] }],
  ] as const)(
    "%o: the admission is refused, the row pauses, the effect is never repeated",
    async (patch) => {
      const w = world();
      const id = await enqueued(w);
      const losing: Transport = async (r) => {
        const res = await w.transport(r);
        w.setConn(patch as Partial<ServiceConnection>);
        return res;
      };
      await w.pump(losing);
      const row = w.outbox.rows.get(id)!;
      expect(row.state).toBe("retry_wait");
      expect(row.last_error).toBe("ack_connection_not_authorized");
      expect(row.attempts).toBe(0);
      expect(row.receipts).toEqual([]);
      expect(w.inbox.projection.applied).toEqual([id]);
    },
  );

  it("a connection lost while the row is admitted pauses the confirm without spending the attempt", async () => {
    const w = world();
    const id = await enqueued(w);
    await w.pump();
    const row = w.outbox.rows.get(id)!;
    expect(row.state).toBe("gateway_admitted");
    const attempts = row.attempts;
    w.clock.now = row.next_attempt_at;
    const [r] = w.outbox.claim("w1", w.clock.now, 1, 60, w.reg);
    expect(r!.lease_action).toBe("confirm");
    w.setConn({ status: "suspended" });
    expect(
      await w.outbox.confirm(r!, "w1", r!.lease_generation, w.query, w.reg, w.clock.now, () => 0),
    ).toBe("gateway_admitted");
    expect(row.attempts).toBe(attempts);
    expect(row.last_error).toBe("authorization:connection_revoked");
  });

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
    expect(
      await w.outbox.deliver(
        r!,
        "w1",
        r!.lease_generation,
        w.transport,
        w.reg,
        w.clock.now,
        () => 0,
      ),
    ).toBe("retry_wait");
    expect(w.outbox.rows.get(id)!.attempts).toBe(0);
    expect(w.outbox.rows.get(id)!.last_error).toBe("authorization:reader_disabled");
  });

  it("a sibling connection cannot rescue a revoked one: the row must still use its own connection", async () => {
    const w = world();
    const id = await enqueued(w);
    const sibling = `${CONN}:sibling`;
    const row = w.outbox.rows.get(id)!;
    w.setConn({ status: "revoked" });
    const base = w.keys.connections.find((c) => c.connection_id === CONN)!;
    w.keys.connections = [
      ...w.keys.connections,
      { ...base, connection_id: sibling, status: "active" },
    ];
    const [r] = w.outbox.claim("w1", w.clock.now, 1);
    expect(
      await w.outbox.deliver(
        r!,
        "w1",
        r!.lease_generation,
        w.transport,
        w.reg,
        w.clock.now,
        () => 0,
      ),
    ).toBe("retry_wait");
    expect(row.last_error).toBe("authorization:connection_changed");
    expect(row.receipts).toEqual([]);
    expect(w.inbox.projection.applied).toEqual([]);
  });

  it("restoring the grant completes the row from the stored chain: one effect in total", async () => {
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
    w.clock.now += RETRY.capSec + 1;
    await w.pump();
    const row = w.outbox.rows.get(id)!;
    expect(row.state).toBe("consumer_committed");
    expect(row.receipts.map((x) => `${x.kind}:${x.outcome}`)).toEqual([
      "gateway_admission:admitted",
      "target_inbox:applied",
      "consumer_commit:applied",
    ]);
    expect(w.inbox.projection.applied).toEqual([id]);
  });

  it("a target key revoked before the chain is confirmed is refused and keeps refusing; the effect is not repeated", async () => {
    const w = world();
    const id = await enqueued(w);
    await w.pump(async (r) => {
      const res = await w.transport(r);
      w.keys.keys = w.keys.keys.map((k) =>
        k.key_id === "ac-dev-1" ? { ...k, status: "revoked" } : k,
      );
      return res;
    });
    w.clock.now += RETRY.baseSec;
    await w.pump();
    expect(w.outbox.rows.get(id)!.last_error).toBe("ack_key_not_authorized");
    w.clock.now += RETRY.capSec + 1;
    await w.pump();
    expect(w.outbox.rows.get(id)!.state).toBe("gateway_admitted");
    expect(w.outbox.rows.get(id)!.last_error).toBe("ack_key_not_authorized");
    expect(w.inbox.projection.applied).toEqual([id]);
  });

  it("lost acknowledgment: the Gateway's re-forward returns the stored receipts and the effect happens once", async () => {
    const w = world();
    const id = await enqueued(w);
    w.setDrop(true);
    await w.pump();
    w.clock.now += RETRY.baseSec;
    await w.pump();
    expect(w.outbox.rows.get(id)!.state).toBe("gateway_admitted");
    w.setDrop(false);
    await w.gw.forwardPending(w.clock.now);
    w.clock.now += RETRY.capSec + 1;
    await w.pump();
    expect(w.outbox.rows.get(id)!.state).toBe("consumer_committed");
    expect(w.inbox.projection.applied).toEqual([id]);
  });
});

describe("receipts are bound to the delivery, not to an attempt", () => {
  it("an admission receipt captured in an earlier attempt is the byte-identical one a later attempt gets", async () => {
    const w = world();
    const id = await enqueued(w);
    let captured: Awaited<ReturnType<Transport>> | undefined;
    await w.pump(async (r) => {
      captured = await w.transport(r);
      return { http_status: 503 };
    });
    expect(w.outbox.rows.get(id)!.state).toBe("retry_wait");
    w.clock.now += 3600;
    await w.pump(async () => captured!);
    const row = w.outbox.rows.get(id)!;
    expect(row.state).toBe("gateway_admitted");
    expect(row.receipts[0]!.issued_at).toBe(T0);
    expect(row.attempt_started_at).toBe(T0 + 3600);
  });

  it("a receipt chain captured for another delivery is refused", async () => {
    const w = world();
    const id = await enqueued(w);
    const other = await sealEnvelope({
      ...draftEnvelope("autolabels", "autocurb", "inventory.status_changed"),
      origin: { app: "autolabels", event_id: "org-other", revision: 1 },
    });
    await w.outbox.transaction(async (_s, enqueue) => {
      await enqueue(other.envelope, other.body);
    });
    await w.pump();
    w.clock.now += RETRY.baseSec;
    const wrong: ReceiptQueryPort = async (_d, e) =>
      w
        .query(w.outbox.rows.get(other.envelope.event_id)!.delivery_id, other.envelope.event_id)
        .then((c) => (e ? c : c));
    await w.pump(w.transport, wrong);
    expect(w.outbox.rows.get(id)!.state).toBe("gateway_admitted");
    expect(w.outbox.rows.get(id)!.last_error).toBe("ack_admission_mismatch");
  });

  it("an admission issued within clock skew is accepted; one from the future is refused", async () => {
    const w = world();
    const id = await enqueued(w);
    const skewed =
      (secs: number): Transport =>
      async (row) => {
        w.clock.now += secs;
        const res = await w.transport(row);
        w.clock.now -= secs;
        return res;
      };
    const [r] = w.outbox.claim("w1", w.clock.now, 1, 60, w.reg);
    expect(
      await w.outbox.deliver(
        r!,
        "w1",
        r!.lease_generation,
        skewed(400),
        w.reg,
        w.clock.now,
        () => 0,
      ),
    ).toBe("retry_wait");
    expect(w.outbox.rows.get(id)!.last_error).toBe("ack_future_receipt");
  });

  it("a receipt within clock skew of the attempt start is accepted", async () => {
    const w = world();
    const id = await enqueued(w);
    const early: Transport = async (row) => {
      w.clock.now += 200;
      const res = await w.transport(row);
      w.clock.now -= 200;
      return res;
    };
    const [r] = w.outbox.claim("w1", w.clock.now, 1, 60, w.reg);
    expect(
      await w.outbox.deliver(r!, "w1", r!.lease_generation, early, w.reg, w.clock.now, () => 0),
    ).toBe("gateway_admitted");
    expect(w.outbox.rows.get(id)!.state).toBe("gateway_admitted");
  });
});
