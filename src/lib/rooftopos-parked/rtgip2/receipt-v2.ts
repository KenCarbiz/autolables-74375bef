import {
  authorize,
  canonicalize,
  hmacHex,
  sha256Hex,
  timingSafeEqual,
  type EnvelopeV2,
  type Registry,
  type ServiceKey,
  type Signer,
} from "./protocol.ts";

export const RECEIPT_PROTOCOL = "rtgip/2-receipt/2" as const;
export type Stage = "gateway_admission" | "target_inbox" | "consumer_commit";
export type Outcome =
  "admitted" | "applied" | "stale_ignored" | "duplicate" | "held" | "quarantined";
export interface ReceiptV2 {
  protocol: typeof RECEIPT_PROTOCOL;
  receipt_version: 2;
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
  issuer: Signer;
  recipient: Signer;
  outcome: Outcome;
  issued_at: number;
  key_id: string;
  prev_receipt_sha256: string | null;
  signature: string;
}
const FIELDS = [
  "protocol",
  "receipt_version",
  "kind",
  "event_id",
  "route",
  "source_app",
  "target_app",
  "tenant_id",
  "rooftop_id",
  "connection_id",
  "payload_sha256",
  "envelope_sha256",
  "delivery_id",
  "issuer",
  "recipient",
  "outcome",
  "issued_at",
  "key_id",
  "prev_receipt_sha256",
  "signature",
].sort();
const SHA = /^[0-9a-f]{64}$/;
const OUTCOMES: Record<Stage, readonly string[]> = {
  gateway_admission: ["admitted"],
  target_inbox: ["applied", "duplicate", "stale_ignored", "held", "quarantined"],
  consumer_commit: ["applied", "stale_ignored"],
};
export const receiptDigest = (r: ReceiptV2) => sha256Hex(canonicalize(r));
export const deliveryIdentity = async (e: EnvelopeV2, connection: string) =>
  sha256Hex(
    canonicalize([
      RECEIPT_PROTOCOL,
      connection,
      e.event_id,
      e.target_app,
      await sha256Hex(canonicalize(e)),
    ]),
  );

export interface ReceiptExpectation {
  envelope: EnvelopeV2;
  connection_id: string;
  delivery_id: string;
  kind: Stage;
}

export function isReceipt(value: unknown): value is ReceiptV2 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  return (
    Object.keys(r).sort().join("|") === FIELDS.join("|") &&
    r["protocol"] === RECEIPT_PROTOCOL &&
    r["receipt_version"] === 2 &&
    typeof r["kind"] === "string" &&
    r["kind"] in OUTCOMES &&
    typeof r["outcome"] === "string" &&
    OUTCOMES[r["kind"] as Stage].includes(r["outcome"]) &&
    Number.isSafeInteger(r["issued_at"]) &&
    (r["issued_at"] as number) >= 0 &&
    ["payload_sha256", "envelope_sha256", "delivery_id", "signature"].every(
      (k) => typeof r[k] === "string" && SHA.test(r[k] as string),
    ) &&
    (r["prev_receipt_sha256"] === null ||
      (typeof r["prev_receipt_sha256"] === "string" && SHA.test(r["prev_receipt_sha256"])))
  );
}

export async function signReceiptV2(
  r: Omit<ReceiptV2, "signature" | "key_id">,
  key: ServiceKey,
): Promise<ReceiptV2> {
  if (
    key.owner !== r.issuer ||
    key.dialect !== "rtgip/2" ||
    (key.status !== "current" && !(key.status === "previous" && r.kind === "gateway_admission")) ||
    r.issued_at < key.not_before ||
    r.issued_at > key.not_after ||
    !key.connection_ids.includes(r.connection_id)
  )
    throw new Error("receipt_signer_not_authorized");
  const unsigned = { ...r, key_id: key.key_id };
  const signed = {
    ...unsigned,
    signature: await hmacHex(key.secret, RECEIPT_PROTOCOL + "\n" + canonicalize(unsigned)),
  };
  if (!isReceipt(signed)) throw new Error("receipt_invalid_shape");
  return signed;
}

export async function receiptDraft(
  expect: ReceiptExpectation,
  outcome: Outcome,
  issued_at: number,
  previous: ReceiptV2 | null,
): Promise<Omit<ReceiptV2, "signature" | "key_id">> {
  const e = expect.envelope;
  return {
    protocol: RECEIPT_PROTOCOL,
    receipt_version: 2,
    kind: expect.kind,
    event_id: e.event_id,
    route: e.route,
    source_app: e.source_app,
    target_app: e.target_app,
    tenant_id: e.tenant_id,
    rooftop_id: e.rooftop_id,
    connection_id: expect.connection_id,
    payload_sha256: e.payload_sha256,
    envelope_sha256: await sha256Hex(canonicalize(e)),
    delivery_id: expect.delivery_id,
    issuer: expect.kind === "gateway_admission" ? "gateway" : e.target_app,
    recipient: expect.kind === "gateway_admission" ? e.source_app : "gateway",
    outcome,
    issued_at,
    prev_receipt_sha256: previous ? await receiptDigest(previous) : null,
  };
}

/** Full-chain validation: never trusts an isolated prior receipt merely because its hash matches. */
export async function verifyReceiptV2(
  value: unknown,
  expect: ReceiptExpectation,
  registry: Registry,
  now: number,
  ancestors: readonly ReceiptV2[] = [],
): Promise<ReceiptV2> {
  if (!isReceipt(value)) throw new Error("ack_unsupported_version_or_shape");
  const r = value;
  const e = expect.envelope;
  if (r.kind !== expect.kind) throw new Error("ack_wrong_stage");
  const expected = await receiptDraft(expect, r.outcome, r.issued_at, null);
  for (const k of [
    "event_id",
    "route",
    "source_app",
    "target_app",
    "tenant_id",
    "rooftop_id",
    "connection_id",
    "payload_sha256",
    "envelope_sha256",
    "delivery_id",
    "issuer",
    "recipient",
  ] as const) {
    if (r[k] !== expected[k]) throw new Error(`ack_wrong_${k}`);
  }
  if (!authorize(e, registry).ok) throw new Error("ack_connection_not_authorized");
  const key = registry.keys.find((k) => k.key_id === r.key_id);
  if (
    !key ||
    key.owner !== r.issuer ||
    key.dialect !== "rtgip/2" ||
    key.status === "revoked" ||
    now < key.not_before ||
    now > key.not_after ||
    r.issued_at < key.not_before ||
    r.issued_at > key.not_after ||
    !key.connection_ids.includes(r.connection_id)
  )
    throw new Error("ack_key_not_authorized");
  if (r.issued_at > now + 300) throw new Error("ack_future_receipt");
  const { signature, ...unsigned } = r;
  if (
    !timingSafeEqual(
      signature,
      await hmacHex(key.secret, RECEIPT_PROTOCOL + "\n" + canonicalize(unsigned)),
    )
  )
    throw new Error("ack_bad_signature");
  if (r.kind === "gateway_admission") {
    if (r.prev_receipt_sha256 !== null || ancestors.length !== 0)
      throw new Error("ack_unexpected_previous_stage");
  } else {
    const previous = ancestors[ancestors.length - 1];
    const required: Stage = r.kind === "target_inbox" ? "gateway_admission" : "target_inbox";
    if (
      !previous ||
      previous.kind !== required ||
      r.prev_receipt_sha256 !== (await receiptDigest(previous))
    )
      throw new Error("ack_missing_previous_stage");
    await verifyReceiptV2(
      previous,
      { ...expect, kind: required },
      registry,
      now,
      ancestors.slice(0, -1),
    );
    if (r.issued_at < previous.issued_at) throw new Error("ack_stage_time_reversed");
    if (
      r.kind === "consumer_commit" &&
      (previous.outcome === "held" ||
        previous.outcome === "quarantined" ||
        (previous.outcome !== "duplicate" && previous.outcome !== r.outcome))
    )
      throw new Error("ack_commit_without_effect");
  }
  return r;
}
