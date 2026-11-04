import { describe, expect, it } from "vitest";
import { sealEnvelope, signEnvelope, type ServiceKey } from "./rtgip2/core";
import { createRtgip2Handler, type DurableAdmission } from "./rtgip2/handler.server";
import { deliveryIdentity, verifyReceiptV2 } from "./rtgip2/receipt";

// Decision 1 (contract freeze): durable admission intent first, then recoverable signed-receipt
// persistence, and no signed success before that persistence has committed.
const t = Math.floor(Date.now() / 1000);
const hex = (n: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, "0")).join("");
const key = (owner: ServiceKey["owner"]): ServiceKey => ({
  key_id: `key-${owner}`, owner, dialect: "rtgip/2", connection_ids: ["conn-a"], status: "current",
  not_before: t - 100, not_after: t + 100, secret: hex(32),
});
const source = key("autolabels");
const gateway = key("gateway");
const registry = {
  keys: [source, gateway],
  connections: [{
    connection_id: "conn-a", source_app: "autolabels", target_app: "autocurb", tenant_id: "synthetic-tenant",
    rooftop_ids: ["roof-a"], event_types: ["inventory.status_changed"], purposes: ["inventory_sync"],
    status: "active", producer_enabled: true, reader_enabled: true, reviewed_ref: "reviewed",
  }],
} as never;
const mapping = {
  tenant_id: "synthetic-tenant", rooftop_id: "roof-a", source_app: "autolabels", source_store_id: "store",
  instance_id: "synthetic-instance", episode_id: "synthetic-episode", vin: "1HGCM82633A004352",
  connection_id: "conn-a", status: "active" as const, reviewed_ref: "reviewed",
};

async function run(persist: (d: DurableAdmission) => Promise<void>) {
  const { envelope, body } = await sealEnvelope({
    protocol: "rtgip/2", schema_version: 2, event_id: "", event_type: "inventory.status_changed",
    source_app: "autolabels", target_app: "autocurb", route: "autolabels->autocurb", purpose: "inventory_sync",
    tenant_id: "synthetic-tenant", rooftop_id: "roof-a",
    vehicle: { vin: "1HGCM82633A004352", instance_id: "synthetic-instance", episode_id: "synthetic-episode" },
    aggregate: { domain: "inventory", type: "episode", id: "synthetic-episode", revision: 1, prev_revision: null },
    origin: { app: "autolabels", event_id: "synthetic-origin", revision: 1 },
    correlation_id: "synthetic-correlation", causation_id: null,
    occurred_at: "2027-01-15T15:00:00Z", emitted_at: "2027-01-15T15:00:00Z", classification: "shared_vehicle_fact",
    payload: { status: "in_stock", stock_number: "SYN-1", changed_at: "2027-01-15T15:00:00Z" },
  } as never);
  const sha = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body))),
    (b) => b.toString(16).padStart(2, "0")).join("");
  const durable: DurableAdmission = {
    outcome: "admitted", connection_id: "conn-a", envelope_sha256: sha,
    delivery_id: await deliveryIdentity(envelope, "conn-a"), issued_at: t, gateway_key_id: gateway.key_id,
  };
  const persisted: unknown[] = [];
  const handler = createRtgip2Handler({
    registry: async () => ({ registry, mappings: [mapping] }),
    now: () => t,
    admit: async () => durable,
    resolveSigningKey: async () => gateway,
    persistSignedEvidence: async (d, r) => { await persist(d); persisted.push(r); },
  }, true);
  const headers = await signEnvelope(body, envelope, source, t, `dur_${hex(8)}`);
  const res = await handler(new Request("http://localhost/d", { method: "POST", headers: { ...headers, "content-type": "application/json" }, body }));
  return { status: res.status, doc: (await res.json()) as Record<string, unknown>, persisted, envelope, durable };
}

describe("Decision 1: no signed success before receipt persistence", () => {
  it("a crash while persisting the signed receipt answers 503 with no receipt", async () => {
    const r = await run(async () => { throw new Error("connection_lost"); });
    expect(r.status).toBe(503);
    expect(r.doc).toEqual({ error: "admission_not_confirmed" });
    expect(r.persisted).toHaveLength(0);
  });
  it("success returns exactly the receipt that was persisted, and it verifies", async () => {
    const r = await run(async () => {});
    expect(r.status).toBe(200);
    expect(r.persisted).toHaveLength(1);
    expect(r.doc.receipt).toEqual(r.persisted[0]);
    await expect(verifyReceiptV2(r.doc.receipt as never, {
      envelope: r.envelope, connection_id: "conn-a", delivery_id: r.durable.delivery_id, kind: "gateway_admission",
    }, registry, t)).resolves.toBeTruthy();
  });
});
