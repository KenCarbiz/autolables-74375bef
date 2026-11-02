// Server-only inbound admission: the boundary between a Gateway delivery and the target's
// PostgreSQL inbox. Shared byte-for-byte across apps. Parked: nothing imports it at runtime,
// and with transport off nothing can call it.
//
// Two independent verifications must agree before any consumer effect runs:
//   1. verifyDelivery() here, with the registry the server loaded for this request;
//   2. rtgip.inbox_admit() in the database, which recomputes the HMAC with the Vault secret,
//      claims the nonce, and re-checks canonical bytes, scope, payload hash, derived event id,
//      route catalog, source authority, destination, purpose and the connection grant.
// The database is authoritative for replay (its nonce claim) and for the inbox decision; the
// in-process check uses a per-request nonce store so it can never mask a database refusal.
// The receiving role can execute inbox_admit only, so no caller can reach the inbox engine
// without passing the database verification, whatever it claims to have checked itself.

import {
  MemoryNonceStore,
  verifyDelivery,
  type AppId,
  type EnvelopeV2,
  type Registry,
  type ServiceKey,
  type SignedHeaders,
} from "./protocol.ts";
import { signReceipt, type InboxOutcome, type Receipt } from "./delivery.ts";

/** One row returned by rtgip.inbox_admit. */
export interface AdmitRow {
  admission_id: number | string | null;
  event_id: string | null;
  outcome: InboxOutcome | "rejected";
  reason: string | null;
  committed: boolean;
  committed_outcome: "applied" | "stale_ignored" | null;
  connection_id: string | null;
  envelope: EnvelopeV2 | null;
}

/** The target's database transaction, as the server's SQL client exposes it. */
export interface AdmissionTx {
  /** SELECT * FROM rtgip.inbox_admit($1::text::jsonb, $2::text, $3::text::jsonb) */
  admit(
    headers: Record<string, string>,
    body: string,
    consumerReject: { event_id: string; reason: string } | null,
  ): Promise<AdmitRow[]>;
  savepoint(name: string): Promise<void>;
  rollbackTo(name: string): Promise<void>;
}

export interface AdmissionDb {
  /** Runs fn in one transaction; commits when it resolves, rolls back when it throws. */
  transaction<T>(fn: (tx: AdmissionTx) => Promise<T>): Promise<T>;
}

/** The consumer effect, in the same transaction as the inbox decision. */
export type AdmissionEffect = (
  tx: AdmissionTx,
  e: EnvelopeV2,
) => Promise<{ ok: true } | { ok: false; reason: string }>;

export interface AdmissionDeps {
  app: AppId;
  registry: Registry;
  nowSec: number;
  db: AdmissionDb;
  effect: AdmissionEffect;
  receiptKey: ServiceKey;
}

export interface AdmissionResult {
  http_status: number;
  reason?: string;
  receipts?: Receipt[];
  admission_id?: number | string | null;
  outcomes?: { event_id: string; outcome: string; reason: string | null }[];
}

export class AdmissionDisagreement extends Error {
  constructor(public code: string) {
    super(code);
  }
}

const HEADER_NAMES: readonly (keyof SignedHeaders)[] = [
  "rtgip-protocol",
  "rtgip-key-id",
  "rtgip-signer",
  "rtgip-timestamp",
  "rtgip-nonce",
  "rtgip-scope",
  "rtgip-signature",
];

/** Only the rtgip-* headers travel to the database; nothing else from the request does. */
export function admissionHeaders(raw: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  const lower = new Map(Object.entries(raw).map(([k, v]) => [k.toLowerCase(), v]));
  for (const h of HEADER_NAMES) {
    const v = lower.get(h);
    if (typeof v === "string") out[h] = v;
  }
  return out;
}

export async function admitDelivery(
  rawHeaders: Record<string, string | undefined>,
  body: string,
  deps: AdmissionDeps,
): Promise<AdmissionResult> {
  const headers = admissionHeaders(rawHeaders);
  const v = await verifyDelivery(headers, body, {
    registry: deps.registry,
    nonces: new MemoryNonceStore(),
    nowSec: deps.nowSec,
    expectedSigner: "gateway",
    receiver: deps.app,
  });
  if ("reason" in v) return { http_status: 401, reason: v.reason };
  const verified = v.delivery;

  // Anything that aborts the transaction (a crash in the effect, a lost connection, a
  // serialization failure) rolls back the inbox rows, the watermark and the database nonce
  // claim together, so the Gateway's retry of the same delivery is admitted afresh. No receipt
  // is issued for it: 503 tells the Gateway to retry; 500 means the two verifiers disagreed.
  let decided: { rejected: string | null; rows: AdmitRow[] };
  try {
    decided = await deps.db.transaction(async (tx) => {
      await tx.savepoint("rtgip_admit");
      let rows = await tx.admit(headers, body, null);
      const first = rows[0];
      if (!first) throw new AdmissionDisagreement("admit_returned_nothing");
      if (first.outcome === "rejected")
        return { rejected: first.reason ?? "rejected", rows } as const;
      if (
        first.event_id !== verified.envelope.event_id ||
        first.connection_id !== verified.connection_id
      )
        throw new AdmissionDisagreement("verifier_disagreement");
      for (const row of rows) {
        if (row.outcome !== "applied") continue;
        if (!row.envelope || !row.event_id)
          throw new AdmissionDisagreement("applied_without_envelope");
        const res = await deps.effect(tx, row.envelope);
        if (!("reason" in res)) continue;
        // Undo the first pass (inbox rows, watermark, admission, effects) and verify the same
        // delivery again with this event marked quarantined.
        await tx.rollbackTo("rtgip_admit");
        rows = await tx.admit(headers, body, { event_id: row.event_id, reason: res.reason });
        const again = rows[0];
        if (!again || again.outcome === "rejected")
          throw new AdmissionDisagreement("reject_pass_refused");
        for (const r2 of rows) {
          if (r2.outcome !== "applied" || !r2.envelope) continue;
          const res2 = await deps.effect(tx, r2.envelope);
          if ("reason" in res2) throw new AdmissionDisagreement("effect_failed_after_reject_pass");
        }
        break;
      }
      return { rejected: null, rows } as const;
    });
  } catch (err) {
    if (err instanceof AdmissionDisagreement) return { http_status: 500, reason: err.code };
    return { http_status: 503, reason: "admission_aborted" };
  }

  if (decided.rejected) return { http_status: 403, reason: `db:${decided.rejected}` };
  const received = decided.rows[0]!;
  const e = verified.envelope;
  const base = {
    protocol: "rtgip/2" as const,
    event_id: e.event_id,
    route: e.route,
    source_app: e.source_app,
    target_app: e.target_app,
    tenant_id: e.tenant_id,
    rooftop_id: e.rooftop_id,
    connection_id: verified.connection_id,
    payload_sha256: e.payload_sha256,
    issuer: deps.app,
    issued_at: deps.nowSec,
  };
  // Signed only after the transaction committed: a receipt never describes rolled-back work,
  // and a consumer_commit is issued only for a committed effect (never held or quarantined).
  const receipts: Receipt[] = [
    await signReceipt(
      { ...base, kind: "target_inbox", outcome: received.outcome as InboxOutcome },
      deps.receiptKey,
    ),
  ];
  if (received.committed && received.committed_outcome)
    receipts.push(
      await signReceipt(
        { ...base, kind: "consumer_commit", outcome: received.committed_outcome },
        deps.receiptKey,
      ),
    );
  return {
    http_status: 200,
    receipts,
    admission_id: received.admission_id,
    outcomes: decided.rows.map((r) => ({
      event_id: r.event_id ?? "",
      outcome: r.outcome,
      reason: r.reason,
    })),
  };
}
