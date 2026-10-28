// pg-backed implementations of the handler store interfaces, used by the Deno HTTP tests.
// They call the same SQL functions the Supabase-backed stores call over RPC, so the
// database behaviour under test is the real migration, not a model of it.

import postgres from "npm:postgres@3.4.9";
import type { ApplyStore, ClaimedRow } from "../../functions/_shared/integrations/handlers/apply.ts";
import type { DispatchConnection, DispatchStore, OutboxRow } from "../../functions/_shared/integrations/handlers/dispatch.ts";
import type { HealthStore } from "../../functions/_shared/integrations/handlers/health.ts";
import type { IngestStore } from "../../functions/_shared/integrations/handlers/ingest.ts";
import type { ConnectionRecord, ExistingReceipt, KeyRecord } from "../../functions/_shared/integrations/ingestDecision.ts";

export type Sql = postgres.Sql;
export type { Row } from "npm:postgres@3.4.9";

export function connect(url: string, role: string | null = "service_role"): Sql {
  return postgres(url, {
    max: 4,
    onnotice: () => {},
    types: { bigint: { to: 20, from: [20], parse: (x: string) => Number(x), serialize: (x: number) => String(x) } },
    ...(role ? { connection: { options: `-c role=${role}` } } : {}),
  });
}

const CONNECTION = "id,tenant_id,app,status,scopes,adapter,external_rooftop_ref";

export function pgIngestStore(sql: Sql): IngestStore {
  return {
    async loadKey(keyId) {
      const [k] = await sql`select key_id, status, connection_id from public.integration_connection_keys where key_id = ${keyId}`;
      if (!k) return null;
      const [c] = await sql`select ${sql.unsafe(CONNECTION)} from public.integration_connections where id = ${k.connection_id}`;
      if (!c) return null;
      return { key_id: k.key_id, status: k.status, connection: c as unknown as ConnectionRecord } as KeyRecord;
    },
    async keySecret(keyId) {
      const [r] = await sql`select public.integration_key_secret(${keyId}) as s`;
      return r?.s ?? null;
    },
    async loadConnection(id) {
      const [c] = await sql`select ${sql.unsafe(CONNECTION)} from public.integration_connections where id = ${id}`;
      return (c as unknown as ConnectionRecord) ?? null;
    },
    async connectionSecrets(id) {
      const rows = await sql`select key_id, secret from public.integration_connection_secrets(${id})`;
      return rows.map((r) => ({ key_id: r.key_id as string, secret: r.secret as string }));
    },
    async directionEnabled(tenantId, direction) {
      const [r] = await sql`select enabled from public.integration_direction_flags where tenant_id = ${tenantId} and direction = ${direction}`;
      return r?.enabled === true;
    },
    async lookupExisting(connectionId, eventId, idempotencyKey) {
      const [byEvent] = await sql`select id, status, payload_checksum, received_at from public.integration_inbox where connection_id = ${connectionId} and event_id = ${eventId}`;
      const [byKey] = await sql`select id, status, payload_checksum, received_at from public.integration_inbox where connection_id = ${connectionId} and idempotency_key = ${idempotencyKey}`;
      const norm = (r: Record<string, unknown> | undefined) =>
        r ? ({ ...r, received_at: String(r.received_at) } as unknown as ExistingReceipt) : null;
      return { existingByEventId: norm(byEvent), existingByIdempotencyKey: norm(byKey) };
    },
    async resolveVinForRo(_connectionId, tenantId, roIds) {
      const [r] = await sql`select i.vin from public.vehicle_external_refs r
        join public.vehicle_instances i on i.id = r.instance_id and i.tenant_id = r.tenant_id
        where r.tenant_id = ${tenantId} and r.app = 'autofilm' and r.external_id in ${sql(roIds)} limit 1`;
      return r?.vin ?? null;
    },
    async insertInbox(rows) {
      try {
        const out = await sql.begin(async (tx) => {
          const ids: string[] = [];
          for (const row of rows) {
            const { envelope, ...rest } = row;
            const [r] = await tx`insert into public.integration_inbox ${tx({ ...rest, envelope: tx.json(envelope as never) as never })} returning id`;
            ids.push(r.id as string);
          }
          return ids;
        });
        return { ids: out };
      } catch (e) {
        if ((e as { code?: string }).code === "23505") return "conflict";
        throw e;
      }
    },
    async touchConnection(id, outcome) {
      if (outcome.ok) await sql`update public.integration_connections set last_success_at = now() where id = ${id}`;
      else await sql`update public.integration_connections set last_error_at = now(), last_error_code = ${outcome.code} where id = ${id}`;
    },
  };
}

export function pgApplyStore(sql: Sql): ApplyStore {
  return {
    async claim(limit, leaseSeconds) {
      const rows = await sql`select * from public.integration_claim_inbox(${limit}, ${leaseSeconds})`;
      return rows as unknown as ClaimedRow[];
    },
    async apply(inboxId, plan) {
      const [r] = await sql`select public.integration_apply_event(${inboxId}, ${sql.json(plan as never)}) as r`;
      return r.r as { status: string; outcome?: string };
    },
    async fail(inboxId, errorCode, delaySeconds, dead) {
      await sql`select public.integration_fail_inbox(${inboxId}, ${errorCode}, ${delaySeconds}, ${dead})`;
    },
    async audit(row, status, outcome) {
      await sql`insert into public.audit_log (action, entity_type, entity_id, details) values (
        ${`integration_event_${status}`}, 'integration_inbox', ${row.id},
        ${sql.json({ tenant_id: row.tenant_id, event_id: row.event_id, outcome_code: outcome } as never)})`;
    },
  };
}

export function pgDispatchStore(sql: Sql): DispatchStore {
  return {
    async listDue(limit, nowIso) {
      const rows = await sql`select id, tenant_id, connection_id, event_id, attempts, envelope from public.integration_outbox
        where status in ('pending','delivering') and next_attempt_at <= ${nowIso} order by next_attempt_at limit ${limit}`;
      return rows as unknown as OutboxRow[];
    },
    async loadConnection(id) {
      const [c] = await sql`select id, app, status, endpoint_url, adapter, external_rooftop_ref from public.integration_connections where id = ${id}`;
      return (c as unknown as DispatchConnection) ?? null;
    },
    async directionEnabled(tenantId, direction) {
      const [r] = await sql`select enabled from public.integration_direction_flags where tenant_id = ${tenantId} and direction = ${direction}`;
      return r?.enabled === true;
    },
    async lease(rowId, nowIso, leaseUntilIso) {
      const rows = await sql`update public.integration_outbox set status = 'delivering', next_attempt_at = ${leaseUntilIso}
        where id = ${rowId} and status in ('pending','delivering') and next_attempt_at <= ${nowIso} returning id`;
      return rows.length > 0;
    },
    async activeKey(connectionId) {
      const [k] = await sql`select key_id from public.integration_connection_keys where connection_id = ${connectionId} and status = 'active' order by created_at desc limit 1`;
      if (!k) return null;
      const [s] = await sql`select public.integration_key_secret(${k.key_id}) as s`;
      return s?.s ? { key_id: k.key_id as string, secret: s.s as string } : null;
    },
    async markDelivered(rowId, attempts, atIso, connectionId) {
      await sql`update public.integration_outbox set status = 'delivered', attempts = ${attempts}, delivered_at = ${atIso}, last_error_code = null where id = ${rowId}`;
      await sql`update public.integration_connections set last_success_at = ${atIso} where id = ${connectionId}`;
    },
    async markFailure(rowId, u, connectionId) {
      await sql`update public.integration_outbox set status = ${u.dead ? "dead" : "pending"}, attempts = ${u.attempts},
        last_error_code = ${u.errorCode}, next_attempt_at = ${u.nextAttemptIso} where id = ${rowId}`;
      await sql`update public.integration_connections set last_error_at = now(), last_error_code = ${u.errorCode} where id = ${connectionId}`;
    },
  };
}

// Tokens are "user:<uuid>"; real JWT verification belongs to Supabase Auth and is not under test here.
export function pgHealthStore(sql: Sql): HealthStore {
  return {
    authenticate: (jwt) => Promise.resolve(jwt.startsWith("user:") ? { userId: jwt.slice(5) } : null),
    async isPlatformAdmin(userId) {
      const rows = await sql`select 1 from public.user_roles where user_id = ${userId} and role = 'admin'`;
      return rows.length > 0;
    },
    async snapshot(now) {
      const [c] = await sql`select count(*)::int as n from public.integration_connections`;
      return { generated_at: new Date(now).toISOString(), state: c.n === 0 ? "not_configured" : "configured" };
    },
  };
}
