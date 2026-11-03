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
  MemoryInbox,
  MemoryOutbox,
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
import { encodeAdmissionHeader, ADMISSION_HEADER } from "./admission.ts";
import {
  deliveryIdentity,
  receiptDigest,
  receiptDraft,
  RECEIPT_PROTOCOL,
  signReceiptV2,
  verifyReceiptV2,
  type ReceiptV2,
} from "./receipt-v2.ts";
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
const CONN = connId("autolabels", "autocurb");

function world(reg: Registry = syntheticRegistry()) {
  const inbox = new MemoryInbox<Proj>("autocurb", { applied: [] }, effect, {
    registry: reg,
    key: keyOf(reg, "ac-dev-1"),
  });
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
  return {
    reg,
    inbox,
    gw,
    outbox,
    clock,
    transport,
    query,
    setDrop: (d: boolean) => {
      drop = d;
    },
  };
}
type World = ReturnType<typeof world>;

const unknownEpisode = () =>
  sealEnvelope({
    ...draftEnvelope("autolabels", "autocurb", "inventory.status_changed"),
    vehicle: { vin: "1HGCM82633A004352", instance_id: INSTANCE, episode_id: "ep-unknown" },
  });

async function pump(
  w: World,
  transport: Transport = w.transport,
  query: ReceiptQueryPort = w.query,
) {
  for (const r of w.outbox.claim("w1", w.clock.now, 50)) {
    if (r.lease_action === "confirm")
      await w.outbox.confirm(r, "w1", r.lease_generation, query, w.reg, w.clock.now, () => 0);
    else
      await w.outbox.deliver(r, "w1", r.lease_generation, transport, w.reg, w.clock.now, () => 0);
  }
}

const delivery = (envelope: EnvelopeV2, connection_id = CONN) => ({
  envelope,
  body_sha256: "x",
  key_id: "gw-dev-1",
  signer: "gateway" as const,
  connection_id,
  duplicate_delivery: false,
});

/** A second delivery of the same event: the same target database reached over another connection id. */
function viaOtherConnection(w: World) {
  const other = `${CONN}-renamed`;
  const renamed: Registry = {
    connections: w.reg.connections.map((c) =>
      c.connection_id === CONN ? { ...c, connection_id: other } : c,
    ),
    keys: w.reg.keys.map((k) => ({
      ...k,
      connection_ids: k.connection_ids.map((c) => (c === CONN ? other : c)),
    })),
  };
  const inbox = new MemoryInbox<Proj>("autocurb", w.inbox.projection, effect, {
    registry: renamed,
    key: keyOf(renamed, "ac-dev-1"),
  });
  inbox.rows = w.inbox.rows;
  inbox.watermarks = w.inbox.watermarks;
  return async (e: EnvelopeV2, at: number) =>
    inbox.receive(
      delivery(e, other),
      await signAdmission(e, other, keyOf(renamed, "gw-dev-1"), T0),
      at,
    );
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
    w.clock.now += 10;
    await pump(w);
    const row = w.outbox.rows.get(bad.envelope.event_id)!;
    expect(row.state).toBe("gateway_admitted");
    expect(row.last_error).toBe("target_inbox_pending");
    w.setDrop(false);
    const seen: ReceiptV2[] = [];
    const spy: ReceiptQueryPort = async (d, e) => {
      const chain = await w.query(d, e);
      seen.push(...chain);
      return chain;
    };
    await w.gw.forwardPending(w.clock.now);
    for (let k = 0; k < 3; k++) {
      w.clock.now = Math.max(w.clock.now, row.next_attempt_at);
      await pump(w, w.transport, spy);
    }
    expect(row.state).toBe("target_quarantined");
    expect(seen.filter((r) => r.kind === "consumer_commit")).toEqual([]);
    expect(seen.find((r) => r.kind === "target_inbox")?.outcome).toBe("quarantined");
    expect(row.receipts.some((r) => r.kind === "consumer_commit")).toBe(false);
    expect(w.inbox.projection.applied).toEqual([]);
  });

  it("a redelivery of a quarantined event, by the same or another delivery, reports quarantined and uncommitted", async () => {
    const w = world();
    const bad = await unknownEpisode();
    const adm = await signAdmission(bad.envelope, CONN, keyOf(w.reg, "gw-dev-1"), T0);
    const first = await w.inbox.receive(delivery(bad.envelope), adm, T0);
    expect(first).toMatchObject({ outcome: "quarantined", committed: false });
    for (let k = 1; k < 4; k++) {
      const again = await w.inbox.receive(delivery(bad.envelope), adm, T0 + k);
      expect(again.receipts).toEqual(first.receipts);
    }
    const viaOther = viaOtherConnection(w);
    for (let k = 0; k < 3; k++)
      expect(await viaOther(bad.envelope, T0 + k)).toMatchObject({
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
    const adm = await signAdmission(r2.envelope, CONN, keyOf(w.reg, "gw-dev-1"), T0);
    expect((await w.inbox.receive(delivery(r2.envelope), adm, T0)).outcome).toBe("held");
    expect(await w.inbox.receive(delivery(r2.envelope), adm, T0 + 1)).toMatchObject({
      outcome: "held",
      committed: false,
      committed_outcome: null,
    });
    expect(
      (await w.inbox.receive(delivery(r2.envelope), adm, T0 + 1)).receipts.map((x) => x.kind),
    ).toEqual(["target_inbox"]);
    expect(await viaOtherConnection(w)(r2.envelope, T0 + 2)).toMatchObject({
      outcome: "held",
      committed: false,
    });
  });

  it("crash during a quarantining delivery then retry: still no commit acknowledgment", async () => {
    const reg = syntheticRegistry();
    const inbox = new MemoryInbox<Proj>("autocurb", { applied: [] }, effect, {
      registry: reg,
      key: keyOf(reg, "ac-dev-1"),
    });
    let crash = true;
    const target = makeTarget("autocurb", inbox, reg, undefined, { crashAfterEffect: () => crash });
    const bad = await unknownEpisode();
    const sig = await signEnvelope(
      bad.body,
      bad.envelope,
      keyOf(reg, "gw-dev-1"),
      T0,
      "gw_nonce_crash_000001",
    );
    const fwd = {
      ...sig,
      [ADMISSION_HEADER]: encodeAdmissionHeader(
        await signAdmission(bad.envelope, CONN, keyOf(reg, "gw-dev-1"), T0),
      ),
    };
    const first = await target.handle(fwd, bad.body, T0);
    crash = false;
    const second = await target.handle(fwd, bad.body, T0);
    const third = await target.handle(fwd, bad.body, T0);
    expect(first.http_status).toBe(503);
    expect(inbox.deliveries.size).toBe(1);
    for (const r of [second, third])
      expect(r.receipts?.map((x) => `${x.kind}:${x.outcome}`)).toEqual([
        "target_inbox:quarantined",
      ]);
    expect(second.receipts).toEqual(third.receipts);
  });

  it("refuses to sign, and refuses to accept, a consumer_commit stating an uncommitted outcome", async () => {
    const reg = syntheticRegistry();
    const a = await sealEnvelope(
      draftEnvelope("autolabels", "autocurb", "inventory.status_changed"),
    );
    const delivery_id = await deliveryIdentity(a.envelope, CONN);
    const exp = {
      envelope: a.envelope,
      connection_id: CONN,
      delivery_id,
      kind: "consumer_commit" as const,
    };
    const admission = await signAdmission(a.envelope, CONN, keyOf(reg, "gw-dev-1"), T0);
    for (const outcome of ["quarantined", "held", "duplicate"] as const) {
      const draft = await receiptDraft(exp, outcome, T0, admission);
      await expect(signReceiptV2(draft, keyOf(reg, "ac-dev-1"))).rejects.toThrow(
        "receipt_invalid_shape",
      );
      // A target that bypasses the signer guard still cannot get the receipt accepted.
      const unsigned = { ...draft, key_id: "ac-dev-1" };
      const forged = {
        ...unsigned,
        signature: await hmacHex(
          keyOf(reg, "ac-dev-1").secret,
          `${RECEIPT_PROTOCOL}\n${canonicalize(unsigned)}`,
        ),
      };
      await expect(verifyReceiptV2(forged, exp, reg, T0, [admission])).rejects.toThrow(
        "ack_unsupported_version_or_shape",
      );
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
    await pump(w);
    const row = w.outbox.rows.get(a.envelope.event_id)!;
    const [adm] = await w.query(row.delivery_id, row.event_id);
    const exp = (kind: "target_inbox" | "consumer_commit") => ({
      envelope: a.envelope,
      connection_id: CONN,
      delivery_id: row.delivery_id,
      kind,
    });
    const ac = keyOf(w.reg, "ac-dev-1");
    const lying: ReceiptQueryPort = async () => {
      const held = await signReceiptV2(
        await receiptDraft(exp("target_inbox"), "held", T0, adm!),
        ac,
      );
      const commit = await signReceiptV2(
        await receiptDraft(exp("consumer_commit"), "applied", T0, held),
        ac,
      );
      return [adm!, held, commit];
    };
    w.clock.now += 10;
    await pump(w, w.transport, lying);
    expect(row.state).toBe("gateway_admitted");
    expect(row.last_error).toBe("ack_commit_without_effect");
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
    over: Partial<ReceiptV2> = {},
    keyId = "ac-dev-1",
    reg = syntheticRegistry(),
  ) {
    const a = await sealEnvelope(
      draftEnvelope("autolabels", "autocurb", "inventory.status_changed"),
    );
    const delivery_id = await deliveryIdentity(a.envelope, CONN);
    const ex = {
      envelope: a.envelope,
      connection_id: CONN,
      delivery_id,
      kind: "target_inbox" as const,
    };
    const admission = await signAdmission(
      a.envelope,
      CONN,
      keyOf(syntheticRegistry(), "gw-dev-1"),
      T0,
    );
    const draft = await receiptDraft(ex, "applied", T0, admission);
    const unsigned = { ...draft, ...over, key_id: keyId };
    const key = reg.keys.find((k) => k.key_id === keyId)!;
    const r = {
      ...unsigned,
      signature: await hmacHex(key.secret, `${RECEIPT_PROTOCOL}\n${canonicalize(unsigned)}`),
    } as ReceiptV2;
    return { r, ex, reg, admission };
  }
  const check = (s: Awaited<ReturnType<typeof signed>>, reg = s.reg, now = T0) =>
    verifyReceiptV2(s.r, s.ex, reg, now, [s.admission]);

  it("accepts a correctly bound receipt", async () => {
    const s = await signed();
    expect(await check(s)).toEqual(s.r);
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
    ["envelope_sha256", "0".repeat(64), "ack_wrong_envelope_sha256"],
    ["delivery_id", "0".repeat(64), "ack_wrong_delivery_id"],
  ] as const)(
    "refuses a validly signed receipt with a different %s",
    async (field, value, reason) => {
      const s = await signed({ [field]: value } as Partial<ReceiptV2>);
      await expect(check(s)).rejects.toThrow(reason);
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
    await expect(check(s)).rejects.toThrow("ack_key_not_authorized");
    s = await signed({ issued_at: ac.not_after + 1 }, "ac-dev-1", reg);
    await expect(check(s, reg, ac.not_after + 1)).rejects.toThrow("ack_key_not_authorized");
    s = await signed({}, "ac-legacy-1", reg);
    await expect(check(s)).rejects.toThrow("ack_key_not_authorized");
  });

  it("refuses a key not bound to the connection, a suspended connection and a future-dated receipt", async () => {
    const reg = syntheticRegistry();
    const unbound: Registry = {
      ...reg,
      keys: reg.keys.map((k) =>
        k.key_id === "ac-dev-1"
          ? { ...k, connection_ids: k.connection_ids.filter((c) => c !== CONN) }
          : k,
      ),
    };
    let s = await signed({}, "ac-dev-1", unbound);
    await expect(check(s)).rejects.toThrow("ack_key_not_authorized");
    const suspended: Registry = {
      ...reg,
      connections: reg.connections.map((c) =>
        c.connection_id === CONN ? { ...c, status: "suspended" } : c,
      ),
    };
    s = await signed({}, "ac-dev-1", suspended);
    await expect(check(s)).rejects.toThrow("ack_connection_not_authorized");
    s = await signed({ issued_at: T0 + 3600 }, "ac-dev-1", reg);
    await expect(check(s)).rejects.toThrow("ack_future_receipt");
  });

  it("chains the inbox receipt to the exact admission it follows", async () => {
    const s = await signed();
    expect(s.r.prev_receipt_sha256).toBe(await receiptDigest(s.admission));
    await expect(verifyReceiptV2(s.r, s.ex, s.reg, T0, [])).rejects.toThrow(
      "ack_missing_previous_stage",
    );
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
        c.connection_id === CONN ? { ...c, status: "revoked" } : c,
      ),
    };
    for (const r of w.outbox.claim("w1", w.clock.now, 1))
      await w.outbox.deliver(
        r,
        "w1",
        r.lease_generation,
        w.transport,
        revokedReg,
        w.clock.now,
        () => 0,
      );
    const row = w.outbox.rows.get(a.envelope.event_id)!;
    expect(row.state).toBe("retry_wait");
    expect(row.last_error).toBe("authorization:connection_revoked");
    expect(w.inbox.projection.applied).toEqual([]);
  });
});
