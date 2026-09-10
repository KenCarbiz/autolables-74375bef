// GENERATED — do not edit.
// Mirror of src/lib/market/hash.ts, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run `bun run sync:edge-sticker`.
// ── Deterministic digests for the audit trail ──────────────────────────────
//
// A valuation record has to answer "was this the same request, and the same
// response, as last time" from a stored string, in both the browser and Deno,
// synchronously. WebCrypto is async and its Node and Deno shims differ; a
// 64-bit FNV-1a over a canonical serialization is deterministic everywhere and
// is enough for change detection.
//
// It is NOT a cryptographic hash and nothing may treat it as tamper evidence.
// The signed-document archive has a real SHA-256 for that.

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK = 0xffffffffffffffffn;

/** JSON with keys sorted at every level, so key order can never move a digest. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

export function fnv1a64(input: string): string {
  let hash = FNV_OFFSET;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * FNV_PRIME) & MASK;
  }
  return hash.toString(16).padStart(16, "0");
}

export const digest = (value: unknown): string => fnv1a64(stableStringify(value));
