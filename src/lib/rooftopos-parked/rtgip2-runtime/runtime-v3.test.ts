import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalize, sealEnvelope, type EnvelopeV2 } from "../rtgip2/protocol.ts";
import { gatewayDelivery } from "./pg-harness.ts";
import { draftEnvelope, syntheticRegistry, T0 } from "../rtgip2/fixtures.ts";
import { importSigningKey, PKCS8_ED25519_PREFIX, sha256Hex, toHex, type SigningKey3 } from "../rtgip3/sig.ts";
import { recordPin, type KeyContext3, type PublicKeyRecord } from "../rtgip3/keys3.ts";
import {
  ADMISSION_HEADER3,
  encodeOrigin,
  ORIGIN_HEADER,
  originOf,
  preimage3,
  SIGNATURE_PREFIX3,
  signEnvelopeV3,
  verifyAttest3,
  verifySignature3,
  type AttestDoc3,
  type AttestExpected3,
} from "../rtgip3/core3.ts";
import {
  deliveryId3,
  encodeAdmissionHeader3,
  evaluateChain3,
  receiptDraft3,
  receiptMessage3,
  signReceipt3,
  type Outcome3,
  type Receipt3,
  type Stage3,
} from "../rtgip3/receipt3.ts";
import { verifyQuerySignature3, type QueryHeaders3 } from "../rtgip3/receipt-query3.ts";
import {
  createAppRuntime,
  PEER_VISIBLE_V3,
  REFUSALS_V3,
  refusalV3,
  RTGIP3,
  keySecretName3,
  type AppRuntimeConfig,
  type RuntimeAdapter,
  type Sql,
} from "./runtime.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const STAGING = "abcdefghijklmnopqrst";
const GATEWAY = "https://gateway.staging.example.test";
const SERVICE_KEY = "service-role-key-for-tests-only";
const VERIFIER = "5e".repeat(32);
const policy = JSON.parse(readFileSync(path.join(here, "../rtgip3/refusal-policy.v1.json"), "utf8")) as {
  inherited: Record<string, string[] | string>;
  added: Record<string, string[]>;
  peer_visible: Record<string, string>;
};
const golden = JSON.parse(readFileSync(path.join(here, "rtgip2-v2-request.golden.json"), "utf8")) as {
  row: { event_id: string; body: string; envelope: EnvelopeV2; delivery_id: string; lease_generation: number };
  deliver: unknown[];
  confirm: unknown[];
};

// ---------------------------------------------------------------------------
// Test-only Ed25519 keys (stg-*: the runtime accepts only stg and prd key ids). Seeds are public.
// ---------------------------------------------------------------------------

const reg = syntheticRegistry();
const CONNS = reg.connections.map((c) => c.connection_id);
const seedOf = async (id: string) => sha256Hex(`rtgip3-al-runtime-test/${id}`);
const pkcs8Of = async (id: string) => Buffer.from(PKCS8_ED25519_PREFIX + (await seedOf(id)), "hex").toString("base64");
async function publicOf(id: string): Promise<string> {
  const der = Buffer.from(PKCS8_ED25519_PREFIX + (await seedOf(id)), "hex");
  const k = await crypto.subtle.importKey("pkcs8", der, { name: "Ed25519" }, true, ["sign"]);
  const jwk = await crypto.subtle.exportKey("jwk", k);
  return toHex(Buffer.from(String(jwk.x), "base64url"));
}
const IDS = { gateway: "stg-gateway-ed1", autolabels: "stg-autolabels-ed1", autocurb: "stg-autocurb-ed1" } as const;
type Owner = keyof typeof IDS;
const OWN_SECRET = "RTGIP3_SIGNING_KEY_STG_AUTOLABELS_ED1";

interface Keys {
  records: PublicKeyRecord[];
  pins: Record<string, string>;
  signers: Record<Owner, SigningKey3>;
  pinsEnv: string;
  ctx: KeyContext3;
}
let cached: Keys | null = null;
async function keys(): Promise<Keys> {
  if (cached) return cached;
  const records: PublicKeyRecord[] = [];
  const signers = {} as Record<Owner, SigningKey3>;
  for (const [owner, id] of Object.entries(IDS) as [Owner, string][]) {
    const pk = await publicOf(id);
    records.push({
      alg: "ed25519",
      connection_ids: [...CONNS],
      fingerprint: await sha256Hex(Buffer.from(pk, "hex")),
      key_id: id,
      not_after: T0 + 10_000_000,
      not_before: T0 - 1_000_000,
      owner,
      protocol: "rtgip/3",
      public_key: pk,
      revoked_at: null,
      revoked_reason: null,
      status: "current",
    });
    signers[owner] = (await importSigningKey(id, owner, await pkcs8Of(id), pk))!;
  }
  const pins: Record<string, string> = {};
  for (const r of records) pins[r.key_id] = await recordPin(r);
  const pinsEnv = Object.entries(pins)
    .map(([k, v]) => `${k}:${v}`)
    .join(",");
  cached = { records, pins, signers, pinsEnv, ctx: { keys: records, pins, now: T0, env: "stg" } };
  return cached;
}

// ---------------------------------------------------------------------------
// A fake database: the rtgip/2 registry the existing suite uses, plus the rtgip/3 tables when installed.
// ---------------------------------------------------------------------------

interface Call {
  text: string;
  params: unknown[];
}
type Handler = (text: string, params: unknown[]) => unknown[] | undefined;

interface Gate {
  send_protocol: string;
  accept_protocols: string[];
  v3_added_at: number | null;
  v2_accept_until: number | null;
}
const V3_GATE: Gate = { send_protocol: "rtgip/3", accept_protocols: ["rtgip/2", "rtgip/3"], v3_added_at: T0 - 3600, v2_accept_until: T0 + 86_400 };

interface WorldOpts {
  v3?: boolean;
  gate?: Partial<Gate>;
  env?: Record<string, string | undefined>;
  db?: Handler;
  records?: (r: PublicKeyRecord[]) => PublicKeyRecord[];
  fetch?: AppRuntimeConfig["fetch"];
}

async function world(o: WorldOpts = {}) {
  const k = await keys();
  const calls: Call[] = [];
  const records = o.records ? o.records(k.records) : k.records;
  const v2Keys = reg.keys.map((x) => ({
    ...x,
    not_before: String(x.not_before),
    not_after: String(x.not_after),
    audience: x.owner === "autolabels" ? "gateway" : x.owner === "gateway" ? "autolabels" : null,
  }));
  const base: Handler = (t) => {
    if (t.includes("to_regclass('rtgip.evidence_v3')")) return [{ installed: o.v3 !== false }];
    if (t.includes("FROM rtgip.public_keys"))
      return records.map((r) => ({
        ...r,
        not_before: String(r.not_before),
        not_after: String(r.not_after),
        revoked_at: r.revoked_at === null ? null : String(r.revoked_at),
      }));
    if (t.includes("send_protocol, accept_protocols"))
      return reg.connections.map((c) => {
        const g = { ...V3_GATE, ...o.gate };
        return {
          ...c,
          ...g,
          v3_added_at: g.v3_added_at === null ? null : String(g.v3_added_at),
          v2_accept_until: g.v2_accept_until === null ? null : String(g.v2_accept_until),
        };
      });
    if (t.includes("FROM rtgip.delivery_config")) return [{ transport_enabled: true, local_app: "autolabels" }];
    if (t.includes("FROM rtgip.connections")) return reg.connections.map((c) => ({ ...c }));
    if (t.includes("FROM rtgip.signing_keys")) return v2Keys;
    return undefined;
  };
  const handler: Handler = (t, p) => o.db?.(t, p) ?? base(t, p);
  const unsafe = async (text: string, params: unknown[] = []) => {
    calls.push({ text, params });
    return handler(text, params) ?? [];
  };
  const tx = { unsafe, array: (a: unknown[]) => a };
  const sql = {
    begin: async (fn: (t: typeof tx) => unknown) => fn(tx),
    unsafe,
    array: tx.array,
    end: async () => {},
  } as unknown as Sql;
  const fetchFn =
    o.fetch ?? (vi.fn(async () => new Response(JSON.stringify({ receipts: [] }), { status: 200 })) as unknown as typeof fetch);
  const adapter = { produce: vi.fn(async () => []), apply: vi.fn(async () => ({ ok: true, reason: "applied" })) };
  const envMap: Record<string, string | undefined> = {
    RTGIP2_RUNTIME_MODE: "staging",
    SUPABASE_URL: `https://${STAGING}.supabase.co`,
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
    RTGIP2_GATEWAY_URL: GATEWAY,
    SUPABASE_ANON_KEY: "anon-key-for-tests-only",
    RTGIP3_ENABLED: "true",
    RTGIP3_KEY_PINS: k.pinsEnv,
    [OWN_SECRET]: await pkcs8Of(IDS.autolabels),
    RTGIP3_VERIFIER_DIGEST: VERIFIER,
    ...o.env,
  };
  const cfg: AppRuntimeConfig = {
    app: "autolabels",
    compiledEnabled: true,
    stagingRef: STAGING,
    gatewayOrigins: [GATEWAY],
    adapter: adapter as unknown as RuntimeAdapter,
    publish: { kinds: [], refKeys: [], authorize: async () => ({ ok: true }) },
    env: (n) => envMap[n],
    sql: () => sql,
    fetch: fetchFn,
    now: () => T0 * 1000,
    getUser: async () => null,
  };
  return { cfg, calls, adapter, fetch: fetchFn as unknown as ReturnType<typeof vi.fn>, keys: k };
}

const post = (body: string, headers: Record<string, string> = {}) =>
  new Request("https://fn.test/", { method: "POST", headers: { "content-type": "application/json", ...headers }, body });
const dispatchReq = () => post("{}", { authorization: `Bearer ${SERVICE_KEY}` });
const unsignedOf = (r: Receipt3) => {
  const { signature: _s, ...u } = r;
  return u;
};
const called = (calls: Call[], s: string) => calls.filter((c) => c.text.includes(s));
/** The pre-claim read of the protocols the open outbox rows need (REVIEW-IMPL-2 M-1). */
const OPEN_PROTOCOLS = "SELECT DISTINCT coalesce(o.protocol";

async function receipt(
  kind: Stage3,
  outcome: Outcome3,
  sealed: { envelope: EnvelopeV2; body: string },
  conn: string,
  prev: Receipt3 | null,
  signer: SigningKey3,
  at = T0,
): Promise<Receipt3> {
  const envelope_sha256 = await sha256Hex(sealed.body);
  const delivery_id = await deliveryId3(conn, sealed.envelope.event_id, sealed.envelope.target_app, envelope_sha256);
  return signReceipt3(await receiptDraft3({ envelope: sealed.envelope, envelope_sha256, connection_id: conn, delivery_id, kind }, outcome, at, prev), signer);
}

/** The roles and messages the SQL entry point recomputes; the attestation must verify against exactly these. */
const receiptExpectations = (rs: readonly Receipt3[]): AttestExpected3[] =>
  rs.map((r, i) => ({ role: `receipt:${i}`, signer: r.issuer, key_id: r.key_id, message: receiptMessage3(unsignedOf(r)), sig: r.signature, at: r.issued_at }));

// ---------------------------------------------------------------------------

describe("rtgip/3 refusal policy", () => {
  it("REFUSALS_V3 and PEER_VISIBLE_V3 are rtgip/3-refusal-policy/1, code for code", () => {
    const want = new Map<string, number>();
    for (const part of [policy.inherited, policy.added])
      for (const [status, codes] of Object.entries(part)) if (Array.isArray(codes)) for (const c of codes) want.set(c, Number(status));
    for (const [code, status] of want) {
      const r = refusalV3(code);
      const mapped = policy.peer_visible[code];
      if (mapped) {
        expect(r, code).toEqual({ status: mapped === "verification_unavailable" ? 503 : 401, reason: mapped, local: true });
      } else {
        expect(r, code).toEqual({ status, reason: code, local: false });
      }
    }
    for (const [status, codes] of Object.entries(REFUSALS_V3))
      for (const c of codes) expect(want.get(c), c).toBe(Number(status));
    const { note: _n, ...peer } = policy.peer_visible as Record<string, string>;
    expect(PEER_VISIBLE_V3).toEqual(peer);
  });

  it("an unlisted code is a 401, as the rtgip/2 ingress maps it", () => {
    expect(refusalV3("bad_signature")).toEqual({ status: 401, reason: "bad_signature", local: false });
    expect(refusalV3("something_new")).toMatchObject({ status: 401 });
  });

  it("names the signing secret by key id, as the Gateway does, and exposes the bundled modules", () => {
    expect(keySecretName3(IDS.autolabels)).toBe(OWN_SECRET);
    expect(keySecretName3("stg-autocurb-ed12")).toBe("RTGIP3_SIGNING_KEY_STG_AUTOCURB_ED12");
    expect(keySecretName3("prd-autoframe-ed2")).toBe("RTGIP3_SIGNING_KEY_PRD_AUTOFRAME_ED2");
    expect(Object.keys(RTGIP3).sort()).toEqual(["core", "keys", "query", "receipt", "sig", "v2"]);
    expect(Object.isFrozen(RTGIP3)).toBe(true);
  });
});

describe("rtgip/2 stays byte-identical", () => {
  // The golden was captured from the runtime at 20d8865c (before rtgip/3), with the same clock,
  // registry and deterministic randomness.
  async function capture(action: "deliver" | "confirm", o: WorldOpts) {
    let n = 0;
    const spy = vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation(((a: Uint8Array) => {
      for (let i = 0; i < a.length; i++) a[i] = (n++ * 37 + 11) & 255;
      return a;
    }) as never);
    const seen: unknown[] = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      seen.push({ url, method: init.method, redirect: init.redirect, headers: init.headers, body: init.body });
      return new Response('{"receipts":[]}', { status: 200 });
    }) as unknown as typeof fetch;
    const row = { ...golden.row, lease_action: action };
    const inner = o.db;
    const w = await world({
      ...o,
      fetch: fetchFn,
      db: (t, p) => {
        if (t.includes("outbox_claim")) return [row];
        return inner?.(t, p);
      },
    });
    try {
      await createAppRuntime(w.cfg).dispatch(dispatchReq());
    } finally {
      spy.mockRestore();
    }
    return { seen, w };
  }
  const v2Pinned: Handler = (t) =>
    t.includes("protocol, delivery_id_v3")
      ? [{ event_id: golden.row.event_id, protocol: "rtgip/2", delivery_id_v3: null, connection_id: CONNS[0] }]
      : t.includes(OPEN_PROTOCOLS)
        ? [{ protocol: "rtgip/2" }]
        : undefined;

  for (const action of ["deliver", "confirm"] as const) {
    it(`${action}: a node without the rtgip/3 SQL sends exactly the pre-rtgip/3 request and issues no rtgip/3 call`, async () => {
      const { seen, w } = await capture(action, { v3: false });
      expect(seen).toEqual(golden[action]);
      expect(JSON.stringify(seen)).toBe(JSON.stringify(golden[action]));
      // Only the read-only probe for the rtgip/3 tables runs; it finds none, so nothing else rtgip/3 is asked.
      expect(w.calls.filter((c) => /_v3|public_keys|connection_gate/.test(c.text)).map((c) => c.text)).toEqual([
        expect.stringContaining("to_regclass('rtgip.evidence_v3')"),
      ]);
    });

    it(`${action}: a v2-pinned row on an rtgip/3 node sends the same bytes through outbox_advance (never _v3)`, async () => {
      const { seen, w } = await capture(action, { v3: true, gate: { send_protocol: "rtgip/2" }, db: v2Pinned });
      expect(JSON.stringify(seen)).toBe(JSON.stringify(golden[action]));
      expect(called(w.calls, "outbox_advance_v3")).toHaveLength(0);
    });
  }

  it("L-1: the v2 inbound gate is asked only about a body the frozen rtgip/2 verifier authenticated", async () => {
    const sealed = await sealEnvelope(draftEnvelope("autocurb", "autolabels", "appraisal.completed"));
    const conn = CONNS.find((c) => c.startsWith("conn:autocurb>autolabels:"))!;
    const g = await gatewayDelivery(reg, sealed.envelope, sealed.body, conn, { nonce: "gw_0123456789abcdef01234567", at: T0 });
    const closed: Handler = (t) => (t.includes("connection_gate") ? [{ g: "protocol_not_accepted" }] : undefined);
    // Signed by the Gateway on a connection whose rtgip/2 window has closed: 403 before any write.
    const refused = await world({ db: closed });
    const r = await createAppRuntime(refused.cfg).inbound(post(sealed.body, g.headers));
    expect(r.status).toBe(403);
    expect(await r.json()).toEqual({ reason: "protocol_not_accepted", receipts: [] });
    expect(called(refused.calls, "inbox_admit")).toHaveLength(0);
    expect(called(refused.calls, "connection_gate")[0]!.params).toEqual([sealed.body]);
    // Unsigned, altered, or carrying a raw NUL byte under a guessed scope: the gate is never asked and the answer is
    // byte for byte the one a node without the rtgip/3 SQL gives (no oracle on live connections, no 500).
    const flip = (v: string) => v.replace(/.$/, (c) => (c === "0" ? "1" : "0"));
    const guessed = `{"rooftop_id":"rf-1","source_app":"autocurb","target_app":"autolabels","tenant_id":"t","x":"\u0000\0"}`;
    for (const [body, headers] of [
      [sealed.body, { "rtgip-protocol": "rtgip/2" }],
      [sealed.body, { ...g.headers, "rtgip-signature": flip(g.headers["rtgip-signature"]!) }],
      [`${sealed.body} `, g.headers],
      [guessed, { "rtgip-protocol": "rtgip/2" }],
      [guessed, g.headers],
    ] as const) {
      const w = await world({ db: closed });
      const got = await createAppRuntime(w.cfg).inbound(post(body, headers));
      const plain = await world({ v3: false });
      const want = await createAppRuntime(plain.cfg).inbound(post(body, headers));
      expect([got.status, await got.text()]).toEqual([want.status, await want.text()]);
      expect(got.status).not.toBe(403);
      expect(called(w.calls, "connection_gate")).toHaveLength(0);
      expect(called(w.calls, "to_regclass")).toHaveLength(0);
      expect(called(w.calls, "inbox_admit")).toHaveLength(0);
    }
    // An accepted connection goes on to the frozen admission, which verifies the delivery again.
    const ok = await world({ db: (t) => (t.includes("connection_gate") ? [{ g: null }] : undefined) });
    await createAppRuntime(ok.cfg).inbound(post(sealed.body, g.headers));
    expect(called(ok.calls, "connection_gate")).toHaveLength(1);
    expect(called(ok.calls, "rtgip.inbox_admit(")).toHaveLength(1);
    expect(called(ok.calls, "inbox_admit_v3")).toHaveLength(0);
    // A gate query that fails answers 503 admission_aborted, never 500, and admits nothing.
    const broken = await world({
      db: (t) => {
        if (t.includes("connection_gate")) throw Object.assign(new Error("invalid byte sequence"), { name: "PostgresError", code: "22021" });
        return undefined;
      },
    });
    const b = await createAppRuntime(broken.cfg).inbound(post(sealed.body, g.headers));
    expect([b.status, await b.json()]).toEqual([503, { reason: "admission_aborted", receipts: [] }]);
    expect(called(broken.calls, "inbox_admit")).toHaveLength(0);
  });
});

describe("rtgip/3 dispatch (source)", () => {
  async function leased(
    action: "deliver" | "confirm",
    answer: (sealed: { envelope: EnvelopeV2; body: string }, k: Keys) => Promise<{ status: number; doc: unknown }>,
    o: WorldOpts = {},
    advance = "gateway_admitted",
  ) {
    const k = await keys();
    const sealed = await sealEnvelope(draftEnvelope("autolabels", "autocurb", "vehicle.identity_registered"));
    const conn = CONNS.find((c) => c.startsWith("conn:autolabels>autocurb:"))!;
    const deliveryId = await deliveryId3(conn, sealed.envelope.event_id, "autocurb", await sha256Hex(sealed.body));
    const row = { event_id: sealed.envelope.event_id, body: sealed.body, envelope: sealed.envelope, delivery_id: "d".repeat(64), lease_generation: 4, lease_action: action };
    const { status, doc } = await answer(sealed, k);
    const f = vi.fn(async () => new Response(JSON.stringify(doc), { status }));
    const inner = o.db;
    const w = await world({
      ...o,
      fetch: f as unknown as typeof fetch,
      db: (t, p) => {
        const mine = inner?.(t, p);
        if (mine) return mine;
        if (t.includes(OPEN_PROTOCOLS)) return [{ protocol: "rtgip/3" }];
        if (t.includes("outbox_claim")) return [row];
        if (t.includes("protocol, delivery_id_v3"))
          return [{ event_id: row.event_id, protocol: "rtgip/3", delivery_id_v3: deliveryId, connection_id: conn }];
        if (t.includes("outbox_advance_v3")) return [{ r: advance }];
        if (t.includes("SELECT state FROM rtgip.outbox")) return [{ state: advance }];
        return undefined;
      },
    });
    const r = await createAppRuntime(w.cfg).dispatch(dispatchReq());
    return { r, w, f, sealed, conn, deliveryId };
  }

  it("signs H1 with the pinned Ed25519 key and posts it to /api/rtgip/v3/deliver; the admission is attested to outbox_advance_v3", async () => {
    let adm: Receipt3 | null = null;
    const { r, w, f, sealed, conn } = await leased("deliver", async (s, k) => {
      const c = CONNS.find((x) => x.startsWith("conn:autolabels>autocurb:"))!;
      adm = await receipt("gateway_admission", "admitted", s, c, null, k.signers.gateway);
      return { status: 200, doc: { outcome: "admitted", receipt: adm } };
    });
    expect(r.status).toBe(200);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${GATEWAY}/api/rtgip/v3/deliver`);
    expect(init.redirect).toBe("error");
    expect(init.body).toBe(sealed.body);
    const h = init.headers as Record<string, string>;
    expect(h["rtgip-protocol"]).toBe("rtgip/3");
    expect(h["rtgip-key-id"]).toBe(IDS.autolabels);
    expect(h["rtgip-signature"]).toMatch(/^rtgip3=[0-9a-f]{128}$/);
    // What the Gateway checks at admission: the H1 signature with the source's pinned key, bound to the connection.
    const k = await keys();
    expect(await verifySignature3(h, sealed.body, "source", k.ctx, conn)).toMatchObject({ ok: true });
    const adv = called(w.calls, "outbox_advance_v3")[0]!;
    expect(adv.params.slice(0, 4)).toEqual([sealed.envelope.event_id, expect.stringMatching(/^dispatch-/), 4, [canonicalize(adm!)]]);
    const doc = JSON.parse(adv.params[4] as string) as AttestDoc3;
    expect(doc.verifier).toBe(VERIFIER);
    expect(await verifyAttest3(doc, receiptExpectations([adm!]), k.ctx, T0)).toEqual({ ok: true });
    expect(called(w.calls, "outbox_advance(")).toHaveLength(0);
    expect(called(w.calls, "outbox_fail")).toHaveLength(0);
    expect(await r.json()).toMatchObject([{ action: "deliver", http_status: 200, advanced: ["gateway_admitted"] }]);
  });

  it("confirms with a signed rtgip/3-receipt-query/2 for the pinned v3 delivery id and attests the whole chain", async () => {
    let chain: Receipt3[] = [];
    const { w, f, sealed, deliveryId } = await leased(
      "confirm",
      async (s, k) => {
        const c = CONNS.find((x) => x.startsWith("conn:autolabels>autocurb:"))!;
        const adm = await receipt("gateway_admission", "admitted", s, c, null, k.signers.gateway);
        const inbox = await receipt("target_inbox", "applied", s, c, adm, k.signers.autocurb);
        const commit = await receipt("consumer_commit", "applied", s, c, inbox, k.signers.autocurb);
        chain = [adm, inbox, commit];
        return { status: 200, doc: { receipts: chain } };
      },
      {},
      "consumer_committed",
    );
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${GATEWAY}/api/rtgip/v3/receipts`);
    expect(JSON.parse(init.body as string)).toEqual({ delivery_id: deliveryId, event_id: sealed.envelope.event_id, protocol: "rtgip/3-receipt-query/2" });
    const k = await keys();
    expect(await verifyQuerySignature3(init.headers as unknown as QueryHeaders3, init.body as string, k.ctx)).toMatchObject({ ok: true });
    const adv = called(w.calls, "outbox_advance_v3")[0]!;
    expect(adv.params[3]).toEqual(chain.map((x) => canonicalize(x)));
    expect(await verifyAttest3(JSON.parse(adv.params[4] as string), receiptExpectations(chain), k.ctx, T0)).toEqual({ ok: true });
    expect(called(w.calls, "outbox_fail")).toHaveLength(0);
  });

  it("never advances on a forged or mis-bound receipt: the lease fails with the chain verdict", async () => {
    for (const forge of [
      (r: Receipt3) => ({ ...r, signature: r.signature.replace(/^./, (c) => (c === "0" ? "1" : "0")) }),
      (r: Receipt3) => ({ ...r, outcome: "held" as const }),
      (r: Receipt3) => ({ ...r, delivery_id: "e".repeat(64) }),
    ]) {
      const { w } = await leased("deliver", async (s, k) => {
        const c = CONNS.find((x) => x.startsWith("conn:autolabels>autocurb:"))!;
        return { status: 200, doc: { receipt: forge(await receipt("gateway_admission", "admitted", s, c, null, k.signers.gateway)) } };
      });
      expect(called(w.calls, "outbox_advance_v3")).toHaveLength(0);
      expect(String(called(w.calls, "outbox_fail")[0]!.params[3])).toMatch(/^[a-z_]+$/);
    }
  });

  it("refuses a receipt signed by a key that is not pinned, as unknown_key, without advancing", async () => {
    const { w } = await leased(
      "deliver",
      async (s, k) => {
        const c = CONNS.find((x) => x.startsWith("conn:autolabels>autocurb:"))!;
        return { status: 200, doc: { receipt: await receipt("gateway_admission", "admitted", s, c, null, k.signers.gateway) } };
      },
      { env: { RTGIP3_KEY_PINS: (await keys()).pinsEnv.split(",").filter((p) => !p.startsWith(IDS.gateway)).join(",") } },
    );
    expect(called(w.calls, "outbox_advance_v3")).toHaveLength(0);
    expect(called(w.calls, "outbox_fail")[0]!.params[3]).toBe("key_not_pinned");
  });

  it("M-1: an open rtgip/3 row is never leased without the switch, a verifier digest, valid pins or a self-tested key", async () => {
    const own = (r: PublicKeyRecord[]) => r.find((x) => x.owner === "autolabels")!;
    for (const [o, why] of [
      [{ env: { RTGIP3_VERIFIER_DIGEST: undefined } }, "verification_unavailable"],
      [{ env: { RTGIP3_VERIFIER_DIGEST: "not-a-digest" } }, "verification_unavailable"],
      [{ env: { RTGIP3_KEY_PINS: "garbage" } }, "verification_unavailable"],
      [{ env: { RTGIP3_KEY_ENV: "dev" } }, "verification_unavailable"],
      [{ env: { [OWN_SECRET]: undefined } }, "no_signing_key"],
      [{ env: { [OWN_SECRET]: await pkcs8Of(IDS.autocurb) } }, "no_signing_key"],
      // The per-app name of the first rtgip/3 runtime is no longer read (L-4).
      [{ env: { [OWN_SECRET]: undefined, RTGIP3_SIGNING_KEY_AUTOLABELS: await pkcs8Of(IDS.autolabels) } }, "no_signing_key"],
      // Rotation step 1 (two current key rows of this app) and an own key row with an unsafe validity (L-3).
      [{ records: (r: PublicKeyRecord[]) => [...r, { ...own(r), key_id: "stg-autolabels-ed2" }] }, "no_signing_key"],
      [{ records: (r: PublicKeyRecord[]) => r.map((x) => (x.owner === "autolabels" ? { ...x, not_after: 2 ** 53 } : x)) }, "no_signing_key"],
      // L-8: rtgip/3 is off unless RTGIP3_ENABLED is exactly "true".
      [{ env: { RTGIP3_ENABLED: undefined } }, "rtgip3_disabled"],
      [{ env: { RTGIP3_ENABLED: "TRUE" } }, "rtgip3_disabled"],
      [{ env: { RTGIP3_ENABLED: "1" } }, "rtgip3_disabled"],
    ] as [WorldOpts, string][]) {
      const { r, w, f } = await leased("deliver", async () => ({ status: 200, doc: {} }), o);
      expect([r.status, await r.json()], why).toEqual([503, { reason: why }]);
      expect(f, why).not.toHaveBeenCalled();
      expect(called(w.calls, "outbox_claim"), why).toHaveLength(0);
      expect(called(w.calls, "outbox_fail"), why).toHaveLength(0);
    }
  });

  const v2KeysWith = (notAfter: number): Handler => (t) =>
    t.includes("FROM rtgip.signing_keys")
      ? reg.keys.map((x) => ({
          ...x,
          not_before: String(x.not_before),
          not_after: String(x.owner === "autolabels" ? notAfter : x.not_after),
          audience: x.owner === "autolabels" ? "gateway" : x.owner === "gateway" ? "autolabels" : null,
        }))
      : undefined;

  it("M-1: an open rtgip/2 row is never leased without the app's current rtgip/2 key, whatever the rtgip/3 signer", async () => {
    for (const open of [[{ protocol: "rtgip/2" }], [{ protocol: "rtgip/2" }, { protocol: "rtgip/3" }]]) {
      const expired = v2KeysWith(T0 - 1);
      const { r, w, f } = await leased("deliver", async () => ({ status: 200, doc: {} }), {
        db: (t, p) => (t.includes(OPEN_PROTOCOLS) ? open : expired(t, p)),
      });
      expect([r.status, await r.json()]).toEqual([503, { reason: "no_signing_key" }]);
      expect(f).not.toHaveBeenCalled();
      expect(called(w.calls, "outbox_claim")).toHaveLength(0);
    }
  });

  it("M-1: a key fault of one protocol does not hold a pass whose open rows are all of the other", async () => {
    // rtgip/3 rows only, the rtgip/2 key expired: delivered over rtgip/3.
    const k = await keys();
    const expired = v2KeysWith(T0 - 1);
    const v3 = await leased(
      "deliver",
      async (s) => ({ status: 200, doc: { receipt: await receipt("gateway_admission", "admitted", s, CONNS.find((c) => c.startsWith("conn:autolabels>autocurb:"))!, null, k.signers.gateway) } }),
      { db: expired },
    );
    expect(v3.r.status).toBe(200);
    expect(called(v3.w.calls, "outbox_advance_v3")).toHaveLength(1);
    // rtgip/2 rows only, no rtgip/3 signer and rtgip/3 switched off: the rtgip/2 row goes out as before.
    const row = { ...golden.row, lease_action: "deliver" };
    const seen: string[] = [];
    const w = await world({
      env: { [OWN_SECRET]: undefined, RTGIP3_ENABLED: undefined },
      fetch: (async (url: string) => {
        seen.push(url);
        return new Response('{"receipts":[]}', { status: 200 });
      }) as unknown as typeof fetch,
      db: (t) =>
        t.includes(OPEN_PROTOCOLS)
          ? [{ protocol: "rtgip/2" }]
          : t.includes("outbox_claim")
            ? [row]
            : t.includes("protocol, delivery_id_v3")
              ? [{ event_id: row.event_id, protocol: "rtgip/2", delivery_id_v3: null, connection_id: CONNS[0] }]
              : undefined,
    });
    const r = await createAppRuntime(w.cfg).dispatch(dispatchReq());
    expect(r.status).toBe(200);
    expect(seen).toEqual([`${GATEWAY}/api/rtgip/v2/deliver`]);
  });

  it("L-7: with the rtgip/3 SQL, a leased row is sent as rtgip/2 only when it is pinned rtgip/2", async () => {
    for (const protocol of [null, "rtgip/9", "RTGIP/2"]) {
      const { r, w, f } = await leased("deliver", async () => ({ status: 200, doc: {} }), {
        db: (t, p) =>
          t.includes("protocol, delivery_id_v3")
            ? (p[0] as string[]).map((event_id) => ({ event_id, protocol, delivery_id_v3: null, connection_id: CONNS[0] }))
            : undefined,
      });
      expect(r.status, String(protocol)).toBe(200);
      expect(f, String(protocol)).not.toHaveBeenCalled();
      expect(called(w.calls, "outbox_advance"), String(protocol)).toHaveLength(0);
      expect(called(w.calls, "outbox_fail")[0]!.params[3], String(protocol)).toBe("protocol_mismatch");
    }
  });

  it("L-8: a row pinned to rtgip/3 after the pre-claim read is still never sent while the switch is off", async () => {
    const { w, f } = await leased("deliver", async () => ({ status: 200, doc: {} }), {
      env: { RTGIP3_ENABLED: undefined },
      db: (t) => (t.includes(OPEN_PROTOCOLS) ? [{ protocol: "rtgip/2" }] : undefined),
    });
    expect(f).not.toHaveBeenCalled();
    expect(called(w.calls, "outbox_fail")[0]!.params[3]).toBe("rtgip3_disabled");
  });

  it("maps a Gateway rtgip/3 refusal (error field) through the refusal policy and never advances", async () => {
    const { w } = await leased("deliver", async () => ({ status: 403, doc: { error: "protocol_not_accepted" } }));
    expect(called(w.calls, "outbox_advance_v3")).toHaveLength(0);
    expect(called(w.calls, "outbox_fail")[0]!.params[3]).toBe("refused:403:protocol_not_accepted");
  });
});

describe("rtgip/3 inbound (target)", () => {
  const CONN = CONNS.find((c) => c.startsWith("conn:autocurb>autolabels:"))!;

  async function forward(over: { origin?: string | null; admission?: string | null; gwSigner?: SigningKey3 } = {}) {
    const k = await keys();
    const sealed = await sealEnvelope(draftEnvelope("autocurb", "autolabels", "appraisal.completed"));
    const h1 = await signEnvelopeV3(sealed.body, sealed.envelope, k.signers.autocurb, T0 - 5, "src_000000000001");
    const adm = await receipt("gateway_admission", "admitted", sealed, CONN, null, k.signers.gateway, T0 - 4);
    const h2 = await signEnvelopeV3(sealed.body, sealed.envelope, over.gwSigner ?? k.signers.gateway, T0 - 3, "fwd_000000000001");
    const headers: Record<string, string> = { ...h2 };
    const origin = over.origin === undefined ? encodeOrigin(originOf(h1)) : over.origin;
    const admission = over.admission === undefined ? encodeAdmissionHeader3(adm) : over.admission;
    if (origin !== null) headers[ORIGIN_HEADER] = origin;
    if (admission !== null) headers[ADMISSION_HEADER3] = admission;
    return { sealed, h1, h2, adm, headers };
  }

  const admitRow = (e: EnvelopeV2, deliveryId: string, over: Record<string, unknown> = {}) => ({
    admission_id: 1,
    event_id: e.event_id,
    outcome: "applied",
    reason: null,
    committed: true,
    committed_outcome: "applied",
    connection_id: CONN,
    envelope: e,
    delivery_id: deliveryId,
    issued_at: String(T0),
    stored_receipts: null,
    replayed: false,
    ...over,
  });

  async function run(
    f: Awaited<ReturnType<typeof forward>>,
    o: WorldOpts = {},
    row: Record<string, unknown> = {},
    prep?: (w: Awaited<ReturnType<typeof world>>) => void,
  ) {
    const deliveryId = await deliveryId3(CONN, f.sealed.envelope.event_id, "autolabels", await sha256Hex(f.sealed.body));
    const inner = o.db;
    const w = await world({
      ...o,
      db: (t, p) => inner?.(t, p) ?? (t.includes("inbox_admit_v3") ? [admitRow(f.sealed.envelope, deliveryId, row)] : undefined),
    });
    prep?.(w);
    const r = await createAppRuntime(w.cfg).inbound(post(f.sealed.body, f.headers));
    return { r, w, deliveryId, body: (await r.json()) as { reason: string | null; receipts: Receipt3[] } };
  }

  it("verifies forward, admission and origin, admits through inbox_admit_v3 with all three attested, applies once, signs and stores the receipts", async () => {
    const f = await forward();
    const { r, w, body, deliveryId } = await run(f);
    expect(r.status).toBe(200);
    expect(body.reason).toBeNull();
    const k = await keys();
    expect(body.receipts.map((x) => [x.kind, x.outcome, x.key_id, x.issuer])).toEqual([
      ["target_inbox", "applied", IDS.autolabels, "autolabels"],
      ["consumer_commit", "applied", IDS.autolabels, "autolabels"],
    ]);
    const chain = await evaluateChain3([f.adm, ...body.receipts], {
      ...k.ctx,
      envelope: f.sealed.envelope,
      envelope_sha256: await sha256Hex(f.sealed.body),
      connection_id: CONN,
    });
    expect(chain).toMatchObject({ ok: true, status: "consumer_committed" });

    const roles = w.calls.filter((c) => c.text === "SET LOCAL ROLE rtgip_inbox_receiver");
    expect(roles.length).toBeGreaterThanOrEqual(2);
    const admit = called(w.calls, "inbox_admit_v3");
    expect(admit).toHaveLength(1);
    const [hdrs, rawBody, admText, originText, attestText, rej] = admit[0]!.params as string[];
    expect(JSON.parse(hdrs!)).toEqual(f.h2);
    expect(rawBody).toBe(f.sealed.body);
    expect(admText).toBe(f.headers[ADMISSION_HEADER3]);
    expect(originText).toBe(f.headers[ORIGIN_HEADER]);
    expect(rej).toBeNull();
    const bodySha = await sha256Hex(f.sealed.body);
    const h = f.h2;
    const o = originOf(f.h1);
    const expected: AttestExpected3[] = [
      {
        role: "forward",
        signer: "gateway",
        key_id: IDS.gateway,
        message: preimage3(h["rtgip-key-id"], h["rtgip-signer"], h["rtgip-timestamp"], h["rtgip-nonce"], h["rtgip-scope"], bodySha),
        sig: h["rtgip-signature"].slice(SIGNATURE_PREFIX3.length),
        at: Number(h["rtgip-timestamp"]),
      },
      { role: "admission", signer: "gateway", key_id: IDS.gateway, message: receiptMessage3(unsignedOf(f.adm)), sig: f.adm.signature, at: f.adm.issued_at },
      {
        role: "origin",
        signer: "autocurb",
        key_id: IDS.autocurb,
        message: preimage3(o.key_id, o.signer, String(o.timestamp), o.nonce, o.scope, bodySha),
        sig: o.signature,
        at: o.timestamp,
      },
    ];
    const attest = JSON.parse(attestText!) as AttestDoc3;
    expect(attest.verifier).toBe(VERIFIER);
    expect(await verifyAttest3(attest, expected, k.ctx, T0)).toEqual({ ok: true });
    expect(w.adapter.apply).toHaveBeenCalledTimes(1);

    const rec = called(w.calls, "inbox_record_receipts_v3");
    expect(rec).toHaveLength(1);
    expect(rec[0]!.params[0]).toBe(deliveryId);
    expect(rec[0]!.params[1]).toEqual(body.receipts.map((x) => canonicalize(x)));
    expect(await verifyAttest3(JSON.parse(rec[0]!.params[2] as string), receiptExpectations(body.receipts), k.ctx, T0)).toEqual({ ok: true });
    expect(called(w.calls, "inbox_admit(")).toHaveLength(0);
  });

  it("answers a replay from the stored receipts, without applying or storing again", async () => {
    const f = await forward();
    const first = await run(f);
    const stored = first.body.receipts.map((x) => canonicalize(x));
    const again = await run(f, {}, { replayed: true, stored_receipts: stored });
    expect(again.r.status).toBe(200);
    expect(again.body.receipts).toEqual(first.body.receipts);
    expect(again.w.adapter.apply).not.toHaveBeenCalled();
    expect(called(again.w.calls, "inbox_record_receipts_v3")).toHaveLength(0);
  });

  it("a held delivery gets its inbox receipt but nothing is stored for it yet", async () => {
    const f = await forward();
    const { body, w } = await run(f, {}, { outcome: "held", committed: false, committed_outcome: null });
    expect(body.receipts.map((x) => [x.kind, x.outcome])).toEqual([["target_inbox", "held"]]);
    expect(called(w.calls, "inbox_record_receipts_v3")).toHaveLength(0);
  });

  it("runs the consumer-reject pass when the effect refuses, and answers from the second admission", async () => {
    const f = await forward();
    let n = 0;
    const deliveryId = await deliveryId3(CONN, f.sealed.envelope.event_id, "autolabels", await sha256Hex(f.sealed.body));
    const { r, w, body } = await run(
      f,
      {
        db: (t) => {
          if (!t.includes("inbox_admit_v3")) return undefined;
          n++;
          return [admitRow(f.sealed.envelope, deliveryId, n === 1 ? {} : { outcome: "quarantined", committed: false, committed_outcome: null, envelope: null })];
        },
      },
      {},
      (x) => x.adapter.apply.mockResolvedValueOnce({ ok: false, reason: "consumer_refused" }),
    );
    expect(r.status).toBe(200);
    const admits = called(w.calls, "inbox_admit_v3");
    expect(admits).toHaveLength(2);
    expect(admits[0]!.params[5]).toBeNull();
    expect(JSON.parse(admits[1]!.params[5] as string)).toEqual({ event_id: f.sealed.envelope.event_id, reason: "consumer_refused" });
    expect(w.calls.some((c) => c.text === "ROLLBACK TO SAVEPOINT rtgip_admit_v3")).toBe(true);
    expect(body.receipts.map((x) => [x.kind, x.outcome])).toEqual([["target_inbox", "quarantined"]]);
    expect(called(w.calls, "inbox_record_receipts_v3")).toHaveLength(1);
  });

  it("refuses before any write: missing admission or origin, an unpinned Gateway key, a foreign signer, a closed gate", async () => {
    const k = await keys();
    const cases: [Awaited<ReturnType<typeof forward>>, WorldOpts, number, string][] = [
      [await forward({ admission: null }), {}, 400, "admission_missing"],
      [await forward({ origin: null }), {}, 400, "origin_missing"],
      [await forward({ gwSigner: k.signers.autocurb }), {}, 401, "signer_not_gateway"],
      [
        await forward(),
        { env: { RTGIP3_KEY_PINS: k.pinsEnv.split(",").filter((p) => !p.startsWith(IDS.gateway)).join(",") } },
        401,
        "unknown_key",
      ],
      [await forward(), { gate: { accept_protocols: ["rtgip/2"] } }, 403, "protocol_not_accepted"],
      [await forward(), { v3: false }, 403, "protocol_not_accepted"],
      [await forward(), { env: { RTGIP3_VERIFIER_DIGEST: undefined } }, 503, "verification_unavailable"],
      [await forward(), { env: { RTGIP3_KEY_PINS: "x" } }, 503, "verification_unavailable"],
      [await forward(), { env: { [OWN_SECRET]: undefined } }, 503, "no_signing_key"],
      [await forward(), { env: { [OWN_SECRET]: undefined, RTGIP3_SIGNING_KEY_AUTOLABELS: await pkcs8Of(IDS.autolabels) } }, 503, "no_signing_key"],
      // L-3: a pinned Gateway key row whose validity is not a safe integer is left out: unknown_key, not 500.
      [await forward(), { records: (r) => r.map((x) => (x.owner === "gateway" ? { ...x, not_after: 2 ** 53 } : x)) }, 401, "unknown_key"],
      [await forward(), { records: (r) => r.map((x) => (x.owner === "autolabels" ? { ...x, not_before: -(2 ** 53) } : x)) }, 503, "no_signing_key"],
    ];
    for (const [f, o, status, reason] of cases) {
      const { r, w, body } = await run(f, o);
      expect([r.status, body.reason], reason).toEqual([status, reason]);
      expect(body.receipts, reason).toEqual([]);
      expect(called(w.calls, "inbox_admit"), reason).toHaveLength(0);
      expect(w.adapter.apply, reason).not.toHaveBeenCalled();
    }
  });

  it("L-6 and L-8: the switch, then the header shape, are checked before any rtgip/3 state is read", async () => {
    const k = await keys();
    const f = await forward();
    const flip = (v: string) => v.replace(/.$/, (c) => (c === "0" ? "1" : "0"));
    const cases: [Record<string, string>, WorldOpts, number, string][] = [
      [f.headers, { env: { RTGIP3_ENABLED: undefined } }, 403, "protocol_not_accepted"],
      [f.headers, { env: { RTGIP3_ENABLED: "yes" } }, 403, "protocol_not_accepted"],
      [{ "rtgip-protocol": "rtgip/3" }, {}, 400, "missing_headers"],
      [{ ...f.headers, "rtgip-signature": undefined as unknown as string }, {}, 400, "missing_headers"],
      [{ ...f.headers, "rtgip-signature": `rtgip2=${"0".repeat(64)}` }, {}, 400, "protocol_mismatch"],
      [{ ...f.headers, "rtgip-nonce": "short" }, {}, 400, "invalid_nonce"],
      [{ ...f.headers, "rtgip-key-id": "gw-dev-1" }, {}, 401, "unknown_key"],
      [{ ...f.headers, "rtgip-signature": "rtgip3=zz" }, {}, 400, "signature_malformed"],
      [{ ...f.headers, [ADMISSION_HEADER3]: "not-a-receipt" }, {}, 401, "invalid_receipt_shape"],
      [{ ...f.headers, [ADMISSION_HEADER3]: Buffer.from('{"b":1, "a":2}').toString("base64url") }, {}, 401, "invalid_receipt_shape"],
      [{ ...f.headers, [ORIGIN_HEADER]: "garbage" }, {}, 403, "origin_mismatch"],
    ];
    for (const [headers, o, status, reason] of cases) {
      const clean = Object.fromEntries(Object.entries(headers).filter(([, v]) => v !== undefined));
      const w = await world(o);
      const r = await createAppRuntime(w.cfg).inbound(post(f.sealed.body, clean));
      expect([r.status, await r.json()], reason).toEqual([status, { reason, receipts: [] }]);
      expect(called(w.calls, "to_regclass"), reason).toHaveLength(0);
      expect(called(w.calls, "public_keys"), reason).toHaveLength(0);
      expect(called(w.calls, "inbox_admit"), reason).toHaveLength(0);
    }
    // A well-shaped forward with a bad signature still reaches the full verifier, which refuses it.
    const bad = await run({ ...f, headers: { ...f.headers, "rtgip-signature": `rtgip3=${flip(f.h2["rtgip-signature"].slice(7))}` } });
    expect(bad.r.status).toBe(401);
    expect(called(bad.w.calls, "public_keys")).toHaveLength(1);
    expect(k.records).toHaveLength(3);
  });

  it("L-2: a receipt self-check failure is logged by its own reason and answered verification_unavailable, never no_signing_key", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const f = await forward();
      // The admission was issued after the clock SQL stamps the receipts with: the chain rule refuses time reversal.
      const { r, body, w } = await run(f, {}, { issued_at: String(f.adm.issued_at - 60) });
      expect([r.status, body]).toEqual([503, { reason: "verification_unavailable", receipts: [] }]);
      expect(warn).toHaveBeenCalledWith("rtgip3_local_refusal", "ack_stage_time_reversed");
      expect(warn.mock.calls.some((c) => c.includes("no_signing_key"))).toBe(false);
      expect(called(w.calls, "inbox_record_receipts_v3")).toHaveLength(0);
    } finally {
      warn.mockRestore();
    }
  });

  it("a key_not_pinned or attest_* verdict from SQL leaves only its peer code", async () => {
    for (const [code, status, shown] of [
      ["attest_stale", 503, "verification_unavailable"],
      ["attest_msg_mismatch", 503, "verification_unavailable"],
      ["key_not_pinned", 401, "unknown_key"],
      ["nonce_reused", 401, "nonce_reused"],
      ["origin_mismatch", 403, "origin_mismatch"],
    ] as const) {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const f = await forward();
      const { r, body, w } = await run(f, {}, { outcome: "rejected", reason: code });
      expect([r.status, body.reason], code).toEqual([status, shown]);
      expect(w.adapter.apply).not.toHaveBeenCalled();
      expect(called(w.calls, "inbox_record_receipts_v3")).toHaveLength(0);
      warn.mockRestore();
    }
  });

  it("an admission row that disagrees with the edge verifier is a 500, never a receipt", async () => {
    const f = await forward();
    const { r, body } = await run(f, {}, { connection_id: "conn:autolabels>autoframe:tnt-syn-northwind" });
    expect(r.status).toBe(500);
    expect(body).toEqual({ reason: "verifier_disagreement", receipts: [] });
  });

  it("refuses a repeated or folded rtgip header", async () => {
    const f = await forward();
    f.headers["rtgip-nonce"] = `${f.headers["rtgip-nonce"]}, fwd_000000000002`;
    const { r, body } = await run(f);
    expect([r.status, body.reason]).toEqual([400, "duplicate_or_invalid_header"]);
  });
});
