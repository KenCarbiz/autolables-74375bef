// rtgip/3 transport (contract "Signed messages", "Forward and origin", "Verifier check order", "Coexistence"). The
// envelope body stays rtgip/2 and is checked by the frozen rtgip/2 helpers unchanged; only the transport signature
// (Ed25519 over the H1/H2 message with first line "rtgip/3"), the origin and the version gate are new. Pure: the
// caller supplies key records, pins, connections, the nonce store and the clock. Copied byte for byte into the apps.
import {
  authorize,
  canonicalize,
  deriveEventId,
  eventIdScopeOf,
  MAX_BODY_BYTES,
  MAX_SKEW_SECONDS,
  NONCE_TTL_SECONDS,
  payloadHash,
  scopeOf,
  validateEnvelope,
  type AppId,
  type EnvelopeV2,
  type NonceStore,
  type ServiceConnection,
} from "../rtgip2/core";
import { b64urlDecode, b64urlEncode, fail, OK, sha256Hex, signatureWellFormed, utf8, verifyEd25519, type SigningKey3, type Verdict } from "./sig";
import { resolveKey3, type KeyContext3, type PublicKeyRecord } from "./keys3";
import { verifyAdmissionHeader3, type ChainEnvelope, type Receipt3 } from "./receipt3";

export const PROTOCOL3 = "rtgip/3" as const;
export const SIGNATURE_PREFIX3 = "rtgip3=";
export const FORWARD3 = "rtgip/3-forward/1" as const;
export const ORIGIN_HEADER = "rtgip-origin";
export const ADMISSION_HEADER3 = "rtgip-admission-receipt";
export const ORIGIN_MAX_AGE_S = 7 * 24 * 3600;
export const V2_ACCEPT_MAX_S = 7 * 24 * 3600;
const TS = /^(0|[1-9][0-9]{0,11})$/;
const NONCE = /^[A-Za-z0-9_-]{16,128}$/;

export interface SignedHeaders3 {
  "rtgip-protocol": typeof PROTOCOL3;
  "rtgip-key-id": string;
  "rtgip-signer": string;
  "rtgip-timestamp": string;
  "rtgip-nonce": string;
  "rtgip-scope": string;
  "rtgip-signature": string;
}
export const HEADER_NAMES3 = [
  "rtgip-protocol",
  "rtgip-key-id",
  "rtgip-signer",
  "rtgip-timestamp",
  "rtgip-nonce",
  "rtgip-scope",
  "rtgip-signature",
] as const;

/** H1 envelope and H2 forward: the rtgip/2 preimage layout with first line "rtgip/3". */
export const preimage3 = (keyId: string, signer: string, ts: string, nonce: string, scope: string, bodySha: string): string =>
  [PROTOCOL3, keyId, signer, ts, nonce, scope, bodySha].join("\n");

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

/** Sign an H1 envelope (source key) or an H2 forward (Gateway key) over the exact canonical body bytes. */
export async function signEnvelopeV3(body: string, envelope: EnvelopeV2, key: SigningKey3, nowSec: number, nonce: string): Promise<SignedHeaders3> {
  if (!NONCE.test(nonce)) throw new Error("invalid_nonce");
  if (!Number.isSafeInteger(nowSec) || nowSec < 0) throw new Error("timestamp_out_of_window");
  if (canonicalize(JSON.parse(body)) !== body) throw new Error("body_not_canonical");
  const ts = String(nowSec);
  const scope = scopeOf(envelope);
  const signature = await key.sign(preimage3(key.key_id, key.owner, ts, nonce, scope, await sha256Hex(body)));
  return {
    "rtgip-protocol": PROTOCOL3,
    "rtgip-key-id": key.key_id,
    "rtgip-signer": key.owner,
    "rtgip-timestamp": ts,
    "rtgip-nonce": nonce,
    "rtgip-scope": scope,
    "rtgip-signature": SIGNATURE_PREFIX3 + signature,
  };
}

type HeaderBag = Partial<SignedHeaders3> | Record<string, string | undefined>;
const header = (h: HeaderBag, k: (typeof HEADER_NAMES3)[number]): string | undefined => (h as Record<string, string | undefined>)[k];

/**
 * Check order steps 1 to 8 on headers and raw bytes: protocol, header shape, key (pinned, rtgip/3, ed25519, not
 * revoked, valid now, owner = signer), signer role, timestamp window and encoding, body size, signature shape, Web
 * Crypto verify. With `connectionId`, step 11 (key bound to that connection) follows a valid signature.
 */
export async function verifySignature3(
  headers: HeaderBag,
  body: string,
  expectedSigner: "source" | "gateway",
  ctx: KeyContext3,
  connectionId?: string,
): Promise<{ ok: true; key: PublicKeyRecord } | { ok: false; reason: string }> {
  if (header(headers, "rtgip-protocol") !== PROTOCOL3) return fail("protocol_mismatch");
  const keyId = header(headers, "rtgip-key-id"),
    signer = header(headers, "rtgip-signer"),
    ts = header(headers, "rtgip-timestamp"),
    nonce = header(headers, "rtgip-nonce"),
    scope = header(headers, "rtgip-scope"),
    sig = header(headers, "rtgip-signature");
  if (!keyId || !signer || !ts || !nonce || !scope || !sig) return fail("missing_headers");
  if (!sig.startsWith(SIGNATURE_PREFIX3)) return fail("protocol_mismatch");
  if (!NONCE.test(nonce)) return fail("invalid_nonce");
  const r = await resolveKey3(ctx, keyId, signer);
  if (!r.ok) return r;
  if (expectedSigner === "gateway" && signer !== "gateway") return fail("signer_not_gateway");
  if (expectedSigner === "source" && signer === "gateway") return fail("signer_not_source");
  if (!TS.test(ts) || Math.abs(ctx.now - Number(ts)) > MAX_SKEW_SECONDS) return fail("timestamp_out_of_window");
  if (utf8(body).length > MAX_BODY_BYTES) return fail("body_too_large");
  if (body.startsWith("﻿")) return fail("malformed_json");
  const msg = preimage3(keyId, signer, ts, nonce, scope, await sha256Hex(body));
  const v = await verifyEd25519(r.key.public_key, msg, sig.slice(SIGNATURE_PREFIX3.length));
  if (!v.ok) return v;
  if (connectionId !== undefined && !r.key.connection_ids.includes(connectionId)) return fail("key_not_bound_to_connection");
  return { ok: true, key: r.key };
}

export interface VerifyContext3 {
  keys: KeyContext3;
  connections: readonly ServiceConnection[];
  nonces: NonceStore;
  /** The signer this endpoint accepts: the source app at Gateway admission, "gateway" at a target. */
  expectedSigner: "source" | "gateway";
  /** The app running this verifier when it is a target; checked against envelope.target_app. */
  receiver?: AppId;
}
export interface VerifiedDelivery3 {
  envelope: EnvelopeV2;
  body_sha256: string;
  key: PublicKeyRecord;
  headers: SignedHeaders3;
  connection_id: string;
  duplicate_delivery: boolean;
}
export type VerifyResult3 = { ok: true; delivery: VerifiedDelivery3 } | { ok: false; reason: string };

/**
 * Steps 1 to 11. The nonce is claimed only after the signature verified, so a forgery cannot burn a nonce. Step 12
 * (the connection accepts rtgip/3) and the dual-accept expiry are the version gate, gateVerdict, which the router in
 * front of both verifiers applies before any state change.
 */
export async function verifyDeliveryV3(headers: HeaderBag, rawBody: string, ctx: VerifyContext3): Promise<VerifyResult3> {
  const sig = await verifySignature3(headers, rawBody, ctx.expectedSigner, ctx.keys);
  if (!sig.ok) return sig;
  const h = headers as SignedHeaders3;
  const bodySha = await sha256Hex(rawBody);
  const claim = await ctx.nonces.claim(h["rtgip-key-id"], h["rtgip-nonce"], bodySha, Number(h["rtgip-timestamp"]) + NONCE_TTL_SECONDS, ctx.keys.now);
  if (claim === "conflict") return fail("nonce_reused");
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return fail("malformed_json");
  }
  try {
    if (canonicalize(parsed) !== rawBody) return fail("body_not_canonical");
  } catch {
    return fail("body_not_canonical");
  }
  const v = validateEnvelope(parsed);
  if ("errors" in v) {
    const first = v.errors[0];
    if (first === "unsupported_schema_version" || first === "unsupported_event_type" || first === "protocol_mismatch") return fail(first);
    return fail(`invalid_envelope:${v.errors.join(",")}`);
  }
  const e = v.envelope;
  if (scopeOf(e) !== h["rtgip-scope"]) return fail("scope_mismatch");
  if ((await payloadHash(e.payload)) !== e.payload_sha256) return fail("payload_hash_mismatch");
  if ((await deriveEventId(eventIdScopeOf(e))) !== e.event_id) return fail("event_id_not_derived");
  if (ctx.receiver && e.target_app !== ctx.receiver) return fail("wrong_destination");
  if (h["rtgip-signer"] !== "gateway" && h["rtgip-signer"] !== e.source_app) return fail("source_impersonation");
  const az = authorize(e, { connections: ctx.connections, keys: [] });
  if ("reason" in az) return fail(az.reason);
  if (!sig.key.connection_ids.includes(az.connection.connection_id)) return fail("key_not_bound_to_connection");
  return {
    ok: true,
    delivery: {
      envelope: e,
      body_sha256: bodySha,
      key: sig.key,
      headers: { ...h },
      connection_id: az.connection.connection_id,
      duplicate_delivery: claim === "exact_retry",
    },
  };
}

// ---------------------------------------------------------------------------
// Origin: the source's own H1 signature, copied unchanged into the forward and re-verified at the target.
// ---------------------------------------------------------------------------

export interface OriginRecord {
  key_id: string;
  nonce: string;
  scope: string;
  signature: string;
  signer: string;
  timestamp: number;
}
const ORIGIN_FIELDS = "key_id|nonce|scope|signature|signer|timestamp";

/** The origin of a verified H1 submission: its headers, the signature without the rtgip3= prefix, the timestamp as an integer. */
export function originOf(h: SignedHeaders3): OriginRecord {
  if (!TS.test(h["rtgip-timestamp"]) || !h["rtgip-signature"].startsWith(SIGNATURE_PREFIX3)) throw new Error("origin_mismatch");
  return {
    key_id: h["rtgip-key-id"],
    nonce: h["rtgip-nonce"],
    scope: h["rtgip-scope"],
    signature: h["rtgip-signature"].slice(SIGNATURE_PREFIX3.length),
    signer: h["rtgip-signer"],
    timestamp: Number(h["rtgip-timestamp"]),
  };
}
export const encodeOrigin = (o: OriginRecord): string => b64urlEncode(canonicalize(o));

/** The six-field canonical origin, or null when the header is not exactly that. */
export function decodeOrigin(originHeader: string): OriginRecord | null {
  try {
    const text = b64urlDecode(originHeader);
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.keys(parsed).sort().join("|") !== ORIGIN_FIELDS) return null;
    if (canonicalize(parsed) !== text) return null;
    const o = parsed as unknown as OriginRecord;
    if (!Number.isSafeInteger(o.timestamp) || o.timestamp < 0) return null;
    if (![o.key_id, o.nonce, o.scope, o.signature, o.signer].every((x) => typeof x === "string")) return null;
    return o;
  } catch {
    return null;
  }
}

/** Target-side origin rules: signer = source_app = key owner, scope matches, age at most 7 days, valid H1 signature. */
export async function verifyOrigin3(
  originHeader: string | null | undefined,
  forwardedBody: string,
  forwardScope: string,
  envelope: EnvelopeScopeFields,
  ctx: KeyContext3,
): Promise<Verdict> {
  if (originHeader === null || originHeader === undefined || originHeader === "") return fail("origin_missing");
  const o = decodeOrigin(originHeader);
  if (!o) return fail("origin_mismatch");
  if (o.signer !== envelope.source_app) return fail("origin_mismatch");
  if (o.scope !== forwardScope || o.scope !== scopeOf3(envelope)) return fail("origin_mismatch");
  if (ctx.now - o.timestamp > ORIGIN_MAX_AGE_S || o.timestamp - ctx.now > MAX_SKEW_SECONDS) return fail("origin_too_old");
  if (!NONCE.test(o.nonce)) return fail("origin_mismatch");
  const r = await resolveKey3(ctx, o.key_id, envelope.source_app, o.timestamp);
  if (!r.ok) return r;
  const msg = preimage3(o.key_id, o.signer, String(o.timestamp), o.nonce, o.scope, await sha256Hex(forwardedBody));
  const v = await verifyEd25519(r.key.public_key, msg, o.signature);
  return v.ok || v.reason === "signature_malformed" ? v : fail("origin_bad_signature");
}

export interface ForwardInput3 {
  headers: HeaderBag;
  body: string;
  admission: string | null | undefined;
  origin: string | null | undefined;
}

/**
 * The stateless part of a target's H2 check, before any database write: the Gateway's forward signature bound to the
 * connection, then the mandatory Gateway admission for this very delivery, then the source's origin over the same
 * bytes. The target's nonce claim, envelope checks and inbox engine follow (verifyDeliveryV3 and its SQL).
 */
export async function verifyForwardEvidence3(
  f: ForwardInput3,
  ctx: KeyContext3,
  connectionId: string,
): Promise<{ ok: true; admission: Receipt3 } | { ok: false; reason: string }> {
  const s = await verifySignature3(f.headers, f.body, "gateway", ctx, connectionId);
  if (!s.ok) return s;
  let envelope: EnvelopeScopeFields & ChainEnvelope;
  try {
    envelope = JSON.parse(f.body) as EnvelopeScopeFields & ChainEnvelope;
  } catch {
    return fail("malformed_json");
  }
  if (!envelope || typeof envelope !== "object") return fail("malformed_json");
  const adm = await verifyAdmissionHeader3(f.admission, {
    ...ctx,
    envelope,
    envelope_sha256: await sha256Hex(f.body),
    connection_id: connectionId,
  });
  if (!adm.ok) return adm;
  const o = await verifyOrigin3(f.origin, f.body, header(f.headers, "rtgip-scope") ?? "", envelope, ctx);
  return o.ok ? { ok: true, admission: adm.receipt } : o;
}

// ---------------------------------------------------------------------------
// Attestation (rtgip/3-attest/1): the edge's Ed25519 verdicts, handed to the SQL entry point it calls next.
// ---------------------------------------------------------------------------

export const ATTEST3 = "rtgip/3-attest/1" as const;
export const ATTEST_MAX_AGE_S = 60;
export interface AttestItem3 {
  role: string;
  key_id: string;
  pk_sha256: string;
  msg_sha256: string;
  sig: string;
}
export interface AttestDoc3 {
  attest: typeof ATTEST3;
  verifier: string;
  verified_at: number;
  items: AttestItem3[];
}
/** One item: only for a message this edge just verified (or signed and re-verified) with `key`. */
export async function attestItem3(role: string, key: PublicKeyRecord, message: string, sig: string): Promise<AttestItem3> {
  return { role, key_id: key.key_id, pk_sha256: key.fingerprint, msg_sha256: await sha256Hex(message), sig };
}
export function attestDoc3(verifier: string, verifiedAt: number, items: AttestItem3[]): AttestDoc3 {
  if (!/^[0-9a-f]{64}$/.test(verifier) || !Number.isSafeInteger(verifiedAt)) throw new Error("attest_shape");
  return { attest: ATTEST3, verifier, verified_at: verifiedAt, items };
}

export interface AttestExpected3 {
  role: string;
  signer: string;
  key_id: string;
  message: string;
  sig: string;
  at: number;
}
const ITEM_FIELDS = "key_id|msg_sha256|pk_sha256|role|sig";
/**
 * The checks the SQL entry points make on an attestation, in their order (attest.v1.json check_order): shape,
 * freshness against the database clock, exactly the expected roles, then per item the key id, the key row (resolved
 * at the role's instant), pk_sha256, msg_sha256 over the recomputed message and the received signature.
 */
export async function verifyAttest3(doc: unknown, expected: readonly AttestExpected3[], ctx: KeyContext3, dbNow: number): Promise<Verdict> {
  const d = doc as { attest?: unknown; verifier?: unknown; verified_at?: unknown; items?: unknown } | null;
  if (!d || typeof d !== "object" || Array.isArray(d) || Object.keys(d).sort().join("|") !== "attest|items|verified_at|verifier") return fail("attest_shape");
  if (d.attest !== ATTEST3 || typeof d.verifier !== "string" || !/^[0-9a-f]{64}$/.test(d.verifier) || !Number.isSafeInteger(d.verified_at) || !Array.isArray(d.items))
    return fail("attest_shape");
  const items = d.items as Record<string, unknown>[];
  for (const it of items) {
    if (!it || typeof it !== "object" || Array.isArray(it) || Object.keys(it).sort().join("|") !== ITEM_FIELDS) return fail("attest_shape");
    if (
      typeof it["role"] !== "string" ||
      typeof it["key_id"] !== "string" ||
      !/^[0-9a-f]{64}$/.test(String(it["pk_sha256"])) ||
      !/^[0-9a-f]{64}$/.test(String(it["msg_sha256"])) ||
      typeof it["sig"] !== "string"
    )
      return fail("attest_shape");
  }
  if (Math.abs(dbNow - (d.verified_at as number)) > ATTEST_MAX_AGE_S) return fail("attest_stale");
  const roles = items.map((it) => String(it["role"])).sort().join("|");
  if (roles !== expected.map((e) => e.role).sort().join("|")) return fail("attest_missing");
  for (const e of expected) {
    const it = items.find((x) => x["role"] === e.role)!;
    if (it["key_id"] !== e.key_id) return fail("attest_key_mismatch");
    const k = await resolveKey3({ ...ctx, now: dbNow }, e.key_id, e.signer, e.at);
    if (!k.ok) return k;
    if (it["pk_sha256"] !== k.key.fingerprint) return fail("attest_key_mismatch");
    if (it["msg_sha256"] !== (await sha256Hex(e.message))) return fail("attest_msg_mismatch");
    if (it["sig"] !== e.sig || !signatureWellFormed(e.sig)) return fail("attest_sig_mismatch");
  }
  return OK;
}

// ---------------------------------------------------------------------------
// Version gate and source row pinning (contract "Coexistence and the version gate")
// ---------------------------------------------------------------------------

export interface ConnectionGate {
  connection_id: string;
  accept_protocols: string[];
  v3_added_at: number | null;
  v2_accept_until: number | null;
}

/**
 * The router in front of BOTH verifiers: refuse before any state change when the presented protocol is not in the
 * connection's accept set. Once rtgip/3 is accepted, rtgip/2 also needs both expiry fields and is refused after
 * min(v2_accept_until, v3_added_at + 7 days), whatever the accept set still says.
 */
export function gateVerdict(c: ConnectionGate, presented: string, now: number): Verdict {
  if (!c.accept_protocols.includes(presented)) return fail("protocol_not_accepted");
  if (presented === "rtgip/2" && c.accept_protocols.includes(PROTOCOL3)) {
    if (c.v3_added_at === null || c.v2_accept_until === null) return fail("protocol_not_accepted");
    if (now > Math.min(c.v2_accept_until, c.v3_added_at + V2_ACCEPT_MAX_S)) return fail("protocol_not_accepted");
  }
  return OK;
}

/** A source verifies a response only in its outbox row's pinned protocol, through that protocol's entry point. */
export function sourceRowCheck(rowProtocol: string, entryProtocol: string, receiptProtocols: readonly string[]): Verdict {
  if (entryProtocol !== rowProtocol) return fail("protocol_mismatch");
  const want = rowProtocol === PROTOCOL3 ? "rtgip/3-receipt/3" : "rtgip/2-receipt/2";
  return receiptProtocols.every((x) => x === want) ? OK : fail("protocol_mismatch");
}
