import {
  verifyAdmission,
  headerRecord,
  RTGIP2_INGRESS_ENABLED,
  type VerifiedAdmission,
  type IdentityMapping,
} from "./verify";
import { readBounded } from "./wire";
import { receiptDraft, signReceiptV2, type ReceiptV2 } from "./receipt";
import type { Registry, ServiceKey } from "./core";

export interface DurableAdmission {
  outcome: "admitted" | "exact_retry";
  connection_id: string;
  envelope_sha256: string;
  delivery_id: string;
  issued_at: number;
  gateway_key_id: string;
}
export interface AdmissionDependencies {
  registry: () => Promise<{ registry: Registry; mappings: IdentityMapping[] }>;
  now: () => number;
  /** One atomic service-only operation: nonce + immutable envelope + receipt intent + dispatch + audit. */
  admit: (verified: VerifiedAdmission) => Promise<DurableAdmission>;
  resolveSigningKey: (id: string) => Promise<ServiceKey | null>;
  persistSignedEvidence: (delivery: DurableAdmission, receipt: ReceiptV2) => Promise<void>;
}

/** Unregistered. No route imports this handler; no environment switch can enable live delivery. */
export function createRtgip2Handler(
  deps: AdmissionDependencies,
  localTestEnabled: boolean = RTGIP2_INGRESS_ENABLED,
) {
  return async (request: Request): Promise<Response> => {
    const deny = (status: number, reason: string) =>
      Response.json({ error: reason }, { status, headers: { "cache-control": "no-store" } });
    if (!localTestEnabled) return deny(503, "RTGIP2_NOT_ACTIVATED");
    if (request.method !== "POST" || request.headers.get("content-type") !== "application/json")
      return deny(400, "invalid_request");
    try {
      const bytes = await readBounded(request.body, request.headers.get("content-length"));
      const { registry, mappings } = await deps.registry();
      const verified = await verifyAdmission(
        headerRecord(request.headers),
        bytes,
        registry,
        mappings,
        deps.now(),
      );
      const durable = await deps.admit(verified);
      if (
        durable.envelope_sha256 !== verified.body_sha256 ||
        durable.connection_id !== verified.connection_id
      )
        return deny(503, "durable_admission_mismatch");
      const key = await deps.resolveSigningKey(durable.gateway_key_id);
      if (!key) return deny(503, "admission_receipt_unavailable");
      const receipt = await signReceiptV2(
        await receiptDraft(
          {
            envelope: verified.envelope,
            connection_id: durable.connection_id,
            delivery_id: durable.delivery_id,
            kind: "gateway_admission",
          },
          "admitted",
          durable.issued_at,
          null,
        ),
        key,
      );
      await deps.persistSignedEvidence(durable, receipt);
      return Response.json(
        { outcome: durable.outcome, receipt },
        { headers: { "cache-control": "no-store" } },
      );
    } catch {
      // Never return a receipt when admission failed or its commit status is unknown.
      return deny(503, "admission_not_confirmed");
    }
  };
}
