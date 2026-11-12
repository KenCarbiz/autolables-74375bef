import {
  canonicalize,
  hmacHex,
  MAX_SKEW_SECONDS,
  NONCE_TTL_SECONDS,
  sha256Hex,
  timingSafeEqual,
  type NonceStore,
  type Registry,
  type ServiceKey,
} from "./protocol.ts";

export const QUERY_PROTOCOL = "rtgip/2-receipt-query/1" as const;
const NONCE = /^[A-Za-z0-9_-]{16,128}$/;
const SHA = /^[0-9a-f]{64}$/;

export interface ReceiptQuery {
  protocol: typeof QUERY_PROTOCOL;
  delivery_id: string;
  event_id: string;
}

export interface QueryHeaders {
  "rtgip-key-id": string;
  "rtgip-timestamp": string;
  "rtgip-nonce": string;
  "rtgip-signature": string;
}

const preimage = (keyId: string, ts: string, nonce: string, bodySha: string) =>
  [QUERY_PROTOCOL, keyId, ts, nonce, bodySha].join("\n");

export async function signReceiptQuery(
  query: Omit<ReceiptQuery, "protocol">,
  key: ServiceKey,
  nowSec: number,
  nonce: string,
): Promise<{ body: string; headers: QueryHeaders }> {
  if (key.dialect !== "rtgip/2" || key.status !== "current")
    throw new Error("query_signer_not_authorized");
  if (nowSec < key.not_before || nowSec > key.not_after)
    throw new Error("query_signer_not_authorized");
  if (!NONCE.test(nonce)) throw new Error("invalid_nonce");
  const body = canonicalize({ protocol: QUERY_PROTOCOL, ...query });
  const ts = String(nowSec);
  return {
    body,
    headers: {
      "rtgip-key-id": key.key_id,
      "rtgip-timestamp": ts,
      "rtgip-nonce": nonce,
      "rtgip-signature": await hmacHex(
        key.secret,
        preimage(key.key_id, ts, nonce, await sha256Hex(body)),
      ),
    },
  };
}

export interface QueryContext {
  registry: Registry;
  nonces: NonceStore;
  nowSec: number;
  /** The Gateway's own record of the delivery: who sent it and on which connection. */
  lookup(
    delivery_id: string,
  ): { connection_id: string; source_app: string; tenant_id: string; event_id: string } | null;
}

export type QueryVerdict = { ok: true; query: ReceiptQuery } | { ok: false; reason: string };

/**
 * Verify a source's receipt query. A source can read only deliveries it sent itself, on a
 * connection its key is bound to; an unknown delivery and another tenant's delivery are the
 * same refusal so the answer never confirms that a foreign delivery exists. Every nonce is
 * single use, including an exact repeat.
 */
export async function verifyReceiptQuery(
  headers: Partial<Record<keyof QueryHeaders, string>>,
  body: string,
  ctx: QueryContext,
): Promise<QueryVerdict> {
  const keyId = headers["rtgip-key-id"];
  const ts = headers["rtgip-timestamp"];
  const nonce = headers["rtgip-nonce"];
  const sig = headers["rtgip-signature"];
  if (!keyId || !ts || !nonce || !sig) return { ok: false, reason: "missing_headers" };
  if (!NONCE.test(nonce)) return { ok: false, reason: "invalid_nonce" };
  if (!/^[0-9]{1,12}$/.test(ts) || Math.abs(ctx.nowSec - Number(ts)) > MAX_SKEW_SECONDS)
    return { ok: false, reason: "timestamp_out_of_window" };
  const key = ctx.registry.keys.find((k) => k.key_id === keyId);
  if (!key) return { ok: false, reason: "unknown_key" };
  if (key.dialect !== "rtgip/2") return { ok: false, reason: "key_dialect_mismatch" };
  if (key.status === "revoked") return { ok: false, reason: "key_revoked" };
  if (ctx.nowSec < key.not_before || ctx.nowSec > key.not_after)
    return { ok: false, reason: "key_outside_validity" };
  if (key.owner === "gateway") return { ok: false, reason: "signer_not_source" };
  const bodySha = await sha256Hex(body);
  if (!timingSafeEqual(sig, await hmacHex(key.secret, preimage(key.key_id, ts, nonce, bodySha))))
    return { ok: false, reason: "bad_signature" };
  const claim = await ctx.nonces.claim(
    keyId,
    nonce,
    bodySha,
    Number(ts) + NONCE_TTL_SECONDS,
    ctx.nowSec,
  );
  if (claim !== "claimed") return { ok: false, reason: "nonce_reused" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false, reason: "malformed_json" };
  }
  if (canonicalize(parsed) !== body) return { ok: false, reason: "body_not_canonical" };
  const q = parsed as Record<string, unknown>;
  if (
    !q ||
    typeof q !== "object" ||
    Object.keys(q).sort().join("|") !== "delivery_id|event_id|protocol" ||
    q["protocol"] !== QUERY_PROTOCOL ||
    typeof q["delivery_id"] !== "string" ||
    !SHA.test(q["delivery_id"]) ||
    typeof q["event_id"] !== "string"
  )
    return { ok: false, reason: "invalid_query" };
  const known = ctx.lookup(q["delivery_id"]);
  if (
    !known ||
    known.source_app !== key.owner ||
    known.event_id !== q["event_id"] ||
    !key.connection_ids.includes(known.connection_id)
  )
    return { ok: false, reason: "delivery_not_found" };
  return { ok: true, query: q as unknown as ReceiptQuery };
}
