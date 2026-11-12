// @vitest-environment node
// The generated bundle, served under Deno, against one disposable AutoLabels node (built from empty
// by supabase/tests/rtgip/autolabels_node.sh, the transport CHECK lifted in that throwaway cluster
// only by runtime_pg.sh). The compiled literal is injected by this test file; the committed entries
// are also run as deployed to show they refuse. The last scenario applies the proposed rtgip/3 attestation
// SQL twice and shows that dispatch leases nothing it cannot sign or attest (REVIEW-IMPL-2 M-1).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { produceFor } from "../rtgip2/produce.ts";
import { canonicalize, type AppId, type EnvelopeV2, type EventType, type Registry } from "../rtgip2/protocol.ts";
import { verifyReceiptV2, type ReceiptV2 } from "../rtgip2/receipt-v2.ts";
import { importSigningKey, sha256Hex as sha3, toHex, type SigningKey3 } from "../rtgip3/sig.ts";
import { recordPin, type KeyContext3, type PublicKeyRecord } from "../rtgip3/keys3.ts";
import { verifySignature3 } from "../rtgip3/core3.ts";
import { deliveryId3, receiptDraft3, signReceipt3, type Outcome3, type Receipt3, type Stage3 } from "../rtgip3/receipt3.ts";
import { verifyQuerySignature3, type QueryHeaders3 } from "../rtgip3/receipt-query3.ts";
import { labelsStagingAdapter as A } from "./staging-adapter.ts";
import {
  APP_PAIRS,
  connIdOf,
  denoAvailable,
  grant,
  gatewayDelivery,
  liftTransportCheck,
  makeRegistry,
  nowSec,
  postJson,
  seedRegistry,
  setTransport,
  startDeployedEntry,
  startRuntimeServer,
  startStubGateway,
  type DenoServer,
  type Sql,
  type StubGateway,
} from "../rtgip2-runtime/pg-harness.ts";

const PG_URL = process.env.RTGIP_PG_URL ?? "";
const S = {
  tenant: process.env.AL_SEED_TENANT ?? "",
  other: process.env.AL_SEED_OTHER_TENANT ?? "",
  rooftop: process.env.AL_SEED_ROOFTOP ?? "",
  open: process.env.AL_SEED_OPEN_EPISODE ?? "",
};
const run = describe.runIf(!!PG_URL && !!S.tenant && denoAvailable());
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const BUNDLE = path.join(ROOT, "supabase/functions/_shared/rtgip2-runtime.bundle.js");
const STAGING_REF = "uakiwvigsmrlyfpsalai";
const SERVICE_KEY = `svc-${randomUUID()}`;
const VIN_OPEN = "1M8GDM9AXKP042801";
const AT = "2026-11-03T10:00:00Z";
const UNMAPPED_ROOFTOP = "rf-stg-99";

let sql: Sql;
let reg: Registry;
let gw: StubGateway;
let rt: DenoServer;

async function appraisal(over: { tenant?: string; rooftop?: string; origin: string; agg?: string }) {
  const [out] = await produceFor(
    {
      source: "autocurb",
      event_type: "appraisal.completed" as EventType,
      tenant_id: over.tenant ?? S.tenant,
      rooftop_id: over.rooftop ?? S.rooftop,
      vehicle: { vin: VIN_OPEN, instance_id: S.open, episode_id: S.open },
      aggregate_id: over.agg ?? `apr-${randomUUID()}`,
      revision: 1,
      prev_revision: null,
      origin_event_id: over.origin,
      correlation_id: "corr-c0",
      causation_id: null,
      occurred_at: AT,
      emitted_at: AT,
      payload: { verified_state: "finalized", appraisal_ref: "apr-1", verified_by_ref: "staff-1", finalized_at: AT, audit_ref: "aud-apr-1" },
    },
    ["autolabels"] as AppId[],
  );
  return out!;
}

async function deliver(p: { envelope: EnvelopeV2; body: string }, tenant = S.tenant, nonce?: string, at?: number) {
  const g = await gatewayDelivery(reg, p.envelope, p.body, connIdOf("autocurb", "autolabels", tenant), { ...(nonce ? { nonce } : {}), ...(at ? { at } : {}) });
  const r = await postJson(`${rt.url}/inbound`, p.body, g.headers);
  return { status: r.status, doc: (await r.json()) as { reason: string | null; receipts: ReceiptV2[] }, g };
}

const publishAs = (user: string, body: unknown) =>
  postJson(`${rt.url}/publish`, JSON.stringify(body), { authorization: `Bearer user-${user}` });

const REFUSED: Record<string, [number, string]> = {
  inbound: [400, "admission_receipt_malformed"],
  dispatch: [503, "gateway_origin_not_allowed"],
  publish: [401, "unauthenticated"],
};

run("AutoLabels runtime bundle under Deno against a disposable node", () => {
  beforeAll(async () => {
    sql = postgres(PG_URL, { max: 5, onnotice: () => {}, idle_timeout: 5 });
    const conns = [
      ...APP_PAIRS.map(([s, t]) => grant(s, t, S.tenant, [S.rooftop, UNMAPPED_ROOFTOP])),
      grant("autocurb", "autolabels", S.other, [S.rooftop]),
    ];
    reg = makeRegistry(conns);
    await liftTransportCheck(sql);
    await seedRegistry(sql, reg, "autolabels");
    await setTransport(sql, true, "autolabels");
    gw = await startStubGateway(reg);
    rt = await startRuntimeServer({ bundleFile: BUNDLE, dbUrl: PG_URL, stagingRef: STAGING_REF, gatewayOrigin: gw.origin, serviceRoleKey: SERVICE_KEY, compiledEnabled: true });
  }, 180_000);
  afterAll(async () => {
    await rt?.stop();
    await gw?.close();
    await sql?.end();
  });

  it("admits a Gateway-signed delivery with a verified three-receipt chain and applies the effect once", async () => {
    const p = await appraisal({ origin: "ac-c0-1" });
    const first = await deliver(p);
    expect(first.status, rt.log()).toBe(200);
    expect(first.doc.receipts).toHaveLength(2);
    const chain: ReceiptV2[] = [first.g.admission];
    const kinds = ["target_inbox", "consumer_commit"] as const;
    for (let i = 0; i < 2; i++) {
      const exp = { envelope: p.envelope, connection_id: connIdOf("autocurb", "autolabels", S.tenant), delivery_id: first.g.deliveryId, kind: kinds[i]! };
      chain.push(await verifyReceiptV2(first.doc.receipts[i], exp, reg, nowSec() + 1, chain.slice()));
    }
    expect(chain.map((r) => r.kind)).toEqual(["gateway_admission", "target_inbox", "consumer_commit"]);
    expect(chain.map((r) => r.outcome)).toEqual(["admitted", "applied", "applied"]);
    expect((await A.record(sql, p.envelope))?.evidence).toHaveLength(1);
  });

  it("suppresses a duplicate: the stored chain comes back byte for byte and nothing is applied twice", async () => {
    const p = await appraisal({ origin: "ac-c0-dup" });
    const at = Math.floor(Date.now() / 1000);
    const first = await deliver(p, S.tenant, undefined, at);
    expect(first.status).toBe(200);
    const exactRetry = await deliver(p, S.tenant, first.g.headers["rtgip-nonce"], at);
    const freshNonce = await deliver(p, S.tenant, undefined, at);
    for (const again of [exactRetry, freshNonce]) {
      expect(again.status).toBe(200);
      expect(again.doc.receipts).toEqual(first.doc.receipts);
    }
    expect((await A.record(sql, p.envelope))?.evidence).toHaveLength(1);
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM rtgip.inbox WHERE event_id = ${p.envelope.event_id}::uuid`;
    expect(n).toBe(1);
  });

  it("quarantines a cross-tenant delivery: the effect refuses and no business row is written", async () => {
    const p = await appraisal({ tenant: S.other, origin: "ac-c0-xtenant" });
    const r = await deliver(p, S.other);
    expect(r.status, rt.log()).toBe(200);
    expect(r.doc.receipts).toHaveLength(1);
    expect(r.doc.receipts[0]).toMatchObject({ kind: "target_inbox", outcome: "quarantined" });
    expect(await A.record(sql, p.envelope)).toBeNull();
  });

  it("quarantines a cross-rooftop delivery that the connection grants but this app does not map", async () => {
    const p = await appraisal({ rooftop: UNMAPPED_ROOFTOP, origin: "ac-c0-xroof" });
    const r = await deliver(p);
    expect(r.status, rt.log()).toBe(200);
    expect(r.doc.receipts[0]).toMatchObject({ kind: "target_inbox", outcome: "quarantined" });
    expect(r.doc.receipts).toHaveLength(1);
    expect(await A.record(sql, p.envelope)).toBeNull();
  });

  it("refuses a delivery for a rooftop or tenant the registry never granted", async () => {
    const roof = await appraisal({ rooftop: "rf-never-granted", origin: "ac-c0-nogrant" });
    const a = await deliver(roof);
    expect([401, 403]).toContain(a.status);
    expect(a.doc.receipts).toEqual([]);
    const ten = await appraisal({ tenant: randomUUID(), origin: "ac-c0-notenant" });
    const b = await deliver(ten, S.tenant);
    expect([401, 403]).toContain(b.status);
    expect(b.doc.receipts).toEqual([]);
    expect(await A.record(sql, roof.envelope)).toBeNull();
  });

  it("publishes for a tenant manager through the real authorizer, and refuses everyone else", async () => {
    const manager = randomUUID();
    const staff = randomUUID();
    const foreign = randomUUID();
    const stranger = randomUUID();
    for (const u of [manager, staff, foreign, stranger]) await sql`INSERT INTO auth.users (id, email) VALUES (${u}::uuid, ${`c0-${u}@example.test`})`;
    await sql`INSERT INTO public.tenant_members (tenant_id, user_id, role, accepted_at) VALUES
      (${S.tenant}::uuid, ${manager}::uuid, 'manager', now()), (${S.tenant}::uuid, ${staff}::uuid, 'staff', now()), (${S.other}::uuid, ${foreign}::uuid, 'owner', now())`;
    const ask = (over: Record<string, unknown> = {}) => ({ kind: "identity_registered", tenant_id: S.tenant, rooftop_id: S.rooftop, ref: { episode_id: S.open }, ...over });
    const noAuth = await postJson(`${rt.url}/publish`, JSON.stringify(ask()));
    expect(noAuth.status).toBe(401);
    const outside = await publishAs(stranger, ask());
    expect([outside.status, ((await outside.json()) as { reason: string }).reason]).toEqual([403, "not_a_member"]);
    const otherTenant = await publishAs(foreign, ask());
    expect([otherTenant.status, ((await otherTenant.json()) as { reason: string }).reason]).toEqual([403, "not_a_member"]);
    const lowRole = await publishAs(staff, ask());
    expect([lowRole.status, ((await lowRole.json()) as { reason: string }).reason]).toEqual([403, "role_not_permitted"]);
    const unmapped = await publishAs(manager, ask({ rooftop_id: UNMAPPED_ROOFTOP }));
    expect([unmapped.status, ((await unmapped.json()) as { reason: string }).reason]).toEqual([403, "rooftop_unmapped"]);
    expect((await sql`SELECT 1 FROM rtgip.outbox`).length).toBe(0);

    const hostile = ask({ target_app: "autofilm", envelope: { tenant_id: S.other }, ref: { episode_id: S.open, targets: "autofilm", emitted_at: "1999-01-01T00:00:00Z" } });
    const ok = await publishAs(manager, hostile);
    const doc = (await ok.json()) as { results: { event_id: string; target_app: string; result: string }[] };
    expect(ok.status, rt.log()).toBe(200);
    expect(doc.results.map((x) => [x.target_app, x.result]).sort()).toEqual([["autocurb", "enqueued"], ["autoframe", "enqueued"]]);
    const rows = await sql`SELECT envelope->>'emitted_at' AS emitted_at, envelope->>'tenant_id' AS tenant, state FROM rtgip.outbox`;
    expect(rows).toHaveLength(2);
    for (const r of rows) expect([r.tenant, r.state, String(r.emitted_at).startsWith("1999")]).toEqual([S.tenant, "pending", false]);
  });

  it("runs one dispatcher pass against the stub Gateway: signed deliveries, admission receipts, lease advanced", async () => {
    const wrong = await postJson(`${rt.url}/dispatch`, "{}", { authorization: "Bearer not-the-key" });
    expect(wrong.status).toBe(401);
    const none = await postJson(`${rt.url}/dispatch`, "{}");
    expect(none.status).toBe(401);
    const r = await postJson(`${rt.url}/dispatch`, "{}", { authorization: `Bearer ${SERVICE_KEY}` });
    const doc = (await r.json()) as { action: string; http_status: number; advanced: string[]; state: string }[];
    expect(r.status, rt.log()).toBe(200);
    expect(doc).toHaveLength(2);
    for (const d of doc) expect(d).toMatchObject({ action: "deliver", http_status: 200, advanced: ["gateway_admitted"], state: "gateway_admitted" });
    expect(gw.seen.filter((s) => s.path === "/api/rtgip/v2/deliver" && s.verified)).toHaveLength(2);
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM rtgip.receipts WHERE kind = 'gateway_admission'`;
    expect(n).toBe(2);
    const idle = await postJson(`${rt.url}/dispatch`, "{}", { authorization: `Bearer ${SERVICE_KEY}` });
    expect(await idle.json()).toEqual([]);
  });

  it("AR-1 option 1: confirms on [admission, gateway_confirmation] from the receipt query; target evidence is never verified here", async () => {
    const due = (await sql`UPDATE rtgip.outbox SET next_attempt_at = now() WHERE state = 'gateway_admitted' RETURNING event_id`).length;
    expect(due).toBeGreaterThan(0);
    const r = await postJson(`${rt.url}/dispatch`, "{}", { authorization: `Bearer ${SERVICE_KEY}` });
    const doc = (await r.json()) as { action: string; http_status: number; advanced: string[]; state: string }[];
    expect(r.status, rt.log()).toBe(200);
    expect(doc).toHaveLength(due);
    for (const d of doc) expect(d).toMatchObject({ action: "confirm", http_status: 200, advanced: ["consumer_committed"], state: "consumer_committed" });
    expect(gw.seen.filter((s) => s.path === "/api/rtgip/v2/receipts" && s.verified)).toHaveLength(due);
    const kinds = await sql`SELECT kind, count(*)::int AS n FROM rtgip.receipts GROUP BY kind ORDER BY kind`;
    expect(kinds.map((k) => [k["kind"], k["n"]])).toEqual([["gateway_admission", due], ["gateway_confirmation", due]]);
  });

  it("stops at the database kill switch and at a local_app mismatch, then resumes", async () => {
    const hit = async () => {
      const out: [number, string][] = [];
      for (const [p, h] of [["inbound", {}], ["dispatch", { authorization: `Bearer ${SERVICE_KEY}` }], ["publish", { authorization: `Bearer user-${randomUUID()}` }]] as const) {
        const r = await postJson(`${rt.url}/${p}`, "{}", h);
        out.push([r.status, ((await r.json()) as { reason: string }).reason]);
      }
      return out;
    };
    await setTransport(sql, false);
    expect(await hit()).toEqual([[503, "transport_disabled"], [503, "transport_disabled"], [503, "transport_disabled"]]);
    await setTransport(sql, true, "autocurb");
    expect(await hit()).toEqual([[503, "local_app_mismatch"], [503, "local_app_mismatch"], [503, "local_app_mismatch"]]);
    await setTransport(sql, true, "autolabels");
    expect((await hit())[0]).toEqual([400, "admission_receipt_malformed"]);
  });

  it("refuses a runtime built with the literal off, and the mode, and a production backend", async () => {
    const off = await startRuntimeServer({ bundleFile: BUNDLE, dbUrl: PG_URL, stagingRef: STAGING_REF, gatewayOrigin: gw.origin, serviceRoleKey: SERVICE_KEY, compiledEnabled: false });
    const mode = await startRuntimeServer({ bundleFile: BUNDLE, dbUrl: PG_URL, stagingRef: STAGING_REF, gatewayOrigin: gw.origin, serviceRoleKey: SERVICE_KEY, compiledEnabled: true, mode: "off" });
    try {
      const a = await postJson(`${off.url}/inbound`, "{}");
      expect([a.status, ((await a.json()) as { reason: string }).reason]).toEqual([503, "RTGIP2_NOT_ACTIVATED"]);
      const b = await postJson(`${mode.url}/inbound`, "{}");
      expect([b.status, ((await b.json()) as { reason: string }).reason]).toEqual([503, "runtime_mode_off"]);
    } finally {
      await off.stop();
      await mode.stop();
    }
  }, 180_000);

  it("the committed function entries, run as deployed, refuse every call", async () => {
    for (const fn of ["inbound", "dispatch", "publish"]) {
      const entry = path.join(ROOT, `supabase/functions/rtgip-${fn}/index.ts`);
      const d = await startDeployedEntry(entry, {
        SUPABASE_URL: `https://${STAGING_REF}.supabase.co`,
        SUPABASE_DB_URL: PG_URL,
        SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
        RTGIP2_RUNTIME_MODE: "staging",
        RTGIP2_GATEWAY_URL: gw.origin,
      });
      try {
        const r = await postJson(`${d.url}/`, "{}", { authorization: `Bearer ${SERVICE_KEY}` });
        expect([fn, r.status, ((await r.json()) as { reason: string }).reason]).toEqual([fn, ...REFUSED[fn]!]);
      } finally {
        await d.stop();
      }
    }
  }, 180_000);

  // ---- REVIEW-IMPL-2 M-1 on the rtgip/3 attestation SQL, after every rtgip/2 check above ------------------------------
  // The real bundle with test-generated stg-*-ed1 keys and a loopback rtgip/3 Gateway built from the mirrors (rtgip/2
  // goes on to the stub Gateway). One row pinned to rtgip/3 at its first claim (autolabels>autocurb) and one rtgip/2 row
  // (autolabels>autoframe) wait while the node has a key or configuration fault: every pass is refused before
  // rtgip.outbox_claim, so attempts and lease_generation stay 0 and nothing is sent; with the fault gone both deliver
  // and commit on their first leases.
  it("M-1: with the rtgip/3 SQL, a node that cannot sign or attest for an open row's protocol leases nothing; attempts stay 0 through every refused pass", async () => {
    const V3_SQL = readFileSync(path.join(ROOT, "supabase/proposed/rtgip_v3_attest.proposed.sql"), "utf8");
    await sql.unsafe(V3_SQL);
    await sql.unsafe(V3_SQL);
    const now = nowSec();
    const ACAL = connIdOf("autocurb", "autolabels", S.tenant);
    const ALAC = connIdOf("autolabels", "autocurb", S.tenant);
    const ALAF = connIdOf("autolabels", "autoframe", S.tenant);
    type K3 = { rec: PublicKeyRecord; secret: string; signer: SigningKey3 };
    const mk = async (key_id: string, owner: string): Promise<K3> => {
      const pair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
      const secret = Buffer.from(new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey))).toString("base64");
      const pk = toHex(new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)));
      const rec: PublicKeyRecord = {
        alg: "ed25519", connection_ids: [ACAL, ALAC, ALAF], fingerprint: await sha3(Buffer.from(pk, "hex")), key_id, not_after: now + 30 * 86_400, not_before: now - 3600,
        owner, protocol: "rtgip/3", public_key: pk, revoked_at: null, revoked_reason: null, status: "current",
      };
      return { rec, secret, signer: (await importSigningKey(key_id, owner, secret, pk))! };
    };
    const K = {
      gateway: await mk("stg-gateway-ed1", "gateway"),
      autolabels: await mk("stg-autolabels-ed1", "autolabels"),
      autocurb: await mk("stg-autocurb-ed1", "autocurb"),
      autoframe: await mk("stg-autoframe-ed1", "autoframe"),
    };
    const keyset = createHash("sha256").update(canonicalize(Object.values(K).map((k) => k.rec))).digest("hex");
    const install = async (r: PublicKeyRecord) => {
      await sql`INSERT INTO rtgip.public_keys (key_id, owner, protocol, alg, public_key, fingerprint, status, not_before, not_after, keyset_sha256)
        VALUES (${r.key_id}, ${r.owner}, 'rtgip/3', 'ed25519', ${r.public_key}, ${r.fingerprint}, ${r.status}, ${r.not_before}, ${r.not_after}, ${keyset})`;
      for (const c of r.connection_ids) await sql`INSERT INTO rtgip.public_key_bindings (key_id, connection_id) VALUES (${r.key_id}, ${c})`;
    };
    for (const k of Object.values(K)) await install(k.rec);
    const pins: Record<string, string> = {};
    for (const k of Object.values(K)) pins[k.rec.key_id] = await recordPin(k.rec);
    const pinsEnv = () => Object.entries(pins).map(([k, v]) => `${k}:${v}`).join(",");
    const ctx = (): KeyContext3 => ({ keys: Object.values(K).map((k) => k.rec), pins, now: nowSec(), env: "stg" });

    // The loopback rtgip/3 Gateway: admits a verified H1 and answers a verified receipt query with the target's chain.
    const hits: string[] = [];
    const admitted = new Map<string, { adm: Receipt3; body: string }>();
    const bodyOf = (req: IncomingMessage) => new Promise<string>((ok) => { const parts: Buffer[] = []; req.on("data", (d: Buffer) => parts.push(d)); req.on("end", () => ok(Buffer.concat(parts).toString("utf8"))); });
    const hdrs = (req: IncomingMessage) => Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(",") : String(v)]));
    const receiptFor = async (e: EnvelopeV2, body: string, conn: string, kind: Stage3, outcome: Outcome3, prev: Receipt3 | null, key: SigningKey3, at = nowSec()) => {
      const envelope_sha256 = await sha3(body);
      return signReceipt3(await receiptDraft3({ envelope: e, envelope_sha256, connection_id: conn, delivery_id: await deliveryId3(conn, e.event_id, e.target_app, envelope_sha256), kind }, outcome, at, prev), key);
    };
    const stub: Server = createServer((req, res) => {
      void (async () => {
        const body = await bodyOf(req);
        const reply = (status: number, doc: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(doc)); };
        const url = req.url ?? "/";
        if (url === "/api/rtgip/v3/deliver") {
          const e = JSON.parse(body) as EnvelopeV2;
          const conn = connIdOf(e.source_app, e.target_app, e.tenant_id);
          const v = await verifySignature3(hdrs(req), body, "source", ctx(), conn);
          hits.push(`v3/deliver:${v.ok ? "ok" : v.reason}`);
          if (!v.ok) return reply(401, { error: v.reason });
          const adm = await receiptFor(e, body, conn, "gateway_admission", "admitted", null, K.gateway.signer);
          admitted.set(adm.delivery_id, { adm, body });
          return reply(200, { outcome: "admitted", receipt: adm });
        }
        if (url === "/api/rtgip/v3/receipts") {
          const v = await verifyQuerySignature3(hdrs(req) as unknown as QueryHeaders3, body, ctx());
          hits.push(`v3/receipts:${v.ok ? "ok" : v.reason}`);
          if (!v.ok) return reply(401, { error: v.reason });
          const a = admitted.get((JSON.parse(body) as { delivery_id: string }).delivery_id);
          if (!a) return reply(404, { error: "delivery_not_found" });
          const e = JSON.parse(a.body) as EnvelopeV2;
          const inbox = await receiptFor(e, a.body, a.adm.connection_id, "target_inbox", "applied", a.adm, K.autocurb.signer, a.adm.issued_at);
          const commit = await receiptFor(e, a.body, a.adm.connection_id, "consumer_commit", "applied", inbox, K.autocurb.signer, a.adm.issued_at);
          return reply(200, { receipts: [a.adm, inbox, commit] });
        }
        hits.push(`v2:${url}`);
        const r = await fetch(`${gw.url}${url}`, { method: req.method, headers: Object.fromEntries(Object.entries(hdrs(req)).filter(([k]) => k !== "host" && k !== "content-length")), body: req.method === "GET" ? undefined : body });
        res.writeHead(r.status, { "content-type": r.headers.get("content-type") ?? "application/json" });
        res.end(await r.text());
      })().catch((err: unknown) => { res.writeHead(500); res.end(JSON.stringify({ error: String(err) })); });
    });
    await new Promise<void>((ok) => stub.listen(0, "127.0.0.1", () => ok()));
    const stubUrl = `http://127.0.0.1:${(stub.address() as { port: number }).port}`;
    const bundleSha = createHash("sha256").update(readFileSync(BUNDLE)).digest("hex");
    const SECRET = "RTGIP3_SIGNING_KEY_STG_AUTOLABELS_ED1";
    const healthy = (): Record<string, string> => ({ RTGIP3_ENABLED: "true", RTGIP3_KEY_ENV: "stg", RTGIP3_KEY_PINS: pinsEnv(), [SECRET]: K.autolabels.secret, RTGIP3_VERIFIER_DIGEST: bundleSha });
    const without = (o: Record<string, string>, ...names: string[]) => Object.fromEntries(Object.entries(o).filter(([k]) => !names.includes(k)));
    const swap = async (env: Record<string, string>, gatewayOrigin = stubUrl) => {
      const before = rt;
      rt = await startRuntimeServer({ bundleFile: BUNDLE, dbUrl: PG_URL, stagingRef: STAGING_REF, gatewayOrigin, serviceRoleKey: SERVICE_KEY, compiledEnabled: true, env });
      await before.stop();
    };

    // One rtgip/3 and one rtgip/2 row, from the AutoLabels producer, enqueued as the outbox writer.
    await sql`UPDATE rtgip.connections SET accept_protocols = '{rtgip/2,rtgip/3}', v2_accept_until = ${now + 86_400}, send_protocol = 'rtgip/3' WHERE connection_id = ${ALAC}`;
    const inst = randomUUID();
    const produced = await produceFor(
      {
        source: "autolabels", event_type: "vehicle.identity_registered" as EventType, tenant_id: S.tenant, rooftop_id: S.rooftop,
        vehicle: { vin: VIN_OPEN, instance_id: inst, episode_id: randomUUID() }, aggregate_id: inst, revision: 1, prev_revision: null,
        origin_event_id: `al-m1-${inst}`, correlation_id: "corr-m1", causation_id: null, occurred_at: AT, emitted_at: AT,
        payload: { stock_number: "STG-M1", year: 2024, make: "Synthetic", model: "Model S1", trim: null, registered_at: AT },
      },
      ["autocurb", "autoframe"] as AppId[],
    );
    for (const p of produced)
      expect(await sql.begin(async (tx) => { await tx`SET LOCAL ROLE rtgip_outbox_writer`; return (await tx`SELECT rtgip.outbox_enqueue(${p.body}) AS r`)[0]!.r as string; })).toBe("enqueued");
    const toAc = produced.find((p) => p.envelope.target_app === "autocurb")!.envelope.event_id;
    const toAf = produced.find((p) => p.envelope.target_app === "autoframe")!.envelope.event_id;
    const rows = async () =>
      Object.fromEntries(
        (await sql`SELECT event_id::text AS id, state, attempts, lease_generation, protocol FROM rtgip.outbox WHERE event_id = ANY(${sql.array([toAc, toAf])}::uuid[])`).map((r) => [
          r.id === toAc ? "v3" : "v2",
          `${r.state}/${r.attempts}/${r.lease_generation}/${r.protocol ?? "-"}`,
        ]),
      );
    let v2seen = gw.seen.length;
    const sent = () => { const n = hits.length + gw.seen.length - v2seen; hits.length = 0; v2seen = gw.seen.length; return n; };
    const passes = async (n: number) => {
      const got = new Set<string>();
      for (let i = 0; i < n; i++) {
        await sql`UPDATE rtgip.outbox SET next_attempt_at = now() WHERE event_id = ANY(${sql.array([toAc, toAf])}::uuid[]) AND state IN ('pending','retry_wait','gateway_admitted')`;
        const r = await postJson(`${rt.url}/dispatch`, "{}", { authorization: `Bearer ${SERVICE_KEY}` });
        const doc = (await r.json()) as { reason?: string } | { event_id: string; action: string; state: string }[];
        got.add(Array.isArray(doc) ? `${r.status}:${doc.map((d) => `${d.event_id === toAc ? "v3" : "v2"}/${d.action}/${d.state}`).sort().join(",")}` : `${r.status}:${doc.reason}`);
      }
      return [...got];
    };
    const refusedThrough = async (env: Record<string, string>, reason: string, at: Record<string, string>) => {
      await swap(env);
      expect(await passes(4), `${reason} ${rt.log().slice(-800)}`).toEqual([`503:${reason}`]);
      expect(await rows(), reason).toEqual(at);
      expect(sent(), reason).toBe(0);
    };
    const untouched = { v3: "pending/0/0/-", v2: "pending/0/0/-" };
    try {
      await refusedThrough(without(healthy(), SECRET), "no_signing_key", untouched);
      // The per-app secret name of the first rtgip/3 runtime is not read any more (L-4).
      await refusedThrough({ ...without(healthy(), SECRET), RTGIP3_SIGNING_KEY_AUTOLABELS: K.autolabels.secret }, "no_signing_key", untouched);
      await refusedThrough(without(healthy(), "RTGIP3_VERIFIER_DIGEST"), "verification_unavailable", untouched);
      await refusedThrough({ ...healthy(), RTGIP3_KEY_PINS: "x" }, "verification_unavailable", untouched);
      // L-8: rtgip/3 is off unless RTGIP3_ENABLED is exactly "true"; its rows wait like unsignable ones.
      await refusedThrough(without(healthy(), "RTGIP3_ENABLED"), "rtgip3_disabled", untouched);
      await refusedThrough({ ...healthy(), RTGIP3_ENABLED: "TRUE" }, "rtgip3_disabled", untouched);
      // Rotation step 1 of the design (4.3): a second current key row of this app, pinned.
      const k2 = await mk("stg-autolabels-ed2", "autolabels");
      await install(k2.rec);
      pins[k2.rec.key_id] = await recordPin(k2.rec);
      await refusedThrough({ ...healthy(), RTGIP3_SIGNING_KEY_STG_AUTOLABELS_ED2: k2.secret }, "no_signing_key", untouched);
      await sql`DELETE FROM rtgip.public_key_bindings WHERE key_id = ${k2.rec.key_id}`;
      await sql`DELETE FROM rtgip.public_keys WHERE key_id = ${k2.rec.key_id}`;
      delete pins[k2.rec.key_id];
      // L-3: the node's own key row with a validity outside the safe-integer range (written past the guard trigger)
      // is left out: no_signing_key, never 500.
      const saved = (await sql`SELECT not_after FROM rtgip.public_keys WHERE key_id = 'stg-autolabels-ed1'`)[0]!.not_after as string;
      await sql.begin(async (tx) => {
        await tx`SET LOCAL session_replication_role = replica`;
        await tx`UPDATE rtgip.public_keys SET not_after = 9007199254740993 WHERE key_id = 'stg-autolabels-ed1'`;
      });
      await refusedThrough(healthy(), "no_signing_key", untouched);
      await sql.begin(async (tx) => {
        await tx`SET LOCAL session_replication_role = replica`;
        await tx`UPDATE rtgip.public_keys SET not_after = ${saved} WHERE key_id = 'stg-autolabels-ed1'`;
      });
      // The rtgip/3 signer is fine and the app's rtgip/2 key has expired: the open rtgip/2 row is not leased either.
      const v2keys = await sql`SELECT key_id, not_before, not_after FROM rtgip.signing_keys WHERE owner = 'autolabels'`;
      expect(v2keys.length).toBeGreaterThan(0);
      await sql`UPDATE rtgip.signing_keys SET not_before = now() - interval '3 hours', not_after = now() - interval '1 hour' WHERE owner = 'autolabels'`;
      await refusedThrough(healthy(), "no_signing_key", untouched);
      for (const k of v2keys) await sql`UPDATE rtgip.signing_keys SET not_before = ${k.not_before}, not_after = ${k.not_after} WHERE key_id = ${k.key_id}`;

      // Healthy: both rows are delivered on their first lease.
      await swap(healthy());
      expect(await passes(1), rt.log().slice(-1500)).toEqual(["200:v2/deliver/gateway_admitted,v3/deliver/gateway_admitted"]);
      expect(await rows()).toEqual({ v3: "gateway_admitted/1/1/rtgip/3", v2: "gateway_admitted/1/1/rtgip/2" });
      expect([...hits].sort()).toEqual(["v2:/api/rtgip/v2/deliver", "v3/deliver:ok"]);
      sent();
      // Admitted, then the secret goes missing before the confirmation: the admitted rows keep their attempts.
      await refusedThrough(without(healthy(), SECRET), "no_signing_key", { v3: "gateway_admitted/1/1/rtgip/3", v2: "gateway_admitted/1/1/rtgip/2" });
      await swap(healthy());
      expect(await passes(1)).toEqual(["200:v2/confirm/consumer_committed,v3/confirm/consumer_committed"]);
      expect(await rows()).toEqual({ v3: "consumer_committed/2/2/rtgip/3", v2: "consumer_committed/2/2/rtgip/2" });
      const audit = await sql`SELECT action FROM rtgip.audit_log WHERE event_id = ANY(${sql.array([toAc, toAf])}::uuid[])`;
      expect(audit.filter((a) => /fail|dead/.test(String(a.action)))).toEqual([]);
      expect((await sql`SELECT count(*)::int AS n FROM rtgip.evidence_v3 WHERE entry = 'outbox_advance_v3' AND verifier = ${bundleSha}`)[0]!.n).toBeGreaterThan(0);

      // L-6 and L-8 at the edge: an unsigned rtgip/3 request is refused on its headers; with the switch off, any rtgip/3 request is.
      const bare = await postJson(`${rt.url}/inbound`, "{}", { "rtgip-protocol": "rtgip/3" });
      expect([bare.status, ((await bare.json()) as { reason: string }).reason]).toEqual([400, "missing_headers"]);
      await swap(without(healthy(), "RTGIP3_ENABLED"));
      const off = await postJson(`${rt.url}/inbound`, "{}", { "rtgip-protocol": "rtgip/3" });
      expect([off.status, ((await off.json()) as { reason: string }).reason]).toEqual([403, "protocol_not_accepted"]);

      // L-1 on the real gate: once the rtgip/2 window of autocurb>autolabels has closed, a Gateway-signed rtgip/2 delivery
      // is refused 403, while an unsigned body naming that connection's scope (also with a raw NUL byte) gets the
      // answer it always got, so the gate is no oracle and a gate query never fails into a 500.
      await sql`UPDATE rtgip.connections SET accept_protocols = '{rtgip/2,rtgip/3}', v2_accept_until = ${now + 86_400} WHERE connection_id = ${ACAL}`;
      const added = Number((await sql`SELECT v3_added_at FROM rtgip.connections WHERE connection_id = ${ACAL}`)[0]!.v3_added_at);
      await sql`UPDATE rtgip.connections SET v2_accept_until = ${added - 1} WHERE connection_id = ${ACAL}`;
      const late = await deliver(await appraisal({ origin: `ac-m1-late-${randomUUID()}` }));
      expect([late.status, late.doc.reason]).toEqual([403, "protocol_not_accepted"]);
      for (const body of [
        JSON.stringify({ protocol: "rtgip/2", source_app: "autocurb", target_app: "autolabels", tenant_id: S.tenant, rooftop_id: S.rooftop }),
        `{"protocol":"rtgip/2","rooftop_id":"${S.rooftop}","source_app":"autocurb","target_app":"autolabels","tenant_id":"${S.tenant}","x":"\u0000"}`,
      ]) {
        const r = await postJson(`${rt.url}/inbound`, body, { "rtgip-protocol": "rtgip/2" });
        expect([r.status, ((await r.json()) as { reason: string }).reason]).toEqual([400, "admission_receipt_malformed"]);
      }
      expect(rt.log()).not.toMatch(/rtgip2_runtime_error/);
    } finally {
      await sql`UPDATE rtgip.connections SET send_protocol = 'rtgip/2' WHERE connection_id = ${ALAC}`;
      await swap({}, gw.origin);
      await new Promise<void>((ok) => stub.close(() => ok()));
    }
  }, 300_000);
});
