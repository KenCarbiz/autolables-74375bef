import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import real from "../__fixtures__/autofilm_real_events.json";
import {
  afSign, afVerify, afWithinWindow, decideAutofilmIngest, mapAfVisibility, toAfOutbound, toEpochMs,
  type AfIngestInput,
} from "./autofilmV1.ts";
import { planApply } from "../applyDecision.ts";
import type { ConnectionRecord } from "../ingestDecision.ts";
import type { EnvelopeV1 } from "../envelope.ts";

const SECRET = "af-test-secret-not-real";
const VIN = "1HGCM82633A004352";
const ROOFTOP = real.rooftop_id;
const NOW_MS = Date.parse("2026-10-28T19:02:00Z");
const TENANT_A = "11111111-1111-4111-8111-111111111111";
const RO = real.events["mpi.report.published"].data.ro_id;

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

type Name = keyof typeof real.events;

// Body and signature built exactly the way AutoFilm's deliverOutboundDue does
// (api/integrations.ts:199-204): JSON.stringify of {event,event_id,schema_version:"1",tenant_id,data}
// and hex HMAC-SHA256 over `${ts}.${body}` with String(Date.now()) as ts.
function autofilmDelivery(name: Name | string, over: { data?: Record<string, unknown>; eventId?: string; rooftop?: string; secret?: string; ts?: number } = {}) {
  const row = (real.events as Record<string, { event_id: string; data: Record<string, unknown> }>)[name] ?? { event_id: "x-1", data: { ro_id: RO } };
  const bodyStr = JSON.stringify({
    event: name, event_id: over.eventId ?? row.event_id, schema_version: "1",
    tenant_id: over.rooftop ?? ROOFTOP, data: over.data ?? row.data,
  });
  const ts = String(over.ts ?? NOW_MS);
  const sig = createHmac("sha256", over.secret ?? SECRET).update(`${ts}.${bodyStr}`).digest("hex");
  return { bodyStr, ts, sig };
}

function request(d: ReturnType<typeof autofilmDelivery>, over: Partial<AfIngestInput> = {}): AfIngestInput {
  return {
    headers: new Headers({ "x-af-timestamp": d.ts, "x-af-signature": d.sig }),
    rawBody: d.bodyStr,
    nowMs: NOW_MS,
    connection: connection(),
    secrets: [{ key_id: "k1", secret: SECRET }],
    existingByEventId: null,
    existingByIdempotencyKey: null,
    directionEnabled: true,
    resolveVin: async () => VIN,
    ...over,
  };
}

describe("autofilm.v1 signing", () => {
  it("matches AutoFilm's own signing: hex HMAC-SHA256 of `${ts}.${body}`", async () => {
    const d = autofilmDelivery("mpi.report.published");
    expect(await afSign(SECRET, d.ts, d.bodyStr)).toBe(d.sig);
    expect(await afVerify(SECRET, d.ts, d.bodyStr, d.sig)).toBe(true);
    expect(await afVerify(SECRET, d.ts, d.bodyStr, d.sig.toUpperCase())).toBe(true);
    expect(await afVerify(SECRET, String(Number(d.ts) + 1), d.bodyStr, d.sig)).toBe(false);
    expect(await afVerify("other", d.ts, d.bodyStr, d.sig)).toBe(false);
    expect(await afVerify(SECRET, d.ts, d.bodyStr + " ", d.sig)).toBe(false);
  });

  it("enforces the 5 minute window in milliseconds", () => {
    expect(afWithinWindow(NOW_MS - 299_000, NOW_MS)).toBe(true);
    expect(afWithinWindow(NOW_MS + 299_000, NOW_MS)).toBe(true);
    expect(afWithinWindow(NOW_MS - 301_000, NOW_MS)).toBe(false);
    expect(afWithinWindow(NOW_MS / 1000, NOW_MS)).toBe(false);
  });
});

describe("autofilm.v1 ingest of real AutoFilm events", () => {
  it("accepts a real mpi.report.published and maps it to a completed inspection keyed by the RO id", async () => {
    const d = await decideAutofilmIngest(request(autofilmDelivery("mpi.report.published")));
    expect(d).toMatchObject({ httpStatus: 202, code: "received" });
    expect(d.inserts).toHaveLength(1);
    const ins = d.inserts[0];
    expect(ins).toMatchObject({
      tenant_id: TENANT_A, producer: "autofilm", adapter: "autofilm.v1",
      event_type: "autofilm.inspection.completed", source_record_id: `inspection:${RO}`,
      source_version: NOW_MS, vin: VIN, status: "received", visibility: "tenant_private", requested_visibility: "tenant_private",
    });
    expect(ins.event_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const plan = planApply({ ...ins, id: "r" } as never);
    expect(plan).toMatchObject({ verdict: "apply", effect: { kind: "inspection_evidence_upsert", technician_verified: false } });
  });

  it("accepts a real count-based decisions event as an RO-level summary with no per-finding status", async () => {
    const d = await decideAutofilmIngest(request(autofilmDelivery("mpi.customer.decisions.submitted")));
    expect(d.httpStatus).toBe(202);
    expect(d.inserts).toHaveLength(1);
    expect(d.inserts[0]).toMatchObject({ event_type: "autofilm.repair_order.decisions_submitted", source_record_id: `ro:${RO}:decisions` });
    expect(d.inserts[0].envelope.payload).toMatchObject({ approved_count: 2, declined_count: 1, total: 1180.5, authorization_id: "auth-77" });
    expect(planApply({ ...d.inserts[0], id: "r" } as never)).toMatchObject({ verdict: "noop" });
  });

  it("patched shape: report.published with vin, external_ro_id and published_at uses them", async () => {
    const publishedAt = "2026-10-28T18:10:00.000Z";
    const data = { ro_id: RO, ro_number: "RO-10442", external_ro_id: "DMS-5521", vin: VIN.toLowerCase(), published_at: publishedAt };
    const d = await decideAutofilmIngest(request(autofilmDelivery("mpi.report.published", { data }), { resolveVin: async () => { throw new Error("must not resolve"); } }));
    expect(d.inserts[0]).toMatchObject({ vin: VIN, source_version: Date.parse(publishedAt), source_record_id: `inspection:${RO}`, status: "received" });
  });

  it("patched shape: decisions with vin, decided_at and id arrays emit per-finding events plus the RO summary", async () => {
    const decidedAt = "2026-10-28T18:40:00.000Z";
    const data = {
      ro_id: RO, external_ro_id: "DMS-5521", vin: VIN, decided_at: decidedAt,
      approved: 2, declined: 1, approved_ids: ["f-1", "f-2"], declined_ids: ["f-3"], total: 1180.5, authorization_id: "auth-77",
    };
    const d = await decideAutofilmIngest(request(autofilmDelivery("mpi.customer.decisions.submitted", { data }), { resolveVin: async () => null }));
    expect(d.httpStatus).toBe(202);
    expect(d.inserts.map((i) => [i.event_type, i.source_record_id])).toEqual([
      ["autofilm.repair_order.decisions_submitted", `ro:${RO}:decisions`],
      ["autofilm.repair.approved", `finding:${RO}:f-1`],
      ["autofilm.repair.approved", `finding:${RO}:f-2`],
      ["autofilm.repair.declined", `finding:${RO}:f-3`],
    ]);
    expect(new Set(d.inserts.map((i) => i.source_version))).toEqual(new Set([Date.parse(decidedAt)]));
    expect(d.inserts.every((i) => i.vin === VIN)).toBe(true);
    expect(d.inserts[0].envelope.payload).toMatchObject({ approved_count: 2, declined_count: 1 });
    for (const i of d.inserts) expect(JSON.stringify(planApply({ ...i, id: "r" } as never))).not.toContain("completed_verified");
  });

  it("patched shape: an id both approved and declined is rejected, and live count-only shape stays summary-only", async () => {
    const bad = await decideAutofilmIngest(request(autofilmDelivery("mpi.customer.decisions.submitted", {
      data: { ro_id: RO, approved: 1, declined: 1, approved_ids: ["x"], declined_ids: ["x"] },
    })));
    expect(bad).toMatchObject({ httpStatus: 422, detail: ["decision_conflict"] });
    const live = await decideAutofilmIngest(request(autofilmDelivery("mpi.customer.decisions.submitted")));
    expect(live.inserts).toHaveLength(1);
    expect(live.inserts[0].source_version).toBe(NOW_MS);
  });

  it("does not fail on integers, and rejects only genuinely malformed counts", async () => {
    const zero = await decideAutofilmIngest(request(autofilmDelivery("mpi.customer.decisions.submitted", { data: { ro_id: RO, approved: 0, declined: 0, total: 0, authorization_id: null } })));
    expect(zero.httpStatus).toBe(202);
    const bad = await decideAutofilmIngest(request(autofilmDelivery("mpi.customer.decisions.submitted", { data: { ro_id: RO, approved: "two", declined: 1 } })));
    expect(bad).toMatchObject({ httpStatus: 400, detail: ["decision_counts_invalid"] });
  });

  it("acknowledges mpi.customer.message.created with 200 and stores nothing", async () => {
    const d = await decideAutofilmIngest(request(autofilmDelivery("mpi.customer.message.created")));
    expect(d).toMatchObject({ httpStatus: 200, code: "ignored", inserts: [] });
  });

  it("rejects events AutoFilm never sends to us (ro.upsert and finding.upsert are inbound to AutoFilm) with a reason", async () => {
    for (const event of ["ro.upsert", "finding.upsert", "recommendations.resolved", "vehicle.sold"]) {
      const body = JSON.stringify({ event, event_id: "e1", schema_version: "1", tenant_id: ROOFTOP, data: { ro_id: RO, vin: VIN } });
      const ts = String(NOW_MS);
      const d = await decideAutofilmIngest(request({ bodyStr: body, ts, sig: createHmac("sha256", SECRET).update(`${ts}.${body}`).digest("hex") }));
      expect(d).toMatchObject({ httpStatus: 422, code: "rejected", detail: ["unknown_event"], inserts: [] });
    }
  });

  it("resolves the VIN from vehicle_external_refs ids (ro_id and external_ro_id) and accepts an optional data.vin", async () => {
    let asked: string[] = [];
    await decideAutofilmIngest(request(autofilmDelivery("mpi.customer.decisions.submitted"), { resolveVin: async (_c, _t, ids) => { asked = ids; return VIN; } }));
    expect(asked).toEqual([RO, "DMS-5521"]);
    let called = false;
    const withVin = await decideAutofilmIngest(request(
      autofilmDelivery("mpi.report.published", { data: { ro_id: RO, ro_number: "x", vin: ` ${VIN.toLowerCase()} ` } }),
      { resolveVin: async () => { called = true; return null; } },
    ));
    expect(withVin.inserts[0].vin).toBe(VIN);
    expect(called).toBe(false);
  });

  it("carries the RO as service_visit_ref (schema 1.1.0) so evidence resolves without active inventory", async () => {
    const d = await decideAutofilmIngest(request(autofilmDelivery("mpi.report.published", { data: { ro_id: RO, ro_number: "x", vin: VIN } })));
    const envelope = d.inserts[0].envelope as unknown as { schema_version: string; service_visit_ref: unknown; instance_ref: unknown };
    expect(envelope.schema_version).toBe("1.1.0");
    expect(envelope.service_visit_ref).toEqual({ app: "autofilm", id: RO });
    expect(envelope.instance_ref).toBeNull();
  });

  it("stores an event with no resolvable VIN as unmatched with a 2xx, never a 4xx", async () => {
    const d = await decideAutofilmIngest(request(autofilmDelivery("mpi.report.published"), { resolveVin: async () => null }));
    expect(d).toMatchObject({ httpStatus: 202, code: "unmatched", detail: ["vin_unresolved"] });
    expect(d.inserts[0]).toMatchObject({ status: "unmatched", vin: null, tenant_id: TENANT_A });
    const garbage = await decideAutofilmIngest(request(
      autofilmDelivery("mpi.report.published", { data: { ro_id: RO, vin: "SHORT" } }), { resolveVin: async () => null },
    ));
    expect(garbage.httpStatus).toBe(202);
    expect(garbage.inserts[0].status).toBe("unmatched");
  });

  it("holds the event when the direction flag is off", async () => {
    const d = await decideAutofilmIngest(request(autofilmDelivery("mpi.report.published"), { directionEnabled: false }));
    expect(d).toMatchObject({ httpStatus: 202, code: "held" });
  });

  it("uses the signed x-af-timestamp as source_version when the payload has no timestamp, and a payload timestamp when present", async () => {
    const a = await decideAutofilmIngest(request(autofilmDelivery("mpi.report.published", { ts: NOW_MS - 1000 })));
    expect(a.inserts[0].source_version).toBe(NOW_MS - 1000);
    const b = await decideAutofilmIngest(request(autofilmDelivery("mpi.report.published", { data: { ro_id: RO, updated_at: "2026-10-28T18:30:00Z" } })));
    expect(b.inserts[0].source_version).toBe(Date.parse("2026-10-28T18:30:00Z"));
    expect(toEpochMs(1_700_000_000)).toBe(1_700_000_000_000);
    expect(toEpochMs("garbage")).toBeNull();
  });

  it("models a republish (new event_id, same RO) as a newer version of the same record, not a conflict", async () => {
    const first = await decideAutofilmIngest(request(autofilmDelivery("mpi.report.published", { eventId: `pub-${RO}-1`, ts: NOW_MS - 60_000 })));
    const second = await decideAutofilmIngest(request(autofilmDelivery("mpi.report.published", { eventId: `pub-${RO}-2`, ts: NOW_MS })));
    expect(second.httpStatus).toBe(202);
    expect(second.inserts[0].source_record_id).toBe(first.inserts[0].source_record_id);
    expect(second.inserts[0].source_version).toBeGreaterThan(first.inserts[0].source_version);
    expect(second.inserts[0].event_id).not.toBe(first.inserts[0].event_id);
    expect(second.inserts[0].idempotency_key).not.toBe(first.inserts[0].idempotency_key);
  });

  it("dedupes a redelivery on event_id even though the redelivery carries a fresh timestamp", async () => {
    const a = await decideAutofilmIngest(request(autofilmDelivery("mpi.report.published", { ts: NOW_MS - 30_000 })));
    const b = await decideAutofilmIngest(request(autofilmDelivery("mpi.report.published", { ts: NOW_MS })));
    expect(b.inserts[0].event_id).toBe(a.inserts[0].event_id);
    expect(b.inserts[0].payload_checksum).toBe(a.inserts[0].payload_checksum);
    const receipt = { id: "rcpt", status: "applied", payload_checksum: a.inserts[0].payload_checksum, received_at: "t" };
    expect(await decideAutofilmIngest(request(autofilmDelivery("mpi.report.published"), { existingByEventId: receipt })))
      .toMatchObject({ httpStatus: 200, code: "duplicate", inserts: [] });
    expect(await decideAutofilmIngest(request(autofilmDelivery("mpi.report.published"), { existingByEventId: { ...receipt, payload_checksum: "other" } })))
      .toMatchObject({ httpStatus: 409, code: "idempotency_conflict" });
  });
});

describe("autofilm.v1 authentication and tenancy", () => {
  it("returns 401 for a bad signature, wrong secret, stale or future timestamp, or missing headers", async () => {
    const mk = (d: ReturnType<typeof autofilmDelivery>) => decideAutofilmIngest(request(d));
    expect((await mk(autofilmDelivery("mpi.report.published", { secret: "wrong" }))).httpStatus).toBe(401);
    expect((await mk(autofilmDelivery("mpi.report.published", { ts: NOW_MS - 6 * 60_000 }))).httpStatus).toBe(401);
    expect((await mk(autofilmDelivery("mpi.report.published", { ts: NOW_MS + 6 * 60_000 }))).httpStatus).toBe(401);
    const noSig = request(autofilmDelivery("mpi.report.published"));
    noSig.headers = new Headers({ "x-af-timestamp": String(NOW_MS) });
    expect((await decideAutofilmIngest(noSig)).httpStatus).toBe(401);
    const t = request(autofilmDelivery("mpi.report.published"));
    expect((await decideAutofilmIngest({ ...t, rawBody: t.rawBody + " " })).httpStatus).toBe(401);
  });

  it("accepts either key during rotation overlap", async () => {
    const d = await decideAutofilmIngest(request(autofilmDelivery("mpi.report.published"), {
      secrets: [{ key_id: "old", secret: "old-secret" }, { key_id: "new", secret: SECRET }],
    }));
    expect(d.httpStatus).toBe(202);
  });

  it("returns 401 for an inactive connection or one configured for another adapter", async () => {
    for (const over of [{ status: "paused" as const }, { status: "revoked" as const }, { adapter: "rooftop.v1" as const }]) {
      const d = await decideAutofilmIngest(request(autofilmDelivery("mpi.report.published"), { connection: connection(over) }));
      expect(d).toMatchObject({ httpStatus: 401, detail: ["credentials"], inserts: [] });
    }
    expect((await decideAutofilmIngest(request(autofilmDelivery("mpi.report.published"), { connection: null }))).httpStatus).toBe(401);
  });

  it("rejects a body tenant_id that is not the connection's rooftop, before reading the event", async () => {
    const other = await decideAutofilmIngest(request(autofilmDelivery("vehicle.sold", { rooftop: "some-other-rooftop" })));
    expect(other).toMatchObject({ httpStatus: 403, code: "scope_or_tenant_denied", detail: ["rooftop_mismatch"], inserts: [] });
    const labelsTenant = await decideAutofilmIngest(request(autofilmDelivery("mpi.report.published", { rooftop: TENANT_A })));
    expect(labelsTenant.httpStatus).toBe(403);
    const dataSpoof = await decideAutofilmIngest(request(autofilmDelivery("mpi.report.published", { data: { ro_id: RO, rooftop_id: "x" } })));
    expect(dataSpoof.httpStatus).toBe(403);
  });

  it("rejects unsupported schema versions and malformed envelopes", async () => {
    const d = autofilmDelivery("mpi.report.published");
    const body = JSON.stringify({ ...JSON.parse(d.bodyStr), schema_version: "2" });
    const sig = createHmac("sha256", SECRET).update(`${d.ts}.${body}`).digest("hex");
    expect(await decideAutofilmIngest(request({ bodyStr: body, ts: d.ts, sig }))).toMatchObject({ httpStatus: 400, detail: ["unsupported_schema_version"] });
    const bad = "not json";
    expect((await decideAutofilmIngest(request({ bodyStr: bad, ts: d.ts, sig: createHmac("sha256", SECRET).update(`${d.ts}.${bad}`).digest("hex") }))).detail).toEqual(["invalid_json"]);
  });

  it("requires the scope for the mapped canonical event", async () => {
    const d = await decideAutofilmIngest(request(autofilmDelivery("mpi.report.published"), { connection: connection({ scopes: ["repair:write"] }) }));
    expect(d).toMatchObject({ httpStatus: 403, detail: ["scope_missing"] });
  });
});

describe("autofilm.v1 visibility", () => {
  it("defaults to tenant_private (AutoFilm sends no visibility field) and keeps any public flag as a request only", () => {
    expect(mapAfVisibility({})).toEqual({ stored: "tenant_private", requested: "tenant_private" });
    expect(mapAfVisibility({ visibility: "shared" })).toEqual({ stored: "custody_shared", requested: "custody_shared" });
    expect(mapAfVisibility({ visibility: "public" })).toEqual({ stored: "tenant_private", requested: "customer_public" });
    expect(mapAfVisibility({ visibility: "shared", is_public: true })).toEqual({ stored: "custody_shared", requested: "customer_public" });
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
  });
});
