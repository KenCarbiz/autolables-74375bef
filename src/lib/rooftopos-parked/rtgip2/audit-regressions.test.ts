// @vitest-environment node
// Regressions for the independent audit (2026-11-02): C1 false commit acknowledgments,
// H1 event-id collision scope, H2 receipt binding. Synthetic, in-memory, no transport.
import { describe, expect, it } from "vitest";
import {
  canonicalize,
  deriveEventId,
  hmacHex,
  MemoryNonceStore,
  sealEnvelope,
  signEnvelope,
  verifyDelivery,
  type AppId,
  type EnvelopeV2,
  type Registry,
} from "./protocol.ts";
import {
  expectReceipt,
  receiptContext,
  MemoryInbox,
  MemoryOutbox,
  receiptSigningJson,
  signReceipt,
  verifyReceipt,
  type OutboxRow,
  type Receipt,
  type TransportResult,
} from "./delivery.ts";
import { makeTarget, ReferenceGateway, type TargetEndpoint } from "./harness.ts";
import {
  connId,
  draftEnvelope,
  EPISODE,
  EPISODE_2,
  INSTANCE,
  keyOf,
  OTHER_TENANT,
  ROOFTOP,
  syntheticRegistry,
  T0,
  TENANT,
} from "./fixtures.ts";

type Proj = { applied: string[] };
const effect = (p: Proj, e: EnvelopeV2) => {
  if (e.vehicle.episode_id === "ep-unknown")
    return { ok: false as const, reason: "unknown_episode" };
  p.applied.push(e.event_id);
  return { ok: true as const };
};

function world(reg: Registry = syntheticRegistry()) {
  const inbox = new MemoryInbox<Proj>("autocurb", { applied: [] }, effect);
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
  return {
    reg,
    inbox,
    outbox,
    clock,
    transport,
    setDrop: (d: boolean) => {
      drop = d;
    },
  };
}

const unknownEpisode = () =>
  sealEnvelope({
    ...draftEnvelope("autolabels", "autocurb", "inventory.status_changed"),
    vehicle: { vin: "1HGCM82633A004352", instance_id: INSTANCE, episode_id: "ep-unknown" },
  });

async function pump(w: ReturnType<typeof world>, transport = w.transport) {
  for (const r of w.outbox.claim("w1", w.clock.now, 50))
    await w.outbox.deliver(r, "w1", transport, w.reg, w.clock.now, () => 0);
}

describe("C1: a quarantined or held event never receives a successful commit acknowledgment", () => {
  it("quarantine, lost ACK, redelivery: no consumer_commit is issued and the row ends quarantined", async () => {
    const w = world();
    const bad = await unknownEpisode();
    await w.outbox.transaction(async (_s, enqueue) => {
      await enqueue(bad.envelope, bad.body);
    });
    w.setDrop(true);
    await pump(w);
    const row = w.outbox.rows.get(bad.envelope.event_id)!;
    expect(row.state).toBe("retry_wait");
    expect(row.last_error).toBe("ack_missing");
    w.setDrop(false);
    const seen: Receipt[] = [];
    const spy = async (r: OutboxRow) => {
      const res = await w.transport(r);
      seen.push(...(res.receipts ?? []));
      return res;
    };
    for (let k = 0; k < 3; k++) {
      w.clock.now = Math.max(w.clock.now, row.next_attempt_at);
      await pump(w, spy);
    }
    expect(row.state).toBe("target_quarantined");
    expect(seen.filter((r) => r.kind === "consumer_commit")).toEqual([]);
    expect(seen.find((r) => r.kind === "target_inbox")?.outcome).toBe("quarantined");
    expect(row.receipts.some((r) => r.kind === "consumer_commit")).toBe(false);
    expect(w.inbox.projection.applied).toEqual([]);
  });

  it("a direct duplicate of a quarantined event reports quarantined and uncommitted", async () => {
    const w = world();
    const bad = await unknownEpisode();
    const d = {
      envelope: bad.envelope,
      body_sha256: "x",
      key_id: "gw-dev-1",
      signer: "gateway" as const,
      connection_id: connId("autolabels", "autocurb"),
      duplicate_delivery: false,
    };
    expect(w.inbox.receive(d, T0)).toMatchObject({ outcome: "quarantined", committed: false });
    for (let k = 0; k < 3; k++)
      expect(w.inbox.receive(d, T0 + k)).toEqual({
        outcome: "quarantined",
        reason: "duplicate_of:quarantined",
        committed: false,
        committed_outcome: null,
      });
  });

  it("a duplicate of a held event stays held and uncommitted until its predecessor commits", async () => {
    const w = world();
    const r2 = await sealEnvelope(
      draftEnvelope("autolabels", "autocurb", "inventory.status_changed", {
        aggregate: {
          domain: "inventory",
          type: "episode",
          id: "episode-held",
          revision: 2,
          prev_revision: 1,
        },
      }),
    );
    const d = {
      envelope: r2.envelope,
      body_sha256: "x",
      key_id: "gw-dev-1",
      signer: "gateway" as const,
      connection_id: connId("autolabels", "autocurb"),
      duplicate_delivery: false,
    };
    expect(w.inbox.receive(d, T0).outcome).toBe("held");
    expect(w.inbox.receive(d, T0 + 1)).toMatchObject({
      outcome: "held",
      committed: false,
      committed_outcome: null,
    });
  });

  it("crash during a quarantining delivery then retry: still no commit acknowledgment", async () => {
    const reg = syntheticRegistry();
    const inbox = new MemoryInbox<Proj>("autocurb", { applied: [] }, effect);
    let crash = true;
    const target = makeTarget("autocurb", inbox, reg, keyOf(reg, "ac-dev-1"), undefined, {
      crashAfterEffect: () => crash,
    });
    const res = await (async () => {
      const bad = await unknownEpisode();
      const fwd = await signEnvelope(
        bad.body,
        bad.envelope,
        keyOf(reg, "gw-dev-1"),
        T0,
        "gw_nonce_crash_000001",
      );
      const first = await target.handle(fwd, bad.body, T0);
      crash = false;
      const second = await target.handle(fwd, bad.body, T0);
      const third = await target.handle(fwd, bad.body, T0);
      return [first, second, third];
    })();
    expect(res[0]!.http_status).toBe(503);
    for (const r of res.slice(1)) {
      expect(r.receipts?.map((x) => `${x.kind}:${x.outcome}`)).toEqual([
        "target_inbox:quarantined",
      ]);
    }
  });

  it("refuses to sign, and refuses to accept, a consumer_commit stating an uncommitted outcome", async () => {
    const reg = syntheticRegistry();
    const a = await sealEnvelope(
      draftEnvelope("autolabels", "autocurb", "inventory.status_changed"),
    );
    const conn = connId("autolabels", "autocurb");
    const ex = expectReceipt(a.envelope, conn, "consumer_commit");
    const { kind: _k, ...rest } = ex;
    for (const outcome of ["quarantined", "held", "duplicate"] as const) {
      await expect(
        signReceipt(
          { protocol: "rtgip/2", kind: "consumer_commit", ...rest, outcome, issued_at: T0 },
          keyOf(reg, "ac-dev-1"),
        ),
      ).rejects.toThrow("receipt_outcome_not_allowed");
      // A target that bypasses the signer guard still cannot get the receipt accepted.
      const unsigned = {
        protocol: "rtgip/2" as const,
        kind: "consumer_commit" as const,
        ...rest,
        outcome,
        issued_at: T0,
        key_id: "ac-dev-1",
      };
      const forged: Receipt = {
        ...unsigned,
        signature: await hmacHex(
          keyOf(reg, "ac-dev-1").secret,
          `rtgip/2-receipt\n${receiptSigningJson(unsigned)}`,
        ),
      };
      expect(await verifyReceipt(forged, ex, reg, T0, receiptContext(a.envelope, 0))).toEqual({
        ok: false,
        reason: "ack_outcome_not_allowed",
      });
    }
  });

  it("an outbox never commits when the target pairs a held or quarantined inbox with a commit", async () => {
    const w = world();
    const a = await sealEnvelope(
      draftEnvelope("autolabels", "autocurb", "inventory.status_changed"),
    );
    await w.outbox.transaction(async (_s, enqueue) => {
      await enqueue(a.envelope, a.body);
    });
    const conn = connId("autolabels", "autocurb");
    const lying = async (r: OutboxRow): Promise<TransportResult> => {
      const res = await w.transport(r);
      const base = {
        protocol: "rtgip/2" as const,
        ...(({ kind: _k, ...x }) => x)(expectReceipt(r.envelope, conn, "target_inbox")),
        issued_at: w.clock.now,
      };
      const held = await signReceipt(
        { ...base, kind: "target_inbox", outcome: "held" },
        keyOf(w.reg, "ac-dev-1"),
      );
      const commit = await signReceipt(
        { ...base, kind: "consumer_commit", outcome: "applied" },
        keyOf(w.reg, "ac-dev-1"),
      );
      return { http_status: 200, receipts: [res.receipts![0]!, held, commit] };
    };
    await pump(w, lying);
    const row = w.outbox.rows.get(a.envelope.event_id)!;
    expect(row.state).toBe("retry_wait");
    expect(row.last_error).toBe("ack_commit_contradicts_inbox");
  });
});

describe("H1: event ids are scoped to source, tenant, rooftop, instance and episode", () => {
  const base = {
    source_app: "autolabels" as const,
    tenant_id: TENANT,
    rooftop_id: ROOFTOP,
    instance_id: INSTANCE,
    episode_id: EPISODE,
    origin_event_id: "evt-origin-7",
    route: "autolabels->autocurb",
  };
  it("is deterministic for the same scope", async () => {
    expect(await deriveEventId(base)).toBe(await deriveEventId({ ...base }));
  });
  it("never collides when the same origin id is reused by another tenant, rooftop, episode, instance or source", async () => {
    const ids = await Promise.all(
      [
        base,
        { ...base, tenant_id: OTHER_TENANT },
        { ...base, rooftop_id: "rf-nw-02" },
        { ...base, episode_id: EPISODE_2 },
        { ...base, instance_id: "inst-syn-0002" },
        { ...base, source_app: "autocurb" as const },
        { ...base, route: "autolabels->autoframe" },
      ].map((s) => deriveEventId(s)),
    );
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("is not confused by field values that contain separators", async () => {
    const a = await deriveEventId({ ...base, tenant_id: "t\nr", rooftop_id: "x" });
    const b = await deriveEventId({ ...base, tenant_id: "t", rooftop_id: "r\nx" });
    expect(a).not.toBe(b);
  });
  it("seals with the derived id even when a caller supplies another one", async () => {
    const d = draftEnvelope("autolabels", "autocurb", "inventory.status_changed", {
      event_id: "00000000-0000-4000-8000-000000000000",
    });
    const s = await sealEnvelope(d);
    expect(s.envelope.event_id).not.toBe("00000000-0000-4000-8000-000000000000");
  });
  it("a receiver rejects a correctly signed envelope whose event id is not derived from its scope", async () => {
    const reg = syntheticRegistry();
    const s = await sealEnvelope(
      draftEnvelope("autolabels", "autocurb", "inventory.status_changed"),
    );
    const forged = { ...s.envelope, event_id: "00000000-0000-4000-8000-000000000000" };
    const body = canonicalize(forged);
    const h = await signEnvelope(body, forged, keyOf(reg, "al-dev-1"), T0, "src_nonce_forged_0001");
    const v = await verifyDelivery(h, body, {
      registry: reg,
      nonces: new MemoryNonceStore(),
      nowSec: T0,
      expectedSigner: "source",
    });
    expect(v).toEqual({ ok: false, reason: "event_id_not_derived" });
  });
});

describe("H2: receipts are bound to the exact delivery, connection and a valid key", () => {
  async function signed(
    over: Partial<Receipt> = {},
    keyId = "ac-dev-1",
    reg = syntheticRegistry(),
  ) {
    const a = await sealEnvelope(
      draftEnvelope("autolabels", "autocurb", "inventory.status_changed"),
    );
    const conn = connId("autolabels", "autocurb");
    const ex = expectReceipt(a.envelope, conn, "target_inbox");
    const { kind: _k, ...rest } = ex;
    const unsigned = {
      protocol: "rtgip/2" as const,
      kind: "target_inbox" as const,
      ...rest,
      outcome: "applied" as const,
      issued_at: T0,
      ...over,
      key_id: keyId,
    };
    const key = reg.keys.find((k) => k.key_id === keyId)!;
    const { signature: _s, ...toSign } = unsigned as Receipt;
    const r: Receipt = {
      ...(unsigned as Omit<Receipt, "signature">),
      signature: await hmacHex(key.secret, `rtgip/2-receipt\n${receiptSigningJson(toSign)}`),
    };
    return { r, ex, reg, ctx: receiptContext(a.envelope, 0) };
  }

  it("accepts a correctly bound receipt", async () => {
    const { r, ex, reg, ctx } = await signed();
    expect(await verifyReceipt(r, ex, reg, T0, ctx)).toEqual({ ok: true });
  });

  it.each([
    ["rooftop_id", "rf-nw-02", "ack_wrong_rooftop_id"],
    ["tenant_id", OTHER_TENANT, "ack_wrong_tenant_id"],
    ["route", "autolabels->autoframe", "ack_wrong_route"],
    ["target_app", "autoframe", "ack_wrong_target_app"],
    ["source_app", "autoframe", "ack_wrong_source_app"],
    ["connection_id", connId("autolabels", "autoframe"), "ack_wrong_connection_id"],
    ["event_id", "00000000-0000-4000-8000-000000000000", "ack_wrong_event_id"],
    ["payload_sha256", "0".repeat(64), "ack_wrong_payload_sha256"],
  ] as const)(
    "refuses a validly signed receipt with a different %s",
    async (field, value, reason) => {
      const { r, ex, reg, ctx } = await signed({ [field]: value } as Partial<Receipt>);
      expect(await verifyReceipt(r, ex, reg, T0, ctx)).toEqual({ ok: false, reason });
    },
  );

  it("refuses a revoked key, a key outside its validity window and a key of another dialect", async () => {
    const reg = syntheticRegistry();
    const ac = reg.keys.find((k) => k.key_id === "ac-dev-1")!;
    const revoked: Registry = {
      ...reg,
      keys: reg.keys.map((k) => (k.key_id === "ac-dev-1" ? { ...k, status: "revoked" } : k)),
    };
    let s = await signed({}, "ac-dev-1", revoked);
    expect(await verifyReceipt(s.r, s.ex, revoked, T0, s.ctx)).toEqual({
      ok: false,
      reason: "ack_key_revoked",
    });
    s = await signed({ issued_at: ac.not_after + 1 }, "ac-dev-1", reg);
    expect(await verifyReceipt(s.r, s.ex, reg, ac.not_after + 1, s.ctx)).toEqual({
      ok: false,
      reason: "ack_key_outside_validity",
    });
    s = await signed({}, "ac-legacy-1", reg);
    expect(await verifyReceipt(s.r, s.ex, reg, T0, s.ctx)).toEqual({
      ok: false,
      reason: "ack_key_dialect_mismatch",
    });
  });

  it("refuses a key not bound to the connection, a suspended connection and a future-dated receipt", async () => {
    const reg = syntheticRegistry();
    const unbound: Registry = {
      ...reg,
      keys: reg.keys.map((k) =>
        k.key_id === "ac-dev-1"
          ? {
              ...k,
              connection_ids: k.connection_ids.filter(
                (c) => c !== connId("autolabels", "autocurb"),
              ),
            }
          : k,
      ),
    };
    let s = await signed({}, "ac-dev-1", unbound);
    expect(await verifyReceipt(s.r, s.ex, unbound, T0, s.ctx)).toEqual({
      ok: false,
      reason: "ack_key_not_bound_to_connection",
    });
    const suspended: Registry = {
      ...reg,
      connections: reg.connections.map((c) =>
        c.connection_id === connId("autolabels", "autocurb") ? { ...c, status: "suspended" } : c,
      ),
    };
    s = await signed({}, "ac-dev-1", suspended);
    expect(await verifyReceipt(s.r, s.ex, suspended, T0, s.ctx)).toEqual({
      ok: false,
      reason: "ack_connection_inactive",
    });
    s = await signed({ issued_at: T0 + 3600 }, "ac-dev-1", reg);
    expect(await verifyReceipt(s.r, s.ex, reg, T0, s.ctx)).toEqual({
      ok: false,
      reason: "ack_issued_in_future",
    });
  });

  it("an outbox fails closed when its connection is revoked after enqueue", async () => {
    const w = world();
    const a = await sealEnvelope(
      draftEnvelope("autolabels", "autocurb", "inventory.status_changed"),
    );
    await w.outbox.transaction(async (_s, enqueue) => {
      await enqueue(a.envelope, a.body);
    });
    const revokedReg: Registry = {
      ...w.reg,
      connections: w.reg.connections.map((c) =>
        c.connection_id === connId("autolabels", "autocurb") ? { ...c, status: "revoked" } : c,
      ),
    };
    for (const r of w.outbox.claim("w1", w.clock.now, 1))
      await w.outbox.deliver(r, "w1", w.transport, revokedReg, w.clock.now, () => 0);
    const row = w.outbox.rows.get(a.envelope.event_id)!;
    expect(row.state).toBe("retry_wait");
    expect(row.last_error).toBe("authorization:connection_revoked");
    expect(w.inbox.projection.applied).toEqual([]);
  });
});
