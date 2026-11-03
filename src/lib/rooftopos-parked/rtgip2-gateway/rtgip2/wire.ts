// PROPOSED for Rooftop Vehicle Signal Hub (Lovable f8ad9239). Not applied anywhere.
// Gateway-local wire policy for the rtgip/2 ingress (D7). It runs on raw bytes BEFORE the
// shared verifyDelivery(), which takes a string and so cannot see BOMs, invalid UTF-8 or the
// true wire length. Nothing here changes the shared rtgip/2 contract or any legacy endpoint.

import { MAX_BODY_BYTES } from "./core";

export const STRICT_BODY_POLICY = "gw.rtgip2-wire/1" as const;
export const MAX_DEPTH = 16;
export const MAX_NODES = 4096;
export const RECEIVE_DEADLINE_MS = 5_000;

export type WireReject =
  | "body_too_large"
  | "receive_timeout"
  | "content_length_mismatch"
  | "bom_forbidden"
  | "invalid_utf8"
  | "malformed_json"
  | "duplicate_key"
  | "depth_exceeded"
  | "node_limit_exceeded"
  | "non_integer_number"
  | "nul_escape_forbidden"
  | "lone_surrogate_forbidden"
  | "trailing_bytes";

export class WireError extends Error {
  constructor(public code: WireReject) {
    super(code);
  }
}

/**
 * Read at most MAX_BODY_BYTES from a stream, aborting the read when the limit or the deadline
 * is exceeded. The body is never buffered beyond the limit plus one chunk.
 */
export async function readBounded(
  stream: ReadableStream<Uint8Array> | null,
  declaredLength: string | null,
  deadlineMs = RECEIVE_DEADLINE_MS,
  maxBytes = MAX_BODY_BYTES,
): Promise<Uint8Array> {
  if (declaredLength !== null) {
    if (!/^\d{1,9}$/.test(declaredLength)) throw new WireError("content_length_mismatch");
    if (Number(declaredLength) > maxBytes) throw new WireError("body_too_large");
  }
  if (!stream) return new Uint8Array(0);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new WireError("receive_timeout")), deadlineMs);
  });
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new WireError("body_too_large");
      chunks.push(value);
    }
  } catch (err) {
    await reader.cancel().catch(() => undefined);
    throw err;
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  if (declaredLength !== null && Number(declaredLength) !== total)
    throw new WireError("content_length_mismatch");
  return out;
}

/** Fatal UTF-8 decode. A BOM is refused, never stripped (TextDecoder strips it by default). */
export function decodeStrict(bytes: Uint8Array): string {
  if (bytes.byteLength > MAX_BODY_BYTES) throw new WireError("body_too_large");
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    throw new WireError("bom_forbidden");
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new WireError("invalid_utf8");
  }
}

/**
 * Linear structural scan of the decoded body: RFC 8259 grammar, duplicate keys, depth and
 * node limits, integers only, and no \u0000 or lone-surrogate escapes (PostgreSQL jsonb
 * refuses both, so admitting them would create poison rows at the Gateway or the target).
 */
export function scanStrictJson(text: string): void {
  let i = 0;
  let nodes = 0;
  const n = text.length;
  const fail = (c: WireReject): never => {
    throw new WireError(c);
  };
  const ws = () => {
    while (i < n && (text[i] === " " || text[i] === "\t" || text[i] === "\n" || text[i] === "\r"))
      i++;
  };
  const str = (): string => {
    if (text[i] !== '"') fail("malformed_json");
    i++;
    let out = "";
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 0x22) {
        i++;
        return out;
      }
      if (c < 0x20) fail("malformed_json");
      if (c === 0x5c) {
        const e = text[i + 1];
        if (e === "u") {
          const h = text.slice(i + 2, i + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(h)) fail("malformed_json");
          const cp = parseInt(h, 16);
          if (cp === 0) fail("nul_escape_forbidden");
          if (cp >= 0xd800 && cp <= 0xdbff) {
            const lo = text.slice(i + 6, i + 12);
            if (!/^\\u[dD][c-fC-F][0-9a-fA-F]{2}$/.test(lo)) fail("lone_surrogate_forbidden");
            out += String.fromCharCode(cp, parseInt(lo.slice(2), 16));
            i += 12;
            continue;
          }
          if (cp >= 0xdc00 && cp <= 0xdfff) fail("lone_surrogate_forbidden");
          out += String.fromCharCode(cp);
          i += 6;
          continue;
        }
        const map: Record<string, string> = {
          '"': '"',
          "\\": "\\",
          "/": "/",
          b: "\b",
          f: "\f",
          n: "\n",
          r: "\r",
          t: "\t",
        };
        if (e === undefined || !(e in map)) fail("malformed_json");
        out += map[e as string];
        i += 2;
        continue;
      }
      if (c >= 0xd800 && c <= 0xdbff) {
        const next = text.charCodeAt(i + 1);
        if (!(next >= 0xdc00 && next <= 0xdfff)) fail("lone_surrogate_forbidden");
        out += text.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (c >= 0xdc00 && c <= 0xdfff) fail("lone_surrogate_forbidden");
      out += text[i];
      i++;
    }
    return fail("malformed_json");
  };
  const value = (depth: number): void => {
    if (depth > MAX_DEPTH) fail("depth_exceeded");
    if (++nodes > MAX_NODES) fail("node_limit_exceeded");
    ws();
    const c = text[i];
    if (c === "{") {
      i++;
      const keys = new Set<string>();
      ws();
      if (text[i] === "}") {
        i++;
        return;
      }
      for (;;) {
        ws();
        const k = str();
        if (keys.has(k)) fail("duplicate_key");
        keys.add(k);
        ws();
        if (text[i] !== ":") fail("malformed_json");
        i++;
        value(depth + 1);
        ws();
        if (text[i] === ",") {
          i++;
          continue;
        }
        if (text[i] === "}") {
          i++;
          return;
        }
        fail("malformed_json");
      }
    }
    if (c === "[") {
      i++;
      ws();
      if (text[i] === "]") {
        i++;
        return;
      }
      for (;;) {
        value(depth + 1);
        ws();
        if (text[i] === ",") {
          i++;
          continue;
        }
        if (text[i] === "]") {
          i++;
          return;
        }
        fail("malformed_json");
      }
    }
    if (c === '"') {
      str();
      return;
    }
    for (const lit of ["true", "false", "null"])
      if (text.startsWith(lit, i)) {
        i += lit.length;
        return;
      }
    const m = /^-?(0|[1-9]\d*)([.eE][-+0-9.eE]*)?/.exec(text.slice(i, i + 40));
    if (!m) return fail("malformed_json");
    if (m[2]) fail("non_integer_number");
    if (!Number.isSafeInteger(Number(m[0]))) fail("non_integer_number");
    i += m[0].length;
  };
  value(0);
  ws();
  if (i !== n) fail("trailing_bytes");
}

/** Bytes -> verified-decodable string, or a typed refusal. Order: size, BOM, UTF-8, structure. */
export function strictBody(bytes: Uint8Array): string {
  const text = decodeStrict(bytes);
  scanStrictJson(text);
  return text;
}
