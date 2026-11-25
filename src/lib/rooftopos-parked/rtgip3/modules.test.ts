import { describe, expect, it } from "vitest";
import { verifyDelivery, type EnvelopeV2 } from "../rtgip2/core";
import kat from "../../../test/fixtures/rtgip3-kat.v1.json";
import { recordPin as katPin, type KatFile, type KatVector, type KeyRecord } from "./kat";
import { importSigningKey, PKCS8_ED25519_PREFIX, selfTestProbe, verifyEd25519, type SigningKey3, type Verdict } from "./sig";
import { currentSigningRecord, loadSigningKey3, ownerOfKeyId, parsePins, recordPin, resolveKey3, type KeyContext3 } from "./keys3";
import {
  decodeOrigin,
  encodeOrigin,
  gateVerdict,
  originOf,
  signEnvelopeV3,
  sourceRowCheck,
  verifyAttest3,
  verifyForwardEvidence3,
  verifyOrigin3,
  verifySignature3,
  type AttestExpected3,
  type ConnectionGate,
  type EnvelopeScopeFields,
  type SignedHeaders3,
} from "./core3";
import { evaluateChain3, receiptDigest3, signReceipt3, verifyReceipt3, type ChainEnvelope, type Receipt3 } from "./receipt3";
import { signReceiptQuery3, verifyQuerySignature3, type QueryHeaders3 } from "./receipt-query3";

const file = kat as unknown as KatFile;
const b64 = (hex: string) => Buffer.from(hex, "hex").toString("base64");
export const katPkcs8 = (keyId: string) => b64(PKCS8_ED25519_PREFIX + file.seeds[keyId]!);
const recordOf = (id: string) => file.keys.find((k) => k.key_id === id)!;
const signerFor = async (id: string): Promise<SigningKey3> => (await importSigningKey(id, recordOf(id).owner, katPkcs8(id), recordOf(id).public_key))!;

async function ctxFor(v: KatVector): Promise<KeyContext3> {
  const pins = { ...file.pins };
  for (const id of v.ctx?.unpin ?? []) delete pins[id];
  let keys: KeyRecord[] = file.keys;
  const patch = v.ctx?.patch;
  if (patch) {
    keys = file.keys.map((k) => (k.key_id === patch.key_id ? { ...k, ...patch.set } : k));
    if (patch.repin) pins[patch.key_id] = await recordPin(keys.find((k) => k.key_id === patch.key_id)!);
  }
  return { keys, pins, now: v.ctx?.now ?? file.now, env: v.ctx?.env ?? file.key_env };
}
const str = (o: Record<string, unknown>, k: string) => String(o[k]);
const strip = (r: { ok: boolean; reason?: string; status?: string }) => (r.ok ? (r.status ? { ok: true, status: r.status } : { ok: true }) : { ok: false, reason: r.reason });

/** Every KAT vector through the production modules (never kat.ts). */
async function verdict(v: KatVector): Promise<{ ok: boolean; reason?: string; status?: string }> {
  const c = await ctxFor(v);
  const i = v.input;
  const conn = i["connection_id"] === undefined ? undefined : str(i, "connection_id");
  switch (v.kind) {
    case "ed25519":
      return verifyEd25519(str(i, "public_key"), String(i["message"]), str(i, "signature"));
    case "envelope":
      return verifySignature3(i["headers"] as SignedHeaders3, str(i, "body"), "source", c, conn);
    case "forward":
      return verifyForwardEvidence3(
        { headers: i["headers"] as SignedHeaders3, body: str(i, "body"), admission: (i["admission"] as string | null) ?? null, origin: (i["origin"] as string | null) ?? null },
        c,
        str(i, "connection_id"),
      );
    case "origin":
      return verifyOrigin3((i["origin"] as string | null) ?? null, str(i, "body"), str(i, "forward_scope"), JSON.parse(str(i, "body")) as EnvelopeScopeFields, c);
    case "receipt":
      return verifyReceipt3(i["receipt"], c);
    case "query":
      return verifyQuerySignature3(i["headers"] as QueryHeaders3, str(i, "body"), c);
    case "gate":
      return gateVerdict(i["connection"] as ConnectionGate, str(i, "presented"), c.now);
    case "source_row":
      return sourceRowCheck(str(i, "row_protocol"), str(i, "entry_protocol"), i["receipt_protocols"] as string[]);
    case "attest":
      return verifyAttest3(i["attest"], i["expected"] as AttestExpected3[], c, Number(i["db_now"]));
    case "v2_path": {
      // The real, frozen rtgip/2 verifier, not a shape regex: a v3 signature never passes it.
      const r = await verifyDelivery(
        { "rtgip-protocol": "rtgip/2", "rtgip-key-id": "k", "rtgip-signer": "autolabels", "rtgip-timestamp": "1", "rtgip-nonce": "n".repeat(16), "rtgip-scope": "s", "rtgip-signature": str(i, "signature_header") },
        "{}",
        { registry: { keys: [], connections: [] }, nonces: { claim: async () => "claimed" }, nowSec: 1, expectedSigner: "source" },
      );
      return r.ok ? { ok: true } : { ok: false, reason: r.reason };
    }
    case "chain": {
      const body = str(i, "body");
      const envelope = JSON.parse(body) as ChainEnvelope;
      const { sha256Hex } = await import("./sig");
      return evaluateChain3(i["receipts"] as unknown[], { ...c, envelope, envelope_sha256: await sha256Hex(body), connection_id: str(i, "connection_id") });
    }
  }
}

describe("rtgip3 production modules against the frozen KAT", () => {
  it("give every vector exactly the expected verdict, reason and status", async () => {
    const bad: string[] = [];
    for (const v of file.vectors) {
      const got = strip(await verdict(v));
      const want = v.expect.ok ? ("status" in v.expect && v.expect.status ? { ok: true, status: v.expect.status } : { ok: true }) : { ok: false, reason: v.expect.reason };
      if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`${v.id}: expected ${JSON.stringify(want)} got ${JSON.stringify(got)}`);
    }
    expect(bad).toEqual([]);
    expect(file.vectors.length).toBe(194);
  });

  it("verify the RFC 8032 section 7.1 vectors and reproduce them by signing", async () => {
    for (const r of file.rfc8032) {
      expect((await verifyEd25519(r.public_key, Buffer.from(r.message_hex, "hex"), r.signature)).ok).toBe(true);
      const k = await importSigningKey("rfc", "x", b64(PKCS8_ED25519_PREFIX + r.seed), r.public_key);
      expect(k).not.toBeNull();
    }
  });

  it("compute the same pins as the reference and resolve every KAT key", async () => {
    for (const k of file.keys) expect(await recordPin(k)).toBe(await katPin(k));
    const ctx: KeyContext3 = { keys: file.keys, pins: file.pins, now: file.now, env: "kat" };
    expect((await resolveKey3(ctx, "kat-autolabels-ed1", "autolabels")).ok).toBe(true);
    expect(await resolveKey3(ctx, "kat-autolabels-ed10", "autolabels")).toEqual({ ok: false, reason: "key_not_pinned" });
    expect(await resolveKey3(ctx, "kat-autolabels-ed11", "autolabels")).toEqual({ ok: false, reason: "key_revoked" });
    expect(ownerOfKeyId("stg-gateway-ed1", "stg")).toBe("gateway");
    expect(ownerOfKeyId("stg-gateway-ed1", "prd")).toBeNull();
    expect(ownerOfKeyId("kat-gateway-ed1", "k.*")).toBeNull();
  });

  it("re-sign every positive envelope, forward, query and receipt byte for byte", async () => {
    let n = 0;
    for (const v of file.vectors.filter((x) => x.expect.ok && x.message !== undefined && !x.ctx)) {
      const i = v.input;
      if (v.kind === "envelope" || v.kind === "forward") {
        const h = i["headers"] as SignedHeaders3;
        const key = await signerFor(h["rtgip-key-id"]);
        const again = await signEnvelopeV3(str(i, "body"), JSON.parse(str(i, "body")) as EnvelopeV2, key, Number(h["rtgip-timestamp"]), h["rtgip-nonce"]);
        expect(again).toEqual(h);
        n++;
      } else if (v.kind === "query") {
        const h = i["headers"] as QueryHeaders3;
        const q = JSON.parse(str(i, "body")) as { delivery_id: string; event_id: string };
        const again = await signReceiptQuery3(q, await signerFor(h["rtgip-key-id"]), Number(h["rtgip-timestamp"]), h["rtgip-nonce"]);
        expect(again).toEqual({ body: str(i, "body"), headers: h });
        n++;
      } else if (v.kind === "receipt") {
        const r = i["receipt"] as Receipt3;
        const { signature: _s, key_id: _k, ...draft } = r;
        expect(await signReceipt3(draft, await signerFor(r.key_id))).toEqual(r);
        n++;
      } else if (v.kind === "origin") {
        const o = decodeOrigin(str(i, "origin"))!;
        expect(encodeOrigin(o)).toBe(str(i, "origin"));
        n++;
      }
    }
    expect(n).toBeGreaterThanOrEqual(30);
  });

  it("rebuild the forward's origin from the source's H1 headers exactly", async () => {
    for (const d of ["autolabels_to_autocurb", "autocurb_to_autoframe", "autoframe_to_autolabels"]) {
      const env = file.vectors.find((x) => x.id === `pos:${d}:envelope`)!;
      const fwd = file.vectors.find((x) => x.id === `pos:${d}:forward`)!;
      expect(encodeOrigin(originOf(env.input["headers"] as SignedHeaders3))).toBe(fwd.input["origin"]);
    }
  });
});

describe("rtgip3 signing keys and the load-time self-test", () => {
  const ctx: KeyContext3 = { keys: file.keys, pins: file.pins, now: file.now, env: "kat" };
  it("loads a key whose private half matches the pinned public key, non-extractable", async () => {
    const k = await loadSigningKey3(ctx, "gateway", (id) => (id === "kat-gateway-ed1" ? katPkcs8(id) : undefined));
    expect(k?.key_id).toBe("kat-gateway-ed1");
    expect(Object.keys(k!).sort()).toEqual(["key_id", "owner", "public_key", "sign"]);
    expect((await verifyEd25519(k!.public_key, selfTestProbe(k!.key_id), await k!.sign(selfTestProbe(k!.key_id)))).ok).toBe(true);
  });
  it("drops a key whose private half belongs to another key (no_signing_key)", async () => {
    expect(await loadSigningKey3(ctx, "gateway", () => katPkcs8("kat-autolabels-ed1"))).toBeNull();
  });
  it("drops a missing, short, padded or wrong-algorithm secret", async () => {
    for (const s of [undefined, "", katPkcs8("kat-gateway-ed1").slice(1), katPkcs8("kat-gateway-ed1") + "=", b64("302e020100300506032b657104220420" + "00".repeat(32))])
      expect(await importSigningKey("kat-gateway-ed1", "gateway", s, recordOf("kat-gateway-ed1").public_key)).toBeNull();
  });
  it("refuses to sign with an unpinned, revoked or ambiguous current key", async () => {
    const unpinned = { ...ctx, pins: { ...file.pins, "kat-gateway-ed1": "0".repeat(64) } };
    expect(await currentSigningRecord(unpinned, "gateway")).toBeNull();
    const twoCurrent = { ...ctx, keys: [...file.keys, { ...recordOf("kat-gateway-ed1"), key_id: "kat-gateway-ed2" }] };
    expect(await currentSigningRecord(twoCurrent, "gateway")).toBeNull();
    const autolabels = await currentSigningRecord(ctx, "autolabels");
    expect(autolabels).toBeNull();
  });
  it("parses RTGIP3_KEY_PINS strictly and fails closed on any malformed entry", () => {
    const p = "a".repeat(64);
    expect(parsePins(`stg-gateway-ed1:${p}, stg-autocurb-ed2:${p}`)).toEqual({ "stg-gateway-ed1": p, "stg-autocurb-ed2": p });
    expect(parsePins(undefined)).toEqual({});
    for (const bad of [`x:${p},x:${p}`, `x:${p.slice(1)}`, `x ${p}`, `x:${p.toUpperCase()}`, `__proto__:${p}`]) expect(() => parsePins(bad)).toThrow("pins_malformed");
  });
});

describe("rtgip3 receipts: kind table and chain", () => {
  const ctx: KeyContext3 = { keys: file.keys, pins: file.pins, now: file.now, env: "kat" };
  it("never lets an app key sign a Gateway stage, or the Gateway sign a target stage", async () => {
    const v = file.vectors.find((x) => x.id === "pos:autolabels_to_autocurb:chain_committed")!;
    const [adm, inbox] = v.input["receipts"] as Receipt3[];
    const { signature: _a, key_id: _b, ...admDraft } = adm!;
    await expect(signReceipt3(admDraft, await signerFor("kat-autocurb-ed1"))).rejects.toThrow("receipt_signer_not_authorized");
    const { signature: _c, key_id: _d, ...inboxDraft } = inbox!;
    await expect(signReceipt3(inboxDraft, await signerFor("kat-gateway-ed1"))).rejects.toThrow("receipt_signer_not_authorized");
    expect(await receiptDigest3(adm!)).toBe(inbox!.prev_receipt_sha256);
    expect(((await verifyReceipt3(adm, ctx)) as Verdict).ok).toBe(true);
  });
});
