// RooftopOS Gateway Interoperability Protocol rtgip/2.
// This file is shared byte-for-byte by AutoLabels, AutoCurb and the AutoFrame handoff.
// Pure: WebCrypto only, no network, no database, no secrets. Transport is hard OFF.

export const PROTOCOL = "rtgip/2" as const;
export const SIGNATURE_PREFIX = "rtgip2=";
export const MAX_SKEW_SECONDS = 300;
export const NONCE_TTL_SECONDS = 900;
export const MAX_BODY_BYTES = 64 * 1024;
export const RTGIP_TRANSPORT_ENABLED = false as const;

export type AppId = "autolabels" | "autocurb" | "autoframe" | "autofilm";
export type Signer = AppId | "gateway";
export const APPS: readonly AppId[] = ["autolabels", "autocurb", "autoframe", "autofilm"];

export type Purpose =
  | "inventory_sync"
  | "custody_evidence"
  | "acquisition_evidence"
  | "media_reference"
  | "service_evidence";

export type Domain =
  | "identity"
  | "inventory"
  | "listing"
  | "custody"
  | "sale"
  | "appraisal"
  | "acquisition"
  | "media"
  | "service";

export type EventType =
  | "vehicle.identity_registered"
  | "inventory.status_changed"
  | "listing.availability_changed"
  | "listing.price_published"
  | "custody.episode_opened"
  | "custody.episode_closed"
  | "sale.milestone_recorded"
  | "appraisal.completed"
  | "acquisition.milestone_recorded"
  | "acquisition.purchase_completed"
  | "media.approved"
  | "media.revoked"
  | "service.mpi_verified"
  | "service.repair_verified";

// ---------------------------------------------------------------------------
// Event catalog: owner app is the only source authority for an event type.
// ---------------------------------------------------------------------------

type FieldType =
  | "string"
  | "int"
  | "bool"
  | "iso"
  | "sha256"
  | "ref"
  | "refs"
  | "true"
  | "false"
  | { enum: readonly string[] }
  | { object: Record<string, FieldSpec> };
interface FieldSpec {
  type: FieldType;
  optional?: boolean;
  nullable?: boolean;
}

export interface EventSpec {
  owner: AppId;
  domain: Domain;
  aggregate_type: string;
  schema_versions: readonly number[];
  requires_service_visit?: boolean;
  payload: Record<string, FieldSpec>;
}

const f = (type: FieldType, extra: Partial<FieldSpec> = {}): FieldSpec => ({ type, ...extra });

export const EVENT_CATALOG: Record<EventType, EventSpec> = {
  "vehicle.identity_registered": {
    owner: "autolabels",
    domain: "identity",
    aggregate_type: "vehicle_instance",
    schema_versions: [2],
    payload: {
      stock_number: f("string"),
      year: f("int"),
      make: f("string"),
      model: f("string"),
      trim: f("string", { nullable: true }),
      registered_at: f("iso"),
    },
  },
  "inventory.status_changed": {
    owner: "autolabels",
    domain: "inventory",
    aggregate_type: "episode",
    schema_versions: [2],
    payload: {
      status: f({
        enum: [
          "in_stock",
          "in_recon",
          "frontline",
          "pending_sale",
          "sold",
          "delivered",
          "wholesale",
          "archived",
        ],
      }),
      stock_number: f("string"),
      changed_at: f("iso"),
    },
  },
  "listing.availability_changed": {
    owner: "autolabels",
    domain: "listing",
    aggregate_type: "listing",
    schema_versions: [2],
    payload: {
      available: f("bool"),
      passport_ref: f("ref", { nullable: true }),
      changed_at: f("iso"),
    },
  },
  "listing.price_published": {
    owner: "autolabels",
    domain: "listing",
    aggregate_type: "listing",
    schema_versions: [2],
    payload: {
      price_context: f({ enum: ["advertised"] }),
      vehicle_selling_price_cents: f("int"),
      doc_fee_cents: f("int"),
      total_advertised_price_cents: f("int"),
      published_at: f("iso"),
    },
  },
  "custody.episode_opened": {
    owner: "autolabels",
    domain: "custody",
    aggregate_type: "episode",
    schema_versions: [2],
    payload: {
      episode_kind: f({ enum: ["inventory"] }),
      opened_reason: f({
        enum: ["acquisition", "trade_in", "transfer_in", "reappearance_reviewed"],
      }),
      predecessor_episode_id: f("ref", { nullable: true }),
      opened_at: f("iso"),
    },
  },
  "custody.episode_closed": {
    owner: "autolabels",
    domain: "custody",
    aggregate_type: "episode",
    schema_versions: [2],
    payload: {
      closed_reason: f({ enum: ["sold_delivered", "wholesaled", "transferred_out", "archived"] }),
      closed_at: f("iso"),
    },
  },
  "sale.milestone_recorded": {
    owner: "autolabels",
    domain: "sale",
    aggregate_type: "episode",
    schema_versions: [2],
    payload: {
      milestone: f({ enum: ["sold", "delivered", "sale_voided"] }),
      recorded_at: f("iso"),
      verified: f("true"),
      audit_ref: f("ref"),
    },
  },
  "appraisal.completed": {
    owner: "autocurb",
    domain: "appraisal",
    aggregate_type: "appraisal",
    schema_versions: [2],
    payload: {
      verified_state: f({ enum: ["finalized"] }),
      appraisal_ref: f("ref"),
      verified_by_ref: f("ref"),
      finalized_at: f("iso"),
      audit_ref: f("ref"),
    },
  },
  "acquisition.milestone_recorded": {
    owner: "autocurb",
    domain: "acquisition",
    aggregate_type: "acquisition",
    schema_versions: [2],
    payload: {
      milestone: f({
        enum: [
          "offer_accepted",
          "deal_finalized",
          "title_ownership_verified",
          "check_request_submitted",
        ],
      }),
      custody_transferred: f("false"),
      recorded_at: f("iso"),
      audit_ref: f("ref"),
    },
  },
  "acquisition.purchase_completed": {
    owner: "autocurb",
    domain: "acquisition",
    aggregate_type: "acquisition",
    schema_versions: [2],
    payload: {
      purchase_ref: f("ref"),
      custody_transferred: f("true"),
      custody_at: f("iso"),
      verified_by_ref: f("ref"),
      audit_ref: f("ref"),
      ownership_evidence_refs: f("refs"),
      condition_evidence_refs: f("refs"),
    },
  },
  "media.approved": {
    owner: "autoframe",
    domain: "media",
    aggregate_type: "media",
    schema_versions: [2],
    payload: {
      media_id: f("ref"),
      rendition_id: f("ref"),
      width: f("int"),
      height: f("int"),
      orientation: f({ enum: ["landscape", "portrait", "square"] }),
      storage_ref: f({ object: { bucket: f("ref"), object_key: f("string") } }),
      content_sha256: f("sha256"),
      approval_audit_ref: f("ref"),
      approved_by_ref: f("ref"),
      preset_key: f("ref"),
      preset_version: f("int"),
      media_order: f("int"),
      shot_type: f("ref"),
      approved_at: f("iso"),
      /** Required by consumers when this media was previously revoked (audited reinstatement). */
      reinstatement_audit_ref: f("ref", { optional: true }),
    },
  },
  "media.revoked": {
    owner: "autoframe",
    domain: "media",
    aggregate_type: "media",
    schema_versions: [2],
    payload: {
      media_id: f("ref"),
      reason: f({
        enum: ["withdrawn", "rejected_after_approval", "rights_revoked", "vehicle_sold_cleanup"],
      }),
      revoked_at: f("iso"),
      revocation_audit_ref: f("ref"),
    },
  },
  "service.mpi_verified": {
    owner: "autofilm",
    domain: "service",
    aggregate_type: "service_visit",
    schema_versions: [2],
    requires_service_visit: true,
    payload: {
      ro_ref: f("ref"),
      technician_verified: f("true"),
      verified_by_ref: f("ref"),
      verified_at: f("iso"),
      evidence_refs: f("refs"),
    },
  },
  "service.repair_verified": {
    owner: "autofilm",
    domain: "service",
    aggregate_type: "service_visit",
    schema_versions: [2],
    requires_service_visit: true,
    payload: {
      ro_ref: f("ref"),
      repair_ref: f("ref"),
      verified_by_ref: f("ref"),
      verified_at: f("iso"),
      evidence_refs: f("refs"),
    },
  },
};

// ---------------------------------------------------------------------------
// Route registry: 12 directed routes. Six are this phase; six (AutoFilm) are reserved
// and always deny until a separate approved round activates them.
// ---------------------------------------------------------------------------

export type RouteId = `${AppId}->${AppId}`;
export interface RouteSpec {
  id: RouteId;
  source: AppId;
  target: AppId;
  phase: "three_app" | "reserved_autofilm";
  events: Partial<Record<EventType, readonly Purpose[]>>;
}

const LABELS_IDENTITY: Partial<Record<EventType, readonly Purpose[]>> = {
  "vehicle.identity_registered": ["inventory_sync"],
  "inventory.status_changed": ["inventory_sync"],
  "custody.episode_opened": ["custody_evidence"],
  "custody.episode_closed": ["custody_evidence"],
  "sale.milestone_recorded": ["custody_evidence"],
};

export const ROUTES: readonly RouteSpec[] = [
  {
    id: "autolabels->autocurb",
    source: "autolabels",
    target: "autocurb",
    phase: "three_app",
    events: { ...LABELS_IDENTITY, "listing.price_published": ["inventory_sync"] },
  },
  {
    id: "autocurb->autolabels",
    source: "autocurb",
    target: "autolabels",
    phase: "three_app",
    events: {
      "appraisal.completed": ["acquisition_evidence"],
      "acquisition.milestone_recorded": ["acquisition_evidence"],
      "acquisition.purchase_completed": ["acquisition_evidence", "custody_evidence"],
    },
  },
  {
    id: "autolabels->autoframe",
    source: "autolabels",
    target: "autoframe",
    phase: "three_app",
    events: { ...LABELS_IDENTITY, "listing.availability_changed": ["inventory_sync"] },
  },
  {
    id: "autoframe->autolabels",
    source: "autoframe",
    target: "autolabels",
    phase: "three_app",
    events: { "media.approved": ["media_reference"], "media.revoked": ["media_reference"] },
  },
  {
    id: "autocurb->autoframe",
    source: "autocurb",
    target: "autoframe",
    phase: "three_app",
    events: {
      "appraisal.completed": ["acquisition_evidence"],
      "acquisition.purchase_completed": ["acquisition_evidence"],
    },
  },
  {
    id: "autoframe->autocurb",
    source: "autoframe",
    target: "autocurb",
    phase: "three_app",
    events: { "media.approved": ["media_reference"], "media.revoked": ["media_reference"] },
  },
  {
    id: "autofilm->autolabels",
    source: "autofilm",
    target: "autolabels",
    phase: "reserved_autofilm",
    events: {},
  },
  {
    id: "autolabels->autofilm",
    source: "autolabels",
    target: "autofilm",
    phase: "reserved_autofilm",
    events: {},
  },
  {
    id: "autofilm->autocurb",
    source: "autofilm",
    target: "autocurb",
    phase: "reserved_autofilm",
    events: {},
  },
  {
    id: "autocurb->autofilm",
    source: "autocurb",
    target: "autofilm",
    phase: "reserved_autofilm",
    events: {},
  },
  {
    id: "autofilm->autoframe",
    source: "autofilm",
    target: "autoframe",
    phase: "reserved_autofilm",
    events: {},
  },
  {
    id: "autoframe->autofilm",
    source: "autoframe",
    target: "autofilm",
    phase: "reserved_autofilm",
    events: {},
  },
];

// Frozen for the future AutoFilm round. Not consulted by authorize() in this phase.
export const RESERVED_AUTOFILM_EVENTS: Partial<
  Record<RouteId, Partial<Record<EventType, readonly Purpose[]>>>
> = {
  "autofilm->autolabels": {
    "service.mpi_verified": ["service_evidence"],
    "service.repair_verified": ["service_evidence"],
  },
  "autofilm->autocurb": { "service.mpi_verified": ["service_evidence"] },
  "autofilm->autoframe": {},
  "autolabels->autofilm": { ...LABELS_IDENTITY },
  "autocurb->autofilm": { "acquisition.purchase_completed": ["acquisition_evidence"] },
  "autoframe->autofilm": {
    "media.approved": ["media_reference"],
    "media.revoked": ["media_reference"],
  },
};

export const routeFor = (source: string, target: string): RouteSpec | undefined =>
  ROUTES.find((r) => r.source === source && r.target === target);

// ---------------------------------------------------------------------------
// Canonical JSON (RFC 8785 style for the value space this protocol allows:
// objects, arrays, strings, booleans, null, safe integers). Floats are refused.
// ---------------------------------------------------------------------------

export class ProtocolError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

export function canonicalize(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new ProtocolError("non_integer_number");
    return String(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj)
      .filter((k) => obj[k] !== undefined)
      .sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(",")}}`;
  }
  throw new ProtocolError("unsupported_json_value");
}

const enc = new TextEncoder();
const hex = (buf: ArrayBuffer): string =>
  Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === "string" ? enc.encode(data) : data;
  return hex(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
}

export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
}

export function timingSafeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

export interface VehicleRef {
  vin: string;
  instance_id: string;
  episode_id: string;
  service_visit_id?: string | null;
}
export interface AggregateRef {
  domain: Domain;
  type: string;
  id: string;
  revision: number;
  prev_revision: number | null;
}
export interface OriginRef {
  app: AppId;
  event_id: string;
  revision: number;
}

export interface EnvelopeV2 {
  protocol: typeof PROTOCOL;
  schema_version: number;
  event_id: string;
  event_type: EventType;
  source_app: AppId;
  target_app: AppId;
  route: RouteId;
  purpose: Purpose;
  tenant_id: string;
  rooftop_id: string;
  vehicle: VehicleRef;
  aggregate: AggregateRef;
  origin: OriginRef;
  correlation_id: string;
  causation_id: string | null;
  occurred_at: string;
  emitted_at: string;
  classification: "shared_vehicle_fact" | "shared_media_meta";
  payload_sha256: string;
  payload: Record<string, unknown>;
}

const ENVELOPE_KEYS = [
  "protocol",
  "schema_version",
  "event_id",
  "event_type",
  "source_app",
  "target_app",
  "route",
  "purpose",
  "tenant_id",
  "rooftop_id",
  "vehicle",
  "aggregate",
  "origin",
  "correlation_id",
  "causation_id",
  "occurred_at",
  "emitted_at",
  "classification",
  "payload_sha256",
  "payload",
] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REF = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const VIN = /^[A-HJ-NPR-Z0-9]{17}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;
const SHA = /^[0-9a-f]{64}$/;
const NONCE = /^[A-Za-z0-9_-]{16,128}$/;

// Keys that may never appear anywhere in a shared envelope, at any depth. Confidential
// valuation, finance, customer PII, and anything that would expose media bytes or links.
export const FORBIDDEN_KEYS: ReadonlySet<string> = new Set([
  "acv",
  "acv_value",
  "acv_cents",
  "appraised_acv",
  "appraised_value",
  "offered_price",
  "offer_price",
  "offer_amount",
  "current_offer",
  "final_offer",
  "estimated_offer",
  "estimated_offer_high",
  "estimated_offer_low",
  "dealer_cost",
  "cost",
  "unit_cost",
  "invoice_price",
  "purchase_price",
  "purchase_amount",
  "check_amount",
  "payoff_amount",
  "lien_amount",
  "finance_amount",
  "amount_financed",
  "apr",
  "down_payment",
  "monthly_payment",
  "trade_profit",
  "gross_profit",
  "holdback",
  "pack",
  "reserve",
  "recon_cost",
  "name",
  "first_name",
  "last_name",
  "full_name",
  "customer_name",
  "email",
  "phone",
  "phone_e164",
  "mobile",
  "address",
  "street",
  "city",
  "zip",
  "postal_code",
  "ssn",
  "dob",
  "date_of_birth",
  "drivers_license",
  "dl_number",
  "customer_id",
  "lead_id",
  "submission_id",
  "token",
  "access_token",
  "signed_url",
  "public_url",
  "url",
  "image_url",
  "photo_url",
  "image_bytes",
  "bytes",
  "base64",
  "blob",
  "data_uri",
]);
const URL_LIKE = /^(https?:|data:|blob:|ftp:)/i;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE = /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/;
const SSN = /\b\d{3}-\d{2}-\d{4}\b/;

export function scanSensitive(value: unknown, path = "$"): string[] {
  const hits: string[] = [];
  if (typeof value === "string") {
    if (URL_LIKE.test(value)) hits.push(`${path}:url`);
    if (EMAIL.test(value)) hits.push(`${path}:email`);
    if (PHONE.test(value)) hits.push(`${path}:phone`);
    if (SSN.test(value)) hits.push(`${path}:ssn`);
    if (value.length > 4096) hits.push(`${path}:oversize`);
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => hits.push(...scanSensitive(v, `${path}[${i}]`)));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN_KEYS.has(k.toLowerCase())) hits.push(`${path}.${k}:forbidden_key`);
      hits.push(...scanSensitive(v, `${path}.${k}`));
    }
  }
  return hits;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === "object" && !Array.isArray(v);

function checkField(spec: FieldSpec, v: unknown, path: string, errs: string[]): void {
  if (v === undefined) {
    if (!spec.optional) errs.push(`missing:${path}`);
    return;
  }
  if (v === null) {
    if (!spec.nullable) errs.push(`null:${path}`);
    return;
  }
  const t = spec.type;
  const bad = () => errs.push(`invalid:${path}`);
  if (t === "string") {
    if (typeof v !== "string" || v.length < 1 || v.length > 256) bad();
  } else if (t === "int") {
    if (!Number.isSafeInteger(v) || (v as number) < 0) bad();
  } else if (t === "bool") {
    if (typeof v !== "boolean") bad();
  } else if (t === "true") {
    if (v !== true) bad();
  } else if (t === "false") {
    if (v !== false) bad();
  } else if (t === "iso") {
    if (typeof v !== "string" || !ISO.test(v) || Number.isNaN(Date.parse(v))) bad();
  } else if (t === "sha256") {
    if (typeof v !== "string" || !SHA.test(v)) bad();
  } else if (t === "ref") {
    if (typeof v !== "string" || !REF.test(v)) bad();
  } else if (t === "refs") {
    if (!Array.isArray(v) || v.length > 50 || !v.every((x) => typeof x === "string" && REF.test(x)))
      bad();
  } else if ("enum" in t) {
    if (typeof v !== "string" || !t.enum.includes(v)) bad();
  } else if ("object" in t) {
    if (!isObj(v)) {
      bad();
      return;
    }
    for (const k of Object.keys(v)) if (!(k in t.object)) errs.push(`unknown_field:${path}.${k}`);
    for (const [k, s] of Object.entries(t.object)) checkField(s, v[k], `${path}.${k}`, errs);
  }
}

type Loose<K extends string> = { [P in K]?: unknown };
type LooseEnvelope = Loose<(typeof ENVELOPE_KEYS)[number]>;

// PostgreSQL jsonb cannot store U+0000 or a lone surrogate, so an envelope carrying one would
// fail at the inbox insert and retry into a dead letter instead of being refused at the edge.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const unstorable = (s: string) => s.includes("\u0000") || LONE_SURROGATE.test(s);
function hasUnstorableText(v: unknown): boolean {
  if (typeof v === "string") return unstorable(v);
  if (Array.isArray(v)) return v.some(hasUnstorableText);
  if (isObj(v)) return Object.entries(v).some(([k, x]) => unstorable(k) || hasUnstorableText(x));
  return false;
}

export function validateEnvelope(
  input: unknown,
): { ok: true; envelope: EnvelopeV2 } | { ok: false; errors: string[] } {
  if (!isObj(input)) return { ok: false, errors: ["not_an_object"] };
  if (hasUnstorableText(input)) return { ok: false, errors: ["invalid_unicode"] };
  const e = input as LooseEnvelope;
  const errs: string[] = [];
  for (const k of Object.keys(e))
    if (!(ENVELOPE_KEYS as readonly string[]).includes(k)) errs.push(`unknown_field:${k}`);
  for (const k of ENVELOPE_KEYS) if (e[k] === undefined) errs.push(`missing:${k}`);
  if (errs.length) return { ok: false, errors: errs };
  if (e.protocol !== PROTOCOL) return { ok: false, errors: ["protocol_mismatch"] };
  const spec = EVENT_CATALOG[e.event_type as EventType];
  if (!spec) return { ok: false, errors: ["unsupported_event_type"] };
  if (!spec.schema_versions.includes(e.schema_version as number))
    return { ok: false, errors: ["unsupported_schema_version"] };
  if (typeof e.event_id !== "string" || !UUID.test(e.event_id)) errs.push("invalid:event_id");
  if (!APPS.includes(e.source_app as AppId)) errs.push("invalid:source_app");
  if (!APPS.includes(e.target_app as AppId)) errs.push("invalid:target_app");
  if (e.source_app === e.target_app) errs.push("invalid:self_route");
  if (e.route !== `${String(e.source_app)}->${String(e.target_app)}`) errs.push("invalid:route");
  for (const k of ["tenant_id", "rooftop_id", "correlation_id"] as const) {
    if (typeof e[k] !== "string" || !REF.test(e[k] as string)) errs.push(`invalid:${k}`);
  }
  if (e.causation_id !== null && (typeof e.causation_id !== "string" || !REF.test(e.causation_id)))
    errs.push("invalid:causation_id");
  for (const k of ["occurred_at", "emitted_at"] as const) {
    if (typeof e[k] !== "string" || !ISO.test(e[k] as string)) errs.push(`invalid:${k}`);
  }
  if (!["shared_vehicle_fact", "shared_media_meta"].includes(e.classification as string))
    errs.push("invalid:classification");
  if (spec.domain === "media" && e.classification !== "shared_media_meta")
    errs.push("invalid:classification");
  if (spec.domain !== "media" && e.classification !== "shared_vehicle_fact")
    errs.push("invalid:classification");
  if (typeof e.payload_sha256 !== "string" || !SHA.test(e.payload_sha256))
    errs.push("invalid:payload_sha256");

  const v = e.vehicle as
    Loose<"vin" | "instance_id" | "episode_id" | "service_visit_id"> | undefined;
  if (!isObj(v)) errs.push("invalid:vehicle");
  else {
    for (const k of Object.keys(v))
      if (!["vin", "instance_id", "episode_id", "service_visit_id"].includes(k))
        errs.push(`unknown_field:vehicle.${k}`);
    if (typeof v.vin !== "string" || !VIN.test(v.vin)) errs.push("invalid:vehicle.vin");
    if (typeof v.instance_id !== "string" || !REF.test(v.instance_id))
      errs.push("invalid:vehicle.instance_id");
    if (typeof v.episode_id !== "string" || !REF.test(v.episode_id))
      errs.push("invalid:vehicle.episode_id");
    const sv = v.service_visit_id;
    if (spec.requires_service_visit) {
      if (typeof sv !== "string" || !REF.test(sv)) errs.push("missing:vehicle.service_visit_id");
    } else if (sv !== undefined && sv !== null) errs.push("invalid:vehicle.service_visit_id");
  }
  const a = e.aggregate as
    Loose<"domain" | "type" | "id" | "revision" | "prev_revision"> | undefined;
  if (!isObj(a)) errs.push("invalid:aggregate");
  else {
    for (const k of Object.keys(a))
      if (!["domain", "type", "id", "revision", "prev_revision"].includes(k))
        errs.push(`unknown_field:aggregate.${k}`);
    if (a.domain !== spec.domain) errs.push("invalid:aggregate.domain");
    if (a.type !== spec.aggregate_type) errs.push("invalid:aggregate.type");
    if (typeof a.id !== "string" || !REF.test(a.id)) errs.push("invalid:aggregate.id");
    if (!Number.isSafeInteger(a.revision) || (a.revision as number) < 1)
      errs.push("invalid:aggregate.revision");
    if (
      a.prev_revision !== null &&
      (!Number.isSafeInteger(a.prev_revision) ||
        (a.prev_revision as number) < 1 ||
        (a.prev_revision as number) >= (a.revision as number))
    )
      errs.push("invalid:aggregate.prev_revision");
  }
  const o = e.origin as Loose<"app" | "event_id" | "revision"> | undefined;
  if (
    !isObj(o) ||
    Object.keys(o).some((k) => !["app", "event_id", "revision"].includes(k)) ||
    o.app !== e.source_app ||
    typeof o.event_id !== "string" ||
    !REF.test(o.event_id) ||
    !Number.isSafeInteger(o.revision) ||
    (o.revision as number) < 1
  )
    errs.push("invalid:origin");
  if (!isObj(e.payload)) errs.push("invalid:payload");
  else {
    for (const k of Object.keys(e.payload))
      if (!(k in spec.payload)) errs.push(`unknown_field:payload.${k}`);
    for (const [k, s] of Object.entries(spec.payload))
      checkField(s, e.payload[k], `payload.${k}`, errs);
  }
  for (const hit of scanSensitive(e)) errs.push(`sensitive:${hit}`);
  if (errs.length) return { ok: false, errors: errs };
  return { ok: true, envelope: e as unknown as EnvelopeV2 };
}

export async function payloadHash(payload: Record<string, unknown>): Promise<string> {
  return sha256Hex(canonicalize(payload));
}

export const EVENT_ID_DERIVATION = "rtgip/2-event/v2" as const;

export interface EventIdScope {
  source_app: AppId;
  tenant_id: string;
  rooftop_id: string;
  instance_id: string;
  episode_id: string;
  origin_event_id: string;
  route: RouteId | string;
}

/**
 * Deterministic event id. Version 2 binds the id to the source namespace, tenant, rooftop,
 * vehicle instance and episode as well as the origin event and route, so the same origin id
 * reused by another dealership, rooftop or episode can never collide. The canonical array
 * encoding keeps the fields unambiguous. A producer that rebuilds an event after a crash
 * gets the same id, so the outbox dedupes it.
 */
export async function deriveEventId(s: EventIdScope): Promise<string> {
  const h = await sha256Hex(
    canonicalize([
      EVENT_ID_DERIVATION,
      s.source_app,
      s.tenant_id,
      s.rooftop_id,
      s.instance_id,
      s.episode_id,
      s.origin_event_id,
      s.route,
    ]),
  );
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h.charAt(16), 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export const eventIdScopeOf = (e: Omit<EnvelopeV2, "payload_sha256">): EventIdScope => ({
  source_app: e.source_app,
  tenant_id: e.tenant_id,
  rooftop_id: e.rooftop_id,
  instance_id: e.vehicle.instance_id,
  episode_id: e.vehicle.episode_id,
  origin_event_id: e.origin.event_id,
  route: e.route,
});

/**
 * Fill payload_sha256 and the derived event id, and return the canonical body bytes. Any
 * caller-supplied event_id is replaced: ids are always derived from the envelope scope.
 */
export async function sealEnvelope(
  e: Omit<EnvelopeV2, "payload_sha256">,
): Promise<{ envelope: EnvelopeV2; body: string }> {
  const event_id = await deriveEventId(eventIdScopeOf(e));
  const envelope = { ...e, event_id, payload_sha256: await payloadHash(e.payload) } as EnvelopeV2;
  const v = validateEnvelope(envelope);
  if ("errors" in v) throw new ProtocolError(`invalid_envelope:${v.errors.join(",")}`);
  return { envelope, body: canonicalize(envelope) };
}

// ---------------------------------------------------------------------------
// Service identity: connections and keys. Secrets are supplied by a server-only
// resolver; nothing here reads environment variables or browser storage.
// ---------------------------------------------------------------------------

export type Dialect =
  | "rtgip/2"
  | "autolabels.rooftopos/1"
  | "gateway.operator/1"
  | "autoframe.raw-hash/1"
  | "autoframe.ts-body/0"
  | "gateway.service/1"
  | "gw.extension/1";

export const HELD_DIALECTS: ReadonlySet<Dialect> = new Set([
  "autoframe.ts-body/0",
  "gateway.service/1",
  "gw.extension/1",
]);

export interface ServiceConnection {
  connection_id: string;
  source_app: AppId;
  target_app: AppId;
  tenant_id: string;
  rooftop_ids: readonly string[];
  event_types: readonly EventType[];
  purposes: readonly Purpose[];
  producer_enabled: boolean;
  reader_enabled: boolean;
  status: "active" | "suspended" | "revoked";
}

export interface ServiceKey {
  key_id: string;
  owner: Signer;
  dialect: Dialect;
  connection_ids: readonly string[];
  status: "current" | "previous" | "revoked";
  not_before: number;
  not_after: number;
  secret: string;
}

export interface Registry {
  connections: readonly ServiceConnection[];
  keys: readonly ServiceKey[];
}

export type AuthzResult =
  { ok: true; connection: ServiceConnection } | { ok: false; reason: string };

/** Fail-closed authorization of a (verified) envelope against the registry. */
export function authorize(e: EnvelopeV2, reg: Registry): AuthzResult {
  const route = routeFor(e.source_app, e.target_app);
  if (!route) return { ok: false, reason: "unknown_route" };
  if (route.phase !== "three_app") return { ok: false, reason: "route_reserved" };
  const purposes = route.events[e.event_type];
  if (!purposes) return { ok: false, reason: "event_not_on_route" };
  if (EVENT_CATALOG[e.event_type].owner !== e.source_app)
    return { ok: false, reason: "not_source_authority" };
  if (!purposes.includes(e.purpose)) return { ok: false, reason: "purpose_not_allowed" };
  const conns = reg.connections.filter(
    (c) =>
      c.source_app === e.source_app && c.target_app === e.target_app && c.tenant_id === e.tenant_id,
  );
  if (!conns.length) return { ok: false, reason: "no_connection_for_tenant" };
  const live = conns.filter((x) => x.status === "active");
  if (!live.length) return { ok: false, reason: "connection_revoked" };
  // The registry exports one connection per route, tenant and rooftop; exactly one may grant it.
  const granting = live.filter((x) => x.rooftop_ids.includes(e.rooftop_id));
  if (!granting.length) return { ok: false, reason: "rooftop_not_granted" };
  if (granting.length > 1) return { ok: false, reason: "ambiguous_connection" };
  const c = granting[0]!;
  if (!c.event_types.includes(e.event_type)) return { ok: false, reason: "event_not_granted" };
  if (!c.purposes.includes(e.purpose)) return { ok: false, reason: "purpose_not_granted" };
  if (!c.producer_enabled) return { ok: false, reason: "producer_disabled" };
  if (!c.reader_enabled) return { ok: false, reason: "reader_disabled" };
  return { ok: true, connection: c };
}

// ---------------------------------------------------------------------------
// Signing and verification
// ---------------------------------------------------------------------------

export interface SignedHeaders {
  "rtgip-protocol": typeof PROTOCOL;
  "rtgip-key-id": string;
  "rtgip-signer": Signer;
  "rtgip-timestamp": string;
  "rtgip-nonce": string;
  "rtgip-scope": string;
  "rtgip-signature": string;
}

export const scopeOf = (e: EnvelopeV2): string =>
  [
    e.source_app,
    e.target_app,
    e.tenant_id,
    e.rooftop_id,
    e.event_type,
    String(e.schema_version),
    e.purpose,
    e.event_id,
  ].join(";");

export const preimage = (
  keyId: string,
  signer: Signer,
  ts: string,
  nonce: string,
  scope: string,
  bodySha: string,
): string => [PROTOCOL, keyId, signer, ts, nonce, scope, bodySha].join("\n");

export async function signEnvelope(
  body: string,
  envelope: EnvelopeV2,
  key: ServiceKey,
  nowSec: number,
  nonce: string,
): Promise<SignedHeaders> {
  if (key.dialect !== PROTOCOL) throw new ProtocolError("key_dialect_mismatch");
  if (key.status !== "current") throw new ProtocolError("key_not_current");
  if (nowSec < key.not_before || nowSec > key.not_after)
    throw new ProtocolError("key_outside_validity");
  if (!NONCE.test(nonce)) throw new ProtocolError("invalid_nonce");
  if (canonicalize(JSON.parse(body)) !== body) throw new ProtocolError("body_not_canonical");
  const ts = String(nowSec);
  const scope = scopeOf(envelope);
  const sig = await hmacHex(
    key.secret,
    preimage(key.key_id, key.owner, ts, nonce, scope, await sha256Hex(body)),
  );
  return {
    "rtgip-protocol": PROTOCOL,
    "rtgip-key-id": key.key_id,
    "rtgip-signer": key.owner,
    "rtgip-timestamp": ts,
    "rtgip-nonce": nonce,
    "rtgip-scope": scope,
    "rtgip-signature": SIGNATURE_PREFIX + sig,
  };
}

export type NonceClaim = "claimed" | "exact_retry" | "conflict";
export interface NonceStore {
  claim(
    keyId: string,
    nonce: string,
    bodySha: string,
    expiresAt: number,
    nowSec: number,
  ): Promise<NonceClaim>;
}

export class MemoryNonceStore implements NonceStore {
  private seen = new Map<string, { sha: string; exp: number }>();
  async claim(
    keyId: string,
    nonce: string,
    bodySha: string,
    expiresAt: number,
    nowSec: number,
  ): Promise<NonceClaim> {
    for (const [k, v] of this.seen) if (v.exp < nowSec) this.seen.delete(k);
    const id = `${keyId}\u0000${nonce}`;
    const prior = this.seen.get(id);
    if (prior) return prior.sha === bodySha ? "exact_retry" : "conflict";
    this.seen.set(id, { sha: bodySha, exp: expiresAt });
    return "claimed";
  }
}

export interface VerifiedDelivery {
  envelope: EnvelopeV2;
  body_sha256: string;
  key_id: string;
  signer: Signer;
  connection_id: string;
  duplicate_delivery: boolean;
}

export type VerifyResult = { ok: true; delivery: VerifiedDelivery } | { ok: false; reason: string };

export interface VerifyContext {
  registry: Registry;
  nonces: NonceStore;
  nowSec: number;
  /** The signer this endpoint accepts: the source app at Gateway admission, "gateway" at a target. */
  expectedSigner: "source" | "gateway";
  /** The app running this verifier when it is a target; checked against envelope.target_app. */
  receiver?: AppId;
}

/**
 * Verify an rtgip/2 delivery. Order matters: everything that can be checked on headers
 * and raw bytes is checked before JSON parsing, and the nonce is only claimed after the
 * HMAC matches so a forged request cannot burn a legitimate nonce.
 */
export async function verifyDelivery(
  headers: Partial<SignedHeaders> | Record<string, string | undefined>,
  rawBody: string,
  ctx: VerifyContext,
): Promise<VerifyResult> {
  const hdrs = headers as Record<string, string | undefined>;
  const h = (k: keyof SignedHeaders) => hdrs[k];
  if (h("rtgip-protocol") !== PROTOCOL) return { ok: false, reason: "protocol_mismatch" };
  const keyId = h("rtgip-key-id"),
    signer = h("rtgip-signer"),
    ts = h("rtgip-timestamp"),
    nonce = h("rtgip-nonce");
  const scope = h("rtgip-scope"),
    sig = h("rtgip-signature");
  if (!keyId || !signer || !ts || !nonce || !scope || !sig)
    return { ok: false, reason: "missing_headers" };
  if (!sig.startsWith(SIGNATURE_PREFIX)) return { ok: false, reason: "protocol_mismatch" };
  if (!NONCE.test(nonce)) return { ok: false, reason: "invalid_nonce" };
  const key = ctx.registry.keys.find((k) => k.key_id === keyId);
  if (!key) return { ok: false, reason: "unknown_key" };
  if (key.dialect !== PROTOCOL) return { ok: false, reason: "key_dialect_mismatch" };
  if (key.status === "revoked") return { ok: false, reason: "key_revoked" };
  if (ctx.nowSec < key.not_before || ctx.nowSec > key.not_after)
    return { ok: false, reason: "key_outside_validity" };
  if (key.owner !== signer) return { ok: false, reason: "signer_key_mismatch" };
  if (ctx.expectedSigner === "gateway" && signer !== "gateway")
    return { ok: false, reason: "signer_not_gateway" };
  if (ctx.expectedSigner === "source" && signer === "gateway")
    return { ok: false, reason: "signer_not_source" };
  if (!/^\d{1,12}$/.test(ts) || Math.abs(ctx.nowSec - Number(ts)) > MAX_SKEW_SECONDS)
    return { ok: false, reason: "timestamp_out_of_window" };
  if (enc.encode(rawBody).length > MAX_BODY_BYTES) return { ok: false, reason: "body_too_large" };
  const bodySha = await sha256Hex(rawBody);
  const expected =
    SIGNATURE_PREFIX +
    (await hmacHex(key.secret, preimage(keyId, key.owner, ts, nonce, scope, bodySha)));
  if (!timingSafeEqual(expected, sig)) return { ok: false, reason: "bad_signature" };
  const claim = await ctx.nonces.claim(
    keyId,
    nonce,
    bodySha,
    Number(ts) + NONCE_TTL_SECONDS,
    ctx.nowSec,
  );
  if (claim === "conflict") return { ok: false, reason: "nonce_reused" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { ok: false, reason: "malformed_json" };
  }
  try {
    if (canonicalize(parsed) !== rawBody) return { ok: false, reason: "body_not_canonical" };
  } catch {
    return { ok: false, reason: "body_not_canonical" };
  }
  const v = validateEnvelope(parsed);
  if ("errors" in v) {
    const first = v.errors[0];
    if (
      first === "unsupported_schema_version" ||
      first === "unsupported_event_type" ||
      first === "protocol_mismatch"
    )
      return { ok: false, reason: first };
    return { ok: false, reason: `invalid_envelope:${v.errors.join(",")}` };
  }
  const e = v.envelope;
  if (scopeOf(e) !== scope) return { ok: false, reason: "scope_mismatch" };
  if ((await payloadHash(e.payload)) !== e.payload_sha256)
    return { ok: false, reason: "payload_hash_mismatch" };
  if ((await deriveEventId(eventIdScopeOf(e))) !== e.event_id)
    return { ok: false, reason: "event_id_not_derived" };
  if (ctx.receiver && e.target_app !== ctx.receiver)
    return { ok: false, reason: "wrong_destination" };
  if (signer !== "gateway" && signer !== e.source_app)
    return { ok: false, reason: "source_impersonation" };
  const az = authorize(e, ctx.registry);
  if ("reason" in az) return { ok: false, reason: az.reason };
  if (!key.connection_ids.includes(az.connection.connection_id))
    return { ok: false, reason: "key_not_bound_to_connection" };
  return {
    ok: true,
    delivery: {
      envelope: e,
      body_sha256: bodySha,
      key_id: keyId,
      signer: key.owner,
      connection_id: az.connection.connection_id,
      duplicate_delivery: claim === "exact_retry",
    },
  };
}

// ---------------------------------------------------------------------------
// Legacy dialects: verify-only. A key is pinned to exactly one dialect, so a valid
// signature in one dialect is never accepted as valid in another.
// ---------------------------------------------------------------------------

export interface LegacyMessage {
  dialect: Dialect;
  key_id: string;
  timestamp: string;
  nonce: string | null;
  signature: string;
  raw_body: string;
}

export async function legacyPreimage(m: LegacyMessage): Promise<string> {
  switch (m.dialect) {
    case "autolabels.rooftopos/1":
      return `rooftopos.v1\n${m.timestamp}\n${m.key_id}\n${await sha256Hex(m.raw_body)}`;
    case "gateway.operator/1":
      return `${m.timestamp}.${m.nonce}.${m.raw_body}`;
    case "autoframe.raw-hash/1":
      return `${m.timestamp}.${m.nonce}.${await sha256Hex(m.raw_body)}`;
    default:
      throw new ProtocolError("dialect_not_verifiable");
  }
}

export type LegacyVerify =
  { ok: true; key: ServiceKey; body: unknown; replay_key: string } | { ok: false; reason: string };

export async function verifyLegacy(
  m: LegacyMessage,
  reg: Registry,
  nonces: NonceStore,
  nowSec: number,
): Promise<LegacyVerify> {
  if (m.dialect === PROTOCOL) return { ok: false, reason: "not_a_legacy_dialect" };
  if (HELD_DIALECTS.has(m.dialect)) return { ok: false, reason: "dialect_held" };
  if (!["autolabels.rooftopos/1", "gateway.operator/1", "autoframe.raw-hash/1"].includes(m.dialect))
    return { ok: false, reason: "unknown_dialect" };
  const key = reg.keys.find((k) => k.key_id === m.key_id);
  if (!key) return { ok: false, reason: "unknown_key" };
  if (key.dialect !== m.dialect) return { ok: false, reason: "key_dialect_mismatch" };
  if (key.owner === "gateway") return { ok: false, reason: "legacy_key_must_belong_to_source" };
  if (key.status === "revoked") return { ok: false, reason: "key_revoked" };
  if (nowSec < key.not_before || nowSec > key.not_after)
    return { ok: false, reason: "key_outside_validity" };
  if (!/^\d{1,12}$/.test(m.timestamp) || Math.abs(nowSec - Number(m.timestamp)) > MAX_SKEW_SECONDS)
    return { ok: false, reason: "timestamp_out_of_window" };
  if (m.dialect !== "autolabels.rooftopos/1" && (!m.nonce || !NONCE.test(m.nonce)))
    return { ok: false, reason: "invalid_nonce" };
  if (!m.signature.startsWith("v1=")) return { ok: false, reason: "bad_signature" };
  const expected = "v1=" + (await hmacHex(key.secret, await legacyPreimage(m)));
  if (!timingSafeEqual(expected, m.signature)) return { ok: false, reason: "bad_signature" };
  let body: unknown;
  try {
    body = JSON.parse(m.raw_body);
  } catch {
    return { ok: false, reason: "malformed_json" };
  }
  if (m.dialect === "gateway.operator/1") {
    try {
      if (canonicalize(body) !== m.raw_body) return { ok: false, reason: "body_not_canonical" };
    } catch {
      return { ok: false, reason: "body_not_canonical" };
    }
  }
  // autolabels.rooftopos/1 has no nonce; its event_id is the replay key.
  const replayKey =
    m.nonce ??
    (isObj(body) && typeof body["event_id"] === "string" ? `event:${body["event_id"]}` : "");
  if (!replayKey) return { ok: false, reason: "missing_replay_key" };
  const claim = await nonces.claim(
    key.key_id,
    replayKey,
    await sha256Hex(m.raw_body),
    Number(m.timestamp) + NONCE_TTL_SECONDS,
    nowSec,
  );
  if (claim !== "claimed")
    return { ok: false, reason: claim === "conflict" ? "nonce_reused" : "replayed" };
  return { ok: true, key, body, replay_key: replayKey };
}

/** Tenant/rooftop/source claims in a legacy body (flat or AutoFrame's nested source.app). */
export function legacyScopeClaims(
  body: unknown,
): { tenant_id: string; rooftop_id: string; source_app: string | null } | null {
  if (!isObj(body)) return null;
  const t = body["tenant_id"];
  const r = body["rooftop_id"];
  if (typeof t !== "string" || typeof r !== "string" || !t || !r) return null;
  const src = body["source"];
  const flat = body["source_app"];
  const source_app =
    typeof flat === "string"
      ? flat
      : isObj(src) && typeof src["app"] === "string"
        ? (src["app"] as string)
        : null;
  return { tenant_id: t, rooftop_id: r, source_app };
}

export type LegacyMapper = (
  body: unknown,
  source: AppId,
) => Omit<EnvelopeV2, "payload_sha256"> | null;

/**
 * Trusted re-signing: authenticate the original source in its own dialect, map it to
 * rtgip/2, verify the destination/tenant/rooftop/event/purpose against the registry,
 * then sign with a separate Gateway key. The source key cannot be the Gateway key.
 */
export async function translateAndResign(
  m: LegacyMessage,
  mapper: LegacyMapper,
  gatewayKey: ServiceKey,
  reg: Registry,
  nonces: NonceStore,
  nowSec: number,
  nonce: string,
): Promise<
  | { ok: true; envelope: EnvelopeV2; body: string; headers: SignedHeaders }
  | { ok: false; reason: string }
> {
  const lv = await verifyLegacy(m, reg, nonces, nowSec);
  if ("reason" in lv) return { ok: false, reason: lv.reason };
  if (gatewayKey.owner !== "gateway" || gatewayKey.dialect !== PROTOCOL)
    return { ok: false, reason: "resign_key_invalid" };
  if (gatewayKey.key_id === lv.key.key_id || gatewayKey.secret === lv.key.secret)
    return { ok: false, reason: "resign_key_not_distinct" };
  const source = lv.key.owner as AppId;
  const draft = mapper(lv.body, source);
  if (!draft) return { ok: false, reason: "unmappable_event" };
  if (draft.source_app !== source || draft.origin.app !== source)
    return { ok: false, reason: "source_impersonation" };
  // The mapper may only restate what the authenticated legacy message claimed: its tenant,
  // rooftop and (when present) source app must be carried over unchanged.
  const claims = legacyScopeClaims(lv.body);
  if (!claims) return { ok: false, reason: "legacy_scope_claims_missing" };
  if (claims.tenant_id !== draft.tenant_id || claims.rooftop_id !== draft.rooftop_id)
    return { ok: false, reason: "legacy_scope_mismatch" };
  if (claims.source_app !== null && claims.source_app !== source)
    return { ok: false, reason: "source_impersonation" };
  let sealed: { envelope: EnvelopeV2; body: string };
  try {
    sealed = await sealEnvelope(draft);
  } catch (err) {
    return { ok: false, reason: (err as Error).message };
  }
  const az = authorize(sealed.envelope, reg);
  if ("reason" in az) return { ok: false, reason: az.reason };
  if (!lv.key.connection_ids.includes(az.connection.connection_id))
    return { ok: false, reason: "key_not_bound_to_connection" };
  if (!gatewayKey.connection_ids.includes(az.connection.connection_id))
    return { ok: false, reason: "resign_key_not_bound" };
  const headers = await signEnvelope(sealed.body, sealed.envelope, gatewayKey, nowSec, nonce);
  return { ok: true, envelope: sealed.envelope, body: sealed.body, headers };
}
