// @vitest-environment node
// Gateway compatibility contract for the hosted Gateway owner: exact rtgip/2 delivery bytes
// and headers, with the outcome both target verifiers (TypeScript verifyDelivery and
// Postgres rtgip.inbox_admit) must reach. Accepted deliveries are the 15 corpus entries; this
// file holds the refusals, the signing preimage and the HELD dialects. Every signature uses the
// public DEV-literal key gw-dev-1 from fixtures.ts, which is not a Gateway key and must never
// be provisioned: the hosted Gateway signs with keys only its owner holds, so the owner checks
// conformance by re-signing these bodies with their own key against a staging target.
// With RTGIP_GATEWAY_CONTRACT_OUT set the file is rewritten; otherwise it must match.
// The database expectations are asserted against real Postgres in rtgip2-pg/admission.pg.test.ts.
import { expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import corpus from "../rtgip2/rtgip2-corpus.v2.json";
import {
  canonicalize,
  hmacHex,
  HELD_DIALECTS,
  MemoryNonceStore,
  preimage,
  sha256Hex,
  SIGNATURE_PREFIX,
  verifyDelivery,
  verifyLegacy,
  type AppId,
} from "../rtgip2/protocol.ts";
import { keyOf, syntheticRegistry, T0 } from "../rtgip2/fixtures.ts";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "../rtgip2/rtgip2-gateway-contract.v1.json");
type Obj = Record<string, unknown>;
const scopeFor = (e: Obj) =>
  [e.source_app, e.target_app, e.tenant_id, e.rooftop_id, e.event_type, String(e.schema_version), e.purpose, e.event_id].join(";");

/** Header-level change applied after signing (the database case re-signs, then applies it). */
export type HeaderChange =
  | { kind: "none" }
  | { kind: "protocol"; value: string }
  | { kind: "zero_signature" }
  | { kind: "signer"; value: "autolabels" | "autocurb" | "autoframe" }
  | { kind: "key_id"; value: string }
  | { kind: "timestamp_offset"; seconds: number }
  | { kind: "nonce"; value: string };

export interface ContractCase {
  name: string;
  receiver: AppId;
  body: string;
  header_change: HeaderChange;
  headers: Record<string, string>;
  preimage: string;
  expect_ts: string;
  /** Reason rtgip.inbox_admit records; null when only the TS boundary sees it (no request reaches SQL). */
  expect_db: string | null;
}

async function sign(body: string, scope: string, ts: number, nonce: string, change: HeaderChange) {
  const reg = syntheticRegistry();
  const k = keyOf(reg, "gw-dev-1");
  const pre = preimage(k.key_id, "gateway", String(ts), nonce, scope, await sha256Hex(body));
  const h: Record<string, string> = {
    "rtgip-protocol": "rtgip/2",
    "rtgip-key-id": k.key_id,
    "rtgip-signer": "gateway",
    "rtgip-timestamp": String(ts),
    "rtgip-nonce": nonce,
    "rtgip-scope": scope,
    "rtgip-signature": SIGNATURE_PREFIX + (await hmacHex(k.secret, pre)),
  };
  if (change.kind === "protocol") h["rtgip-protocol"] = change.value;
  if (change.kind === "zero_signature") h["rtgip-signature"] = SIGNATURE_PREFIX + "0".repeat(64);
  if (change.kind === "signer") h["rtgip-signer"] = change.value;
  if (change.kind === "key_id") h["rtgip-key-id"] = change.value;
  if (change.kind === "nonce") h["rtgip-nonce"] = change.value;
  return { headers: h, preimage: pre };
}

it("Gateway contract cases are reproducible and the TypeScript verifier reaches every recorded outcome", async () => {
  const entry = corpus.entries.find((e) => e.route === "autolabels->autocurb")!;
  const base = JSON.parse(entry.body) as Obj;
  const reseal = async (e: Obj) => ({ ...e, payload_sha256: await sha256Hex(canonicalize(e.payload)) });
  const bodies: [string, string, HeaderChange, string | null][] = [
    ["accepted reference delivery (corpus entry)", entry.body, { kind: "none" }, null],
    ["HELD dialect gateway.service/1 in the protocol header", entry.body, { kind: "protocol", value: "gateway.service/1" }, "protocol_mismatch"],
    ["HELD dialect gw.extension/1 in the protocol header", entry.body, { kind: "protocol", value: "gw.extension/1" }, "protocol_mismatch"],
    ["signature not produced with the key", entry.body, { kind: "zero_signature" }, "bad_signature"],
    ["source app presenting as signer to a target", entry.body, { kind: "signer", value: "autolabels" }, "signer_key_mismatch"],
    ["unknown key id", entry.body, { kind: "key_id", value: "gw-unknown-1" }, "unknown_key"],
    ["timestamp outside the 300 s window", entry.body, { kind: "timestamp_offset", seconds: -900 }, "timestamp_out_of_window"],
    ["nonce too short", entry.body, { kind: "nonce", value: "short" }, "invalid_nonce"],
    ["body re-serialized with whitespace", JSON.stringify(base, null, 1), { kind: "none" }, "body_not_canonical"],
    ["integer written as float", entry.body.replace('"schema_version":2', '"schema_version":2.0'), { kind: "none" }, "body_not_canonical"],
    ["unknown envelope field (an untranslated extension)", canonicalize({ ...base, gw_extension: { v: 1 } }), { kind: "none" }, "invalid_envelope:fields"],
    ["payload changed, payload_sha256 kept", canonicalize({ ...base, payload: { ...(base.payload as Obj), status: "sold" } }), { kind: "none" }, "payload_hash_mismatch"],
    ["event_id not derived from origin", canonicalize({ ...base, event_id: "00000000-0000-5000-8000-000000000000" }), { kind: "none" }, "event_id_not_derived"],
    ["route rewritten to another destination", canonicalize({ ...base, target_app: "autoframe", route: "autolabels->autoframe" }), { kind: "none" }, "event_id_not_derived"],
    ["confidential key in the payload", canonicalize(await reseal({ ...base, payload: { ...(base.payload as Obj), acv_value: 1 } })), { kind: "none" }, "invalid_envelope:sensitive_content"],
  ];
  const cases: ContractCase[] = [];
  let n = 0;
  for (const [name, body, change, db] of bodies) {
    let scopeSrc: Obj = base;
    try {
      scopeSrc = { ...base, ...(JSON.parse(body) as Obj) };
    } catch {
      /* non-JSON bodies keep the reference scope */
    }
    const ts = T0 + (change.kind === "timestamp_offset" ? change.seconds : 0);
    const nonce = `gw_contract_${String(++n).padStart(8, "0")}`;
    const { headers, preimage: pre } = await sign(body, scopeFor(scopeSrc), ts, nonce, change);
    const v = await verifyDelivery(headers, body, { registry: syntheticRegistry(), nonces: new MemoryNonceStore(), nowSec: T0, expectedSigner: "gateway", receiver: "autocurb" });
    const got = "reason" in v ? v.reason : "ok";
    if (db === null) expect(got, name).toBe("ok");
    else expect(got, name).not.toBe("ok");
    cases.push({ name, receiver: "autocurb", body, header_change: change, headers, preimage: pre, expect_ts: got, expect_db: db === null ? "applied" : db });
  }
  // A Gateway must never translate a HELD dialect into rtgip/2: the legacy verifier refuses it
  // before any translation, whatever its signature.
  const held: { dialect: string; reason: string }[] = [];
  for (const d of HELD_DIALECTS) {
    const r = await verifyLegacy({ dialect: d, key_id: "gw-dev-1", timestamp: String(T0), nonce: "gw_contract_held_0001", signature: "v1=00", raw_body: "{}" }, syntheticRegistry(), new MemoryNonceStore(), T0);
    expect(r).toEqual({ ok: false, reason: "dialect_held" });
    held.push({ dialect: d, reason: r.ok ? "ok" : r.reason });
  }
  const contract = {
    schema: "rtgip/2-gateway-contract/1",
    note: "Synthetic data. Signed with the public DEV-literal key gw-dev-1 from fixtures.ts, which is not a Gateway key and must never be provisioned. Verify TypeScript outcomes with nowSec = t0.",
    status: { "rtgip/2": "contract", "gateway.service/1": "HELD", "gw.extension/1": "HELD" },
    t0: T0,
    signing: {
      headers: ["rtgip-protocol", "rtgip-key-id", "rtgip-signer", "rtgip-timestamp", "rtgip-nonce", "rtgip-scope", "rtgip-signature"],
      preimage: "rtgip/2\\n{key_id}\\n{signer}\\n{timestamp}\\n{nonce}\\n{scope}\\n{sha256_hex(body)}",
      scope: "{source_app};{target_app};{tenant_id};{rooftop_id};{event_type};{schema_version};{purpose};{event_id}",
      signature: "rtgip2= + hex(HMAC-SHA256(secret, preimage))",
      timestamp_window_seconds: 300,
      body: "canonical JSON (sorted keys, no whitespace, integers only), exactly as signed",
    },
    accepted_corpus: { file: "rtgip2-corpus.v2.json", entries: corpus.entries.length },
    held_dialects: held,
    cases,
  };
  if (process.env.RTGIP_GATEWAY_CONTRACT_OUT) writeFileSync(process.env.RTGIP_GATEWAY_CONTRACT_OUT, JSON.stringify(contract, null, 2) + "\n");
  else expect(contract).toEqual(JSON.parse(readFileSync(OUT, "utf8")));
});
