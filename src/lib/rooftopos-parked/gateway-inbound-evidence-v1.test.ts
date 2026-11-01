import { describe, expect, it } from "vitest";
import {
  evaluateGatewayEvidenceV1,
  canActivateGatewayInbound,
  type CanonicalGatewayEvent,
  type ServerVerifiedDelivery,
  type ResolvedVehicleScope,
  type LockedSourceReceipt,
} from "./gateway-inbound-evidence-v1";

const E: CanonicalGatewayEvent = {
  event_id: "00000000-0000-4000-8000-000000000111",
  schema_version: 1,
  source_app: "autofilm",
  event_type: "service.mpi_verified",
  tenant_id: "syn-tenant-a",
  rooftop_id: "syn-rooftop-a",
  vehicle: { vin: "1HGCM82633A004352", instance_id: "syn-instance-a", episode_id: "syn-episode-a" },
  aggregate: { type: "vehicle_instance", id: "syn-instance-a", revision: 5 },
  occurred_at: "2026-11-01T10:00:00Z",
  emitted_at: "2026-11-01T10:00:05Z",
  classification: "internal",
  payload_hash: "a".repeat(64),
  payload: {
    mpi_id: "syn-mpi-1", service_visit_ref: "syn-visit-1",
    evidence_ref: "syn-reviewed-mpi-1", verification_state: "verified",
  },
  refs: { service_visit_ref: "syn-visit-1", evidence_refs: ["syn-reviewed-mpi-1"] },
};
const A: ServerVerifiedDelivery = {
  connectionId: "syn-server-key-1", signerApp: "autofilm",
  tenantId: "syn-tenant-a", rooftopId: "syn-rooftop-a",
  destinationApp: "autolabels", signatureVerified: true,
  replayChecked: true, payloadChecksumVerified: true,
  externalTransportEnabled: false,
};
const V: ResolvedVehicleScope = {
  tenantId: E.tenant_id, rooftopId: E.rooftop_id,
  vin: E.vehicle.vin, instanceId: E.vehicle.instance_id, episodeId: E.vehicle.episode_id!,
  lifecycle: "inventory",
};
const R: LockedSourceReceipt = { lastSourceRevision: 4 };
const testEvent = (
  event: CanonicalGatewayEvent = E, auth: ServerVerifiedDelivery = A,
  vehicle: ResolvedVehicleScope | null = V, receipt: LockedSourceReceipt = R,
) => evaluateGatewayEvidenceV1(event, auth, vehicle, receipt);

describe("AutoLabels parked Gateway inbound projections — no deployment", () => {
  it("cannot activate live transport from this adapter", () => {
    expect(canActivateGatewayInbound()).toBe(false);
  });
  it("accepts only reviewed MPI service evidence, never reopens inventory", () => {
    const out = testEvent();
    expect(out.status).toBe("ready");
    if (out.status === "ready") {
      expect(out.effect).toMatchObject({
        kind: "verified_service_evidence", sourceApp: "autofilm",
        visitRef: "syn-visit-1", reopenInventory: false,
      });
      expect(out.sourceRevision).toBe(5);
    }
  });
  it("sold/delivered service visit does not reactivate sale", () => {
    for (const lifecycle of ["sold", "delivered", "service"] as const) {
      const out = testEvent(E, A, { ...V, lifecycle });
      expect(out.status).toBe("ready");
      if (out.status === "ready") expect(out.effect.reopenInventory).toBe(false);
    }
  });
  it("unverified MPI and inspection-completed are not equivalent", () => {
    expect(testEvent({ ...E, payload: { ...E.payload, verification_state: "recommended" } }).status)
      .toBe("held");
    expect(testEvent({ ...E, event_type: "inspection.completed" }).status).toBe("rejected");
    expect(testEvent({ ...E, refs: {}, payload: { mpi_id: "X", verification_state: "verified" } }).status)
      .toBe("held");
  });
  it("requires verified server identity, scoped tenant and rooftop", () => {
    for (const bad of [
      { signerApp: "autocurb" },
      { tenantId: "syn-tenant-b" },
      { rooftopId: "syn-rooftop-b" },
      { signatureVerified: false },
      { replayChecked: false },
      { payloadChecksumVerified: false },
      { externalTransportEnabled: true },
      { connectionId: "" },
    ]) {
      expect(testEvent(E, { ...A, ...bad } as ServerVerifiedDelivery).status).toBe("rejected");
    }
  });
  it("holds unknown vehicle instance instead of creating from VIN", () => {
    expect(testEvent(E, A, null)).toEqual({
      status: "held", reason: "unresolved_registered_vehicle_instance",
    });
  });
  it("rejects rooftop/instance conflicts and holds mismatched episode", () => {
    expect(testEvent(E, A, { ...V, tenantId: "syn-tenant-b" }).status).toBe("rejected");
    expect(testEvent(E, A, { ...V, instanceId: "different-instance" }).status).toBe("rejected");
    expect(testEvent(E, A, { ...V, episodeId: "old-episode" }).status).toBe("held");
  });
  it("replayed same event+hash is duplicate, conflicting hash is conflict", () => {
    expect(testEvent(E, A, V, { lastSourceRevision: 5, seenHashForEventId: E.payload_hash }).status)
      .toBe("duplicate");
    expect(testEvent(E, A, V, { lastSourceRevision: 5, seenHashForEventId: "b".repeat(64) }).status)
      .toBe("conflict");
  });
  it("old revision, incorrect aggregate identity and foreign protocol rejected", () => {
    expect(testEvent(E, A, V, { lastSourceRevision: 6 }).status).toBe("stale");
    expect(testEvent({ ...E, aggregate: { ...E.aggregate, id: "a-different-vehicle" } }).status)
      .toBe("rejected");
    expect(testEvent({ ...E, schema_version: "1.1.0" as unknown as number }).status)
      .toBe("rejected");
  });
  it("rejects binary, PII and signed/public image links in payload", () => {
    for (const payload of [
      { ...E.payload, customer_email: "hidden@example.test" },
      { ...E.payload, data_base64: "SGVsbG8=" },
      { ...E.payload, image_url: "https://example.test/img" },
      { ...E.payload, secret: "not-allowed" },
    ]) {
      expect(testEvent({ ...E, payload }).status).toBe("rejected");
    }
  });
  const APP: CanonicalGatewayEvent = {
    ...E, source_app: "autocurb", event_type: "appraisal.completed",
    payload: {
      verified_state: "finalized", source_submission_ref: "syn-submission-1",
      appraisal_finalized_by_ref: "syn-reviewer-1",
      appraisal_finalized_at: "2026-11-01T10:00:00Z", acv_value: 21500,
    },
  };
  const CA: ServerVerifiedDelivery = { ...A, signerApp: "autocurb" };
  it("accepts finalized AutoCurb appraisal evidence without altering published price", () => {
    const res = testEvent(APP, CA);
    expect(res.status).toBe("ready");
    if (res.status === "ready") {
      expect(res.effect).toMatchObject({
        kind: "acquisition_evidence", eventType: "appraisal.completed",
        changePublishedPrice: false, reopenInventory: false,
      });
    }
  });
  it("rejects offer acceptance and unverified purchase custody", () => {
    expect(testEvent({ ...APP, payload: { ...APP.payload, verified_state: "offer_accepted" } }, CA).status)
      .toBe("held");
    expect(testEvent({
      ...APP, event_type: "acquisition.closed",
      payload: { verified_state: "deal_finalized", purchase_ref: "P1" },
    }, CA).status).toBe("held");
  });
  it("accepts audited acquisition only as evidence, not a new listing", () => {
    const res = testEvent({
      ...APP, event_type: "acquisition.closed",
      payload: { verified_state: "purchased", purchase_ref: "syn-purchase-1",
        custody_verified_at: "2026-11-01T10:00:11Z" },
    }, CA);
    expect(res.status).toBe("ready");
    if (res.status === "ready") {
      expect(res.effect.kind).toBe("acquisition_evidence");
      expect(res.effect.reopenInventory).toBe(false);
    }
  });
  const MEDIA: CanonicalGatewayEvent = {
    ...E, source_app: "autoframe", event_type: "media.approved",
    classification: "media_meta",
    payload: {
      media_id: "syn-media-1",
      content_sha256: "c".repeat(64),
      object_ref: "objref:synthetic-bucket/tenant/rooftop/vehicle/asset.webp",
      mime: "image/webp", width: 1600, height: 1200,
      preset_version: "studio-1", preset_order: 1,
      approval: { role: "inventory_manager", approval_id: "syn-approval-1",
        approved_at: "2026-11-01T10:00:00Z" },
    },
  };
  const FA: ServerVerifiedDelivery = { ...A, signerApp: "autoframe" };
  it("accepts manager-approved image metadata without changing inventory", () => {
    const res = testEvent(MEDIA, FA, { ...V, lifecycle: "sold" });
    expect(res.status).toBe("ready");
    if (res.status === "ready") {
      expect(res.effect).toMatchObject({
        kind: "approved_media_reference", mediaId: "syn-media-1",
        publishPublicUrl: false, reopenInventory: false,
      });
    }
  });
  it("rejects untrusted media approver, URL, binary and mismatched source", () => {
    expect(testEvent({
      ...MEDIA, payload: { ...MEDIA.payload, approval: {
        role: "staff", approval_id: "a", approved_at: E.occurred_at,
      } },
    }, FA).status).toBe("rejected");
    expect(testEvent({ ...MEDIA, payload: {
      ...MEDIA.payload, object_ref: "https://public.example.test/image.webp",
    } }, FA).status).toBe("rejected");
    expect(testEvent({ ...MEDIA, payload: {
      ...MEDIA.payload, data_base64: "AAA",
    } }, FA).status).toBe("rejected");
    expect(testEvent(MEDIA, A).status).toBe("rejected");
  });
  it("same VIN in another dealer must never resolve to original custody episode", () => {
    const otherDealer: CanonicalGatewayEvent = {
      ...E, tenant_id: "syn-tenant-b", rooftop_id: "syn-rooftop-b",
      vehicle: { ...E.vehicle, instance_id: "syn-instance-b", episode_id: "syn-episode-b" },
      aggregate: { ...E.aggregate, id: "syn-instance-b" },
    };
    const otherAuth: ServerVerifiedDelivery = {
      ...A, tenantId: "syn-tenant-b", rooftopId: "syn-rooftop-b",
    };
    expect(testEvent(otherDealer, otherAuth, V).status).toBe("rejected");
    expect(testEvent(otherDealer, otherAuth, {
      ...V, tenantId: "syn-tenant-b", rooftopId: "syn-rooftop-b",
      instanceId: "syn-instance-b", episodeId: "syn-episode-b",
    }).status).toBe("ready");
  });
});
