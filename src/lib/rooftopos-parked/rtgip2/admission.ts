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
  canonicalize,
  MemoryNonceStore,
  verifyDelivery,
  type AppId,
  type EnvelopeV2,
  type Registry,
  type ServiceKey,
  type SignedHeaders,
} from "./protocol.ts";
import type { InboxOutcome } from "./delivery.ts";
import {
  deliveryIdentity,
  isReceipt,
  receiptDraft,
  signReceiptV2,
  verifyReceiptV2,
  type ReceiptV2,
} from "./receipt-v2.ts";

export const ADMISSION_HEADER = "rtgip-admission-receipt";

export const encodeAdmissionHeader = (r: ReceiptV2): string => {
  const bytes = new TextEncoder().encode(canonicalize(r));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/** The admission receipt's canonical JSON text, or null when the header is not exactly that. */
export function decodeAdmissionHeader(
  value: string | undefined,
): { text: string; receipt: ReceiptV2 } | null {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const bin = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
    const text = new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(bin, (c) => c.charCodeAt(0)),
    );
    const parsed: unknown = JSON.parse(text);
    if (!isReceipt(parsed) || canonicalize(parsed) !== text) return null;
    return { text, receipt: parsed };
  } catch {
    return null;
  }
}

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
  /** First row only: the delivery this call answers, its stored issue time and stored receipts. */
  delivery_id: string | null;
  issued_at: number | string | null;
  stored_receipts: string[] | null;
  /** True when the decision was already final: answered from the stored record, engine not run. */
  replayed: boolean | null;
}

/** The target's database transaction, as the server's SQL client exposes it. */
export interface AdmissionTx {
  /** SELECT * FROM rtgip.inbox_admit($1::text::jsonb, $2::text, $3::text, $4::text::jsonb) */
  admit(
    headers: Record<string, string>,
    body: string,
    admission: string,
    consumerReject: { event_id: string; reason: string } | null,
  ): Promise<AdmitRow[]>;
  /** SELECT rtgip.inbox_record_receipts($1, $2::text[]) */
  recordReceipts(deliveryId: string, receipts: string[]): Promise<void>;
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
  /** Optional app-side effect run by the server in the same transaction, after the database's own hook. */
  effect?: AdmissionEffect;
  receiptKey: ServiceKey;
}

export interface AdmissionResult {
  http_status: number;
  reason?: string;
  receipts?: ReceiptV2[];
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
  const lowered = new Map(Object.entries(rawHeaders).map(([k, v]) => [k.toLowerCase(), v]));
  const adm = decodeAdmissionHeader(lowered.get(ADMISSION_HEADER));
  if (!adm) return { http_status: 400, reason: "admission_receipt_malformed" };
  const v = await verifyDelivery(headers, body, {
    registry: deps.registry,
    nonces: new MemoryNonceStore(),
    nowSec: deps.nowSec,
    expectedSigner: "gateway",
    receiver: deps.app,
  });
  if ("reason" in v) return { http_status: 401, reason: v.reason };
  const verified = v.delivery;
  const delivery = {
    envelope: verified.envelope,
    connection_id: verified.connection_id,
  };
  try {
    await verifyReceiptV2(
      adm.receipt,
      {
        envelope: delivery.envelope,
        connection_id: delivery.connection_id,
        delivery_id: await deliveryIdentity(delivery.envelope, delivery.connection_id),
        kind: "gateway_admission",
      },
      deps.registry,
      deps.nowSec,
      [],
    );
  } catch (err) {
    return { http_status: 403, reason: (err as Error).message };
  }

  // Anything that aborts the transaction (a crash in the effect, a lost connection, a
  // serialization failure) rolls back the inbox rows, the watermark and the database nonce
  // claim together, so the Gateway's retry of the same delivery is admitted afresh. No receipt
  // is issued for it: 503 tells the Gateway to retry; 500 means the two verifiers disagreed.
  let decided: { rejected: string | null; rows: AdmitRow[] };
  try {
    decided = await deps.db.transaction(async (tx) => {
      await tx.savepoint("rtgip_admit");
      let rows = await tx.admit(headers, body, adm.text, null);
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
        if (row.outcome !== "applied" || first.replayed) continue;
        if (!row.envelope || !row.event_id)
          throw new AdmissionDisagreement("applied_without_envelope");
        if (!deps.effect) continue;
        const res = await deps.effect(tx, row.envelope);
        if (!("reason" in res)) continue;
        // Undo the first pass (inbox rows, watermark, admission, effects) and verify the same
        // delivery again with this event marked quarantined.
        await tx.rollbackTo("rtgip_admit");
        rows = await tx.admit(headers, body, adm.text, {
          event_id: row.event_id,
          reason: res.reason,
        });
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
  const outcomes = decided.rows.map((r) => ({
    event_id: r.event_id ?? "",
    outcome: r.outcome,
    reason: r.reason,
  }));
  if (!received.delivery_id || received.issued_at === null)
    return { http_status: 500, reason: "delivery_record_missing" };
  const respond = (receipts: ReceiptV2[]): AdmissionResult => ({
    http_status: 200,
    receipts,
    admission_id: received.admission_id,
    outcomes,
  });
  // A decision already signed and stored for this delivery is returned byte for byte.
  if (received.stored_receipts) {
    const stored = received.stored_receipts.map((t) => JSON.parse(t) as ReceiptV2);
    return respond(stored);
  }
  // Signed only after the transaction committed: a receipt never describes rolled-back work,
  // and a consumer_commit is issued only for a committed effect (never held or quarantined).
  // The issue time is the stored one, so a retry after a crash re-signs identical bytes.
  const issuedAt = Number(received.issued_at);
  const exp = (kind: "target_inbox" | "consumer_commit") => ({
    envelope: delivery.envelope,
    connection_id: delivery.connection_id,
    delivery_id: received.delivery_id!,
    kind,
  });
  const inbox = await signReceiptV2(
    await receiptDraft(
      exp("target_inbox"),
      received.outcome as InboxOutcome,
      issuedAt,
      adm.receipt,
    ),
    deps.receiptKey,
  );
  const receipts = [inbox];
  if (received.committed && received.committed_outcome)
    receipts.push(
      await signReceiptV2(
        await receiptDraft(exp("consumer_commit"), received.committed_outcome, issuedAt, inbox),
        deps.receiptKey,
      ),
    );
  if (received.outcome !== "held") {
    try {
      await deps.db.transaction((tx) =>
        tx.recordReceipts(
          received.delivery_id!,
          receipts.map((r) => canonicalize(r)),
        ),
      );
    } catch {
      return { http_status: 503, reason: "receipts_not_stored" };
    }
  }
  return respond(receipts);
}
