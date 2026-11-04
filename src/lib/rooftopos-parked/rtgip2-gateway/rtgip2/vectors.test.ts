import { describe, expect, it } from "vitest";
import vectors from "@/test/fixtures/rtgip2-gateway-kat.v1.json";
import { canonicalize, hmacHex, preimage, sha256Hex, type Signer } from "./core";
describe("exact supplied rtgip/2 known-answer vectors", () => {
  it.each(vectors.routes)("matches source and forwarding signatures for $route", async (vector) => {
    expect(await sha256Hex(vector.body)).toBe(vector.body_sha256);
    expect(canonicalize(JSON.parse(vector.body))).toBe(vector.body);
    for (const request of [vector.ingress, vector.forward]) {
      const h = request.headers;
      const key = vectors.keys.find((k) => k.key_id === h["rtgip-key-id"]);
      if (!key) throw new Error("Vector key absent");
      const bytes = preimage(
        h["rtgip-key-id"],
        h["rtgip-signer"] as Signer,
        h["rtgip-timestamp"],
        h["rtgip-nonce"],
        h["rtgip-scope"],
        vector.body_sha256,
      );
      expect(bytes).toBe(request.preimage);
      expect("rtgip2=" + (await hmacHex(key.secret, bytes))).toBe(h["rtgip-signature"]);
    }
  });
});
