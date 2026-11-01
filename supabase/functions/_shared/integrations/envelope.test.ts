import { describe, it, expect } from "vitest";
import filmCompleted from "./__fixtures__/autofilm_inspection_completed.json";
import curbAppraisal from "./__fixtures__/autocurb_private_appraisal.json";
import {
  EVENT_CATALOG, canonicalJson, inboundDirection, outboundDirection, payloadChecksum, requiredScope, validateEnvelope,
} from "./envelope.ts";

const FIXTURES: Record<string, unknown> = {
  autofilm_inspection_completed: filmCompleted,
  autocurb_private_appraisal: curbAppraisal,
};
const fixture = (name: string) => structuredClone(FIXTURES[name]) as Record<string, unknown>;

describe("envelope v1", () => {
  it("accepts both package examples", () => {
    expect(validateEnvelope(fixture("autofilm_inspection_completed")).ok).toBe(true);
    expect(validateEnvelope(fixture("autocurb_private_appraisal")).ok).toBe(true);
  });

  it("rejects unknown fields, missing fields and bad shapes with codes", () => {
    const base = fixture("autofilm_inspection_completed");
    expect(validateEnvelope({ ...base, extra: 1 }).errors).toContain("unknown_field:extra");
    const noVin = { ...base };
    delete noVin.vin;
    expect(validateEnvelope(noVin).errors).toContain("missing:vin");
    expect(validateEnvelope({ ...base, source_version: 0 }).errors).toContain("invalid:source_version");
    expect(validateEnvelope({ ...base, vin: "1HGCM82633A00435" }).errors).toContain("invalid:vin");
    expect(validateEnvelope({ ...base, event_id: "nope" }).errors).toContain("invalid:event_id");
    expect(validateEnvelope({ ...base, instance_ref: { app: "autofilm" } }).errors).toContain("invalid:instance_ref");
    expect(validateEnvelope({ ...base, producer: "autocurb" }).errors).toContain("invalid:event_type_producer_mismatch");
    expect(validateEnvelope([]).ok).toBe(false);
  });

  it("canonicalizes by sorted keys so key order never changes the checksum", async () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { z: 1, y: 2 }] } })).toBe('{"a":{"c":[3,{"y":2,"z":1}],"d":2},"b":1}');
    expect(await payloadChecksum({ a: 1, b: 2 })).toBe(await payloadChecksum({ b: 2, a: 1 }));
    expect(await payloadChecksum({ a: 1 })).not.toBe(await payloadChecksum({ a: 2 }));
  });

  it("maps catalog events to scopes and directions", () => {
    expect(requiredScope("autofilm.inspection.completed")).toBe("inspection:write");
    expect(requiredScope("autofilm.repair.completed_verified")).toBe("repair:write");
    expect(requiredScope("autofilm.video.published")).toBe("video:write");
    expect(requiredScope("autocurb.acquisition.recorded")).toBe("acquisition:write");
    expect(requiredScope("autocurb.appraisal.recorded")).toBe("appraisal:write");
    expect(requiredScope("autocurb.trade.captured")).toBe("trade:write");
    expect(requiredScope("autocurb.valuation.updated")).toBe("valuation:write");
    expect(requiredScope("autofilm.nope.never")).toBeNull();
    expect(Object.keys(EVENT_CATALOG)).toHaveLength(32);
    expect(inboundDirection("autofilm")).toBe("film_to_labels");
    expect(inboundDirection("autocurb")).toBe("curb_to_labels");
    expect(outboundDirection("autofilm")).toBe("labels_to_film");
    expect(outboundDirection("autocurb")).toBe("labels_to_curb");
  });
});
