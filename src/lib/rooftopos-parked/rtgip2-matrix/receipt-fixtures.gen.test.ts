// @vitest-environment node
// Cross-language receipt vectors for the proposed SQL verifier (rtgip.outbox_advance).
// Signed here by the real TypeScript signReceipt; the Postgres harness must accept exactly
// these bytes and refuse every tampered variant. With RTGIP_RECEIPTS_OUT set the file is
// rewritten; otherwise the committed copy must match what the code produces today.
import { expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import corpus from "../rtgip2/rtgip2-corpus.v2.json";
import { sha256Hex, type EnvelopeV2, type Registry } from "../rtgip2/protocol.ts";
import { receiptSigningJson, signReceipt, verifyReceipt, expectReceipt, watermarkKey, type ReceiptKind } from "../rtgip2/delivery.ts";
import { connId, keyOf, syntheticRegistry } from "../rtgip2/fixtures.ts";

const ISSUED_AT = 1_767_225_600; // 2026-01-01T00:00:00Z, in the past for any real clock
const NOT_BEFORE = 1_764_547_200; // 2025-12-01
const NOT_AFTER = 1_893_456_000; // 2030-01-01
const OUT = join(dirname(fileURLToPath(import.meta.url)), "../../../../supabase/tests/rtgip/receipt-fixtures.json");

it("receipt vectors for the SQL verifier are reproducible and verify in TypeScript", async () => {
  const base = syntheticRegistry();
  const reg: Registry = { ...base, keys: base.keys.map((k) => ({ ...k, not_before: NOT_BEFORE, not_after: NOT_AFTER })) };
  const entry = corpus.entries.find((e) => e.route === "autolabels->autocurb")!;
  const env = JSON.parse(entry.body) as EnvelopeV2;
  const conn = connId(env.source_app, env.target_app);
  const mk = async (kind: ReceiptKind, outcome: string) => {
    const issuer = kind === "gateway_admission" ? "gateway" : env.target_app;
    const key = keyOf(reg, issuer === "gateway" ? "gw-dev-1" : "ac-dev-1");
    const r = await signReceipt({ ...expectReceipt(env, conn, kind), protocol: "rtgip/2", outcome: outcome as never, issued_at: ISSUED_AT }, key);
    expect(await verifyReceipt(r, expectReceipt(env, conn, kind), reg, ISSUED_AT)).toEqual({ ok: true });
    const { signature, ...rest } = r;
    return { name: `${kind}:${outcome}`, signing_text: receiptSigningJson(rest), signature };
  };
  const vectors = {
    note: "Synthetic DEV-literal vectors. Secrets are public test values from fixtures.ts and must never be provisioned.",
    domain_prefix: "rtgip/2-receipt\n",
    event: { body: entry.body, body_sha256: await sha256Hex(entry.body), connection_id: conn, watermark_key: watermarkKey(env) },
    keys: ["gw-dev-1", "ac-dev-1"].map((id) => {
      const k = keyOf(reg, id);
      return { key_id: k.key_id, owner: k.owner, dialect: k.dialect, status: k.status, connection_ids: k.connection_ids, not_before: NOT_BEFORE, not_after: NOT_AFTER, secret_ref: `rtgip:${k.key_id}`, dev_secret: k.secret };
    }),
    connections: reg.connections.filter((c) => c.connection_id === conn),
    receipts: [
      await mk("gateway_admission", "admitted"),
      await mk("target_inbox", "applied"),
      await mk("consumer_commit", "applied"),
      await mk("target_inbox", "quarantined"),
      await mk("target_inbox", "held"),
      await mk("target_inbox", "duplicate"),
    ],
  };
  const text = JSON.stringify(vectors, null, 2) + "\n";
  if (process.env.RTGIP_RECEIPTS_OUT) writeFileSync(OUT, text);
  else expect(readFileSync(OUT, "utf8")).toBe(text);
});
