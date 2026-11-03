// Real-Postgres plumbing for the rtgip/2 integration tests. Test-only. Connects only to the
// throwaway cluster started by supabase/tests/rtgip/pg_integration.sh (RTGIP_PG_URL); every
// test file skips when that variable is unset, so the normal suite never touches a database.
import postgres from "postgres";
import type { AdmissionDb, AdmissionTx, AdmitRow } from "../rtgip2/admission.ts";
import type { Registry } from "../rtgip2/protocol.ts";
import { syntheticRegistry } from "../rtgip2/fixtures.ts";

export const PG_URL = process.env.RTGIP_PG_URL ?? "";
export type Sql = ReturnType<typeof postgres>;
export const connect = (): Sql => postgres(PG_URL, { max: 30, onnotice: () => {}, idle_timeout: 5 });

export const nowSec = () => Math.floor(Date.now() / 1000);

/** The synthetic registry with key windows around the real clock, mirrored into the database. */
export async function seedRegistry(sql: Sql, localApp: string): Promise<Registry> {
  const base = syntheticRegistry();
  const n = nowSec();
  const reg: Registry = { ...base, keys: base.keys.map((k) => ({ ...k, not_before: n - 86_400, not_after: n + 31_536_000 })) };
  await sql.begin(async (tx) => {
    await tx.unsafe("TRUNCATE rtgip.receipts, rtgip.admissions, rtgip.inbox, rtgip.inbox_deliveries, rtgip.inbox_conflicts, rtgip.watermarks, rtgip.nonce_claims CASCADE");
    await tx.unsafe("DELETE FROM rtgip.signing_keys");
    await tx.unsafe("DELETE FROM rtgip.connections WHERE connection_id NOT IN (SELECT connection_id FROM rtgip.outbox)");
    await tx.unsafe("DELETE FROM vault.decrypted_secrets WHERE name LIKE 'rtgip:%'");
    for (const c of reg.connections)
      await tx`INSERT INTO rtgip.connections (connection_id, source_app, target_app, tenant_id, rooftop_ids, event_types, purposes, producer_enabled, reader_enabled, status)
        VALUES (${c.connection_id}, ${c.source_app}, ${c.target_app}, ${c.tenant_id}, ${tx.array([...c.rooftop_ids])}, ${tx.array([...c.event_types])},
                ${tx.array([...c.purposes])}, ${c.producer_enabled}, ${c.reader_enabled}, ${c.status})
        ON CONFLICT (connection_id) DO UPDATE SET rooftop_ids = EXCLUDED.rooftop_ids, event_types = EXCLUDED.event_types, purposes = EXCLUDED.purposes,
          producer_enabled = EXCLUDED.producer_enabled, reader_enabled = EXCLUDED.reader_enabled, status = EXCLUDED.status`;
    for (const k of reg.keys.filter((x) => ["rtgip/2", "autolabels.rooftopos/1", "gateway.operator/1", "autoframe.raw-hash/1"].includes(x.dialect))) {
      await tx`INSERT INTO rtgip.signing_keys (key_id, owner, dialect, connection_ids, status, not_before, not_after, secret_ref)
        VALUES (${k.key_id}, ${k.owner}, ${k.dialect}, ${tx.array([...k.connection_ids])}, ${k.status}, to_timestamp(${k.not_before}), to_timestamp(${k.not_after}), ${"rtgip:" + k.key_id})`;
      await tx`INSERT INTO vault.decrypted_secrets (name, decrypted_secret) VALUES (${"rtgip:" + k.key_id}, ${k.secret})`;
    }
    await tx`UPDATE rtgip.delivery_config SET local_app = ${localApp}`;
  });
  return reg;
}

/** AdmissionDb over a real transaction, executing as the rtgip_inbox_receiver duty role. */
export function admissionDb(sql: Sql, role = "rtgip_inbox_receiver"): AdmissionDb {
  return {
    transaction: <T>(fn: (tx: AdmissionTx) => Promise<T>) =>
      sql.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL ROLE ${role}`);
        const wrapped: AdmissionTx & { sql: typeof tx } = {
          sql: tx,
          admit: async (headers, body, admission, rej) =>
            (await tx.unsafe("SELECT * FROM rtgip.inbox_admit($1::text::jsonb, $2::text, $3::text, $4::text::jsonb)", [
              JSON.stringify(headers),
              body,
              admission,
              rej ? JSON.stringify(rej) : null,
            ])) as unknown as AdmitRow[],
          recordReceipts: async (deliveryId, receipts) =>
            void (await tx.unsafe("SELECT rtgip.inbox_record_receipts($1, $2::text[])", [deliveryId, tx.array(receipts) as never])),
          savepoint: async (n) => void (await tx.unsafe(`SAVEPOINT ${n}`)),
          rollbackTo: async (n) => void (await tx.unsafe(`ROLLBACK TO SAVEPOINT ${n}`)),
        };
        return fn(wrapped);
      }) as Promise<T>,
  };
}
