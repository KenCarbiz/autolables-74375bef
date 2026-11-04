import { describe, expect, it } from "vitest";
import {
  sealEnvelope,
  signEnvelope,
  type EnvelopeV2,
  type Registry,
  type ServiceKey,
} from "./core";
import {
  deliveryIdentity,
  receiptDraft,
  signReceiptV2,
  verifyReceiptV2,
  type ReceiptV2,
} from "./receipt";
import { verifyAdmission, type IdentityMapping } from "./verify";
import { strictBody } from "./wire";
import { liveActivationDenial } from "./activation";
import { createRtgip2Handler } from "./handler.server";

// Ephemeral local-only cryptographic material; never provisioned, persisted or printed.
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
  const { envelope, body } = await sealEnvelope({
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
  const mapping: IdentityMapping = {
    tenant_id: envelope.tenant_id,
    rooftop_id: envelope.rooftop_id,
    source_app: envelope.source_app,
    source_store_id: "synthetic-store",
    instance_id: envelope.vehicle.instance_id,
    episode_id: envelope.vehicle.episode_id,
    vin: envelope.vehicle.vin,
    connection_id: conn,
    status: "active",
    reviewed_ref: "synthetic-reviewed",
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
  return {
    source,
    gateway,
    target,
    envelope,
    body,
    registry,
    mapping,
    expectation,
    admission,
    inbox,
    commit,
  };
}
describe("receipt-v2 cryptographic binding", () => {
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
describe("admission and isolation", () => {
  it("verifies signed ingress without reserving a durable nonce", async () => {
    const f = await fixture();
    const headers = await signEnvelope(f.body, f.envelope, f.source, now, "synthetic_nonce_00001");
    expect(
      (
        await verifyAdmission(
          { ...headers },
          new TextEncoder().encode(f.body),
          f.registry,
          [f.mapping],
          now,
        )
      ).connection_id,
    ).toBe(conn);
  });
  it.each([
    "tenant_id",
    "rooftop_id",
    "instance_id",
    "episode_id",
    "vin",
    "connection_id",
  ] as const)("rejects wrong registry %s", async (field) => {
    const f = await fixture();
    const headers = await signEnvelope(f.body, f.envelope, f.source, now, "synthetic_nonce_00001");
    await expect(
      verifyAdmission(
        { ...headers },
        new TextEncoder().encode(f.body),
        f.registry,
        [{ ...f.mapping, [field]: "wrong" }],
        now,
      ),
    ).rejects.toThrow("ambiguous_or_unauthorized_mapping");
  });
  it("rejects ambiguous reviewed identity rows", async () => {
    const f = await fixture();
    const headers = await signEnvelope(f.body, f.envelope, f.source, now, "synthetic_nonce_00001");
    await expect(
      verifyAdmission(
        { ...headers },
        new TextEncoder().encode(f.body),
        f.registry,
        [f.mapping, f.mapping],
        now,
      ),
    ).rejects.toThrow("ambiguous_or_unauthorized_mapping");
  });
  it("cannot activate live connections even with every requested switch enabled", async () => {
    const f = await fixture();
    expect(
      liveActivationDenial(f.envelope, conn, {
        global_kill: false,
        application_enabled: { autolabels: true, autocurb: true },
        tenant_enabled: { "synthetic-tenant": true },
        rooftop_enabled: { "synthetic-roof": true },
        connection_enabled: { [conn]: true },
        routes: [f.envelope.route],
        security_accepted: true,
        staging_accepted: true,
        deployment_approval_ref: "synthetic",
      }),
    ).toBe("external_delivery_hardcoded_off");
  });
  it("returns no signed success receipt after admission rejects", async () => {
    const f = await fixture();
    let keyResolved = false;
    const handler = createRtgip2Handler(
      {
        registry: async () => ({ registry: f.registry, mappings: [f.mapping] }),
        now: () => now,
        admit: async () => {
          throw new Error("rejected");
        },
        resolveSigningKey: async () => {
          keyResolved = true;
          return f.gateway;
        },
        persistSignedEvidence: async () => {},
      },
      true,
    );
    const response = await handler(
      new Request("http://localhost/local-test", {
        method: "POST",
        headers: {
          ...(await signEnvelope(f.body, f.envelope, f.source, now, "synthetic_nonce_00001")),
          "content-type": "application/json",
        },
        body: f.body,
      }),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "admission_not_confirmed" });
    expect(keyResolved).toBe(false);
  });
  it.each([
    '{"a":1,"a":2}',
    '{"a":"\\u0000"}',
    '{"a":"\\ud800"}',
    '{"a":1.2}',
    '{"a":9007199254740992}',
    '{"a":1} trailing',
  ])("rejects unsafe wire %s", (text) => {
    expect(() => strictBody(new TextEncoder().encode(text))).toThrow();
  });
  it("rejects invalid UTF8 and a BOM", () => {
    expect(() => strictBody(new Uint8Array([0xc0, 0xaf]))).toThrow("invalid_utf8");
    expect(() => strictBody(new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d]))).toThrow(
      "bom_forbidden",
    );
  });
});
