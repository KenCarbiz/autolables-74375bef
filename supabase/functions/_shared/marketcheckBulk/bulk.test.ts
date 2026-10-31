import { describe, expect, it } from "vitest";
import { coerceValue, compareSchemas, validateRecord, type FeedSchema, type FieldSchema } from "./schema";
import { BulkFeedError, decompress, limitBytes, lines, type ResourceLimits } from "./stream";
import { csvAdapter, ingestRecords, jsonlAdapter, parquetAdapter, type ParquetReader } from "./adapters";
import { deliveryTimeline, evaluateDelivery, type Delivery } from "./delivery";
import { verifyBulkWebhook } from "./webhookAuth";

const enc = new TextEncoder();
function chunked(data: string | Uint8Array, size: number): ReadableStream<Uint8Array> {
  const bytes = typeof data === "string" ? enc.encode(data) : data;
  let o = 0;
  return new ReadableStream({
    pull(c) {
      if (o >= bytes.length) return c.close();
      c.enqueue(bytes.slice(o, o + size));
      o += size;
    },
  });
}
async function collect<T>(g: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of g) out.push(x);
  return out;
}
const LIM: ResourceLimits = { maxBytes: 1e6, maxRows: 1000, maxLineBytes: 10_000, maxErrors: 100 };
const F = (o: Partial<FieldSchema> & Pick<FieldSchema, "name" | "type">): FieldSchema => ({ nullable: true, emptyString: "null", ...o });

describe("coerceValue", () => {
  it("empty string follows emptyString per field", () => {
    expect(coerceValue(F({ name: "a", type: "integer" }), "", "csv")).toEqual({ ok: true, value: null });
    expect(coerceValue(F({ name: "a", type: "string", emptyString: "empty" }), "", "csv")).toEqual({ ok: true, value: "" });
    expect(coerceValue(F({ name: "a", type: "integer", emptyString: "invalid" }), "", "csv").ok).toBe(false);
    expect(coerceValue(F({ name: "a", type: "integer", nullable: false }), "", "csv").ok).toBe(false);
  });
  it("null differs from empty string in jsonl/parquet", () => {
    const f = F({ name: "a", type: "string", emptyString: "empty" });
    expect(coerceValue(f, null, "jsonl")).toEqual({ ok: true, value: null });
    expect(coerceValue(f, "", "jsonl")).toEqual({ ok: true, value: "" });
    expect(coerceValue({ ...f, nullable: false }, null, "parquet").ok).toBe(false);
  });
  it("pipe-separated values", () => {
    const f = F({ name: "f", type: "array", pipeSeparated: true, itemType: "string", emptyString: "empty" });
    expect(coerceValue(f, " a | b||c ", "csv")).toEqual({ ok: true, value: ["a", "b", "c"] });
    expect(coerceValue(f, "", "csv")).toEqual({ ok: true, value: [] });
    const n = F({ name: "n", type: "array", pipeSeparated: true, itemType: "integer" });
    expect(coerceValue(n, "1|2|3", "csv")).toEqual({ ok: true, value: [1, 2, 3] });
    expect(coerceValue(n, "1|x", "csv").ok).toBe(false);
  });
  it("integers, dates, timestamps, booleans", () => {
    expect(coerceValue(F({ name: "i", type: "integer" }), "5", "csv")).toEqual({ ok: true, value: 5 });
    expect(coerceValue(F({ name: "i", type: "integer" }), "5.5", "csv").ok).toBe(false);
    expect(coerceValue(F({ name: "i", type: "integer" }), 5.5, "jsonl").ok).toBe(false);
    expect(coerceValue(F({ name: "d", type: "date" }), "2026-02-30", "csv").ok).toBe(false);
    expect(coerceValue(F({ name: "d", type: "date" }), "2026-02-28", "csv").ok).toBe(true);
    expect(coerceValue(F({ name: "t", type: "timestamp" }), "2026-01-01T10:00:00Z", "jsonl").ok).toBe(true);
    expect(coerceValue(F({ name: "t", type: "timestamp" }), "2026-01-01T10:00:00", "jsonl").ok).toBe(false);
    expect(coerceValue(F({ name: "b", type: "boolean" }), "Y", "csv")).toEqual({ ok: true, value: true });
    expect(coerceValue(F({ name: "b", type: "boolean" }), "Y", "jsonl").ok).toBe(false);
    expect(coerceValue(F({ name: "b", type: "boolean" }), "maybe", "csv").ok).toBe(false);
  });
  it("validates nested objects recursively and reports unknown nested keys", () => {
    const f = F({ name: "dealer", type: "object", nested: [F({ name: "id", type: "integer", nullable: false }), F({ name: "city", type: "string" })] });
    const good = coerceValue(f, { id: 1, city: null, extra: "x" }, "jsonl");
    expect(good).toEqual({ ok: true, value: { id: 1, city: null, extra: "x" }, unknownKeys: ["dealer.extra"] });
    const bad = coerceValue(f, { id: "1" }, "jsonl");
    expect(bad.ok).toBe(false);
    expect(coerceValue(f, '{"id":7}', "csv")).toEqual({ ok: true, value: { id: 7 } });
    expect(coerceValue(f, "not json", "csv").ok).toBe(false);
    // JSON literal only parsed for object/array types
    expect(coerceValue(F({ name: "s", type: "string" }), '{"a":1}', "csv")).toEqual({ ok: true, value: '{"a":1}' });
  });
});

const SCHEMA: FeedSchema = {
  feedKey: "active", version: "2026Q1", deprecatedFields: ["old_col"],
  fields: [
    F({ name: "vin", type: "string", nullable: false, required: true, emptyString: "invalid" }),
    F({ name: "price", type: "integer" }),
    F({ name: "features", type: "array", pipeSeparated: true, itemType: "string", emptyString: "empty" }),
    F({ name: "old_col", type: "string" }),
  ],
};

describe("validateRecord", () => {
  it("reports unknown, deprecated, missing required and errors", () => {
    const r = validateRecord(SCHEMA, { price: "x", old_col: "a", surprise: "1" }, "csv");
    expect(r.missingRequired).toEqual(["vin"]);
    expect(r.errors).toEqual([{ field: "price", error: "invalid_integer" }]);
    expect(r.deprecatedFieldsSeen).toEqual(["old_col"]);
    expect(r.unknownFields).toEqual(["surprise"]);
    expect(r.record).toEqual({ old_col: "a" });
  });
});

describe("compareSchemas", () => {
  it("diffs added, removed, type changes, new deprecations", () => {
    const next: FeedSchema = {
      ...SCHEMA, version: "2026Q2", deprecatedFields: ["old_col", "price"],
      fields: [
        SCHEMA.fields[0],
        F({ name: "price", type: "number" }),
        F({ name: "features", type: "array", pipeSeparated: true, itemType: "string", emptyString: "empty" }),
        F({ name: "old_col", type: "string" }),
        F({ name: "mileage", type: "integer" }),
      ],
    };
    const d = compareSchemas(SCHEMA, next);
    expect(d.added).toEqual(["mileage"]);
    expect(d.removed).toEqual([]);
    expect(d.typeChanged).toEqual([{ field: "price", from: "integer?", to: "number?" }]);
    expect(d.newlyDeprecated).toEqual(["price"]);
    expect(compareSchemas(next, SCHEMA).removed).toEqual(["mileage"]);
  });
});

describe("stream helpers", () => {
  it("gzip round-trip and zstd unsupported", async () => {
    const gz = chunked("hello\nworld", 4).pipeThrough(new CompressionStream("gzip") as unknown as TransformStream<Uint8Array, Uint8Array>);
    const out = await collect(lines(decompress(gz, "gzip"), 100));
    expect(out).toEqual(["hello", "world"]);
    expect(() => decompress(chunked("x", 1), "zstd")).toThrowError(BulkFeedError);
    try { decompress(chunked("x", 1), "zstd"); } catch (e) { expect((e as BulkFeedError).code).toBe("compression_unsupported"); }
  });
  it("limitBytes throws once exceeded", async () => {
    await expect(collect(lines(limitBytes(chunked("a".repeat(50), 5), 20), 1000))).rejects.toMatchObject({ code: "byte_limit_exceeded" });
    await expect(collect(lines(limitBytes(chunked("abc\n", 2), 20), 1000))).resolves.toEqual(["abc"]);
  });
  it("limitBytes applies to decompressed bytes too", async () => {
    const gz = chunked("a".repeat(5000), 100).pipeThrough(new CompressionStream("gzip") as unknown as TransformStream<Uint8Array, Uint8Array>);
    const s = limitBytes(decompress(gz, "gzip"), 1000);
    await expect(collect(lines(s, 100000))).rejects.toMatchObject({ code: "byte_limit_exceeded" });
  });
  it("lines handles CRLF, multibyte across chunks, BOM, no final newline, long lines", async () => {
    const text = "﻿café\r\nnaïve\n\nlast";
    for (const size of [1, 2, 3, 100]) {
      expect(await collect(lines(chunked(text, size), 100))).toEqual(["café", "naïve", "", "last"]);
    }
    await expect(collect(lines(chunked("x".repeat(30), 7), 10))).rejects.toMatchObject({ code: "line_too_long" });
  });
});

describe("csvAdapter", () => {
  const csv = 'id,name,note\r\n1,"Smith, ""Bob""","line1\nline2"\r\n2,plain,\r\n\r\n3,"é",x';
  const expected = [
    { id: "1", name: 'Smith, "Bob"', note: "line1\nline2" },
    { id: "2", name: "plain", note: "" },
    { id: "3", name: "é", note: "x" },
  ];
  it("parses quoting edge cases across 1-3 byte chunks", async () => {
    for (const size of [1, 2, 3, 1000]) {
      const rows = await collect(csvAdapter.records(chunked(csv, size), LIM));
      expect(rows.map((r) => r.raw)).toEqual(expected);
      expect(rows.map((r) => r.rowNumber)).toEqual([1, 2, 3]);
    }
  });
  it("rejects duplicate headers and unterminated quotes", async () => {
    await expect(collect(csvAdapter.records(chunked("a,b,a\n1,2,3\n", 3), LIM))).rejects.toMatchObject({ code: "duplicate_header" });
    await expect(collect(csvAdapter.records(chunked('a\n"open', 2), LIM))).rejects.toMatchObject({ code: "unterminated_quote" });
  });
  it("reports wrong column counts as row errors, not exceptions", async () => {
    const rows = await collect(csvAdapter.records(chunked("a,b\n1,2\n1\n3,4,5\n6,7\n", 2), LIM));
    expect(rows.map((r) => !!r.error)).toEqual([false, true, true, false]);
    expect(rows[1].error).toContain("column_count_mismatch");
  });
  it("enforces record size", async () => {
    await expect(collect(csvAdapter.records(chunked('a\n"' + "x".repeat(50) + '"\n', 5), { ...LIM, maxLineBytes: 20 }))).rejects.toMatchObject({ code: "line_too_long" });
  });
});

describe("jsonlAdapter", () => {
  it("keeps nulls and nested objects, skips blanks, flags non-objects", async () => {
    const src = '{"a":null,"b":{"c":1}}\n\n[1]\nnope\n{"a":""}\n';
    const rows = await collect(jsonlAdapter.records(chunked(src, 3), LIM));
    expect(rows[0]).toEqual({ rowNumber: 1, raw: { a: null, b: { c: 1 } } });
    expect(rows[1]).toMatchObject({ rowNumber: 3, error: "not_an_object" });
    expect(rows[2]).toMatchObject({ rowNumber: 4, error: "invalid_json" });
    expect(rows[3]).toEqual({ rowNumber: 5, raw: { a: "" } });
  });
});

describe("parquetAdapter", () => {
  const make = (n: number) => {
    const calls: [number, number][] = [];
    const reader: ParquetReader = {
      rowCount: async () => n,
      readRows: async (offset, limit) => {
        calls.push([offset, limit]);
        return Array.from({ length: Math.min(limit, n - offset) }, (_, i) => ({ vin: `V${offset + i}` }));
      },
    };
    return { reader, calls };
  };
  it("reads in batches", async () => {
    const { reader, calls } = make(25);
    const rows = await collect(parquetAdapter(reader, 10).records(null, LIM));
    expect(rows.length).toBe(25);
    expect(rows[24]).toEqual({ rowNumber: 25, raw: { vin: "V24" } });
    expect(calls).toEqual([[0, 10], [10, 10], [20, 5]]);
  });
  it("honours maxRows before reading", async () => {
    const { reader, calls } = make(25);
    await expect(collect(parquetAdapter(reader, 10).records(null, { ...LIM, maxRows: 10 }))).rejects.toMatchObject({ code: "row_limit_exceeded" });
    expect(calls.length).toBe(0);
  });
});

describe("ingestRecords", () => {
  const body = "vin,price,features,old_col,extra\n" + Array.from({ length: 7 }, (_, i) => `V${i},${i},a|b,x,1`).join("\n") + "\n,5,,,\nV9,abc,,,\n";
  it("batches valid rows and summarises", async () => {
    const batches: number[] = [];
    const s = await ingestRecords(csvAdapter, chunked(body, 5), SCHEMA, LIM, async (b, n) => { batches.push(b.length); expect(n).toBe(batches.length); }, 3);
    expect(batches).toEqual([3, 3, 1]);
    expect(s).toMatchObject({ rows: 9, valid: 7, invalid: 2, missingRequiredCount: 0, unknownFields: ["extra"], deprecatedFieldsSeen: ["old_col"] });
    expect(s.errorsSample.length).toBeGreaterThan(0);
  });
  it("stops on too many errors and on row limit", async () => {
    await expect(ingestRecords(csvAdapter, chunked(body, 5), SCHEMA, { ...LIM, maxErrors: 1 }, async () => {})).rejects.toMatchObject({ code: "too_many_errors" });
    await expect(ingestRecords(csvAdapter, chunked(body, 5), SCHEMA, { ...LIM, maxRows: 3 }, async () => {})).rejects.toMatchObject({ code: "row_limit_exceeded" });
  });
  it("caps error sample at 50", async () => {
    const s = await ingestRecords(csvAdapter, chunked("vin,p\n" + Array.from({ length: 120 }, () => ",x").join("\n"), 50), SCHEMA, { ...LIM, maxErrors: 1000 }, async () => {});
    expect(s.errorsSample.length).toBe(50);
    expect(s.invalid).toBe(120);
  });
  it("works with jsonl nested/null data", async () => {
    const seen: unknown[] = [];
    const s = await ingestRecords(jsonlAdapter, chunked('{"vin":"V1","price":null}\n{"vin":"V2","price":3}\n', 4), SCHEMA, LIM, async (b) => { seen.push(...b.map((x) => x.record)); });
    expect(s.valid).toBe(2);
    expect(seen[0]).toEqual({ vin: "V1", price: null });
  });
});

describe("evaluateDelivery", () => {
  const part = (n: number, rows = 10): Delivery["parts"][number] => ({ partNo: n, path: `p${n}`, size: 1, rowCount: rows, expectedChecksum: `c${n}`, actualChecksum: `c${n}` });
  const base = (o: Partial<Delivery> = {}): Delivery => ({
    feedKey: "active", environment: "production", deliveryKey: "d1", scope: "full", expectedParts: 2,
    parts: [part(1), part(2)], completionEvidence: "notification", expectedRowCount: 20, schemaVersion: "2026Q1", ...o,
  });
  const opts = { activeSchemaVersions: ["2026Q1"], previousRowCount: 20 };
  it("accepts a complete production full delivery", () => {
    expect(evaluateDelivery(base(), opts)).toEqual({ complete: true, canCommitSnapshot: true, canInferRemovals: true, reasons: [] });
  });
  it("missing, duplicate, checksum mismatch, no evidence", () => {
    const miss = evaluateDelivery(base({ parts: [part(1)] }), opts);
    expect(miss.complete).toBe(false);
    expect(miss.reasons).toContain("missing_parts:2");
    expect(miss.canInferRemovals).toBe(false);
    const dup = evaluateDelivery(base({ parts: [part(1), part(2), part(2)] }), opts);
    expect(dup.complete).toBe(false);
    expect(dup.reasons).toContain("duplicate_parts:2");
    const bad = evaluateDelivery(base({ parts: [part(1), { ...part(2), actualChecksum: "zz" }] }), opts);
    expect(bad.complete).toBe(false);
    expect(bad.reasons).toContain("checksum_mismatch:2");
    const none = evaluateDelivery(base({ completionEvidence: "none" }), opts);
    expect(none.complete).toBe(false);
    expect(none.canCommitSnapshot).toBe(false);
    expect(evaluateDelivery(base({ expectedParts: null }), opts).complete).toBe(false);
  });
  it("release_test never commits; inactive schema blocks; row mismatch blocks", () => {
    const rt = evaluateDelivery(base({ environment: "release_test" }), opts);
    expect(rt.complete).toBe(true);
    expect(rt.canCommitSnapshot).toBe(false);
    expect(rt.canInferRemovals).toBe(false);
    expect(evaluateDelivery(base({ schemaVersion: "2026Q2" }), opts).canCommitSnapshot).toBe(false);
    expect(evaluateDelivery(base({ expectedRowCount: 99 }), opts).canCommitSnapshot).toBe(false);
  });
  it("delta never infers removals; large drop blocks inference", () => {
    const delta = evaluateDelivery(base({ scope: "delta" }), opts);
    expect(delta.canCommitSnapshot).toBe(true);
    expect(delta.canInferRemovals).toBe(false);
    const drop = evaluateDelivery(base({ expectedRowCount: 20 }), { ...opts, previousRowCount: 100 });
    expect(drop.canCommitSnapshot).toBe(true);
    expect(drop.canInferRemovals).toBe(false);
    expect(drop.reasons.some((r) => r.startsWith("suspicious_row_drop"))).toBe(true);
    expect(evaluateDelivery(base(), { ...opts, previousRowCount: 25 }).canInferRemovals).toBe(true);
  });
});

describe("deliveryTimeline", () => {
  it("marks late, pending, done and failed stages separately", () => {
    const t = deliveryTimeline(
      { expectedAt: "2026-01-01T06:00:00Z", receivedAt: "2026-01-01T07:00:00Z", completedAt: "2026-01-01T07:05:00Z", failures: { validated: "schema_mismatch" } },
      "2026-01-01T12:00:00Z", 30,
    );
    expect(t.map((s) => s.stage)).toEqual(["expected", "received", "complete", "validated", "imported", "enriched"]);
    expect(t.map((s) => s.status)).toEqual(["done", "done", "done", "failed", "pending", "pending"]);
    const late = deliveryTimeline({ expectedAt: "2026-01-01T06:00:00Z" }, "2026-01-01T06:20:00Z", 30);
    expect(late[1].status).toBe("pending");
    const later = deliveryTimeline({ expectedAt: "2026-01-01T06:00:00Z" }, "2026-01-01T06:31:00Z", 30);
    expect(later[1].status).toBe("late");
    const imp = deliveryTimeline({ expectedAt: "2026-01-01T06:00:00Z", receivedAt: "2026-01-01T06:01:00Z", deadlines: { imported: "2026-01-01T08:00:00Z" } }, "2026-01-01T09:00:00Z", 0);
    expect(imp[4].status).toBe("late");
  });
});

describe("verifyBulkWebhook", () => {
  const secret = "test-secret";
  const body = enc.encode('{"delivery":"d1"}');
  const now = new Date("2026-01-01T00:00:00Z");
  const ts = String(Math.floor(now.getTime() / 1000));
  async function sign(t: string, b: Uint8Array, s = secret) {
    const key = await crypto.subtle.importKey("raw", enc.encode(s), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const mac = await crypto.subtle.sign("HMAC", key, new Uint8Array([...enc.encode(`${t}.`), ...b]));
    return [...new Uint8Array(mac)].map((x) => x.toString(16).padStart(2, "0")).join("");
  }
  const cfg = { signatureHeader: "x-sig", timestampHeader: "x-ts", secret, now };
  it("fails closed when not configured", async () => {
    const h = { "x-sig": "a", "x-ts": ts };
    expect((await verifyBulkWebhook({ rawBody: body, headers: h, ...cfg, secret: null })).reason).toBe("not_configured");
    expect((await verifyBulkWebhook({ rawBody: body, headers: h, ...cfg, signatureHeader: null })).reason).toBe("not_configured");
    expect((await verifyBulkWebhook({ rawBody: body, headers: h, ...cfg, timestampHeader: null })).reason).toBe("not_configured");
  });
  it("rejects bad signature and stale timestamp", async () => {
    const r = await verifyBulkWebhook({ rawBody: body, headers: { "x-sig": "deadbeef", "x-ts": ts }, ...cfg });
    expect(r).toEqual({ ok: false, reason: "bad_signature" });
    const old = String(Number(ts) - 1000);
    const stale = await verifyBulkWebhook({ rawBody: body, headers: { "x-sig": await sign(old, body), "x-ts": old }, ...cfg });
    expect(stale.reason).toBe("stale_timestamp");
    expect((await verifyBulkWebhook({ rawBody: body, headers: { "x-ts": ts }, ...cfg })).reason).toBe("missing_signature");
  });
  it("accepts a good signature and returns the digest", async () => {
    const sig = await sign(ts, body);
    const r = await verifyBulkWebhook({ rawBody: body, headers: new Headers({ "X-Sig": sig, "X-TS": ts }), ...cfg });
    expect(r).toEqual({ ok: true, reason: "ok", digest: sig });
    const tampered = await verifyBulkWebhook({ rawBody: enc.encode("{}"), headers: { "x-sig": sig, "x-ts": ts }, ...cfg });
    expect(tampered.ok).toBe(false);
  });
});
