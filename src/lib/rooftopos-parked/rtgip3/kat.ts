// rtgip/3 known-answer-test support (freeze rtgip/3-contract-freeze/1). TEST SUPPORT ONLY: not an rtgip/3 transport
// implementation and not imported by any server path. Self-contained on purpose: WebCrypto only, no imports, no
// network, no secrets, so the identical file runs under Node, workerd (Cloudflare Workers) and Deno.
// It mirrors the contract text in docs/contracts/RTGIP3-CANDIDATE.md (message layouts, key checks, origin rules,
// chain rule). The production rtgip3/ modules (P3-2) must produce the same verdicts for every vector.

export const PROTOCOL3 = "rtgip/3" as const;
export const RECEIPT3 = "rtgip/3-receipt/3" as const;
export const QUERY3 = "rtgip/3-receipt-query/2" as const;
export const SIGNATURE_PREFIX3 = "rtgip3=";
export const MAX_SKEW_SECONDS = 300;
export const MAX_BODY_BYTES = 64 * 1024;
export const ORIGIN_MAX_AGE_S = 7 * 24 * 3600;
export const ATTEST = "rtgip/3-attest/1" as const;
export const ATTEST_MAX_AGE_S = 60;
export const PKCS8_ED25519_PREFIX = "302e020100300506032b657004220420";

const SIG3 = /^[0-9a-f]{128}$/;
const SIG2_HEADER = /^rtgip2=[0-9a-f]{64}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const TS = /^(0|[1-9][0-9]{0,11})$/;
const NONCE = /^[A-Za-z0-9_-]{16,128}$/;
const L = (1n << 252n) + 27742317777372353535851937790883648493n;
const P = (1n << 255n) - 19n;

export interface KeyRecord {
  alg: string;
  connection_ids: string[];
  fingerprint: string;
  key_id: string;
  not_after: number;
  not_before: number;
  owner: string;
  protocol: string;
  public_key: string;
  revoked_at: number | null;
  revoked_reason: string | null;
  status: string;
}
export interface KeyContext {
  keys: readonly KeyRecord[];
  /** key_id -> recordPin(record). Revocation for compromise removes the pin. */
  pins: Readonly<Record<string, string>>;
  now: number;
  /** The only key-id environment this node accepts: stg, prd, or kat in tests. */
  env: string;
}
export type Verdict = { ok: true } | { ok: false; reason: string };
const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });
const OK: Verdict = { ok: true };

const te = new TextEncoder();
export const utf8 = (s: string): Uint8Array => te.encode(s);
export const toHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
export function fromHex(h: string): Uint8Array {
  if (h.length % 2 !== 0 || !/^[0-9a-f]*$/.test(h)) throw new Error("bad_hex");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}
export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const bytes = typeof data === "string" ? utf8(data) : data;
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource)));
}
export const b64urlEncode = (s: string): string => {
  let bin = "";
  for (const b of utf8(s)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
export function b64urlDecode(s: string): string {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error("bad_b64url");
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** Same bytes as rtgip2 core canonicalize() for the value shapes rtgip/3 signs (sorted keys, safe integers). */
export function canonical(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("non_integer_number");
    return String(value);
  }
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (typeof value === "object") {
    const o = value as Record<string, unknown>;
    return (
      "{" +
      Object.keys(o)
        .filter((k) => o[k] !== undefined)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + canonical(o[k]))
        .join(",") +
      "}"
    );
  }
  throw new Error("non_canonical_value");
}

// ---------------------------------------------------------------------------
// Signed messages (contract section 2.2)
// ---------------------------------------------------------------------------

export const preimage3 = (keyId: string, signer: string, ts: string, nonce: string, scope: string, bodySha: string): string =>
  [PROTOCOL3, keyId, signer, ts, nonce, scope, bodySha].join("\n");
export const queryMessage = (keyId: string, signer: string, ts: string, nonce: string, bodySha: string): string =>
  [QUERY3, keyId, signer, ts, nonce, bodySha].join("\n");
export const receiptMessage = (unsignedReceipt: Record<string, unknown>): string => RECEIPT3 + "\n" + canonical(unsignedReceipt);
/** The rtgip/2 preimage, used only to build the "v2 message under a v3 key" negative. */
export const preimage2 = (keyId: string, signer: string, ts: string, nonce: string, scope: string, bodySha: string): string =>
  ["rtgip/2", keyId, signer, ts, nonce, scope, bodySha].join("\n");

export interface EnvelopeScopeFields {
  source_app: string;
  target_app: string;
  tenant_id: string;
  rooftop_id: string;
  event_type: string;
  schema_version: number | string;
  purpose: string;
  event_id: string;
}
export const scopeOf3 = (e: EnvelopeScopeFields): string =>
  [e.source_app, e.target_app, e.tenant_id, e.rooftop_id, e.event_type, String(e.schema_version), e.purpose, e.event_id].join(";");

// ---------------------------------------------------------------------------
// Ed25519 primitives
// ---------------------------------------------------------------------------

export const seedForKeyId = (keyId: string): Promise<string> => sha256Hex("rtgip3-kat/v1/" + keyId);

export async function importPrivate(seedHex: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("pkcs8", fromHex(PKCS8_ED25519_PREFIX + seedHex) as BufferSource, { name: "Ed25519" }, false, ["sign"]);
}
const asBytes = (m: string | Uint8Array): Uint8Array => (typeof m === "string" ? utf8(m) : m);
export async function signMessage(seedHex: string, message: string | Uint8Array): Promise<string> {
  const key = await importPrivate(seedHex);
  return toHex(new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, key, asBytes(message) as BufferSource)));
}
export async function publicKeyFromSeed(seedHex: string): Promise<string> {
  const jwk = await crypto.subtle.exportKey("jwk", await crypto.subtle.importKey("pkcs8", fromHex(PKCS8_ED25519_PREFIX + seedHex) as BufferSource, { name: "Ed25519" }, true, ["sign"]));
  const x = jwk.x ?? "";
  const bin = atob(x.replace(/-/g, "+").replace(/_/g, "/"));
  return toHex(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

const mod = (a: bigint, m = P): bigint => ((a % m) + m) % m;
function powmod(b: bigint, e: bigint, m = P): bigint {
  let r = 1n;
  b = mod(b, m);
  while (e > 0n) {
    if (e & 1n) r = (r * b) % m;
    b = (b * b) % m;
    e >>= 1n;
  }
  return r;
}
const inv = (a: bigint): bigint => powmod(a, P - 2n);
const D = mod(-121665n * inv(121666n));
const SQRT_M1 = powmod(2n, (P - 1n) / 4n);
type Pt = readonly [bigint, bigint];
const le = (b: Uint8Array): bigint => b.reduceRight((acc, x) => (acc << 8n) | BigInt(x), 0n);

function decodePoint(b: Uint8Array): Pt | null {
  if (b.length !== 32) return null;
  const v = le(b);
  const sign = (v >> 255n) & 1n;
  const y = v & ((1n << 255n) - 1n);
  if (y >= P) return null;
  const y2 = mod(y * y);
  const x2 = mod(mod(y2 - 1n) * inv(mod(D * y2 + 1n)));
  let x = powmod(x2, (P + 3n) / 8n);
  if (mod(x * x - x2) !== 0n) x = mod(x * SQRT_M1);
  if (mod(x * x - x2) !== 0n) return null;
  if (x === 0n && sign === 1n) return null;
  if ((x & 1n) !== sign) x = mod(-x);
  return [x, y];
}
function addPt(a: Pt, b: Pt): Pt {
  const k = mod(D * a[0] * b[0] * a[1] * b[1]);
  return [mod((a[0] * b[1] + a[1] * b[0]) * inv(1n + k)), mod((a[1] * b[1] + a[0] * b[0]) * inv(mod(1n - k)))];
}
export const isCanonicalPoint = (b: Uint8Array): boolean => decodePoint(b) !== null;
/** True for the eight small-order points and for any encoding that is not a canonical curve point. */
export function isUnusablePublicKey(pk: Uint8Array): boolean {
  const pt = decodePoint(pk);
  if (!pt) return true;
  let q: Pt = pt;
  for (let i = 0; i < 3; i++) q = addPt(q, q);
  return q[0] === 0n && q[1] === 1n;
}

/**
 * The rtgip/3 Ed25519 verify wrapper (check order 2.5, steps 7-8): signature length and canonical S < L are checked
 * explicitly, small-order and non-canonical public keys are refused, then WebCrypto decides. Fails closed.
 */
export async function verifyEd25519(pkHex: string, message: string | Uint8Array, sigHex: string): Promise<Verdict> {
  if (!SIG3.test(sigHex)) return fail("signature_malformed");
  const sig = fromHex(sigHex);
  if (le(sig.slice(32)) >= L) return fail("signature_malformed");
  if (decodePoint(sig.slice(0, 32)) === null) return fail("bad_signature");
  if (!HEX64.test(pkHex)) return fail("bad_signature");
  const pk = fromHex(pkHex);
  if (isUnusablePublicKey(pk)) return fail("bad_signature");
  try {
    const key = await crypto.subtle.importKey("raw", pk as BufferSource, { name: "Ed25519" }, false, ["verify"]);
    const ok = await crypto.subtle.verify({ name: "Ed25519" }, key, sig as BufferSource, asBytes(message) as BufferSource);
    return ok ? OK : fail("bad_signature");
  } catch {
    return fail("bad_signature");
  }
}

// ---------------------------------------------------------------------------
// Key resolution (check order 2.5, step 3)
// ---------------------------------------------------------------------------

/** The pin digest: everything about a key except the fields that legitimately change after issue: revocation state and connection_ids (tenant onboarding). */
export function recordPin(k: KeyRecord): Promise<string> {
  const { status: _s, revoked_at: _r, revoked_reason: _q, connection_ids: _c, ...fixed } = k;
  return sha256Hex(canonical(fixed));
}

/** `at` is the instant the key must also be valid at (receipt issued_at, origin timestamp). */
export async function resolveKey(
  ctx: KeyContext,
  keyId: string,
  owner: string,
  at?: number,
): Promise<{ ok: true; key: KeyRecord } | { ok: false; reason: string }> {
  const m = new RegExp(`^${ctx.env}-(gateway|autolabels|autocurb|autoframe)-ed[1-9][0-9]{0,3}$`).exec(keyId);
  const key = ctx.keys.find((k) => k.key_id === keyId);
  if (!key || !m) return fail("unknown_key");
  const pinned = ctx.pins[keyId];
  if (pinned === undefined || pinned !== (await recordPin(key))) return fail("key_not_pinned");
  if (!HEX64.test(key.public_key) || (await sha256Hex(fromHex(key.public_key))) !== key.fingerprint) return fail("key_not_pinned");
  if (key.protocol !== PROTOCOL3) return fail("key_dialect_mismatch");
  if (key.alg !== "ed25519") return fail("alg_mismatch");
  if (key.status === "revoked" || key.revoked_at !== null) return fail("key_revoked");
  if (ctx.now < key.not_before || ctx.now > key.not_after) return fail("key_outside_validity");
  if (at !== undefined && (at < key.not_before || at > key.not_after)) return fail("key_outside_validity");
  if (key.owner !== m[1] || key.owner !== owner) return fail("signer_key_mismatch");
  return { ok: true, key };
}

// ---------------------------------------------------------------------------
// Per-kind verdicts
// ---------------------------------------------------------------------------

export interface SignedHeaders3 {
  "rtgip-protocol": string;
  "rtgip-key-id": string;
  "rtgip-signer": string;
  "rtgip-timestamp": string;
  "rtgip-nonce": string;
  "rtgip-scope": string;
  "rtgip-signature": string;
}

/** H1 envelope (expected "source") or H2 forward (expected "gateway"): steps 1-8 of the check order. */
export async function verifySigned3(
  h: SignedHeaders3,
  body: string,
  expectedSigner: "source" | "gateway",
  ctx: KeyContext,
  connectionId?: string,
): Promise<Verdict> {
  if (h["rtgip-protocol"] !== PROTOCOL3) return fail("protocol_mismatch");
  if (!h["rtgip-signature"].startsWith(SIGNATURE_PREFIX3)) return fail("protocol_mismatch");
  if (!NONCE.test(h["rtgip-nonce"])) return fail("invalid_nonce");
  const r = await resolveKey(ctx, h["rtgip-key-id"], h["rtgip-signer"]);
  if (!r.ok) return r;
  if (expectedSigner === "gateway" && h["rtgip-signer"] !== "gateway") return fail("signer_not_gateway");
  if (expectedSigner === "source" && h["rtgip-signer"] === "gateway") return fail("signer_not_source");
  const ts = h["rtgip-timestamp"];
  if (!TS.test(ts) || Math.abs(ctx.now - Number(ts)) > MAX_SKEW_SECONDS) return fail("timestamp_out_of_window");
  if (utf8(body).length > MAX_BODY_BYTES) return fail("body_too_large");
  if (body.startsWith("\uFEFF")) return fail("malformed_json");
  const msg = preimage3(h["rtgip-key-id"], h["rtgip-signer"], ts, h["rtgip-nonce"], h["rtgip-scope"], await sha256Hex(body));
  const v = await verifyEd25519(r.key.public_key, msg, h["rtgip-signature"].slice(SIGNATURE_PREFIX3.length));
  if (!v.ok || connectionId === undefined) return v;
  return r.key.connection_ids.includes(connectionId) ? OK : fail("key_not_bound_to_connection");
}

export interface QueryHeaders3 {
  "rtgip-key-id": string;
  "rtgip-signer": string;
  "rtgip-timestamp": string;
  "rtgip-nonce": string;
  "rtgip-signature": string;
}
export async function verifyQuery3(h: QueryHeaders3, body: string, ctx: KeyContext): Promise<Verdict> {
  if (!h["rtgip-signature"].startsWith(SIGNATURE_PREFIX3)) return fail("protocol_mismatch");
  if (!NONCE.test(h["rtgip-nonce"])) return fail("invalid_nonce");
  const r = await resolveKey(ctx, h["rtgip-key-id"], h["rtgip-signer"]);
  if (!r.ok) return r;
  if (h["rtgip-signer"] === "gateway") return fail("signer_not_source");
  const ts = h["rtgip-timestamp"];
  if (!TS.test(ts) || Math.abs(ctx.now - Number(ts)) > MAX_SKEW_SECONDS) return fail("timestamp_out_of_window");
  const msg = queryMessage(h["rtgip-key-id"], h["rtgip-signer"], ts, h["rtgip-nonce"], await sha256Hex(body));
  return verifyEd25519(r.key.public_key, msg, h["rtgip-signature"].slice(SIGNATURE_PREFIX3.length));
}

/** What an rtgip/2 verifier does with a header: only `rtgip2=` plus 64 hex passes, so a v3 signature never does. */
export const v2PathShapeCheck = (signatureHeader: string): Verdict => (SIG2_HEADER.test(signatureHeader) ? OK : fail("protocol_mismatch"));

export interface OriginRecord {
  key_id: string;
  nonce: string;
  scope: string;
  signature: string;
  signer: string;
  timestamp: number;
}
export const encodeOrigin = (o: OriginRecord): string => b64urlEncode(canonical(o));

/** Target-side origin rules (contract 2.4): signer = source_app = key owner, scope matches, age <= 7 d, valid H1 signature. */
export async function verifyOrigin(
  originHeader: string | null,
  forwardedBody: string,
  forwardScope: string,
  envelope: EnvelopeScopeFields,
  ctx: KeyContext,
): Promise<Verdict> {
  if (originHeader === null || originHeader === "") return fail("origin_missing");
  let o: OriginRecord;
  try {
    const parsed = JSON.parse(b64urlDecode(originHeader)) as Record<string, unknown>;
    if (Object.keys(parsed).sort().join("|") !== "key_id|nonce|scope|signature|signer|timestamp") return fail("origin_mismatch");
    if (canonical(parsed) !== b64urlDecode(originHeader)) return fail("origin_mismatch");
    o = parsed as unknown as OriginRecord;
  } catch {
    return fail("origin_mismatch");
  }
  if (!Number.isSafeInteger(o.timestamp) || o.timestamp < 0 || ![o.key_id, o.nonce, o.scope, o.signature, o.signer].every((x) => typeof x === "string")) return fail("origin_mismatch");
  if (o.signer !== envelope.source_app) return fail("origin_mismatch");
  if (o.scope !== forwardScope || o.scope !== scopeOf3(envelope)) return fail("origin_mismatch");
  if (ctx.now - o.timestamp > ORIGIN_MAX_AGE_S || o.timestamp - ctx.now > MAX_SKEW_SECONDS) return fail("origin_too_old");
  if (!NONCE.test(o.nonce)) return fail("origin_mismatch");
  const r = await resolveKey(ctx, o.key_id, envelope.source_app, o.timestamp);
  if (!r.ok) return r;
  const v = await verifyEd25519(r.key.public_key, preimage3(o.key_id, o.signer, String(o.timestamp), o.nonce, o.scope, await sha256Hex(forwardedBody)), o.signature);
  return v.ok || v.reason === "signature_malformed" ? v : fail("origin_bad_signature");
}

// ---------------------------------------------------------------------------
// Receipts and chains (contract 2.4)
// ---------------------------------------------------------------------------

export type Stage = "gateway_admission" | "target_inbox" | "consumer_commit" | "gateway_confirmation";
export interface Receipt3 {
  protocol: string;
  receipt_version: number;
  kind: Stage;
  event_id: string;
  route: string;
  source_app: string;
  target_app: string;
  tenant_id: string;
  rooftop_id: string;
  connection_id: string;
  payload_sha256: string;
  envelope_sha256: string;
  delivery_id: string;
  issuer: string;
  recipient: string;
  outcome: string;
  issued_at: number;
  key_id: string;
  prev_receipt_sha256: string | null;
  signature: string;
}
const RECEIPT_FIELDS = "connection_id|delivery_id|envelope_sha256|event_id|issued_at|issuer|key_id|kind|outcome|payload_sha256|prev_receipt_sha256|protocol|receipt_version|recipient|rooftop_id|route|signature|source_app|target_app|tenant_id";
const OUTCOMES: Record<Stage, readonly string[]> = {
  gateway_admission: ["admitted"],
  target_inbox: ["applied", "duplicate", "stale_ignored", "held", "quarantined"],
  consumer_commit: ["applied", "stale_ignored"],
  gateway_confirmation: ["delivery_abandoned"],
};
export const receiptDigest3 = (r: Receipt3): Promise<string> => sha256Hex(canonical(r));
export const deliveryId3 = async (connection: string, eventId: string, targetApp: string, envelopeSha: string): Promise<string> =>
  sha256Hex(canonical([RECEIPT3, connection, eventId, targetApp, envelopeSha]));

function receiptShape(r: Receipt3): Verdict {
  if (Object.keys(r).sort().join("|") !== RECEIPT_FIELDS) return fail("invalid_receipt_shape");
  if (r.protocol !== RECEIPT3 || r.receipt_version !== 3) return fail("protocol_mismatch");
  if (!(r.kind in OUTCOMES) || !OUTCOMES[r.kind].includes(r.outcome)) return fail("invalid_receipt_shape");
  if (!Number.isSafeInteger(r.issued_at) || r.issued_at < 0) return fail("invalid_receipt_shape");
  if (![r.payload_sha256, r.envelope_sha256, r.delivery_id].every((x) => HEX64.test(x))) return fail("invalid_receipt_shape");
  if (r.prev_receipt_sha256 !== null && !HEX64.test(r.prev_receipt_sha256)) return fail("invalid_receipt_shape");
  if (!SIG3.test(r.signature)) return fail("signature_malformed");
  // Normative kind table for EVERY receipt check, not only chains: gateway stages are issued by the gateway to the
  // source; target stages by the target app to the gateway.
  const gw = r.kind === "gateway_admission" || r.kind === "gateway_confirmation";
  if (r.issuer !== (gw ? "gateway" : r.target_app)) return fail("ack_wrong_issuer");
  if (r.recipient !== (gw ? r.source_app : "gateway")) return fail("ack_wrong_recipient");
  return OK;
}

/** One receipt link: shape, key (owner = issuer, valid now and at issued_at), signature. */
export async function verifyReceipt3(r: Receipt3, ctx: KeyContext): Promise<Verdict> {
  const s = receiptShape(r);
  if (!s.ok) return s;
  const k = await resolveKey(ctx, r.key_id, r.issuer, r.issued_at);
  if (!k.ok) return k;
  if (r.issued_at > ctx.now + MAX_SKEW_SECONDS) return fail("timestamp_out_of_window");
  const { signature, ...unsigned } = r;
  return verifyEd25519(k.key.public_key, receiptMessage(unsigned), signature);
}

/** The receipt must describe this very delivery: every identity field, the delivery id, issuer and recipient. */
export async function receiptBinding(r: Receipt3, ctx: ChainContext): Promise<Verdict> {
  const e = ctx.envelope;
  const gw = r.kind === "gateway_admission" || r.kind === "gateway_confirmation";
  const want: Record<string, unknown> = {
    event_id: e.event_id, route: e.route, source_app: e.source_app, target_app: e.target_app, tenant_id: e.tenant_id,
    rooftop_id: e.rooftop_id, connection_id: ctx.connection_id, payload_sha256: e.payload_sha256,
    envelope_sha256: ctx.envelope_sha256, delivery_id: await deliveryId3(ctx.connection_id, e.event_id, e.target_app, ctx.envelope_sha256),
    issuer: gw ? "gateway" : e.target_app, recipient: gw ? e.source_app : "gateway",
  };
  for (const k of Object.keys(want)) if ((r as unknown as Record<string, unknown>)[k] !== want[k]) return fail(`ack_wrong_${k}`);
  return OK;
}

/** Target side of H2: the rtgip-admission-receipt header is mandatory, must be the Gateway's admission for this delivery. */
export async function verifyAdmission(header: string | null, ctx: ChainContext): Promise<Verdict> {
  if (header === null || header === "") return fail("admission_missing");
  let r: Receipt3;
  try {
    const text = b64urlDecode(header);
    r = JSON.parse(text) as Receipt3;
    if (canonical(r) !== text) return fail("invalid_receipt_shape");
  } catch {
    return fail("invalid_receipt_shape");
  }
  const v = await verifyReceipt3(r, ctx);
  if (!v.ok) return v;
  if (r.kind !== "gateway_admission") return fail("ack_wrong_stage");
  return receiptBinding(r, ctx);
}

export type ChainStatus = "gateway_admitted" | "consumer_committed" | "target_quarantined" | "pending" | "abandoned";
export interface ChainContext extends KeyContext {
  envelope: EnvelopeScopeFields & { route: string; payload_sha256: string };
  envelope_sha256: string;
  connection_id: string;
}

/** Source chain rule (contract 2.4). Every link is verified; nothing is trusted because a hash matches. */
export async function evaluateChain(chain: readonly Receipt3[], ctx: ChainContext): Promise<{ ok: true; status: ChainStatus } | { ok: false; reason: string }> {
  if (chain.length < 1 || chain.length > 3) return fail("chain_shape");
  let prev: Receipt3 | null = null;
  for (const r of chain) {
    const v = await verifyReceipt3(r, ctx);
    if (!v.ok) return v;
    const b = await receiptBinding(r, ctx);
    if (!b.ok) return b;
    if (prev === null) {
      if (r.kind !== "gateway_admission" || r.prev_receipt_sha256 !== null) return fail("ack_unexpected_previous_stage");
    } else {
      const required: Stage = r.kind === "consumer_commit" ? "target_inbox" : "gateway_admission";
      if (r.kind === "gateway_admission" || prev.kind !== required || r.prev_receipt_sha256 !== (await receiptDigest3(prev))) return fail("ack_missing_previous_stage");
      if (r.issued_at < prev.issued_at) return fail("ack_stage_time_reversed");
      if (r.kind === "consumer_commit" && (prev.outcome === "held" || prev.outcome === "quarantined" || (prev.outcome !== "duplicate" && prev.outcome !== r.outcome))) return fail("ack_commit_without_effect");
    }
    prev = r;
  }
  const [, second, third] = chain;
  if (chain.length === 1) return { ok: true, status: "gateway_admitted" };
  if (second?.kind === "gateway_confirmation") return chain.length === 2 ? { ok: true, status: "abandoned" } : fail("chain_shape");
  if (second?.kind !== "target_inbox") return fail("chain_shape");
  if (chain.length === 2) {
    if (second.outcome === "quarantined") return { ok: true, status: "target_quarantined" };
    return { ok: true, status: "pending" };
  }
  if (third?.kind === "consumer_commit") return { ok: true, status: "consumer_committed" };
  return fail("chain_shape");
}

// ---------------------------------------------------------------------------
// Version gate and source row pinning (contract: Coexistence)
// ---------------------------------------------------------------------------

export const V2_ACCEPT_MAX_S = 7 * 24 * 3600;
export interface ConnectionGate {
  connection_id: string;
  accept_protocols: string[];
  v3_added_at: number | null;
  v2_accept_until: number | null;
}
/**
 * The router in front of BOTH verifiers: resolve the connection, refuse before any state change when the presented
 * protocol is not accepted. Once rtgip/3 is in the accept set, rtgip/2 also needs a hard expiry (at most 7 days after
 * v3_added_at) and is refused past it, whatever the accept set still says.
 */
export function gateVerdict(c: ConnectionGate, presented: string, now: number): Verdict {
  if (!c.accept_protocols.includes(presented)) return fail("protocol_not_accepted");
  if (presented === "rtgip/2" && c.accept_protocols.includes("rtgip/3")) {
    if (c.v3_added_at === null || c.v2_accept_until === null) return fail("protocol_not_accepted");
    if (now > Math.min(c.v2_accept_until, c.v3_added_at + V2_ACCEPT_MAX_S)) return fail("protocol_not_accepted");
  }
  return OK;
}
/** A source verifies a response only in its outbox row's pinned protocol, through that protocol's entry point. */
export function sourceRowCheck(rowProtocol: string, entryProtocol: string, receiptProtocols: readonly string[]): Verdict {
  if (entryProtocol !== rowProtocol) return fail("protocol_mismatch");
  const want = rowProtocol === "rtgip/3" ? RECEIPT3 : "rtgip/2-receipt/2";
  return receiptProtocols.every((x) => x === want) ? OK : fail("protocol_mismatch");
}

// ---------------------------------------------------------------------------
// Attestation (rtgip/3-attest/1): what SQL checks before it records the edge's Ed25519 verdict
// ---------------------------------------------------------------------------

export interface AttestExpected { role: string; signer: string; key_id: string; message: string; sig: string; at: number }
const ITEM_FIELDS = "key_id|msg_sha256|pk_sha256|role|sig";
export async function verifyAttest(doc: unknown, expected: readonly AttestExpected[], ctx: KeyContext, dbNow: number): Promise<Verdict> {
  const d = doc as { attest?: unknown; verifier?: unknown; verified_at?: unknown; items?: unknown } | null;
  if (!d || typeof d !== "object" || Array.isArray(d) || Object.keys(d).sort().join("|") !== "attest|items|verified_at|verifier") return fail("attest_shape");
  if (d.attest !== ATTEST || typeof d.verifier !== "string" || !HEX64.test(d.verifier) || !Number.isSafeInteger(d.verified_at) || !Array.isArray(d.items)) return fail("attest_shape");
  const items = d.items as Record<string, unknown>[];
  for (const it of items) {
    if (!it || typeof it !== "object" || Object.keys(it).sort().join("|") !== ITEM_FIELDS) return fail("attest_shape");
    if (typeof it["role"] !== "string" || typeof it["key_id"] !== "string" || !HEX64.test(String(it["pk_sha256"])) || !HEX64.test(String(it["msg_sha256"])) || typeof it["sig"] !== "string") return fail("attest_shape");
  }
  if (Math.abs(dbNow - (d.verified_at as number)) > ATTEST_MAX_AGE_S) return fail("attest_stale");
  const roles = items.map((it) => String(it["role"])).sort().join("|");
  if (roles !== expected.map((e) => e.role).sort().join("|")) return fail("attest_missing");
  for (const e of expected) {
    const it = items.find((x) => x["role"] === e.role)!;
    if (it["key_id"] !== e.key_id) return fail("attest_key_mismatch");
    const k = await resolveKey({ ...ctx, now: dbNow }, e.key_id, e.signer, e.at);
    if (!k.ok) return k;
    if (it["pk_sha256"] !== k.key.fingerprint) return fail("attest_key_mismatch");
    if (it["msg_sha256"] !== (await sha256Hex(e.message))) return fail("attest_msg_mismatch");
    if (it["sig"] !== e.sig || !SIG3.test(e.sig) || le(fromHex(e.sig).slice(32)) >= L) return fail("attest_sig_mismatch");
  }
  return OK;
}

// ---------------------------------------------------------------------------
// The KAT file
// ---------------------------------------------------------------------------

export interface Rfc8032Vector { name: string; seed: string; public_key: string; message_hex: string; signature: string }
export interface KatVector {
  id: string;
  group: string;
  kind: "ed25519" | "envelope" | "forward" | "origin" | "receipt" | "query" | "chain" | "v2_path" | "gate" | "source_row" | "attest";
  direction?: string;
  message?: string;
  input: Record<string, unknown>;
  ctx?: { now?: number; unpin?: string[]; env?: string; patch?: { key_id: string; set: Partial<KeyRecord>; repin: boolean } };
  expect: { ok: true; status?: string } | { ok: false; reason: string };
}
export interface KatFile {
  schema: "rtgip3/kat/1";
  contract_freeze: string;
  test_only: true;
  key_env: string;
  warning: string;
  now: number;
  seed_derivation: string;
  pkcs8_prefix_hex: string;
  rfc8032: Rfc8032Vector[];
  keys: KeyRecord[];
  seeds: Record<string, string>;
  pins: Record<string, string>;
  vectors: KatVector[];
}

export interface VectorResult { id: string; ok: boolean; detail?: string | undefined }

async function ctxFor(kat: KatFile, v: KatVector): Promise<KeyContext> {
  const pins = { ...kat.pins };
  for (const id of v.ctx?.unpin ?? []) delete pins[id];
  let keys = kat.keys;
  const patch = v.ctx?.patch;
  if (patch) {
    keys = kat.keys.map((k) => (k.key_id === patch.key_id ? { ...k, ...patch.set } : k));
    if (patch.repin) pins[patch.key_id] = await recordPin(keys.find((k) => k.key_id === patch.key_id)!);
  }
  return { keys, pins, now: v.ctx?.now ?? kat.now, env: v.ctx?.env ?? kat.key_env };
}
const str = (o: Record<string, unknown>, k: string): string => String(o[k]);

async function verdictOf(kat: KatFile, v: KatVector): Promise<{ ok: true; status?: string } | { ok: false; reason: string }> {
  const c = await ctxFor(kat, v);
  const i = v.input;
  switch (v.kind) {
    case "ed25519": {
      return verifyEd25519(str(i, "public_key"), String(i["message"]), str(i, "signature"));
    }
    case "envelope":
      return verifySigned3(i["headers"] as SignedHeaders3, str(i, "body"), "source", c, i["connection_id"] === undefined ? undefined : str(i, "connection_id"));
    case "forward": {
      const f = await verifySigned3(i["headers"] as SignedHeaders3, str(i, "body"), "gateway", c, i["connection_id"] === undefined ? undefined : str(i, "connection_id"));
      if (!f.ok) return f;
      const env = JSON.parse(str(i, "body")) as EnvelopeScopeFields & { route: string; payload_sha256: string };
      const adm = await verifyAdmission((i["admission"] as string | null) ?? null, { ...c, envelope: env, envelope_sha256: await sha256Hex(str(i, "body")), connection_id: str(i, "connection_id") });
      if (!adm.ok) return adm;
      return verifyOrigin((i["origin"] as string | null) ?? null, str(i, "body"), (i["headers"] as SignedHeaders3)["rtgip-scope"], env, c);
    }
    case "origin": {
      const env = JSON.parse(str(i, "body")) as EnvelopeScopeFields;
      return verifyOrigin((i["origin"] as string | null) ?? null, str(i, "body"), str(i, "forward_scope"), env, c);
    }
    case "receipt":
      return verifyReceipt3(i["receipt"] as Receipt3, c);
    case "query":
      return verifyQuery3(i["headers"] as QueryHeaders3, str(i, "body"), c);
    case "gate":
      return gateVerdict(i["connection"] as ConnectionGate, str(i, "presented"), c.now);
    case "source_row":
      return sourceRowCheck(str(i, "row_protocol"), str(i, "entry_protocol"), i["receipt_protocols"] as string[]);
    case "attest":
      return verifyAttest(i["attest"], i["expected"] as AttestExpected[], c, Number(i["db_now"]));
    case "v2_path":
      return v2PathShapeCheck(str(i, "signature_header"));
    case "chain": {
      const body = str(i, "body");
      const envelope = JSON.parse(body) as ChainContext["envelope"];
      return evaluateChain(i["receipts"] as Receipt3[], { ...c, envelope, envelope_sha256: await sha256Hex(body), connection_id: str(i, "connection_id") });
    }
  }
}

/** Recompute every positive vector's signed message and compare it to the stored one, then check each verdict. */
export async function runKat(kat: KatFile): Promise<VectorResult[]> {
  const out: VectorResult[] = [];
  for (const r of kat.rfc8032) {
    const pk = await publicKeyFromSeed(r.seed);
    const msg = fromHex(r.message_hex);
    const sig = await signMessage(r.seed, msg);
    const v = await verifyEd25519(r.public_key, msg, r.signature);
    out.push({ id: `rfc8032:${r.name}`, ok: pk === r.public_key && sig === r.signature && v.ok, detail: `pk=${pk === r.public_key} sign=${sig === r.signature} verify=${v.ok}` });
  }
  for (const [keyId, seed] of Object.entries(kat.seeds)) {
    const rec = kat.keys.find((k) => k.key_id === keyId);
    const pk = await publicKeyFromSeed(seed);
    out.push({ id: `key:${keyId}`, ok: (await seedForKeyId(keyId)) === seed && rec?.public_key === pk && rec.fingerprint === (await sha256Hex(fromHex(pk))), detail: "seed, public key and fingerprint derivation" });
  }
  for (const v of kat.vectors) {
    const got = await verdictOf(kat, v);
    let ok = got.ok === v.expect.ok;
    if (ok && !got.ok && !v.expect.ok) ok = got.reason === v.expect.reason;
    if (ok && got.ok && v.expect.ok && v.expect.status !== undefined) ok = (got as { status?: string }).status === v.expect.status;
    out.push({ id: v.id, ok, detail: ok ? undefined : `expected ${JSON.stringify(v.expect)} got ${JSON.stringify(got)}` });
  }
  return out;
}

/** Positive signed-message vectors carry their message; recompute it from the vector's own fields. */
export async function recomputeMessages(kat: KatFile): Promise<VectorResult[]> {
  const out: VectorResult[] = [];
  for (const v of kat.vectors) {
    if (v.message === undefined) continue;
    const i = v.input;
    let m: string;
    if (v.kind === "envelope" || v.kind === "forward") {
      const h = i["headers"] as SignedHeaders3;
      m = preimage3(h["rtgip-key-id"], h["rtgip-signer"], h["rtgip-timestamp"], h["rtgip-nonce"], h["rtgip-scope"], await sha256Hex(str(i, "body")));
    } else if (v.kind === "query") {
      const h = i["headers"] as QueryHeaders3;
      m = queryMessage(h["rtgip-key-id"], h["rtgip-signer"], h["rtgip-timestamp"], h["rtgip-nonce"], await sha256Hex(str(i, "body")));
    } else if (v.kind === "receipt") {
      const { signature: _s, ...u } = i["receipt"] as Receipt3;
      m = receiptMessage(u);
    } else if (v.kind === "origin") {
      const o = JSON.parse(b64urlDecode(str(i, "origin"))) as OriginRecord;
      m = preimage3(o.key_id, o.signer, String(o.timestamp), o.nonce, o.scope, await sha256Hex(str(i, "body")));
    } else continue;
    out.push({ id: `message:${v.id}`, ok: m === v.message });
  }
  return out;
}

/** Ed25519 is deterministic: re-signing every positive message with its public test seed must reproduce the stored signature. */
export async function resignMessages(kat: KatFile): Promise<VectorResult[]> {
  const out: VectorResult[] = [];
  for (const v of kat.vectors) {
    if (v.message === undefined) continue;
    const i = v.input;
    let keyId: string;
    let sig: string;
    if (v.kind === "envelope" || v.kind === "forward" || v.kind === "query") {
      const h = i["headers"] as Record<string, string>;
      keyId = h["rtgip-key-id"] ?? "";
      sig = (h["rtgip-signature"] ?? "").slice(SIGNATURE_PREFIX3.length);
    } else if (v.kind === "receipt") {
      const r = i["receipt"] as Receipt3;
      keyId = r.key_id;
      sig = r.signature;
    } else if (v.kind === "origin") {
      const o = JSON.parse(b64urlDecode(str(i, "origin"))) as OriginRecord;
      keyId = o.key_id;
      sig = o.signature;
    } else continue;
    const seed = kat.seeds[keyId];
    out.push({ id: `resign:${v.id}`, ok: seed !== undefined && (await signMessage(seed, v.message)) === sig });
  }
  return out;
}
