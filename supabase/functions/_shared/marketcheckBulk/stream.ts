// Streaming helpers for large bulk feeds: decompression, byte caps, line splitting.
// Nothing here buffers a whole file.

export type ResourceLimits = { maxBytes: number; maxRows: number; maxLineBytes: number; maxErrors: number };
export type Compression = "none" | "gzip" | "zstd";

export class BulkFeedError extends Error {
  code: string;
  retryable: boolean;
  constructor(code: string, retryable = false, message?: string) {
    super(message ?? code);
    this.name = "BulkFeedError";
    this.code = code;
    this.retryable = retryable;
  }
}

export function decompress(stream: ReadableStream<Uint8Array>, compression: Compression): ReadableStream<Uint8Array> {
  if (compression === "none") return stream;
  if (compression === "gzip") {
    return stream.pipeThrough(new DecompressionStream("gzip") as unknown as TransformStream<Uint8Array, Uint8Array>);
  }
  // zstd needs an injected decoder once the contract is signed; fail closed until then.
  throw new BulkFeedError("compression_unsupported");
}

// Callers apply this both before decompression (wire bytes) and after it
// (decompressed bytes) so a small gzip bomb cannot expand past the cap.
export function limitBytes(stream: ReadableStream<Uint8Array>, maxBytes: number): ReadableStream<Uint8Array> {
  let seen = 0;
  return stream.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      seen += chunk.byteLength;
      if (seen > maxBytes) throw new BulkFeedError("byte_limit_exceeded");
      controller.enqueue(chunk);
    },
  }));
}

function concat(parts: Uint8Array[], total: number): Uint8Array {
  if (parts.length === 1) return parts[0];
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.byteLength; }
  return out;
}

// Splits on LF, strips a trailing CR, strips a leading BOM, yields a final
// unterminated line. Empty lines are yielded as "". maxLineBytes is checked on
// raw bytes before a line is decoded, so an endless line cannot exhaust memory.
export async function* lines(stream: ReadableStream<Uint8Array>, maxLineBytes: number): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8");
  let pending: Uint8Array[] = [];
  let pendingLen = 0;
  let first = true;
  const emit = (): string => {
    let text = decoder.decode(concat(pending, pendingLen));
    pending = []; pendingLen = 0;
    if (first) { first = false; if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); }
    return text.endsWith("\r") ? text.slice(0, -1) : text;
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      let start = 0;
      for (let i = 0; i < value.length; i++) {
        if (value[i] !== 0x0a) continue;
        const seg = value.subarray(start, i);
        if (pendingLen + seg.byteLength > maxLineBytes) throw new BulkFeedError("line_too_long");
        pending.push(seg); pendingLen += seg.byteLength;
        yield emit();
        start = i + 1;
      }
      if (start < value.length) {
        const seg = value.subarray(start);
        if (pendingLen + seg.byteLength > maxLineBytes) throw new BulkFeedError("line_too_long");
        pending.push(seg.slice()); pendingLen += seg.byteLength;
      }
    }
    if (pendingLen > 0) yield emit();
  } finally {
    try { reader.releaseLock(); } catch { /* ignore */ }
  }
}
