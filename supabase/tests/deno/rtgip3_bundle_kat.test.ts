// The frozen rtgip/3 known-answer vectors run under Deno against the BUILT runtime bundle (the bytes the edge
// functions deploy), through its RTGIP3 export: every module the runtime signs and verifies with, not the sources.
// The bundle's sha256 is the attestation verifier digest; it must match the sidecar the build wrote.
//   deno test --node-modules-dir=none --allow-read --allow-env supabase/tests/deno/rtgip3_bundle_kat.test.ts
// No network: the bundle's npm:postgres import must already be in the Deno cache. The KAT keys are TEST ONLY.
import kat from "../../../src/test/fixtures/rtgip3-kat.v1.json" with { type: "json" };

type V = { ok: boolean; reason?: string; status?: string };
type Rec = Record<string, unknown>;
interface Vector {
  id: string;
  kind: string;
  message?: string;
  input: Rec;
  ctx?: { now?: number; unpin?: string[]; env?: string; patch?: { key_id: string; set: Rec; repin: boolean } };
  expect: V;
}
interface Kat {
  now: number;
  key_env: string;
  pkcs8_prefix_hex: string;
  keys: Rec[];
  seeds: Record<string, string>;
  pins: Record<string, string>;
  rfc8032: { seed: string; public_key: string; message_hex: string; signature: string }[];
  vectors: Vector[];
}
const file = kat as unknown as Kat;
const bundleUrl = new URL("../../functions/_shared/rtgip2-runtime.bundle.js", import.meta.url);
const B = (await import(bundleUrl.href)) as { RTGIP3: Record<string, Record<string, (...a: unknown[]) => unknown>> };
const { sig, keys, core, receipt, query, v2 } = B.RTGIP3 as unknown as Record<string, Record<string, (...a: never[]) => Promise<V & Rec>>>;

const must = (cond: boolean, msg: string) => {
  if (!cond) throw new Error(msg);
};
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const fromHex = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));
const b64 = (h: string) => btoa(String.fromCharCode(...fromHex(h)));
const str = (o: Rec, k: string) => String(o[k]);
const canon = (x: unknown): string =>
  Array.isArray(x)
    ? `[${x.map(canon).join(",")}]`
    : x && typeof x === "object"
      ? `{${Object.keys(x).sort().map((k) => `${JSON.stringify(k)}:${canon((x as Rec)[k])}`).join(",")}}`
      : JSON.stringify(x);
const same = (a: unknown, b: unknown) => canon(a) === canon(b);
const strip = (r: V): V => (r.ok ? (r.status ? { ok: true, status: r.status } : { ok: true }) : { ok: false, reason: r.reason });
const pkcs8 = (id: string) => b64(file.pkcs8_prefix_hex + file.seeds[id]!);
const recordOf = (id: string) => file.keys.find((k) => k["key_id"] === id)!;
const signerFor = async (id: string) =>
  (await (sig.importSigningKey as unknown as (...a: unknown[]) => Promise<unknown>)(id, recordOf(id)["owner"], pkcs8(id), recordOf(id)["public_key"]))!;

async function ctxFor(v: Vector) {
  const pins = { ...file.pins };
  for (const id of v.ctx?.unpin ?? []) delete pins[id];
  let ks = file.keys;
  const patch = v.ctx?.patch;
  if (patch) {
    ks = file.keys.map((k) => (k["key_id"] === patch.key_id ? { ...k, ...patch.set } : k));
    if (patch.repin) pins[patch.key_id] = (await (keys.recordPin as unknown as (k: Rec) => Promise<string>)(ks.find((k) => k["key_id"] === patch.key_id)!));
  }
  return { keys: ks, pins, now: v.ctx?.now ?? file.now, env: v.ctx?.env ?? file.key_env };
}

const call = (f: unknown, ...a: unknown[]) => (f as (...x: unknown[]) => Promise<V> | V)(...a);

async function verdict(v: Vector): Promise<V> {
  const c = await ctxFor(v);
  const i = v.input;
  const conn = i["connection_id"] === undefined ? undefined : str(i, "connection_id");
  switch (v.kind) {
    case "ed25519":
      return call(sig.verifyEd25519, str(i, "public_key"), String(i["message"]), str(i, "signature"));
    case "envelope":
      return call(core.verifySignature3, i["headers"], str(i, "body"), "source", c, conn);
    case "forward":
      return call(
        core.verifyForwardEvidence3,
        { headers: i["headers"], body: str(i, "body"), admission: i["admission"] ?? null, origin: i["origin"] ?? null },
        c,
        str(i, "connection_id"),
      );
    case "origin":
      return call(core.verifyOrigin3, i["origin"] ?? null, str(i, "body"), str(i, "forward_scope"), JSON.parse(str(i, "body")), c);
    case "receipt":
      return call(receipt.verifyReceipt3, i["receipt"], c);
    case "query":
      return call(query.verifyQuerySignature3, i["headers"], str(i, "body"), c);
    case "gate":
      return call(core.gateVerdict, i["connection"], str(i, "presented"), c.now);
    case "source_row":
      return call(core.sourceRowCheck, str(i, "row_protocol"), str(i, "entry_protocol"), i["receipt_protocols"]);
    case "attest":
      return call(core.verifyAttest3, i["attest"], i["expected"], c, Number(i["db_now"]));
    case "v2_path":
      return call(
        v2.verifyDelivery,
        { "rtgip-protocol": "rtgip/2", "rtgip-key-id": "k", "rtgip-signer": "autolabels", "rtgip-timestamp": "1", "rtgip-nonce": "n".repeat(16), "rtgip-scope": "s", "rtgip-signature": str(i, "signature_header") },
        "{}",
        { registry: { keys: [], connections: [] }, nonces: { claim: async () => "claimed" }, nowSec: 1, expectedSigner: "source" },
      );
    case "chain": {
      const body = str(i, "body");
      return call(receipt.evaluateChain3, i["receipts"], { ...c, envelope: JSON.parse(body), envelope_sha256: await call(sig.sha256Hex, body), connection_id: str(i, "connection_id") });
    }
  }
  throw new Error(`unknown kind ${v.kind}`);
}

Deno.test("the bundle's sha256 is the digest its build published (the attestation verifier)", async () => {
  const bytes = await Deno.readFile(bundleUrl);
  const digest = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
  const sidecar = await Deno.readTextFile(new URL("../../functions/_shared/rtgip2-runtime.bundle.js.sha256", import.meta.url));
  must(sidecar === `${digest}  rtgip2-runtime.bundle.js\n`, `sidecar ${JSON.stringify(sidecar)} does not name ${digest}`);
  const want = Deno.env.get("RTGIP3_VERIFIER_DIGEST");
  if (want !== undefined) must(want === digest, `RTGIP3_VERIFIER_DIGEST ${want} is not this bundle (${digest})`);
});

Deno.test("every known-answer vector gives the expected verdict, reason and status through the bundle", async () => {
  const bad: string[] = [];
  for (const v of file.vectors) {
    const got = strip(await verdict(v));
    const want = v.expect.ok ? (v.expect.status ? { ok: true, status: v.expect.status } : { ok: true }) : { ok: false, reason: v.expect.reason };
    if (JSON.stringify(got) !== JSON.stringify(want)) bad.push(`${v.id}: expected ${JSON.stringify(want)} got ${JSON.stringify(got)}`);
  }
  must(bad.length === 0, `failing vectors:\n${bad.join("\n")}`);
  must(file.vectors.length === 194, `expected 194 vectors, got ${file.vectors.length}`);
});

Deno.test("RFC 8032 section 7.1 vectors verify, and the bundle's key import passes its self-test on them", async () => {
  for (const r of file.rfc8032) {
    must((await call(sig.verifyEd25519, r.public_key, fromHex(r.message_hex), r.signature)).ok, "rfc8032 verify");
    must((await (sig.importSigningKey as unknown as (...a: unknown[]) => Promise<unknown>)("rfc", "x", b64(file.pkcs8_prefix_hex + r.seed), r.public_key)) !== null, "rfc8032 import");
  }
});

Deno.test("the bundle re-signs every positive envelope, forward, query and receipt byte for byte", async () => {
  let n = 0;
  for (const v of file.vectors.filter((x) => x.expect.ok && x.message !== undefined && !x.ctx)) {
    const i = v.input;
    if (v.kind === "envelope" || v.kind === "forward") {
      const h = i["headers"] as Record<string, string>;
      const again = await (core.signEnvelopeV3 as unknown as (...a: unknown[]) => Promise<unknown>)(str(i, "body"), JSON.parse(str(i, "body")), await signerFor(h["rtgip-key-id"]!), Number(h["rtgip-timestamp"]), h["rtgip-nonce"]);
      must(same(again, h), `${v.id} re-sign`);
      n++;
    } else if (v.kind === "query") {
      const h = i["headers"] as Record<string, string>;
      const again = await (query.signReceiptQuery3 as unknown as (...a: unknown[]) => Promise<unknown>)(JSON.parse(str(i, "body")), await signerFor(h["rtgip-key-id"]!), Number(h["rtgip-timestamp"]), h["rtgip-nonce"]);
      must(same(again, { body: str(i, "body"), headers: h }), `${v.id} re-sign`);
      n++;
    } else if (v.kind === "receipt") {
      const r = i["receipt"] as Rec;
      const { signature: _s, key_id: _k, ...draft } = r;
      const again = await (receipt.signReceipt3 as unknown as (...a: unknown[]) => Promise<unknown>)(draft, await signerFor(String(r["key_id"])));
      must(same(again, r), `${v.id} re-sign`);
      n++;
    } else if (v.kind === "origin") {
      const o = (core.decodeOrigin as unknown as (h: string) => Rec | null)(str(i, "origin"));
      must(o !== null && (core.encodeOrigin as unknown as (o: Rec) => string)(o) === str(i, "origin"), `${v.id} origin round trip`);
      n++;
    }
  }
  must(n >= 30, `only ${n} re-signed`);
});
