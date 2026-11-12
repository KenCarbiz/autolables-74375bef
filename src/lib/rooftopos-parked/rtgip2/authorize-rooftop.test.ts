// @vitest-environment node
import { describe, expect, it } from "vitest";
import { authorize, sealEnvelope, type Registry, type ServiceConnection } from "./protocol.ts";
import { draftEnvelope, syntheticRegistry, TENANT } from "./fixtures.ts";

const perRooftop = (rooftop: string, over: Partial<ServiceConnection> = {}): ServiceConnection => ({
  connection_id: `conn:autolabels>autocurb:${TENANT}:${rooftop}`,
  source_app: "autolabels",
  target_app: "autocurb",
  tenant_id: TENANT,
  rooftop_ids: [rooftop],
  event_types: ["vehicle.identity_registered"],
  purposes: ["inventory_sync"],
  producer_enabled: true,
  reader_enabled: true,
  status: "active",
  ...over,
});
const reg = (connections: ServiceConnection[]): Registry => ({
  connections,
  keys: syntheticRegistry().keys,
});
const envFor = async (rooftop: string) =>
  (
    await sealEnvelope({
      ...draftEnvelope("autolabels", "autocurb", "vehicle.identity_registered"),
      rooftop_id: rooftop,
    })
  ).envelope;

describe("authorize with one registry connection per rooftop", () => {
  it("selects the connection that grants the envelope's rooftop, whatever the order", async () => {
    const r = reg([perRooftop("rf-nw-01"), perRooftop("rf-nw-02")]);
    for (const roof of ["rf-nw-01", "rf-nw-02"]) {
      const az = authorize(await envFor(roof), r);
      expect(az.ok && az.connection.connection_id).toBe(
        `conn:autolabels>autocurb:${TENANT}:${roof}`,
      );
    }
  });
  it("refuses a rooftop no active connection grants", async () => {
    const r = reg([perRooftop("rf-nw-01"), perRooftop("rf-nw-02", { status: "revoked" })]);
    expect(authorize(await envFor("rf-nw-02"), r)).toEqual({
      ok: false,
      reason: "rooftop_not_granted",
    });
  });
  it("refuses when two active connections grant the same rooftop", async () => {
    const r = reg([perRooftop("rf-nw-01"), perRooftop("rf-nw-01", { connection_id: "conn:dup" })]);
    expect(authorize(await envFor("rf-nw-01"), r)).toEqual({
      ok: false,
      reason: "ambiguous_connection",
    });
  });
  it("reports a revoked tenant connection as revoked", async () => {
    const r = reg([perRooftop("rf-nw-01", { status: "suspended" })]);
    expect(authorize(await envFor("rf-nw-01"), r)).toEqual({
      ok: false,
      reason: "connection_revoked",
    });
  });
});
