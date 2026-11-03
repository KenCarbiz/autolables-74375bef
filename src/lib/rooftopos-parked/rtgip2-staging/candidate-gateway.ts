// GatewayPort over the VENDORED Gateway candidate (rtgip2-gateway/, da5118a + GW-F1..F3; see
// supabase/tests/rtgip/gateway/PROVENANCE.json). Test-only. The candidate code is used as vendored:
// admission is its handler.server.ts, forwarding is its dispatcherStep() and every database write
// goes through its own gw_r2_* RPCs, called as service_role. Nothing in the vendored tree is edited.
//
// What this file adds, because the candidate does not have it yet:
//   - provision(): the operator step that copies the registry exports into gw_r2_connections, keys
//     and mappings (and the synthetic gw_tenants / gw_rooftops rows they reference). Owner role.
//   - rtgip/2-forward/1 (GW-F4): the forward carries the admission receipt header.
//   - rtgip/2-receipt-query/1 (GW-F5): served from gw_r2_receipts and gw_r2_uncommitted_receipts
//     with the shared verifyReceiptQuery; its nonces are held in memory (no candidate store yet).
//   - Refusal statuses: the vendored handler answers every refusal 503; the port re-runs the
//     vendored pure verifyAdmission first so a permanent refusal is a 4xx with its reason (GW-F6).
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { canonicalize, sha256Hex, type EnvelopeV2, type NonceStore, type Registry } from "../rtgip2/protocol.ts";
import { verifyReceiptQuery } from "../rtgip2/receipt-query.ts";
import { ADMISSION_HEADER, encodeAdmissionHeader } from "../rtgip2/admission.ts";
import type { Registry as CandidateRegistry } from "../rtgip2-gateway/rtgip2/core";
import { createRtgip2Handler } from "../rtgip2-gateway/rtgip2/handler.server";
import { dispatcherStep, type DeliveryLease } from "../rtgip2-gateway/rtgip2/dispatcher.server";
import { candidateStore, type CandidateRpc } from "../rtgip2-gateway/rtgip2/store.server";
import { verifyAdmission, type IdentityMapping } from "../rtgip2-gateway/rtgip2/verify";
import type { ReceiptV2 } from "../rtgip2-gateway/rtgip2/receipt";
import { nowSec, type App, type GatewayPort, type GwReply, type GwRequest, type MappingExport, type Sql } from "./nodes.ts";

export const CANDIDATE_RESULT_LABEL = "vendored Gateway candidate da5118a+GW-F1..F3, disposable";
const VENDORED = path.resolve(__dirname, "../../../../supabase/tests/rtgip/gateway");

/** From-empty Gateway schema on a throwaway database: the candidate's own bootstrap order. */
export async function bootstrapCandidateGateway(sql: Sql, root = VENDORED): Promise<number> {
  if ((await sql`SELECT to_regclass('public.gw_r2_connections') AS t`)[0]!.t) return 0;
  await sql.unsafe(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  END $$`);
  // Same auth fixtures as the vendored scripts/bootstrap-gateway-disposable.py.
  await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS auth; CREATE SCHEMA IF NOT EXISTS extensions;
    CREATE TABLE IF NOT EXISTS auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,is_anonymous boolean DEFAULT false,aud text,role text);
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$ SELECT coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $f$;
    GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role;
    GRANT EXECUTE ON FUNCTION auth.uid() TO anon,authenticated,service_role;`);
  const migrations = readdirSync(path.join(root, "drizzle/migrations")).filter((f) => /^[0-9].*\.sql$/.test(f)).sort();
  for (const f of migrations) await sql.unsafe(readFileSync(path.join(root, "drizzle/migrations", f), "utf8"));
  for (const f of ["scripts/gateway-disposable-fixtures.sql", "docs/proposals/final-execution/rtgip2.sql", "docs/proposals/final-execution/reconciliation-v3.sql"])
    await sql.unsafe(readFileSync(path.join(root, f), "utf8"));
  return migrations.length;
}

/** Every candidate RPC runs as service_role, the only role the candidate grants them to. */
export function serviceRpc(sql: Sql): CandidateRpc {
  return {
    async call(name, args) {
      if (!/^gw_r2_[a-z_]+$/.test(name)) throw new Error("RPC allowlist");
      const vals = Object.values(args);
      const params = vals.map((v) => (v && typeof v === "object" ? JSON.stringify(v) : v)) as (string | number | null)[];
      const casts = vals.map((v, i) => `$${i + 1}${v && typeof v === "object" ? "::text::jsonb" : ""}`).join(",");
      return sql.begin(async (tx) => {
        await tx.unsafe("SET LOCAL ROLE service_role");
        return (await tx.unsafe(`SELECT public.${name}(${casts}) AS result`, params))[0]?.["result"];
      });
    },
  };
}
const asService = <T>(sql: Sql, fn: (tx: Sql) => Promise<T>) =>
  sql.begin(async (tx) => {
    await tx.unsafe("SET LOCAL ROLE service_role");
    return fn(tx as unknown as Sql);
  }) as Promise<T>;

function memoryNonces(): NonceStore {
  const seen = new Map<string, string>();
  return {
    async claim(keyId, nonce, bodySha) {
      const k = `${keyId}|${nonce}`;
      const prior = seen.get(k);
      if (prior === undefined) {
        seen.set(k, bodySha);
        return "claimed";
      }
      return prior === bodySha ? "exact_retry" : "conflict";
    },
  };
}

const FORBIDDEN = /unauthori[sz]ed|not_granted|route|revoked|mapping|scope|tenant|purpose|event|producer|reader|connection/;

export interface CandidateContext {
  reg: () => Registry;
  mappings: () => readonly MappingExport[];
  targets: () => Record<App, string>;
}

export class CandidateGateway implements GatewayPort {
  private readonly rpc: CandidateRpc;
  private readonly store: ReturnType<typeof candidateStore>;
  private readonly queryNonces = memoryNonces();
  constructor(
    private readonly sql: Sql,
    private readonly ctx: CandidateContext,
  ) {
    this.rpc = serviceRpc(sql);
    this.store = candidateStore(this.rpc, async () => this.gatewayKey().key_id);
  }

  private gatewayKey() {
    const k = this.ctx.reg().keys.find((x) => x.owner === "gateway" && x.status === "current");
    if (!k) throw new Error("no_current_key:gateway");
    return k;
  }

  /** The candidate's view of the registry mappings: each export row bound to its connection's scope. */
  private identityMappings(): IdentityMapping[] {
    const conns = new Map(this.ctx.reg().connections.map((c) => [c.connection_id, c]));
    return this.ctx.mappings().flatMap((m) => {
      const c = conns.get(m.connection_id);
      return c
        ? [{ ...m, tenant_id: c.tenant_id, rooftop_id: c.rooftop_ids[0]!, source_app: c.source_app, status: "active" as const }]
        : [];
    });
  }

  /** Operator provisioning: mirror the registry exports into the candidate's tables. Revokes what left the export. */
  async provision(): Promise<void> {
    const reg = this.ctx.reg();
    const maps = this.ctx.mappings();
    await this.sql.begin(async (tx) => {
      for (const c of reg.connections) {
        await tx`INSERT INTO gw_tenants(id,name,is_synthetic) VALUES(${c.tenant_id},${`staging ${c.tenant_id}`},true) ON CONFLICT DO NOTHING`;
        for (const r of c.rooftop_ids)
          await tx`INSERT INTO gw_rooftops(id,tenant_id,name,city,state) VALUES(${r},${c.tenant_id},${`staging ${r}`},'Synthetic','SY') ON CONFLICT DO NOTHING`;
        await tx`INSERT INTO gw_r2_connections(id,source_app,target_app,tenant_id,rooftop_id,events,purposes,status,source_enabled,target_enabled)
          VALUES(${c.connection_id},${c.source_app},${c.target_app},${c.tenant_id},${c.rooftop_ids[0]!},${tx.array([...c.event_types])},${tx.array([...c.purposes])},${c.status},${c.producer_enabled},${c.reader_enabled})
          ON CONFLICT(id) DO UPDATE SET events=EXCLUDED.events,purposes=EXCLUDED.purposes,status=EXCLUDED.status,source_enabled=EXCLUDED.source_enabled,target_enabled=EXCLUDED.target_enabled`;
      }
      const ids = reg.connections.map((c) => c.connection_id);
      await tx`UPDATE gw_r2_connections SET status='revoked' WHERE NOT (id = ANY(${tx.array(ids)}))`;
      for (const k of reg.keys)
        await tx`INSERT INTO gw_r2_keys(id,owner,connections,status,not_before,not_after,fingerprint)
          VALUES(${k.key_id},${k.owner},${tx.array([...k.connection_ids])},${k.status},to_timestamp(${k.not_before}),to_timestamp(${k.not_after}),${await sha256Hex(k.secret)})
          ON CONFLICT(id) DO UPDATE SET connections=EXCLUDED.connections,status=EXCLUDED.status,not_before=EXCLUDED.not_before,not_after=EXCLUDED.not_after`;
      await tx`UPDATE gw_r2_keys SET status='revoked' WHERE NOT (id = ANY(${tx.array(reg.keys.map((k) => k.key_id))}))`;
      await tx`UPDATE gw_r2_mappings SET status='revoked'`;
      for (const m of maps)
        await tx`INSERT INTO gw_r2_mappings(connection_id,instance_id,episode_id,source_store_id,vin,reviewed_ref,status)
          VALUES(${m.connection_id},${m.instance_id},${m.episode_id},${m.source_store_id},${m.vin},${m.reviewed_ref},'active')
          ON CONFLICT(connection_id,instance_id,episode_id) DO UPDATE SET source_store_id=EXCLUDED.source_store_id,vin=EXCLUDED.vin,reviewed_ref=EXCLUDED.reviewed_ref,status='active'`;
    });
  }

  async admit({ headers, body }: GwRequest): Promise<GwReply> {
    if (/(^|;)autofilm(;|$)/.test(headers["rtgip-scope"] ?? "")) return { status: 403, doc: { reason: "autofilm_route_denied" } };
    const reg = this.ctx.reg() as unknown as CandidateRegistry;
    const mappings = this.identityMappings();
    const bytes = new TextEncoder().encode(body);
    let verified: Awaited<ReturnType<typeof verifyAdmission>>;
    try {
      verified = await verifyAdmission(headers, bytes, reg, mappings, nowSec());
    } catch (err) {
      const reason = (err as Error).message;
      return { status: FORBIDDEN.test(reason) ? 403 : 401, doc: { reason } };
    }
    const handler = createRtgip2Handler(
      {
        registry: async () => ({ registry: reg, mappings }),
        now: nowSec,
        admit: this.store.admit,
        persistSignedEvidence: this.store.persistSignedEvidence,
        resolveSigningKey: async (id) => reg.keys.find((k) => k.key_id === id) ?? null,
      },
      true,
    );
    const res = await handler(new Request("http://candidate.local/rtgip/v2/deliver", { method: "POST", headers: { ...headers, "content-type": "application/json" }, body }));
    const doc = (await res.json()) as { outcome?: string; receipt?: ReceiptV2; error?: string };
    if (res.status !== 200 || !doc.receipt) {
      const e = verified.envelope;
      const prior = await asService(this.sql, (tx) => tx`SELECT envelope_sha256 FROM gw_r2_admissions WHERE event_id=${e.event_id}::uuid AND connection_id=${verified.connection_id}`);
      if (prior.length && prior[0]!.envelope_sha256 !== verified.body_sha256) return { status: 409, doc: { reason: "admission_conflict" } };
      return { status: res.status, doc: { reason: doc.error ?? "admission_not_confirmed" } };
    }
    if (doc.outcome === "admitted") await this.forward();
    return { status: 200, doc: { reason: null, receipts: [doc.receipt] } };
  }

  /** One dispatcherStep pass of the vendored dispatcher over every due lease. */
  async forward(): Promise<number> {
    const reg = this.ctx.reg() as unknown as CandidateRegistry;
    let tried = 0;
    const claim = async (worker: string): Promise<DeliveryLease[]> => {
      const rows = await asService(this.sql, (tx) => tx`SELECT d.delivery_id, d.generation, d.token, a.connection_id, a.canonical_body, a.envelope, r.receipt
        FROM gw_r2_claim(${worker}, 8, 30) d JOIN gw_r2_admissions a USING(delivery_id)
        JOIN gw_r2_receipts r ON r.delivery_id=d.delivery_id AND r.stage='gateway_admission'`);
      tried += rows.length;
      return rows.map((r) => ({
        delivery_id: r.delivery_id as string,
        connection_id: r.connection_id as string,
        generation: Number(r.generation),
        token: String(r.token),
        canonical_body: r.canonical_body as string,
        envelope: r.envelope as EnvelopeV2 as never,
        admission_receipt: r.receipt as ReceiptV2,
      }));
    };
    await dispatcherStep(
      "candidate-dispatcher",
      {
        registry: async () => reg,
        now: nowSec,
        claim,
        gatewayKey: async () => this.gatewayKey() as never,
        nonce: () => `gwf_${randomBytes(12).toString("hex")}`,
        send: async (lease, request) => {
          const target = this.ctx.targets()[lease.envelope.target_app as App];
          const r = await fetch(`${target}/rtgip/v2/inbound`, {
            method: "POST",
            headers: { "content-type": "application/json", ...(request.headers as unknown as Record<string, string>), [ADMISSION_HEADER]: encodeAdmissionHeader(lease.admission_receipt as never) },
            body: request.body,
          });
          const doc = (await r.json()) as { receipts?: unknown[] };
          if (r.status !== 200) throw new Error(`target_http_${r.status}`);
          return doc.receipts ?? [];
        },
        complete: this.store.complete,
        fail: this.store.fail,
        recordUncommitted: this.store.recordUncommitted,
      },
      true,
    );
    return tried;
  }

  /** rtgip/2-receipt-query/1 over the candidate's stored evidence. */
  async query({ headers, body }: GwRequest): Promise<GwReply> {
    let peek = "";
    try {
      peek = String((JSON.parse(body) as { delivery_id?: unknown }).delivery_id ?? "");
    } catch {
      peek = "";
    }
    const found = peek ? (await asService(this.sql, (tx) => tx`SELECT a.envelope, a.connection_id, d.state FROM gw_r2_admissions a JOIN gw_r2_dispatch d USING(delivery_id) WHERE a.delivery_id=${peek}`))[0] : undefined;
    const v = await verifyReceiptQuery(headers, body, {
      registry: this.ctx.reg(),
      nonces: this.queryNonces,
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
    if (!v.ok) return { status: 403, doc: { reason: v.reason } };
    const chain = (await asService(this.sql, (tx) => tx`SELECT receipt FROM gw_r2_receipts WHERE delivery_id=${peek}
      ORDER BY CASE stage WHEN 'gateway_admission' THEN 0 WHEN 'target_inbox' THEN 1 ELSE 2 END`)).map((r) => r.receipt as ReceiptV2);
    if (chain.length === 1) {
      // No committed chain yet: report the latest held or quarantined evidence, as the stand-in does.
      const last = (await asService(this.sql, (tx) => tx`SELECT receipt FROM gw_r2_uncommitted_receipts WHERE delivery_id=${peek} ORDER BY recorded_at DESC, generation DESC LIMIT 1`))[0];
      if (last) chain.push(last.receipt as ReceiptV2);
    }
    return { status: 200, doc: { reason: null, receipts: JSON.parse(canonicalize(chain)) as ReceiptV2[] } };
  }

  /** Test control only: make held deliveries due now (stands in for waiting out the 30 s hold backoff). */
  async makeDue(): Promise<void> {
    await this.sql`UPDATE gw_r2_dispatch SET lease_until=clock_timestamp()-interval '1 second', next_attempt_at=clock_timestamp()-interval '1 second'
      WHERE state IN ('pending','target_persisted') OR (state='leased' AND lease_until<=clock_timestamp())`;
  }
}
