// @vitest-environment node
import { describe, expect, it } from "vitest";
import { canonicalize, sha256Hex, type EnvelopeV2, type Registry } from "./rtgip2/core";
import {
  RECEIPT_PROTOCOL,
  deliveryIdentity,
  receiptDigest,
  receiptDraft,
  signReceiptV2,
  verifyReceiptV2,
  type ReceiptV2,
} from "./rtgip2/receipt";
import vectors from "../rtgip2/rtgip2-receipt-v2.v1.json";

// The shared rtgip/2-receipt/2 vectors (shared core f6d1202b) run against the Gateway candidate's own
// receipt.ts and core.ts, so both implementations are held to the same bytes.
type V = (typeof vectors)["chains"][number];
const registry = vectors.registry as unknown as Registry;
const exp = (v: V, kind: ReceiptV2["kind"], body = v.body) => ({
  envelope: JSON.parse(body) as EnvelopeV2,
  connection_id: v.connection_id,
  delivery_id: v.delivery_id,
  kind,
});

describe("receipt-v2 shared vectors against the Gateway candidate", () => {
  it("covers the shared corpus", () => {
    expect(vectors.receipt_protocol).toBe(RECEIPT_PROTOCOL);
    expect(vectors.chains.length).toBe(19);
    expect(vectors.negative.length).toBe(14);
  });

  it.each(vectors.chains.map((v) => [v.name, v] as const))(
    "%s verifies, re-signs byte-identically and matches its digests",
    async (_n, v) => {
      expect(await sha256Hex(v.body)).toBe(v.envelope_sha256);
      expect(await deliveryIdentity(JSON.parse(v.body) as EnvelopeV2, v.connection_id)).toBe(v.delivery_id);
      const chain = v.receipts as unknown as ReceiptV2[];
      for (let i = 0; i < chain.length; i++) {
        const r = chain[i]!;
        await verifyReceiptV2(r, exp(v, r.kind), registry, vectors.now, chain.slice(0, i));
        const { signature: _s, ...unsigned } = r;
        expect(RECEIPT_PROTOCOL + "\n" + canonicalize(unsigned)).toBe(v.signed_bytes[i]);
        const key = registry.keys.find((k) => k.key_id === r.key_id)!;
        const again = await signReceiptV2(
          await receiptDraft(exp(v, r.kind), r.outcome, r.issued_at, i ? chain[i - 1]! : null),
          key,
        );
        expect(JSON.stringify(again)).toBe(JSON.stringify(r));
        expect(await receiptDigest(r)).toBe(v.digests[i]);
      }
    },
  );

  it.each(vectors.negative.map((n) => [n.name, n] as const))("refuses %s", async (_n, n) => {
    const v = vectors.chains.find((c) => c.name === n.chain)!;
    const chain = n.receipts as unknown as ReceiptV2[];
    const last = chain[chain.length - 1]!;
    await expect(
      verifyReceiptV2(
        last,
        exp(v, last.kind, "body" in n ? (n.body as string) : v.body),
        ("registry" in n ? n.registry : vectors.registry) as unknown as Registry,
        "now" in n ? (n.now as number) : vectors.now,
        chain.slice(0, -1),
      ),
    ).rejects.toThrow(n.error);
  });
});
