// rtgip/3-receipt-query/2 (contract "Receipt query"): a source reads the stored chain of a delivery it sent. The
// signed message adds the signer: ["rtgip/3-receipt-query/2", key_id, signer, ts, nonce, sha256(body)].join("\n").
// Pure; the caller supplies keys, the nonce store and the Gateway's own delivery record. Copied byte for byte.
import { canonicalize, MAX_SKEW_SECONDS, NONCE_TTL_SECONDS, type NonceStore } from "../rtgip2/core";
import { fail, HEX64, sha256Hex, verifyEd25519, type SigningKey3 } from "./sig";
import { resolveKey3, type KeyContext3, type PublicKeyRecord } from "./keys3";

export const QUERY3 = "rtgip/3-receipt-query/2" as const;
const SIGNATURE_PREFIX3 = "rtgip3=";
const TS = /^(0|[1-9][0-9]{0,11})$/;
const NONCE = /^[A-Za-z0-9_-]{16,128}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface ReceiptQuery3 {
  protocol: typeof QUERY3;
  delivery_id: string;
  event_id: string;
}
export interface QueryHeaders3 {
  "rtgip-key-id": string;
  "rtgip-signer": string;
  "rtgip-timestamp": string;
  "rtgip-nonce": string;
  "rtgip-signature": string;
}
export const QUERY_HEADER_NAMES3: readonly (keyof QueryHeaders3)[] = ["rtgip-key-id", "rtgip-signer", "rtgip-timestamp", "rtgip-nonce", "rtgip-signature"];

export const queryMessage3 = (keyId: string, signer: string, ts: string, nonce: string, bodySha: string): string =>
  [QUERY3, keyId, signer, ts, nonce, bodySha].join("\n");

export async function signReceiptQuery3(
  query: Omit<ReceiptQuery3, "protocol">,
  key: SigningKey3,
  nowSec: number,
  nonce: string,
): Promise<{ body: string; headers: QueryHeaders3 }> {
  if (key.owner === "gateway") throw new Error("query_signer_not_authorized");
  if (!NONCE.test(nonce)) throw new Error("invalid_nonce");
  if (!Number.isSafeInteger(nowSec) || nowSec < 0) throw new Error("timestamp_out_of_window");
  const body = canonicalize({ protocol: QUERY3, delivery_id: query.delivery_id, event_id: query.event_id });
  const ts = String(nowSec);
  return {
    body,
    headers: {
      "rtgip-key-id": key.key_id,
      "rtgip-signer": key.owner,
      "rtgip-timestamp": ts,
      "rtgip-nonce": nonce,
      "rtgip-signature": SIGNATURE_PREFIX3 + (await key.sign(queryMessage3(key.key_id, key.owner, ts, nonce, await sha256Hex(body)))),
    },
  };
}

type QueryHeaderBag = Partial<Record<keyof QueryHeaders3, string>>;

/** Signature only: header shape, key (owner = signer, a source app), timestamp window and encoding, Ed25519. */
export async function verifyQuerySignature3(
  h: QueryHeaderBag,
  body: string,
  ctx: KeyContext3,
): Promise<{ ok: true; key: PublicKeyRecord } | { ok: false; reason: string }> {
  const keyId = h["rtgip-key-id"],
    signer = h["rtgip-signer"],
    ts = h["rtgip-timestamp"],
    nonce = h["rtgip-nonce"],
    sig = h["rtgip-signature"];
  if (!keyId || !signer || !ts || !nonce || !sig) return fail("missing_headers");
  if (!sig.startsWith(SIGNATURE_PREFIX3)) return fail("protocol_mismatch");
  if (!NONCE.test(nonce)) return fail("invalid_nonce");
  const r = await resolveKey3(ctx, keyId, signer);
  if (!r.ok) return r;
  if (signer === "gateway") return fail("signer_not_source");
  if (!TS.test(ts) || Math.abs(ctx.now - Number(ts)) > MAX_SKEW_SECONDS) return fail("timestamp_out_of_window");
  const v = await verifyEd25519(r.key.public_key, queryMessage3(keyId, signer, ts, nonce, await sha256Hex(body)), sig.slice(SIGNATURE_PREFIX3.length));
  return v.ok ? { ok: true, key: r.key } : v;
}

export interface KnownDelivery3 {
  connection_id: string;
  source_app: string;
  tenant_id: string;
  event_id: string;
}
export interface QueryContext3 {
  keys: KeyContext3;
  nonces: NonceStore;
  /** The Gateway's own record of the delivery: who sent it and on which connection. */
  lookup(delivery_id: string): KnownDelivery3 | null;
}
export type QueryVerdict3 = { ok: true; query: ReceiptQuery3; key: PublicKeyRecord } | { ok: false; reason: string };

/**
 * A source reads only deliveries it sent itself, on a connection its key is bound to; an unknown delivery and a
 * foreign one are the same refusal. Every nonce is single use, an exact repeat included.
 */
export async function verifyReceiptQuery3(headers: QueryHeaderBag, body: string, ctx: QueryContext3): Promise<QueryVerdict3> {
  const s = await verifyQuerySignature3(headers, body, ctx.keys);
  if (!s.ok) return s;
  const keyId = headers["rtgip-key-id"]!;
  const claim = await ctx.nonces.claim(keyId, headers["rtgip-nonce"]!, await sha256Hex(body), Number(headers["rtgip-timestamp"]) + NONCE_TTL_SECONDS, ctx.keys.now);
  if (claim !== "claimed") return fail("nonce_reused");
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return fail("malformed_json");
  }
  try {
    if (canonicalize(parsed) !== body) return fail("body_not_canonical");
  } catch {
    return fail("body_not_canonical");
  }
  const q = parsed as Record<string, unknown>;
  if (
    !q ||
    typeof q !== "object" ||
    Array.isArray(q) ||
    Object.keys(q).sort().join("|") !== "delivery_id|event_id|protocol" ||
    q["protocol"] !== QUERY3 ||
    typeof q["delivery_id"] !== "string" ||
    !HEX64.test(q["delivery_id"]) ||
    typeof q["event_id"] !== "string" ||
    !UUID.test(q["event_id"])
  )
    return fail("invalid_query");
  const known = ctx.lookup(q["delivery_id"]);
  if (!known || known.source_app !== s.key.owner || known.event_id !== q["event_id"] || !s.key.connection_ids.includes(known.connection_id))
    return fail("delivery_not_found");
  return { ok: true, query: q as unknown as ReceiptQuery3, key: s.key };
}
