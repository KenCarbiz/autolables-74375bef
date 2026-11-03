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
