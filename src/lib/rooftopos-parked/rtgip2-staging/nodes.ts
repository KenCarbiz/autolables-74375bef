// Local four-node staging plumbing. Test-only. Each node is a real HTTP server on 127.0.0.1
// backed by its own throwaway PostgreSQL cluster (supabase/tests/rtgip/pg_staging.sh):
//   - AutoLabels, AutoCurb, AutoFrame: admitDelivery() against rtgip.inbox_admit, with the
//     app's real consumer code mutating a projection inside the same transaction;
//   - a Gateway STAND-IN built from the shared core (verify source, durable admission, re-sign,
//     forward). It is not the hosted Gateway and proves nothing about it.
// Every key is generated here at start-up from crypto.randomBytes and lives only in memory and
// in the throwaway clusters.
import http from "node:http";
import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import postgres from "postgres";
import {
  ROUTES,
  canonicalize,
  sha256Hex,
  signEnvelope,
  verifyDelivery,
  MAX_BODY_BYTES,
  type AppId,
  type EnvelopeV2,
  type EventType,
  type NonceStore,
  type Purpose,
  type Registry,
  type ServiceConnection,
  type ServiceKey,
} from "../rtgip2/protocol.ts";
import type { ConsumerEffect } from "../rtgip2/delivery.ts";
import { deliveryIdentity, receiptDraft, signReceiptV2, verifyReceiptV2, type ReceiptV2 } from "../rtgip2/receipt-v2.ts";
import { signReceiptQuery, verifyReceiptQuery } from "../rtgip2/receipt-query.ts";
import { ADMISSION_HEADER, admitDelivery, encodeAdmissionHeader, type AdmissionEffect } from "../rtgip2/admission.ts";
import { admissionDb } from "../rtgip2-pg/pg.ts";

export type Sql = ReturnType<typeof postgres>;
export type App = "autolabels" | "autocurb" | "autoframe";
export const APPS: readonly App[] = ["autolabels", "autocurb", "autoframe"];
export const ROOFTOP = "rf-stg-01";
export const OTHER_ROOFTOP = "rf-stg-02";
export const nowSec = () => Math.floor(Date.now() / 1000);
export const connect = (url: string): Sql => postgres(url, { max: 20, onnotice: () => {}, idle_timeout: 5 });
export const connIdOf = (s: AppId, t: AppId, tenant: string, rooftop = ROOFTOP) => `conn:${s}>${t}:${tenant}:${rooftop}`;

const PAIRS: readonly [App, App][] = [
  ["autolabels", "autocurb"],
  ["autolabels", "autoframe"],
  ["autocurb", "autolabels"],
  ["autocurb", "autoframe"],
  ["autoframe", "autolabels"],
  ["autoframe", "autocurb"],
];

function grant(s: App, t: App, tenant: string, rooftops: string[]): ServiceConnection {
  const route = ROUTES.find((r) => r.source === s && r.target === t)!;
  return {
    connection_id: connIdOf(s, t, tenant, rooftops[0]),
    source_app: s,
    target_app: t,
    tenant_id: tenant,
    rooftop_ids: rooftops,
    event_types: Object.keys(route.events) as EventType[],
    purposes: [...new Set(Object.values(route.events).flat())] as Purpose[],
    producer_enabled: true,
    reader_enabled: true,
    status: "active",
  };
}

/** Six staging connections for one synthetic tenant, plus one other-tenant AutoLabels->AutoCurb grant. Fresh random keys. */
export function stagingRegistry(tenant: string, otherTenant: string): Registry {
  const connections = [
    ...PAIRS.map(([s, t]) => grant(s, t, tenant, [ROOFTOP])),
    grant("autolabels", "autocurb", otherTenant, [OTHER_ROOFTOP]),
  ];
  const n = nowSec();
  const key = (owner: ServiceKey["owner"]): ServiceKey => ({
    key_id: `stg-${owner}-${randomBytes(6).toString("hex")}`,
    owner,
    dialect: "rtgip/2",
    connection_ids: connections
      .filter((c) => owner === "gateway" || c.source_app === owner || c.target_app === owner)
      .map((c) => c.connection_id),
    status: "current",
    not_before: n - 3600,
    not_after: n + 86_400,
    secret: randomBytes(32).toString("base64url"),
  });
  return { connections, keys: [key("gateway"), key("autolabels"), key("autocurb"), key("autoframe")] };
}

export const keyFor = (reg: Registry, owner: ServiceKey["owner"]): ServiceKey => {
  const k = reg.keys.find((x) => x.owner === owner && x.status === "current");
  if (!k) throw new Error(`no_current_key:${owner}`);
  return k;
};

/** Mirror the registry into one app node's delivery tables and Vault stand-in. */
export async function seedNode(sql: Sql, reg: Registry, app: App): Promise<void> {
  await sql.begin(async (tx) => {
    await tx.unsafe("DELETE FROM rtgip.signing_keys");
    await tx.unsafe("DELETE FROM vault.decrypted_secrets WHERE name LIKE 'rtgip:%'");
    for (const c of reg.connections)
      await tx`INSERT INTO rtgip.connections (connection_id, source_app, target_app, tenant_id, rooftop_ids, event_types, purposes, producer_enabled, reader_enabled, status)
        VALUES (${c.connection_id}, ${c.source_app}, ${c.target_app}, ${c.tenant_id}, ${tx.array([...c.rooftop_ids])}, ${tx.array([...c.event_types])},
                ${tx.array([...c.purposes])}, ${c.producer_enabled}, ${c.reader_enabled}, ${c.status})
        ON CONFLICT (connection_id) DO UPDATE SET status = EXCLUDED.status, producer_enabled = EXCLUDED.producer_enabled, reader_enabled = EXCLUDED.reader_enabled`;
    for (const k of reg.keys) {
      await tx`INSERT INTO rtgip.signing_keys (key_id, owner, dialect, connection_ids, status, not_before, not_after, secret_ref)
        VALUES (${k.key_id}, ${k.owner}, ${k.dialect}, ${tx.array([...k.connection_ids])}, ${k.status}, to_timestamp(${k.not_before}), to_timestamp(${k.not_after}), ${"rtgip:" + k.key_id})`;
      await tx`INSERT INTO vault.decrypted_secrets (name, decrypted_secret) VALUES (${"rtgip:" + k.key_id}, ${k.secret})`;
    }
    await tx`UPDATE rtgip.delivery_config SET local_app = ${app}`;
  });
}

type BodyRead = { ok: true; body: string } | { ok: false; status: number; reason: string };
const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
/** Bounded read, then fatal UTF-8 decoding; a byte-order mark is refused, never stripped. */
async function readBody(req: http.IncomingMessage): Promise<BodyRead> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY_BYTES) return { ok: false, status: 413, reason: "body_too_large" };
    chunks.push(c as Buffer);
  }
  const buf = Buffer.concat(chunks);
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return { ok: false, status: 400, reason: "bom_not_allowed" };
  try {
    return { ok: true, body: UTF8.decode(buf) };
  } catch {
    return { ok: false, status: 400, reason: "invalid_utf8" };
  }
}
const headersOf = (req: http.IncomingMessage) =>
  Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(",") : v]));
function reply(res: http.ServerResponse, status: number, doc: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(doc));
}

export interface Server {
  url: string;
  close(): Promise<void>;
}
async function listen(handler: http.RequestListener): Promise<Server> {
  const srv = http.createServer(handler);
  await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", ok));
  const { port } = srv.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise((ok) => srv.close(() => ok())) };
}

/** The app's real consumer applied to a projection row, inside the admission transaction. */
export function projectionEffect<P>(app: App, consumer: ConsumerEffect<P>, empty: () => P, faults: Faults): AdmissionEffect {
  return async (tx, e) => {
    const t = (tx as unknown as { sql: Sql }).sql;
    if (faults.crashInEffect > 0) {
      faults.crashInEffect--;
      throw new Error("injected_crash_in_effect");
    }
    const rows = await t`SELECT doc FROM rtgip_stage.projection WHERE app = ${app} FOR UPDATE`;
    const draft = structuredClone((rows[0]?.doc as P | undefined) ?? empty());
    const r = consumer(draft, e);
    if ("reason" in r) return r;
    await t`INSERT INTO rtgip_stage.projection (app, doc) VALUES (${app}, ${t.json(draft as never)})
      ON CONFLICT (app) DO UPDATE SET doc = EXCLUDED.doc, updated_at = now()`;
    await t`INSERT INTO rtgip_stage.effects (event_id, event_type) VALUES (${e.event_id}, ${e.event_type})`;
    return { ok: true };
  };
}

export interface Faults {
  crashInEffect: number;
  dropReceipts: number;
}
export const noFaults = (): Faults => ({ crashInEffect: 0, dropReceipts: 0 });

/** Target app inbound endpoint: POST /rtgip/v2/inbound. */
export function startTarget(app: App, sql: Sql, reg: () => Registry, effect: AdmissionEffect, faults: Faults): Promise<Server> {
  return listen(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/rtgip/v2/inbound") return reply(res, 404, { reason: "not_found" });
    const read = await readBody(req);
    if (!read.ok) return reply(res, read.status, { reason: read.reason });
    const body = read.body;
    const r = await admitDelivery(headersOf(req), body, {
      app,
      registry: reg(),
      nowSec: nowSec(),
      db: admissionDb(sql),
      effect,
      receiptKey: keyFor(reg(), app),
    });
    if (r.http_status === 200 && faults.dropReceipts > 0) {
      faults.dropReceipts--;
      return reply(res, 200, {});
    }
    reply(res, r.http_status, { reason: r.reason ?? null, receipts: r.receipts ?? [] });
  });
}

function pgNonces(sql: Sql): NonceStore {
  return {
    async claim(keyId, nonce, bodySha, expiresAt) {
      const ins = await sql`INSERT INTO gw_standin.source_nonces (key_id, nonce, body_sha256, expires_at)
        VALUES (${keyId}, ${nonce}, ${bodySha}, to_timestamp(${expiresAt})) ON CONFLICT DO NOTHING RETURNING 1`;
      if (ins.length) return "claimed";
      const prior = await sql`SELECT body_sha256 FROM gw_standin.source_nonces WHERE key_id = ${keyId} AND nonce = ${nonce}`;
      return prior[0]?.body_sha256 === bodySha ? "exact_retry" : "conflict";
    },
  };
}

export interface GatewayStandin extends Server {
  /** Test control: one forwarding pass over every admission whose chain is not terminal. */
  forwardPending(): Promise<number>;
}

interface AdmissionRow {
  delivery_id: string;
  body: string;
  envelope: EnvelopeV2;
  connection_id: string;
  admission_text: string;
  gateway_nonce: string;
  forward_attempts: number;
}

/**
 * Gateway STAND-IN (rtgip/2-forward/1 and rtgip/2-receipt-query/1) over a throwaway cluster:
 * POST /rtgip/v2/deliver admits synchronously and forwards once; POST /rtgip/v2/receipts is the
 * read-only chain query. Not the hosted Gateway; its results are not acceptance evidence.
 */
export async function startGatewayStandin(sql: Sql, reg: () => Registry, targets: () => Record<App, string>): Promise<GatewayStandin> {
  const audit = (decision: string, reason: string | null, status: number, e?: Partial<EnvelopeV2>, keyId?: string) =>
    sql`INSERT INTO gw_standin.audit (decision, reason, event_id, route, key_id, http_status)
      VALUES (${decision}, ${reason}, ${e?.event_id ?? null}, ${e?.route ?? null}, ${keyId ?? null}, ${status})`;
  const forward = async (row: AdmissionRow): Promise<void> => {
    const gwKey = keyFor(reg(), "gateway");
    const now = nowSec();
    const envelope = row.envelope;
    const admission = JSON.parse(row.admission_text) as ReceiptV2;
    const fwd = await signEnvelope(row.body, envelope, gwKey, now, row.gateway_nonce);
    let status = 502;
    let doc: { reason?: string | null; receipts?: ReceiptV2[] } = {};
    try {
      const r = await fetch(`${targets()[envelope.target_app as App]}/rtgip/v2/inbound`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(fwd as unknown as Record<string, string>), [ADMISSION_HEADER]: encodeAdmissionHeader(admission) },
        body: row.body,
      });
      status = r.status;
      doc = (await r.json()) as typeof doc;
    } catch {
      doc = { reason: "target_unreachable" };
    }
    await sql`UPDATE gw_standin.admissions SET forward_attempts = forward_attempts + 1 WHERE delivery_id = ${row.delivery_id}`;
    let reason = doc.reason ?? null;
    if (status === 200 && doc.receipts?.length) {
      // Only a fully verified chain is stored; the query never serves an unverified receipt.
      const chain: ReceiptV2[] = [admission];
      try {
        const kinds = ["target_inbox", "consumer_commit"] as const;
        for (let i = 0; i < doc.receipts.length; i++) {
          await verifyReceiptV2(
            doc.receipts[i],
            { envelope, connection_id: row.connection_id, delivery_id: row.delivery_id, kind: kinds[i]! },
            reg(),
            now,
            chain.slice(),
          );
          chain.push(doc.receipts[i]!);
        }
        const texts = chain.slice(1).map((r) => canonicalize(r));
        await sql`UPDATE gw_standin.admissions SET target_receipts = ${sql.array(texts, 25)} WHERE delivery_id = ${row.delivery_id}`;
      } catch (err) {
        status = 502;
        reason = (err as Error).message;
      }
    }
    await audit(status === 200 && doc.receipts?.length ? "forwarded" : "target_error", reason, status, envelope, gwKey.key_id);
  };
  const pendingRows = () =>
    sql`SELECT delivery_id, body, envelope, connection_id, admission_text, gateway_nonce, forward_attempts FROM gw_standin.admissions
      WHERE target_receipts IS NULL OR (cardinality(target_receipts) = 1 AND target_receipts[1] NOT LIKE '%"outcome":"quarantined"%')
      ORDER BY admitted_at` as unknown as Promise<AdmissionRow[]>;
  const queryNonces = pgNonces(sql);

  const server = await listen(async (req, res) => {
    if (req.method === "POST" && req.url === "/rtgip/v2/receipts") {
      const read = await readBody(req);
      if (!read.ok) return reply(res, read.status, { reason: read.reason });
      let peek = "";
      try {
        peek = String((JSON.parse(read.body) as { delivery_id?: unknown }).delivery_id ?? "");
      } catch {
        peek = "";
      }
      const found = peek ? (await sql`SELECT envelope, connection_id, admission_text, target_receipts FROM gw_standin.admissions WHERE delivery_id = ${peek}`)[0] : undefined;
      const v = await verifyReceiptQuery(headersOf(req) as Record<string, string>, read.body, {
        registry: reg(),
        nonces: queryNonces,
        nowSec: nowSec(),
        lookup: (id) =>
          found && id === peek
            ? {
                connection_id: found.connection_id as string,
                source_app: (found.envelope as EnvelopeV2).source_app,
                tenant_id: (found.envelope as EnvelopeV2).tenant_id,
                event_id: (found.envelope as EnvelopeV2).event_id,
              }
            : null,
      });
      if (!v.ok) {
        await audit("rejected", `query:${v.reason}`, 403);
        return reply(res, 403, { reason: v.reason });
      }
      const chain = [JSON.parse(found!.admission_text as string), ...((found!.target_receipts as string[] | null) ?? []).map((t) => JSON.parse(t) as unknown)];
      return reply(res, 200, { reason: null, receipts: chain });
    }
    if (req.method !== "POST" || req.url !== "/rtgip/v2/deliver") return reply(res, 404, { reason: "not_found" });
    const read = await readBody(req);
    const h = headersOf(req) as Record<string, string>;
    if (!read.ok) {
      await audit("rejected", read.reason, read.status, undefined, h["rtgip-key-id"]);
      return reply(res, read.status, { reason: read.reason });
    }
    const body = read.body;
    // Legacy and reserved AutoFilm routes are refused before any verification or storage.
    if (/(^|;)autofilm(;|$)/.test(h["rtgip-scope"] ?? "")) {
      await audit("rejected", "autofilm_route_denied", 403, undefined, h["rtgip-key-id"]);
      return reply(res, 403, { reason: "autofilm_route_denied" });
    }
    const now = nowSec();
    const v = await verifyDelivery(h, body, { registry: reg(), nonces: pgNonces(sql), nowSec: now, expectedSigner: "source" });
    if ("reason" in v) {
      await audit("rejected", v.reason, 401, undefined, h["rtgip-key-id"]);
      return reply(res, 401, { reason: v.reason });
    }
    const e = v.delivery.envelope;
    const connection_id = v.delivery.connection_id;
    const delivery_id = await deliveryIdentity(e, connection_id);
    const gwKey = keyFor(reg(), "gateway");
    const gwNonce = `gw_${(await sha256Hex(`${e.event_id}|${e.target_app}`)).slice(0, 32)}`;
    const prior = await sql`SELECT body_sha256 FROM gw_standin.admissions WHERE event_id = ${e.event_id} AND target_app = ${e.target_app}`;
    if (!prior.length) {
      const admission = await signReceiptV2(
        await receiptDraft({ envelope: e, connection_id, delivery_id, kind: "gateway_admission" }, "admitted", now, null),
        gwKey,
      );
      await sql`INSERT INTO gw_standin.admissions (event_id, target_app, source_app, connection_id, body_sha256, gateway_nonce, delivery_id, tenant_id, body, envelope, admission_text)
        VALUES (${e.event_id}, ${e.target_app}, ${e.source_app}, ${connection_id}, ${v.delivery.body_sha256}, ${gwNonce}, ${delivery_id}, ${e.tenant_id}, ${body}, ${sql.json(e as never)}, ${canonicalize(admission)})
        ON CONFLICT DO NOTHING`;
    }
    const adm = (await sql`SELECT body_sha256, admission_text, forward_attempts FROM gw_standin.admissions WHERE event_id = ${e.event_id} AND target_app = ${e.target_app}`)[0]!;
    if (adm.body_sha256 !== v.delivery.body_sha256) {
      await audit("rejected", "admission_conflict", 409, e, h["rtgip-key-id"]);
      return reply(res, 409, { reason: "admission_conflict" });
    }
    await audit("admitted", null, 200, e, h["rtgip-key-id"]);
    if (Number(adm.forward_attempts) === 0) {
      const row = (await sql`SELECT delivery_id, body, envelope, connection_id, admission_text, gateway_nonce, forward_attempts FROM gw_standin.admissions WHERE delivery_id = ${delivery_id}`)[0] as unknown as AdmissionRow;
      await forward(row);
    }
    reply(res, 200, { reason: null, receipts: [JSON.parse(adm.admission_text as string)] });
  });
  return {
    ...server,
    async forwardPending() {
      const rows = await pendingRows();
      for (const row of rows) await forward(row);
      return rows.length;
    },
  };
}

/** Source-side transactional capture: the business write and the outbox row commit together. */
export async function enqueue(
  sql: Sql,
  produced: readonly { envelope: EnvelopeV2; body: string }[],
  opts: { failAfterEnqueue?: boolean } = {},
): Promise<string[]> {
  return sql.begin(async (tx) => {
    await tx.unsafe("SET LOCAL ROLE rtgip_outbox_writer");
    const out: string[] = [];
    for (const p of produced) {
      await tx`INSERT INTO rtgip_stage.source_writes (event_id, note) VALUES (${p.envelope.event_id}, ${p.envelope.event_type})`;
      out.push((await tx`SELECT rtgip.outbox_enqueue(${p.body}) AS r`)[0]!.r as string);
    }
    if (opts.failAfterEnqueue) throw new Error("injected_source_failure");
    return out;
  }) as Promise<string[]>;
}

export interface DispatchResult {
  event_id: string;
  action: "deliver" | "confirm";
  http_status: number;
  reason: string | null;
  advanced: string[];
  state: string;
}

/**
 * One dispatcher pass as rtgip_dispatcher. A deliver lease POSTs to the Gateway and advances on
 * the admission receipt; a confirm lease queries the Gateway for the chain and advances on it.
 * Every receipt is verified in SQL by outbox_advance under the lease generation claim returned.
 */
export async function dispatch(sql: Sql, app: App, reg: Registry, gatewayUrl: string, worker = "w1", sign?: (r: { body: string; envelope: EnvelopeV2 }) => Promise<Record<string, string>>): Promise<DispatchResult[]> {
  const asDispatcher = <T>(fn: (tx: Sql) => Promise<T>) =>
    sql.begin(async (tx) => {
      await tx.unsafe("SET LOCAL ROLE rtgip_dispatcher");
      return fn(tx as unknown as Sql);
    }) as Promise<T>;
  const advance = async (id: string, gen: number, texts: string[]) =>
    (await asDispatcher((tx) => tx.unsafe("SELECT rtgip.outbox_advance($1, $2, $3, $4::text[]) AS r", [id, worker, gen, tx.array(texts) as never])))[0]!.r as string;
  const rows = await asDispatcher((tx) => tx`SELECT event_id, body, envelope, delivery_id, lease_generation, lease_action FROM rtgip.outbox_claim(${worker}, 100, 60)`);
  const out: DispatchResult[] = [];
  for (const row of rows) {
    const envelope = row.envelope as EnvelopeV2;
    const body = row.body as string;
    const gen = Number(row.lease_generation);
    const action = row.lease_action as "deliver" | "confirm";
    let status = 0;
    let doc: { reason?: string | null; receipts?: ReceiptV2[] } = {};
    try {
      let r: Response;
      if (action === "deliver") {
        const headers = sign
          ? await sign({ body, envelope })
          : ((await signEnvelope(body, envelope, keyFor(reg, app), nowSec(), `src_${randomBytes(12).toString("hex")}`)) as unknown as Record<string, string>);
        r = await fetch(`${gatewayUrl}/rtgip/v2/deliver`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body });
      } else {
        const q = await signReceiptQuery({ delivery_id: row.delivery_id as string, event_id: row.event_id as string }, keyFor(reg, app), nowSec(), `qry_${randomBytes(12).toString("hex")}`);
        r = await fetch(`${gatewayUrl}/rtgip/v2/receipts`, { method: "POST", headers: { "content-type": "application/json", ...q.headers }, body: q.body });
      }
      status = r.status;
      doc = (await r.json()) as typeof doc;
    } catch {
      doc = { reason: "gateway_unreachable" };
    }
    const advanced: string[] = [];
    if (status === 200 && doc.receipts?.length) advanced.push(await advance(row.event_id as string, gen, doc.receipts.map((x) => canonicalize(x))));
    const last = advanced.at(-1);
    if (last !== "gateway_admitted" && last !== "consumer_committed" && last !== "target_quarantined") {
      const why = last ? last.replace(/^(rejected|pending):/, "") : (doc.reason ?? `http_${status}`);
      await asDispatcher((tx) => tx`SELECT rtgip.outbox_fail(${row.event_id}, ${worker}, ${gen}, ${why}, 1, 10)`);
    }
    const state = (await sql`SELECT state FROM rtgip.outbox WHERE event_id = ${row.event_id}`)[0]!.state as string;
    out.push({ event_id: row.event_id as string, action, http_status: status, reason: doc.reason ?? null, advanced, state });
  }
  return out;
}

/** Test control only: make waiting rows due now (stands in for waiting out the backoff). */
export const makeDue = (sql: Sql) => sql`UPDATE rtgip.outbox SET next_attempt_at = now() WHERE state IN ('retry_wait', 'gateway_admitted')`;
