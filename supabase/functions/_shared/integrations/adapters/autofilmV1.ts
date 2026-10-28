import { payloadChecksum, validateEnvelope, catalogEntry, type EnvelopeV1, type Visibility } from "../envelope.ts";
import {
  deny, MAX_BODY_BYTES,
  type ConnectionRecord, type ExistingReceipt, type HeaderReader, type InboxInsert, type InboxStatus, type IngestDecision,
} from "../ingestDecision.ts";
import { hmacHex, sha256Hex, timingSafeEqualHex } from "../signing.ts";
import { normalizeVin, validateVin } from "../vin.ts";

// Compatibility adapter for AutoFilm's existing webhook protocol. The wire format is
// AutoFilm's, unchanged: x-af-timestamp (ms), x-af-signature = hex HMAC-SHA256(secret,
// `${ts}.${rawBody}`), 5 minute window, body {event, event_id, schema_version, tenant_id, data}.
// Everything is translated into the canonical RooftopOS envelope before it reaches the inbox.

export const AUTOFILM_ADAPTER = "autofilm.v1" as const;
export const AF_WINDOW_MS = 5 * 60 * 1000;
export const AF_SCHEMA_VERSION = "1";

export interface AfEnvelope {
  event: string;
  event_id: string;
  schema_version: string;
  tenant_id: string;
  data: Record<string, unknown>;
}

export const isAutofilmRequest = (headers: HeaderReader): boolean => !!headers.get("x-af-signature");

export const afSign = (secret: string, tsMs: string | number, rawBody: string): Promise<string> =>
  hmacHex(secret, `${tsMs}.${rawBody}`);

export async function afVerify(secret: string, tsMs: string, rawBody: string, presented: string): Promise<boolean> {
  if (!secret || !presented) return false;
  const expected = await afSign(secret, tsMs, rawBody);
  return timingSafeEqualHex(expected, presented.trim().toLowerCase());
}

export const afWithinWindow = (tsMs: number, nowMs: number): boolean =>
  Number.isFinite(tsMs) && Math.abs(nowMs - tsMs) <= AF_WINDOW_MS;

export async function afSignedHeaders(secret: string, rawBody: string, nowMs: number): Promise<Record<string, string>> {
  const ts = String(nowMs);
  return {
    "Content-Type": "application/json",
    "x-af-timestamp": ts,
    "x-af-signature": await afSign(secret, ts, rawBody),
  };
}

export function toAfOutbound(envelope: EnvelopeV1, rooftopRef: string): AfEnvelope {
  return {
    event: envelope.event_type.replace(/^[a-z]+\./, ""),
    event_id: envelope.event_id,
    schema_version: AF_SCHEMA_VERSION,
    tenant_id: rooftopRef,
    data: {
      vin: envelope.vin,
      source_record_id: envelope.source_record_id,
      source_version: envelope.source_version,
      occurred_at: envelope.occurred_at,
      visibility: envelope.visibility,
      evidence_refs: envelope.evidence_refs ?? [],
      payload: envelope.payload,
    },
  };
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return typeof v === "string" && v.trim() ? v.trim() : null;
};
const firstStr = (o: Obj, keys: string[]): string | null => {
  for (const k of keys) {
    const v = str(o[k]);
    if (v) return v;
  }
  return null;
};

export function toEpochMs(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return Math.round(v < 1e11 ? v * 1000 : v);
  if (typeof v === "string" && v.trim()) {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

const PUBLIC_VALUES = new Set(["public", "customer_public", "customer", "published"]);
const SHARED_VALUES = new Set(["shared", "custody", "custody_shared", "dealer_shared", "group", "organization"]);
const PUBLIC_FLAGS = ["is_public", "public", "customer_public", "share_public", "publish_to_customer"];

export interface MappedVisibility {
  stored: "tenant_private" | "custody_shared";
  requested: Visibility;
}

// A public flag only ever raises requested_visibility; the stored visibility never exceeds custody_shared.
export function mapAfVisibility(data: Obj): MappedVisibility {
  const raw = typeof data.visibility === "string" ? data.visibility.trim().toLowerCase() : "";
  const publicRequested = PUBLIC_VALUES.has(raw) || PUBLIC_FLAGS.some((k) => data[k] === true);
  const shared = SHARED_VALUES.has(raw);
  return {
    stored: shared ? "custody_shared" : "tenant_private",
    requested: publicRequested ? "customer_public" : shared ? "custody_shared" : "tenant_private",
  };
}

export const AF_INBOUND_EVENTS = ["mpi.report.published", "mpi.customer.decisions.submitted"] as const;
// Emitted by AutoFilm but with no Phase 1 consumer (metadata only: video_id, message_id, length).
export const AF_IGNORED_EVENTS = ["mpi.customer.message.created"] as const;

interface AfContext {
  connection: Pick<ConnectionRecord, "id" | "tenant_id" | "scopes">;
  headerTsMs: number;
  resolveVin?: (connectionId: string, tenantId: string, roIds: string[]) => Promise<string | null>;
}

type Translation =
  | { ok: true; envelopes: EnvelopeV1[]; visibility: MappedVisibility; vinResolved: boolean }
  | { ok: false; httpStatus: 400 | 403 | 422; code: "schema_invalid" | "scope_or_tenant_denied" | "rejected"; detail: string[] };

const fail = (
  httpStatus: 400 | 403 | 422,
  code: "schema_invalid" | "scope_or_tenant_denied" | "rejected",
  ...detail: string[]
): Translation => ({ ok: false, httpStatus, code, detail });

const uuidFrom = async (seed: string): Promise<string> => {
  const h = await sha256Hex(seed);
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

function findingIds(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out: string[] = [];
  for (const el of v) {
    const id = isObj(el) ? firstStr(el, ["finding_id", "recommendation_id", "id"]) : str(el);
    if (!id) return null;
    out.push(id);
  }
  return out;
}

const count = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);

// Placeholder used only to validate the envelope shape when the VIN is not yet known.
const UNRESOLVED_VIN_PLACEHOLDER = "1HGCM82633A004352";

export async function translateAutofilm(af: AfEnvelope, ctx: AfContext): Promise<Translation> {
  const data = af.data;
  const event = af.event;
  if (!(AF_INBOUND_EVENTS as readonly string[]).includes(event)) return fail(422, "rejected", "unknown_event");

  const roId = firstStr(data, ["ro_id"]);
  const externalRoId = firstStr(data, ["external_ro_id"]);
  const roKey = roId ?? externalRoId;
  if (!roKey) return fail(400, "schema_invalid", "ro_missing");
  const mapped = mapAfVisibility(data);

  // A VIN in the payload is optional (AutoFilm does not send one today). An unusable VIN is treated as absent.
  let vin = "";
  const given = normalizeVin(data.vin);
  if (given && /^[A-HJ-NPR-Z0-9]{17}$/.test(given)) vin = given;
  if (!vin && ctx.resolveVin) {
    const ids = [...new Set([roId, externalRoId].filter((x): x is string => !!x))];
    const found = normalizeVin(await ctx.resolveVin(ctx.connection.id, ctx.connection.tenant_id, ids));
    if (found) vin = found;
  }

  let versionMs: number | null = null;
  for (const k of ["updated_at", "decided_at", "submitted_at", "published_at"]) {
    versionMs = toEpochMs(data[k]);
    if (versionMs) break;
  }
  const version = versionMs ?? ctx.headerTsMs;

  type Item = { type: string; record: string; payload: Obj };
  const items: Item[] = [];

  if (event === "mpi.report.published") {
    items.push({
      type: "inspection.completed",
      record: `inspection:${roKey}`,
      payload: {
        ro_key: roKey,
        ro_number: str(data.ro_number),
        inspection_status: "completed",
        odometer_miles: null,
        measurements: {},
        technician_verified: false,
      },
    });
  } else {
    const authorization = firstStr(data, ["authorization_id"]);
    const idsA = findingIds(data.approved_ids) ?? findingIds(data.approved);
    const idsD = findingIds(data.declined_ids) ?? findingIds(data.declined);
    const a = count(data.approved) ?? idsA?.length ?? null;
    const d = count(data.declined) ?? idsD?.length ?? null;
    if (a === null || d === null) return fail(400, "schema_invalid", "decision_counts_invalid");
    items.push({
      type: "repair_order.decisions_submitted",
      record: `ro:${roKey}:decisions`,
      payload: {
        ro_key: roKey,
        approved_count: a,
        declined_count: d,
        total: typeof data.total === "number" && Number.isFinite(data.total) ? data.total : null,
        authorization_id: authorization,
      },
    });
    if (idsA && idsD) {
      if (idsA.some((id) => idsD.includes(id))) return fail(422, "rejected", "decision_conflict");
      for (const [ids, type, status] of [[idsA, "repair.approved", "approved"], [idsD, "repair.declined", "declined"]] as const) {
        for (const fid of [...new Set(ids)]) {
          items.push({
            type,
            record: `finding:${roKey}:${fid}`,
            payload: { finding_id: fid, ro_key: roKey, status, authorization_id: authorization },
          });
        }
      }
    }
  }

  const sentAt = new Date(ctx.headerTsMs).toISOString();
  const occurredAt = new Date(version).toISOString();
  const envelopes: EnvelopeV1[] = [];
  for (const item of items) {
    const eventType = `autofilm.${item.type}`;
    const entry = catalogEntry(eventType);
    if (!entry) return fail(422, "rejected", "unknown_event");
    if (!ctx.connection.scopes.includes(entry.scope)) return fail(403, "scope_or_tenant_denied", "scope_missing");
    const payload = { ...item.payload, af_schema_version: AF_SCHEMA_VERSION };
    const envelope: EnvelopeV1 = {
      event_id: await uuidFrom(`${ctx.connection.id}\n${af.event_id}\n${item.record}`),
      event_type: eventType,
      schema_version: "1.0.0",
      producer: "autofilm",
      source_record_id: item.record,
      source_version: version,
      idempotency_key: `autofilm.v1:${(await sha256Hex(`${af.event_id}\n${item.record}`)).slice(0, 40)}`,
      correlation_id: `af:${af.event_id}`.slice(0, 256),
      causation_id: null,
      occurred_at: occurredAt,
      observed_at: null,
      sent_at: sentAt,
      vin: vin || UNRESOLVED_VIN_PLACEHOLDER,
      tenant_ref: `rooftop:${af.tenant_id}`.slice(0, 256),
      instance_ref: null,
      visibility: mapped.requested,
      evidence_refs: [],
      payload,
    };
    envelope.payload_checksum = await payloadChecksum(payload);
    const check = validateEnvelope(envelope);
    if (!check.ok) return fail(400, "schema_invalid", ...check.errors.slice(0, 5));
    if (!vin) envelope.vin = "";
    envelopes.push(envelope);
  }
  return { ok: true, envelopes, visibility: mapped, vinResolved: !!vin };
}

export interface AfSecret {
  key_id: string;
  secret: string;
}

export interface AfIngestInput {
  headers: HeaderReader;
  rawBody: string;
  nowMs: number;
  connection: ConnectionRecord | null;
  secrets: AfSecret[];
  existingByEventId: ExistingReceipt | null;
  existingByIdempotencyKey: ExistingReceipt | null;
  directionEnabled: boolean;
  resolveVin?: AfContext["resolveVin"];
}

export interface AfIngestDecision extends IngestDecision {
  inserts: InboxInsert[];
}

const withInserts = (d: IngestDecision, inserts: InboxInsert[] = []): AfIngestDecision => ({ ...d, inserts });

export async function decideAutofilmIngest(input: AfIngestInput): Promise<AfIngestDecision> {
  const { connection } = input;
  const tsRaw = input.headers.get("x-af-timestamp");
  const signature = input.headers.get("x-af-signature");

  if (
    !connection || connection.status !== "active" || connection.adapter !== AUTOFILM_ADAPTER
    || !connection.external_rooftop_ref || !tsRaw || !signature || input.secrets.length === 0
  ) return withInserts(deny(401, "signature_invalid", ["credentials"]));

  if (!/^\d{1,16}$/.test(tsRaw) || !afWithinWindow(Number(tsRaw), input.nowMs)) {
    return withInserts(deny(401, "signature_invalid", ["timestamp"]));
  }
  let verified = false;
  for (const s of input.secrets) {
    if (await afVerify(s.secret, tsRaw, input.rawBody, signature)) verified = true;
  }
  if (!verified) return withInserts(deny(401, "signature_invalid", ["signature"]));

  if (input.rawBody.length > MAX_BODY_BYTES) return withInserts(deny(400, "schema_invalid", ["body_too_large"]));
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.rawBody);
  } catch {
    return withInserts(deny(400, "schema_invalid", ["invalid_json"]));
  }
  if (
    !isObj(parsed) || typeof parsed.event !== "string" || !parsed.event || parsed.event.length > 100
    || str(parsed.event_id) === null || !isObj(parsed.data) || typeof parsed.schema_version !== "string"
  ) return withInserts(deny(400, "schema_invalid", ["af_envelope_shape"]));
  if (parsed.schema_version !== AF_SCHEMA_VERSION) {
    return withInserts(deny(400, "schema_invalid", ["unsupported_schema_version"]));
  }

  // The body never names the tenant. It may only repeat the rooftop this connection is bound to.
  const claimed = str(parsed.tenant_id);
  const dataRooftop = str((parsed.data as Obj).rooftop_id);
  if (
    claimed !== connection.external_rooftop_ref
    || (dataRooftop !== null && dataRooftop !== connection.external_rooftop_ref)
  ) return withInserts(deny(403, "scope_or_tenant_denied", ["rooftop_mismatch"]));

  const af: AfEnvelope = {
    event: parsed.event,
    event_id: str(parsed.event_id) as string,
    schema_version: parsed.schema_version,
    tenant_id: claimed,
    data: parsed.data as Obj,
  };
  if ((AF_IGNORED_EVENTS as readonly string[]).includes(af.event)) {
    return withInserts({ httpStatus: 200, code: "ignored", detail: ["event_not_consumed"], insert: null, duplicateOf: null });
  }
  const translation = await translateAutofilm(af, {
    connection,
    headerTsMs: Number(tsRaw),
    resolveVin: input.resolveVin,
  });
  if (!translation.ok) return withInserts(deny(translation.httpStatus, translation.code, translation.detail));

  const first = translation.envelopes[0];
  const byEvent = input.existingByEventId;
  if (byEvent) {
    return withInserts(
      byEvent.payload_checksum === first.payload_checksum
        ? { httpStatus: 200, code: "duplicate", detail: [], insert: null, duplicateOf: byEvent }
        : deny(409, "idempotency_conflict", ["event_id_reused"]),
    );
  }
  const byKey = input.existingByIdempotencyKey;
  if (byKey) {
    return withInserts(
      byKey.payload_checksum === first.payload_checksum
        ? { httpStatus: 200, code: "duplicate", detail: [], insert: null, duplicateOf: byKey }
        : deny(409, "idempotency_conflict", ["idempotency_key_reused"]),
    );
  }

  const status: InboxStatus = !translation.vinResolved ? "unmatched" : input.directionEnabled ? "received" : "held";
  const inserts: InboxInsert[] = translation.envelopes.map((envelope) => ({
    connection_id: connection.id,
    tenant_id: connection.tenant_id,
    producer: "autofilm",
    event_id: envelope.event_id,
    event_type: envelope.event_type,
    schema_version: envelope.schema_version,
    idempotency_key: envelope.idempotency_key,
    payload_checksum: envelope.payload_checksum as string,
    source_record_id: envelope.source_record_id,
    source_version: envelope.source_version,
    vin: envelope.vin || null,
    adapter: AUTOFILM_ADAPTER,
    visibility: translation.visibility.stored,
    requested_visibility: translation.visibility.requested,
    envelope,
    status,
  }));
  return { httpStatus: 202, code: status, detail: status === "unmatched" ? ["vin_unresolved"] : [], duplicateOf: null, insert: inserts[0], inserts };
}
