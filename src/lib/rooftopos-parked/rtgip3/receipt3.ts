// rtgip/3 receipts (contract "Receipt/3 and the chain"): the 20 ReceiptV2 fields with protocol rtgip/3-receipt/3,
// receipt_version 3 and a 128-hex Ed25519 signature over "rtgip/3-receipt/3\n" + canonical(receipt minus signature).
// The kind table is checked on every receipt before any key is consulted. Pure and copied byte for byte into the apps.
import { canonicalize } from "../rtgip2/core";
import { b64urlDecode, b64urlEncode, fail, HEX64, OK, SIG3, sha256Hex, verifyEd25519, type SigningKey3, type Verdict } from "./sig";
import { resolveKey3, type KeyContext3 } from "./keys3";

export const RECEIPT3 = "rtgip/3-receipt/3" as const;
export const RECEIPT_MAX_FUTURE_S = 300;

export type Stage3 = "gateway_admission" | "target_inbox" | "consumer_commit" | "gateway_confirmation";
export type Outcome3 = "admitted" | "applied" | "duplicate" | "stale_ignored" | "held" | "quarantined" | "delivery_abandoned";
export interface Receipt3 {
  protocol: typeof RECEIPT3;
  receipt_version: 3;
  kind: Stage3;
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
  outcome: Outcome3;
  issued_at: number;
  key_id: string;
  prev_receipt_sha256: string | null;
  signature: string;
}
export type UnsignedReceipt3 = Omit<Receipt3, "signature">;
export type ReceiptDraft3 = Omit<Receipt3, "signature" | "key_id">;

const FIELDS =
  "connection_id|delivery_id|envelope_sha256|event_id|issued_at|issuer|key_id|kind|outcome|payload_sha256|prev_receipt_sha256|protocol|receipt_version|recipient|rooftop_id|route|signature|source_app|target_app|tenant_id";
export const OUTCOMES3: Readonly<Record<Stage3, readonly Outcome3[]>> = {
  gateway_admission: ["admitted"],
  target_inbox: ["applied", "duplicate", "stale_ignored", "held", "quarantined"],
  consumer_commit: ["applied", "stale_ignored"],
  gateway_confirmation: ["delivery_abandoned"],
};
export const isGatewayStage3 = (k: Stage3): boolean => k === "gateway_admission" || k === "gateway_confirmation";

/** The identity of one delivery, as every receipt of its chain must repeat it. */
export interface ChainEnvelope {
  event_id: string;
  route: string;
  source_app: string;
  target_app: string;
  tenant_id: string;
  rooftop_id: string;
  payload_sha256: string;
}
export interface ChainContext3 extends KeyContext3 {
  envelope: ChainEnvelope;
  envelope_sha256: string;
  connection_id: string;
}

export const receiptMessage3 = (unsigned: UnsignedReceipt3 | Record<string, unknown>): string => RECEIPT3 + "\n" + canonicalize(unsigned);
export const receiptDigest3 = (r: Receipt3): Promise<string> => sha256Hex(canonicalize(r));
export const deliveryId3 = (connection: string, eventId: string, targetApp: string, envelopeSha: string): Promise<string> =>
  sha256Hex(canonicalize([RECEIPT3, connection, eventId, targetApp, envelopeSha]));
/** delivery_id for an envelope on a connection; envelope_sha256 is sha256 of its canonical body. */
export async function deliveryIdentity3(envelope: ChainEnvelope, connection: string): Promise<string> {
  return deliveryId3(connection, envelope.event_id, envelope.target_app, await sha256Hex(canonicalize(envelope)));
}

/** Shape, version, outcome-for-kind, signature shape and the normative kind table (issuer, recipient). */
export function receiptShape3(value: unknown): Verdict {
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("invalid_receipt_shape");
  const r = value as Receipt3;
  if (Object.keys(r).sort().join("|") !== FIELDS) return fail("invalid_receipt_shape");
  if (r.protocol !== RECEIPT3 || r.receipt_version !== 3) return fail("protocol_mismatch");
  if (typeof r.kind !== "string" || !Object.hasOwn(OUTCOMES3, r.kind) || !OUTCOMES3[r.kind].includes(r.outcome)) return fail("invalid_receipt_shape");
  if (!Number.isSafeInteger(r.issued_at) || r.issued_at < 0) return fail("invalid_receipt_shape");
  if (![r.payload_sha256, r.envelope_sha256, r.delivery_id].every((x) => typeof x === "string" && HEX64.test(x))) return fail("invalid_receipt_shape");
  if (r.prev_receipt_sha256 !== null && (typeof r.prev_receipt_sha256 !== "string" || !HEX64.test(r.prev_receipt_sha256))) return fail("invalid_receipt_shape");
  if (
    ![r.event_id, r.route, r.source_app, r.target_app, r.tenant_id, r.rooftop_id, r.connection_id, r.issuer, r.recipient, r.key_id].every(
      (x) => typeof x === "string",
    )
  )
    return fail("invalid_receipt_shape");
  if (typeof r.signature !== "string" || !SIG3.test(r.signature)) return fail("signature_malformed");
  const gw = isGatewayStage3(r.kind);
  if (r.issuer !== (gw ? "gateway" : r.target_app)) return fail("ack_wrong_issuer");
  if (r.recipient !== (gw ? r.source_app : "gateway")) return fail("ack_wrong_recipient");
  return OK;
}
export const isReceipt3 = (value: unknown): value is Receipt3 => receiptShape3(value).ok;

/** One receipt on its own: shape and kind table, the issuer's key (valid now and at issued_at), freshness, signature. */
export async function verifyReceipt3(value: unknown, ctx: KeyContext3): Promise<Verdict> {
  const s = receiptShape3(value);
  if (!s.ok) return s;
  const r = value as Receipt3;
  const k = await resolveKey3(ctx, r.key_id, r.issuer, r.issued_at);
  if (!k.ok) return k;
  if (r.issued_at > ctx.now + RECEIPT_MAX_FUTURE_S) return fail("timestamp_out_of_window");
  const { signature, ...unsigned } = r;
  return verifyEd25519(k.key.public_key, receiptMessage3(unsigned), signature);
}

/** The receipt describes this very delivery: every identity field, the delivery id, issuer and recipient. */
export async function receiptBinding3(r: Receipt3, ctx: ChainContext3): Promise<Verdict> {
  const e = ctx.envelope;
  const gw = isGatewayStage3(r.kind);
  const want: Record<string, unknown> = {
    event_id: e.event_id,
    route: e.route,
    source_app: e.source_app,
    target_app: e.target_app,
    tenant_id: e.tenant_id,
    rooftop_id: e.rooftop_id,
    connection_id: ctx.connection_id,
    payload_sha256: e.payload_sha256,
    envelope_sha256: ctx.envelope_sha256,
    delivery_id: await deliveryId3(ctx.connection_id, e.event_id, e.target_app, ctx.envelope_sha256),
    issuer: gw ? "gateway" : e.target_app,
    recipient: gw ? e.source_app : "gateway",
  };
  for (const k of Object.keys(want)) if ((r as unknown as Record<string, unknown>)[k] !== want[k]) return fail(`ack_wrong_${k}`);
  return OK;
}

export interface ReceiptExpectation3 {
  envelope: ChainEnvelope;
  envelope_sha256: string;
  connection_id: string;
  delivery_id: string;
  kind: Stage3;
}

export async function receiptDraft3(
  expect: ReceiptExpectation3,
  outcome: Outcome3,
  issued_at: number,
  previous: Receipt3 | null,
): Promise<ReceiptDraft3> {
  const e = expect.envelope;
  const gw = isGatewayStage3(expect.kind);
  return {
    protocol: RECEIPT3,
    receipt_version: 3,
    kind: expect.kind,
    event_id: e.event_id,
    route: e.route,
    source_app: e.source_app,
    target_app: e.target_app,
    tenant_id: e.tenant_id,
    rooftop_id: e.rooftop_id,
    connection_id: expect.connection_id,
    payload_sha256: e.payload_sha256,
    envelope_sha256: expect.envelope_sha256,
    delivery_id: expect.delivery_id,
    issuer: gw ? "gateway" : e.target_app,
    recipient: gw ? e.source_app : "gateway",
    outcome,
    issued_at,
    prev_receipt_sha256: previous ? await receiptDigest3(previous) : null,
  };
}

/** Sign a draft with this node's key. The key must belong to the issuer the kind table names. */
export async function signReceipt3(draft: ReceiptDraft3, key: SigningKey3): Promise<Receipt3> {
  if (key.owner !== draft.issuer) throw new Error("receipt_signer_not_authorized");
  const unsigned: UnsignedReceipt3 = { ...draft, key_id: key.key_id };
  const signed: Receipt3 = { ...unsigned, signature: await key.sign(receiptMessage3(unsigned)) };
  if (!receiptShape3(signed).ok) throw new Error("receipt_invalid_shape");
  return signed;
}

export const encodeAdmissionHeader3 = (r: Receipt3): string => b64urlEncode(canonicalize(r));

/** Target side of H2: the rtgip-admission-receipt header is mandatory and must be the Gateway's admission for this delivery. */
export async function verifyAdmissionHeader3(header: string | null | undefined, ctx: ChainContext3): Promise<{ ok: true; receipt: Receipt3 } | { ok: false; reason: string }> {
  if (header === null || header === undefined || header === "") return fail("admission_missing");
  let r: Receipt3;
  try {
    const text = b64urlDecode(header);
    r = JSON.parse(text) as Receipt3;
    if (canonicalize(r) !== text) return fail("invalid_receipt_shape");
  } catch {
    return fail("invalid_receipt_shape");
  }
  const v = await verifyReceipt3(r, ctx);
  if (!v.ok) return v;
  if (r.kind !== "gateway_admission") return fail("ack_wrong_stage");
  const b = await receiptBinding3(r, ctx);
  return b.ok ? { ok: true, receipt: r } : b;
}

export type ChainStatus3 = "gateway_admitted" | "consumer_committed" | "target_quarantined" | "pending" | "abandoned";

/**
 * Source chain rule: [adm] admitted, [adm, inbox(applied|duplicate|stale_ignored), commit] committed,
 * [adm, inbox(quarantined)] quarantined, [adm, inbox(held)] pending, [adm, confirmation] abandoned. Every link is
 * verified (key, signature, binding, previous digest, non-decreasing time); nothing is trusted because a hash matches.
 */
export async function evaluateChain3(
  chain: readonly unknown[],
  ctx: ChainContext3,
): Promise<{ ok: true; status: ChainStatus3; receipts: Receipt3[] } | { ok: false; reason: string }> {
  if (chain.length < 1 || chain.length > 3) return fail("chain_shape");
  let prev: Receipt3 | null = null;
  const receipts: Receipt3[] = [];
  for (const value of chain) {
    const v = await verifyReceipt3(value, ctx);
    if (!v.ok) return v;
    const r = value as Receipt3;
    const b = await receiptBinding3(r, ctx);
    if (!b.ok) return b;
    if (prev === null) {
      if (r.kind !== "gateway_admission" || r.prev_receipt_sha256 !== null) return fail("ack_unexpected_previous_stage");
    } else {
      const required: Stage3 = r.kind === "consumer_commit" ? "target_inbox" : "gateway_admission";
      if (r.kind === "gateway_admission" || prev.kind !== required || r.prev_receipt_sha256 !== (await receiptDigest3(prev)))
        return fail("ack_missing_previous_stage");
      if (r.issued_at < prev.issued_at) return fail("ack_stage_time_reversed");
      if (
        r.kind === "consumer_commit" &&
        (prev.outcome === "held" || prev.outcome === "quarantined" || (prev.outcome !== "duplicate" && prev.outcome !== r.outcome))
      )
        return fail("ack_commit_without_effect");
    }
    receipts.push(r);
    prev = r;
  }
  const [, second, third] = receipts;
  if (receipts.length === 1) return { ok: true, status: "gateway_admitted", receipts };
  if (second?.kind === "gateway_confirmation") return receipts.length === 2 ? { ok: true, status: "abandoned", receipts } : fail("chain_shape");
  if (second?.kind !== "target_inbox") return fail("chain_shape");
  if (receipts.length === 2) return { ok: true, status: second.outcome === "quarantined" ? "target_quarantined" : "pending", receipts };
  if (third?.kind === "consumer_commit") return { ok: true, status: "consumer_committed", receipts };
  return fail("chain_shape");
}
