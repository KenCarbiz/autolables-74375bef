import { signEnvelope, authorize, type Registry, type ServiceKey } from "./core";
import { verifyReceiptV2, type ReceiptV2 } from "./receipt";
import { RTGIP2_OUTBOUND_ENABLED, type ForwardRequest } from "./verify";

export interface DeliveryLease {
  delivery_id: string;
  connection_id: string;
  generation: number;
  token: string;
  canonical_body: string;
  envelope: import("./core").EnvelopeV2;
  admission_receipt: ReceiptV2;
}
export interface DispatcherDependencies {
  registry: () => Promise<Registry>;
  now: () => number;
  claim: (worker: string) => Promise<DeliveryLease[]>;
  gatewayKey: (connection: string) => Promise<ServiceKey>;
  nonce: () => string;
  /** Local disposable transports only; runtime live transport remains hard OFF. */
  send: (lease: DeliveryLease, request: ForwardRequest) => Promise<unknown[]>;
  complete: (lease: DeliveryLease, receipts: ReceiptV2[]) => Promise<string>;
  fail: (lease: DeliveryLease, reason: string) => Promise<string>;
  /** GW-F1: stores a held or quarantined target_inbox receipt that has no commit behind it. */
  recordUncommitted?: (lease: DeliveryLease, inbox: ReceiptV2) => Promise<string>;
}
export async function dispatcherStep(
  worker: string,
  deps: DispatcherDependencies,
  localTestEnabled: boolean = RTGIP2_OUTBOUND_ENABLED,
): Promise<string[]> {
  if (!localTestEnabled) return ["RTGIP2_OUTBOUND_DISABLED"];
  const results: string[] = [];
  for (const lease of await deps.claim(worker)) {
    try {
      const registry = await deps.registry();
      if (!authorize(lease.envelope, registry).ok) throw new Error("authorization_changed");
      const expect = {
        envelope: lease.envelope,
        connection_id: lease.connection_id,
        delivery_id: lease.delivery_id,
      };
      const admission = await verifyReceiptV2(
        lease.admission_receipt,
        { ...expect, kind: "gateway_admission" },
        registry,
        deps.now(),
      );
      const request = {
        body: lease.canonical_body,
        headers: await signEnvelope(
          lease.canonical_body,
          lease.envelope,
          await deps.gatewayKey(lease.connection_id),
          deps.now(),
          deps.nonce(),
        ),
      };
      const received = await deps.send(lease, request);
      if (received.length === 1 && deps.recordUncommitted) {
        const held = await verifyReceiptV2(
          received[0],
          { ...expect, kind: "target_inbox" },
          registry,
          deps.now(),
          [admission],
        );
        if (held.outcome !== "held" && held.outcome !== "quarantined")
          throw new Error("incomplete_receipt_chain");
        results.push(await deps.recordUncommitted(lease, held));
        continue;
      }
      if (received.length !== 2) throw new Error("incomplete_receipt_chain");
      const inbox = await verifyReceiptV2(
        received[0],
        { ...expect, kind: "target_inbox" },
        registry,
        deps.now(),
        [admission],
      );
      const commit = await verifyReceiptV2(
        received[1],
        { ...expect, kind: "consumer_commit" },
        registry,
        deps.now(),
        [admission, inbox],
      );
      // SQL rechecks generation, token, live lease, authorization and immutable chain atomically.
      results.push(await deps.complete(lease, [inbox, commit]));
    } catch {
      results.push(await deps.fail(lease, "delivery_not_confirmed"));
    }
  }
  return results;
}
