// @vitest-environment node
import { describe, it, expect } from "vitest";
import base from "./__fixtures__/autofilm_inspection_completed.json";
import { downgradeToV10, supportsServiceVisitRef, validateEnvelope, catalogEntry, type EnvelopeV1 } from "./envelope.ts";

const env = (over: Record<string, unknown> = {}) => ({ ...(base as Record<string, unknown>), ...over });

describe("envelope 1.1.0 service_visit_ref extension", () => {
  it("accepts service_visit_ref on 1.1.0", () => {
    const r = validateEnvelope(env({ schema_version: "1.1.0", service_visit_ref: { app: "autofilm", id: "ro-9001" }, instance_ref: null }));
    expect(r.errors).toEqual([]);
    expect(r.envelope?.service_visit_ref).toEqual({ app: "autofilm", id: "ro-9001" });
  });

  it("rejects service_visit_ref on 1.0.x so an old consumer never gets an unknown field", () => {
    const r = validateEnvelope(env({ schema_version: "1.0.0", service_visit_ref: { app: "autofilm", id: "ro-9001" } }));
    expect(r.ok).toBe(false);
    expect(r.errors).toContain("unknown_field:service_visit_ref");
  });

  it("rejects a malformed service_visit_ref", () => {
    for (const bad of [{ app: "dms", id: "x" }, { app: "autofilm", id: "" }, { app: "autofilm", id: "x", extra: 1 }, "ro-1"]) {
      expect(validateEnvelope(env({ schema_version: "1.1.0", service_visit_ref: bad })).errors).toContain("invalid:service_visit_ref");
    }
  });

  it("allows a null instance_ref with a visit ref (sold car, no active inventory)", () => {
    const r = validateEnvelope(env({ schema_version: "1.1.0", instance_ref: null, service_visit_ref: { app: "autofilm", id: "ro-1" } }));
    expect(r.ok).toBe(true);
  });

  it("compares versions numerically", () => {
    expect(supportsServiceVisitRef("1.1.0")).toBe(true);
    expect(supportsServiceVisitRef("1.10.2")).toBe(true);
    expect(supportsServiceVisitRef("1.0.9")).toBe(false);
    expect(supportsServiceVisitRef("2.0.0")).toBe(false);
    expect(supportsServiceVisitRef("1.1")).toBe(false);
  });

  it("downgrades to a valid 1.0.0 envelope for consumers without 1.1 support", () => {
    const v11 = env({ schema_version: "1.1.0", service_visit_ref: { app: "autofilm", id: "ro-1" } }) as unknown as EnvelopeV1;
    const v10 = downgradeToV10(v11);
    expect("service_visit_ref" in v10).toBe(false);
    expect(v10.schema_version).toBe("1.0.0");
    expect(validateEnvelope(v10).ok).toBe(true);
  });

  it("catalogs delivered and sale_voided separately from sold", () => {
    for (const t of ["autolabels.vehicle.sold", "autolabels.vehicle.delivered", "autolabels.vehicle.sale_voided", "autolabels.vehicle.archived"]) {
      expect(catalogEntry(t)?.scope).toBe("vehicle:read");
    }
  });
});
