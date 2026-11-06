// @vitest-environment node
import { describe, it, expect } from "vitest";
import { afSign } from "../adapters/autofilmV1.ts";
import filmCompleted from "../__fixtures__/autofilm_inspection_completed.json";
import type { ConnectionRecord, InboxInsert, KeyRecord } from "../ingestDecision.ts";
import { sign } from "../signing.ts";
import { handleApply, runApplyBatch, type ApplyStore, type ClaimedRow } from "./apply.ts";
import { handleHealth } from "./health.ts";
import { handleIngest, type IngestStore } from "./ingest.ts";

const SECRET = "memory-store-secret";
const TENANT = "11111111-1111-4111-8111-111111111111";
const CONN_ID = "33333333-3333-4333-8333-333333333333";

const conn = (over: Partial<ConnectionRecord> = {}): ConnectionRecord => ({
  id: CONN_ID, tenant_id: TENANT, app: "autofilm", status: "active", scopes: ["inspection:write", "repair:write"],
  adapter: "rooftop.v1", external_rooftop_ref: null, ...over,
});

// Mirrors the SQL contract: secrets are only released for active connections.
function memoryStore(connection: ConnectionRecord, flag = true) {
  const inbox: InboxInsert[] = [];
  const store: IngestStore = {
    loadKey: async (keyId) => (keyId === "key_a" ? { key_id: "key_a", status: "active", connection } as KeyRecord : null),
    keySecret: async (keyId) => (keyId === "key_a" && connection.status === "active" ? SECRET : null),
    loadConnection: async (id) => (id === connection.id ? connection : null),
    connectionSecrets: async () => (connection.status === "active" ? [{ key_id: "key_a", secret: SECRET }] : []),
    directionEnabled: async () => flag,
    lookupExisting: async (_c, eventId, key) => {
      const hit = inbox.find((r) => r.event_id === eventId || r.idempotency_key === key);
      const receipt = hit ? { id: "rcpt", status: "received", payload_checksum: hit.payload_checksum, received_at: "now" } : null;
      return {
        existingByEventId: inbox.some((r) => r.event_id === eventId) ? receipt : null,
        existingByIdempotencyKey: inbox.some((r) => r.idempotency_key === key) ? receipt : null,
      };
    },
    resolveVinForRo: async () => null,
    insertInbox: async (rows) => { inbox.push(...rows); return { ids: rows.map((_, i) => `id-${inbox.length}-${i}`) }; },
    touchConnection: async () => {},
  };
  return { store, inbox };
}

const deps = (store: IngestStore | null, enabled = true) => ({ enabled: () => enabled, store: () => store, now: () => Date.parse("2026-10-28T19:02:00Z") });

async function nativeReq(body: string, over: { secret?: string; ts?: number } = {}) {
  const ts = String(over.ts ?? Math.floor(Date.parse("2026-10-28T19:02:00Z") / 1000));
  return new Request("https://x.test/ingest", {
    method: "POST",
    body,
    headers: { "x-rooftop-key-id": "key_a", "x-rooftop-timestamp": ts, "x-rooftop-signature": await sign(over.secret ?? SECRET, ts, "key_a", body) },
  });
}

describe("ingest handler", () => {
  const body = JSON.stringify(filmCompleted);

  it("returns 503 when the kill switch is off or the store is unavailable, before looking at credentials", async () => {
    const { store } = memoryStore(conn());
    expect((await handleIngest(await nativeReq(body), deps(store, false))).status).toBe(503);
    expect((await handleIngest(await nativeReq(body), deps(null))).status).toBe(503);
  });

  it("accepts a signed native event, and answers duplicate on the second delivery", async () => {
    const { store, inbox } = memoryStore(conn());
    const first = await handleIngest(await nativeReq(body), deps(store));
    expect(first.status).toBe(202);
    const second = await handleIngest(await nativeReq(body), deps(store));
    expect(second.status).toBe(200);
    expect((await second.json()).status).toBe("duplicate");
    expect(inbox).toHaveLength(1);
  });

  it("answers 401 for every kind of inactive connection, matching the pure decision", async () => {
    for (const status of ["paused", "revoked", "pending", "error"] as const) {
      const { store, inbox } = memoryStore(conn({ status }));
      const res = await handleIngest(await nativeReq(body), deps(store));
      expect(res.status).toBe(401);
      expect(inbox).toHaveLength(0);
    }
  });

  it("rejects a bad signature and a stale timestamp with 401 and stores nothing", async () => {
    const { store, inbox } = memoryStore(conn());
    expect((await handleIngest(await nativeReq(body, { secret: "nope" }), deps(store))).status).toBe(401);
    expect((await handleIngest(await nativeReq(body, { ts: 1 }), deps(store))).status).toBe(401);
    expect(inbox).toHaveLength(0);
  });

  it("routes x-af requests by the connection's adapter and requires the connection parameter", async () => {
    const c = conn({ adapter: "autofilm.v1", external_rooftop_ref: "af-1" });
    const { store, inbox } = memoryStore(c);
    const raw = JSON.stringify({
      event: "mpi.report.published", event_id: "pub-ro-1-1", schema_version: "1", tenant_id: "af-1",
      data: { ro_id: "ro-1", ro_number: "10", vin: "1HGCM82633A004352" },
    });
    const ts = String(Date.parse("2026-10-28T19:02:00Z"));
    const headers = { "x-af-timestamp": ts, "x-af-signature": await afSign(SECRET, ts, raw) };
    const ok = await handleIngest(new Request(`https://x.test/ingest?connection=${CONN_ID}`, { method: "POST", body: raw, headers }), deps(store));
    expect(ok.status).toBe(202);
    expect(inbox[0]).toMatchObject({ tenant_id: TENANT, adapter: "autofilm.v1" });
    const noParam = await handleIngest(new Request("https://x.test/ingest", { method: "POST", body: raw, headers }), deps(store));
    expect(noParam.status).toBe(401);
    const wrongAdapter = memoryStore(conn({ adapter: "rooftop.v1" }));
    const res = await handleIngest(new Request(`https://x.test/ingest?connection=${CONN_ID}`, { method: "POST", body: raw, headers }), deps(wrongAdapter.store));
    expect(res.status).toBe(401);
  });
});

describe("apply worker", () => {
  const row = (over: Partial<ClaimedRow> = {}): ClaimedRow => ({
    id: "r1", tenant_id: TENANT, connection_id: CONN_ID, producer: "autofilm", event_type: "autofilm.inspection.completed",
    source_record_id: "rec", source_version: 1, vin: "1HGCM82633A004352", visibility: "tenant_private",
    envelope: { payload: {} }, status: "received", attempts: 0, event_id: "e", ...over,
  });
  const store = (rows: ClaimedRow[], applyImpl: ApplyStore["apply"]) => {
    const calls = { fail: [] as unknown[][], audit: [] as unknown[][] };
    const s: ApplyStore = {
      claim: async () => rows,
      apply: applyImpl,
      fail: async (...a) => { calls.fail.push(a); },
      audit: async (...a) => { calls.audit.push(a); },
    };
    return { s, calls };
  };

  it("sends the pure plan to the database function and counts outcomes", async () => {
    const plans: unknown[] = [];
    const { s } = store([row()], async (_id, plan) => { plans.push(plan); return { status: "applied", outcome: "applied" }; });
    expect(await runApplyBatch(s, 10)).toEqual({ claimed: 1, outcomes: { applied: 1 } });
    expect(plans[0]).toMatchObject({ verdict: "apply", effect: { kind: "inspection_evidence_upsert", technician_verified: false } });
  });

  it("schedules a backoff on failure and dead-letters after the sixth attempt", async () => {
    const boom = async () => { throw new Error("db down"); };
    const first = store([row({ attempts: 0 })], boom);
    expect((await runApplyBatch(first.s, 10, () => 0.5)).outcomes).toEqual({ retry: 1 });
    expect(first.calls.fail[0]).toEqual(["r1", "apply_error", 60, false]);
    const last = store([row({ attempts: 5 })], boom);
    expect((await runApplyBatch(last.s, 10, () => 0.5)).outcomes).toEqual({ dead: 1 });
    expect(last.calls.fail[0]).toEqual(["r1", "apply_error", 0, true]);
    expect(last.calls.audit).toHaveLength(1);
  });

  it("requires the service credential and the kill switch", async () => {
    const { s } = store([], async () => ({ status: "applied" }));
    const mk = (enabled: boolean, authorized: boolean) =>
      handleApply(new Request("https://x.test/apply", { method: "POST", body: "{}" }), { enabled: () => enabled, authorize: () => authorized, store: () => s });
    expect((await mk(false, true)).status).toBe(503);
    expect((await mk(true, false)).status).toBe(401);
    expect((await mk(true, true)).status).toBe(200);
  });
});

describe("health handler", () => {
  const store = (admin: boolean) => ({
    authenticate: async (jwt: string) => (jwt === "good" ? { userId: "u" } : null),
    isPlatformAdmin: async () => admin,
    snapshot: async () => ({ state: "not_configured" }),
  });
  const call = (headers: Record<string, string>, admin: boolean, enabled = true) =>
    handleHealth(new Request("https://x.test/health", { method: "GET", headers }), { enabled: () => enabled, store: () => store(admin) });

  it("gates on kill switch, token and platform admin", async () => {
    expect((await call({ Authorization: "Bearer good" }, true, false)).status).toBe(503);
    expect((await call({}, true)).status).toBe(401);
    expect((await call({ Authorization: "Bearer bad" }, true)).status).toBe(401);
    expect((await call({ Authorization: "Bearer good" }, false)).status).toBe(403);
    const ok = await call({ Authorization: "Bearer good" }, true);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ ok: true, state: "not_configured" });
  });
});
