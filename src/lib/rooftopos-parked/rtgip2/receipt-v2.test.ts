// @vitest-environment node
import { describe, expect, it } from "vitest";
import { sealEnvelope, type EnvelopeV2, type Registry, type ServiceKey } from "./protocol.ts";
import {
  deliveryIdentity,
  receiptDigest,
  receiptDraft,
  signReceiptV2,
  verifyReceiptV2,
  type ReceiptV2,
} from "./receipt-v2.ts";
import vectors from "./rtgip2-receipt-v2.v1.json";

const secret = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
const now = 1800000000;
const conn = "conn-synthetic";
const key = (owner: ServiceKey["owner"]): ServiceKey => ({
  key_id: `key-${owner}`,
  owner,
  dialect: "rtgip/2",
  connection_ids: [conn],
  status: "current",
  not_before: now - 1000,
  not_after: now + 1000,
  secret: secret(),
});
async function fixture() {
  const source = key("autolabels"),
    gateway = key("gateway"),
    target = key("autocurb");
  const { envelope } = await sealEnvelope({
    protocol: "rtgip/2",
    schema_version: 2,
    event_id: "",
    event_type: "inventory.status_changed",
    source_app: "autolabels",
    target_app: "autocurb",
    route: "autolabels->autocurb",
    purpose: "inventory_sync",
    tenant_id: "synthetic-tenant",
    rooftop_id: "synthetic-roof",
    vehicle: {
      vin: "1HGCM82633A004352",
      instance_id: "synthetic-instance",
      episode_id: "synthetic-episode",
    },
    aggregate: {
      domain: "inventory",
      type: "episode",
      id: "synthetic-episode",
      revision: 1,
      prev_revision: null,
    },
    origin: { app: "autolabels", event_id: "synthetic-origin", revision: 1 },
    correlation_id: "synthetic-correlation",
    causation_id: null,
    occurred_at: "2027-01-15T15:00:00Z",
    emitted_at: "2027-01-15T15:00:00Z",
    classification: "shared_vehicle_fact",
    payload: { status: "in_stock", stock_number: "SYN-1", changed_at: "2027-01-15T15:00:00Z" },
  });
  const registry: Registry = {
    keys: [source, gateway, target],
    connections: [
      {
        connection_id: conn,
        source_app: "autolabels",
        target_app: "autocurb",
        tenant_id: envelope.tenant_id,
        rooftop_ids: [envelope.rooftop_id],
        event_types: [envelope.event_type],
        purposes: [envelope.purpose],
        producer_enabled: true,
        reader_enabled: true,
        status: "active",
      },
    ],
  };
  const expectation = {
    envelope,
    connection_id: conn,
    delivery_id: await deliveryIdentity(envelope, conn),
  };
  const admission = await signReceiptV2(
    await receiptDraft({ ...expectation, kind: "gateway_admission" }, "admitted", now, null),
    gateway,
  );
  const inbox = await signReceiptV2(
    await receiptDraft({ ...expectation, kind: "target_inbox" }, "applied", now, admission),
    target,
  );
  const commit = await signReceiptV2(
    await receiptDraft({ ...expectation, kind: "consumer_commit" }, "applied", now, inbox),
    target,
  );
  return { source, gateway, target, envelope, registry, expectation, admission, inbox, commit };
}

describe("receipt-v2 cryptographic binding (Gateway receipt.test.ts, adopted)", () => {
  it("recovers the identical admission receipt after non-revoked key rotation", async () => {
    const f = await fixture();
    const draft = await receiptDraft(
      { ...f.expectation, kind: "gateway_admission" },
      "admitted",
      now,
      null,
    );
    expect(await signReceiptV2(draft, { ...f.gateway, status: "previous" })).toEqual(f.admission);
    await expect(signReceiptV2(draft, { ...f.gateway, status: "revoked" })).rejects.toThrow(
      "receipt_signer_not_authorized",
    );
  });
  it("verifies all three authorized linked stages", async () => {
    const f = await fixture();
    expect(
      await verifyReceiptV2(
        f.commit,
        { ...f.expectation, kind: "consumer_commit" },
        f.registry,
        now,
        [f.admission, f.inbox],
      ),
    ).toEqual(f.commit);
  });
  it.each([
    "event_id",
    "envelope_sha256",
    "target_app",
    "recipient",
    "kind",
    "prev_receipt_sha256",
    "issuer",
    "delivery_id",
    "protocol",
  ] as const)("rejects changed %s", async (field) => {
    const f = await fixture();
    await expect(
      verifyReceiptV2(
        { ...f.commit, [field]: "tampered" },
        { ...f.expectation, kind: "consumer_commit" },
        f.registry,
        now,
        [f.admission, f.inbox],
      ),
    ).rejects.toThrow();
  });
  it("rejects a same-payload envelope with a changed aggregate revision", async () => {
    const f = await fixture();
    const envelope: EnvelopeV2 = {
      ...f.envelope,
      aggregate: { ...f.envelope.aggregate, revision: 2 },
    };
    await expect(
      verifyReceiptV2(
        f.commit,
        { ...f.expectation, envelope, kind: "consumer_commit" },
        f.registry,
        now,
        [f.admission, f.inbox],
      ),
    ).rejects.toThrow("ack_wrong_envelope_sha256");
  });
  it("rejects an isolated consumer commit", async () => {
    const f = await fixture();
    await expect(
      verifyReceiptV2(f.commit, { ...f.expectation, kind: "consumer_commit" }, f.registry, now),
    ).rejects.toThrow("ack_missing_previous_stage");
  });
  it("rejects an invalid ancestor even when the signed child points at it", async () => {
    const f = await fixture();
    const admission: ReceiptV2 = { ...f.admission, signature: "0".repeat(64) };
    const inbox = await signReceiptV2(
      await receiptDraft({ ...f.expectation, kind: "target_inbox" }, "applied", now, admission),
      f.target,
    );
    await expect(
      verifyReceiptV2(inbox, { ...f.expectation, kind: "target_inbox" }, f.registry, now, [
        admission,
      ]),
    ).rejects.toThrow("ack_bad_signature");
  });
  it("rejects a legacy v1 receipt without rewriting historical evidence", async () => {
    const f = await fixture();
    await expect(
      verifyReceiptV2(
        { ...f.commit, protocol: "rtgip/2", receipt_version: 1 },
        { ...f.expectation, kind: "consumer_commit" },
        f.registry,
        now,
        [f.admission, f.inbox],
      ),
    ).rejects.toThrow("ack_unsupported_version_or_shape");
  });
  it("rejects a commit linked to quarantined inbox", async () => {
    const f = await fixture();
    const inbox = await signReceiptV2(
      await receiptDraft(
        { ...f.expectation, kind: "target_inbox" },
        "quarantined",
        now,
        f.admission,
      ),
      f.target,
    );
    const commit = await signReceiptV2(
      await receiptDraft({ ...f.expectation, kind: "consumer_commit" }, "applied", now, inbox),
      f.target,
    );
    await expect(
      verifyReceiptV2(commit, { ...f.expectation, kind: "consumer_commit" }, f.registry, now, [
        f.admission,
        inbox,
      ]),
    ).rejects.toThrow("ack_commit_without_effect");
  });
  it("rejects a revoked destination key", async () => {
    const f = await fixture();
    const registry = {
      ...f.registry,
      keys: f.registry.keys.map((k) =>
        k.owner === "autocurb" ? { ...k, status: "revoked" as const } : k,
      ),
    };
    await expect(
      verifyReceiptV2(f.commit, { ...f.expectation, kind: "consumer_commit" }, registry, now, [
        f.admission,
        f.inbox,
      ]),
    ).rejects.toThrow("ack_key_not_authorized");
  });
});

describe("receipt-v2 shared vectors (rtgip2-receipt-v2.v1.json)", () => {
  type V = (typeof vectors)["chains"][number];
  const registry = vectors.registry as unknown as Registry;
  const exp = async (v: V, kind: ReceiptV2["kind"], body = v.body) => ({
    envelope: JSON.parse(body) as EnvelopeV2,
    connection_id: v.connection_id,
    delivery_id: v.delivery_id,
    kind,
  });
  it.each(vectors.chains.map((v) => [v.name, v] as const))(
    "%s verifies and re-signs byte-identically",
    async (_n, v) => {
      const env = JSON.parse(v.body) as EnvelopeV2;
      expect(await deliveryIdentity(env, v.connection_id)).toBe(v.delivery_id);
      const chain = v.receipts as unknown as ReceiptV2[];
      for (let i = 0; i < chain.length; i++) {
        const r = chain[i]!;
        await verifyReceiptV2(r, await exp(v, r.kind), registry, vectors.now, chain.slice(0, i));
        const k = registry.keys.find((x) => x.key_id === r.key_id)!;
        const again = await signReceiptV2(
          await receiptDraft(
            await exp(v, r.kind),
            r.outcome,
            r.issued_at,
            i ? chain[i - 1]! : null,
          ),
          k,
        );
        expect(JSON.stringify(again)).toBe(JSON.stringify(r));
        expect(await receiptDigest(r)).toBe(v.digests[i]);
      }
    },
  );
  it.each(vectors.negative.map((n) => [n.name, n] as const))("refuses %s", async (_n, n) => {
    const v = vectors.chains.find((c) => c.name === n.chain)!;
    const chain = n.receipts as unknown as ReceiptV2[];
    const last = chain[chain.length - 1]!;
    const reg = ("registry" in n ? n.registry : vectors.registry) as unknown as Registry;
    const body = "body" in n ? (n.body as string) : v.body;
    await expect(
      verifyReceiptV2(
        last,
        await exp(v, last.kind, body),
        reg,
        "now" in n ? (n.now as number) : vectors.now,
        chain.slice(0, -1),
      ),
    ).rejects.toThrow(n.error);
  });
});
