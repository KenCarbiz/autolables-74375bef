// @vitest-environment node
import { describe, expect, it } from "vitest";
import { hmacHex, MemoryNonceStore, sha256Hex, type Registry } from "./protocol.ts";
import { signReceiptQuery, verifyReceiptQuery } from "./receipt-query.ts";
import { connId, keyOf, syntheticRegistry, T0, TENANT, OTHER_TENANT } from "./fixtures.ts";

const CONN = connId("autolabels", "autocurb");
const OTHER = connId("autolabels", "autocurb", OTHER_TENANT);
const DELIVERY = "a".repeat(64);
const EVENT = "4d43fc3d-c56c-5ee8-8a43-f2bc3671d631";

function setup() {
  const reg: Registry = syntheticRegistry();
  const known = new Map([
    [
      DELIVERY,
      { connection_id: CONN, source_app: "autolabels", tenant_id: TENANT, event_id: EVENT },
    ],
    [
      "b".repeat(64),
      { connection_id: OTHER, source_app: "autolabels", tenant_id: OTHER_TENANT, event_id: EVENT },
    ],
  ]);
  const nonces = new MemoryNonceStore();
  const ctx = (r: Registry = reg, now = T0) => ({
    registry: r,
    nonces,
    nowSec: now,
    lookup: (id: string) => known.get(id) ?? null,
  });
  return { reg, ctx };
}
const nonce = (n: string) => `qry_nonce_${n}_0123456789`;

describe("rtgip/2-receipt-query/1 request signing", () => {
  it("verifies a request signed by the source that owns the delivery", async () => {
    const { reg, ctx } = setup();
    const { body, headers } = await signReceiptQuery(
      { delivery_id: DELIVERY, event_id: EVENT },
      keyOf(reg, "al-dev-1"),
      T0,
      nonce("ok"),
    );
    const v = await verifyReceiptQuery(headers, body, ctx());
    expect(v).toMatchObject({ ok: true, query: { delivery_id: DELIVERY, event_id: EVENT } });
  });

  it("refuses a tampered body or tampered headers", async () => {
    const { reg, ctx } = setup();
    const { body, headers } = await signReceiptQuery(
      { delivery_id: DELIVERY, event_id: EVENT },
      keyOf(reg, "al-dev-1"),
      T0,
      nonce("tamper"),
    );
    const other = body.replace(DELIVERY, "b".repeat(64));
    expect(await verifyReceiptQuery(headers, other, ctx())).toEqual({
      ok: false,
      reason: "bad_signature",
    });
    expect(
      await verifyReceiptQuery({ ...headers, "rtgip-timestamp": String(T0 + 1) }, body, ctx()),
    ).toEqual({ ok: false, reason: "bad_signature" });
    expect(
      await verifyReceiptQuery({ ...headers, "rtgip-signature": "0".repeat(64) }, body, ctx()),
    ).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("refuses a request signed with the wrong key", async () => {
    const { reg, ctx } = setup();
    const { body, headers } = await signReceiptQuery(
      { delivery_id: DELIVERY, event_id: EVENT },
      keyOf(reg, "al-dev-1"),
      T0,
      nonce("wrongkey"),
    );
    expect(
      await verifyReceiptQuery({ ...headers, "rtgip-key-id": "af-dev-1" }, body, ctx()),
    ).toEqual({ ok: false, reason: "bad_signature" });
    const { body: b2, headers: h2 } = await signReceiptQuery(
      { delivery_id: DELIVERY, event_id: EVENT },
      keyOf(reg, "ac-dev-1"),
      T0,
      nonce("notowner"),
    );
    expect(await verifyReceiptQuery(h2, b2, ctx())).toEqual({
      ok: false,
      reason: "delivery_not_found",
    });
    const { body: b3, headers: h3 } = await signReceiptQuery(
      { delivery_id: DELIVERY, event_id: EVENT },
      keyOf(reg, "gw-dev-1"),
      T0,
      nonce("gateway"),
    );
    expect(await verifyReceiptQuery(h3, b3, ctx())).toEqual({
      ok: false,
      reason: "signer_not_source",
    });
  });

  it("refuses revoked keys, legacy dialects and an old timestamp", async () => {
    const { reg, ctx } = setup();
    await expect(
      signReceiptQuery(
        { delivery_id: DELIVERY, event_id: EVENT },
        keyOf(reg, "al-dev-0"),
        T0,
        nonce("rev"),
      ),
    ).rejects.toThrow("query_signer_not_authorized");
    const { body, headers } = await signReceiptQuery(
      { delivery_id: DELIVERY, event_id: EVENT },
      keyOf(reg, "al-dev-1"),
      T0,
      nonce("old"),
    );
    expect(await verifyReceiptQuery(headers, body, ctx(reg, T0 + 600))).toEqual({
      ok: false,
      reason: "timestamp_out_of_window",
    });
    const revoked: Registry = {
      ...reg,
      keys: reg.keys.map((k) =>
        k.key_id === "al-dev-1" ? { ...k, status: "revoked" as const } : k,
      ),
    };
    expect(await verifyReceiptQuery(headers, body, ctx(revoked))).toEqual({
      ok: false,
      reason: "key_revoked",
    });
  });

  it("refuses a replayed nonce, including an exact repeat of the same request", async () => {
    const { reg, ctx } = setup();
    const c = ctx();
    const { body, headers } = await signReceiptQuery(
      { delivery_id: DELIVERY, event_id: EVENT },
      keyOf(reg, "al-dev-1"),
      T0,
      nonce("replay"),
    );
    expect((await verifyReceiptQuery(headers, body, c)).ok).toBe(true);
    expect(await verifyReceiptQuery(headers, body, c)).toEqual({
      ok: false,
      reason: "nonce_reused",
    });
    const second = await signReceiptQuery(
      { delivery_id: DELIVERY, event_id: "other-event" },
      keyOf(reg, "al-dev-1"),
      T0,
      nonce("replay"),
    );
    expect(await verifyReceiptQuery(second.headers, second.body, c)).toEqual({
      ok: false,
      reason: "nonce_reused",
    });
  });

  it("refuses another tenant's delivery id and an event id that does not belong to the delivery", async () => {
    const { reg, ctx } = setup();
    const foreign = await signReceiptQuery(
      { delivery_id: "b".repeat(64), event_id: EVENT },
      keyOf(reg, "al-dev-1"),
      T0,
      nonce("foreign"),
    );
    const own = keyOf(reg, "al-dev-1");
    expect(own.connection_ids).toContain(OTHER);
    // al-dev-1 is bound to both tenants' connections in the fixture, so narrow it to one tenant.
    const narrowed: Registry = {
      ...reg,
      keys: reg.keys.map((k) =>
        k.key_id === "al-dev-1"
          ? { ...k, connection_ids: k.connection_ids.filter((c) => c !== OTHER) }
          : k,
      ),
    };
    expect(await verifyReceiptQuery(foreign.headers, foreign.body, ctx(narrowed))).toEqual({
      ok: false,
      reason: "delivery_not_found",
    });
    const unknown = await signReceiptQuery(
      { delivery_id: "c".repeat(64), event_id: EVENT },
      keyOf(narrowed, "al-dev-1"),
      T0,
      nonce("unknown"),
    );
    expect(await verifyReceiptQuery(unknown.headers, unknown.body, ctx(narrowed))).toEqual({
      ok: false,
      reason: "delivery_not_found",
    });
    const wrongEvent = await signReceiptQuery(
      { delivery_id: DELIVERY, event_id: "11111111-2222-4333-8444-555555555555" },
      keyOf(narrowed, "al-dev-1"),
      T0,
      nonce("wrongevent"),
    );
    expect(await verifyReceiptQuery(wrongEvent.headers, wrongEvent.body, ctx(narrowed))).toEqual({
      ok: false,
      reason: "delivery_not_found",
    });
  });

  it("refuses a non-canonical or malformed query body", async () => {
    const { reg, ctx } = setup();
    const k = keyOf(reg, "al-dev-1");
    const { body } = await signReceiptQuery(
      { delivery_id: DELIVERY, event_id: EVENT },
      k,
      T0,
      nonce("shape"),
    );
    const loose = JSON.stringify(JSON.parse(body), null, 1);
    const sign = async (raw: string, n: string) => ({
      "rtgip-key-id": k.key_id,
      "rtgip-timestamp": String(T0),
      "rtgip-nonce": nonce(n),
      "rtgip-signature": await hmacHex(
        k.secret,
        ["rtgip/2-receipt-query/1", k.key_id, String(T0), nonce(n), await sha256Hex(raw)].join(
          "\n",
        ),
      ),
    });
    expect(await verifyReceiptQuery(await sign(loose, "loose"), loose, ctx())).toEqual({
      ok: false,
      reason: "body_not_canonical",
    });
    const extra = JSON.stringify({
      delivery_id: DELIVERY,
      event_id: EVENT,
      protocol: "rtgip/2-receipt-query/1",
      x: 1,
    });
    expect(await verifyReceiptQuery(await sign(extra, "extra"), extra, ctx())).toEqual({
      ok: false,
      reason: "invalid_query",
    });
  });
});
