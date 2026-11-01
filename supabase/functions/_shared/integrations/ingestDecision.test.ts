import { describe, it, expect } from "vitest";
import filmCompleted from "./__fixtures__/autofilm_inspection_completed.json";
import curbAppraisal from "./__fixtures__/autocurb_private_appraisal.json";
import { decideIngest, type ExistingReceipt, type IngestInput, type KeyRecord } from "./ingestDecision.ts";
import { payloadChecksum, type EnvelopeV1 } from "./envelope.ts";
import { sign } from "./signing.ts";

const SECRET = "test-secret-not-real";
const NOW_MS = Date.parse("2026-10-28T19:02:00Z");
const NOW_S = Math.floor(NOW_MS / 1000);
const TENANT_A = "11111111-1111-4111-8111-111111111111";
const TENANT_B = "22222222-2222-4222-8222-222222222222";

const FIXTURES: Record<string, unknown> = {
  autofilm_inspection_completed: filmCompleted,
  autocurb_private_appraisal: curbAppraisal,
};
const fixture = (name: string): EnvelopeV1 => structuredClone(FIXTURES[name]) as EnvelopeV1;

const keyFor = (over: Partial<KeyRecord["connection"]> = {}, keyStatus: KeyRecord["status"] = "active"): KeyRecord => ({
  key_id: "key_a1",
  status: keyStatus,
  connection: {
    id: "conn-a",
    tenant_id: TENANT_A,
    app: "autofilm",
    status: "active",
    scopes: ["inspection:write", "repair:write"],
    adapter: "rooftop.v1",
    external_rooftop_ref: null,
    ...over,
  },
});

async function request(
  envelope: unknown,
  over: Partial<IngestInput> & { ts?: number; secret?: string; signAs?: string; body?: string } = {},
): Promise<IngestInput> {
  const rawBody = over.body ?? JSON.stringify(envelope);
  const ts = String(over.ts ?? NOW_S);
  const signature = await sign(over.signAs ?? SECRET, ts, "key_a1", rawBody);
  const headers = new Headers({
    "x-rooftop-key-id": "key_a1",
    "x-rooftop-timestamp": ts,
    "x-rooftop-signature": signature,
  });
  return {
    headers,
    rawBody: over.rawBody ?? rawBody,
    nowMs: NOW_MS,
    keyRecord: keyFor(),
    secret: SECRET,
    existingByEventId: null,
    existingByIdempotencyKey: null,
    directionEnabled: true,
    ...over,
  };
}

describe("ingest decision", () => {
  it("SEC-01 takes the tenant from the key connection, never the envelope tenant_ref", async () => {
    const env = { ...fixture("autofilm_inspection_completed"), tenant_ref: TENANT_B };
    const d = await decideIngest(await request(env));
    expect(d.httpStatus).toBe(202);
    expect(d.insert?.tenant_id).toBe(TENANT_A);
    expect(d.insert?.envelope.tenant_ref).toBe(TENANT_B);
  });

  it("SEC-01 rejects a request signed by dealer A's rooftop key that names dealer B's rooftop", async () => {
    const keyRecord = keyFor({ external_rooftop_ref: "rooftop-a" });
    const named = await decideIngest(await request({ ...fixture("autofilm_inspection_completed"), tenant_ref: "rooftop:rooftop-b" }, { keyRecord }));
    expect(named).toMatchObject({ httpStatus: 403, code: "scope_or_tenant_denied", detail: ["tenant_ref_mismatch"], insert: null });
    for (const ok of ["rooftop-a", "rooftop:rooftop-a"]) {
      const d = await decideIngest(await request({ ...fixture("autofilm_inspection_completed"), tenant_ref: ok }, { keyRecord }));
      expect(d.insert?.tenant_id).toBe(TENANT_A);
    }
  });

  it("SEC-01 returns 403 when the producer is not the connection app", async () => {
    const d = await decideIngest(await request(fixture("autocurb_private_appraisal")));
    expect(d).toMatchObject({ httpStatus: 403, code: "scope_or_tenant_denied", insert: null });
  });

  it("SEC-01 returns 403 when the event scope is not granted", async () => {
    const d = await decideIngest(await request(fixture("autofilm_inspection_completed"), {
      keyRecord: keyFor({ scopes: ["repair:write"] }),
    }));
    expect(d).toMatchObject({ httpStatus: 403, detail: ["scope_missing"] });
  });

  it("SEC-02 returns 401 for a tampered body, wrong secret or missing headers", async () => {
    const env = fixture("autofilm_inspection_completed");
    const good = await request(env);
    expect((await decideIngest({ ...good, rawBody: good.rawBody + " " })).httpStatus).toBe(401);
    expect((await decideIngest(await request(env, { signAs: "wrong" }))).httpStatus).toBe(401);
    expect((await decideIngest({ ...good, headers: new Headers() })).httpStatus).toBe(401);
    expect((await decideIngest({ ...good, keyRecord: null, secret: null })).httpStatus).toBe(401);
    const swapped = new Headers(good.headers);
    swapped.set("x-rooftop-key-id", "key_other");
    expect((await decideIngest({ ...good, headers: swapped })).httpStatus).toBe(401);
  });

  it("SEC-02 verifies the raw bytes before parsing: a bad signature over invalid JSON is 401, not 400", async () => {
    const d = await decideIngest(await request({}, { body: "{not json", signAs: "wrong" }));
    expect(d.httpStatus).toBe(401);
    const ok = await decideIngest(await request({}, { body: "{not json" }));
    expect(ok).toMatchObject({ httpStatus: 400, code: "schema_invalid", detail: ["invalid_json"] });
  });

  it("SEC-03 rejects a stale or future timestamp even with a valid signature", async () => {
    const env = fixture("autofilm_inspection_completed");
    expect((await decideIngest(await request(env, { ts: NOW_S - 301 }))).httpStatus).toBe(401);
    expect((await decideIngest(await request(env, { ts: NOW_S + 301 }))).httpStatus).toBe(401);
    expect((await decideIngest(await request(env, { ts: NOW_S - 299 }))).httpStatus).toBe(202);
  });

  it("SEC-03 answers a replayed event_id with 200 duplicate and no insert", async () => {
    const env = fixture("autofilm_inspection_completed");
    const first = await decideIngest(await request(env));
    const existing: ExistingReceipt = {
      id: "row-1", status: "received", payload_checksum: first.insert!.payload_checksum, received_at: "2026-10-28T19:01:30Z",
    };
    const replay = await decideIngest(await request(env, { existingByEventId: existing }));
    expect(replay).toMatchObject({ httpStatus: 200, code: "duplicate", insert: null });
    expect(replay.duplicateOf?.id).toBe("row-1");
  });

  it("SEC-04 returns 401 for a revoked key", async () => {
    const d = await decideIngest(await request(fixture("autofilm_inspection_completed"), { keyRecord: keyFor({}, "revoked") }));
    expect(d.httpStatus).toBe(401);
  });

  it("SEC-04 returns 401 for a validly signed request on a paused or revoked connection, same as the live path", async () => {
    const env = fixture("autofilm_inspection_completed");
    for (const status of ["paused", "revoked", "pending", "error"] as const) {
      const d = await decideIngest(await request(env, { keyRecord: keyFor({ status }) }));
      expect(d).toMatchObject({ httpStatus: 401, code: "signature_invalid", detail: ["credentials"], insert: null });
    }
  });

  it("returns 401 when the connection is configured for a different adapter", async () => {
    const d = await decideIngest(await request(fixture("autofilm_inspection_completed"), { keyRecord: keyFor({ adapter: "autofilm.v1" }) }));
    expect(d).toMatchObject({ httpStatus: 401, detail: ["credentials"] });
  });

  it("SEC-04 accepts a retiring key during rotation overlap", async () => {
    const d = await decideIngest(await request(fixture("autofilm_inspection_completed"), { keyRecord: keyFor({}, "retiring") }));
    expect(d.httpStatus).toBe(202);
  });

  it("returns 400 for schema violations and checksum mismatch", async () => {
    const env = fixture("autofilm_inspection_completed");
    const bad = await decideIngest(await request({ ...env, extra: true }));
    expect(bad).toMatchObject({ httpStatus: 400, code: "schema_invalid" });
    const tampered = await decideIngest(await request({ ...env, payload: { ...env.payload, odometer_miles: 1 } }));
    expect(tampered.detail).toEqual(["payload_checksum_mismatch"]);
  });

  it("EVT-01 ten deliveries of one event produce exactly one insert decision", async () => {
    const env = fixture("autofilm_inspection_completed");
    const store = new Map<string, ExistingReceipt>();
    let inserts = 0;
    for (let i = 0; i < 10; i++) {
      const existing = store.get(env.event_id) ?? null;
      const d = await decideIngest(await request(env, { existingByEventId: existing, existingByIdempotencyKey: existing }));
      if (d.insert) {
        inserts++;
        store.set(d.insert.event_id, { id: "row-1", status: d.insert.status, payload_checksum: d.insert.payload_checksum, received_at: "t" });
      } else {
        expect(d.httpStatus).toBe(200);
      }
    }
    expect(inserts).toBe(1);
  });

  it("EVT-03 same idempotency key with a different body is 409 and writes nothing", async () => {
    const env = fixture("autofilm_inspection_completed");
    const changedPayload = { ...env.payload, odometer_miles: 99999 };
    const changed = {
      ...env,
      event_id: "0f3a1c52-6c1b-4a4e-9a55-3b5d2f9d1e77",
      payload: changedPayload,
      payload_checksum: await payloadChecksum(changedPayload),
    };
    const original: ExistingReceipt = {
      id: "row-1", status: "received", payload_checksum: env.payload_checksum!, received_at: "t",
    };
    const d = await decideIngest(await request(changed, { existingByIdempotencyKey: original }));
    expect(d).toMatchObject({ httpStatus: 409, code: "idempotency_conflict", insert: null });
  });

  it("stores held when the direction is disabled and keeps customer_public as a request only", async () => {
    const env = { ...fixture("autofilm_inspection_completed"), visibility: "customer_public" as const };
    const held = await decideIngest(await request(env, { directionEnabled: false }));
    expect(held).toMatchObject({ httpStatus: 202, code: "held" });
    expect(held.insert).toMatchObject({ status: "held", visibility: "tenant_private", requested_visibility: "customer_public" });
    const live = await decideIngest(await request(env));
    expect(live.insert?.status).toBe("received");
  });

  it("CURB-01 accepts a private appraisal only for a curb connection with appraisal scope", async () => {
    const env = fixture("autocurb_private_appraisal");
    const curb = keyFor({ app: "autocurb", scopes: ["appraisal:write"] });
    const d = await decideIngest(await request(env, { keyRecord: curb }));
    expect(d.insert).toMatchObject({ tenant_id: TENANT_A, visibility: "tenant_private", event_type: "autocurb.appraisal.recorded" });
  });
});
