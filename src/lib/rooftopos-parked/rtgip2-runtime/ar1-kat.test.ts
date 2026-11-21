// AR-1 strict option 1 (PROPOSAL): the app side replays the Gateway builder's known-answer corpus
// rtgip2-gateway-kat.v3.json (pinned by sha256 below; synthetic kat- keys only). v3 is a strict
// superset of rtgip2-gateway-kat.v2.json, which stays pinned and byte-identical. The node registry
// is not taken from the KAT's key_stores: it is derived from ALL its keys, legacy -1 rows included,
// by this runtime's own verification-path rule, and must come out equal to key_stores. Every valid
// vector must verify with this app code and every refusal vector must fail with the KAT's reason.
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MemoryNonceStore,
  canonicalize,
  verifyDelivery,
  type EnvelopeV2,
  type Registry,
  type ServiceConnection,
  type ServiceKey,
} from "../rtgip2/protocol.ts";
import { verifyReceiptV2, type ReceiptV2 } from "../rtgip2/receipt-v2.ts";
import { verifyReceiptQuery } from "../rtgip2/receipt-query.ts";
import { ADMISSION_HEADER, decodeAdmissionHeader } from "../rtgip2/admission.ts";
import {
  confirmationDraft,
  inVerificationPath,
  signConfirmation,
  verifySourceChain,
} from "./source-chain.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KAT_SHA256 = "95a6865344a0692d41dcaad917d9af65166e7fdb015ef6760b210dcb4b4c64a3";
const KAT_V2_SHA256 = "9e05f35153aa6fdf746f7b509455900604ba8a34df700d2221e0cf82184d5bd4";
const raw = readFileSync(path.join(HERE, "rtgip2-gateway-kat.v3.json"));
const rawV2 = readFileSync(path.join(HERE, "rtgip2-gateway-kat.v2.json"));

type Json = Record<string, unknown>;
type KatKey = ServiceKey & { audience: string | null };
interface KatDelivery {
  name: string;
  case: string;
  connection_id: string;
  source_app: string;
  target_app: string;
  body: string;
  delivery_id: string;
  admission_source: { receipt: ReceiptV2; signed_bytes: string; digest: string };
  admission_target: { receipt: ReceiptV2; signed_bytes: string; digest: string };
  forward: { signer_key: string; headers: Record<string, string> };
  target_chain: { receipts: ReceiptV2[] };
  gateway_confirmation: { receipt: ReceiptV2; signed_bytes: string; digest: string } | null;
  receipt_query: {
    response: { reason: null; receipts: ReceiptV2[]; target_evidence: ReceiptV2[] };
  };
}
const kat = JSON.parse(raw.toString("utf8")) as {
  schema: string;
  version: number;
  status: string;
  t0: number;
  now: number;
  keys: KatKey[];
  key_stores: Record<string, string[]>;
  connections: ServiceConnection[];
  deliveries: KatDelivery[];
  attack_deliveries: Record<string, { connection_id: string; delivery_id: string; body: string }>;
  refusals: { id: string; name: string; error: string; vector: Json }[];
  counts: { deliveries: number; refusals: number };
};
const T0 = kat.t0;
const NOW = kat.now;
const APPS = ["autolabels", "autocurb", "autoframe"] as const;
const connections = kat.connections;
const K = (id: string) => kat.keys.find((k) => k.key_id === id)!;
/** This runtime's view of a node's database holding every KAT key row, legacy -1 rows included. */
const nodeRegistry = (node: string): Registry => ({
  connections,
  keys: kat.keys.filter((k) => inVerificationPath(node, k)),
});
/** The Gateway's views, as its AR-1 keys.ts registryView builds them (core verifiers only). */
const gatewayApps = (gatewayTo?: string): Registry => ({
  connections,
  keys: kat.keys.filter((k) =>
    k.owner === "gateway"
      ? gatewayTo !== undefined && k.audience === gatewayTo
      : k.audience === "gateway",
  ),
});
const targets: Record<string, { connection_id: string; delivery_id: string; body: string }> = {
  ...Object.fromEntries(kat.deliveries.map((d) => [d.name, d])),
  ...kat.attack_deliveries,
};
const expectOf = (name: string) => {
  const d = targets[name]!;
  return {
    envelope: JSON.parse(d.body) as EnvelopeV2,
    connection_id: d.connection_id,
    delivery_id: d.delivery_id,
  };
};
const H = (x: unknown) => x as Record<string, string>;

async function run(v: Json): Promise<string> {
  try {
    switch (v["check"]) {
      case "target_forward": {
        const node = String(v["node"]);
        const { [ADMISSION_HEADER]: _a, "content-type": _c, ...signed } = H(v["headers"]);
        const r = await verifyDelivery(signed, String(v["body"]), {
          registry: nodeRegistry(node),
          nonces: new MemoryNonceStore(),
          nowSec: T0 + 1,
          expectedSigner: "gateway",
          receiver: node as never,
        });
        return "reason" in r ? r.reason : "accepted";
      }
      case "target_admission":
        await verifyReceiptV2(
          v["receipt"],
          { ...expectOf(String(v["delivery"])), kind: "gateway_admission" },
          nodeRegistry(String(v["node"])),
          NOW,
        );
        return "accepted";
      case "source_chain":
        await verifySourceChain(
          v["receipts"] as unknown[],
          expectOf(String(v["delivery"])),
          nodeRegistry(String(v["node"])),
          NOW,
        );
        return "accepted";
      case "gateway_submission": {
        const r = await verifyDelivery(H(v["headers"]), String(v["body"]), {
          registry: gatewayApps(),
          nonces: new MemoryNonceStore(),
          nowSec: T0,
          expectedSigner: "source",
        });
        return "reason" in r ? r.reason : "accepted";
      }
      case "gateway_target_chain": {
        const e = expectOf(String(v["delivery"]));
        const rs = v["receipts"] as ReceiptV2[];
        const last = rs[rs.length - 1]!;
        await verifyReceiptV2(
          last,
          { ...e, kind: last.kind },
          gatewayApps(e.envelope.target_app),
          NOW,
          rs.slice(0, -1),
        );
        return "accepted";
      }
      case "receipt_query": {
        const e = expectOf(String(v["delivery"]));
        const r = await verifyReceiptQuery(H(v["headers"]), String(v["body"]), {
          registry: gatewayApps(),
          nonces: new MemoryNonceStore(),
          nowSec: NOW,
          lookup: (id) =>
            id === e.delivery_id
              ? {
                  connection_id: e.connection_id,
                  source_app: e.envelope.source_app,
                  tenant_id: e.envelope.tenant_id,
                  event_id: e.envelope.event_id,
                }
              : null,
        });
        return "reason" in r ? r.reason : "accepted";
      }
    }
    return "unknown_check";
  } catch (err) {
    return (err as Error).message;
  }
}

describe("AR-1 KAT v3 replayed by the app runtime", () => {
  it("is the pinned v3 PROPOSAL corpus with synthetic kat- keys only", () => {
    expect(createHash("sha256").update(raw).digest("hex")).toBe(KAT_SHA256);
    expect([kat.schema, kat.version, kat.counts]).toEqual([
      "rooftopos/ar1/rtgip2-gateway-kat/3",
      3,
      { deliveries: 6, refusals: 35 },
    ]);
    expect(kat.status.startsWith("PROPOSAL")).toBe(true);
    expect(kat.keys.every((k) => k.key_id.startsWith("kat-"))).toBe(true);
  });

  it("is a strict superset of the pinned v2 corpus (same keys, v2 vectors byte for byte)", () => {
    expect(createHash("sha256").update(rawV2).digest("hex")).toBe(KAT_V2_SHA256);
    const v2 = JSON.parse(rawV2.toString("utf8")) as typeof kat;
    expect([v2.version, v2.counts]).toEqual([2, { deliveries: 5, refusals: 28 }]);
    expect(kat.keys).toEqual(v2.keys);
    expect(kat.key_stores).toEqual(v2.key_stores);
    expect(kat.connections).toEqual(v2.connections);
    expect(kat.deliveries.slice(0, 5)).toEqual(v2.deliveries);
    expect(kat.refusals.slice(0, 28)).toEqual(v2.refusals);
    expect(kat.deliveries.slice(5).map((d) => [d.case, d.gateway_confirmation?.receipt.outcome])).toEqual([
      ["abandoned", "delivery_abandoned"],
    ]);
  });

  it("derives each app's key store from every KAT key by the runtime's own rule", () => {
    for (const app of APPS) {
      expect(nodeRegistry(app).keys.map((k) => k.key_id)).toEqual(kat.key_stores[app]);
      expect(nodeRegistry(app).keys.map((k) => [k.owner, (k as KatKey).audience])).toEqual([
        [app, "gateway"],
        ["gateway", app],
      ]);
    }
  });

  for (const d of kat.deliveries) {
    describe(d.name, () => {
      const exp = expectOf(d.name);
      it("the target accepts the forward and its own admission receipt (adm_T, gw-<target>)", async () => {
        expect(
          await run({
            check: "target_forward",
            node: d.target_app,
            headers: d.forward.headers,
            body: d.body,
          }),
        ).toBe("accepted");
        expect(d.forward.signer_key).toBe(`kat-gw-${d.target_app}-2`);
        const header = decodeAdmissionHeader(d.forward.headers[ADMISSION_HEADER]);
        expect(header?.receipt).toEqual(d.admission_target.receipt);
        expect(
          await run({
            check: "target_admission",
            node: d.target_app,
            delivery: d.name,
            receipt: d.admission_target.receipt,
          }),
        ).toBe("accepted");
        expect(
          await run({
            check: "target_admission",
            node: d.target_app,
            delivery: d.name,
            receipt: d.admission_source.receipt,
          }),
        ).toBe("ack_key_not_authorized");
      });

      it("the source verifies exactly [adm_S] and [adm_S, gateway_confirmation]", async () => {
        const reg = nodeRegistry(d.source_app);
        expect((await verifySourceChain([d.admission_source.receipt], exp, reg, NOW)).state).toBe(
          "gateway_admitted",
        );
        if (!d.gateway_confirmation) {
          expect(d.case).toBe("held");
          return;
        }
        const v = await verifySourceChain(
          [d.admission_source.receipt, d.gateway_confirmation.receipt],
          exp,
          reg,
          NOW,
        );
        expect(v.state).toBe(
          d.case === "quarantined"
            ? "target_quarantined"
            : d.case === "abandoned"
              ? "dead_letter"
              : "consumer_committed",
        );
        for (const other of APPS.filter((a) => a !== d.source_app))
          expect(
            await run({
              check: "source_chain",
              node: other,
              delivery: d.name,
              receipts: [d.admission_source.receipt, d.gateway_confirmation.receipt],
            }),
          ).toBe("ack_key_not_authorized");
      });

      it("reproduces the Gateway's confirmation byte for byte from the app-side draft", async () => {
        if (!d.gateway_confirmation) return;
        const c = d.gateway_confirmation.receipt;
        const mine = await signConfirmation(
          await confirmationDraft(exp, c.outcome as never, c.issued_at, d.admission_source.receipt),
          K(`kat-gw-${d.source_app}-2`),
        );
        expect(mine).toEqual(c);
        const { signature: _s, ...unsigned } = mine;
        expect("rtgip/2-receipt/2\n" + canonicalize(unsigned)).toBe(
          d.gateway_confirmation.signed_bytes,
        );
      });

      it("the receipt query answer advances on the Gateway stages only; target evidence is never verified", async () => {
        const resp = d.receipt_query.response;
        expect(resp.receipts.map((r) => r.kind)).toEqual(
          d.gateway_confirmation
            ? ["gateway_admission", "gateway_confirmation"]
            : ["gateway_admission"],
        );
        if (d.case === "abandoned")
          expect(resp.target_evidence).toEqual([d.admission_target.receipt]);
        const gatewayStages = resp.receipts.filter((r) =>
          ["gateway_admission", "gateway_confirmation"].includes(r.kind),
        );
        expect(gatewayStages).toEqual(resp.receipts);
        expect(
          await run({
            check: "source_chain",
            node: d.source_app,
            delivery: d.name,
            receipts: resp.receipts,
          }),
        ).toBe("accepted");
        expect(
          await run({
            check: "source_chain",
            node: d.source_app,
            delivery: d.name,
            receipts: resp.target_evidence,
          }),
        ).not.toBe("accepted");
      });

      it("the target chain verifies at the Gateway with the core verifier (cross-check)", async () => {
        expect(
          await run({
            check: "gateway_target_chain",
            delivery: d.name,
            receipts: d.target_chain.receipts,
          }),
        ).toBe("accepted");
      });
    });
  }

  describe("every refusal vector fails with the KAT's reason", () => {
    for (const r of kat.refusals)
      it(`${r.id}: ${r.name}`, async () => {
        expect(await run(r.vector)).toBe(r.error);
      });
  });
});
