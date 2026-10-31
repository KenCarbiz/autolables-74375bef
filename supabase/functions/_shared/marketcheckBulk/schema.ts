// Optional, not-yet-subscribed MarketCheck bulk feeds (CSV / JSONL / Parquet).
// Schema-aware value coercion. Pure; independent of the Files.com dealer parser.
// Empty strings, nulls, nested objects and pipe-separated values are handled
// strictly by the declared field schema, never by guessing from the data.

export type FieldType = "string" | "integer" | "number" | "boolean" | "date" | "timestamp" | "object" | "array";
export type FeedSource = "csv" | "jsonl" | "parquet";

export type FieldSchema = {
  name: string;
  type: FieldType;
  nullable: boolean;
  // What an empty string "" means for this field.
  emptyString: "null" | "empty" | "invalid";
  // Value is "a|b|c" -> string[] (items typed by itemType, default string).
  pipeSeparated?: boolean;
  itemType?: FieldType;
  nested?: FieldSchema[];
  deprecated?: boolean;
  required?: boolean;
};

export type FeedSchema = {
  feedKey: string;
  version: string;
  fields: FieldSchema[];
  releasedAt?: string;
  deprecatedFields?: string[];
};

export type CoerceResult =
  | { ok: true; value: unknown; unknownKeys?: string[] }
  | { ok: false; error: string };

export type RecordIssue = { field: string; error: string };

export type ValidatedRecord = {
  record: Record<string, unknown>;
  errors: RecordIssue[];
  unknownFields: string[];
  deprecatedFieldsSeen: string[];
  missingRequired: string[];
};

const ok = (value: unknown, unknownKeys?: string[]): CoerceResult =>
  unknownKeys && unknownKeys.length ? { ok: true, value, unknownKeys } : { ok: true, value };
const fail = (error: string): CoerceResult => ({ ok: false, error });

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Date) && !(v instanceof Uint8Array);

const INT_RE = /^[+-]?\d+(\.0+)?$/;
const NUM_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TS_RE = /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?([Zz]|[+-]\d{2}:?\d{2})$/;

function validDate(s: string): boolean {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

function emptyResult(field: FieldSchema): CoerceResult {
  switch (field.emptyString) {
    case "null":
      return field.nullable ? ok(null) : fail("empty_not_nullable");
    case "empty":
      if (field.pipeSeparated || field.type === "array") return ok([]);
      if (field.type === "string") return ok("");
      if (field.type === "object") return ok({});
      return fail("empty_not_allowed_for_type");
    default:
      return fail("empty_string_invalid");
  }
}

function itemField(field: FieldSchema, path: string): FieldSchema {
  return { name: `${path}[]`, type: field.itemType ?? "string", nullable: false, emptyString: "invalid", nested: field.nested };
}

function coerceItems(field: FieldSchema, items: unknown[], source: FeedSource, path: string): CoerceResult {
  const f = itemField(field, path);
  const out: unknown[] = [];
  const unknown: string[] = [];
  const errs: string[] = [];
  items.forEach((it, i) => {
    const r = coerceInner(f, it, source, `${path}[${i}]`);
    if (r.ok) {
      out.push(r.value);
      if (r.unknownKeys) unknown.push(...r.unknownKeys);
    } else errs.push(`${path}[${i}]: ${r.error}`);
  });
  return errs.length ? fail(errs.join("; ")) : ok(out, unknown);
}

function coerceObject(field: FieldSchema, obj: Record<string, unknown>, source: FeedSource, path: string): CoerceResult {
  if (!field.nested) return ok(obj);
  // A JSON literal inside a CSV cell carries real JSON types.
  const inner = validateFields(field.nested, obj, source === "csv" ? "jsonl" : source, path);
  if (inner.errors.length || inner.missingRequired.length) {
    const msgs = [...inner.errors.map((e) => `${e.field}: ${e.error}`), ...inner.missingRequired.map((m) => `${m}: missing_required`)];
    return fail(msgs.join("; "));
  }
  return ok(inner.record, inner.unknownFields);
}

function coerceInner(field: FieldSchema, raw: unknown, source: FeedSource, path: string): CoerceResult {
  if (raw === null || raw === undefined) return field.nullable ? ok(null) : fail("null_not_allowed");
  if (source === "csv" && typeof raw !== "string") return fail("csv_cell_must_be_string");
  if (raw === "") return emptyResult(field);

  let v: unknown = raw;
  if (source === "csv" && field.type !== "string") {
    v = (raw as string).trim();
    if (v === "") return emptyResult(field);
  }

  if (field.pipeSeparated) {
    let parts: unknown[];
    if (typeof v === "string") parts = v.split("|").map((s) => s.trim()).filter((s) => s !== "");
    else if (Array.isArray(v)) parts = v;
    else return fail("expected_pipe_separated_string");
    if (parts.length === 0) return emptyResult(field);
    return coerceItems(field, parts, source, path);
  }

  switch (field.type) {
    case "string":
      return typeof v === "string" ? ok(v) : fail("expected_string");
    case "integer": {
      if (typeof v === "bigint") return Number.isSafeInteger(Number(v)) ? ok(Number(v)) : fail("integer_out_of_range");
      if (typeof v === "number") return Number.isInteger(v) ? (Number.isSafeInteger(v) ? ok(v) : fail("integer_out_of_range")) : fail("not_integral");
      if (source === "csv" && typeof v === "string") {
        if (!INT_RE.test(v)) return fail(NUM_RE.test(v) ? "not_integral" : "invalid_integer");
        const n = Number(v);
        return Number.isSafeInteger(n) ? ok(n) : fail("integer_out_of_range");
      }
      return fail("expected_integer");
    }
    case "number": {
      if (typeof v === "bigint") return ok(Number(v));
      if (typeof v === "number") return Number.isFinite(v) ? ok(v) : fail("not_finite");
      if (source === "csv" && typeof v === "string") {
        if (!NUM_RE.test(v)) return fail("invalid_number");
        const n = Number(v);
        return Number.isFinite(n) ? ok(n) : fail("not_finite");
      }
      return fail("expected_number");
    }
    case "boolean": {
      if (typeof v === "boolean") return ok(v);
      if (source === "csv" && typeof v === "string") {
        const l = v.toLowerCase();
        if (l === "true" || l === "1" || l === "y") return ok(true);
        if (l === "false" || l === "0" || l === "n") return ok(false);
        return fail("invalid_boolean");
      }
      return fail("expected_boolean");
    }
    case "date": {
      if (v instanceof Date) return Number.isNaN(v.getTime()) ? fail("invalid_date") : ok(v.toISOString().slice(0, 10));
      if (typeof v === "string") return validDate(v) ? ok(v) : fail("invalid_date");
      return fail("expected_date");
    }
    case "timestamp": {
      if (v instanceof Date) return Number.isNaN(v.getTime()) ? fail("invalid_timestamp") : ok(v.toISOString());
      if (typeof v === "string") return TS_RE.test(v) && !Number.isNaN(Date.parse(v)) ? ok(v) : fail("invalid_timestamp");
      return fail("expected_timestamp");
    }
    case "object": {
      let obj: unknown = v;
      if (source === "csv" && typeof v === "string") {
        try { obj = JSON.parse(v); } catch { return fail("invalid_json_object"); }
      }
      return isPlainObject(obj) ? coerceObject(field, obj, source, path) : fail("expected_object");
    }
    case "array": {
      let arr: unknown = v;
      if (source === "csv" && typeof v === "string") {
        try { arr = JSON.parse(v); } catch { return fail("invalid_json_array"); }
      }
      if (!Array.isArray(arr)) return fail("expected_array");
      return coerceItems(field, arr, source === "csv" ? "jsonl" : source, path);
    }
    default:
      return fail("unknown_field_type");
  }
}

export function coerceValue(field: FieldSchema, raw: unknown, source: FeedSource): CoerceResult {
  return coerceInner(field, raw, source, field.name);
}

function validateFields(
  fields: FieldSchema[], record: Record<string, unknown>, source: FeedSource, prefix: string | null, deprecatedNames: string[] = [],
): ValidatedRecord {
  const out: Record<string, unknown> = {};
  const errors: RecordIssue[] = [];
  const unknownFields: string[] = [];
  const deprecatedFieldsSeen: string[] = [];
  const missingRequired: string[] = [];
  const known = new Set(fields.map((f) => f.name));
  const q = (n: string) => (prefix ? `${prefix}.${n}` : n);

  for (const f of fields) {
    const present = Object.prototype.hasOwnProperty.call(record, f.name);
    if (!present) {
      if (f.required) missingRequired.push(q(f.name));
      continue;
    }
    if (f.deprecated || deprecatedNames.includes(f.name)) deprecatedFieldsSeen.push(q(f.name));
    const r = coerceInner(f, record[f.name], source, q(f.name));
    if (!r.ok) {
      errors.push({ field: q(f.name), error: r.error });
      continue;
    }
    if (r.unknownKeys) unknownFields.push(...r.unknownKeys);
    if (r.value === null && f.required) {
      missingRequired.push(q(f.name));
      continue;
    }
    out[f.name] = r.value;
  }
  for (const k of Object.keys(record)) {
    if (!known.has(k)) {
      unknownFields.push(q(k));
      // Unknown keys are preserved only inside nested objects (prefix set);
      // unknown top-level columns are reported but not copied.
      if (prefix) out[k] = record[k];
    }
  }
  return { record: out, errors, unknownFields, deprecatedFieldsSeen, missingRequired };
}

export function validateRecord(schema: FeedSchema, record: Record<string, unknown>, source: FeedSource): ValidatedRecord {
  return validateFields(schema.fields, record, source, null, schema.deprecatedFields ?? []);
}

export type SchemaDiff = {
  added: string[];
  removed: string[];
  typeChanged: { field: string; from: string; to: string }[];
  newlyDeprecated: string[];
};

function flatten(fields: FieldSchema[], deprecatedNames: string[], prefix = "", acc = new Map<string, { sig: string; deprecated: boolean }>()) {
  for (const f of fields) {
    const p = prefix ? `${prefix}.${f.name}` : f.name;
    const sig = `${f.type}${f.pipeSeparated ? "|pipe" : ""}${f.itemType ? `<${f.itemType}>` : ""}${f.nullable ? "?" : ""}`;
    acc.set(p, { sig, deprecated: !!f.deprecated || (!prefix && deprecatedNames.includes(f.name)) });
    if (f.nested) flatten(f.nested, [], p, acc);
  }
  return acc;
}

export function compareSchemas(current: FeedSchema, next: FeedSchema): SchemaDiff {
  const a = flatten(current.fields, current.deprecatedFields ?? []);
  const b = flatten(next.fields, next.deprecatedFields ?? []);
  const diff: SchemaDiff = { added: [], removed: [], typeChanged: [], newlyDeprecated: [] };
  for (const [k, v] of b) {
    const old = a.get(k);
    if (!old) { diff.added.push(k); continue; }
    if (old.sig !== v.sig) diff.typeChanged.push({ field: k, from: old.sig, to: v.sig });
    if (v.deprecated && !old.deprecated) diff.newlyDeprecated.push(k);
  }
  for (const k of a.keys()) if (!b.has(k)) diff.removed.push(k);
  return diff;
}
