// AR-1 strict option 1, TypeScript mirror of receipt-contract amendments A1-1 and A1-2 (proposal,
// pending owner approval). Byte-identical in AutoLabels, AutoCurb and AutoFrame
// (rtgip2-runtime/PROVENANCE.json). The frozen rtgip2 core is not changed: the new stage lives here.
//
// A1-1 gateway_confirmation: the 20-field rtgip/2-receipt/2 shape with kind gateway_confirmation,
// issuer gateway, recipient the source app, outcome consumer_committed, target_quarantined or
// delivery_abandoned, and prev_receipt_sha256 the digest of the source's admission receipt. The
// Gateway signs it with its link key towards the source (gw-<source>): consumer_committed and
// target_quarantined only after it verified and stored the target chain, delivery_abandoned when it
// dead-letters the delivery. At most one per delivery, and it is final; issued_at is
// max(Gateway clock at signing, adm_S.issued_at).
// A1-2 source rule: the source verifies exactly [gateway_admission, gateway_confirmation] and never
// needs a target key. The database (rtgip.outbox_advance) is authoritative; this mirror is for the
// vectors, the tests and the stub Gateway.
import {
  authorize,
  canonicalize,
  hmacHex,
  sha256Hex,
  timingSafeEqual,
  type EnvelopeV2,
  type Registry,
  type ServiceKey,
} from "../rtgip2/protocol.ts";
import {
  RECEIPT_PROTOCOL,
  isReceipt,
  receiptDigest,
  verifyReceiptV2,
  type ReceiptV2,
} from "../rtgip2/receipt-v2.ts";
import { PROTOCOL3, sourceRowCheck } from "../rtgip3/core3.ts";
import { evaluateChain3, type ChainStatus3, type Receipt3 } from "../rtgip3/receipt3.ts";
import type { KeyContext3 } from "../rtgip3/keys3.ts";

export const CONFIRMATION_KIND = "gateway_confirmation" as const;
export type ConfirmationOutcome = "consumer_committed" | "target_quarantined" | "delivery_abandoned";
export const CONFIRMATION_OUTCOMES: readonly ConfirmationOutcome[] = [
  "consumer_committed",
  "target_quarantined",
  "delivery_abandoned",
];
/** The source outbox state each (terminal) confirmation outcome moves a delivery to. */
export const OUTBOX_STATE_OF = {
  consumer_committed: "consumer_committed",
  target_quarantined: "target_quarantined",
  delivery_abandoned: "dead_letter",
} as const satisfies Record<ConfirmationOutcome, string>;
export type ConfirmedState = (typeof OUTBOX_STATE_OF)[ConfirmationOutcome];

export interface GatewayConfirmation extends Omit<ReceiptV2, "kind" | "outcome"> {
  kind: typeof CONFIRMATION_KIND;
  outcome: ConfirmationOutcome;
}

export interface ChainExpectation {
  envelope: EnvelopeV2;
  connection_id: string;
  delivery_id: string;
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
const BOUND = [
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
] as const;
const SHA = /^[0-9a-f]{64}$/;
const STRINGS = [
  "protocol",
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
  "key_id",
  "signature",
];

export function isConfirmation(value: unknown): value is GatewayConfirmation {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const r = value as Record<string, unknown>;
  return (
    Object.keys(r).sort().join("|") === FIELDS.join("|") &&
    STRINGS.every((k) => typeof r[k] === "string") &&
    r["protocol"] === RECEIPT_PROTOCOL &&
    r["receipt_version"] === 2 &&
    r["kind"] === CONFIRMATION_KIND &&
    (CONFIRMATION_OUTCOMES as readonly unknown[]).includes(r["outcome"]) &&
    Number.isSafeInteger(r["issued_at"]) &&
    (r["issued_at"] as number) >= 0 &&
    ["payload_sha256", "envelope_sha256", "delivery_id", "signature"].every((k) =>
      SHA.test(r[k] as string),
    ) &&
    (r["prev_receipt_sha256"] === null ||
      (typeof r["prev_receipt_sha256"] === "string" && SHA.test(r["prev_receipt_sha256"])))
  );
}

export async function confirmationDraft(
  expect: ChainExpectation,
  outcome: ConfirmationOutcome,
  issued_at: number,
  admission: ReceiptV2,
): Promise<Omit<GatewayConfirmation, "signature" | "key_id">> {
  const e = expect.envelope;
  return {
    protocol: RECEIPT_PROTOCOL,
    receipt_version: 2,
    kind: CONFIRMATION_KIND,
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
    issuer: "gateway",
    recipient: e.source_app,
    outcome,
    issued_at,
    prev_receipt_sha256: await receiptDigest(admission),
  };
}

/** The Gateway side: sign a confirmation with its current link key towards the source. */
export async function signConfirmation(
  r: Omit<GatewayConfirmation, "signature" | "key_id">,
  key: ServiceKey,
): Promise<GatewayConfirmation> {
  if (
    key.owner !== "gateway" ||
    key.dialect !== "rtgip/2" ||
    key.status !== "current" ||
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
  if (!isConfirmation(signed)) throw new Error("receipt_invalid_shape");
  return signed;
}

/**
 * Verify one confirmation against the delivery and the (already verified) admission receipt. The
 * checks and refusal codes follow the core verifyReceiptV2 order, as the Gateway's AR-1 build
 * extends it for this stage (KAT rtgip2-gateway-kat.v2): shape, stage, bound fields, connection,
 * key, time, MAC, then the link to the admission.
 */
export async function verifyConfirmation(
  value: unknown,
  expect: ChainExpectation,
  registry: Registry,
  now: number,
  admission: ReceiptV2,
): Promise<GatewayConfirmation> {
  if (!isReceipt(value) && !isConfirmation(value))
    throw new Error("ack_unsupported_version_or_shape");
  if ((value as { kind: string }).kind !== CONFIRMATION_KIND) throw new Error("ack_wrong_stage");
  const r = value as GatewayConfirmation;
  const want = await confirmationDraft(expect, r.outcome, r.issued_at, admission);
  for (const k of BOUND) if (r[k] !== want[k]) throw new Error(`ack_wrong_${k}`);
  if (!authorize(expect.envelope, registry).ok) throw new Error("ack_connection_not_authorized");
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
  if (admission.kind !== "gateway_admission" || r.prev_receipt_sha256 !== want.prev_receipt_sha256)
    throw new Error("ack_missing_previous_stage");
  if (r.issued_at < admission.issued_at) throw new Error("ack_stage_time_reversed");
  return r;
}

export type SourceChainVerdict =
  | { state: "gateway_admitted"; admission: ReceiptV2 }
  | { state: ConfirmedState; admission: ReceiptV2; confirmation: GatewayConfirmation };

/**
 * The A1-2 source rule: exactly [gateway_admission] or [gateway_admission, gateway_confirmation]
 * (any other length: ack_chain_shape). A target-issued receipt in either place is refused with
 * ack_wrong_stage: the source never MAC-checks one. Pass the source's own registry: under AR-1 it
 * holds only the app's own key and the Gateway's key towards the app.
 */
export async function verifySourceChain(
  chain: readonly unknown[],
  expect: ChainExpectation,
  registry: Registry,
  now: number,
): Promise<SourceChainVerdict> {
  if (chain.length !== 1 && chain.length !== 2) throw new Error("ack_chain_shape");
  const admission = await verifyReceiptV2(
    chain[0],
    { ...expect, kind: "gateway_admission" },
    registry,
    now,
    [],
  );
  if (chain.length === 1) return { state: "gateway_admitted", admission };
  const confirmation = await verifyConfirmation(chain[1], expect, registry, now, admission);
  return { state: OUTBOX_STATE_OF[confirmation.outcome], admission, confirmation };
}

/** The AR-1 key rows a database may hold in its verification path (mirrors runtime.ts and SQL). */
export const inVerificationPath = (
  app: string,
  row: { owner: string; audience?: string | null | undefined },
) =>
  (row.owner === app && row.audience === "gateway") ||
  (row.owner === "gateway" && row.audience === app);

// ---------------------------------------------------------------------------
// rtgip/3 source chain rule (contract "Receipt/3 and the chain"). Unlike the AR-1 rtgip/2 rule, the
// source verifies the target's own receipts: every link is Ed25519-signed by the issuer the kind table
// names, and the chain is read only in the row's pinned protocol. rtgip.outbox_advance_v3 is
// authoritative; this is the edge check that decides whether a chain is attested to it at all, and the
// state it names is the one outbox_advance_v3 moves the row to.
// ---------------------------------------------------------------------------

export interface ChainExpectationV3 {
  envelope: EnvelopeV2;
  envelope_sha256: string;
  connection_id: string;
  /** rtgip.outbox.delivery_id_v3, derived when the row was pinned to rtgip/3. */
  delivery_id: string;
}
export type SourceStateV3 =
  | "gateway_admitted"
  | "consumer_committed"
  | "target_quarantined"
  | "dead_letter"
  | "pending:target_inbox_pending"
  | "pending:target_held_awaiting_predecessor"
  | "pending:consumer_commit_pending";
export type SourceChainV3Verdict =
  | { ok: true; status: ChainStatus3; state: SourceStateV3; receipts: Receipt3[] }
  | { ok: false; reason: string };

/**
 * deliver lease: exactly [adm]. confirm lease: [adm] or [adm, inbox] pending, [adm, inbox(quarantined)]
 * quarantined, [adm, inbox, commit] committed, [adm, confirmation(delivery_abandoned)] dead letter.
 */
export async function verifySourceChainV3(
  chain: readonly unknown[],
  expect: ChainExpectationV3,
  keys: KeyContext3,
  action: "deliver" | "confirm",
): Promise<SourceChainV3Verdict> {
  const protocols = chain.map((r) =>
    r && typeof r === "object" ? String((r as { protocol?: unknown }).protocol) : "",
  );
  const row = sourceRowCheck(PROTOCOL3, PROTOCOL3, protocols);
  if (!row.ok) return row;
  if (action === "deliver" && chain.length !== 1) return { ok: false, reason: "chain_shape" };
  const v = await evaluateChain3(chain, {
    ...keys,
    envelope: expect.envelope,
    envelope_sha256: expect.envelope_sha256,
    connection_id: expect.connection_id,
  });
  if (!v.ok) return v;
  if (v.receipts[0]!.delivery_id !== expect.delivery_id)
    return { ok: false, reason: "ack_wrong_delivery_id" };
  const inbox = v.receipts[1];
  const state: SourceStateV3 =
    v.status === "gateway_admitted"
      ? action === "deliver"
        ? "gateway_admitted"
        : "pending:target_inbox_pending"
      : v.status === "abandoned"
        ? "dead_letter"
        : v.status === "pending"
          ? inbox?.outcome === "held"
            ? "pending:target_held_awaiting_predecessor"
            : "pending:consumer_commit_pending"
          : v.status;
  return { ok: true, status: v.status, state, receipts: v.receipts };
}
