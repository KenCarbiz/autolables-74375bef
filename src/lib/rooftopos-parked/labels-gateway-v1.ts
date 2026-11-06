/**
 * AutoLabels PR #46 -> RooftopOS Gateway numeric-v1, DEVELOPMENT-ONLY.
 *
 * This module is intentionally NOT imported from any application, edge function,
 * migration, RPC or worker. It performs no network or database operations.
 * It must not be wired to production until a separately reviewed, signed and
 * transactionally durable source/target adapter has been tested in staging.
 */
import {
  payloadChecksum,
  validateEnvelope,
  type EnvelopeV1,
} from "../../../supabase/functions/_shared/integrations/envelope.ts";

export const LABELS_GATEWAY_TRANSPORT_ENABLED = false as const;
export const GATEWAY_V1_SCHEMA_VERSION = 1 as const;
const VIN = /^[A-HJ-NPR-Z0-9]{17}$/;
const SHA256 = /^[a-f0-9]{64}$/i;
const SENSITIVE_KEY = /(^|_)(first_name|last_name|full_name|customer|email|phone|address|dob|ssn|token|password|secret|card|payment|finance|loan)($|_)/i;
const BINARY_KEY = /(base64|binary|blob|image_bytes|video_bytes|media_data)/i;

export interface TrustedSourceBinding {
  /** Verified from signed transport key, NEVER a browser/input body claim. */
  app: "autolabels";
  tenantId: string;
  rooftopId: string;
  sourceTenantRef: string;
  connectionId: string;
  signatureVerified: true;
  replayChecked: true;
  serverValidatedAt: string;
  externalDeliveryEnabled: false;
}

export interface VerifiedSoldMilestone {
  /** Independently resolved from AutoLabels' server-owned custody milestone. */
  sourceRecordId: string;
  instanceId: string;
  episodeId: string;
  evidenceRef: string;
  state: "sold_verified";
}

export interface CanonicalGatewaySoldV1 {
  event_id: string;
  schema_version: 1;
  tenant_id: string;
  rooftop_id: string;
  vehicle: { vin: string; instance_id: string; episode_id: string };
  source_app: "autolabels";
  event_type: "listing.sold";
  aggregate: { type: "vehicle_instance"; id: string; revision: number };
  correlation_id?: string;
  occurred_at: string;
  emitted_at: string;
  classification: "internal";
  payload_hash: string;
  payload: {
    source_record_id: string;
    source_version: number;
    source_event_type: "autolabels.vehicle.sold";
    custody_milestone_evidence_ref: string;
    immutable: true;
  };
}

function nonempty(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw Error("missing_" + name);
  return value;
}

function iso(value: unknown, name: string): string {
  const text = nonempty(value, name);
  const date = new Date(text);
  if (!Number.isFinite(date.getTime())) throw Error("invalid_" + name);
  return date.toISOString();
}

function scanSensitive(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(scanSensitive);
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (SENSITIVE_KEY.test(key)) throw Error("sensitive_field_blocked");
      if (BINARY_KEY.test(key)) throw Error("binary_field_blocked");
      scanSensitive(child);
    }
  }
}

/**
 * Only one explicitly-verified source event is translated in this parked PR.
 * sold != delivered, archived, sale_voided, listed, or inventory refreshed.
 * No generic event-name replacement. Follow-on events remain unsupported.
 */
export async function translateVerifiedSoldEvent(
  raw: unknown,
  binding: TrustedSourceBinding,
  milestone: VerifiedSoldMilestone,
): Promise<CanonicalGatewaySoldV1> {
  const v = validateEnvelope(raw);
  if (!v.ok || !v.envelope) throw Error("invalid_pr46_envelope:" + v.errors.join(","));
  const source: EnvelopeV1 = v.envelope;
  if (source.schema_version !== "1.1.0") throw Error("version_requires_explicit_v110");
  if (source.producer !== "autolabels" || source.event_type !== "autolabels.vehicle.sold") {
    throw Error("unsupported_semantic_mapping");
  }
  if (!source.instance_ref || source.instance_ref.app !== "autolabels") {
    throw Error("unresolved_vehicle_instance");
  }
  if (!VIN.test(source.vin)) throw Error("invalid_vin");
  if (!Number.isSafeInteger(source.source_version) || source.source_version < 1) {
    throw Error("invalid_revision");
  }
  if (
    !binding ||
    binding.app !== "autolabels" ||
    binding.signatureVerified !== true ||
    binding.replayChecked !== true ||
    binding.externalDeliveryEnabled !== false ||
    !binding.connectionId ||
    !binding.serverValidatedAt ||
    binding.sourceTenantRef !== source.tenant_ref ||
    !binding.tenantId ||
    !binding.rooftopId
  ) throw Error("verified_connection_binding_required");

  if (
    !milestone ||
    milestone.state !== "sold_verified" ||
    milestone.sourceRecordId !== source.source_record_id ||
    milestone.instanceId !== source.instance_ref.id ||
    !milestone.episodeId ||
    !milestone.evidenceRef
  ) throw Error("custody_milestone_unverified");
  // Incoming body may contain data for other purposes; no PII or binary may
  // enter the general vehicle-event transport, even in an inert fixture.
  scanSensitive(source.payload);
  if (!source.payload_checksum || !SHA256.test(source.payload_checksum)) {
    throw Error("source_payload_checksum_required");
  }
  const calculated = await payloadChecksum(source.payload);
  if (calculated.toLowerCase() !== source.payload_checksum.toLowerCase()) {
    throw Error("source_payload_hash_mismatch");
  }

  const payload = {
    source_record_id: source.source_record_id,
    source_version: source.source_version,
    source_event_type: "autolabels.vehicle.sold" as const,
    custody_milestone_evidence_ref: milestone.evidenceRef,
    immutable: true as const,
  };
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  if (bytes.byteLength > 16_384) throw Error("payload_too_large");
  const payload_hash = await payloadChecksum(payload);
  return {
    event_id: source.event_id,
    schema_version: GATEWAY_V1_SCHEMA_VERSION,
    tenant_id: binding.tenantId,
    rooftop_id: binding.rooftopId,
    vehicle: {
      vin: source.vin,
      instance_id: source.instance_ref.id,
      episode_id: milestone.episodeId,
    },
    source_app: "autolabels",
    event_type: "listing.sold",
    aggregate: {
      type: "vehicle_instance",
      id: source.instance_ref.id,
      revision: source.source_version,
    },
    correlation_id: source.correlation_id,
    occurred_at: iso(source.occurred_at, "occurred_at"),
    emitted_at: iso(source.sent_at, "sent_at"),
    classification: "internal",
    payload_hash,
    payload,
  };
}

export function isLiveGatewayDeliveryAllowed(): false {
  return LABELS_GATEWAY_TRANSPORT_ENABLED;
}
