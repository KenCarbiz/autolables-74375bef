// Synthetic in-process harness. TEST STAND-IN ONLY: ReferenceGatewayStandIn is not the hosted
// Gateway, speaks rtgip/2-forward/1 and rtgip/2-receipt-query/1 from the shared core, and its
// results are never acceptance evidence. It does not open sockets.

import {
  canonicalize,
  MemoryNonceStore,
  sha256Hex,
  signEnvelope,
  verifyDelivery,
  type AppId,
  type EnvelopeV2,
  type NonceStore,
  type Registry,
  type ServiceKey,
  type SignedHeaders,
} from "./protocol.ts";
import type { MemoryInbox, OutboxRow, ReceiptQueryPort, Transport } from "./delivery.ts";
import { ADMISSION_HEADER, decodeAdmissionHeader, encodeAdmissionHeader } from "./admission.ts";
import {
  deliveryIdentity,
  receiptDraft,
  signReceiptV2,
  verifyReceiptV2,
  type ReceiptV2,
} from "./receipt-v2.ts";
import { signReceiptQuery, verifyReceiptQuery, type QueryHeaders } from "./receipt-query.ts";

export const STANDIN_LABEL =
  "reference-gateway-test-standin (not the hosted Gateway; not acceptance evidence)";

export type ForwardHeaders = SignedHeaders & { [ADMISSION_HEADER]: string };

export interface TargetResponse {
  http_status: number;
  receipts?: ReceiptV2[];
  reason?: string;
}

export interface TargetEndpoint {
  app: AppId;
  handle(headers: ForwardHeaders, body: string, now: number): Promise<TargetResponse>;
}

/** rtgip/2-forward/1 target: verify the Gateway signature and admission receipt, receive, answer. */
export function makeTarget<P>(
  app: AppId,
  inbox: MemoryInbox<P>,
  registry: Registry,
  nonces: NonceStore = new MemoryNonceStore(),
  opts: {
    crashAfterEffect?: (() => boolean) | undefined;
    crashBeforeReceipts?: (() => boolean) | undefined;
    dropAck?: (() => boolean) | undefined;
  } = {},
): TargetEndpoint {
  return {
    app,
    async handle(headers, body, now) {
      const v = await verifyDelivery(headers as unknown as Record<string, string>, body, {
        registry,
        nonces,
        nowSec: now,
        expectedSigner: "gateway",
        receiver: app,
      });
      if ("reason" in v) return { http_status: 401, reason: v.reason };
      const adm = decodeAdmissionHeader(headers[ADMISSION_HEADER]);
      if (!adm) return { http_status: 400, reason: "admission_receipt_malformed" };
      let res;
      try {
        res = await inbox.receive(v.delivery, adm.receipt, now, {
          crashAfterEffect: opts.crashAfterEffect?.() ?? false,
          crashBeforeReceipts: opts.crashBeforeReceipts?.() ?? false,
        });
      } catch (err) {
        const m = (err as Error).message;
        return { http_status: m.startsWith("ack_") ? 403 : 503, reason: m };
      }
      if (opts.dropAck?.()) return { http_status: 200 };
      return { http_status: 200, receipts: res.receipts };
    },
  };
}

interface Admitted {
  envelope: EnvelopeV2;
  body: string;
  body_sha256: string;
  connection_id: string;
  delivery_id: string;
  admission: ReceiptV2;
  chain: ReceiptV2[];
  gateway_nonce: string;
}

export class ReferenceGatewayStandIn {
  readonly label = STANDIN_LABEL;
  admissions = new Map<string, Admitted>();
  rejections: { at: number; reason: string }[] = [];
  forwardRejections: { at: number; reason: string }[] = [];
  private nonces = new MemoryNonceStore();
  private queryNonces = new MemoryNonceStore();
  constructor(
    private registry: Registry,
    private key: ServiceKey,
    private targets: Map<AppId, TargetEndpoint>,
    private opts: { forward?: "inline" | "deferred" | undefined } = {},
  ) {}

  /**
   * Admit a source-signed delivery: synchronously return the signed admission receipt, then
   * forward to the single authorized target (inline here, or later via forwardPending when
   * deferred, as the real Gateway forwards asynchronously). Re-POSTing an admitted event
   * returns the stored admission byte for byte.
   */
  async admit(
    headers: SignedHeaders,
    body: string,
    now: number,
  ): Promise<{ http_status: number; admission?: ReceiptV2; reason?: string }> {
    const v = await verifyDelivery(headers as unknown as Record<string, string>, body, {
      registry: this.registry,
      nonces: this.nonces,
      nowSec: now,
      expectedSigner: "source",
    });
    if ("reason" in v) {
      this.rejections.push({ at: now, reason: v.reason });
      return { http_status: 401, reason: v.reason };
    }
    const e = v.delivery.envelope;
    const id = `${e.event_id}|${e.target_app}`;
    let adm = this.admissions.get(id);
    if (adm && adm.body_sha256 !== v.delivery.body_sha256)
      return { http_status: 409, reason: "admission_conflict" };
    if (!adm) {
      const connection_id = v.delivery.connection_id;
      const delivery_id = await deliveryIdentity(e, connection_id);
      const admission = await signReceiptV2(
        await receiptDraft(
          { envelope: e, connection_id, delivery_id, kind: "gateway_admission" },
          "admitted",
          now,
          null,
        ),
        this.key,
      );
      adm = {
        envelope: e,
        body,
        body_sha256: v.delivery.body_sha256,
        connection_id,
        delivery_id,
        admission,
        chain: [admission],
        // Fixed at admission so a forwarded retry is an exact retry.
        gateway_nonce: `gw_${(await sha256Hex(id)).slice(0, 32)}`,
      };
      this.admissions.set(id, adm);
      if (this.opts.forward !== "deferred") await this.forward(adm, now);
    }
    return { http_status: 200, admission: adm.admission };
  }

  private async forward(adm: Admitted, now: number) {
    const target = this.targets.get(adm.envelope.target_app);
    if (!target) return;
    const signed = await signEnvelope(adm.body, adm.envelope, this.key, now, adm.gateway_nonce);
    const fwd: ForwardHeaders = {
      ...signed,
      [ADMISSION_HEADER]: encodeAdmissionHeader(adm.admission),
    };
    const res = await target.handle(fwd, adm.body, now);
    if (res.http_status !== 200 || !res.receipts) {
      if (res.reason) this.forwardRejections.push({ at: now, reason: res.reason });
      return;
    }
    // Only a fully verified chain is stored; the query never serves an unverified receipt.
    const chain: ReceiptV2[] = [adm.admission];
    try {
      const kinds = ["target_inbox", "consumer_commit"] as const;
      for (let i = 0; i < res.receipts.length; i++) {
        await verifyReceiptV2(
          res.receipts[i],
          {
            envelope: adm.envelope,
            connection_id: adm.connection_id,
            delivery_id: adm.delivery_id,
            kind: kinds[i]!,
          },
          this.registry,
          now,
          chain.slice(),
        );
        chain.push(res.receipts[i]!);
      }
    } catch (err) {
      this.forwardRejections.push({ at: now, reason: (err as Error).message });
      return;
    }
    adm.chain = chain;
  }

  /** Re-forward every admission whose chain is not terminal (lost ACK, held at the target). */
  async forwardPending(now: number): Promise<void> {
    for (const adm of this.admissions.values()) {
      const inbox = adm.chain[1];
      const done = inbox && (inbox.outcome === "quarantined" || adm.chain.length === 3);
      if (!done) await this.forward(adm, now);
    }
  }

  /** rtgip/2-receipt-query/1. Read only: it never mutates admissions or chains. */
  async query(
    headers: Partial<QueryHeaders>,
    body: string,
    now: number,
  ): Promise<{ http_status: number; receipts?: ReceiptV2[]; reason?: string }> {
    const byDelivery = new Map([...this.admissions.values()].map((a) => [a.delivery_id, a]));
    const v = await verifyReceiptQuery(headers, body, {
      registry: this.registry,
      nonces: this.queryNonces,
      nowSec: now,
      lookup: (id) => {
        const a = byDelivery.get(id);
        return a
          ? {
              connection_id: a.connection_id,
              source_app: a.envelope.source_app,
              tenant_id: a.envelope.tenant_id,
              event_id: a.envelope.event_id,
            }
          : null;
      },
    });
    if ("reason" in v) return { http_status: 403, reason: v.reason };
    return { http_status: 200, receipts: byDelivery.get(v.query.delivery_id)!.chain };
  }
}

let nonceSeq = 0;

/** Source side: sign and POST an outbox row to the stand-in Gateway. */
export function sourceTransport(
  gw: ReferenceGatewayStandIn,
  key: ServiceKey,
  clock: { now: number },
): Transport {
  return async (r: OutboxRow) => {
    const h = await signEnvelope(
      r.body,
      r.envelope,
      key,
      clock.now,
      `src_nonce_${r.event_id.slice(0, 8)}_${nonceSeq++}`,
    );
    return gw.admit(h, r.body, clock.now);
  };
}

/** Source side: the receipt-query port over the stand-in Gateway, signed with the source key. */
export function queryPort(
  gw: ReferenceGatewayStandIn,
  key: ServiceKey,
  clock: { now: number },
): ReceiptQueryPort {
  return async (delivery_id, event_id) => {
    const { body, headers } = await signReceiptQuery(
      { delivery_id, event_id },
      key,
      clock.now,
      `qry_nonce_${event_id.slice(0, 8)}_${nonceSeq++}_000000`,
    );
    const res = await gw.query(headers, body, clock.now);
    if (res.http_status !== 200 || !res.receipts)
      throw new Error(res.reason ?? `http_${res.http_status}`);
    return res.receipts;
  };
}

/** A signed admission receipt for tests that drive a MemoryInbox directly. */
export async function signAdmission(
  envelope: EnvelopeV2,
  connection_id: string,
  gatewayKey: ServiceKey,
  issued_at: number,
): Promise<ReceiptV2> {
  const delivery_id = await deliveryIdentity(envelope, connection_id);
  return signReceiptV2(
    await receiptDraft(
      { envelope, connection_id, delivery_id, kind: "gateway_admission" },
      "admitted",
      issued_at,
      null,
    ),
    gatewayKey,
  );
}
