import {
  verifyAdmission,
  headerRecord,
  RTGIP2_INGRESS_ENABLED,
  type VerifiedAdmission,
  type IdentityMapping,
} from "./verify";
import { readBounded, WireError } from "./wire";
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

// GW-F6: a permanent refusal must not look retryable. 503 is kept for outcomes whose durability is unknown.
const FORBIDDEN = new Set([
  "ambiguous_connection", "ambiguous_or_unauthorized_connection", "ambiguous_or_unauthorized_mapping",
  "connection_revoked", "dialect_held", "event_not_granted", "event_not_on_route", "key_not_bound_to_connection",
  "no_connection_for_tenant", "not_source_authority", "producer_disabled", "purpose_not_allowed",
  "purpose_not_granted", "reader_disabled", "rooftop_not_granted", "route_reserved", "source_impersonation",
  "unknown_route", "wrong_destination", "admission_forbidden",
]);
const MALFORMED = new Set([
  "unknown_rtgip_header", "duplicate_or_invalid_header", "missing_headers", "missing_nonce", "malformed_json",
  "body_not_canonical", "payload_hash_mismatch", "event_id_not_derived", "protocol_mismatch", "scope_mismatch",
  "unmappable_event", "invalid_nonce",
]);
export function refusalStatus(err: unknown): { status: number; reason: string } {
  if (err instanceof WireError)
    return { status: err.code === "body_too_large" ? 413 : 400, reason: err.code };
  const reason = err instanceof Error ? err.message : "invalid_request";
  if (reason === "admission_conflict") return { status: 409, reason };
  if (FORBIDDEN.has(reason)) return { status: 403, reason };
  if (MALFORMED.has(reason)) return { status: 400, reason };
  return { status: 401, reason };
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
    let current: Awaited<ReturnType<AdmissionDependencies["registry"]>>;
    try {
      current = await deps.registry();
    } catch {
      return deny(503, "admission_not_confirmed");
    }
    const { registry, mappings } = current;
    let verified: VerifiedAdmission;
    try {
      const bytes = await readBounded(request.body, request.headers.get("content-length"));
      verified = await verifyAdmission(
        headerRecord(request.headers),
        bytes,
        registry,
        mappings,
        deps.now(),
      );
    } catch (err) {
      const r = refusalStatus(err);
      return deny(r.status, r.reason);
    }
    try {
      let durable: DurableAdmission;
      try {
        durable = await deps.admit(verified);
      } catch (err) {
        const reason = err instanceof Error ? err.message : "";
        if (reason === "admission_conflict") return deny(409, reason);
        if (reason === "admission_forbidden") return deny(403, reason);
        if (reason === "nonce_reused") return deny(401, reason);
        throw err;
      }
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
