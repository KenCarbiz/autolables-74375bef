import { describe, it, expect } from "vitest";
import {
  afSign, afVerify, afWithinWindow, decideAutofilmIngest, mapAfVisibility, toAfOutbound, toEpochMs,
  type AfIngestInput,
} from "./autofilmV1.ts";
import { planApply } from "../applyDecision.ts";
import type { ConnectionRecord } from "../ingestDecision.ts";
import type { EnvelopeV1 } from "../envelope.ts";

const SECRET = "af-test-secret-not-real";
const VIN = "1HGCM82633A004352";
const ROOFTOP = "af-rooftop-0001";
const NOW_MS = Date.parse("2026-10-28T19:02:00Z");
const TENANT_A = "11111111-1111-4111-8111-111111111111";

const connection = (over: Partial<ConnectionRecord> = {}): ConnectionRecord => ({
  id: "33333333-3333-4333-8333-333333333333",
  tenant_id: TENANT_A,
  app: "autofilm",
  status: "active",
  scopes: ["inspection:write", "repair:write"],
  adapter: "autofilm.v1",
  external_rooftop_ref: ROOFTOP,
  ...over,
});

const afBody = (event: string, data: Record<string, unknown>, over: Record<string, unknown> = {}) => ({
  event,
  event_id: `evt-${event}-1`,
  schema_version: "1",
  tenant_id: ROOFTOP,
  data,
  ...over,
});

async function request(
  body: unknown,
  over: Partial<AfIngestInput> & { ts?: number; secret?: string; rawBody?: string } = {},
): Promise<AfIngestInput> {
  const rawBody = over.rawBody ?? JSON.stringify(body);
  const ts = String(over.ts ?? NOW_MS);
  return {
    headers: new Headers({ "x-af-timestamp": ts, "x-af-signature": await afSign(over.secret ?? SECRET, ts, rawBody) }),
    rawBody,
    nowMs: NOW_MS,
    connection: connection(),
    secrets: [{ key_id: "k1", secret: SECRET }],
    existingByEventId: null,
    existingByIdempotencyKey: null,
    directionEnabled: true,
    ...over,
  };
}

const UPDATED = "2026-10-28T18:30:00.000Z";
const UPDATED_MS = Date.parse(UPDATED);

describe("autofilm.v1 signing", () => {
  it("signs hex HMAC-SHA256 of `${ts}.${body}` and verifies in constant-time form", async () => {
    const sig = await afSign(SECRET, "1700000000000", '{"a":1}');
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    expect(await afVerify(SECRET, "1700000000000", '{"a":1}', sig)).toBe(true);
    expect(await afVerify(SECRET, "1700000000000", '{"a":1}', sig.toUpperCase())).toBe(true);
    expect(await afVerify(SECRET, "1700000000001", '{"a":1}', sig)).toBe(false);
    expect(await afVerify("other", "1700000000000", '{"a":1}', sig)).toBe(false);
    expect(await afVerify(SECRET, "1700000000000", '{"a":2}', sig)).toBe(false);
  });

  it("matches the reference computation for a fixed vector", async () => {
    const { createHmac } = await import("node:crypto");
    const expected = createHmac("sha256", "s3cret").update("1698000000000.{\"x\":true}").digest("hex");
    expect(await afSign("s3cret", 1698000000000, '{"x":true}')).toBe(expected);
  });

  it("enforces the 5 minute window in milliseconds", () => {
    expect(afWithinWindow(NOW_MS - 299_000, NOW_MS)).toBe(true);
    expect(afWithinWindow(NOW_MS + 299_000, NOW_MS)).toBe(true);
    expect(afWithinWindow(NOW_MS - 301_000, NOW_MS)).toBe(false);
    expect(afWithinWindow(NOW_MS / 1000, NOW_MS)).toBe(false);
  });
});

describe("autofilm.v1 ingest", () => {
  const finding = (over: Record<string, unknown> = {}) => afBody("finding.upsert", {
    vin: VIN, external_ro_id: "ro-77", finding_id: "f-1", item: "rear_brakes", severity: "monitor",
    status: "recommended", updated_at: UPDATED, ...over,
  });

  it("accepts a signed finding.upsert and maps it to a canonical repair.recommended", async () => {
    const d = await decideAutofilmIngest(await request(finding()));
    expect(d).toMatchObject({ httpStatus: 202, code: "received" });
    expect(d.inserts).toHaveLength(1);
    const ins = d.inserts[0];
    expect(ins).toMatchObject({
      tenant_id: TENANT_A,
      connection_id: connection().id,
      producer: "autofilm",
      event_type: "autofilm.repair.recommended",
      source_record_id: "finding:ro-77:f-1",
      source_version: UPDATED_MS,
      vin: VIN,
      adapter: "autofilm.v1",
      visibility: "tenant_private",
      requested_visibility: "tenant_private",
    });
    expect(ins.event_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(ins.envelope.payload).toMatchObject({ finding_id: "f-1", item: "rear_brakes", status: "recommended" });
  });

  it("holds the event when the direction flag is off", async () => {
    const d = await decideAutofilmIngest(await request(finding(), { directionEnabled: false }));
    expect(d).toMatchObject({ httpStatus: 202, code: "held" });
    expect(d.inserts[0].status).toBe("held");
  });

  it("derives the same event id and idempotency key for a retry of the same AutoFilm event", async () => {
    const a = await decideAutofilmIngest(await request(finding()));
    const b = await decideAutofilmIngest(await request(finding(), { ts: NOW_MS + 5000 }));
    expect(b.inserts[0].event_id).toBe(a.inserts[0].event_id);
    expect(b.inserts[0].idempotency_key).toBe(a.inserts[0].idempotency_key);
    expect(b.inserts[0].payload_checksum).toBe(a.inserts[0].payload_checksum);
  });

  it("returns 401 for a bad signature, wrong secret, stale or future timestamp, or missing headers", async () => {
    expect((await decideAutofilmIngest(await request(finding(), { secret: "wrong" }))).httpStatus).toBe(401);
    expect((await decideAutofilmIngest(await request(finding(), { ts: NOW_MS - 6 * 60_000 }))).httpStatus).toBe(401);
    expect((await decideAutofilmIngest(await request(finding(), { ts: NOW_MS + 6 * 60_000 }))).httpStatus).toBe(401);
    const noSig = await request(finding());
    noSig.headers = new Headers({ "x-af-timestamp": String(NOW_MS) });
    expect((await decideAutofilmIngest(noSig)).httpStatus).toBe(401);
    const tampered = await request(finding());
    expect((await decideAutofilmIngest({ ...tampered, rawBody: tampered.rawBody + " " })).httpStatus).toBe(401);
  });

  it("accepts either key during rotation overlap", async () => {
    const d = await decideAutofilmIngest(await request(finding(), {
      secrets: [{ key_id: "old", secret: "old-secret" }, { key_id: "new", secret: SECRET }],
    }));
    expect(d.httpStatus).toBe(202);
  });

  it("returns 401 for an inactive connection or one configured for another adapter, like the live path", async () => {
    for (const over of [{ status: "paused" as const }, { status: "revoked" as const }, { adapter: "rooftop.v1" as const }]) {
      const d = await decideAutofilmIngest(await request(finding(), { connection: connection(over) }));
      expect(d).toMatchObject({ httpStatus: 401, detail: ["credentials"], inserts: [] });
    }
    expect((await decideAutofilmIngest(await request(finding(), { connection: null }))).httpStatus).toBe(401);
  });

  it("rejects a body tenant_id or data.rooftop_id that is not the connection's rooftop, before looking at the VIN", async () => {
    const spoof = await decideAutofilmIngest(await request(finding({ vin: "NOTAVIN" })));
    expect(spoof.httpStatus).toBe(400);
    const other = await decideAutofilmIngest(await request({ ...finding({ vin: "NOTAVIN" }), tenant_id: "af-rooftop-9999" }));
    expect(other).toMatchObject({ httpStatus: 403, code: "scope_or_tenant_denied", detail: ["rooftop_mismatch"], inserts: [] });
    const dataSpoof = await decideAutofilmIngest(await request(finding({ rooftop_id: "af-rooftop-9999" })));
    expect(dataSpoof).toMatchObject({ httpStatus: 403, detail: ["rooftop_mismatch"] });
    const uuidTenant = await decideAutofilmIngest(await request(finding({ tenant_id: TENANT_A })));
    expect(uuidTenant.inserts[0].tenant_id).toBe(TENANT_A);
    const claimsLabelsTenant = await decideAutofilmIngest(await request({ ...finding(), tenant_id: TENANT_A }));
    expect(claimsLabelsTenant.httpStatus).toBe(403);
  });

  it("rejects unsupported schema versions and malformed envelopes", async () => {
    expect(await decideAutofilmIngest(await request(finding(), { rawBody: JSON.stringify({ ...finding(), schema_version: "2" }) })))
      .toMatchObject({ httpStatus: 400, detail: ["unsupported_schema_version"] });
    expect((await decideAutofilmIngest(await request({ event: "finding.upsert" }))).httpStatus).toBe(400);
    expect((await decideAutofilmIngest(await request(null, { rawBody: "not json" }))).detail).toEqual(["invalid_json"]);
  });

  it("rejects unknown events with a reason instead of throwing", async () => {
    for (const event of ["mpi.customer.message.created", "recommendations.resolved", "vehicle.sold", "ro.delete"]) {
      const d = await decideAutofilmIngest(await request(afBody(event, { vin: VIN, external_ro_id: "ro-1" })));
      expect(d).toMatchObject({ httpStatus: 422, code: "rejected", detail: ["unknown_event"], inserts: [] });
    }
  });

  it("requires the scope for the mapped canonical event", async () => {
    const d = await decideAutofilmIngest(await request(finding(), { connection: connection({ scopes: ["inspection:write"] }) }));
    expect(d).toMatchObject({ httpStatus: 403, detail: ["scope_missing"] });
  });

  it("normalizes the VIN, rejects bad formats, and lets a check-digit mismatch through as unmatched later", async () => {
    const lower = await decideAutofilmIngest(await request(finding({ vin: `  ${VIN.toLowerCase()} ` })));
    expect(lower.inserts[0].vin).toBe(VIN);
    expect((await decideAutofilmIngest(await request(finding({ vin: "SHORT" })))).detail).toEqual(["vin_bad_format"]);
    const mismatch = await decideAutofilmIngest(await request(finding({ vin: "1HGCM82634A004352" })));
    expect(mismatch.httpStatus).toBe(202);
    const row = { ...mismatch.inserts[0], id: "r", visibility: "tenant_private" };
    expect(planApply(row as never)).toMatchObject({ verdict: "unmatched", outcome: "vin_check_digit_mismatch" });
  });

  it("resolves a missing VIN through the receiving store, or rejects when it cannot", async () => {
    const body = finding({ vin: undefined });
    const resolved = await decideAutofilmIngest(await request(body, { resolveVin: async () => VIN }));
    expect(resolved.inserts[0].vin).toBe(VIN);
    expect(await decideAutofilmIngest(await request(body, { resolveVin: async () => null })))
      .toMatchObject({ httpStatus: 422, detail: ["vin_unresolved"] });
  });

  it("keys findings so a repeat updates the same record, with the version taken from updated_at", async () => {
    const a = await decideAutofilmIngest(await request(finding()));
    const b = await decideAutofilmIngest(await request(finding({ severity: "urgent", updated_at: "2026-10-28T18:45:00Z" }), {}));
    expect(b.inserts[0].source_record_id).toBe(a.inserts[0].source_record_id);
    expect(b.inserts[0].source_version).toBeGreaterThan(a.inserts[0].source_version);
    expect(toEpochMs(1_700_000_000)).toBe(1_700_000_000_000);
    expect(toEpochMs(1_700_000_000_000)).toBe(1_700_000_000_000);
    expect(toEpochMs("garbage")).toBeNull();
  });

  it("falls back to the transport timestamp only when the record has no updated_at", async () => {
    const d = await decideAutofilmIngest(await request(finding({ updated_at: undefined })));
    expect(d.inserts[0].source_version).toBe(NOW_MS);
  });

  it("maps resolved to completed and never to completed_verified, whatever the payload claims", async () => {
    const d = await decideAutofilmIngest(await request(finding({
      status: "resolved", verified_evidence_ref: "x", verified_by: "tech", completed_verified: true, technician_verified: true,
    })));
    const ins = d.inserts[0];
    expect(ins.event_type).toBe("autofilm.repair.completed");
    const plan = planApply({ ...ins, id: "r" } as never);
    expect(plan).toMatchObject({ verdict: "apply", effect: { kind: "repair_item_upsert", status: "completed", verified_by: null, verified_evidence_ref: null } });
    for (const status of ["verified", "completed_verified", "mystery"]) {
      expect(await decideAutofilmIngest(await request(finding({ status })))).toMatchObject({ httpStatus: 422, detail: ["unmapped_finding_status"] });
    }
  });

  it("maps AutoFilm statuses to repair events", async () => {
    const expected: Record<string, [string, string | undefined]> = {
      sent: ["autofilm.repair.recommended", undefined],
      approved: ["autofilm.repair.approved", undefined],
      declined: ["autofilm.repair.declined", undefined],
      future_watch: ["autofilm.repair.corrected", "deferred"],
    };
    for (const [status, [type, mapped]] of Object.entries(expected)) {
      const d = await decideAutofilmIngest(await request(finding({ status })));
      expect(d.inserts[0].event_type).toBe(type);
      if (mapped) expect(d.inserts[0].envelope.payload.status).toBe(mapped);
    }
  });

  it("maps mpi.report.published to a completed inspection that is never technician verified", async () => {
    const d = await decideAutofilmIngest(await request(afBody("mpi.report.published", {
      vin: VIN, ro_id: "ro-77", inspection_id: "insp-9", updated_at: UPDATED, mileage: 45123,
      measurements: { lf_tire_32nds: 8 }, technician_verified: true,
      evidence_refs: ["film-evidence:abc", "https://stream.mux.com/private.m3u8"],
    })));
    expect(d.httpStatus).toBe(202);
    const ins = d.inserts[0];
    expect(ins).toMatchObject({ event_type: "autofilm.inspection.completed", source_record_id: "inspection:insp-9" });
    expect(ins.envelope.evidence_refs).toEqual(["film-evidence:abc"]);
    const plan = planApply({ ...ins, id: "r" } as never);
    expect(plan.effect).toMatchObject({ odometer_miles: 45123, technician_verified: false, measurements: { lf_tire_32nds: 8 } });
  });

  it("maps decisions to approved and declined per finding, on the same records as the findings", async () => {
    const body = afBody("mpi.customer.decisions.submitted", {
      ro_id: "ro-77", external_ro_id: "ro-77", approved: ["f-1", { recommendation_id: "f-2" }], declined: [3],
      total: 1200, authorization_id: "auth-1", decided_at: UPDATED,
    });
    const d = await decideAutofilmIngest(await request(body, { resolveVin: async () => VIN }));
    expect(d.httpStatus).toBe(202);
    expect(d.inserts.map((i) => [i.event_type, i.source_record_id])).toEqual([
      ["autofilm.repair.approved", "finding:ro-77:f-1"],
      ["autofilm.repair.approved", "finding:ro-77:f-2"],
      ["autofilm.repair.declined", "finding:ro-77:3"],
    ]);
    expect(new Set(d.inserts.map((i) => i.event_id)).size).toBe(3);
    expect(JSON.stringify(d.inserts)).not.toContain("1200");
  });

  it("rejects decisions that carry counts instead of ids, overlap, or are empty", async () => {
    const mk = (data: Record<string, unknown>) => request(afBody("mpi.customer.decisions.submitted", { vin: VIN, ro_id: "r", ...data }));
    expect((await decideAutofilmIngest(await mk({ approved: 2, declined: 1 }))).detail).toEqual(["decision_ids_required"]);
    expect((await decideAutofilmIngest(await mk({ approved: ["a"], declined: ["a"] }))).detail).toEqual(["decision_conflict"]);
    expect((await decideAutofilmIngest(await mk({ approved: [], declined: [] }))).detail).toEqual(["decision_empty"]);
  });

  it("maps ro.upsert to a repair order record with no inspection or repair side effects", async () => {
    const d = await decideAutofilmIngest(await request(afBody("ro.upsert", { vin: VIN, external_ro_id: "ro-77", ro_number: "1001", status: "open", updated_at: UPDATED })));
    expect(d.inserts[0]).toMatchObject({ event_type: "autofilm.repair_order.upserted", source_record_id: "ro:ro-77" });
    expect(planApply({ ...d.inserts[0], id: "r" } as never)).toMatchObject({ verdict: "noop" });
  });

  it("dedupes on event id and on the business idempotency key, and conflicts when the payload differs", async () => {
    const first = await decideAutofilmIngest(await request(finding()));
    const receipt = (checksum: string) => ({ id: "rcpt", status: "applied", payload_checksum: checksum, received_at: UPDATED });
    const same = await decideAutofilmIngest(await request(finding(), { existingByEventId: receipt(first.inserts[0].payload_checksum) }));
    expect(same).toMatchObject({ httpStatus: 200, code: "duplicate", inserts: [] });
    const sameBusinessKey = await decideAutofilmIngest(await request(finding(), { existingByIdempotencyKey: receipt(first.inserts[0].payload_checksum) }));
    expect(sameBusinessKey.httpStatus).toBe(200);
    const conflict = await decideAutofilmIngest(await request(finding(), { existingByIdempotencyKey: receipt("deadbeef") }));
    expect(conflict).toMatchObject({ httpStatus: 409, code: "idempotency_conflict" });
  });
});

describe("autofilm.v1 visibility", () => {
  it("never stores more than custody_shared and treats public flags as a request only", () => {
    expect(mapAfVisibility({})).toEqual({ stored: "tenant_private", requested: "tenant_private" });
    expect(mapAfVisibility({ visibility: "internal" })).toEqual({ stored: "tenant_private", requested: "tenant_private" });
    expect(mapAfVisibility({ visibility: "shared" })).toEqual({ stored: "custody_shared", requested: "custody_shared" });
    expect(mapAfVisibility({ visibility: "public" })).toEqual({ stored: "tenant_private", requested: "customer_public" });
    expect(mapAfVisibility({ visibility: "shared", is_public: true })).toEqual({ stored: "custody_shared", requested: "customer_public" });
    expect(mapAfVisibility({ share_public: true })).toEqual({ stored: "tenant_private", requested: "customer_public" });
  });

  it("carries the mapped visibility onto the inbox row and the applied effect", async () => {
    const mk = (extra: Record<string, unknown>) => request(afBody("finding.upsert", {
      vin: VIN, external_ro_id: "ro-1", finding_id: "f", updated_at: UPDATED, ...extra,
    }));
    const pub = (await decideAutofilmIngest(await mk({ visibility: "public" }))).inserts[0];
    expect(pub).toMatchObject({ visibility: "tenant_private", requested_visibility: "customer_public" });
    expect(planApply({ ...pub, id: "r" } as never).effect).not.toHaveProperty("visibility");
    const shared = (await decideAutofilmIngest(await mk({ visibility: "shared" }))).inserts[0];
    expect(shared).toMatchObject({ visibility: "custody_shared", requested_visibility: "custody_shared" });
  });
});

describe("autofilm.v1 outbound", () => {
  it("renders a canonical envelope in AutoFilm's {event,event_id,schema_version,tenant_id,data} shape", () => {
    const env = {
      event_id: "bfebdf39-f578-47d4-b42f-9885cdcb5521", event_type: "autolabels.vehicle.listed", vin: VIN,
      source_record_id: "listing-1", source_version: 4, occurred_at: "2026-10-28T19:00:00Z", visibility: "tenant_private",
      tenant_ref: "internal-tenant", payload: { price: 1 },
    } as unknown as EnvelopeV1;
    const out = toAfOutbound(env, ROOFTOP);
    expect(out).toMatchObject({ event: "vehicle.listed", event_id: env.event_id, schema_version: "1", tenant_id: ROOFTOP });
    expect(JSON.stringify(out)).not.toContain("internal-tenant");
    expect(out.data).toMatchObject({ vin: VIN, source_version: 4, payload: { price: 1 } });
  });
});
