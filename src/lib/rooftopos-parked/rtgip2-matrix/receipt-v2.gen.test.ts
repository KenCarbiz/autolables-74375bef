// @vitest-environment node
// Shared receipt-v2 vectors (rtgip/2-receipt/2). Every adapter and the Gateway verify these
// exact signed bytes; with RTGIP_RECEIPT_V2_OUT set the file is rewritten, otherwise the
// committed copy must hold the same values the code produces today.
import { expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import corpus from "../rtgip2/rtgip2-corpus.v2.json";
import { canonicalize, hmacHex, sha256Hex, type EnvelopeV2, type Registry } from "../rtgip2/protocol.ts";
import {
  RECEIPT_PROTOCOL,
  deliveryIdentity,
  receiptDigest,
  receiptDraft,
  signReceiptV2,
  type Outcome,
  type ReceiptV2,
  type Stage,
} from "../rtgip2/receipt-v2.ts";
import { connId, keyOf, signingKeyFor, syntheticRegistry, T0 } from "../rtgip2/fixtures.ts";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "../rtgip2/rtgip2-receipt-v2.v1.json");
const NOW = T0 + 10;

it("receipt-v2 vectors are reproducible", async () => {
  const reg: Registry = syntheticRegistry();
  const sign = async (
    env: EnvelopeV2,
    conn: string,
    did: string,
    kind: Stage,
    outcome: Outcome,
    at: number,
    prev: ReceiptV2 | null,
  ) => {
    const issuer = kind === "gateway_admission" ? "gateway" : env.target_app;
    return signReceiptV2(
      await receiptDraft({ envelope: env, connection_id: conn, delivery_id: did, kind }, outcome, at, prev),
      keyOf(reg, signingKeyFor(issuer)),
    );
  };
  const chain = async (name: string, body: string, inbox: Outcome, commit: Outcome | null) => {
    const env = JSON.parse(body) as EnvelopeV2;
    const conn = connId(env.source_app, env.target_app);
    const did = await deliveryIdentity(env, conn);
    const a = await sign(env, conn, did, "gateway_admission", "admitted", T0, null);
    const i = await sign(env, conn, did, "target_inbox", inbox, T0 + 1, a);
    const rs = [a, i];
    if (commit) rs.push(await sign(env, conn, did, "consumer_commit", commit, T0 + 2, i));
    return {
      name,
      route: env.route,
      event_type: env.event_type,
      body,
      envelope_sha256: await sha256Hex(canonicalize(env)),
      connection_id: conn,
      delivery_id: did,
      receipts: rs,
      digests: await Promise.all(rs.map(receiptDigest)),
      signed_bytes: rs.map(({ signature: _s, ...u }) => RECEIPT_PROTOCOL + "\n" + canonicalize(u)),
    };
  };
  const chains = [];
  for (const e of corpus.entries)
    chains.push(await chain(`${e.seq}:${e.route}:${e.event_type}:applied`, e.body, "applied", "applied"));
  const b1 = corpus.entries[0]!.body;
  chains.push(await chain("1:held", b1, "held", null));
  chains.push(await chain("1:quarantined", b1, "quarantined", null));
  chains.push(await chain("1:duplicate", b1, "duplicate", "applied"));
  chains.push(await chain("1:stale_ignored", b1, "stale_ignored", "stale_ignored"));

  const base = chains[0]!;
  const [adm, inb, com] = base.receipts as [ReceiptV2, ReceiptV2, ReceiptV2];
  const env1 = JSON.parse(b1) as EnvelopeV2;
  const forge = async (r: Omit<ReceiptV2, "signature">, keyId: string) => ({
    ...r,
    signature: await hmacHex(keyOf(reg, keyId).secret, RECEIPT_PROTOCOL + "\n" + canonicalize(r)),
  });
  const strip = ({ signature: _s, ...u }: ReceiptV2) => u;
  const held = chains.find((c) => c.name === "1:held")!.receipts as ReceiptV2[];
  const collided = canonicalize({ ...env1, correlation_id: "corr-collision" });
  const revokedTarget = {
    ...reg,
    keys: reg.keys.map((k) => (k.owner === env1.target_app ? { ...k, status: "revoked" as const } : k)),
  };
  const otherTenantConn = connId(env1.source_app, env1.target_app, "tnt-syn-southwind");
  const negative = [
    { name: "tampered commit signature", receipts: [adm, inb, { ...com, signature: "0".repeat(64) }], error: "ack_bad_signature" },
    { name: "isolated commit without ancestors", receipts: [com], error: "ack_missing_previous_stage" },
    { name: "chain presented out of order", receipts: [inb, adm, com], error: "ack_missing_previous_stage" },
    { name: "v1 receipt shape", receipts: [{ ...adm, receipt_version: 1 }], error: "ack_unsupported_version_or_shape" },
    { name: "unsupported receipt protocol", receipts: [{ ...adm, protocol: "rtgip/2-receipt/1" }], error: "ack_unsupported_version_or_shape" },
    { name: "unsigned success receipt", receipts: [adm, { ...inb, signature: "" }], error: "ack_unsupported_version_or_shape" },
    { name: "event id reused with a different envelope", receipts: [adm, inb, com], body: collided, error: "ack_wrong_envelope_sha256" },
    {
      name: "commit after held inbox",
      receipts: [...held, await forge({ ...strip(com), prev_receipt_sha256: await receiptDigest(held[1]!) }, signingKeyFor(env1.target_app))],
      error: "ack_commit_without_effect",
    },
    {
      name: "inbox signed by a non-recipient app key",
      receipts: [adm, await forge({ ...strip(inb), key_id: "af-dev-1" }, "af-dev-1")],
      error: "ack_key_not_authorized",
    },
    {
      name: "inbox signed by a revoked source-app key",
      receipts: [adm, await forge({ ...strip(inb), key_id: "al-dev-0" }, "al-dev-0")],
      error: "ack_key_not_authorized",
    },
    { name: "destination key revoked after signing", receipts: [adm, inb, com], registry: revokedTarget, error: "ack_key_not_authorized" },
    {
      name: "delivery id of another tenant's connection",
      receipts: [await forge({ ...strip(adm), connection_id: otherTenantConn }, "gw-dev-1")],
      error: "ack_wrong_connection_id",
    },
    {
      name: "stage time reversed",
      receipts: [adm, await forge({ ...strip(inb), issued_at: T0 - 1 }, signingKeyFor(env1.target_app))],
      error: "ack_stage_time_reversed",
    },
    { name: "receipt from the future", receipts: [adm], now: T0 - 301, error: "ack_future_receipt" },
  ];
  const vectors = {
    schema: "rooftopos/rtgip2-receipt-v2-vectors/1",
    receipt_protocol: RECEIPT_PROTOCOL,
    note: "Synthetic. Secrets are the public DEV literals dev-only-<key_id> from fixtures.ts and must never be provisioned. Verify with now unless a vector gives its own.",
    now: NOW,
    registry: reg,
    chains,
    negative: negative.map((n) => ({ chain: base.name, ...n })),
  };
  const text = JSON.stringify(vectors, null, 2) + "\n";
  if (process.env.RTGIP_RECEIPT_V2_OUT) writeFileSync(OUT, text);
  else expect(JSON.parse(text)).toEqual(JSON.parse(readFileSync(OUT, "utf8")));
});
