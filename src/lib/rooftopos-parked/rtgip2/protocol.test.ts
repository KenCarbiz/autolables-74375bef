// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  authorize,
  canonicalize,
  hmacHex,
  MemoryNonceStore,
  sealEnvelope,
  sha256Hex,
  signEnvelope,
  translateAndResign,
  validateEnvelope,
  verifyDelivery,
  verifyLegacy,
  ROUTES,
  RESERVED_AUTOFILM_EVENTS,
  type EnvelopeV2,
  type LegacyMessage,
  type Registry,
  type SignedHeaders,
} from "./protocol.ts";
import {
  draftEnvelope,
  keyOf,
  OTHER_TENANT,
  OTHER_ROOFTOP,
  syntheticRegistry,
  T0,
  TENANT,
} from "./fixtures.ts";

const reg = () => syntheticRegistry();
const N = (s: string) => `nonce_${s}_0123456789`;

async function signed(
  r: Registry,
  d = draftEnvelope("autolabels", "autocurb", "inventory.status_changed"),
  keyId = "al-dev-1",
  nonce = N("a"),
  now = T0,
) {
  const { envelope, body } = await sealEnvelope(d);
  const headers = await signEnvelope(body, envelope, keyOf(r, keyId), now, nonce);
  return { envelope, body, headers };
}
const verifyAtGateway = (
  r: Registry,
  h: SignedHeaders | Record<string, string>,
  body: string,
  nonces = new MemoryNonceStore(),
  now = T0,
) =>
  verifyDelivery(h as Record<string, string>, body, {
    registry: r,
    nonces,
    nowSec: now,
    expectedSigner: "source",
  });

describe("rtgip/2 canonical form", () => {
  it("sorts keys recursively, drops undefined, refuses floats", () => {
    expect(canonicalize({ b: 1, a: { d: [1, true, null], c: "x" }, z: undefined })).toBe(
      '{"a":{"c":"x","d":[1,true,null]},"b":1}',
    );
    expect(() => canonicalize({ a: 1.5 })).toThrow("non_integer_number");
    expect(() => canonicalize({ a: Number.MAX_SAFE_INTEGER + 1 })).toThrow("non_integer_number");
  });
});

describe("rtgip/2 registry", () => {
  it("defines 12 directed routes: 6 three-app and 6 reserved AutoFilm routes", () => {
    expect(ROUTES).toHaveLength(12);
    expect(ROUTES.filter((r) => r.phase === "three_app")).toHaveLength(6);
    const reserved = ROUTES.filter((r) => r.phase === "reserved_autofilm");
    expect(reserved).toHaveLength(6);
    for (const r of reserved) {
      expect(r.source === "autofilm" || r.target === "autofilm").toBe(true);
      expect(Object.keys(r.events)).toHaveLength(0);
      expect(RESERVED_AUTOFILM_EVENTS[r.id]).toBeDefined();
    }
  });
});

describe("rtgip/2 positive path", () => {
  it("signs and verifies a source delivery and authorizes the route", async () => {
    const r = reg();
    const { body, headers, envelope } = await signed(r);
    const v = await verifyAtGateway(r, headers, body);
    expect(v).toMatchObject({ ok: true });
    if (v.ok) {
      expect(v.delivery.envelope.event_id).toBe(envelope.event_id);
      expect(v.delivery.duplicate_delivery).toBe(false);
      expect(v.delivery.connection_id).toBe("conn:autolabels>autocurb:tnt-syn-northwind");
    }
  });

  it("treats an exact retry (same key, nonce, bytes) as a duplicate delivery, not a new one", async () => {
    const r = reg();
    const nonces = new MemoryNonceStore();
    const { body, headers } = await signed(r);
    await verifyAtGateway(r, headers, body, nonces);
    const again = await verifyAtGateway(r, headers, body, nonces, T0 + 5);
    expect(again.ok && again.delivery.duplicate_delivery).toBe(true);
  });

  it("accepts a previous-generation key inside its validity window (rotation overlap)", async () => {
    const r = reg();
    const prev = { ...keyOf(r, "al-dev-1"), key_id: "al-dev-prev", status: "previous" as const };
    const r2: Registry = { ...r, keys: [...r.keys, prev] };
    const { envelope, body } = await sealEnvelope(
      draftEnvelope("autolabels", "autocurb", "inventory.status_changed"),
    );
    await expect(signEnvelope(body, envelope, prev, T0, N("p"))).rejects.toThrow("key_not_current");
    const headers = await signEnvelope(body, envelope, keyOf(r, "al-dev-1"), T0, N("p"));
    const forged = { ...headers, "rtgip-key-id": "al-dev-prev" };
    // Same secret, different key id: the key id is in the preimage, so this must fail.
    expect(await verifyAtGateway(r2, forged, body)).toEqual({ ok: false, reason: "bad_signature" });
  });
});

describe("rtgip/2 negative security matrix", () => {
  it("rejects a mutated payload (signature covers body bytes)", async () => {
    const r = reg();
    const { body, headers } = await signed(r);
    const mutated = body.replace('"frontline"', '"sold"');
    expect(await verifyAtGateway(r, headers, mutated)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("rejects an altered scope header", async () => {
    const r = reg();
    const { body, headers } = await signed(r);
    const h = { ...headers, "rtgip-scope": headers["rtgip-scope"].replace(TENANT, OTHER_TENANT) };
    expect(await verifyAtGateway(r, h, body)).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects an expired and a future timestamp", async () => {
    const r = reg();
    const { body, headers } = await signed(r);
    expect(await verifyAtGateway(r, headers, body, new MemoryNonceStore(), T0 + 301)).toEqual({
      ok: false,
      reason: "timestamp_out_of_window",
    });
    expect(await verifyAtGateway(r, headers, body, new MemoryNonceStore(), T0 - 301)).toEqual({
      ok: false,
      reason: "timestamp_out_of_window",
    });
    expect((await verifyAtGateway(r, headers, body, new MemoryNonceStore(), T0 + 300)).ok).toBe(
      true,
    );
  });

  it("rejects a reused nonce with different bytes, and a forged request cannot burn a nonce", async () => {
    const r = reg();
    const nonces = new MemoryNonceStore();
    const a = await signed(r, undefined, "al-dev-1", N("same"));
    const forged = { ...a.headers, "rtgip-signature": "rtgip2=" + "0".repeat(64) };
    expect(await verifyAtGateway(r, forged, a.body, nonces)).toEqual({
      ok: false,
      reason: "bad_signature",
    });
    expect((await verifyAtGateway(r, a.headers, a.body, nonces)).ok).toBe(true);
    const b = await signed(
      r,
      draftEnvelope("autolabels", "autocurb", "vehicle.identity_registered"),
      "al-dev-1",
      N("same"),
    );
    expect(await verifyAtGateway(r, b.headers, b.body, nonces)).toEqual({
      ok: false,
      reason: "nonce_reused",
    });
  });

  it("rejects revoked and unknown keys", async () => {
    const r = reg();
    const { envelope, body } = await sealEnvelope(
      draftEnvelope("autolabels", "autocurb", "inventory.status_changed"),
    );
    const revoked = keyOf(r, "al-dev-0");
    const sig = "rtgip2=" + (await hmacHex(revoked.secret, "x"));
    const h = {
      ...(await signEnvelope(body, envelope, keyOf(r, "al-dev-1"), T0, N("r"))),
      "rtgip-key-id": "al-dev-0",
      "rtgip-signature": sig,
    };
    expect(await verifyAtGateway(r, h, body)).toEqual({ ok: false, reason: "key_revoked" });
    expect(await verifyAtGateway(r, { ...h, "rtgip-key-id": "nope" }, body)).toEqual({
      ok: false,
      reason: "unknown_key",
    });
  });

  it("rejects a revoked connection even with a valid key", async () => {
    const r = reg();
    const r2: Registry = {
      ...r,
      connections: r.connections.map((c) =>
        c.connection_id === "conn:autolabels>autocurb:tnt-syn-northwind"
          ? { ...c, status: "revoked" as const }
          : c,
      ),
    };
    const { body, headers } = await signed(r2);
    expect(await verifyAtGateway(r2, headers, body)).toEqual({
      ok: false,
      reason: "connection_revoked",
    });
  });

  it("rejects wrong tenant, wrong rooftop and cross-tenant key use", async () => {
    const r = reg();
    const wrongTenant = await signed(
      r,
      draftEnvelope("autolabels", "autoframe", "inventory.status_changed", {
        tenant_id: OTHER_TENANT,
      }),
    );
    expect(await verifyAtGateway(r, wrongTenant.headers, wrongTenant.body)).toEqual({
      ok: false,
      reason: "no_connection_for_tenant",
    });
    const wrongRooftop = await signed(
      r,
      draftEnvelope("autolabels", "autocurb", "inventory.status_changed", {
        rooftop_id: OTHER_ROOFTOP,
      }),
    );
    expect(await verifyAtGateway(r, wrongRooftop.headers, wrongRooftop.body)).toEqual({
      ok: false,
      reason: "rooftop_not_granted",
    });
    // A key bound only to tenant A's connections must not sign for tenant B's connection.
    const r2: Registry = {
      ...r,
      keys: r.keys.map((k) =>
        k.key_id === "al-dev-1"
          ? { ...k, connection_ids: k.connection_ids.filter((c) => !c.endsWith(OTHER_TENANT)) }
          : k,
      ),
    };
    const crossTenant = await signed(
      r2,
      draftEnvelope("autolabels", "autocurb", "inventory.status_changed", {
        tenant_id: OTHER_TENANT,
        rooftop_id: "rf-sw-01",
      }),
    );
    expect(await verifyAtGateway(r2, crossTenant.headers, crossTenant.body)).toEqual({
      ok: false,
      reason: "key_not_bound_to_connection",
    });
  });

  it("rejects missing source authority and impersonation", async () => {
    const r = reg();
    // AutoCurb cannot publish media facts; AutoFrame owns them.
    const d = draftEnvelope("autocurb", "autoframe", "media.approved");
    const s = await signed(r, d, "ac-dev-1");
    expect(await verifyAtGateway(r, s.headers, s.body)).toEqual({
      ok: false,
      reason: "event_not_on_route",
    });
    // AutoFrame signing an envelope that claims AutoLabels as the source.
    const imp = await sealEnvelope(
      draftEnvelope("autolabels", "autocurb", "inventory.status_changed"),
    );
    const h = await signEnvelope(imp.body, imp.envelope, keyOf(r, "af-dev-1"), T0, N("imp"));
    expect(await verifyAtGateway(r, h, imp.body)).toEqual({
      ok: false,
      reason: "source_impersonation",
    });
  });

  it("rejects unauthorized destinations, reserved AutoFilm routes and price exposure off-route", async () => {
    const r = reg();
    const price = await signed(
      r,
      draftEnvelope("autolabels", "autoframe", "listing.price_published"),
    );
    expect(await verifyAtGateway(r, price.headers, price.body)).toEqual({
      ok: false,
      reason: "event_not_on_route",
    });
    const film = await sealEnvelope(
      draftEnvelope("autolabels", "autofilm", "inventory.status_changed"),
    );
    expect(authorize(film.envelope, r)).toEqual({ ok: false, reason: "route_reserved" });
    const s = await signed(r);
    const atWrongTarget = await verifyDelivery(s.headers, s.body, {
      registry: r,
      nonces: new MemoryNonceStore(),
      nowSec: T0,
      expectedSigner: "source",
      receiver: "autoframe",
    });
    expect(atWrongTarget).toEqual({ ok: false, reason: "wrong_destination" });
  });

  it("rejects unsupported schema versions and event types", async () => {
    const r = reg();
    const e = {
      ...draftEnvelope("autolabels", "autocurb", "inventory.status_changed"),
      schema_version: 3,
      payload_sha256: "0".repeat(64),
    };
    expect(validateEnvelope(e)).toEqual({ ok: false, errors: ["unsupported_schema_version"] });
    const body = canonicalize(e);
    const scope = [
      "autolabels",
      "autocurb",
      TENANT,
      "rf-nw-01",
      "inventory.status_changed",
      "3",
      "inventory_sync",
      e.event_id,
    ].join(";");
    const key = keyOf(r, "al-dev-1");
    const sig =
      "rtgip2=" +
      (await hmacHex(
        key.secret,
        [
          "rtgip/2",
          key.key_id,
          "autolabels",
          String(T0),
          N("v"),
          scope,
          await sha256Hex(body),
        ].join("\n"),
      ));
    const h = {
      "rtgip-protocol": "rtgip/2",
      "rtgip-key-id": key.key_id,
      "rtgip-signer": "autolabels",
      "rtgip-timestamp": String(T0),
      "rtgip-nonce": N("v"),
      "rtgip-scope": scope,
      "rtgip-signature": sig,
    };
    expect(await verifyAtGateway(r, h, body)).toEqual({
      ok: false,
      reason: "unsupported_schema_version",
    });
    expect(validateEnvelope({ ...e, schema_version: 2, event_type: "vehicle.teleported" })).toEqual(
      { ok: false, errors: ["unsupported_event_type"] },
    );
  });

  it("refuses confidential valuation, PII, URLs and unknown payload fields", async () => {
    const base = draftEnvelope("autocurb", "autolabels", "appraisal.completed");
    for (const extra of [
      { acv_value: 1 },
      { offered_price: 1 },
      { dealer_cost: 1 },
      { email: "x" },
    ]) {
      await expect(
        sealEnvelope({ ...base, payload: { ...base.payload, ...extra } }),
      ).rejects.toThrow(/forbidden_key|unknown_field/);
    }
    await expect(
      sealEnvelope({ ...base, payload: { ...base.payload, audit_ref: "https://evil.example/x" } }),
    ).rejects.toThrow(/invalid|url/);
    const m = draftEnvelope("autoframe", "autolabels", "media.approved");
    const nested = {
      ...m,
      payload: {
        ...m.payload,
        storage_ref: { bucket: "b", object_key: "https://cdn.example/x.webp" },
      },
    };
    await expect(sealEnvelope(nested)).rejects.toThrow(/url/);
    const pii = {
      ...m,
      payload: { ...m.payload, storage_ref: { bucket: "b", object_key: "call 555-123-4567" } },
    };
    await expect(sealEnvelope(pii)).rejects.toThrow(/phone/);
  });

  it("refuses an intermediate acquisition milestone that claims custody transfer", async () => {
    const d = draftEnvelope("autocurb", "autolabels", "acquisition.milestone_recorded");
    await expect(
      sealEnvelope({ ...d, payload: { ...d.payload, custody_transferred: true } }),
    ).rejects.toThrow(/custody_transferred/);
  });

  it("rejects a non-canonical body even when correctly signed", async () => {
    const r = reg();
    const { envelope, body } = await sealEnvelope(
      draftEnvelope("autolabels", "autocurb", "inventory.status_changed"),
    );
    const pretty = JSON.stringify(JSON.parse(body), null, 1);
    const key = keyOf(r, "al-dev-1");
    const scope = [
      envelope.source_app,
      envelope.target_app,
      envelope.tenant_id,
      envelope.rooftop_id,
      envelope.event_type,
      "2",
      envelope.purpose,
      envelope.event_id,
    ].join(";");
    const sig =
      "rtgip2=" +
      (await hmacHex(
        key.secret,
        [
          "rtgip/2",
          key.key_id,
          "autolabels",
          String(T0),
          N("c"),
          scope,
          await sha256Hex(pretty),
        ].join("\n"),
      ));
    const h = {
      "rtgip-protocol": "rtgip/2",
      "rtgip-key-id": key.key_id,
      "rtgip-signer": "autolabels",
      "rtgip-timestamp": String(T0),
      "rtgip-nonce": N("c"),
      "rtgip-scope": scope,
      "rtgip-signature": sig,
    };
    expect(await verifyAtGateway(r, h, pretty)).toEqual({
      ok: false,
      reason: "body_not_canonical",
    });
  });
});

describe("rtgip/2 protocol separation and legacy translation", () => {
  const legacyBody = (e: EnvelopeV2) => canonicalize(e);

  it("never accepts an rtgip/2 signature presented in a legacy dialect, or a legacy v1= signature as rtgip/2", async () => {
    const r = reg();
    const { body, headers } = await signed(r);
    const asLegacy: LegacyMessage = {
      dialect: "gateway.operator/1",
      key_id: "al-dev-1",
      timestamp: String(T0),
      nonce: N("x"),
      signature: headers["rtgip-signature"],
      raw_body: body,
    };
    expect(await verifyLegacy(asLegacy, r, new MemoryNonceStore(), T0)).toEqual({
      ok: false,
      reason: "key_dialect_mismatch",
    });
    const k = keyOf(r, "ac-legacy-1");
    const v1 = "v1=" + (await hmacHex(k.secret, `${T0}.${N("x")}.${body}`));
    const h = { ...headers, "rtgip-key-id": "ac-legacy-1", "rtgip-signature": v1 };
    expect(await verifyAtGateway(r, h, body)).toEqual({ ok: false, reason: "protocol_mismatch" });
    const h2 = { ...headers, "rtgip-key-id": "ac-legacy-1" };
    expect(await verifyAtGateway(r, h2, body)).toEqual({
      ok: false,
      reason: "key_dialect_mismatch",
    });
  });

  it("does not let one legacy dialect's key verify another legacy dialect with the same v1= prefix", async () => {
    const r = reg();
    const body = '{"a":1}';
    const k = keyOf(r, "af-legacy-1");
    const sig = "v1=" + (await hmacHex(k.secret, `${T0}.${N("d")}.${await sha256Hex(body)}`));
    const ok = await verifyLegacy(
      {
        dialect: "autoframe.raw-hash/1",
        key_id: k.key_id,
        timestamp: String(T0),
        nonce: N("d"),
        signature: sig,
        raw_body: body,
      },
      r,
      new MemoryNonceStore(),
      T0,
    );
    expect(ok.ok).toBe(true);
    const cross = await verifyLegacy(
      {
        dialect: "gateway.operator/1",
        key_id: k.key_id,
        timestamp: String(T0),
        nonce: N("d"),
        signature: sig,
        raw_body: body,
      },
      r,
      new MemoryNonceStore(),
      T0,
    );
    expect(cross).toEqual({ ok: false, reason: "key_dialect_mismatch" });
  });

  it("rejects held and unknown dialects", async () => {
    const r = reg();
    const m: LegacyMessage = {
      dialect: "autoframe.ts-body/0",
      key_id: "af-held-1",
      timestamp: String(T0),
      nonce: N("h"),
      signature: "v1=00",
      raw_body: "{}",
    };
    expect(await verifyLegacy(m, r, new MemoryNonceStore(), T0)).toEqual({
      ok: false,
      reason: "dialect_held",
    });
    expect(
      await verifyLegacy({ ...m, dialect: "gateway.service/1" }, r, new MemoryNonceStore(), T0),
    ).toEqual({ ok: false, reason: "dialect_held" });
  });

  it("translates an authenticated legacy AutoLabels message and re-signs it with a distinct Gateway key", async () => {
    const r = reg();
    const { envelope } = await sealEnvelope(
      draftEnvelope("autolabels", "autocurb", "inventory.status_changed"),
    );
    const raw = legacyBody(envelope);
    const k = keyOf(r, "al-legacy-1");
    const sig =
      "v1=" +
      (await hmacHex(k.secret, `rooftopos.v1\n${T0}\n${k.key_id}\n${await sha256Hex(raw)}`));
    const msg: LegacyMessage = {
      dialect: "autolabels.rooftopos/1",
      key_id: k.key_id,
      timestamp: String(T0),
      nonce: null,
      signature: sig,
      raw_body: raw,
    };
    const mapper = (b: unknown) => {
      const { payload_sha256: _p, ...rest } = b as EnvelopeV2;
      return rest;
    };
    const nonces = new MemoryNonceStore();
    const out = await translateAndResign(msg, mapper, keyOf(r, "gw-dev-1"), r, nonces, T0, N("gw"));
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.headers["rtgip-signer"]).toBe("gateway");
      const atTarget = await verifyDelivery(out.headers, out.body, {
        registry: r,
        nonces: new MemoryNonceStore(),
        nowSec: T0,
        expectedSigner: "gateway",
        receiver: "autocurb",
      });
      expect(atTarget.ok).toBe(true);
    }
    // The same legacy message cannot be replayed through the translator.
    expect(
      await translateAndResign(msg, mapper, keyOf(r, "gw-dev-1"), r, nonces, T0, N("gw2")),
    ).toEqual({ ok: false, reason: "replayed" });
  });

  it("refuses to translate when the legacy signer claims another source, or the destination is not authorized", async () => {
    const r = reg();
    const k = keyOf(r, "af-legacy-1");
    const { envelope } = await sealEnvelope(
      draftEnvelope("autolabels", "autocurb", "inventory.status_changed"),
    );
    const raw = canonicalize(envelope);
    const sig = "v1=" + (await hmacHex(k.secret, `${T0}.${N("t")}.${await sha256Hex(raw)}`));
    const msg: LegacyMessage = {
      dialect: "autoframe.raw-hash/1",
      key_id: k.key_id,
      timestamp: String(T0),
      nonce: N("t"),
      signature: sig,
      raw_body: raw,
    };
    const mapper = (b: unknown) => {
      const { payload_sha256: _p, ...rest } = b as EnvelopeV2;
      return rest;
    };
    expect(
      await translateAndResign(
        msg,
        mapper,
        keyOf(r, "gw-dev-1"),
        r,
        new MemoryNonceStore(),
        T0,
        N("g"),
      ),
    ).toEqual({ ok: false, reason: "source_impersonation" });
    const media = await sealEnvelope(draftEnvelope("autoframe", "autolabels", "media.approved"));
    const raw2 = canonicalize({
      ...media.envelope,
      target_app: "autofilm",
      route: "autoframe->autofilm",
    });
    const sig2 = "v1=" + (await hmacHex(k.secret, `${T0}.${N("u")}.${await sha256Hex(raw2)}`));
    const msg2: LegacyMessage = { ...msg, nonce: N("u"), signature: sig2, raw_body: raw2 };
    expect(
      await translateAndResign(
        msg2,
        mapper,
        keyOf(r, "gw-dev-1"),
        r,
        new MemoryNonceStore(),
        T0,
        N("g"),
      ),
    ).toEqual({ ok: false, reason: "route_reserved" });
    expect(
      await translateAndResign(
        { ...msg2, nonce: N("w") },
        mapper,
        keyOf(r, "af-dev-1"),
        r,
        new MemoryNonceStore(),
        T0,
        N("g"),
      ),
    ).toEqual({ ok: false, reason: "bad_signature" });
  });
});
