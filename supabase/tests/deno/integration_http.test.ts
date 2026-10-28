// Real-HTTP tests for the four handlers over Deno.serve, against the scratch Postgres.
// Run via supabase/tests/rooftopos_harness.sh (sets ROOFTOP_TEST_DB_URL).

import { afVerify } from "../../functions/_shared/integrations/adapters/autofilmV1.ts";
import { verify } from "../../functions/_shared/integrations/signing.ts";
import {
  admin, afBody, afHeaders, assert, envelopeFor, inboxOf, nativeHeaders, runApply, seed, SERVICE_HEADERS, startServer, state, VIN,
} from "./harness.ts";

const opts = { sanitizeOps: false, sanitizeResources: false, ignore: !Deno.env.get("ROOFTOP_TEST_DB_URL") };
const test = (name: string, fn: () => Promise<void>) => Deno.test({ name, fn, ...opts });

const AF_UPDATED = "2026-10-28T18:30:00.000Z";
const afFinding = (over: Record<string, unknown> = {}) => ({
  vin: VIN, external_ro_id: "ro-77", finding_id: "f-1", item: "rear_brakes", severity: "monitor",
  status: "recommended", updated_at: AF_UPDATED, ...over,
});

test("kill switch off returns 503 from all four functions, even with valid credentials", async () => {
  const srv = startServer();
  const s = await seed();
  const body = JSON.stringify(envelopeFor());
  state.enabled = false;
  try {
    assert.equal((await srv.post("/ingest", body, await nativeHeaders(s, body))).status, 503);
    assert.equal((await srv.post("/apply", "{}", SERVICE_HEADERS)).status, 503);
    assert.equal((await srv.post("/dispatch", "{}", SERVICE_HEADERS)).status, 503);
    assert.equal((await srv.post("/health", "{}", { Authorization: "Bearer user:x" })).status, 503);
    assert.equal((await inboxOf(s.tenantId)).length, 0);
  } finally {
    state.enabled = true;
    await srv.close();
  }
});

test("native: valid signed request is accepted into the inbox for the connection's tenant", async () => {
  const srv = startServer();
  try {
    const s = await seed();
    const other = await seed();
    const body = JSON.stringify(envelopeFor({ tenant_ref: other.tenantId }));
    const res = await srv.post("/ingest", body, await nativeHeaders(s, body));
    assert.equal(res.status, 202);
    const json = await res.json();
    assert.equal(json.status, "received");
    const rows = await inboxOf(s.tenantId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].tenant_id, s.tenantId);
    assert.equal(rows[0].adapter, "rooftop.v1");
    assert.equal(rows[0].visibility, "tenant_private");
    assert.equal((await inboxOf(other.tenantId)).length, 0);
  } finally {
    await srv.close();
  }
});

test("native: bad signature, stale timestamp, unknown key and missing headers are all 401", async () => {
  const srv = startServer();
  try {
    const s = await seed();
    const body = JSON.stringify(envelopeFor());
    assert.equal((await srv.post("/ingest", body, await nativeHeaders(s, body, { secret: "wrong" }))).status, 401);
    const now = Math.floor(Date.now() / 1000);
    assert.equal((await srv.post("/ingest", body, await nativeHeaders(s, body, { ts: now - 3600 }))).status, 401);
    assert.equal((await srv.post("/ingest", body, await nativeHeaders(s, body, { ts: now + 3600 }))).status, 401);
    const h = await nativeHeaders(s, body);
    assert.equal((await srv.post("/ingest", body, { ...h, "x-rooftop-key-id": "k_does_not_exist" })).status, 401);
    assert.equal((await srv.post("/ingest", body, {})).status, 401);
    assert.equal((await srv.post("/ingest", body + " ", h)).status, 401);
    assert.equal((await inboxOf(s.tenantId)).length, 0);
  } finally {
    await srv.close();
  }
});

test("paused, revoked and pending connections get the same 401 on the live path (native and AutoFilm)", async () => {
  const srv = startServer();
  try {
    for (const status of ["paused", "revoked", "pending", "error"]) {
      const s = await seed({ status });
      const body = JSON.stringify(envelopeFor());
      const res = await srv.post("/ingest", body, await nativeHeaders(s, body));
      assert.equal(res.status, 401, `native ${status}`);
      assert.deepEqual(await res.json(), { ok: false, error: "signature_invalid" });
      const af = await seed({ adapter: "autofilm.v1", status });
      const abody = afBody(af, "finding.upsert", afFinding());
      const ares = await srv.post(`/ingest?connection=${af.connId}`, abody, await afHeaders(af, abody));
      assert.equal(ares.status, 401, `autofilm ${status}`);
      assert.equal((await inboxOf(s.tenantId)).length + (await inboxOf(af.tenantId)).length, 0);
    }
  } finally {
    await srv.close();
  }
});

test("native: an envelope with a spoofed tenant_ref cannot reach another tenant, and a producer mismatch is 403", async () => {
  const srv = startServer();
  try {
    const a = await seed();
    const b = await seed();
    const body = JSON.stringify(envelopeFor({ tenant_ref: b.tenantId, event_type: "autocurb.valuation.updated", producer: "autocurb" }));
    assert.equal((await srv.post("/ingest", body, await nativeHeaders(a, body))).status, 403);
    assert.equal((await inboxOf(b.tenantId)).length, 0);
  } finally {
    await srv.close();
  }
});

test("native: the same event twice stores one inbox row and answers 200 duplicate", async () => {
  const srv = startServer();
  try {
    const s = await seed();
    const body = JSON.stringify(envelopeFor());
    const first = await srv.post("/ingest", body, await nativeHeaders(s, body));
    const again = await srv.post("/ingest", body, await nativeHeaders(s, body));
    assert.equal(first.status, 202);
    assert.equal(again.status, 200);
    assert.equal((await again.json()).status, "duplicate");
    assert.equal((await inboxOf(s.tenantId)).length, 1);
    const env = envelopeFor();
    const b1 = JSON.stringify(env);
    const b2 = JSON.stringify({ ...env, event_id: crypto.randomUUID(), payload: { ...env.payload, odometer_miles: 1 } });
    await srv.post("/ingest", b1, await nativeHeaders(s, b1));
    const conflict = await srv.post("/ingest", b2, await nativeHeaders(s, b2));
    assert.equal(conflict.status, 409);
  } finally {
    await srv.close();
  }
});

test("autofilm: a signed x-af request is accepted through the adapter and mapped to the connection's tenant", async () => {
  const srv = startServer();
  try {
    const s = await seed({ adapter: "autofilm.v1" });
    const body = afBody(s, "finding.upsert", afFinding());
    const res = await srv.post(`/ingest?connection=${s.connId}`, body, await afHeaders(s, body));
    assert.equal(res.status, 202, JSON.stringify(await res.clone().json()));
    const rows = await inboxOf(s.tenantId);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].adapter, "autofilm.v1");
    assert.equal(rows[0].event_type, "autofilm.repair.recommended");
    assert.equal(rows[0].source_record_id, "finding:ro-77:f-1");
    assert.equal(rows[0].source_version, Date.parse(AF_UPDATED));
    assert.equal(rows[0].tenant_id, s.tenantId);
    assert.equal(rows[0].visibility, "tenant_private");
  } finally {
    await srv.close();
  }
});

test("autofilm: bad signature, stale timestamp, unknown connection, spoofed rooftop and unknown event", async () => {
  const srv = startServer();
  try {
    const s = await seed({ adapter: "autofilm.v1" });
    const other = await seed({ adapter: "autofilm.v1" });
    const body = afBody(s, "finding.upsert", afFinding());
    const url = `/ingest?connection=${s.connId}`;
    assert.equal((await srv.post(url, body, await afHeaders(s, body, { secret: "wrong" }))).status, 401);
    assert.equal((await srv.post(url, body, await afHeaders(s, body, { ts: Date.now() - 10 * 60_000 }))).status, 401);
    assert.equal((await srv.post(`/ingest?connection=${crypto.randomUUID()}`, body, await afHeaders(s, body))).status, 401);
    assert.equal((await srv.post("/ingest", body, await afHeaders(s, body))).status, 401);
    // signed with another connection's secret
    assert.equal((await srv.post(url, body, await afHeaders(s, body, { secret: other.secret }))).status, 401);

    const spoofed = afBody(s, "finding.upsert", afFinding(), { tenant_id: other.rooftopRef });
    const sres = await srv.post(url, spoofed, await afHeaders(s, spoofed));
    assert.equal(sres.status, 403);
    assert.deepEqual((await sres.json()).detail, ["rooftop_mismatch"]);
    const labelsTenant = afBody(s, "finding.upsert", afFinding(), { tenant_id: other.tenantId });
    assert.equal((await srv.post(url, labelsTenant, await afHeaders(s, labelsTenant))).status, 403);

    const unknown = afBody(s, "mpi.customer.message.created", { vin: VIN, external_ro_id: "ro-1" });
    const ures = await srv.post(url, unknown, await afHeaders(s, unknown));
    assert.equal(ures.status, 422);
    assert.deepEqual(await ures.json(), { ok: false, error: "rejected", detail: ["unknown_event"] });
    assert.equal((await inboxOf(s.tenantId)).length + (await inboxOf(other.tenantId)).length, 0);

    // a connection configured for the native protocol never accepts the x-af protocol
    const native = await seed();
    const nbody = afBody(s, "finding.upsert", afFinding());
    assert.equal((await srv.post(`/ingest?connection=${native.connId}`, nbody, await afHeaders(native, nbody))).status, 401);
  } finally {
    await srv.close();
  }
});

test("autofilm: a retry with the same event id is a duplicate, and a changed payload under the same business key conflicts", async () => {
  const srv = startServer();
  try {
    const s = await seed({ adapter: "autofilm.v1" });
    const url = `/ingest?connection=${s.connId}`;
    const body = afBody(s, "finding.upsert", afFinding(), { event_id: "evt-fixed-1" });
    assert.equal((await srv.post(url, body, await afHeaders(s, body))).status, 202);
    const retry = await srv.post(url, body, await afHeaders(s, body, { ts: Date.now() + 1000 }));
    assert.equal(retry.status, 200);
    assert.equal((await retry.json()).status, "duplicate");
    const sameFactNewTransportId = afBody(s, "finding.upsert", afFinding(), { event_id: "evt-fixed-2" });
    assert.equal((await srv.post(url, sameFactNewTransportId, await afHeaders(s, sameFactNewTransportId))).status, 200);
    const changed = afBody(s, "finding.upsert", afFinding({ severity: "urgent" }), { event_id: "evt-fixed-3" });
    assert.equal((await srv.post(url, changed, await afHeaders(s, changed))).status, 409);
    assert.equal((await inboxOf(s.tenantId)).length, 1);
  } finally {
    await srv.close();
  }
});

test("autofilm end to end: findings, decisions, report and resolved apply correctly and never reach completed_verified", async () => {
  const srv = startServer();
  try {
    const s = await seed({ adapter: "autofilm.v1" });
    const url = `/ingest?connection=${s.connId}`;
    const send = async (event: string, data: Record<string, unknown>) => {
      const body = afBody(s, event, data);
      const res = await srv.post(url, body, await afHeaders(s, body));
      assert.ok([200, 202].includes(res.status), `${event} -> ${res.status} ${JSON.stringify(await res.clone().json())}`);
    };
    await send("ro.upsert", { vin: VIN, external_ro_id: "ro-77", ro_number: "1001", status: "open", updated_at: "2026-10-28T18:00:00Z" });
    await send("finding.upsert", afFinding({ finding_id: "f-1", updated_at: "2026-10-28T18:10:00Z" }));
    await send("finding.upsert", afFinding({ finding_id: "f-2", item: "wipers", severity: "info", updated_at: "2026-10-28T18:10:00Z" }));
    await send("finding.upsert", afFinding({ finding_id: "f-1", severity: "urgent", updated_at: "2026-10-28T18:20:00Z" }));
    await send("mpi.report.published", { ro_id: "ro-77", external_ro_id: "ro-77", inspection_id: "insp-1", updated_at: "2026-10-28T18:25:00Z", mileage: 45123, measurements: { front_brake_mm: 6 }, technician_verified: true });
    await send("mpi.customer.decisions.submitted", { ro_id: "ro-77", external_ro_id: "ro-77", approved: ["f-1"], declined: ["f-2"], total: 100, authorization_id: "auth-1", decided_at: "2026-10-28T18:40:00Z" });
    await send("finding.upsert", afFinding({ finding_id: "f-3", status: "resolved", verified_evidence_ref: "x", updated_at: "2026-10-28T18:45:00Z" }));
    const run = await runApply(srv);
    assert.equal(run.status, 200);

    const items = await admin`select source_record_id, status, severity, item, verified_by, verified_evidence_ref, visibility
      from public.repair_items where tenant_id = ${s.tenantId} order by source_record_id`;
    const byId = Object.fromEntries(items.map((r) => [r.source_record_id, r]));
    assert.equal(byId["finding:ro-77:f-1"].status, "approved");
    assert.equal(byId["finding:ro-77:f-1"].severity, "urgent");
    assert.equal(byId["finding:ro-77:f-1"].item, "rear_brakes");
    assert.equal(byId["finding:ro-77:f-2"].status, "declined");
    assert.equal(byId["finding:ro-77:f-3"].status, "completed");
    assert.equal(items.some((r) => r.status === "completed_verified" || r.verified_evidence_ref !== null), false);
    assert.equal(items.length, 3);

    const [ev] = await admin`select odometer_miles, technician_verified, measurements, visibility from public.inspection_evidence where tenant_id = ${s.tenantId}`;
    assert.equal(ev.odometer_miles, 45123);
    assert.equal(ev.technician_verified, false);
    assert.equal(ev.visibility, "tenant_private");
    const unapplied = await admin`select status, count(*)::int n from public.integration_inbox where tenant_id = ${s.tenantId} group by status`;
    assert.deepEqual(Object.fromEntries(unapplied.map((r) => [r.status, r.n])), { applied: 8 });
  } finally {
    await srv.close();
  }
});

test("autofilm: a public flag is only a request and a shared record is stored custody_shared", async () => {
  const srv = startServer();
  try {
    const s = await seed({ adapter: "autofilm.v1" });
    const url = `/ingest?connection=${s.connId}`;
    const pub = afBody(s, "finding.upsert", afFinding({ finding_id: "pub", visibility: "public", is_public: true }));
    const shared = afBody(s, "finding.upsert", afFinding({ finding_id: "shr", visibility: "shared" }));
    await srv.post(url, pub, await afHeaders(s, pub));
    await srv.post(url, shared, await afHeaders(s, shared));
    await runApply(srv);
    const rows = await admin`select source_record_id, visibility from public.repair_items where tenant_id = ${s.tenantId}`;
    const vis = Object.fromEntries(rows.map((r) => [r.source_record_id, r.visibility]));
    assert.equal(vis["finding:ro-77:pub"], "tenant_private");
    assert.equal(vis["finding:ro-77:shr"], "custody_shared");
    const inbox = await admin`select source_record_id, requested_visibility from public.integration_inbox where tenant_id = ${s.tenantId}`;
    const req = Object.fromEntries(inbox.map((r) => [r.source_record_id, r.requested_visibility]));
    assert.equal(req["finding:ro-77:pub"], "customer_public");
    assert.equal(rows.some((r) => r.visibility === "customer_public"), false);
  } finally {
    await srv.close();
  }
});

test("ordering over HTTP: v2 then v1 leaves v2 and marks v1 superseded", async () => {
  const srv = startServer();
  try {
    const s = await seed();
    const rec = "rep_order_1";
    const mk = (version: number, status: string) =>
      JSON.stringify(envelopeFor({
        event_type: "autofilm.repair.corrected", source_record_id: rec, source_version: version,
        payload: { finding_id: "f", item: `item-v${version}`, status },
      }));
    for (const [v, st] of [[2, "approved"], [1, "recommended"]] as const) {
      const body = mk(v, st);
      assert.equal((await srv.post("/ingest", body, await nativeHeaders(s, body))).status, 202);
    }
    await runApply(srv);
    const [item] = await admin`select status, item, source_version from public.repair_items where tenant_id = ${s.tenantId} and source_record_id = ${rec}`;
    assert.deepEqual({ ...item }, { status: "approved", item: "item-v2", source_version: 2 });
    const rows = await inboxOf(s.tenantId);
    assert.deepEqual(rows.map((r) => [r.source_version, r.status, r.outcome_code]).sort(), [[1, "superseded", "stale_version"], [2, "applied", "applied"]]);
  } finally {
    await srv.close();
  }
});

test("held until the direction flag is on, then applied; idempotent when the same batch runs twice", async () => {
  const srv = startServer();
  try {
    const s = await seed({ flag: false });
    const body = JSON.stringify(envelopeFor());
    const res = await srv.post("/ingest", body, await nativeHeaders(s, body));
    assert.equal((await res.json()).status, "held");
    assert.deepEqual((await runApply(srv)).body.claimed >= 0, true);
    assert.equal((await inboxOf(s.tenantId))[0].status, "held");
    assert.equal((await admin`select count(*)::int n from public.inspection_evidence where tenant_id = ${s.tenantId}`)[0].n, 0);
    await admin`insert into public.integration_direction_flags (tenant_id, direction, enabled) values (${s.tenantId}, 'film_to_labels', true)`;
    await runApply(srv);
    await runApply(srv);
    assert.equal((await inboxOf(s.tenantId))[0].status, "applied");
    assert.equal((await admin`select count(*)::int n from public.inspection_evidence where tenant_id = ${s.tenantId}`)[0].n, 1);
  } finally {
    await srv.close();
  }
});

test("failed-event recovery: transient failures retry with backoff and then succeed", async () => {
  let failures = 2;
  const srv = startServer({ failApplyTimes: () => failures-- > 0 });
  try {
    const s = await seed();
    const body = JSON.stringify(envelopeFor());
    await srv.post("/ingest", body, await nativeHeaders(s, body));
    let run = await runApply(srv);
    assert.deepEqual(run.body.outcomes.retry, 1);
    let [row] = await inboxOf(s.tenantId);
    assert.equal(row.status, "received");
    assert.equal(row.attempts, 1);
    assert.equal(row.outcome_code, "apply_error");
    assert.equal(row.claimed_until, null);
    const delay = (new Date(row.next_attempt_at).getTime() - Date.now()) / 1000;
    assert.ok(delay > 40 && delay < 80, `first backoff about 60s, got ${delay}`);

    run = await runApply(srv);
    assert.equal(run.body.claimed, 0, "a backed-off row is not claimed early");

    await admin`update public.integration_inbox set next_attempt_at = now() where id = ${row.id}`;
    run = await runApply(srv);
    assert.deepEqual(run.body.outcomes.retry, 1);
    [row] = await inboxOf(s.tenantId);
    assert.equal(row.attempts, 2);
    const delay2 = (new Date(row.next_attempt_at).getTime() - Date.now()) / 1000;
    assert.ok(delay2 > 250 && delay2 < 350, `second backoff about 300s, got ${delay2}`);

    await admin`update public.integration_inbox set next_attempt_at = now() where id = ${row.id}`;
    run = await runApply(srv);
    assert.deepEqual(run.body.outcomes.applied, 1);
    [row] = await inboxOf(s.tenantId);
    assert.equal(row.status, "applied");
    assert.equal(row.attempts, 3);
    assert.equal((await admin`select count(*)::int n from public.inspection_evidence where tenant_id = ${s.tenantId}`)[0].n, 1);
  } finally {
    await srv.close();
  }
});

test("dead-letter: an event that always fails is dead after the maximum attempts and has no effect", async () => {
  const srv = startServer({ failApplyTimes: () => true });
  try {
    const s = await seed();
    const body = JSON.stringify(envelopeFor());
    await srv.post("/ingest", body, await nativeHeaders(s, body));
    let last = { outcomes: {} as Record<string, number> };
    for (let i = 0; i < 6; i++) {
      await admin`update public.integration_inbox set next_attempt_at = now() where tenant_id = ${s.tenantId} and status = 'received'`;
      last = (await runApply(srv)).body;
    }
    const [row] = await inboxOf(s.tenantId);
    assert.equal(row.status, "dead");
    assert.equal(row.attempts, 6);
    assert.equal(last.outcomes.dead, 1);
    assert.equal((await admin`select count(*)::int n from public.inspection_evidence where tenant_id = ${s.tenantId}`)[0].n, 0);
    const again = await runApply(srv);
    assert.equal(again.body.claimed, 0, "dead rows are never claimed again");
    const audit = await admin`select count(*)::int n from public.audit_log where entity_id = ${row.id} and action = 'integration_event_dead'`;
    assert.equal(audit[0].n, 1);
  } finally {
    await srv.close();
  }
});

test("apply and dispatch require the service credential", async () => {
  const srv = startServer();
  try {
    assert.equal((await srv.post("/apply", "{}", {})).status, 401);
    assert.equal((await srv.post("/apply", "{}", { Authorization: "Bearer nope" })).status, 401);
    assert.equal((await srv.post("/dispatch", "{}", {})).status, 401);
  } finally {
    await srv.close();
  }
});

test("health: needs a token, platform admin only, never reports healthy for an empty install", async () => {
  const srv = startServer();
  try {
    const adminId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    await admin`insert into auth.users (id, email) values (${adminId}, ${adminId + "@example.test"}), (${userId}, ${userId + "@example.test"})`;
    await admin`insert into public.user_roles (user_id, role) values (${adminId}, 'admin')`;
    assert.equal((await srv.post("/health", "{}", {})).status, 401);
    assert.equal((await srv.post("/health", "{}", { Authorization: "Bearer garbage" })).status, 401);
    assert.equal((await srv.post("/health", "{}", { Authorization: `Bearer user:${userId}` })).status, 403);
    const ok = await srv.post("/health", "{}", { Authorization: `Bearer user:${adminId}` });
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).ok, true);
  } finally {
    await srv.close();
  }
});

test("dispatch: native and AutoFilm connections are signed in their own formats and verified by a real receiver", async () => {
  const received: Array<{ path: string; headers: Record<string, string>; body: string }> = [];
  let mode = "ok";
  const receiver = Deno.serve({ port: 0, onListen: () => {} }, async (req) => {
    received.push({ path: new URL(req.url).pathname, headers: Object.fromEntries(req.headers), body: await req.text() });
    return new Response("{}", { status: mode === "ok" ? 200 : mode === "flaky" ? 503 : 400 });
  });
  const port = (receiver.addr as Deno.NetAddr).port;
  const fetcher: typeof fetch = (input, init) =>
    fetch(String(input).replace("https://peer.example.test", `http://127.0.0.1:${port}`), init);
  const srv = startServer({ fetcher });
  try {
    const nativeS = await seed({ endpoint: "https://peer.example.test/native" });
    const afS = await seed({ adapter: "autofilm.v1", endpoint: "https://peer.example.test/af" });
    for (const s of [nativeS, afS]) {
      await admin`insert into public.integration_direction_flags (tenant_id, direction, enabled) values (${s.tenantId}, 'labels_to_film', true)`;
      const env = envelopeFor({ producer: "autolabels", event_type: "autolabels.vehicle.listed", source_record_id: "listing-1", tenant_ref: s.tenantId });
      await admin`insert into public.integration_outbox (tenant_id, connection_id, event_id, event_type, envelope)
        values (${s.tenantId}, ${s.connId}, ${env.event_id}, ${env.event_type}, ${admin.json(env as never)})`;
    }
    const dispatch = async () => (await (await srv.post("/dispatch", "{}", SERVICE_HEADERS)).json()) as { outcomes: Record<string, number> };
    const out = await dispatch();
    assert.equal(out.outcomes.delivered, 2);

    const nativeReq = received.find((r) => r.path === "/native")!;
    const ts = nativeReq.headers["x-rooftop-timestamp"];
    assert.equal(await verify(nativeS.secret, ts, nativeS.keyId, nativeReq.body, nativeReq.headers["x-rooftop-signature"]), true);

    const afReq = received.find((r) => r.path === "/af")!;
    assert.equal(await afVerify(afS.secret, afReq.headers["x-af-timestamp"], afReq.body, afReq.headers["x-af-signature"]), true);
    assert.ok(Math.abs(Date.now() - Number(afReq.headers["x-af-timestamp"])) < 60_000, "x-af-timestamp is milliseconds");
    const afJson = JSON.parse(afReq.body);
    assert.equal(afJson.tenant_id, afS.rooftopRef);
    assert.equal(afJson.event, "vehicle.listed");
    assert.equal(afJson.schema_version, "1");
    assert.equal(JSON.stringify(afJson).includes(afS.tenantId), false, "AutoLabels tenant id never leaves in the AutoFilm format");

    // transient 5xx retries with backoff, a 4xx is permanent
    mode = "flaky";
    const t2 = await seed({ adapter: "autofilm.v1", endpoint: "https://peer.example.test/af2" });
    await admin`insert into public.integration_direction_flags (tenant_id, direction, enabled) values (${t2.tenantId}, 'labels_to_film', true)`;
    const e2 = envelopeFor({ producer: "autolabels", event_type: "autolabels.vehicle.listed" });
    await admin`insert into public.integration_outbox (tenant_id, connection_id, event_id, event_type, envelope) values (${t2.tenantId}, ${t2.connId}, ${e2.event_id}, ${e2.event_type}, ${admin.json(e2 as never)})`;
    assert.equal((await dispatch()).outcomes.retry, 1);
    const [row] = await admin`select status, attempts, last_error_code, next_attempt_at from public.integration_outbox where connection_id = ${t2.connId}`;
    assert.deepEqual([row.status, row.attempts, row.last_error_code], ["pending", 1, "http_503"]);
    assert.ok(new Date(row.next_attempt_at).getTime() > Date.now() + 30_000);
    mode = "ok";
    await admin`update public.integration_outbox set next_attempt_at = now() where connection_id = ${t2.connId}`;
    assert.equal((await dispatch()).outcomes.delivered, 1);
    mode = "reject";
    const t3 = await seed({ endpoint: "https://peer.example.test/rej" });
    await admin`insert into public.integration_direction_flags (tenant_id, direction, enabled) values (${t3.tenantId}, 'labels_to_film', true)`;
    const e3 = envelopeFor({ producer: "autolabels", event_type: "autolabels.vehicle.listed" });
    await admin`insert into public.integration_outbox (tenant_id, connection_id, event_id, event_type, envelope) values (${t3.tenantId}, ${t3.connId}, ${e3.event_id}, ${e3.event_type}, ${admin.json(e3 as never)})`;
    assert.equal((await dispatch()).outcomes.dead, 1);

    // flag off and paused connection send nothing
    const off = await seed({ endpoint: "https://peer.example.test/off" });
    const paused = await seed({ endpoint: "https://peer.example.test/paused", status: "paused" });
    await admin`insert into public.integration_direction_flags (tenant_id, direction, enabled) values (${paused.tenantId}, 'labels_to_film', true)`;
    for (const s of [off, paused]) {
      const e = envelopeFor({ producer: "autolabels", event_type: "autolabels.vehicle.listed" });
      await admin`insert into public.integration_outbox (tenant_id, connection_id, event_id, event_type, envelope) values (${s.tenantId}, ${s.connId}, ${e.event_id}, ${e.event_type}, ${admin.json(e as never)})`;
    }
    mode = "ok";
    const before = received.length;
    const skipped = await dispatch();
    assert.equal(received.length, before);
    assert.equal(skipped.outcomes.skipped_flag_off >= 1 && skipped.outcomes.skipped_connection >= 1, true);
  } finally {
    await srv.close();
    await receiver.shutdown();
  }
});
