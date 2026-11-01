import { describe, it, expect } from "vitest";
import { payloadChecksum, type EnvelopeV1 } from "../../../supabase/functions/_shared/integrations/envelope.ts";
import {
  isLiveGatewayDeliveryAllowed,
  translateVerifiedSoldEvent,
  type TrustedSourceBinding,
  type VerifiedSoldMilestone,
} from "./labels-gateway-v1";

const E: EnvelopeV1 = {
  event_id: "00000000-0000-4000-8000-000000000010",
  event_type: "autolabels.vehicle.sold",
  schema_version: "1.1.0",
  producer: "autolabels",
  source_record_id: "synthetic-sale-milestone-1",
  source_version: 12,
  idempotency_key: "synthetic-sold-event-1",
  correlation_id: "synthetic-corr-1",
  occurred_at: "2026-11-01T10:00:00.000Z",
  sent_at: "2026-11-01T10:00:01.000Z",
  vin: "1HGCM82633A004352",
  tenant_ref: "source-rooftop-syn-1",
  instance_ref: { app: "autolabels", id: "syn-vehicle-instance-1" },
  visibility: "tenant_private",
  evidence_refs: ["syn-custody-record-1"],
  payload: { milestone_ref: "synthetic-sale-milestone-1", status: "sold" },
};
const B: TrustedSourceBinding = {
  app: "autolabels",
  tenantId: "grp-syn-northwind",
  rooftopId: "store-syn-101",
  sourceTenantRef: "source-rooftop-syn-1",
  connectionId: "trusted-link-1",
  signatureVerified: true,
  replayChecked: true,
  serverValidatedAt: "2026-11-01T10:00:02.000Z",
  externalDeliveryEnabled: false,
};
const M: VerifiedSoldMilestone = {
  sourceRecordId: E.source_record_id,
  instanceId: E.instance_ref!.id,
  episodeId: "syn-sold-episode-1",
  evidenceRef: "syn-sale-evidence-1",
  state: "sold_verified",
};
async function envelope(patch: Partial<EnvelopeV1> = {}) {
  const e = { ...E, ...patch };
  e.payload_checksum = await payloadChecksum(e.payload);
  return e;
}
async function translate(
  patch: Partial<EnvelopeV1> = {},
  bind: TrustedSourceBinding = B,
  milestone: VerifiedSoldMilestone = M,
) {
  return translateVerifiedSoldEvent(await envelope(patch), bind, milestone);
}

describe("RooftopOS Gateway v1 AutoLabels PR46 adapter — inert, fail closed", () => {
  it("never sends events from this module", () => {
    expect(isLiveGatewayDeliveryAllowed()).toBe(false);
  });
  it("maps an authenticated final sold milestone into numeric Gateway v1 only", async () => {
    const g = await translate();
    expect(g.schema_version).toBe(1);
    expect(g.source_app).toBe("autolabels");
    expect(g.event_type).toBe("listing.sold");
    expect(g.aggregate).toEqual({ type: "vehicle_instance", id: M.instanceId, revision: 12 });
    expect(g.vehicle).toEqual({ vin: E.vin, instance_id: M.instanceId, episode_id: M.episodeId });
    expect(g.payload.immutable).toBe(true);
    expect(g.payload_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(g)).not.toMatch(/(phone|email|customer_name|ssn)/);
  });
  it("keeps event ID and payload hash stable under identical retry", async () => {
    const a = await translate(), b = await translate();
    expect(a.event_id).toBe(b.event_id);
    expect(a.payload_hash).toBe(b.payload_hash);
  });
  it("does not silently map other lifecycle events to sold", async () => {
    for (const t of [
      "autolabels.vehicle.delivered",
      "autolabels.vehicle.sale_voided",
      "autolabels.vehicle.archived",
      "autolabels.vehicle.updated",
      "autolabels.vehicle.price_changed",
    ]) {
      await expect(translate({ event_type: t })).rejects.toThrow("unsupported_semantic_mapping");
    }
  });
  it("refuses untranslated 1.0.0 or foreign v1 strings", async () => {
    await expect(translate({ schema_version: "1.0.0" })).rejects.toThrow("version_requires_explicit_v110");
    await expect(translate({ schema_version: "rooftop.v1" })).rejects.toThrow("invalid_pr46_envelope");
  });
  it("requires real instance and independently verified sale episode", async () => {
    await expect(translate({ instance_ref: null })).rejects.toThrow("unresolved_vehicle_instance");
    await expect(translate({}, B, { ...M, state: "pending" } as unknown as VerifiedSoldMilestone))
      .rejects.toThrow("custody_milestone_unverified");
    await expect(translate({}, B, { ...M, episodeId: "" })).rejects.toThrow("custody_milestone_unverified");
    await expect(translate({}, B, { ...M, instanceId: "another-instance" }))
      .rejects.toThrow("custody_milestone_unverified");
  });
  it("fails closed on wrong app, tenant source or rooftop binding", async () => {
    await expect(translate({}, { ...B, app: "autofilm" } as unknown as TrustedSourceBinding))
      .rejects.toThrow("verified_connection_binding_required");
    await expect(translate({}, { ...B, sourceTenantRef: "another-dealer" }))
      .rejects.toThrow("verified_connection_binding_required");
    await expect(translate({}, { ...B, signatureVerified: false } as unknown as TrustedSourceBinding))
      .rejects.toThrow("verified_connection_binding_required");
    await expect(translate({}, { ...B, replayChecked: false } as unknown as TrustedSourceBinding))
      .rejects.toThrow("verified_connection_binding_required");
    await expect(translate({}, { ...B, externalDeliveryEnabled: true } as unknown as TrustedSourceBinding))
      .rejects.toThrow("verified_connection_binding_required");
  });
  it("rejects tampered payload checksums", async () => {
    const e = await envelope();
    e.payload_checksum = "f".repeat(64);
    await expect(translateVerifiedSoldEvent(e, B, M)).rejects.toThrow("source_payload_hash_mismatch");
  });
  it("requires an explicit source payload checksum", async () => {
    const e = await envelope();
    delete e.payload_checksum;
    await expect(translateVerifiedSoldEvent(e, B, M)).rejects.toThrow("source_payload_checksum_required");
  });
  it("blocks PII and binary-bearing vehicle events, including nested fields", async () => {
    await expect(translate({ payload: { nested: { customer_phone: "555-0100" } } }))
      .rejects.toThrow("sensitive_field_blocked");
    await expect(translate({ payload: { media: [{ image_bytes: "b64" }] } }))
      .rejects.toThrow("binary_field_blocked");
  });
  it("does not share vehicle instances between same-VIN dealerships", async () => {
    const a = await translate();
    const b = await translate(
      { event_id: "00000000-0000-4000-8000-000000000011", instance_ref: { app: "autolabels", id: "syn-vehicle-instance-2" } },
      { ...B, tenantId: "grp-syn-lakeshore", rooftopId: "store-syn-201" },
      { ...M, instanceId: "syn-vehicle-instance-2", episodeId: "syn-episode-2" },
    );
    expect(a.vehicle.vin).toBe(b.vehicle.vin);
    expect(a.vehicle.instance_id).not.toBe(b.vehicle.instance_id);
    expect(a.tenant_id).not.toBe(b.tenant_id);
  });
});
