import { describe, it, expect } from "vitest";
import filmCompleted from "./__fixtures__/autofilm_inspection_completed.json";
import curbAppraisal from "./__fixtures__/autocurb_private_appraisal.json";
import { decideApply, type InboxRowForApply } from "./applyDecision.ts";
import type { EnvelopeV1 } from "./envelope.ts";

const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";
const INSTANCE_A = { id: "inst-a", tenant_id: TENANT_A };

const FIXTURES: Record<string, unknown> = {
  autofilm_inspection_completed: filmCompleted,
  autocurb_private_appraisal: curbAppraisal,
};
const fixture = (name: string): EnvelopeV1 => structuredClone(FIXTURES[name]) as EnvelopeV1;

const rowFrom = (env: EnvelopeV1, over: Partial<InboxRowForApply> = {}): InboxRowForApply => ({
  id: "row",
  tenant_id: TENANT_A,
  connection_id: "conn-a",
  producer: env.producer,
  event_type: env.event_type,
  source_record_id: env.source_record_id,
  source_version: env.source_version,
  vin: env.vin,
  visibility: "tenant_private",
  envelope: env,
  ...over,
});

const repairRow = (suffix: string, payload: Record<string, unknown>, version = 1) =>
  rowFrom({ ...fixture("autofilm_inspection_completed"), event_type: `autofilm.repair.${suffix}`, payload }, { event_type: `autofilm.repair.${suffix}`, source_record_id: "rep_1", source_version: version });

describe("apply decision", () => {
  it("applies a completed inspection as tenant-private evidence on the matched instance", () => {
    const d = decideApply({ row: rowFrom(fixture("autofilm_inspection_completed")), latestVersion: null, instance: INSTANCE_A });
    expect(d).toMatchObject({ status: "applied", recordVersion: true });
    expect(d.effect).toMatchObject({
      kind: "inspection_evidence_upsert",
      row: {
        tenant_id: TENANT_A, instance_id: "inst-a", source_app: "autofilm", source_record_id: "mpi_fixture_001",
        odometer_miles: 45123, technician_verified: false, visibility: "tenant_private",
        evidence_refs: ["film-evidence:fixture-inspection-001"],
      },
    });
  });

  it("VIN-03 quarantines an unmatched or invalid VIN and never guesses", () => {
    const env = fixture("autofilm_inspection_completed");
    expect(decideApply({ row: rowFrom(env), latestVersion: null, instance: null })).toMatchObject({ status: "unmatched", outcomeCode: "no_active_instance", effect: null });
    expect(decideApply({ row: rowFrom(env, { vin: "1HGCM82634A004352" }), latestVersion: null, instance: INSTANCE_A }))
      .toMatchObject({ status: "unmatched", outcomeCode: "vin_check_digit_mismatch", effect: null });
    expect(decideApply({ row: rowFrom(env, { vin: "SHORT" }), latestVersion: null, instance: INSTANCE_A }).status).toBe("unmatched");
  });

  it("VIN-01 never applies across tenants even if an instance of another tenant is supplied", () => {
    const d = decideApply({
      row: rowFrom(fixture("autofilm_inspection_completed")),
      latestVersion: null,
      instance: { id: "inst-b", tenant_id: TENANT_B },
    });
    expect(d).toMatchObject({ status: "unmatched", effect: null });
  });

  it("VIN-01 and VIN-02 are independent per tenant and per custody episode", () => {
    const env = fixture("autofilm_inspection_completed");
    const a = decideApply({ row: rowFrom(env), latestVersion: null, instance: INSTANCE_A });
    const b = decideApply({ row: rowFrom(env, { tenant_id: TENANT_B }), latestVersion: null, instance: { id: "inst-b", tenant_id: TENANT_B } });
    expect(a.effect && "row" in a.effect && a.effect.row.tenant_id).toBe(TENANT_A);
    expect(b.effect && "row" in b.effect && b.effect.row.tenant_id).toBe(TENANT_B);
    const episode1 = { id: "ep-1", tenant_id: TENANT_A };
    const episode2 = { id: "ep-2", tenant_id: TENANT_A };
    const first = decideApply({ row: rowFrom(env), latestVersion: null, instance: episode1 });
    const second = decideApply({ row: rowFrom(env, { source_record_id: "mpi_after_reacquire" }), latestVersion: null, instance: episode2 });
    expect(first.effect && "row" in first.effect && first.effect.row.instance_id).toBe("ep-1");
    expect(second.effect && "row" in second.effect && second.effect.row.instance_id).toBe("ep-2");
  });

  it("EVT-02 versions delivered 3, 1, 2 leave 3 in force and mark the others stale", () => {
    const env = fixture("autofilm_inspection_completed");
    let latest: number | null = null;
    const outcomes: string[] = [];
    for (const v of [3, 1, 2]) {
      const d = decideApply({ row: rowFrom(env, { source_version: v }), latestVersion: latest, instance: INSTANCE_A });
      outcomes.push(d.status);
      if (d.status === "applied" && d.recordVersion) latest = Math.max(latest ?? 0, v);
    }
    expect(outcomes).toEqual(["applied", "stale", "stale"]);
    expect(latest).toBe(3);
  });

  it("treats an equal version as stale", () => {
    expect(decideApply({ row: rowFrom(fixture("autofilm_inspection_completed")), latestVersion: 1, instance: INSTANCE_A }).status).toBe("stale");
  });

  it("EVT-05 a revocation sets revoked_at and carries no measurements", () => {
    const env = { ...fixture("autofilm_inspection_completed"), event_type: "autofilm.inspection.revoked", source_version: 2, occurred_at: "2026-10-29T10:00:00Z" };
    const d = decideApply({ row: rowFrom(env, { event_type: env.event_type, source_version: 2 }), latestVersion: 1, instance: INSTANCE_A });
    expect(d.status).toBe("applied");
    expect(d.effect).toMatchObject({ kind: "inspection_evidence_upsert", row: { revoked_at: "2026-10-29T10:00:00Z", source_version: 2 } });
    expect(d.effect && "row" in d.effect && "measurements" in d.effect.row).toBe(false);
  });

  it("FILM-02 a recommended repair is stored as recommended even if the payload claims completion", () => {
    const d = decideApply({ row: repairRow("recommended", { finding_id: "f1", item: "rear_brakes", status: "completed", severity: "monitor" }), latestVersion: null, instance: INSTANCE_A });
    expect(d.effect).toMatchObject({ kind: "repair_item_upsert", row: { status: "recommended", verified_evidence_ref: null, finding_ref: "f1" } });
  });

  it("FILM-02 completed_verified requires an evidence reference", () => {
    const missing = decideApply({ row: repairRow("completed_verified", { finding_id: "f1", verified_by: "tech" }), latestVersion: null, instance: INSTANCE_A });
    expect(missing).toMatchObject({ status: "rejected", outcomeCode: "missing_verification_evidence", effect: null });
    const ok = decideApply({ row: repairRow("completed_verified", { finding_id: "f1", verified_by: "tech", verified_evidence_ref: "film-evidence:sig-1" }), latestVersion: null, instance: INSTANCE_A });
    expect(ok.effect).toMatchObject({ row: { status: "completed_verified", verified_evidence_ref: "film-evidence:sig-1", verified_by: "tech", visibility: "tenant_private" } });
  });

  it("derives repair status from the event suffix and validates corrected payloads", () => {
    for (const s of ["approved", "declined", "completed"]) {
      const d = decideApply({ row: repairRow(s, {}), latestVersion: null, instance: INSTANCE_A });
      expect(d.effect).toMatchObject({ row: { status: s } });
    }
    expect(decideApply({ row: repairRow("corrected", { status: "bogus" }), latestVersion: null, instance: INSTANCE_A }).outcomeCode).toBe("invalid_repair_status");
    expect(decideApply({ row: repairRow("corrected", { status: "deferred" }), latestVersion: null, instance: INSTANCE_A }).effect).toMatchObject({ row: { status: "deferred" } });
  });

  it("rejects unknown events and applies other catalog events without an effect", () => {
    const env = fixture("autofilm_inspection_completed");
    expect(decideApply({ row: rowFrom(env, { event_type: "autofilm.mystery.thing" }), latestVersion: null, instance: INSTANCE_A })).toMatchObject({ status: "rejected", outcomeCode: "unknown_event" });
    const video = decideApply({ row: rowFrom(env, { event_type: "autofilm.video.published" }), latestVersion: null, instance: INSTANCE_A });
    expect(video).toMatchObject({ status: "applied", effect: null, recordVersion: true });
  });
});
