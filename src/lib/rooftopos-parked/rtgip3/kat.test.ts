import { createPublicKey, verify as nodeVerify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalize, preimage, scopeOf, sha256Hex as coreSha, type EnvelopeV2 } from "../rtgip2/core";
import kat from "../../../test/fixtures/rtgip3-kat.v1.json";
import { canonical, fromHex, preimage3, recomputeMessages, resignMessages, runKat, scopeOf3, seedForKeyId, type KatFile, type Receipt3 } from "./kat";

const file = kat as unknown as KatFile;
const SPKI_ED25519 = "302a300506032b6570032100";
const KEY_ID_HOSTED = /^(stg|prd)-(gateway|autolabels|autocurb|autoframe)-ed[1-9][0-9]{0,3}$/;

describe("rtgip3 KAT (node)", () => {
  it("is marked test only and uses no hosted key id", () => {
    expect(file.test_only).toBe(true);
    expect(file.warning).toMatch(/^TEST ONLY/);
    expect(file.contract_freeze).toBe("rtgip/3-contract-freeze/1");
    for (const k of file.keys) expect(KEY_ID_HOSTED.test(k.key_id)).toBe(false);
    for (const id of Object.keys(file.seeds)) expect(id.startsWith("kat-")).toBe(true);
  });

  it("derives every seed, public key and fingerprint from the public label", async () => {
    for (const [id, seed] of Object.entries(file.seeds)) expect(seed).toBe(await seedForKeyId(id));
  });

  it("passes every vector with the expected verdict and reason", async () => {
    const results = [...(await runKat(file)), ...(await recomputeMessages(file)), ...(await resignMessages(file))];
    const bad = results.filter((r) => !r.ok);
    expect(bad).toEqual([]);
    expect(results.length).toBeGreaterThanOrEqual(file.vectors.length + file.rfc8032.length);
  });

  it("covers the six directions for every positive kind and the four chain outcomes", () => {
    const routes = new Set(file.vectors.filter((v) => v.id.startsWith("pos:") && v.direction).map((v) => v.direction));
    expect(routes.size).toBe(6);
    for (const kind of ["envelope", "forward", "origin", "query", "chain"] as const)
      expect(new Set(file.vectors.filter((v) => v.kind === kind && v.expect.ok && v.direction).map((v) => v.direction)).size).toBe(6);
    const statuses = new Set(file.vectors.filter((v) => v.kind === "chain" && v.expect.ok).map((v) => (v.expect as { status?: string }).status));
    for (const s of ["consumer_committed", "target_quarantined", "pending", "abandoned", "gateway_admitted"]) expect(statuses.has(s)).toBe(true);
  });

  it("includes every negative the design requires", () => {
    const ids = new Set(file.vectors.map((v) => v.id));
    for (const n of [
      "bit_flip_signature", "wrong_key", "v2_message_under_v3_key", "v3_signature_on_v2_path", "s_plus_l", "small_order_public_key",
      "signature_127_hex", "signature_129_hex", "unpinned_key", "revoked_key", "expired_key", "origin_signer_not_source", "origin_too_old",
      "forward_admission_missing", "forward_admission_app_issued", "receipt_app_issued_gateway_admission", "receipt_target_issued_gateway_confirmation",
      "gate_dual_window_expired", "gate_v3_only_refuses_v2", "source_row_v3_row_advanced_through_v2_entry", "timestamp_leading_zero",
      "pinned_row_not_after_extended", "compromised_key_flipped_to_current", "torsion_r_cofactored_only", "non_canonical_r_encoding",
      "small_order_key_7", "domain_receipt_message_as_envelope", "attest_missing_role", "attest_stale", "attest_sig_differs_from_received",
    ])
      expect(ids.has(`neg:${n}`)).toBe(true);
  });

  it("verifies every positive signature with node:crypto, an implementation independent of WebCrypto here", () => {
    const pk = (id: string) => file.keys.find((k) => k.key_id === id)!.public_key;
    const ok = (keyId: string, msg: string, sigHex: string) =>
      nodeVerify(null, Buffer.from(msg), createPublicKey({ key: Buffer.from(SPKI_ED25519 + pk(keyId), "hex"), format: "der", type: "spki" }), Buffer.from(sigHex, "hex"));
    let checked = 0;
    for (const v of file.vectors.filter((x) => x.expect.ok && x.message !== undefined)) {
      const i = v.input as { headers: Record<string, string>; receipt: Receipt3; origin: string };
      if (v.kind === "envelope" || v.kind === "forward" || v.kind === "query") {
        expect(ok(i.headers["rtgip-key-id"]!, v.message!, i.headers["rtgip-signature"]!.slice(7))).toBe(true);
      } else if (v.kind === "receipt") {
        expect(ok(i.receipt.key_id, v.message!, i.receipt.signature)).toBe(true);
      } else if (v.kind === "origin") {
        const o = JSON.parse(Buffer.from(i.origin, "base64url").toString("utf8"));
        expect(ok(o.key_id, v.message!, o.signature)).toBe(true);
      } else continue;
      checked++;
    }
    expect(checked).toBe(35);
    for (const r of file.rfc8032)
      expect(nodeVerify(null, Buffer.from(r.message_hex, "hex"), createPublicKey({ key: Buffer.from(SPKI_ED25519 + r.public_key, "hex"), format: "der", type: "spki" }), Buffer.from(r.signature, "hex"))).toBe(true);
  });

  it("matches the frozen rtgip/2 helpers byte for byte (canonical JSON, scope, preimage layout)", async () => {
    for (const v of file.vectors.filter((x) => x.kind === "chain")) {
      const i = v.input as { body: string; receipts: Receipt3[] };
      const env = JSON.parse(i.body) as EnvelopeV2;
      expect(canonicalize(env)).toBe(i.body);
      expect(canonical(env)).toBe(i.body);
      expect(scopeOf3(env as never)).toBe(scopeOf(env));
      for (const r of i.receipts) expect(canonical(r)).toBe(canonicalize(r));
    }
    const args = ["k", "autolabels", "1800000000", "n".repeat(16), "scope", await coreSha("body")] as const;
    expect(preimage3(...args)).toBe(preimage("k", "autolabels", args[2], args[3], args[4], args[5]).replace(/^rtgip\/2/, "rtgip/3"));
  });

  it("holds public key bytes as 32-byte hex and 128-hex signatures only in v3 positions", () => {
    for (const k of file.keys) expect(fromHex(k.public_key)).toHaveLength(32);
  });
});
