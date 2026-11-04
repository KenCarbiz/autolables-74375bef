import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  createKeyImport,
  keySecretName,
  KEY_IMPORT_IDS,
  type KeyImportConfig,
  type Sql,
} from "./key-import.ts";

const REF = "uakiwvigsmrlyfpsalai";
const PRODUCTION_REFS = ["onnbmmdbrsgytfozfozn", "ptiwdwfdckfqivoocyvp", "eabnaohpjuewhwrfhkun"];
const OTHER_STAGING = ["zzwuxpbxkfxgtrnfxgia", "mubzldoczujeoatzdwko", "ldlmkelrxlfmrhdrtvqn"];
const SECRET = "5e".repeat(32);
const FP = createHash("sha256").update(SECRET).digest("hex");
const TICKET = "0b7a2f4e-8c1d-4e5f-9a6b-1c2d3e4f5a6b";
const TOKEN = "a1".repeat(32);

type Call = { text: string; params?: unknown[] };
function fakeSql(answer: (text: string, params: unknown[] | undefined) => unknown[] | Error) {
  const calls: Call[] = [];
  const end = vi.fn(async () => {});
  const sql = {
    begin: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        unsafe: async (text: string, params?: unknown[]) => {
          calls.push({ text, params });
          const r = answer(text, params);
          if (r instanceof Error) throw r;
          return r;
        },
      }),
    end,
  };
  return { calls, end, factory: vi.fn(() => sql as unknown as Sql) };
}

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("https://fn.test/", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

function make(over: Partial<KeyImportConfig> & { envMap?: Record<string, string> } = {}) {
  const envMap: Record<string, string> = {
    SUPABASE_URL: `https://${REF}.supabase.co`,
    ...over.envMap,
  };
  const env = vi.fn((n: string) => envMap[n]);
  const db = fakeSql((text) => {
    if (text.includes("key_import_claim"))
      return [{ status: "claimed", key_id: "stg-autolabels-1", fingerprint: FP }];
    if (text.includes("key_import_finish")) return [{ r: "imported" }];
    return [];
  });
  const ki = createKeyImport({
    compiledEnabled: true,
    stagingRef: REF,
    env,
    sql: db.factory,
    ...over,
  });
  return { ki, env, db };
}

const readBody = async (r: Response) => ({ status: r.status, text: await r.text() });

describe("key import gates, before any body, secret or database", () => {
  it("refuses everything while the compiled literal is off", async () => {
    const { ki, env, db } = make({
      compiledEnabled: false,
      envMap: { [keySecretName("stg-autolabels-1")]: SECRET },
    });
    const r = await readBody(await ki.handle(post({ ticket_id: TICKET, token: TOKEN })));
    expect(r).toEqual({
      status: 503,
      text: JSON.stringify({ reason: "RTGIP2_KEY_IMPORT_NOT_ACTIVATED" }),
    });
    expect(db.factory).not.toHaveBeenCalled();
    expect(env).not.toHaveBeenCalled();
  });

  it("refuses every production backend, every other staging backend and malformed URLs", async () => {
    for (const url of [
      ...PRODUCTION_REFS.map((r) => `https://${r}.supabase.co`),
      ...OTHER_STAGING.map((r) => `https://${r}.supabase.co`),
      "",
      `http://${REF}.supabase.co`,
      `https://u:p@${REF}.supabase.co`,
      `https://${REF}.supabase.co.evil.test`,
    ]) {
      const { ki, db } = make({ envMap: { SUPABASE_URL: url } });
      const r = await ki.handle(post({ ticket_id: TICKET, token: TOKEN }));
      expect([url, r.status, ((await r.json()) as { reason: string }).reason]).toEqual([
        url,
        503,
        "not_staging_backend",
      ]);
      expect(db.factory).not.toHaveBeenCalled();
    }
  });

  it("accepts only a small JSON POST with exactly ticket_id and token", async () => {
    const bad: Request[] = [
      new Request("https://fn.test/", { method: "GET" }),
      post({ ticket_id: TICKET, token: TOKEN }, { "content-type": "text/plain" }),
      post({ ticket_id: TICKET, token: TOKEN, key_id: "stg-autolabels-1" }),
      post({ ticket_id: TICKET }),
      post({ ticket_id: TICKET.toUpperCase(), token: TOKEN }),
      post({ ticket_id: TICKET, token: TOKEN.slice(1) }),
      post({ ticket_id: TICKET, token: TOKEN.toUpperCase() }),
      post({ ticket_id: TICKET, token: SECRET + "00" }),
      post([TICKET, TOKEN]),
      post("not json"),
      post(JSON.stringify({ ticket_id: TICKET, token: TOKEN, pad: "x".repeat(1100) })),
    ];
    for (const req of bad) {
      const { ki, db, env } = make();
      const r = await ki.handle(req);
      expect([r.status, ((await r.json()) as { reason: string }).reason]).toEqual([
        400,
        "bad_request",
      ]);
      expect(db.factory).not.toHaveBeenCalled();
      expect(env.mock.calls.map((c) => c[0])).toEqual(["SUPABASE_URL"]);
    }
  });
});

describe("key import flow", () => {
  it("imports: claim and finish each run as rtgip_key_importer under a 5 s statement timeout; the reply carries no secret", async () => {
    const { ki, db } = make({ envMap: { [keySecretName("stg-autolabels-1")]: SECRET } });
    const r = await readBody(await ki.handle(post({ ticket_id: TICKET, token: TOKEN })));
    expect(r.status).toBe(200);
    expect(JSON.parse(r.text)).toEqual({
      key_id: "stg-autolabels-1",
      outcome: "imported",
      fingerprint_verified: true,
    });
    expect(r.text).not.toContain(SECRET);
    expect(db.calls.map((c) => c.text)).toEqual([
      "SET LOCAL ROLE rtgip_key_importer",
      "SET LOCAL statement_timeout = '5s'",
      "SELECT status, key_id, fingerprint FROM rtgip.key_import_claim($1::uuid, $2::text)",
      "SET LOCAL ROLE rtgip_key_importer",
      "SET LOCAL statement_timeout = '5s'",
      "SELECT rtgip.key_import_finish($1::uuid, $2::text, $3::text, $4::text) AS r",
    ]);
    expect(db.calls[2]!.params).toEqual([TICKET, TOKEN]);
    expect(db.calls[5]!.params).toEqual([TICKET, TOKEN, SECRET, null]);
    expect(db.calls.filter((c) => c.text.includes(SECRET))).toEqual([]);
    expect(db.end).toHaveBeenCalledTimes(1);
  });

  it("a refused claim answers its code and never reads the key material", async () => {
    for (const status of [
      "key_import_ticket_unknown",
      "key_import_ticket_used",
      "key_import_token_mismatch",
      "key_import_unsafe_logging",
    ]) {
      const env = vi.fn((n: string) =>
        n === "SUPABASE_URL" ? `https://${REF}.supabase.co` : SECRET,
      );
      const db = fakeSql((text) =>
        text.includes("claim") ? [{ status, key_id: null, fingerprint: null }] : [],
      );
      const ki = createKeyImport({ compiledEnabled: true, stagingRef: REF, env, sql: db.factory });
      const r = await readBody(await ki.handle(post({ ticket_id: TICKET, token: TOKEN })));
      expect(r).toEqual({ status: 409, text: JSON.stringify({ reason: status }) });
      expect(env.mock.calls.map((c) => c[0])).toEqual(["SUPABASE_URL"]);
      expect(db.calls.some((c) => c.text.includes("finish"))).toBe(false);
      expect(db.end).toHaveBeenCalledTimes(1);
    }
  });

  it("a missing, malformed or mismatching secret is never sent: finish gets NULL and the local reason", async () => {
    const cases: [string | undefined, string][] = [
      [undefined, "key_import_secret_missing"],
      ["", "key_import_secret_missing"],
      [SECRET.toUpperCase(), "key_import_secret_malformed"],
      [SECRET + "\n", "key_import_secret_malformed"],
      ["short-dev-secret", "key_import_secret_malformed"],
      ["7f".repeat(32), "key_import_fingerprint_mismatch"],
    ];
    for (const [material, reason] of cases) {
      const envMap: Record<string, string> = { SUPABASE_URL: `https://${REF}.supabase.co` };
      if (material !== undefined) envMap[keySecretName("stg-autolabels-1")] = material;
      const db = fakeSql((text) =>
        text.includes("claim")
          ? [{ status: "claimed", key_id: "stg-autolabels-1", fingerprint: FP }]
          : text.includes("finish")
            ? [{ r: reason }]
            : [],
      );
      const ki = createKeyImport({
        compiledEnabled: true,
        stagingRef: REF,
        env: (n) => envMap[n],
        sql: db.factory,
      });
      const r = await readBody(await ki.handle(post({ ticket_id: TICKET, token: TOKEN })));
      expect([reason, r.status, JSON.parse(r.text)]).toEqual([
        reason,
        409,
        { key_id: "stg-autolabels-1", outcome: "refused", reason },
      ]);
      const fin = db.calls.find((c) => c.text.includes("finish"))!;
      expect(fin.params).toEqual([TICKET, TOKEN, null, reason]);
      if (material) expect(r.text).not.toContain(material.trim());
    }
  });

  it("a claim naming a key outside the approved list is refused without reading any material", async () => {
    const env = vi.fn((n: string) =>
      n === "SUPABASE_URL" ? `https://${REF}.supabase.co` : SECRET,
    );
    const db = fakeSql((text) =>
      text.includes("claim")
        ? [{ status: "claimed", key_id: "prod-autolabels-1", fingerprint: FP }]
        : [],
    );
    const ki = createKeyImport({ compiledEnabled: true, stagingRef: REF, env, sql: db.factory });
    const r = await readBody(await ki.handle(post({ ticket_id: TICKET, token: TOKEN })));
    expect(r).toEqual({ status: 409, text: JSON.stringify({ reason: "key_import_claim_failed" }) });
    expect(env.mock.calls.map((c) => c[0])).toEqual(["SUPABASE_URL"]);
  });

  it("database errors become fixed codes: no message, no bind parameters, no secret reach the reply", async () => {
    const leaky = Object.assign(new Error(`boom ${SECRET}`), {
      parameters: [TICKET, TOKEN, SECRET, null],
      query: "SELECT ...",
    });
    for (const at of ["claim", "finish", "connect"] as const) {
      const db = fakeSql((text) => {
        if (at === "claim" && text.includes("claim")) return leaky;
        if (text.includes("claim"))
          return [{ status: "claimed", key_id: "stg-autolabels-1", fingerprint: FP }];
        if (at === "finish" && text.includes("finish")) return leaky;
        return [];
      });
      const factory =
        at === "connect"
          ? vi.fn(() => {
              throw leaky;
            })
          : db.factory;
      const ki = createKeyImport({
        compiledEnabled: true,
        stagingRef: REF,
        env: (n) =>
          ({
            SUPABASE_URL: `https://${REF}.supabase.co`,
            [keySecretName("stg-autolabels-1")]: SECRET,
          })[n],
        sql: factory as unknown as () => Sql,
      });
      const r = await readBody(await ki.handle(post({ ticket_id: TICKET, token: TOKEN })));
      expect(r.text).not.toContain(SECRET);
      expect(r.text).not.toContain(TOKEN);
      expect(r.text).not.toContain("boom");
      expect(r.status).toBe(at === "connect" ? 500 : 409);
      expect(JSON.parse(r.text).reason).toBe("internal_error");
    }
  });

  it("writes nothing to the console on any path", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    try {
      const { ki } = make({ envMap: { [keySecretName("stg-autolabels-1")]: SECRET } });
      await ki.handle(post({ ticket_id: TICKET, token: TOKEN }));
      await ki.handle(post("nope"));
      const db = fakeSql(() => new Error(SECRET));
      await createKeyImport({
        compiledEnabled: true,
        stagingRef: REF,
        env: () => `https://${REF}.supabase.co`,
        sql: db.factory,
      }).handle(post({ ticket_id: TICKET, token: TOKEN }));
      for (const s of spies) expect(s).not.toHaveBeenCalled();
    } finally {
      for (const s of spies) s.mockRestore();
    }
  });
});

describe("key names", () => {
  it("derives the same Edge Function secret names the Gateway uses, for exactly the four staging keys", () => {
    expect(KEY_IMPORT_IDS.map(keySecretName)).toEqual([
      "RTGIP2_KEY_STG_GATEWAY_1",
      "RTGIP2_KEY_STG_AUTOLABELS_1",
      "RTGIP2_KEY_STG_AUTOCURB_1",
      "RTGIP2_KEY_STG_AUTOFRAME_1",
    ]);
  });
});
