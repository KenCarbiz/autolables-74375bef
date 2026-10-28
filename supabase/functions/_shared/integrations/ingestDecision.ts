import {
  catalogEntry, payloadChecksum, validateEnvelope,
  type EnvelopeV1, type Producer, type Visibility,
} from "./envelope.ts";
import { sha256Hex, verify, withinSkew } from "./signing.ts";

export const MAX_BODY_BYTES = 1_000_000;

export interface HeaderReader {
  get(name: string): string | null;
}

export interface ConnectionRecord {
  id: string;
  tenant_id: string;
  app: Exclude<Producer, "autolabels">;
  status: "pending" | "active" | "paused" | "revoked" | "error";
  scopes: string[];
  adapter: Adapter;
  external_rooftop_ref: string | null;
}

export type Adapter = "rooftop.v1" | "autofilm.v1";

export interface KeyRecord {
  key_id: string;
  status: "active" | "retiring" | "revoked";
  connection: ConnectionRecord;
}

export interface ExistingReceipt {
  id: string;
  status: string;
  payload_checksum: string;
  received_at: string;
}

export type InboxStatus = "received" | "held";

export interface InboxInsert {
  connection_id: string;
  tenant_id: string;
  producer: Producer;
  event_id: string;
  event_type: string;
  schema_version: string;
  idempotency_key: string;
  payload_checksum: string;
  source_record_id: string;
  source_version: number;
  vin: string;
  adapter: Adapter;
  visibility: Exclude<Visibility, "customer_public">;
  requested_visibility: Visibility;
  envelope: EnvelopeV1;
  status: InboxStatus;
}

export type IngestCode =
  | "received"
  | "held"
  | "duplicate"
  | "schema_invalid"
  | "signature_invalid"
  | "scope_or_tenant_denied"
  | "idempotency_conflict"
  | "rejected";

export interface IngestDecision {
  httpStatus: 200 | 202 | 400 | 401 | 403 | 409 | 422;
  code: IngestCode;
  detail: string[];
  insert: InboxInsert | null;
  duplicateOf: ExistingReceipt | null;
}

export interface IngestInput {
  headers: HeaderReader;
  rawBody: string;
  nowMs: number;
  keyRecord: KeyRecord | null;
  secret: string | null;
  existingByEventId: ExistingReceipt | null;
  existingByIdempotencyKey: ExistingReceipt | null;
  directionEnabled: boolean;
}

export const deny = (httpStatus: 400 | 401 | 403 | 409 | 422, code: IngestCode, detail: string[] = []): IngestDecision => ({
  httpStatus, code, detail, insert: null, duplicateOf: null,
});

export async function decideIngest(input: IngestInput): Promise<IngestDecision> {
  const keyId = input.headers.get("x-rooftop-key-id");
  const ts = input.headers.get("x-rooftop-timestamp");
  const signature = input.headers.get("x-rooftop-signature");
  const { keyRecord, secret } = input;

  if (!keyId || !ts || !signature || !keyRecord || !secret) return deny(401, "signature_invalid", ["credentials"]);
  if (keyRecord.key_id !== keyId || keyRecord.status === "revoked") return deny(401, "signature_invalid", ["credentials"]);
  if (keyRecord.connection.status !== "active" || keyRecord.connection.adapter !== "rooftop.v1") {
    return deny(401, "signature_invalid", ["credentials"]);
  }

  if (!/^\d{1,12}$/.test(ts) || !withinSkew(Number(ts), Math.floor(input.nowMs / 1000))) {
    return deny(401, "signature_invalid", ["timestamp"]);
  }
  if (!(await verify(secret, ts, keyId, input.rawBody, signature))) {
    return deny(401, "signature_invalid", ["signature"]);
  }

  const { connection } = keyRecord;

  if (input.rawBody.length > MAX_BODY_BYTES) return deny(400, "schema_invalid", ["body_too_large"]);
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.rawBody);
  } catch {
    return deny(400, "schema_invalid", ["invalid_json"]);
  }
  const validation = validateEnvelope(parsed);
  if (!validation.ok || !validation.envelope) return deny(400, "schema_invalid", validation.errors.slice(0, 10));
  const envelope = validation.envelope;

  if (envelope.producer !== connection.app) return deny(403, "scope_or_tenant_denied", ["producer_mismatch"]);
  const entry = catalogEntry(envelope.event_type);
  if (!entry || entry.producer !== connection.app) return deny(403, "scope_or_tenant_denied", ["event_not_permitted"]);
  if (!connection.scopes.includes(entry.scope)) return deny(403, "scope_or_tenant_denied", ["scope_missing"]);

  const checksum = await payloadChecksum(envelope.payload);
  if (envelope.payload_checksum !== undefined && envelope.payload_checksum !== checksum) {
    return deny(400, "schema_invalid", ["payload_checksum_mismatch"]);
  }

  const byEvent = input.existingByEventId;
  if (byEvent) {
    return byEvent.payload_checksum === checksum
      ? { httpStatus: 200, code: "duplicate", detail: [], insert: null, duplicateOf: byEvent }
      : deny(409, "idempotency_conflict", ["event_id_reused"]);
  }
  const byKey = input.existingByIdempotencyKey;
  if (byKey) {
    return byKey.payload_checksum === checksum
      ? { httpStatus: 200, code: "duplicate", detail: [], insert: null, duplicateOf: byKey }
      : deny(409, "idempotency_conflict", ["idempotency_key_reused"]);
  }

  const status: InboxStatus = input.directionEnabled ? "received" : "held";
  return {
    httpStatus: 202,
    code: status,
    detail: [],
    duplicateOf: null,
    insert: {
      connection_id: connection.id,
      tenant_id: connection.tenant_id,
      producer: envelope.producer,
      event_id: envelope.event_id,
      event_type: envelope.event_type,
      schema_version: envelope.schema_version,
      idempotency_key: envelope.idempotency_key,
      payload_checksum: checksum,
      source_record_id: envelope.source_record_id,
      source_version: envelope.source_version,
      vin: envelope.vin,
      adapter: "rooftop.v1",
      visibility: "tenant_private",
      requested_visibility: envelope.visibility,
      envelope,
      status,
    },
  };
}

export const MAX_BODY = MAX_BODY_BYTES;
export const bodySha256 = (rawBody: string): Promise<string> => sha256Hex(rawBody);
