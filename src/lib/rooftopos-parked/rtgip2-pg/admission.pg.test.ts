// @vitest-environment node
// Verified inbound admission against real Postgres: the TypeScript server boundary
// (admitDelivery) calling the proposed rtgip.inbox_admit as the rtgip_inbox_receiver role.
// Runs only under supabase/tests/rtgip/pg_integration.sh (throwaway cluster).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  canonicalize,
  hmacHex,
  MemoryNonceStore,
  preimage,
  sealEnvelope,
  sha256Hex,
  signEnvelope,
  verifyDelivery,
  SIGNATURE_PREFIX,
  type EnvelopeV2,
  type Registry,
} from "../rtgip2/protocol.ts";
import { expectReceipt, receiptContext, verifyReceipt } from "../rtgip2/delivery.ts";
import { admitDelivery, type AdmissionEffect } from "../rtgip2/admission.ts";
import { connId, draftEnvelope, keyOf, EPISODE, EPISODE_2 } from "../rtgip2/fixtures.ts";
import { admissionDb, connect, nowSec, PG_URL, seedRegistry, type Sql } from "./pg.ts";
import contract from "../rtgip2/rtgip2-gateway-contract.v1.json";

const run = describe.runIf(!!PG_URL);
let sql: Sql;
let reg: Registry;
let n = 0;
const CONN = connId("autolabels", "autocurb");

const effect: AdmissionEffect = async (tx, e) => {
  const t = (tx as unknown as { sql: Sql }).sql;
  if (e.vehicle.episode_id === "ep-unknown") return { ok: false, reason: "unknown_episode" };
  await t`INSERT INTO rtgip_test.effects (event_id, agg, revision) VALUES (${e.event_id}, ${e.aggregate.id}, ${e.aggregate.revision})`;
  return { ok: true };
};

async function envelope(over: Partial<Omit<EnvelopeV2, "payload_sha256">> = {}, label = `e${n++}`) {
  return sealEnvelope(
    draftEnvelope("autolabels", "autocurb", "inventory.status_changed", {
      origin: { app: "autolabels", event_id: `org-${label}`, revision: over.aggregate?.revision ?? 1 },
      aggregate: { domain: "inventory", type: "episode", id: `agg-${label}`, revision: 1, prev_revision: null },
      ...over,
    }),
  );
}
const hdr = async (p: ReturnType<typeof signEnvelope>) => (await p) as unknown as Record<string, string>;
const gw = (body: string, e: EnvelopeV2, nonce = `gw_nonce_${n++}_0123456789`) =>
  hdr(signEnvelope(body, e, keyOf(reg, "gw-dev-1"), nowSec(), nonce));
const deps = () => ({ app: "autocurb" as const, registry: reg, nowSec: nowSec(), db: admissionDb(sql), effect, receiptKey: keyOf(reg, "ac-dev-1") });
const effects = async (id: string) => Number((await sql`SELECT count(*)::int AS c FROM rtgip_test.effects WHERE event_id = ${id}`)[0]!.c);
const direct = async (h: Record<string, string>, body: string) =>
  (await admissionDb(sql).transaction((tx) => tx.admit(h, body, null)))[0]!;

/** Gateway-signed with the real key over arbitrary bytes: only the database checks can refuse it. */
async function signedRaw(body: string, scope: string, ts = nowSec(), nonce = `raw_nonce_${n++}_0123456789`): Promise<Record<string, string>> {
  const k = keyOf(reg, "gw-dev-1");
  const sig = SIGNATURE_PREFIX + (await hmacHex(k.secret, preimage(k.key_id, "gateway", String(ts), nonce, scope, await sha256Hex(body))));
  return { "rtgip-protocol": "rtgip/2", "rtgip-key-id": k.key_id, "rtgip-signer": "gateway", "rtgip-timestamp": String(ts), "rtgip-nonce": nonce, "rtgip-scope": scope, "rtgip-signature": sig };
}
const scopeFor = (e: Record<string, unknown>) =>
  [e.source_app, e.target_app, e.tenant_id, e.rooftop_id, e.event_type, String(e.schema_version), e.purpose, e.event_id].join(";");

run("verified inbound admission (TypeScript boundary + Postgres inbox_admit)", () => {
  beforeAll(async () => {
    sql = connect();
    await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS rtgip_test;
      CREATE TABLE IF NOT EXISTS rtgip_test.effects (seq bigserial PRIMARY KEY, event_id uuid NOT NULL, agg text NOT NULL, revision bigint NOT NULL);
      GRANT USAGE ON SCHEMA rtgip_test TO rtgip_inbox_receiver; GRANT SELECT, INSERT ON rtgip_test.effects TO rtgip_inbox_receiver;
      GRANT USAGE ON SEQUENCE rtgip_test.effects_seq_seq TO rtgip_inbox_receiver;`);
  });
  beforeEach(async () => {
    reg = await seedRegistry(sql, "autocurb");
    await sql`TRUNCATE rtgip_test.effects`;
  });
  afterAll(async () => {
    await sql?.end();
  });

  it("admits a Gateway-signed delivery, applies the effect once, and its receipts verify at the source", async () => {
    const a = await envelope();
    const res = await admitDelivery(await gw(a.body, a.envelope), a.body, deps());
    expect(res.http_status).toBe(200);
    expect(res.receipts!.map((r) => `${r.kind}:${r.outcome}`)).toEqual(["target_inbox:applied", "consumer_commit:applied"]);
    for (const r of res.receipts!)
      expect(await verifyReceipt(r, expectReceipt(a.envelope, CONN, r.kind), reg, nowSec(), receiptContext(a.envelope, nowSec() - 5))).toEqual({ ok: true });
    expect(await effects(a.envelope.event_id)).toBe(1);
    const adm = await sql`SELECT connection_id, signer, outcome FROM rtgip.admissions WHERE event_id = ${a.envelope.event_id}`;
    expect(adm).toEqual([{ connection_id: CONN, signer: "gateway", outcome: "applied" }]);
  });

  it("a redelivery with a new Gateway nonce is a committed duplicate: no second effect", async () => {
    const a = await envelope();
    await admitDelivery(await gw(a.body, a.envelope), a.body, deps());
    const res = await admitDelivery(await gw(a.body, a.envelope), a.body, deps());
    expect(res.receipts!.map((r) => `${r.kind}:${r.outcome}`)).toEqual(["target_inbox:duplicate", "consumer_commit:applied"]);
    expect(await effects(a.envelope.event_id)).toBe(1);
  });

  it("20 concurrent admissions of the same delivery (exact retries) produce one effect", async () => {
    const a = await envelope();
    const h = await gw(a.body, a.envelope);
    const res = await Promise.all(Array.from({ length: 20 }, () => admitDelivery(h, a.body, deps())));
    expect(res.every((r) => r.http_status === 200)).toBe(true);
    expect(res.filter((r) => r.receipts![0]!.outcome === "applied")).toHaveLength(1);
    expect(await effects(a.envelope.event_id)).toBe(1);
  });

  it("out-of-order delivery is held without a commit receipt, then released in order", async () => {
    const r1 = await envelope({ aggregate: { domain: "inventory", type: "episode", id: "agg-ooo", revision: 1, prev_revision: null } }, "ooo1");
    const r2 = await envelope({ aggregate: { domain: "inventory", type: "episode", id: "agg-ooo", revision: 2, prev_revision: 1 }, origin: { app: "autolabels", event_id: "org-ooo2", revision: 2 } }, "ooo2");
    const held = await admitDelivery(await gw(r2.body, r2.envelope), r2.body, deps());
    expect(held.receipts!.map((r) => `${r.kind}:${r.outcome}`)).toEqual(["target_inbox:held"]);
    const rel = await admitDelivery(await gw(r1.body, r1.envelope), r1.body, deps());
    expect(rel.outcomes!.map((o) => o.outcome)).toEqual(["applied", "applied"]);
    const order = await sql`SELECT revision FROM rtgip_test.effects WHERE agg = 'agg-ooo' ORDER BY seq`;
    expect(order.map((r) => Number(r.revision))).toEqual([1, 2]);
  });

  it("a consumer effect failure rolls back and records quarantine; no consumer_commit is issued", async () => {
    const a = await envelope({ vehicle: { vin: "1HGCM82633A004352", instance_id: "inst-syn-0001", episode_id: "ep-unknown" } });
    const res = await admitDelivery(await gw(a.body, a.envelope), a.body, deps());
    expect(res.receipts!.map((r) => `${r.kind}:${r.outcome}`)).toEqual(["target_inbox:quarantined"]);
    const row = await sql`SELECT outcome, reason FROM rtgip.inbox WHERE event_id = ${a.envelope.event_id}`;
    expect(row).toEqual([{ outcome: "quarantined", reason: "consumer_reject:unknown_episode" }]);
    expect(await effects(a.envelope.event_id)).toBe(0);
    const again = await admitDelivery(await gw(a.body, a.envelope), a.body, deps());
    expect(again.receipts!.map((r) => `${r.kind}:${r.outcome}`)).toEqual(["target_inbox:quarantined"]);
  });

  it("crash inside the business transaction: everything rolls back, 503 without receipts, and the same delivery is admitted on retry", async () => {
    const a = await envelope();
    const h = await gw(a.body, a.envelope);
    const crashing: AdmissionEffect = async (tx, e) => {
      await effect(tx, e);
      throw new Error("worker crashed after writing");
    };
    const res = await admitDelivery(h, a.body, { ...deps(), effect: crashing });
    expect(res).toEqual({ http_status: 503, reason: "admission_aborted" });
    expect(await effects(a.envelope.event_id)).toBe(0);
    expect(await sql`SELECT 1 FROM rtgip.inbox WHERE event_id = ${a.envelope.event_id}`).toHaveLength(0);
    expect(await sql`SELECT 1 FROM rtgip.admissions WHERE event_id = ${a.envelope.event_id}`).toHaveLength(0);
    // The nonce claim rolled back with it, so the Gateway's retry of the identical request applies once.
    const retry = await admitDelivery(h, a.body, deps());
    expect(retry.receipts!.map((r) => `${r.kind}:${r.outcome}`)).toEqual(["target_inbox:applied", "consumer_commit:applied"]);
    expect(await effects(a.envelope.event_id)).toBe(1);
    // After the commit an identical re-presentation is a committed duplicate (the database nonce
    // claim binds the nonce to these exact bytes), so a lost acknowledgement still recovers.
    const again = await admitDelivery(h, a.body, deps());
    expect(again.receipts!.map((r) => `${r.kind}:${r.outcome}`)).toEqual(["target_inbox:duplicate", "consumer_commit:applied"]);
    expect(await effects(a.envelope.event_id)).toBe(1);
  });

  it("a lost database connection is a retryable 503 with no receipts", async () => {
    const a = await envelope();
    const down = { transaction: async () => { throw new Error("connection terminated"); } };
    expect(await admitDelivery(await gw(a.body, a.envelope), a.body, { ...deps(), db: down })).toEqual({ http_status: 503, reason: "admission_aborted" });
  });

  it("sold-vehicle episode isolation: a later episode of the same vehicle has its own ordering", async () => {
    const agg = { domain: "inventory" as const, type: "episode", id: "agg-iso" };
    const ep1r3 = await envelope({ aggregate: { ...agg, revision: 3, prev_revision: null }, vehicle: { vin: "1HGCM82633A004352", instance_id: "inst-syn-0001", episode_id: EPISODE } }, "iso13");
    const ep2r1 = await envelope({ aggregate: { ...agg, revision: 1, prev_revision: null }, vehicle: { vin: "1HGCM82633A004352", instance_id: "inst-syn-0001", episode_id: EPISODE_2 } }, "iso21");
    const ep1late = await envelope({ aggregate: { ...agg, revision: 2, prev_revision: null }, vehicle: { vin: "1HGCM82633A004352", instance_id: "inst-syn-0001", episode_id: EPISODE } }, "iso12");
    const o = async (x: Awaited<ReturnType<typeof envelope>>) => (await admitDelivery(await gw(x.body, x.envelope), x.body, deps())).receipts![0]!.outcome;
    expect(await o(ep1r3)).toBe("applied");
    expect(await o(ep2r1)).toBe("applied");
    expect(await o(ep1late)).toBe("stale_ignored");
    const marks = await sql`SELECT wm_key, revision FROM rtgip.watermarks WHERE wm_key LIKE '%|agg-iso|%' ORDER BY wm_key`;
    expect(marks.map((m) => [String(m.wm_key).split("|").pop(), Number(m.revision)])).toEqual([[EPISODE, 3], [EPISODE_2, 1]]);
  });

  it("permission changed after the Gateway signed: both verifiers refuse and nothing is applied", async () => {
    const a = await envelope();
    const h = await gw(a.body, a.envelope);
    for (const [patch, sqlReason] of [
      ["status = 'suspended'", "connection_revoked"],
      ["reader_enabled = false", "reader_disabled"],
      ["producer_enabled = false", "producer_disabled"],
      ["rooftop_ids = '{rf-nw-02}'", "rooftop_not_granted"],
      ["purposes = '{media_reference}'", "purpose_not_granted"],
      ["event_types = '{media.approved}'", "event_not_granted"],
    ] as const) {
      reg = await seedRegistry(sql, "autocurb");
      await sql.unsafe(`UPDATE rtgip.connections SET ${patch} WHERE connection_id = '${CONN}'`);
      expect((await direct(h, a.body)).reason).toBe(sqlReason);
    }
    expect(await effects(a.envelope.event_id)).toBe(0);
  });

  it("forged inbox admission: a bad MAC, a replayed nonce with other bytes, an old timestamp and a source-signed delivery are refused in SQL", async () => {
    const a = await envelope();
    const h = await gw(a.body, a.envelope);
    expect((await direct({ ...h, "rtgip-signature": SIGNATURE_PREFIX + "0".repeat(64) }, a.body)).reason).toBe("bad_signature");
    expect((await direct(h, a.body.replace("frontline", "sold"))).reason).toBe("bad_signature");
    const b = await envelope();
    const hb = await gw(b.body, b.envelope, h["rtgip-nonce"]);
    await direct(h, a.body);
    expect((await direct(hb, b.body)).reason).toBe("nonce_reused");
    const old = await hdr(signEnvelope(a.body, a.envelope, keyOf(reg, "gw-dev-1"), nowSec() - 900, "old_nonce_0123456789"));
    expect((await direct(old, a.body)).reason).toBe("timestamp_out_of_window");
    const src = await hdr(signEnvelope(b.body, b.envelope, keyOf(reg, "al-dev-1"), nowSec(), "src_nonce_0123456789"));
    expect((await direct(src, b.body)).reason).toBe("signer_not_gateway");
    await sql`UPDATE rtgip.signing_keys SET status = 'revoked' WHERE key_id = 'gw-dev-1'`;
    expect((await direct(await gw(b.body, b.envelope), b.body)).reason).toBe("key_revoked");
    const audits = await sql`SELECT count(*)::int AS c FROM rtgip.audit_log WHERE action = 'admission_rejected'`;
    expect(audits[0]!.c).toBeGreaterThanOrEqual(6);
  });

  // Validly Gateway-signed bytes that only the database's own checks can refuse: proves the
  // SQL interface is safe even when a caller skips or subverts the TypeScript verifier.
  it.each([
    ["non-canonical body (whitespace)", (e: Record<string, unknown>) => JSON.stringify(e, null, 1), "body_not_canonical"],
    ["unknown envelope field", (e: Record<string, unknown>) => canonicalize({ ...e, extra: "x" }), "invalid_envelope:fields"],
    ["payload changed, hash kept", (e: Record<string, unknown>) => canonicalize({ ...e, payload: { ...(e.payload as object), status: "sold" } }), "payload_hash_mismatch"],
    ["event id not derived", (e: Record<string, unknown>) => canonicalize({ ...e, event_id: "00000000-0000-5000-8000-000000000000" }), "event_id_not_derived"],
    ["wrong destination", (e: Record<string, unknown>) => canonicalize({ ...e, target_app: "autoframe", route: "autolabels->autoframe" }), "event_id_not_derived"],
    ["float number", (e: Record<string, unknown>) => canonicalize(e).replace('"schema_version":2', '"schema_version":2.0'), "body_not_canonical"],
  ] as const)("database refuses Gateway-signed %s", async (_n, mutate, reason) => {
    const a = await envelope();
    const raw = mutate(JSON.parse(a.body) as Record<string, unknown>);
    const parsed = (() => { try { return JSON.parse(raw) as Record<string, unknown>; } catch { return {}; } })();
    const row = await direct(await signedRaw(raw, scopeFor({ ...JSON.parse(a.body), ...parsed })), raw);
    expect(row.outcome).toBe("rejected");
    expect(row.reason).toBe(reason);
    const ts = await verifyDelivery(await signedRaw(raw, scopeFor({ ...JSON.parse(a.body), ...parsed })), raw, { registry: reg, nonces: new MemoryNonceStore(), nowSec: nowSec(), expectedSigner: "gateway", receiver: "autocurb" });
    expect(ts.ok).toBe(false);
  });

  it("database refuses a correctly derived event for another destination, a reserved route and a forbidden key", async () => {
    const other = await sealEnvelope(draftEnvelope("autolabels", "autoframe", "inventory.status_changed", { origin: { app: "autolabels", event_id: "org-dest", revision: 1 } }));
    expect((await direct(await gw(other.body, other.envelope), other.body)).reason).toBe("wrong_destination");
    const a = await envelope();
    const e = JSON.parse(a.body) as Record<string, unknown>;
    const leaked = { ...e, payload: { ...(e.payload as object), acv_value: 1 } } as Record<string, unknown>;
    leaked.payload_sha256 = await sha256Hex(canonicalize(leaked.payload));
    const body = canonicalize(leaked);
    expect((await direct(await signedRaw(body, scopeFor(leaked)), body)).reason).toBe("invalid_envelope:sensitive_content");
  });

  // The Gateway contract file: each body re-signed now with the same DEV key and the recorded
  // header change, then presented straight to inbox_admit. The database must reach the recorded outcome.
  it.each(contract.cases.map((c) => [c.name, c] as const))("Gateway contract: %s", async (_n, c) => {
    const k = keyOf(reg, "gw-dev-1");
    const ch = c.header_change as { kind: string; value?: string; seconds?: number };
    const ts = nowSec() + (ch.kind === "timestamp_offset" ? ch.seconds! : 0);
    const nonce = ch.kind === "nonce" ? ch.value! : `contract_${n++}_0123456789`;
    const h = await signedRaw(c.body, c.headers["rtgip-scope"]!, ts, nonce);
    if (ch.kind === "protocol") h["rtgip-protocol"] = ch.value!;
    if (ch.kind === "zero_signature") h["rtgip-signature"] = SIGNATURE_PREFIX + "0".repeat(64);
    if (ch.kind === "signer") h["rtgip-signer"] = ch.value!;
    if (ch.kind === "key_id") h["rtgip-key-id"] = ch.value!;
    expect(h["rtgip-key-id"] === k.key_id || ch.kind === "key_id").toBe(true);
    const row = await direct(h, c.body);
    expect(c.expect_db === "applied" ? row.outcome : row.reason).toBe(c.expect_db);
  });

  it("a HELD-dialect key cannot even be stored in the signing key registry", async () => {
    for (const d of contract.held_dialects.map((x) => x.dialect))
      await expect(sql`INSERT INTO rtgip.signing_keys (key_id, owner, dialect, status, connection_ids, not_before, not_after, secret_ref)
        VALUES (${"held-" + d}, 'gateway', ${d}, 'current', '{}', now(), now() + interval '1 day', ${"rtgip:held-" + d})`).rejects.toThrow(/signing_keys_dialect_check|violates check constraint/);
  });

  it("the receiving role cannot bypass admission; browser and service roles cannot admit", async () => {
    const a = await envelope();
    for (const stmt of [
      "SELECT * FROM rtgip.inbox_receive('{}'::jsonb, 'autocurb')",
      "SELECT rtgip.claim_nonce('k','nonce_bypass_0123456789',repeat('a',64),now())",
      "INSERT INTO rtgip.inbox (tenant_id, origin_app, event_id, wm_key, revision, payload_sha256, outcome, envelope) VALUES ('t','autolabels',gen_random_uuid(),'k',1,repeat('a',64),'applied','{}')",
      "UPDATE rtgip.watermarks SET revision = 0",
    ])
      await expect(admissionDb(sql).transaction((tx) => (tx as unknown as { sql: Sql }).sql.unsafe(stmt))).rejects.toThrow(/permission denied/);
    const h = await gw(a.body, a.envelope);
    for (const role of ["authenticated", "anon", "service_role", "rtgip_dispatcher", "rtgip_outbox_writer"])
      await expect(admissionDb(sql, role).transaction((tx) => tx.admit(h, a.body, null))).rejects.toThrow(/permission denied/);
  });
});
