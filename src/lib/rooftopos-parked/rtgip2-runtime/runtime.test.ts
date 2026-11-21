import { describe, expect, it, vi } from "vitest";
import { canonicalize, sealEnvelope, signEnvelope, type EnvelopeV2 } from "../rtgip2/protocol.ts";
import { draftEnvelope, syntheticRegistry, T0 } from "../rtgip2/fixtures.ts";
import {
  createAppRuntime,
  type AppRuntimeConfig,
  type PublishAuthorizer,
  type RuntimeAdapter,
  type Sql,
} from "./runtime.ts";

const PRODUCTION_REFS = ["onnbmmdbrsgytfozfozn", "ptiwdwfdckfqivoocyvp", "eabnaohpjuewhwrfhkun"];
const STAGING = "abcdefghijklmnopqrst";
const GATEWAY = "https://gateway.staging.example.test";
const SERVICE_KEY = "service-role-key-for-tests-only";
const USER = "11111111-1111-4111-8111-111111111111";
const TOKEN = "header.payload.signature";

interface Call {
  text: string;
  params: unknown[];
}
type Handler = (text: string, params: unknown[]) => unknown[] | undefined;

function fakeSql(handler: Handler, calls: Call[] = []) {
  const unsafe = async (text: string, params: unknown[] = []) => {
    calls.push({ text, params });
    return handler(text, params) ?? [];
  };
  const tx = { unsafe, array: (a: unknown[]) => a };
  const end = vi.fn(async () => {});
  return {
    sql: {
      begin: async (fn: (t: typeof tx) => unknown) => fn(tx),
      unsafe,
      array: tx.array,
      end,
    } as unknown as Sql,
    calls,
    end,
  };
}

const registryRows = (): { conns: unknown[]; keys: unknown[] } => {
  const reg = syntheticRegistry();
  return {
    conns: reg.connections.map((c) => ({ ...c })),
    keys: reg.keys.map((k) => ({
      ...k,
      not_before: String(k.not_before),
      not_after: String(k.not_after),
    })),
  };
};

/** AR-1 option 1 columns as the app database holds them: own key and Gateway link key only. */
const ar1Path = (k: unknown, app: string) => {
  const owner = (k as { owner: string }).owner;
  if (owner === app) return { audience: "gateway" };
  if (owner === "gateway") return { audience: app };
  return { audience: null };
};

interface World {
  cfg: AppRuntimeConfig;
  calls: Call[];
  sqlFactory: ReturnType<typeof vi.fn>;
  fetch: ReturnType<typeof vi.fn>;
  adapter: { produce: ReturnType<typeof vi.fn>; apply: ReturnType<typeof vi.fn> };
  authorize: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
}

function world(
  over: Partial<AppRuntimeConfig> = {},
  opts: {
    env?: Record<string, string | undefined>;
    db?: Handler | undefined;
    app?: "autolabels" | "autocurb" | "autoframe";
  } = {},
): World {
  const app = opts.app ?? "autolabels";
  const rows = registryRows();
  const base: Handler = (text) => {
    if (text.includes("FROM rtgip.delivery_config"))
      return [{ transport_enabled: true, local_app: app }];
    if (text.includes("FROM rtgip.connections")) return rows.conns;
    if (text.includes("FROM rtgip.signing_keys"))
      return rows.keys.map((k) => ({ ...(k as object), ...ar1Path(k, app) }));
    return undefined;
  };
  const handler: Handler = (text, params) => opts.db?.(text, params) ?? base(text, params);
  const made = fakeSql(handler);
  const sqlFactory = vi.fn(() => made.sql);
  const fetchFn = vi.fn(
    async () => new Response(JSON.stringify({ receipts: [] }), { status: 200 }),
  );
  const adapter = {
    produce: vi.fn(async () => []),
    apply: vi.fn(async () => ({ ok: true, reason: "applied" })),
  };
  const authorize = vi.fn<PublishAuthorizer>(async () => ({ ok: true }));
  const envMap: Record<string, string | undefined> = {
    RTGIP2_RUNTIME_MODE: "staging",
    SUPABASE_URL: `https://${STAGING}.supabase.co`,
    SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
    RTGIP2_GATEWAY_URL: GATEWAY,
    SUPABASE_ANON_KEY: "anon-key-for-tests-only",
    ...opts.env,
  };
  const cfg: AppRuntimeConfig = {
    app,
    compiledEnabled: true,
    stagingRef: STAGING,
    gatewayOrigins: [GATEWAY],
    adapter: adapter as unknown as RuntimeAdapter,
    publish: { kinds: ["fact_a", "fact_b"], refKeys: ["record_id", "other_id"], authorize },
    env: (n) => envMap[n],
    sql: sqlFactory as unknown as () => Sql,
    fetch: fetchFn as unknown as typeof fetch,
    now: () => T0 * 1000,
    getUser: async (t) => (t === TOKEN ? { id: USER } : null),
    ...over,
  };
  return { cfg, calls: made.calls, sqlFactory, fetch: fetchFn, adapter, authorize, end: made.end };
}

const post = (body: BodyInit | null = "{}", headers: Record<string, string> = {}) =>
  new Request("https://fn.test/", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
const bearer = (v: string) => ({ authorization: `Bearer ${v}` });
const reason = async (r: Response) => ((await r.json()) as { reason?: string }).reason;

const ENTRIES = ["inbound", "dispatch", "publish"] as const;
const headersFor = (e: (typeof ENTRIES)[number]) =>
  e === "dispatch" ? bearer(SERVICE_KEY) : e === "publish" ? bearer(TOKEN) : {};

describe("the five-step gate", () => {
  for (const entry of ENTRIES) {
    describe(entry, () => {
      const call = (w: World) => createAppRuntime(w.cfg)[entry](post("{}", headersFor(entry)));

      it("step 1: the compiled literal off refuses before anything else is read", async () => {
        const w = world(
          { compiledEnabled: false },
          { env: { RTGIP2_RUNTIME_MODE: "off", SUPABASE_URL: "https://x.supabase.co" } },
        );
        const req = post("{}", headersFor(entry));
        const r = await createAppRuntime(w.cfg)[entry](req);
        expect(r.status).toBe(503);
        expect(await reason(r)).toBe("RTGIP2_NOT_ACTIVATED");
        expect(req.bodyUsed).toBe(false);
        expect(w.sqlFactory).not.toHaveBeenCalled();
        expect(w.fetch).not.toHaveBeenCalled();
      });

      it("step 1: only the boolean true passes the literal", async () => {
        for (const v of ["true", 1, "yes", undefined] as unknown[]) {
          const w = world({ compiledEnabled: v as boolean });
          expect(await reason(await call(w))).toBe("RTGIP2_NOT_ACTIVATED");
        }
      });

      it("step 2: the mode must be exactly staging", async () => {
        for (const mode of [undefined, "", "off", "production", "Staging", "staging ", "true"]) {
          const w = world({}, { env: { RTGIP2_RUNTIME_MODE: mode } });
          const r = await call(w);
          expect(r.status).toBe(503);
          expect(await reason(r)).toBe("runtime_mode_off");
          expect(w.sqlFactory).not.toHaveBeenCalled();
        }
      });

      it("step 3: every production ref, lookalike and malformed URL is refused as not staging", async () => {
        const urls = [
          ...PRODUCTION_REFS.map((r) => `https://${r}.supabase.co`),
          ...PRODUCTION_REFS.map((r) => `https://${r}.supabase.co/rest/v1/`),
          `http://${STAGING}.supabase.co`,
          `https://${STAGING}.supabase.co.evil.test`,
          `https://evil.test/${STAGING}.supabase.co`,
          `https://user:pw@${STAGING}.supabase.co`,
          `https://${STAGING}.supabase.co:8443`,
          `https://x${STAGING}.supabase.co`,
          "not a url",
          "",
        ];
        for (const url of urls) {
          const w = world({}, { env: { SUPABASE_URL: url } });
          const r = await call(w);
          expect(r.status, url).toBe(503);
          expect(await reason(r), url).toBe("not_staging_backend");
          expect(w.sqlFactory).not.toHaveBeenCalled();
        }
        const none = world({}, { env: { SUPABASE_URL: undefined } });
        expect(await reason(await call(none))).toBe("not_staging_backend");
      });

      it("step 3: a malformed compiled ref refuses everything", async () => {
        for (const ref of ["", "short", "ABCDEFGHIJKLMNOPQRST", "abcdefghijklmnopqrst.evil"]) {
          const w = world(
            { stagingRef: ref },
            { env: { SUPABASE_URL: `https://${ref}.supabase.co` } },
          );
          expect(await reason(await call(w))).toBe("not_staging_backend");
        }
      });

      it("step 5: the database kill switch and local_app are the last word", async () => {
        const off = world(
          {},
          {
            db: (t) =>
              t.includes("delivery_config")
                ? [{ transport_enabled: false, local_app: "autolabels" }]
                : undefined,
          },
        );
        const r = await call(off);
        expect(r.status).toBe(503);
        expect(await reason(r)).toBe("transport_disabled");
        expect(off.end).toHaveBeenCalled();
        const missing = world({}, { db: (t) => (t.includes("delivery_config") ? [] : undefined) });
        expect(await reason(await call(missing))).toBe("transport_disabled");
        const wrong = world(
          {},
          {
            app: "autolabels",
            db: (t) =>
              t.includes("delivery_config")
                ? [{ transport_enabled: true, local_app: "autocurb" }]
                : undefined,
          },
        );
        expect(await reason(await call(wrong))).toBe("local_app_mismatch");
        const unset = world(
          {},
          {
            db: (t) =>
              t.includes("delivery_config")
                ? [{ transport_enabled: true, local_app: null }]
                : undefined,
          },
        );
        expect(await reason(await call(unset))).toBe("local_app_mismatch");
        const truthy = world(
          {},
          {
            db: (t) =>
              t.includes("delivery_config")
                ? [{ transport_enabled: "t", local_app: "autolabels" }]
                : undefined,
          },
        );
        expect(await reason(await call(truthy))).toBe("transport_disabled");
        const broken = world(
          {},
          {
            db: (t) => {
              if (t.includes("delivery_config")) throw new Error("connection refused");
              return undefined;
            },
          },
        );
        expect(await reason(await call(broken))).toBe("db_unavailable");
      });
    });
  }

  it("the gates run in order: literal, mode, backend, gateway, then the database", async () => {
    const all = world(
      { compiledEnabled: false, gatewayOrigins: [] },
      { env: { RTGIP2_RUNTIME_MODE: "off", SUPABASE_URL: "https://x.supabase.co" } },
    );
    expect(await reason(await createAppRuntime(all.cfg).dispatch(post()))).toBe(
      "RTGIP2_NOT_ACTIVATED",
    );
    const mode = world(
      { gatewayOrigins: [] },
      { env: { RTGIP2_RUNTIME_MODE: "off", SUPABASE_URL: "https://x.supabase.co" } },
    );
    expect(await reason(await createAppRuntime(mode.cfg).dispatch(post()))).toBe(
      "runtime_mode_off",
    );
    const backend = world(
      { gatewayOrigins: [] },
      { env: { SUPABASE_URL: "https://x.supabase.co" } },
    );
    expect(await reason(await createAppRuntime(backend.cfg).dispatch(post()))).toBe(
      "not_staging_backend",
    );
    const gw = world({ gatewayOrigins: [] });
    expect(await reason(await createAppRuntime(gw.cfg).dispatch(post()))).toBe(
      "gateway_origin_not_allowed",
    );
    expect(gw.sqlFactory).not.toHaveBeenCalled();
  });

  describe("step 4: the Gateway origin (dispatch only)", () => {
    const run = (env: Record<string, string | undefined>, over: Partial<AppRuntimeConfig> = {}) => {
      const w = world(over, { env });
      return createAppRuntime(w.cfg)
        .dispatch(post("{}", bearer(SERVICE_KEY)))
        .then(async (r) => ({ r, w, why: await reason(r) }));
    };

    it("an empty compiled allowlist refuses every dispatch", async () => {
      const { r, w, why } = await run({}, { gatewayOrigins: [] });
      expect(r.status).toBe(503);
      expect(why).toBe("gateway_origin_not_allowed");
      expect(w.sqlFactory).not.toHaveBeenCalled();
    });

    it("refuses an origin that is not listed, an http origin, credentials and malformed values", async () => {
      for (const url of [
        "https://other.example.test",
        "https://gateway.staging.example.test.evil.test",
        "https://gateway.staging.example.test:8443",
        "http://gateway.staging.example.test",
        "https://user:pw@gateway.staging.example.test",
        "ftp://gateway.staging.example.test",
        "gateway.staging.example.test",
        "",
        undefined,
      ]) {
        const { why, w } = await run({ RTGIP2_GATEWAY_URL: url });
        expect(why, String(url)).toBe("gateway_origin_not_allowed");
        expect(w.sqlFactory).not.toHaveBeenCalled();
      }
    });

    it("http is reachable only when the test file lifts gatewayHttpsOnly for a loopback stub", async () => {
      const stub = "http://127.0.0.1:9";
      expect((await run({ RTGIP2_GATEWAY_URL: stub }, { gatewayOrigins: [stub] })).why).toBe(
        "gateway_origin_not_allowed",
      );
      expect(
        (
          await run(
            { RTGIP2_GATEWAY_URL: stub },
            { gatewayOrigins: [stub], gatewayHttpsOnly: false },
          )
        ).r.status,
      ).toBe(200);
    });

    it("inbound and publish do not consult the Gateway allowlist", async () => {
      const w = world({ gatewayOrigins: [] }, { env: { RTGIP2_GATEWAY_URL: undefined } });
      expect(
        await reason(
          await createAppRuntime(w.cfg).inbound(post("{}", { "content-type": "text/plain" })),
        ),
      ).toBe("unsupported_media_type");
    });
  });
});

describe("rtgip-dispatch", () => {
  const run = (
    headers: Record<string, string>,
    over: Partial<AppRuntimeConfig> = {},
    env: Record<string, string | undefined> = {},
  ) => {
    const w = world(over, { env });
    return createAppRuntime(w.cfg)
      .dispatch(post("{}", headers))
      .then((r) => ({ r, w }));
  };

  it("refuses every bearer that is not the service role key, before touching the database", async () => {
    const cases: Record<string, string>[] = [
      {},
      bearer(""),
      bearer("wrong"),
      bearer(SERVICE_KEY + "x"),
      bearer(SERVICE_KEY.slice(1)),
      { authorization: SERVICE_KEY },
      { authorization: `Basic ${SERVICE_KEY}` },
      { authorization: `bearer ${SERVICE_KEY}` },
      { apikey: SERVICE_KEY },
      { "x-service-key": SERVICE_KEY },
    ];
    for (const h of cases) {
      const { r, w } = await run(h);
      expect(r.status, JSON.stringify(h)).toBe(401);
      expect(await reason(r)).toBe("unauthorized");
      expect(w.sqlFactory).not.toHaveBeenCalled();
    }
  });

  it("refuses when the service role key is not configured, even for an empty bearer", async () => {
    for (const h of [bearer("anything"), { authorization: "Bearer " }]) {
      const { r } = await run(h, {}, { SUPABASE_SERVICE_ROLE_KEY: undefined });
      expect(r.status).toBe(401);
    }
  });

  describe("the dedicated dispatch token", () => {
    const TOKEN32 = "d".repeat(31) + "1";

    it("accepts RTGIP2_DISPATCH_TOKEN as the bearer when it is set and at least 32 characters", async () => {
      const { r, w } = await run(bearer(TOKEN32), {}, { RTGIP2_DISPATCH_TOKEN: TOKEN32 });
      expect(r.status).toBe(200);
      expect(w.calls.some((c) => c.text.includes("SET LOCAL ROLE rtgip_dispatcher"))).toBe(true);
    });

    it("still accepts the service role key when a token is configured", async () => {
      const { r } = await run(bearer(SERVICE_KEY), {}, { RTGIP2_DISPATCH_TOKEN: TOKEN32 });
      expect(r.status).toBe(200);
    });

    it("refuses a wrong or shortened token before touching the database", async () => {
      for (const h of [
        bearer(TOKEN32 + "x"),
        bearer(TOKEN32.slice(1)),
        bearer("wrong"),
        { authorization: TOKEN32 },
      ]) {
        const { r, w } = await run(h, {}, { RTGIP2_DISPATCH_TOKEN: TOKEN32 });
        expect(r.status, JSON.stringify(h)).toBe(401);
        expect(w.sqlFactory).not.toHaveBeenCalled();
      }
    });

    it("ignores a configured token shorter than 32 characters", async () => {
      const short = "s".repeat(31);
      const { r, w } = await run(bearer(short), {}, { RTGIP2_DISPATCH_TOKEN: short });
      expect(r.status).toBe(401);
      expect(w.sqlFactory).not.toHaveBeenCalled();
    });

    it("refuses an empty bearer when the token is unset", async () => {
      for (const h of [{ authorization: "Bearer " }, bearer("")]) {
        const { r } = await run(h, {}, { RTGIP2_DISPATCH_TOKEN: undefined });
        expect(r.status).toBe(401);
      }
    });
  });

  it("accepts the service role key and answers an empty pass as an empty list", async () => {
    const { r, w } = await run(bearer(SERVICE_KEY));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual([]);
    expect(w.calls.some((c) => c.text.includes("SET LOCAL ROLE rtgip_dispatcher"))).toBe(true);
    expect(w.end).toHaveBeenCalled();
  });

  it("refuses when this app has no current signing key, without leasing anything", async () => {
    const w = world({}, { db: (t) => (t.includes("signing_keys") ? [] : undefined) });
    const r = await createAppRuntime(w.cfg).dispatch(post("{}", bearer(SERVICE_KEY)));
    expect(await reason(r)).toBe("no_signing_key");
    expect(w.calls.some((c) => c.text.includes("outbox_claim"))).toBe(false);
  });

  async function leased(
    action: "deliver" | "confirm",
    fetchImpl: AppRuntimeConfig["fetch"],
    advanceResult = "gateway_admitted",
  ) {
    const sealed = await sealEnvelope(
      draftEnvelope("autolabels", "autocurb", "vehicle.identity_registered"),
    );
    const row = {
      event_id: sealed.envelope.event_id,
      body: sealed.body,
      envelope: sealed.envelope,
      delivery_id: "d".repeat(64),
      lease_generation: 3,
      lease_action: action,
    };
    const w = world(
      { fetch: fetchImpl },
      {
        db: (t) => {
          if (t.includes("outbox_claim")) return [row];
          if (t.includes("outbox_advance")) return [{ r: advanceResult }];
          if (t.includes("FROM rtgip.outbox WHERE event_id"))
            return [{ state: "gateway_admitted" }];
          return undefined;
        },
      },
    );
    const r = await createAppRuntime(w.cfg).dispatch(post("{}", bearer(SERVICE_KEY)));
    return { r, w, sealed, row };
  }

  it("delivers to the real Gateway path with a signed envelope, a timeout and redirect error", async () => {
    const f = vi.fn(
      async () => new Response(JSON.stringify({ receipts: [{ kind: "x" }] }), { status: 200 }),
    );
    const { r, w, sealed } = await leased("deliver", f as unknown as typeof fetch);
    expect(r.status).toBe(200);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${GATEWAY}/api/rtgip/v2/deliver`);
    expect(init.redirect).toBe("error");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.body).toBe(sealed.body);
    const h = init.headers as Record<string, string>;
    expect(h["rtgip-signer"]).toBe("autolabels");
    expect(h["rtgip-key-id"]).toBe("al-dev-1");
    expect(h["rtgip-signature"]).toMatch(/^rtgip2=[0-9a-f]{64}$/);
    const advance = w.calls.find((c) => c.text.includes("outbox_advance"))!;
    expect(advance.params.slice(0, 3)).toEqual([
      sealed.envelope.event_id,
      expect.stringMatching(/^dispatch-/),
      3,
    ]);
    expect(await r.json()).toMatchObject([
      {
        action: "deliver",
        http_status: 200,
        advanced: ["gateway_admitted"],
        state: "gateway_admitted",
      },
    ]);
  });

  it("confirms with a signed receipt query on the real receipts path", async () => {
    const receipts = [
      { kind: "gateway_admission" },
      { kind: "target_inbox" },
      { kind: "gateway_confirmation" },
    ];
    const f = vi.fn(async () => new Response(JSON.stringify({ receipts }), { status: 200 }));
    const { w, row } = await leased("confirm", f as unknown as typeof fetch, "consumer_committed");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${GATEWAY}/api/rtgip/v2/receipts`);
    expect(init.redirect).toBe("error");
    expect(JSON.parse(init.body as string)).toMatchObject({
      delivery_id: row.delivery_id,
      event_id: row.event_id,
    });
    expect((init.headers as Record<string, string>)["rtgip-key-id"]).toBe("al-dev-1");
    expect(w.calls.some((c) => c.text.includes("outbox_fail"))).toBe(false);
    // AR-1 A1-2: only the Gateway-signed stages reach outbox_advance; target evidence is dropped.
    const advance = w.calls.find((c) => c.text.includes("outbox_advance"))!;
    expect(advance.params[3]).toEqual([
      canonicalize({ kind: "gateway_admission" }),
      canonicalize({ kind: "gateway_confirmation" }),
    ]);
  });

  it("treats a delivery_abandoned confirmation (outbox_advance -> dead_letter) as terminal: no outbox_fail", async () => {
    const receipts = [
      { kind: "gateway_admission" },
      { kind: "gateway_confirmation", outcome: "delivery_abandoned" },
    ];
    const f = vi.fn(
      async () =>
        new Response(JSON.stringify({ reason: null, receipts, target_evidence: [] }), {
          status: 200,
        }),
    );
    const { w } = await leased("confirm", f as unknown as typeof fetch, "dead_letter");
    expect(w.calls.filter((c) => c.text.includes("outbox_advance"))).toHaveLength(1);
    expect(w.calls.some((c) => c.text.includes("outbox_fail"))).toBe(false);
  });

  it("fails the lease with a retryable reason when the Gateway is unreachable, times out or redirects", async () => {
    for (const err of [
      new TypeError("fetch failed"),
      new DOMException("timed out", "TimeoutError"),
      new TypeError("redirect mode is set to error"),
    ]) {
      const f = vi.fn(async () => {
        throw err;
      });
      const { r, w } = await leased("deliver", f as unknown as typeof fetch);
      const fail = w.calls.find((c) => c.text.includes("outbox_fail"))!;
      expect(fail.params[3]).toBe("gateway_unreachable");
      expect(await r.json()).toMatchObject([{ http_status: 0, reason: "gateway_unreachable" }]);
    }
  });

  it("maps a Gateway refusal to the refusal policy reason and never advances on it", async () => {
    const f = vi.fn(
      async () =>
        new Response(JSON.stringify({ reason: "mapping_scope_mismatch" }), { status: 403 }),
    );
    const { w } = await leased("deliver", f as unknown as typeof fetch);
    expect(w.calls.some((c) => c.text.includes("outbox_advance"))).toBe(false);
    expect(w.calls.find((c) => c.text.includes("outbox_fail"))!.params[3]).toBe(
      "refused:403:mapping_scope_mismatch",
    );
  });

  it("treats a non-JSON Gateway answer as an empty one", async () => {
    const f = vi.fn(async () => new Response("<html>bad gateway</html>", { status: 502 }));
    const { w } = await leased("deliver", f as unknown as typeof fetch);
    expect(w.calls.find((c) => c.text.includes("outbox_fail"))!.params[3]).toBe("http_502");
  });
});

describe("rtgip-inbound", () => {
  const run = (req: Request, over: Partial<AppRuntimeConfig> = {}, db?: Handler) => {
    const w = world(over, { db });
    return createAppRuntime(w.cfg)
      .inbound(req)
      .then((r) => ({ r, w }));
  };

  it("takes POST only", async () => {
    const { r } = await run(new Request("https://fn.test/", { method: "GET" }));
    expect(r.status).toBe(405);
  });

  it("requires application/json", async () => {
    for (const ct of ["text/plain", "application/jsonx", ""]) {
      const { r } = await run(post("{}", { "content-type": ct }));
      expect(r.status, ct).toBe(415);
    }
    expect(
      (await run(post("{}", { "content-type": "Application/JSON; charset=utf-8" }))).r.status,
    ).toBe(400);
  });

  it("refuses an oversize body (declared or streamed), a byte-order mark and invalid UTF-8", async () => {
    const big = "x".repeat(70_000);
    expect((await run(post(big, { "content-length": String(big.length) }))).r.status).toBe(413);
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new Uint8Array(40_000));
        c.enqueue(new Uint8Array(40_000));
        c.close();
      },
    });
    expect(
      (
        await run(
          new Request("https://fn.test/", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: stream,
            duplex: "half",
          } as RequestInit),
        )
      ).r.status,
    ).toBe(413);
    const bom = await run(post(new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d])));
    expect(bom.r.status).toBe(400);
    expect(await reason(bom.r)).toBe("bom_not_allowed");
    const bad = await run(post(new Uint8Array([0x7b, 0xff, 0x7d])));
    expect(await reason(bad.r)).toBe("invalid_utf8");
  });

  it("answers a delivery without the admission receipt as malformed, without touching the inbox", async () => {
    const { r, w } = await run(post("{}"));
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ reason: "admission_receipt_malformed", receipts: [] });
    expect(w.calls.some((c) => c.text.includes("inbox_admit"))).toBe(false);
  });

  it("refuses to answer when this app has no current key to sign receipts with", async () => {
    const { r } = await run(post("{}"), {}, (t) => (t.includes("signing_keys") ? [] : undefined));
    expect(await reason(r)).toBe("no_receipt_key");
  });

  it("leaves a key out when its Vault secret is missing or malformed (fails closed)", async () => {
    const rows = registryRows();
    const strip = (k: unknown) => ({ ...(k as object), ...ar1Path(k, "autolabels"), secret: null });
    for (const secret of [null, undefined, "", "short", 42]) {
      const { r } = await run(post("{}"), {}, (t) =>
        t.includes("signing_keys") ? rows.keys.map((k) => ({ ...strip(k), secret })) : undefined,
      );
      expect(await reason(r), String(secret)).toBe("no_receipt_key");
    }
  });

  it("ignores keys outside their validity window and revoked ones", async () => {
    const rows = registryRows();
    const stale = rows.keys.map((k) => ({
      ...(k as object),
      ...ar1Path(k, "autolabels"),
      not_after: String(T0 - 10),
    }));
    const { r } = await run(post("{}"), {}, (t) =>
      t.includes("signing_keys") ? stale : undefined,
    );
    expect(await reason(r)).toBe("no_receipt_key");
  });

  it("never echoes an internal error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { r } = await run(post("{}"), {}, (t) => {
      if (t.includes("rtgip.connections"))
        throw new Error("password authentication failed for user secretuser");
      return undefined;
    });
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).toBe('{"reason":"internal_error"}');
  });
});

describe("rtgip-publish", () => {
  const publish = (
    body: unknown,
    headers: Record<string, string> = bearer(TOKEN),
    over: Partial<AppRuntimeConfig> = {},
    db?: Handler,
  ) => {
    const w = world(over, { db });
    return createAppRuntime(w.cfg)
      .publish(post(typeof body === "string" ? body : JSON.stringify(body), headers))
      .then((r) => ({ r, w }));
  };
  const good = {
    kind: "fact_a",
    tenant_id: "tenant-1",
    rooftop_id: "rf-1",
    ref: { record_id: "rec-1" },
  };

  it("refuses a caller with no user: no token, a malformed header, an unknown token", async () => {
    for (const h of [
      {},
      { authorization: "Bearer" },
      { authorization: "Basic abc" },
      bearer("not-a-valid-token"),
      { authorization: `Bearer ${TOKEN} extra` },
    ]) {
      const { r, w } = await publish(good, h);
      expect(r.status, JSON.stringify(h)).toBe(401);
      expect(await reason(r)).toBe("unauthenticated");
      expect(w.authorize).not.toHaveBeenCalled();
      expect(w.adapter.produce).not.toHaveBeenCalled();
    }
  });

  it("reads the user id from the verified token, never from the body", async () => {
    const { w } = await publish({
      ...good,
      user_id: "22222222-2222-4222-8222-222222222222",
      sub: "x",
      actor: "y",
    });
    expect(w.authorize).toHaveBeenCalledTimes(1);
    expect(w.authorize.mock.calls[0]![1]).toBe(USER);
  });

  it("refuses a user outside the tenant and a rooftop that is not mapped, and produces nothing", async () => {
    for (const why of ["not_a_member", "rooftop_unmapped", "role_not_permitted"]) {
      const w = world();
      w.authorize.mockResolvedValueOnce({ ok: false, reason: why });
      const r = await createAppRuntime(w.cfg).publish(post(JSON.stringify(good), bearer(TOKEN)));
      expect(r.status).toBe(403);
      expect(await reason(r)).toBe(why);
      expect(w.adapter.produce).not.toHaveBeenCalled();
      expect(w.calls.some((c) => c.text.includes("outbox_enqueue"))).toBe(false);
    }
  });

  it("hides an authorizer reason that is not a plain code", async () => {
    const w = world();
    w.authorize.mockResolvedValueOnce({
      ok: false,
      reason: 'relation "tenant_members" does not exist',
    });
    expect(
      await reason(
        await createAppRuntime(w.cfg).publish(post(JSON.stringify(good), bearer(TOKEN))),
      ),
    ).toBe("forbidden");
  });

  it("runs the authorizer in a read-only transaction", async () => {
    const { w } = await publish(good);
    const i = w.calls.findIndex((c) => c.text === "SET TRANSACTION READ ONLY");
    expect(i).toBeGreaterThan(-1);
  });

  it("ignores caller-supplied envelope fields, targets, prices, VINs and unlisted ref keys", async () => {
    const sealed = await sealEnvelope(
      draftEnvelope("autolabels", "autocurb", "vehicle.identity_registered"),
    );
    const w = world(
      {},
      { db: (t) => (t.includes("outbox_enqueue") ? [{ r: "enqueued" }] : undefined) },
    );
    w.adapter.produce.mockResolvedValueOnce([{ envelope: sealed.envelope, body: sealed.body }]);
    const hostile = {
      ...good,
      envelope: { ...sealed.envelope, tenant_id: "other" },
      body: canonicalize({ evil: true }),
      target_app: "autofilm",
      targets: "autofilm",
      price: 1,
      vin: "1HGCM82633A004352",
      source_app: "autocurb",
      ref: {
        record_id: "rec-1",
        targets: "autofilm",
        emitted_at: "1999-01-01T00:00:00Z",
        prev_revision: "7",
        origin_event_id: "x",
        correlation_id: "y",
        vin: "V",
        price: "1",
        other_id: "rec-2",
      },
    };
    const r = await createAppRuntime(w.cfg).publish(post(JSON.stringify(hostile), bearer(TOKEN)));
    expect(r.status).toBe(200);
    expect(w.adapter.produce).toHaveBeenCalledTimes(1);
    const [, kind, scope, ref] = w.adapter.produce.mock.calls[0]!;
    expect(kind).toBe("fact_a");
    expect(scope).toEqual({ tenant_id: "tenant-1", rooftop_id: "rf-1" });
    expect(ref).toEqual({ record_id: "rec-1", other_id: "rec-2" });
    const enq = w.calls.find((c) => c.text.includes("outbox_enqueue"))!;
    expect(enq.params).toEqual([sealed.body]);
    expect(w.authorize.mock.calls[0]![2]).toEqual({
      kind: "fact_a",
      tenant_id: "tenant-1",
      rooftop_id: "rf-1",
      ref: { record_id: "rec-1", other_id: "rec-2" },
    });
  });

  it("enqueues as rtgip_outbox_writer in one transaction and reports each result", async () => {
    const a = await sealEnvelope(
      draftEnvelope("autolabels", "autocurb", "vehicle.identity_registered"),
    );
    const b = await sealEnvelope(
      draftEnvelope("autolabels", "autoframe", "vehicle.identity_registered"),
    );
    const w = world(
      {},
      { db: (t) => (t.includes("outbox_enqueue") ? [{ r: "enqueued" }] : undefined) },
    );
    w.adapter.produce.mockResolvedValueOnce([a, b]);
    const r = await createAppRuntime(w.cfg).publish(post(JSON.stringify(good), bearer(TOKEN)));
    expect(await r.json()).toEqual({
      results: [
        { event_id: a.envelope.event_id, target_app: "autocurb", result: "enqueued" },
        { event_id: b.envelope.event_id, target_app: "autoframe", result: "enqueued" },
      ],
    });
    const role = w.calls.findIndex((c) => c.text === "SET LOCAL ROLE rtgip_outbox_writer");
    const enq = w.calls.findIndex((c) => c.text.includes("outbox_enqueue"));
    expect(role).toBeGreaterThan(-1);
    expect(enq).toBeGreaterThan(role);
  });

  it("validates the request shape", async () => {
    const cases: [unknown, number, string][] = [
      ["not json", 400, "bad_request"],
      [[1, 2], 400, "bad_request"],
      [{ ...good, kind: "unknown" }, 400, "unknown_kind"],
      [{ ...good, kind: 7 }, 400, "unknown_kind"],
      [{ ...good, tenant_id: "" }, 400, "bad_scope"],
      [{ ...good, tenant_id: "t".repeat(129) }, 400, "bad_scope"],
      [{ ...good, rooftop_id: 5 }, 400, "bad_scope"],
      [{ ...good, ref: { record_id: 5 } }, 400, "bad_ref"],
      [{ ...good, ref: { record_id: "" } }, 400, "bad_ref"],
    ];
    for (const [body, status, why] of cases) {
      const { r, w } = await publish(body);
      expect([r.status, await reason(r)], JSON.stringify(body)).toEqual([status, why]);
      expect(w.authorize).not.toHaveBeenCalled();
    }
  });

  it("maps producer errors to plain codes and never leaks a database error", async () => {
    const w = world();
    w.adapter.produce.mockRejectedValueOnce(new Error("ref_missing:episode_id"));
    expect(
      await reason(
        await createAppRuntime(w.cfg).publish(post(JSON.stringify(good), bearer(TOKEN))),
      ),
    ).toBe("ref_missing_episode_id");
    const pg = world();
    pg.adapter.produce.mockRejectedValueOnce(
      Object.assign(new Error("permission_denied"), { name: "PostgresError" }),
    );
    expect(
      await reason(
        await createAppRuntime(pg.cfg).publish(post(JSON.stringify(good), bearer(TOKEN))),
      ),
    ).toBe("produce_failed");
    const other = world();
    other.adapter.produce.mockRejectedValueOnce(
      new Error('relation "x" does not exist at 10.0.0.1'),
    );
    expect(
      await reason(
        await createAppRuntime(other.cfg).publish(post(JSON.stringify(good), bearer(TOKEN))),
      ),
    ).toBe("produce_failed");
  });

  it("reports an enqueue refusal by its SQL code and hides anything else", async () => {
    const a = await sealEnvelope(
      draftEnvelope("autolabels", "autocurb", "vehicle.identity_registered"),
    );
    const mk = (err: Error) => {
      const w = world(
        {},
        {
          db: (t) => {
            if (t.includes("outbox_enqueue")) throw err;
            return undefined;
          },
        },
      );
      w.adapter.produce.mockResolvedValueOnce([a]);
      return createAppRuntime(w.cfg).publish(post(JSON.stringify(good), bearer(TOKEN)));
    };
    expect(
      await reason(
        await mk(Object.assign(new Error("no_connection_for_event"), { name: "PostgresError" })),
      ),
    ).toBe("no_connection_for_event");
    expect(
      await reason(
        await mk(
          Object.assign(new Error("permission denied for function"), { name: "PostgresError" }),
        ),
      ),
    ).toBe("enqueue_failed");
    expect(await reason(await mk(new Error("no_connection_for_event")))).toBe("enqueue_failed");
  });

  describe("the default user lookup", () => {
    const withFetch = (impl: (url: string, init: RequestInit) => Promise<Response>) => {
      const f = vi.fn(impl);
      const w = world({ getUser: undefined, fetch: f as unknown as typeof fetch });
      return { f, w };
    };

    it("asks the project's own auth endpoint with the anon key and the caller's token", async () => {
      const { f, w } = withFetch(
        async () => new Response(JSON.stringify({ id: USER }), { status: 200 }),
      );
      const r = await createAppRuntime(w.cfg).publish(post(JSON.stringify(good), bearer(TOKEN)));
      expect(await reason(r)).toBe("nothing_to_publish");
      const [url, init] = f.mock.calls[0]!;
      expect(url).toBe(`https://${STAGING}.supabase.co/auth/v1/user`);
      expect(init.redirect).toBe("error");
      expect(init.headers).toEqual({
        authorization: `Bearer ${TOKEN}`,
        apikey: "anon-key-for-tests-only",
      });
      expect(w.authorize.mock.calls[0]![1]).toBe(USER);
    });

    it("treats a rejected, malformed or failing lookup as no user", async () => {
      for (const impl of [
        async () => new Response("{}", { status: 401 }),
        async () => new Response(JSON.stringify({ id: "not-a-uuid" }), { status: 200 }),
        async () => new Response("<html>", { status: 200 }),
        async () => {
          throw new TypeError("fetch failed");
        },
      ]) {
        const { w } = withFetch(impl);
        const r = await createAppRuntime(w.cfg).publish(post(JSON.stringify(good), bearer(TOKEN)));
        expect(r.status).toBe(401);
        expect(w.authorize).not.toHaveBeenCalled();
      }
    });

    it("has no user when the anon key is not in the environment", async () => {
      const f = vi.fn();
      const w = world(
        { getUser: undefined, fetch: f as unknown as typeof fetch },
        { env: { SUPABASE_ANON_KEY: undefined } },
      );
      expect(
        (await createAppRuntime(w.cfg).publish(post(JSON.stringify(good), bearer(TOKEN)))).status,
      ).toBe(401);
      expect(f).not.toHaveBeenCalled();
    });
  });
});

describe("AR-1 option 1: the runtime reads only its verification path", () => {
  const legacyRows = () => registryRows().keys.map((k) => ({ ...(k as object), audience: null }));
  const ar1Key = (key_id: string, owner: string, app: string) => ({
    ...(registryRows().keys.find((k) => (k as { owner: string }).owner === owner) as object),
    key_id,
    secret: `synthetic-ar1-${key_id}-0123456789abcdef`,
    audience: owner === "gateway" ? app : "gateway",
  });

  it("refuses to dispatch or answer when only the -1 rows (no audience) are present", async () => {
    const db: Handler = (t) => (t.includes("signing_keys") ? legacyRows() : undefined);
    const d = world({}, { db });
    expect(
      await reason(await createAppRuntime(d.cfg).dispatch(post("{}", bearer(SERVICE_KEY)))),
    ).toBe("no_signing_key");
    expect(d.calls.some((c) => c.text.includes("outbox_claim"))).toBe(false);
    const i = world({}, { db });
    expect(await reason(await createAppRuntime(i.cfg).inbound(post("{}")))).toBe("no_receipt_key");
  });

  it("signs with stg-<app>-2 while the current -1 row is still in the database", async () => {
    const sealed = await sealEnvelope(
      draftEnvelope("autolabels", "autocurb", "vehicle.identity_registered"),
    );
    const row = {
      event_id: sealed.envelope.event_id,
      body: sealed.body,
      envelope: sealed.envelope,
      delivery_id: "d".repeat(64),
      lease_generation: 1,
      lease_action: "deliver",
    };
    const f = vi.fn(async () => new Response(JSON.stringify({ receipts: [] }), { status: 200 }));
    const w = world(
      { fetch: f as unknown as typeof fetch },
      {
        db: (t) => {
          if (t.includes("signing_keys"))
            return [
              ...legacyRows(),
              ar1Key("stg-autolabels-2", "autolabels", "autolabels"),
              ar1Key("gw-autolabels-2", "gateway", "autolabels"),
              ar1Key("stg-autocurb-2", "autocurb", "autocurb"),
            ];
          if (t.includes("outbox_claim")) return [row];
          if (t.includes("outbox_advance")) return [{ r: "retry_wait" }];
          if (t.includes("FROM rtgip.outbox WHERE event_id")) return [{ state: "retry_wait" }];
          return undefined;
        },
      },
    );
    const r = await createAppRuntime(w.cfg).dispatch(post("{}", bearer(SERVICE_KEY)));
    expect(r.status).toBe(200);
    const h = (f.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<
      string,
      string
    >;
    expect([h["rtgip-key-id"], h["rtgip-signer"]]).toEqual(["stg-autolabels-2", "autolabels"]);
  });

  it("refuses a forward signed with the -1 Gateway key that is still in the database", async () => {
    const sealed = await sealEnvelope(
      draftEnvelope("autocurb", "autolabels", "appraisal.completed"),
    );
    const legacyGw = syntheticRegistry().keys.find((k) => k.key_id === "gw-dev-1")!;
    const signed = (await signEnvelope(
      sealed.body,
      sealed.envelope,
      legacyGw,
      T0,
      "ar1legacyforward0001",
    )) as unknown as Record<string, string>;
    const w = world(
      {},
      {
        db: (t) =>
          t.includes("signing_keys")
            ? [
                ...legacyRows(),
                ar1Key("stg-autolabels-2", "autolabels", "autolabels"),
                ar1Key("gw-autolabels-2", "gateway", "autolabels"),
              ]
            : undefined,
      },
    );
    const r = await createAppRuntime(w.cfg).inbound(post(sealed.body, signed));
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(w.calls.some((c) => c.text.includes("inbox_admit"))).toBe(false);
    expect(w.adapter.apply).not.toHaveBeenCalled();
  });
});

describe("envelope types", () => {
  it("keeps the test helper aligned with the sealed envelope shape", async () => {
    const sealed = await sealEnvelope(
      draftEnvelope("autolabels", "autocurb", "vehicle.identity_registered"),
    );
    const e: EnvelopeV2 = sealed.envelope;
    expect(canonicalize(e)).toBe(sealed.body);
  });
});
