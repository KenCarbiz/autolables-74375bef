import { sha256Hex } from "./signing.ts";

export type Producer = "autolabels" | "autofilm" | "autocurb";
export type Visibility = "tenant_private" | "custody_shared" | "customer_public";
export type Direction =
  | "labels_to_film"
  | "film_to_labels"
  | "labels_to_curb"
  | "curb_to_labels"
  | "film_to_curb"
  | "curb_to_film";

export const PRODUCERS: readonly Producer[] = ["autolabels", "autofilm", "autocurb"];
export const VISIBILITIES: readonly Visibility[] = ["tenant_private", "custody_shared", "customer_public"];
export const DIRECTIONS: readonly Direction[] = [
  "labels_to_film", "film_to_labels", "labels_to_curb", "curb_to_labels", "film_to_curb", "curb_to_film",
];

export interface InstanceRef {
  app: Producer;
  id: string;
}

export interface EnvelopeV1 {
  event_id: string;
  event_type: string;
  schema_version: string;
  producer: Producer;
  source_record_id: string;
  source_version: number;
  idempotency_key: string;
  correlation_id: string;
  causation_id?: string | null;
  occurred_at: string;
  observed_at?: string | null;
  sent_at: string;
  vin: string;
  tenant_ref: string;
  instance_ref?: InstanceRef | null;
  visibility: Visibility;
  evidence_refs?: string[];
  payload_checksum?: string;
  payload: Record<string, unknown>;
}

const ALLOWED_KEYS = new Set([
  "event_id", "event_type", "schema_version", "producer", "source_record_id", "source_version",
  "idempotency_key", "correlation_id", "causation_id", "occurred_at", "observed_at", "sent_at",
  "vin", "tenant_ref", "instance_ref", "visibility", "evidence_refs", "payload_checksum", "payload",
]);
const REQUIRED_KEYS = [
  "event_id", "event_type", "schema_version", "producer", "source_record_id", "source_version",
  "idempotency_key", "occurred_at", "sent_at", "vin", "tenant_ref", "visibility", "payload", "correlation_id",
] as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EVENT_TYPE = /^(autolabels|autofilm|autocurb)\.[a-z_]+(?:\.[a-z_]+)+$/;
const SEMVER = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const VIN_FORMAT = /^[A-HJ-NPR-Z0-9]{17}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isDateTime = (v: unknown): boolean => typeof v === "string" && DATE_TIME.test(v) && !Number.isNaN(Date.parse(v));
const strLen = (v: unknown, min: number, max: number): boolean =>
  typeof v === "string" && v.length >= min && v.length <= max;

export interface EnvelopeValidation {
  ok: boolean;
  errors: string[];
  envelope: EnvelopeV1 | null;
}

export function validateEnvelope(input: unknown): EnvelopeValidation {
  if (!isObject(input)) return { ok: false, errors: ["not_an_object"], envelope: null };
  const errors: string[] = [];
  const e = input;

  for (const key of Object.keys(e)) if (!ALLOWED_KEYS.has(key)) errors.push(`unknown_field:${key}`);
  for (const key of REQUIRED_KEYS) if (e[key] === undefined) errors.push(`missing:${key}`);

  const check = (key: string, ok: boolean) => {
    if (e[key] !== undefined && !ok) errors.push(`invalid:${key}`);
  };

  check("event_id", typeof e.event_id === "string" && UUID.test(e.event_id));
  check("event_type", typeof e.event_type === "string" && EVENT_TYPE.test(e.event_type));
  check("schema_version", typeof e.schema_version === "string" && SEMVER.test(e.schema_version));
  check("producer", typeof e.producer === "string" && (PRODUCERS as readonly string[]).includes(e.producer));
  check("source_record_id", strLen(e.source_record_id, 1, 256));
  check("source_version", typeof e.source_version === "number" && Number.isInteger(e.source_version) && e.source_version >= 1);
  check("idempotency_key", strLen(e.idempotency_key, 8, 256));
  check("correlation_id", typeof e.correlation_id === "string" && e.correlation_id.length >= 1);
  check("causation_id", e.causation_id === null || typeof e.causation_id === "string");
  check("occurred_at", isDateTime(e.occurred_at));
  check("observed_at", e.observed_at === null || isDateTime(e.observed_at));
  check("sent_at", isDateTime(e.sent_at));
  check("vin", typeof e.vin === "string" && VIN_FORMAT.test(e.vin));
  check("tenant_ref", typeof e.tenant_ref === "string" && e.tenant_ref.length >= 1);
  check("visibility", typeof e.visibility === "string" && (VISIBILITIES as readonly string[]).includes(e.visibility));
  check("payload_checksum", typeof e.payload_checksum === "string");
  check("payload", isObject(e.payload));
  check(
    "evidence_refs",
    Array.isArray(e.evidence_refs) && e.evidence_refs.length <= 100 && e.evidence_refs.every((r) => typeof r === "string"),
  );

  if (e.instance_ref !== undefined && e.instance_ref !== null) {
    const ref = e.instance_ref;
    const ok = isObject(ref)
      && Object.keys(ref).every((k) => k === "app" || k === "id")
      && typeof ref.app === "string" && (PRODUCERS as readonly string[]).includes(ref.app)
      && typeof ref.id === "string" && ref.id.length >= 1;
    if (!ok) errors.push("invalid:instance_ref");
  }

  if (
    errors.length === 0
    && typeof e.event_type === "string"
    && !e.event_type.startsWith(`${e.producer as string}.`)
  ) {
    errors.push("invalid:event_type_producer_mismatch");
  }

  return errors.length === 0
    ? { ok: true, errors, envelope: e as unknown as EnvelopeV1 }
    : { ok: false, errors, envelope: null };
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const parts = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`);
  return `{${parts.join(",")}}`;
}

export const payloadChecksum = (payload: unknown): Promise<string> => sha256Hex(canonicalJson(payload));

export interface CatalogEntry {
  producer: Producer;
  scope: string;
}

const entries = (producer: Producer, scope: string, types: string[]): [string, CatalogEntry][] =>
  types.map((t) => [`${producer}.${t}`, { producer, scope }]);

export const EVENT_CATALOG: Readonly<Record<string, CatalogEntry>> = Object.fromEntries([
  ...entries("autolabels", "vehicle:read", ["vehicle.listed", "vehicle.updated", "vehicle.price_changed", "vehicle.archived", "vehicle.sold"]),
  ...entries("autolabels", "passport:read", ["passport.published", "passport.revoked"]),
  ...entries("autolabels", "market:read", ["market.handoff"]),
  ...entries("autofilm", "inspection:write", ["inspection.completed", "inspection.corrected", "inspection.revoked", "finding.recorded", "finding.corrected"]),
  ...entries("autofilm", "repair:write", ["repair_order.decisions_submitted", "repair.recommended", "repair.approved", "repair.declined", "repair.completed", "repair.completed_verified", "repair.corrected"]),
  ...entries("autofilm", "video:write", ["video.published", "video.revoked"]),
  ...entries("autocurb", "acquisition:write", ["acquisition.recorded", "acquisition.cancelled", "acquisition.confirmed"]),
  ...entries("autocurb", "appraisal:write", ["appraisal.recorded", "appraisal.updated"]),
  ...entries("autocurb", "trade:write", ["trade.captured"]),
  ...entries("autocurb", "valuation:write", ["valuation.updated"]),
  ...entries("autocurb", "inspection:request", ["inspection.requested"]),
]);

export const catalogEntry = (eventType: string): CatalogEntry | null => EVENT_CATALOG[eventType] ?? null;
export const requiredScope = (eventType: string): string | null => catalogEntry(eventType)?.scope ?? null;

// Direction as seen by AutoLabels as the receiving app.
export function inboundDirection(producer: Producer): Direction | null {
  if (producer === "autofilm") return "film_to_labels";
  if (producer === "autocurb") return "curb_to_labels";
  return null;
}

// Direction for AutoLabels events delivered to a connection of the given app.
export function outboundDirection(connectionApp: "autofilm" | "autocurb"): Direction {
  return connectionApp === "autofilm" ? "labels_to_film" : "labels_to_curb";
}
