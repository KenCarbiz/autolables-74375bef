/**
 * RooftopOS Gateway v1 -> AutoLabels evidence, PARKED / NO I/O.
 *
 * Not imported by any active route or edge function. No real DB, network,
 * secret, customer, feed, price, listing or history mutation. A trusted
 * SERVER must authenticate raw bytes, app key, time/nonce and replay, then
 * resolve the signed connection and destination scope BEFORE calling this.
 *
 * Passing a forged boolean object here is NOT authentication. Every "ready"
 * effect still requires a transactional inbox+projection commit under RLS,
 * source-revision lock and unique idempotency constraint.
 */
export const AUTOLABELS_GATEWAY_INBOUND_ENABLED = false as const;

export type ExternalSource = "autofilm" | "autocurb" | "autoframe";
export type ApprovedEvent =
  | "service.mpi_verified"
  | "service.repair_verified"
  | "appraisal.completed"
  | "acquisition.closed"
  | "media.approved";

export interface CanonicalGatewayEvent {
  event_id: string;
  schema_version: number;
  source_app: ExternalSource;
  event_type: string;
  tenant_id: string;
  rooftop_id: string;
  vehicle: { vin: string; instance_id: string; episode_id?: string };
  aggregate: { type: string; id: string; revision: number };
  occurred_at: string;
  emitted_at: string;
  classification?: string;
  payload_hash?: string;
  payload: Record<string, unknown>;
  refs?: { service_visit_ref?: string; evidence_refs?: string[] };
}

export interface ServerVerifiedDelivery {
  /** Required to be derived from an authenticated SERVER connection registry. */
  connectionId: string;
  signerApp: ExternalSource;
  tenantId: string;
  rooftopId: string;
  destinationApp: "autolabels";
  signatureVerified: true;
  replayChecked: true;
  payloadChecksumVerified: true;
  externalTransportEnabled: false;
}
export interface ResolvedVehicleScope {
  /** Resolved from authenticated tenant/rooftop+VIN+instance in AutoLabels. */
  tenantId: string;
  rooftopId: string;
  vin: string;
  instanceId: string;
  episodeId: string;
  lifecycle: "inventory" | "sold" | "delivered" | "service" | "archived";
}
export interface LockedSourceReceipt {
  /** Read in the same DB transaction as the future insert/update. */
  seenHashForEventId?: string;
  lastSourceRevision: number;
}

export type Effect =
  | {
      kind: "verified_service_evidence";
      sourceApp: "autofilm";
      sourceEventId: string;
      visitRef: string;
      evidenceRefs: string[];
      eventType: "service.mpi_verified" | "service.repair_verified";
      /** Never change the listing/custody episode. */
      reopenInventory: false;
      provenanceHash: string;
    }
  | {
      kind: "acquisition_evidence";
      sourceApp: "autocurb";
      sourceEventId: string;
      eventType: "appraisal.completed" | "acquisition.closed";
      sourceRecordRef: string;
      /** Does not overwrite AutoLabels published price, ACV, deal or custody. */
      changePublishedPrice: false;
      reopenInventory: false;
      provenanceHash: string;
    }
  | {
      kind: "approved_media_reference";
      sourceApp: "autoframe";
      sourceEventId: string;
      mediaId: string;
      objectRef: string;
      sourceEpisodeId: string;
      /** Media is a metadata reference, not binary or public URL. */
      publishPublicUrl: false;
      reopenInventory: false;
      provenanceHash: string;
    };

export type Evaluation =
  | { status: "ready"; effect: Effect; eventId: string; sourceRevision: number }
  | { status: "duplicate" | "stale" | "held" | "rejected" | "conflict"; reason: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VIN = /^[A-HJ-NPR-Z0-9]{17}$/;
const SHA256 = /^[0-9a-f]{64}$/i;
const OPAQUE_MEDIA = /^objref:[a-z0-9-]{1,64}\/[A-Za-z0-9._/-]{1,255}$/;
const PII_KEY = /(^|_)(customer|first_name|last_name|full_name|email|phone|address|ssn|dob|birth_date|card|account_number|loan|finance|token|secret|password)($|_)/i;
const BINARY_KEY = /(base64|binary|blob|image_bytes|video_bytes|raw_media|data_uri)/i;
const MEDIA_ROLES = new Set(["sales_manager", "inventory_manager", "general_manager"]);
const EVENT_SOURCE: Record<ApprovedEvent, ExternalSource> = {
  "service.mpi_verified": "autofilm",
  "service.repair_verified": "autofilm",
  "appraisal.completed": "autocurb",
  "acquisition.closed": "autocurb",
  "media.approved": "autoframe",
};
const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const iso = (v: unknown): boolean => str(v) && Number.isFinite(Date.parse(v));
const positiveInt = (v: unknown): v is number =>
  typeof v === "number" && Number.isSafeInteger(v) && v > 0;
const reject = (reason: string): Evaluation => ({ status: "rejected", reason });
const held = (reason: string): Evaluation => ({ status: "held", reason });

function sensitive(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const x = sensitive(item);
      if (x) return x;
    }
  } else if (isObj(value)) {
    for (const [k, v] of Object.entries(value)) {
      if (PII_KEY.test(k)) return "pii_field_blocked";
      if (BINARY_KEY.test(k)) return "binary_field_blocked";
      const x = sensitive(v);
      if (x) return x;
    }
  } else if (typeof value === "string") {
    if (/^https?:\/\//i.test(value) || /^data:/i.test(value) || /(?:x-amz-|signature=|token=|expires=)/i.test(value))
      return "unsafe_url_or_token";
  }
  return null;
}
function keysOnly(v: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(v).every((k) => allowed.includes(k));
}

/**
 * Pre-apply plan, NOT a state mutation. Transactional inbox enforcement is
 * required to make this safe under parallel at-least-once delivery.
 */
export function evaluateGatewayEvidenceV1(
  raw: unknown,
  auth: ServerVerifiedDelivery,
  vehicle: ResolvedVehicleScope | null,
  receipt: LockedSourceReceipt,
): Evaluation {
  if (!isObj(raw)) return reject("invalid_envelope");
  const e = raw as unknown as CanonicalGatewayEvent;
  if (e.schema_version !== 1) return reject("unsupported_numeric_schema");
  if (!(e.event_type in EVENT_SOURCE)) return reject("event_not_allowed");
  const eventType = e.event_type as ApprovedEvent;
  const source = EVENT_SOURCE[eventType];
  if (e.source_app !== source) return reject("source_not_authoritative");
  if (!UUID.test(String(e.event_id))) return reject("invalid_event_id");
  if (!str(e.tenant_id) || !str(e.rooftop_id) || !isObj(e.vehicle) || !VIN.test(String(e.vehicle.vin)))
    return reject("invalid_vehicle_scope");
  if (!isObj(e.aggregate) || e.aggregate.type !== "vehicle_instance" ||
      e.aggregate.id !== e.vehicle.instance_id || !positiveInt(e.aggregate.revision))
    return reject("invalid_source_aggregate");
  if (!iso(e.occurred_at) || !iso(e.emitted_at)) return reject("invalid_timestamp");
  if (!isObj(e.payload) || JSON.stringify(e.payload).length > 16_384) return reject("invalid_payload");
  if (!str(e.payload_hash) || !SHA256.test(e.payload_hash)) return reject("hash_required");
  const forbidden = sensitive(e.payload) || sensitive(e.refs);
  if (forbidden) return reject(forbidden);
  if (!auth || auth.destinationApp !== "autolabels" ||
      auth.signerApp !== e.source_app || auth.signatureVerified !== true ||
      auth.replayChecked !== true || auth.payloadChecksumVerified !== true ||
      auth.externalTransportEnabled !== false || !auth.connectionId ||
      auth.tenantId !== e.tenant_id || auth.rooftopId !== e.rooftop_id)
    return reject("authenticated_connection_scope_required");

  // The future server must perform this dedupe under a DB unique constraint.
  if (receipt.seenHashForEventId) {
    return receipt.seenHashForEventId.toLowerCase() === e.payload_hash.toLowerCase()
      ? { status: "duplicate", reason: "already_applied" }
      : { status: "conflict", reason: "event_id_reused_with_different_hash" };
  }
  if (!Number.isSafeInteger(receipt.lastSourceRevision) || receipt.lastSourceRevision < 0)
    return reject("untrusted_revision_watermark");
  if (e.aggregate.revision <= receipt.lastSourceRevision)
    return { status: "stale", reason: "revision_at_or_below_watermark" };

  // A VIN does not resolve a custody instance. Unknown instances are held
  // rather than auto-creating inventory or mapping another rooftop's car.
  if (!vehicle) return held("unresolved_registered_vehicle_instance");
  if (vehicle.tenantId !== e.tenant_id || vehicle.rooftopId !== e.rooftop_id ||
      vehicle.instanceId !== e.vehicle.instance_id || vehicle.vin !== e.vehicle.vin)
    return reject("resolved_vehicle_scope_mismatch");
  if (!str(e.vehicle.episode_id) || vehicle.episodeId !== e.vehicle.episode_id)
    return held("unresolved_or_noncurrent_episode");

  const p = e.payload;
  const common = { sourceEventId: e.event_id, provenanceHash: e.payload_hash } as const;
  let effect: Effect;
  if (eventType === "service.mpi_verified" || eventType === "service.repair_verified") {
    const visitRef = e.refs?.service_visit_ref ?? p["service_visit_ref"];
    const evidenceRefs = e.refs?.evidence_refs ??
      (str(p["evidence_ref"]) ? [p["evidence_ref"]] : []);
    if (!str(visitRef) || !Array.isArray(evidenceRefs) ||
        evidenceRefs.length === 0 || !evidenceRefs.every(str))
      return held("service_visit_and_verified_evidence_required");
    const verified = p["verification_state"] === "verified" ||
      (eventType === "service.repair_verified" && p["completed_verified"] === true);
    if (!verified) return held("independent_verification_required");
    if (vehicle.lifecycle === "archived" && !str(visitRef))
      return held("archived_without_service_visit");
    effect = {
      kind: "verified_service_evidence", sourceApp: "autofilm", ...common,
      visitRef, evidenceRefs, eventType, reopenInventory: false,
    };
  } else if (eventType === "appraisal.completed" || eventType === "acquisition.closed") {
    const isAppraisal = eventType === "appraisal.completed";
    if (isAppraisal &&
        (p["verified_state"] !== "finalized" || !str(p["source_submission_ref"]) ||
         !str(p["appraisal_finalized_by_ref"]) || !iso(p["appraisal_finalized_at"])))
      return held("final_appraisal_audit_required");
    if (!isAppraisal &&
        (p["verified_state"] !== "purchased" || !str(p["purchase_ref"]) ||
         !iso(p["custody_verified_at"])))
      return held("acquisition_custody_audit_required");
    effect = {
      kind: "acquisition_evidence", sourceApp: "autocurb", ...common, eventType,
      sourceRecordRef: isAppraisal ? String(p["source_submission_ref"]) : String(p["purchase_ref"]),
      changePublishedPrice: false, reopenInventory: false,
    };
  } else {
    if (e.classification !== "media_meta") return reject("media_classification_required");
    if (!keysOnly(p, ["media_id", "content_sha256", "object_ref", "mime", "width",
      "height", "preset_version", "preset_order", "approval"]))
      return reject("unexpected_media_payload_field");
    if (!str(p["media_id"]) || !SHA256.test(String(p["content_sha256"])) ||
        !str(p["object_ref"]) || !OPAQUE_MEDIA.test(p["object_ref"]) ||
        !["image/jpeg", "image/png", "image/webp"].includes(String(p["mime"])) ||
        !positiveInt(p["width"]) || !positiveInt(p["height"]) ||
        !str(p["preset_version"]) || !Number.isSafeInteger(p["preset_order"]) ||
        (p["preset_order"] as number) < 0 || !isObj(p["approval"]) ||
        !MEDIA_ROLES.has(String(p["approval"].role)) ||
        !str(p["approval"].approval_id) || !iso(p["approval"].approved_at))
      return reject("unverified_or_invalid_media");
    // A media approval never changes inventory. Preserve sale history, and
    // the consumer can decide separately whether to display historical media.
    effect = {
      kind: "approved_media_reference", sourceApp: "autoframe", ...common,
      mediaId: p["media_id"], objectRef: p["object_ref"],
      sourceEpisodeId: vehicle.episodeId,
      publishPublicUrl: false, reopenInventory: false,
    };
  }
  return { status: "ready", effect, eventId: e.event_id, sourceRevision: e.aggregate.revision };
}

export function canActivateGatewayInbound(): false {
  return AUTOLABELS_GATEWAY_INBOUND_ENABLED;
}
