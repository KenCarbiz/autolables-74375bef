import { deliveryIdentity, receiptDigest, type ReceiptV2 } from "./receipt";
import type { VerifiedAdmission } from "./verify";
import type { DurableAdmission } from "./handler.server";
import type { DeliveryLease } from "./dispatcher.server";

/** Explicit server-only, narrow RPC port. Never imports a browser client or privileged credentials. */
export interface CandidateRpc {
  call(name: string, args: Record<string, unknown>): Promise<unknown>;
}
export function candidateStore(
  rpc: CandidateRpc,
  gatewayKeyId: (connection: string) => Promise<string>,
) {
  return {
    async admit(v: VerifiedAdmission): Promise<DurableAdmission> {
      const result = await rpc.call("gw_r2_admit", {
        _body: v.canonical_body,
        _connection: v.connection_id,
        _source_key: v.key_id,
        _gateway_key: await gatewayKeyId(v.connection_id),
        _nonce: v.nonce,
        _timestamp: v.timestamp,
        _delivery_id: await deliveryIdentity(v.envelope, v.connection_id),
      });
      if (!result || typeof result !== "object") throw new Error("invalid_admission_response");
      const r = result as Record<string, unknown>;
      if (
        (r["outcome"] !== "admitted" && r["outcome"] !== "exact_retry") ||
        typeof r["connection_id"] !== "string" ||
        typeof r["envelope_sha256"] !== "string" ||
        typeof r["delivery_id"] !== "string" ||
        typeof r["gateway_key_id"] !== "string" ||
        !Number.isSafeInteger(r["issued_at"])
      )
        throw new Error("admission_not_accepted");
      return r as unknown as DurableAdmission;
    },
    async persistSignedEvidence(d: DurableAdmission, receipt: ReceiptV2) {
      await rpc.call("gw_r2_save_admission_receipt", {
        _id: d.delivery_id,
        _receipt: receipt,
        _digest: await receiptDigest(receipt),
      });
    },
    async complete(lease: DeliveryLease, receipts: ReceiptV2[]): Promise<string> {
      const inbox = receipts[0],
        commit = receipts[1];
      if (!inbox || !commit) throw new Error("incomplete_receipt_chain");
      const result = await rpc.call("gw_r2_complete", {
        _id: lease.delivery_id,
        _generation: lease.generation,
        _token: lease.token,
        _inbox: inbox,
        _inbox_digest: await receiptDigest(inbox),
        _commit: commit,
        _commit_digest: await receiptDigest(commit),
      });
      if (typeof result !== "string") throw new Error("invalid_completion_response");
      return result;
    },
    async recordUncommitted(lease: DeliveryLease, inbox: ReceiptV2): Promise<string> {
      const result = await rpc.call("gw_r2_record_uncommitted", {
        _id: lease.delivery_id,
        _generation: lease.generation,
        _token: lease.token,
        _inbox: inbox,
        _inbox_digest: await receiptDigest(inbox),
      });
      if (typeof result !== "string") throw new Error("invalid_uncommitted_response");
      return result;
    },
    async fail(lease: DeliveryLease): Promise<string> {
      const result = await rpc.call("gw_r2_fail", {
        _id: lease.delivery_id,
        _generation: lease.generation,
        _token: lease.token,
      });
      if (typeof result !== "string") throw new Error("invalid_failure_response");
      return result;
    },
  };
}
