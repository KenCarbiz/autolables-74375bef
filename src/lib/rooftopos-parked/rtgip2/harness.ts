// Synthetic in-process harness: a reference Gateway admission + re-sign step and a target
// endpoint. Test-only. It does not open sockets and is not the hosted Gateway.

import {
  signEnvelope, verifyDelivery, MemoryNonceStore, sha256Hex,
  type AppId, type NonceStore, type Registry, type ServiceKey, type SignedHeaders,
} from "./protocol.ts";
import { signReceipt, type MemoryInbox, type Receipt, type TransportResult } from "./delivery.ts";

export interface TargetEndpoint {
  app: AppId;
  handle(headers: SignedHeaders, body: string, now: number): Promise<TransportResult & { reason?: string }>;
}

export function makeTarget<P>(app: AppId, inbox: MemoryInbox<P>, registry: Registry, receiptKey: ServiceKey, nonces: NonceStore = new MemoryNonceStore(), opts: { crashAfterEffect?: () => boolean; dropAck?: () => boolean } = {}): TargetEndpoint {
  return {
    app,
    async handle(headers, body, now) {
      const v = await verifyDelivery(headers as unknown as Record<string, string>, body, { registry, nonces, nowSec: now, expectedSigner: "gateway", receiver: app });
      if ("reason" in v) return { http_status: 401, reason: v.reason };
      const e = v.delivery.envelope;
      let res;
      try { res = inbox.receive(v.delivery, now, opts.crashAfterEffect?.() ?? false); }
      catch (err) { return { http_status: 503, reason: (err as Error).message }; }
      const base = { protocol: "rtgip/2" as const, event_id: e.event_id, route: e.route, tenant_id: e.tenant_id, payload_sha256: e.payload_sha256, issuer: app, issued_at: now };
      const receipts: Receipt[] = [await signReceipt({ ...base, kind: "target_inbox", outcome: res.outcome }, receiptKey)];
      if (res.committed && res.outcome !== "quarantined") {
        receipts.push(await signReceipt({ ...base, kind: "consumer_commit", outcome: res.outcome === "duplicate" ? "duplicate" : res.outcome }, receiptKey));
      }
      if (opts.dropAck?.()) return { http_status: 200 };
      return { http_status: 200, receipts };
    },
  };
}

export interface AdmissionRecord { event_id: string; target: AppId; body_sha256: string; admitted_at: number; gateway_nonce: string }

export class ReferenceGateway {
  admissions = new Map<string, AdmissionRecord>();
  rejections: { at: number; reason: string }[] = [];
  private nonces = new MemoryNonceStore();
  constructor(private registry: Registry, private key: ServiceKey, private targets: Map<AppId, TargetEndpoint>) {}

  /** Admit a source-signed delivery, re-sign for its single authorized target, forward. */
  async admit(headers: SignedHeaders, body: string, now: number): Promise<TransportResult & { reason?: string }> {
    const v = await verifyDelivery(headers as unknown as Record<string, string>, body, { registry: this.registry, nonces: this.nonces, nowSec: now, expectedSigner: "source" });
    if ("reason" in v) { this.rejections.push({ at: now, reason: v.reason }); return { http_status: 401, reason: v.reason }; }
    const e = v.delivery.envelope;
    const id = `${e.event_id}|${e.target_app}`;
    let adm = this.admissions.get(id);
    if (adm && adm.body_sha256 !== v.delivery.body_sha256) return { http_status: 409, reason: "admission_conflict" };
    if (!adm) {
      // Durable admission: the Gateway nonce is fixed at admission so a forwarded retry is an exact retry.
      adm = { event_id: e.event_id, target: e.target_app, body_sha256: v.delivery.body_sha256, admitted_at: now, gateway_nonce: `gw_${(await sha256Hex(id)).slice(0, 32)}` };
      this.admissions.set(id, adm);
    }
    const admission = await signReceipt({ protocol: "rtgip/2", kind: "gateway_admission", event_id: e.event_id, route: e.route, tenant_id: e.tenant_id, payload_sha256: e.payload_sha256, issuer: "gateway", outcome: "admitted", issued_at: now }, this.key);
    const target = this.targets.get(e.target_app);
    if (!target) return { http_status: 202, receipts: [admission], reason: "target_unavailable" };
    const fwd = await signEnvelope(body, e, this.key, now, adm.gateway_nonce);
    const res = await target.handle(fwd, body, now);
    return { http_status: res.http_status >= 500 ? 502 : 200, receipts: [admission, ...(res.receipts ?? [])], reason: res.reason };
  }
}
