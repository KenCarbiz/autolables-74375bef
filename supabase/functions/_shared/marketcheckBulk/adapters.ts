// Schema-independent record readers (CSV, JSONL, Parquet) plus a streaming
// ingest loop that applies the schema and resource limits. Separate from the
// Files.com dealer CSV parser; shares nothing with it.

import { validateRecord, type FeedSchema, type FeedSource, type RecordIssue } from "./schema.ts";
import { BulkFeedError, lines, type ResourceLimits } from "./stream.ts";

// A malformed row is NOT thrown: it is yielded with `error` set and raw = {}
// so one bad row never aborts a large file. ingestRecords counts it as invalid.
export type RawRow = { rowNumber: number; raw: Record<string, unknown>; error?: string };

export interface RecordAdapter {
  format: FeedSource;
  // `input` is the already decompressed + byte-limited stream (null for parquet).
  records(input: ReadableStream<Uint8Array> | null, limits: ResourceLimits): AsyncGenerator<RawRow>;
}

export interface ParquetReader {
  rowCount(): Promise<number>;
  readRows(offset: number, limit: number): Promise<Record<string, unknown>[]>;
}

type CsvState = "start" | "unquoted" | "quoted" | "quote_in_quoted";

// RFC 4180 streaming parser. rowNumber counts data rows (header excluded), 1-based.
// maxLineBytes bounds one whole record (including embedded newlines), in UTF-16 units.
export const csvAdapter: RecordAdapter = {
  format: "csv",
  async *records(input, limits) {
    if (!input) throw new BulkFeedError("input_required");
    const reader = input.getReader();
    const decoder = new TextDecoder("utf-8");
    let header: string[] | null = null;
    let state = "start" as CsvState;
    let field = "";
    let fields: string[] = [];
    let recLen = 0;
    let skipLF = false;
    let rowNo = 0;
    let first = true;
    let malformed = false;
    const ready: RawRow[] = [];

    const endField = () => { fields.push(field); field = ""; };
    const endRow = () => {
      const blank = fields.length === 0 && field === "" && state === "start";
      if (!blank) {
        endField();
        if (!header) {
          const seen = new Set<string>();
          for (const h of fields) {
            if (h === "") throw new BulkFeedError("empty_header");
            if (seen.has(h)) throw new BulkFeedError("duplicate_header", false, `duplicate_header: ${h}`);
            seen.add(h);
          }
          header = fields;
        } else {
          rowNo++;
          if (malformed) ready.push({ rowNumber: rowNo, raw: {}, error: "malformed_quote" });
          else if (fields.length !== header.length) {
            ready.push({ rowNumber: rowNo, raw: {}, error: `column_count_mismatch: expected ${header.length}, got ${fields.length}` });
          } else {
            const raw: Record<string, unknown> = {};
            header.forEach((h, i) => { raw[h] = fields[i]; });
            ready.push({ rowNumber: rowNo, raw });
          }
        }
      }
      fields = []; field = ""; state = "start"; recLen = 0; malformed = false;
    };

    const feed = (text: string) => {
      for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (skipLF) { skipLF = false; if (c === "\n") continue; }
        if (++recLen > limits.maxLineBytes) throw new BulkFeedError("line_too_long");
        if (state === "quoted") {
          if (c === '"') state = "quote_in_quoted"; else field += c;
        } else if (state === "quote_in_quoted") {
          if (c === '"') { field += '"'; state = "quoted"; }
          else if (c === ",") { endField(); state = "start"; }
          else if (c === "\n" || c === "\r") { if (c === "\r") skipLF = true; endRow(); }
          else { malformed = true; field += c; state = "unquoted"; }
        } else if (c === ",") { endField(); state = "start"; }
        else if (c === "\n" || c === "\r") { if (c === "\r") skipLF = true; endRow(); }
        else if (c === '"' && state === "start") state = "quoted";
        else { field += c; state = "unquoted"; }
      }
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        let text = decoder.decode(value, { stream: true });
        if (first && text.length) { first = false; if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); }
        feed(text);
        while (ready.length) yield ready.shift() as RawRow;
      }
      feed(decoder.decode());
      if (state === "quoted") throw new BulkFeedError("unterminated_quote");
      if (fields.length > 0 || field !== "" || state !== "start") endRow();
      if (!header) throw new BulkFeedError("missing_header");
      while (ready.length) yield ready.shift() as RawRow;
    } finally {
      try { reader.releaseLock(); } catch { /* ignore */ }
    }
  },
};

// One JSON object per line; blank lines skipped. rowNumber is the 1-based line
// number of the file (blank lines count), so it can be found in the source.
export const jsonlAdapter: RecordAdapter = {
  format: "jsonl",
  async *records(input, limits) {
    if (!input) throw new BulkFeedError("input_required");
    let lineNo = 0;
    for await (const line of lines(input, limits.maxLineBytes)) {
      lineNo++;
      if (line.trim() === "") continue;
      let parsed: unknown;
      try { parsed = JSON.parse(line); } catch { yield { rowNumber: lineNo, raw: {}, error: "invalid_json" }; continue; }
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        yield { rowNumber: lineNo, raw: {}, error: "not_an_object" };
        continue;
      }
      yield { rowNumber: lineNo, raw: parsed as Record<string, unknown> };
    }
  },
};

// The real Parquet reader is injected (no dependency here). Row groups are read
// in bounded batches. A file declaring more than maxRows fails before any read.
export function parquetAdapter(reader: ParquetReader, batchSize = 5000): RecordAdapter {
  return {
    format: "parquet",
    async *records(_input, limits) {
      const total = await reader.rowCount();
      if (total > limits.maxRows) throw new BulkFeedError("row_limit_exceeded");
      let offset = 0;
      while (offset < total) {
        const n = Math.min(batchSize, total - offset);
        const rows = await reader.readRows(offset, n);
        if (rows.length === 0) throw new BulkFeedError("parquet_short_read");
        for (let i = 0; i < rows.length; i++) yield { rowNumber: offset + i + 1, raw: rows[i] };
        offset += rows.length;
      }
    },
  };
}

export type IngestBatchItem = { rowNumber: number; record: Record<string, unknown> };
export type IngestErrorSample = RecordIssue & { rowNumber: number };
export type IngestSummary = {
  rows: number; valid: number; invalid: number;
  errorsSample: IngestErrorSample[];
  unknownFields: string[]; deprecatedFieldsSeen: string[];
  missingRequiredCount: number;
};

const SAMPLE_MAX = 50;

// Streams rows, validates each against the schema, and hands valid rows to
// onBatch in groups of batchSize. Only one batch is held in memory.
// maxErrors counts invalid rows; exceeding it aborts with "too_many_errors".
// Rows with missing required fields are invalid.
export async function ingestRecords(
  adapter: RecordAdapter,
  input: ReadableStream<Uint8Array> | null,
  schema: FeedSchema,
  limits: ResourceLimits,
  onBatch: (batch: IngestBatchItem[], batchNo: number) => Promise<void>,
  batchSize = 1000,
): Promise<IngestSummary> {
  const s: IngestSummary = { rows: 0, valid: 0, invalid: 0, errorsSample: [], unknownFields: [], deprecatedFieldsSeen: [], missingRequiredCount: 0 };
  const unknown = new Set<string>();
  const deprecated = new Set<string>();
  let batch: IngestBatchItem[] = [];
  let batchNo = 0;
  const sample = (rowNumber: number, field: string, error: string) => {
    if (s.errorsSample.length < SAMPLE_MAX) s.errorsSample.push({ rowNumber, field, error });
  };
  const flush = async () => {
    if (!batch.length) return;
    const b = batch; batch = [];
    await onBatch(b, ++batchNo);
  };

  for await (const row of adapter.records(input, limits)) {
    s.rows++;
    if (s.rows > limits.maxRows) throw new BulkFeedError("row_limit_exceeded");
    if (row.error) {
      s.invalid++;
      sample(row.rowNumber, "", row.error);
    } else {
      const v = validateRecord(schema, row.raw, adapter.format);
      v.unknownFields.forEach((f) => unknown.add(f));
      v.deprecatedFieldsSeen.forEach((f) => deprecated.add(f));
      if (v.missingRequired.length) s.missingRequiredCount++;
      if (v.errors.length || v.missingRequired.length) {
        s.invalid++;
        v.errors.forEach((e) => sample(row.rowNumber, e.field, e.error));
        v.missingRequired.forEach((m) => sample(row.rowNumber, m, "missing_required"));
      } else {
        s.valid++;
        batch.push({ rowNumber: row.rowNumber, record: v.record });
        if (batch.length >= batchSize) await flush();
      }
    }
    if (s.invalid > limits.maxErrors) throw new BulkFeedError("too_many_errors");
  }
  await flush();
  s.unknownFields = [...unknown].sort();
  s.deprecatedFieldsSeen = [...deprecated].sort();
  return s;
}
