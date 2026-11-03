import { describe, expect, it } from "vitest";
import { authorize, sealEnvelope, type Registry, type ServiceConnection, type ServiceKey } from "./rtgip2/core";
import { deliveryIdentity, receiptDraft, signReceiptV2, verifyReceiptV2 } from "./rtgip2/receipt";

// GW-F2 and GW-F3 regressions against the vendored candidate (see PROVENANCE.json amendments).
const now = 1800000000;
const secret = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
const key = (owner: ServiceKey["owner"], connection_ids: string[]): ServiceKey => ({
  key_id: `key-${owner}`,
  owner,
  dialect: "rtgip/2",
  connection_ids,
  status: "current",
  not_before: now - 1000,
  not_after: now + 1000,
  secret: secret(),
});
const connection = (
  connection_id: string,
  rooftop_ids: string[],
  status: ServiceConnection["status"] = "active",
): ServiceConnection => ({
  connection_id,
  source_app: "autolabels",
  target_app: "autocurb",
  tenant_id: "synthetic-tenant",
  rooftop_ids,
  event_types: ["inventory.status_changed"],
  purposes: ["inventory_sync"],
  producer_enabled: true,
  reader_enabled: true,
  status,
});
const envelopeFor = async (rooftop_id: string) =>
  (
    await sealEnvelope({
      protocol: "rtgip/2",
      schema_version: 2,
      event_id: "",
      event_type: "inventory.status_changed",
      source_app: "autolabels",
      target_app: "autocurb",
      route: "autolabels->autocurb",
      purpose: "inventory_sync",
      tenant_id: "synthetic-tenant",
      rooftop_id,
      vehicle: { vin: "1HGCM82633A004352", instance_id: "synthetic-instance", episode_id: "synthetic-episode" },
      aggregate: { domain: "inventory", type: "episode", id: "synthetic-episode", revision: 1, prev_revision: null },
      origin: { app: "autolabels", event_id: "synthetic-origin", revision: 1 },
      correlation_id: "synthetic-correlation",
      causation_id: null,
      occurred_at: "2027-01-15T15:00:00Z",
      emitted_at: "2027-01-15T15:00:00Z",
      classification: "shared_vehicle_fact",
      payload: { status: "in_stock", stock_number: "SYN-1", changed_at: "2027-01-15T15:00:00Z" },
    })
  ).envelope;

describe("GW-F2: per-rooftop connections authorize by rooftop", () => {
  it("authorizes the second rooftop of a multi-rooftop tenant through its own connection", async () => {
    const reg: Registry = { keys: [], connections: [connection("conn-a", ["roof-a"]), connection("conn-b", ["roof-b"])] };
    const az = authorize(await envelopeFor("roof-b"), reg);
    expect(az.ok && az.connection.connection_id).toBe("conn-b");
  });
  it("refuses when two active connections grant the same rooftop", async () => {
    const reg: Registry = { keys: [], connections: [connection("conn-a", ["roof-a"]), connection("conn-a2", ["roof-a"])] };
    expect(authorize(await envelopeFor("roof-a"), reg)).toEqual({ ok: false, reason: "ambiguous_connection" });
  });
  it("still refuses an ungranted rooftop and a fully revoked tenant", async () => {
    const reg: Registry = { keys: [], connections: [connection("conn-a", ["roof-a"])] };
    expect(authorize(await envelopeFor("roof-z"), reg)).toEqual({ ok: false, reason: "rooftop_not_granted" });
    const revoked: Registry = { keys: [], connections: [connection("conn-a", ["roof-a"], "revoked")] };
    expect(authorize(await envelopeFor("roof-a"), revoked)).toEqual({ ok: false, reason: "connection_revoked" });
  });
});

describe("GW-F3: a receipt must name the connection authorize() selected", () => {
  it("refuses a receipt for a revoked connection while a sibling grants the rooftop", async () => {
    const gateway = key("gateway", ["conn-old", "conn-new"]);
    const reg: Registry = {
      keys: [gateway],
      connections: [connection("conn-old", ["roof-a"], "revoked"), connection("conn-new", ["roof-a"])],
    };
    const envelope = await envelopeFor("roof-a");
    const stale = { envelope, connection_id: "conn-old", delivery_id: await deliveryIdentity(envelope, "conn-old") };
    const receipt = await signReceiptV2(
      await receiptDraft({ ...stale, kind: "gateway_admission" }, "admitted", now, null),
      gateway,
    );
    await expect(
      verifyReceiptV2(receipt, { ...stale, kind: "gateway_admission" }, reg, now),
    ).rejects.toThrow("ack_connection_not_authorized");

    const live = { envelope, connection_id: "conn-new", delivery_id: await deliveryIdentity(envelope, "conn-new") };
    const good = await signReceiptV2(
      await receiptDraft({ ...live, kind: "gateway_admission" }, "admitted", now, null),
      gateway,
    );
    await expect(verifyReceiptV2(good, { ...live, kind: "gateway_admission" }, reg, now)).resolves.toEqual(good);
  });
});

describe("GW-F6: the handler answers permanent refusals 4xx and keeps 503 for unknown durability", async () => {
  const { createRtgip2Handler } = await import("./rtgip2/handler.server");
  const { signEnvelope } = await import("./rtgip2/core");
  const source = key("autolabels", ["conn-a"]);
  const gateway = key("gateway", ["conn-a"]);
  const reg: Registry = { keys: [source, gateway], connections: [connection("conn-a", ["roof-a"])] };
  const mappingFor = (episode_id: string) => ({
    tenant_id: "synthetic-tenant",
    rooftop_id: "roof-a",
    source_app: "autolabels",
    source_store_id: "store",
    instance_id: "synthetic-instance",
    episode_id,
    vin: "1HGCM82633A004352",
    connection_id: "conn-a",
    status: "active" as const,
    reviewed_ref: "reviewed",
  });
  const sealed = async () => {
    const { sealEnvelope: seal } = await import("./rtgip2/core");
    return seal({ ...(await envelopeFor("roof-a")), event_id: "" });
  };
  const call = async (
    opts: { mappings?: ReturnType<typeof mappingFor>[]; admit?: () => Promise<never>; registryFails?: boolean; tamper?: boolean; body?: string } = {},
  ) => {
    const { envelope, body } = await sealed();
    const t = Math.floor(Date.now() / 1000);
    const handler = createRtgip2Handler(
      {
        registry: async () => {
          if (opts.registryFails) throw new Error("db_down");
          return { registry: { ...reg, keys: reg.keys.map((k) => ({ ...k, not_before: t - 100, not_after: t + 100 })) }, mappings: opts.mappings ?? [mappingFor("synthetic-episode")] };
        },
        now: () => t,
        admit: opts.admit ?? (async () => { throw new Error("db_timeout"); }),
        resolveSigningKey: async () => gateway,
        persistSignedEvidence: async () => {},
      },
      true,
    );
    const headers = await signEnvelope(body, envelope, { ...source, not_before: t - 100, not_after: t + 100 }, t, "f6_nonce_000000001");
    if (opts.tamper) headers["rtgip-signature"] = "rtgip2=" + "0".repeat(64);
    const res = await handler(new Request("http://localhost/f6", { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: opts.body ?? body }));
    return { status: res.status, error: ((await res.json()) as { error?: string }).error };
  };
  it("bad signature is 401", async () => {
    expect(await call({ tamper: true })).toEqual({ status: 401, error: "bad_signature" });
  });
  it("an unmapped episode is 403", async () => {
    expect(await call({ mappings: [mappingFor("other-episode")] })).toEqual({ status: 403, error: "ambiguous_or_unauthorized_mapping" });
  });
  it("a malformed body is 400", async () => {
    expect((await call({ body: '{"a":1,"a":2}' })).status).toBe(400);
  });
  it("a conflicting admission is 409", async () => {
    expect(await call({ admit: async () => { throw new Error("admission_conflict"); } })).toEqual({ status: 409, error: "admission_conflict" });
  });
  it("a SQL authorization refusal under locks is 403", async () => {
    expect(await call({ admit: async () => { throw new Error("admission_forbidden"); } })).toEqual({ status: 403, error: "admission_forbidden" });
  });
  it("registry and durability failures stay 503", async () => {
    expect(await call({ registryFails: true })).toEqual({ status: 503, error: "admission_not_confirmed" });
    expect(await call()).toEqual({ status: 503, error: "admission_not_confirmed" });
  });
});
