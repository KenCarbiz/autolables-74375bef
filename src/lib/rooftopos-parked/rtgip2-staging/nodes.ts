// Local four-node staging plumbing. Test-only.
//   - AutoLabels, AutoCurb, AutoFrame: REAL app nodes (each built from empty by its own bootstrap)
//     behind admitDelivery() against rtgip.inbox_admit. The destination effect is the app's own
//     staging adapter apply() (rtgip_fx.*_apply under the consumer role) inside the inbox
//     transaction, after the SQL consumer_effect hook the app installs. No pass-through effect.
//   - The Gateway is a STAND-IN (StandInGateway) behind a narrow port: admit, forward, query. The
//     vendored acceptance candidate will implement the same GatewayPort. Nothing the stand-in
//     produces is acceptance evidence.
// Connections and mappings come only from the registry export views on the Gateway node; every
// signing key is generated here at start-up and lives in memory and in the throwaway clusters.
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
import { deliveryIdentity, receiptDraft, signReceiptV2, verifyReceiptV2, type ReceiptV2 } from "../rtgip2/receipt-v2.ts";
import { signReceiptQuery, verifyReceiptQuery } from "../rtgip2/receipt-query.ts";
import { ADMISSION_HEADER, admitDelivery, encodeAdmissionHeader, type AdmissionEffect } from "../rtgip2/admission.ts";
import { admissionDb } from "../rtgip2-pg/pg.ts";
import type { StagingAdapter } from "../rtgip2-autolabels/staging-adapter.ts";
import { refusalReason } from "../rtgip2/delivery.ts";

export type Sql = ReturnType<typeof postgres>;
export type App = "autolabels" | "autocurb" | "autoframe";
export const APPS: readonly App[] = ["autolabels", "autocurb", "autoframe"];
export const STANDIN_RESULT_LABEL = "stand-in Gateway, not acceptance";
export const nowSec = () => Math.floor(Date.now() / 1000);
export const connect = (url: string): Sql => postgres(url, { max: 20, onnotice: () => {}, idle_timeout: 5 });
export const connIdOf = (s: AppId, t: AppId, tenant: string, rooftop: string) => `conn:${s}>${t}:${tenant}:${rooftop}`;

export const PAIRS: readonly [App, App][] = [
  ["autolabels", "autocurb"],
  ["autolabels", "autoframe"],
  ["autocurb", "autolabels"],
  ["autocurb", "autoframe"],
  ["autoframe", "autolabels"],
  ["autoframe", "autocurb"],
];

// ---- registry: proposals, exports, and the sync into every node ----------------------------

export interface RooftopExport {
  registry_id: string;
  tenant_id: string;
  rooftop_id: string;
  al_store_id: string;
  ac_dealership_id: string;
  ac_store_location_id: string | null;
  af_tenant_id: string;
  af_rooftop_id: string;
}
export interface ConnectionExport {
  id: string;
  source_app: App;
  target_app: App;
  tenant_id: string;
  rooftop_id: string;
  events: EventType[];
  purposes: Purpose[];
  source_enabled: boolean;
  target_enabled: boolean;
  registry_id: string;
}
export interface MappingExport {
  connection_id: string;
  instance_id: string;
  episode_id: string;
  source_store_id: string;
  vin: string;
  reviewed_ref: string;
}
export interface RegistryExports {
  rooftops: RooftopExport[];
  connections: ConnectionExport[];
  mappings: MappingExport[];
}

/** Read the three app exports and the Gateway export views, active rows only. */
export async function readExports(gw: Sql): Promise<RegistryExports> {
  const rooftops = await gw`SELECT a.registry_id::text AS registry_id, a.tenant_id::text AS tenant_id, a.rooftop_id, a.store_id::text AS al_store_id,
      c.dealership_id AS ac_dealership_id, c.store_location_id::text AS ac_store_location_id,
      f.af_tenant_id::text AS af_tenant_id, f.af_rooftop_id::text AS af_rooftop_id
    FROM rooftop_registry.export_al_rooftop_stores a
    JOIN rooftop_registry.export_ac_rooftop_scope c USING (registry_id)
    JOIN rooftop_registry.export_af_rooftop_scope f USING (registry_id)
    ORDER BY a.rooftop_id`;
  const connections = await gw`SELECT id, source_app, target_app, tenant_id, rooftop_id, events, purposes, source_enabled, target_enabled, registry_id::text AS registry_id
    FROM rooftop_registry.export_gw_connections ORDER BY id`;
  const mappings = await gw`SELECT connection_id, instance_id, episode_id, source_store_id, vin, reviewed_ref FROM rooftop_registry.export_gw_mappings ORDER BY connection_id, episode_id`;
  return {
    rooftops: [...rooftops] as unknown as RooftopExport[],
    connections: [...connections] as unknown as ConnectionExport[],
    mappings: [...mappings] as unknown as MappingExport[],
  };
}

/**
 * Propose and activate the six route grants for a tenant with two different synthetic actors.
 * The registry refuses self-review; that refusal is exercised here, not assumed.
 */
export async function grantSixRoutes(gw: Sql, tenant: string, operator: string, reviewer: string): Promise<string[]> {
  const ids: string[] = [];
  for (const [s, t] of PAIRS) {
    const route = ROUTES.find((r) => r.source === s && r.target === t)!;
    const events = Object.keys(route.events);
    const purposes = [...new Set(Object.values(route.events).flat())];
    const g = (await gw`SELECT rooftop_registry.propose_grant(${operator}::uuid, ${`synthetic staging grant ${s} to ${t}`}, ${tenant}, ${s}, ${t}, ${gw.array(events, 1009)}, ${gw.array(purposes, 1009)}) AS id`)[0]!.id as string;
    const selfReview = (await gw`SELECT rooftop_registry.activate_grant(${g}::uuid, ${operator}::uuid, 'creator reviewing own grant', 'evidence:x') AS r`)[0]!.r;
    if (selfReview !== "reviewer_is_creator") throw new Error(`registry accepted a self review: ${selfReview}`);
    const ok = (await gw`SELECT rooftop_registry.activate_grant(${g}::uuid, ${reviewer}::uuid, 'synthetic staging reviewer sign-off', 'evidence:synthetic-route-approval') AS r`)[0]!.r;
    if (ok !== "activated") throw new Error(`grant activation failed: ${ok}`);
    ids.push(g);
  }
  return ids;
}

/** Staging transport activation: the registry exports flags off; the harness turns them on in its own node copies. */
export function registryFrom(exp: RegistryExports, keys: readonly ServiceKey[] = []): Registry {
  const connections: ServiceConnection[] = exp.connections.map((c) => ({
    connection_id: c.id,
    source_app: c.source_app,
    target_app: c.target_app,
    tenant_id: c.tenant_id,
    rooftop_ids: [c.rooftop_id],
    event_types: [...c.events],
    purposes: [...c.purposes],
    producer_enabled: true,
    reader_enabled: true,
    status: "active",
  }));
  const ids = connections.map((c) => c.connection_id);
  const n = nowSec();
  const mk = (owner: ServiceKey["owner"]): ServiceKey => {
    const prior = keys.find((k) => k.owner === owner && k.status === "current");
    const mine = connections.filter((c) => owner === "gateway" || c.source_app === owner || c.target_app === owner).map((c) => c.connection_id);
    return {
      key_id: prior?.key_id ?? `stg-${owner}-${randomBytes(6).toString("hex")}`,
      owner,
      dialect: "rtgip/2",
      connection_ids: mine,
      status: "current",
      not_before: prior?.not_before ?? n - 3600,
      not_after: prior?.not_after ?? n + 86_400,
      secret: prior?.secret ?? randomBytes(32).toString("base64url"),
    };
  };
  void ids;
  return { connections, keys: [mk("gateway"), mk("autolabels"), mk("autocurb"), mk("autoframe")] };
}

export const keyFor = (reg: Registry, owner: ServiceKey["owner"]): ServiceKey => {
  const k = reg.keys.find((x) => x.owner === owner && x.status === "current");
  if (!k) throw new Error(`no_current_key:${owner}`);
  return k;
};

/** Mirror the registry connections and keys into one app node's delivery tables and Vault stand-in. */
export async function seedNode(sql: Sql, reg: Registry, app: App): Promise<void> {
  await sql.begin(async (tx) => {
    await tx.unsafe("DELETE FROM rtgip.signing_keys");
    await tx.unsafe("DELETE FROM vault.decrypted_secrets WHERE name LIKE 'rtgip:%'");
    const ids = reg.connections.map((c) => c.connection_id);
    for (const c of reg.connections)
      await tx`INSERT INTO rtgip.connections (connection_id, source_app, target_app, tenant_id, rooftop_ids, event_types, purposes, producer_enabled, reader_enabled, status)
        VALUES (${c.connection_id}, ${c.source_app}, ${c.target_app}, ${c.tenant_id}, ${tx.array([...c.rooftop_ids])}, ${tx.array([...c.event_types])},
                ${tx.array([...c.purposes])}, ${c.producer_enabled}, ${c.reader_enabled}, ${c.status})
        ON CONFLICT (connection_id) DO UPDATE SET status = EXCLUDED.status, producer_enabled = EXCLUDED.producer_enabled, reader_enabled = EXCLUDED.reader_enabled,
          event_types = EXCLUDED.event_types, purposes = EXCLUDED.purposes, rooftop_ids = EXCLUDED.rooftop_ids`;
    await tx`UPDATE rtgip.connections SET status = 'revoked' WHERE connection_id <> ALL (${tx.array(ids)}) AND status <> 'revoked'`;
    for (const k of reg.keys) {
      await tx`INSERT INTO rtgip.signing_keys (key_id, owner, dialect, connection_ids, status, not_before, not_after, secret_ref)
        VALUES (${k.key_id}, ${k.owner}, ${k.dialect}, ${tx.array([...k.connection_ids])}, ${k.status}, to_timestamp(${k.not_before}), to_timestamp(${k.not_after}), ${"rtgip:" + k.key_id})`;
      await tx`INSERT INTO vault.decrypted_secrets (name, decrypted_secret) VALUES (${"rtgip:" + k.key_id}, ${k.secret})`;
    }
    await tx`UPDATE rtgip.delivery_config SET local_app = ${app}`;
  });
}

/** Load the registry's rooftop exports into each app's own mapping table (the app-side half of "re-sync the exports"). */
export async function syncAppMapping(sql: Sql, app: App, exp: RegistryExports, mapper: string): Promise<void> {
  const rows = exp.rooftops;
  if (app === "autolabels") {
    await sql.begin(async (tx) => {
      for (const r of rows) {
        await tx`INSERT INTO public.dealer_stores (id, tenant_id) VALUES (${r.al_store_id}, ${r.tenant_id}) ON CONFLICT DO NOTHING`;
        const have = await tx`SELECT 1 FROM rtgip_src.rooftop_stores WHERE tenant_id = ${r.tenant_id} AND rooftop_id = ${r.rooftop_id} AND store_id = ${r.al_store_id} AND status = 'active'`;
        if (!have.length)
          await tx`INSERT INTO rtgip_src.rooftop_stores (tenant_id, rooftop_id, store_id, mapped_by, reason) VALUES (${r.tenant_id}, ${r.rooftop_id}, ${r.al_store_id}, ${mapper}, 'registry export')`;
      }
      const keep = rows.map((r) => `${r.tenant_id}|${r.rooftop_id}`);
      await tx`UPDATE rtgip_src.rooftop_stores SET status = 'revoked', revoked_at = now() WHERE status = 'active' AND (tenant_id::text || '|' || rooftop_id) <> ALL (${tx.array(keep)})`;
    });
  } else if (app === "autocurb") {
    await sql.begin(async (tx) => {
      for (const r of rows) {
        const have = await tx`SELECT 1 FROM rtgip_src.rooftop_scope WHERE tenant_id = ${r.tenant_id} AND rooftop_id = ${r.rooftop_id} AND dealership_id = ${r.ac_dealership_id}`;
        if (!have.length)
          await tx`INSERT INTO rtgip_src.rooftop_scope (dealership_id, store_location_id, tenant_id, rooftop_id) VALUES (${r.ac_dealership_id}, ${r.ac_store_location_id}, ${r.tenant_id}, ${r.rooftop_id})`;
      }
      const keep = rows.map((r) => `${r.tenant_id}|${r.rooftop_id}`);
      await tx`DELETE FROM rtgip_src.rooftop_scope WHERE (tenant_id || '|' || rooftop_id) <> ALL (${tx.array(keep)})`;
    });
  } else {
    const payload = rows.map((r) => ({ registry_id: r.registry_id, af_tenant_id: r.af_tenant_id, af_rooftop_id: r.af_rooftop_id, tenant_id: r.tenant_id, rooftop_id: r.rooftop_id }));
    await sql.begin(async (tx) => {
      await tx.unsafe("SET LOCAL ROLE rtgip_registry_sync");
      await tx.unsafe("SELECT public.rtgip_sync_rooftop_scope($1::text::jsonb)", [JSON.stringify(payload)]);
    });
  }
}

// ---- HTTP plumbing ---------------------------------------------------------------------------

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
const headersOf = (req: http.IncomingMessage): Record<string, string> =>
  Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(",") : (v as string)]));
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

// ---- target nodes: the real adapter effect inside the inbox transaction -----------------------

export interface Faults {
  /** Throw after the adapter effect has run, before the inbox transaction commits. */
  crashAfterEffect: number;
  /** Commit, then answer 200 with no receipts (the acknowledgement is lost). */
  dropReceipts: number;
}
export const noFaults = (): Faults => ({ crashAfterEffect: 0, dropReceipts: 0 });

/**
 * The destination effect for admitDelivery: the app adapter's apply() in the caller's open
 * transaction. A refusal carries its reason and the delivery is quarantined; the crash fault
 * fires after the effect, so the rollback has real rows to undo.
 */
export function adapterEffect(adapter: Pick<StagingAdapter, "apply">, faults: Faults): AdmissionEffect {
  return async (tx, e) => {
    const t = (tx as unknown as { sql: Sql }).sql;
    const r = await adapter.apply(t, e);
    if (!r.ok) return { ok: false, reason: r.reason };
    if (faults.crashAfterEffect > 0) {
      faults.crashAfterEffect--;
      throw new Error("injected_crash_after_effect");
    }
    return { ok: true };
  };
}

/** Target app inbound endpoint: POST /rtgip/v2/inbound. */
export function startTarget(app: App, sql: Sql, reg: () => Registry, effect: AdmissionEffect, faults: Faults): Promise<Server> {
  return listen(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/rtgip/v2/inbound") return reply(res, 404, { reason: "not_found" });
    const read = await readBody(req);
    if (!read.ok) return reply(res, read.status, { reason: read.reason });
    const r = await admitDelivery(headersOf(req), read.body, {
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

// ---- the Gateway port and its STAND-IN ---------------------------------------------------------

export interface GwRequest {
  headers: Record<string, string>;
  body: string;
}
export interface GwReply {
  status: number;
  doc: { reason: string | null; receipts?: ReceiptV2[] };
}
/**
 * The narrow Gateway interface the acceptance suite depends on. StandInGateway implements it
 * here; the vendored candidate (handler.server.ts, dispatcher.server.ts, store.server.ts plus
 * its rtgip2.sql on the Gateway database) implements the same three operations later.
 */
export interface GatewayPort {
  /** rtgip/2 source delivery in, admission receipt out. */
  admit(req: GwRequest): Promise<GwReply>;
  /** One forwarding pass over every admission whose chain is not terminal; returns how many were tried. */
  forward(): Promise<number>;
  /** rtgip/2-receipt-query/1: the verified chain for a delivery, to the source that sent it. */
  query(req: GwRequest): Promise<GwReply>;
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

interface AdmissionRow {
  delivery_id: string;
  body: string;
  envelope: EnvelopeV2;
  connection_id: string;
  admission_text: string;
  gateway_nonce: string;
  forward_attempts: number;
}

export interface StandInContext {
  reg: () => Registry;
  mappings: () => readonly MappingExport[];
  targets: () => Record<App, string>;
}

/**
 * Gateway STAND-IN over a throwaway cluster: verify the source, authorize against the registry
 * connections, check the registry's episode mapping, durably admit and sign the admission,
 * forward with the admission receipt, store only a fully verified target chain, and serve the
 * read-only receipt query. It is not the hosted Gateway and proves nothing about it.
 */
export class StandInGateway implements GatewayPort {
  private readonly nonces: NonceStore;
  constructor(
    private readonly sql: Sql,
    private readonly ctx: StandInContext,
  ) {
    this.nonces = pgNonces(sql);
  }

  private audit(decision: string, reason: string | null, status: number, e?: Partial<EnvelopeV2>, keyId?: string) {
    return this.sql`INSERT INTO gw_standin.audit (decision, reason, event_id, route, key_id, http_status)
      VALUES (${decision}, ${reason}, ${e?.event_id ?? null}, ${e?.route ?? null}, ${keyId ?? null}, ${status})`;
  }

  private async forwardOne(row: AdmissionRow): Promise<void> {
    const reg = this.ctx.reg();
    const gwKey = keyFor(reg, "gateway");
    const now = nowSec();
    const envelope = row.envelope;
    const admission = JSON.parse(row.admission_text) as ReceiptV2;
    const fwd = await signEnvelope(row.body, envelope, gwKey, now, row.gateway_nonce);
    let status = 502;
    let doc: { reason?: string | null; receipts?: ReceiptV2[] } = {};
    try {
      const r = await fetch(`${this.ctx.targets()[envelope.target_app as App]}/rtgip/v2/inbound`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(fwd as unknown as Record<string, string>), [ADMISSION_HEADER]: encodeAdmissionHeader(admission) },
        body: row.body,
      });
      status = r.status;
      doc = (await r.json()) as typeof doc;
    } catch {
      doc = { reason: "target_unreachable" };
    }
    await this.sql`UPDATE gw_standin.admissions SET forward_attempts = forward_attempts + 1 WHERE delivery_id = ${row.delivery_id}`;
    let reason = doc.reason ?? null;
    if (status === 200 && doc.receipts?.length) {
      // Only a fully verified chain is stored; the query never serves an unverified receipt.
      const chain: ReceiptV2[] = [admission];
      try {
        const kinds = ["target_inbox", "consumer_commit"] as const;
        for (let i = 0; i < doc.receipts.length; i++) {
          await verifyReceiptV2(doc.receipts[i]!, { envelope, connection_id: row.connection_id, delivery_id: row.delivery_id, kind: kinds[i]! }, reg, now, chain.slice());
          chain.push(doc.receipts[i]!);
        }
        const texts = chain.slice(1).map((r) => canonicalize(r));
        await this.sql`UPDATE gw_standin.admissions SET target_receipts = ${this.sql.array(texts, 25)} WHERE delivery_id = ${row.delivery_id}`;
      } catch (err) {
        status = 502;
        reason = (err as Error).message;
      }
    }
    await this.audit(status === 200 && doc.receipts?.length ? "forwarded" : "target_error", reason, status, envelope, gwKey.key_id);
  }

  async forward(): Promise<number> {
    const rows = (await this.sql`SELECT delivery_id, body, envelope, connection_id, admission_text, gateway_nonce, forward_attempts FROM gw_standin.admissions
      WHERE target_receipts IS NULL OR (cardinality(target_receipts) = 1 AND target_receipts[1] NOT LIKE '%"outcome":"quarantined"%')
      ORDER BY admitted_at`) as unknown as AdmissionRow[];
    for (const row of rows) await this.forwardOne(row);
    return rows.length;
  }

  async admit({ headers: h, body }: GwRequest): Promise<GwReply> {
    // Legacy and reserved AutoFilm routes are refused before any verification or storage.
    if (/(^|;)autofilm(;|$)/.test(h["rtgip-scope"] ?? "")) {
      await this.audit("rejected", "autofilm_route_denied", 403, undefined, h["rtgip-key-id"]);
      return { status: 403, doc: { reason: "autofilm_route_denied" } };
    }
    const reg = this.ctx.reg();
    const now = nowSec();
    const v = await verifyDelivery(h, body, { registry: reg, nonces: this.nonces, nowSec: now, expectedSigner: "source" });
    if ("reason" in v) {
      await this.audit("rejected", v.reason, 401, undefined, h["rtgip-key-id"]);
      return { status: 401, doc: { reason: v.reason } };
    }
    const e = v.delivery.envelope;
    const connection_id = v.delivery.connection_id;
    // Registry episode mapping: an instance bound to a rooftop may only travel on that rooftop's connection.
    const bound = this.ctx.mappings().filter((m) => m.instance_id === e.vehicle.instance_id);
    if (bound.length && !bound.some((m) => m.connection_id === connection_id && m.episode_id === e.vehicle.episode_id)) {
      await this.audit("rejected", "mapping_scope_mismatch", 403, e, h["rtgip-key-id"]);
      return { status: 403, doc: { reason: "mapping_scope_mismatch" } };
    }
    const delivery_id = await deliveryIdentity(e, connection_id);
    const gwKey = keyFor(reg, "gateway");
    const gwNonce = `gw_${(await sha256Hex(`${e.event_id}|${e.target_app}`)).slice(0, 32)}`;
    const prior = await this.sql`SELECT body_sha256 FROM gw_standin.admissions WHERE event_id = ${e.event_id} AND target_app = ${e.target_app}`;
    if (!prior.length) {
      const admission = await signReceiptV2(await receiptDraft({ envelope: e, connection_id, delivery_id, kind: "gateway_admission" }, "admitted", now, null), gwKey);
      await this.sql`INSERT INTO gw_standin.admissions (event_id, target_app, source_app, connection_id, body_sha256, gateway_nonce, delivery_id, tenant_id, body, envelope, admission_text)
        VALUES (${e.event_id}, ${e.target_app}, ${e.source_app}, ${connection_id}, ${v.delivery.body_sha256}, ${gwNonce}, ${delivery_id}, ${e.tenant_id}, ${body}, ${this.sql.json(e as never)}, ${canonicalize(admission)})
        ON CONFLICT DO NOTHING`;
    }
    const adm = (await this.sql`SELECT body_sha256, admission_text, forward_attempts FROM gw_standin.admissions WHERE event_id = ${e.event_id} AND target_app = ${e.target_app}`)[0]!;
    if (adm.body_sha256 !== v.delivery.body_sha256) {
      await this.audit("rejected", "admission_conflict", 409, e, h["rtgip-key-id"]);
      return { status: 409, doc: { reason: "admission_conflict" } };
    }
    await this.audit("admitted", null, 200, e, h["rtgip-key-id"]);
    if (Number(adm.forward_attempts) === 0) {
      const row = (await this.sql`SELECT delivery_id, body, envelope, connection_id, admission_text, gateway_nonce, forward_attempts FROM gw_standin.admissions WHERE delivery_id = ${delivery_id}`)[0] as unknown as AdmissionRow;
      await this.forwardOne(row);
    }
    return { status: 200, doc: { reason: null, receipts: [JSON.parse(adm.admission_text as string) as ReceiptV2] } };
  }

  async query({ headers, body }: GwRequest): Promise<GwReply> {
    let peek = "";
    try {
      peek = String((JSON.parse(body) as { delivery_id?: unknown }).delivery_id ?? "");
    } catch {
      peek = "";
    }
    const found = peek ? (await this.sql`SELECT envelope, connection_id, admission_text, target_receipts FROM gw_standin.admissions WHERE delivery_id = ${peek}`)[0] : undefined;
    const v = await verifyReceiptQuery(headers, body, {
      registry: this.ctx.reg(),
      nonces: this.nonces,
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
      await this.audit("rejected", `query:${v.reason}`, 403);
      return { status: 403, doc: { reason: v.reason } };
    }
    const chain = [JSON.parse(found!.admission_text as string), ...((found!.target_receipts as string[] | null) ?? []).map((t) => JSON.parse(t) as unknown)] as ReceiptV2[];
    return { status: 200, doc: { reason: null, receipts: chain } };
  }
}

export interface StandInServer extends Server {
  port: GatewayPort;
}
/** HTTP shell over any GatewayPort: POST /rtgip/v2/deliver and POST /rtgip/v2/receipts. */
export async function startGatewayHttp(port: GatewayPort, onIngressReject?: (reason: string, status: number) => Promise<void>): Promise<StandInServer> {
  const server = await listen(async (req, res) => {
    const path = req.url;
    if (req.method !== "POST" || (path !== "/rtgip/v2/deliver" && path !== "/rtgip/v2/receipts")) return reply(res, 404, { reason: "not_found" });
    const read = await readBody(req);
    if (!read.ok) {
      await onIngressReject?.(read.reason, read.status);
      return reply(res, read.status, { reason: read.reason });
    }
    const r = await (path === "/rtgip/v2/deliver" ? port.admit : port.query).call(port, { headers: headersOf(req), body: read.body });
    reply(res, r.status, r.doc);
  });
  return { ...server, port };
}

// ---- source side: capture and dispatch ---------------------------------------------------------

/** Source-side transactional capture: the business marker write and the outbox row commit together. */
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
      const why = last
        ? last.replace(/^(rejected|pending):/, "")
        : status >= 400 && status < 500
          ? refusalReason(status, doc.reason)
          : (doc.reason ?? `http_${status}`);
      await asDispatcher((tx) => tx`SELECT rtgip.outbox_fail(${row.event_id}, ${worker}, ${gen}, ${why}, 1, 10)`);
    }
    const state = (await sql`SELECT state FROM rtgip.outbox WHERE event_id = ${row.event_id}`)[0]!.state as string;
    out.push({ event_id: row.event_id as string, action, http_status: status, reason: doc.reason ?? null, advanced, state });
  }
  return out;
}

/** Test control only: make waiting rows due now (stands in for waiting out the backoff). */
export const makeDue = (sql: Sql) => sql`UPDATE rtgip.outbox SET next_attempt_at = now() WHERE state IN ('retry_wait', 'gateway_admitted')`;
