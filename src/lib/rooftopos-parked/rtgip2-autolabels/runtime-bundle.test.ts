// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  APP_BINDINGS,
  GATEWAY_ORIGINS,
  PROJECT_REF,
  RTGIP2_APP_RUNTIME_ENABLED,
  RTGIP2_RUNTIME_MODE,
  createAppRuntime,
  createEntryRuntime,
  EDGE_DB_OPTIONS,
  edgeDbUrl,
} from "./runtime-entry.ts";
import { GATEWAY_ORIGIN_PLACEHOLDER } from "./runtime-config.ts";
import { keySecretName3, type Sql } from "../rtgip2-runtime/runtime.ts";

const root = (rel: string) => path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..", rel);
const read = (rel: string) => readFileSync(root(rel), "utf8");
const BUNDLE = "supabase/functions/_shared/rtgip2-runtime.bundle.js";
const PRODUCTION_REF = "onnbmmdbrsgytfozfozn";
const OTHER_PRODUCTION_REFS = ["ptiwdwfdckfqivoocyvp", "eabnaohpjuewhwrfhkun", "panlppkjvcctebnkalyz"];
const STAGING_REFS = ["uakiwvigsmrlyfpsalai", "zzwuxpbxkfxgtrnfxgia", "mubzldoczujeoatzdwko", "ldlmkelrxlfmrhdrtvqn"];
const COMPILED_LITERAL = true;
const ENV_NAMES = ["RTGIP2_DISPATCH_TOKEN", "RTGIP2_GATEWAY_URL", "RTGIP2_RUNTIME_MODE", "RTGIP3_ENABLED", "RTGIP3_KEY_ENV", "RTGIP3_KEY_PINS", "RTGIP3_VERIFIER_DIGEST", "RTGIP_EDGE_DB_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_URL"];

describe("the generated bundle", () => {
  it("rebuilds byte-identically from source, so the deployed artifact has one reproducible sha256", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "rtgip2-bundle-"));
    const builds = [0, 1].map((i) => {
      const out = path.join(dir, `bundle-${i}.js`);
      execFileSync(process.execPath, [root("scripts/rtgip2/build-runtime.mjs"), "--out", out], { cwd: root("."), stdio: "pipe", env: { ...process.env, RTGIP_PRODUCTION_GATEWAY_ORIGIN: "" } });
      return readFileSync(out, "utf8");
    });
    expect(builds[1]).toBe(builds[0]);
    expect(read(BUNDLE)).toBe(builds[0]);
    expect(createHash("sha256").update(read(BUNDLE)).digest("hex")).toMatch(/^[0-9a-f]{64}$/);
    execFileSync(process.execPath, [root("scripts/rtgip2/build-runtime.mjs"), "--check"], { cwd: root("."), stdio: "pipe", env: { ...process.env, RTGIP_PRODUCTION_GATEWAY_ORIGIN: "" } });
  }, 60_000);

  it("is plain JavaScript whose only external import is npm:postgres@3.4.5", () => {
    const text = read(BUNDLE);
    const imports = [...text.matchAll(/^import .*? from "([^"]+)";/gm)].map((m) => m[1]);
    expect(imports).toEqual(["npm:postgres@3.4.5"]);
    expect(text).not.toMatch(/from "postgres"|from "@\/|require\(|import\.meta/);
    expect(text).not.toContain("process.env");
  });

  it("reads only the platform environment names the gate and the entry need", () => {
    const names = new Set([...read(BUNDLE).matchAll(/\b(?:env|cfg\.env)\(\s*"([A-Z0-9_]+)"\s*\)/g)].map((m) => m[1]));
    expect([...names].sort()).toEqual(ENV_NAMES);
    expect(read(BUNDLE).match(/Deno\.env\.get\(/g)).toHaveLength(1);
  });

  it("names the rtgip/3 signing key secret by key id (RTGIP3_SIGNING_KEY_<KEY_ID>), as the Gateway does, and by nothing else", () => {
    const text = read(BUNDLE);
    expect(text.match(/RTGIP3_SIGNING_KEY_/g)).toHaveLength(1);
    expect(text).toContain("var keySecretName3 = (keyId) => `RTGIP3_SIGNING_KEY_${keyId.toUpperCase().replace(/[^A-Z0-9]/g, \"_\")}`;");
    expect(text).toMatch(/cfg\.env\(keySecretName3\(keyId\)\)/);
  });

  it("is built with the exact esbuild PROVENANCE.json records for this app", () => {
    const prov = JSON.parse(read("src/lib/rooftopos-parked/rtgip2-runtime/PROVENANCE.json")) as { bundle: { esbuild: Record<string, string> } };
    const esbuild = createRequire(root("scripts/rtgip2/build-runtime.mjs"))("esbuild/package.json") as { version: string };
    expect(esbuild.version).toBe(prov.bundle.esbuild[APP_BINDINGS.app]);
  });

  it("publishes its sha256 beside it: the rtgip/3 attestation verifier digest", () => {
    const text = read(BUNDLE);
    expect(read(`${BUNDLE}.sha256`)).toBe(`${createHash("sha256").update(text).digest("hex")}  rtgip2-runtime.bundle.js\n`);
  });

  it("carries the compiled production switches as plain constants and never the postgres owner URL", () => {
    const text = read(BUNDLE);
    expect(text).toContain(`var RTGIP2_APP_RUNTIME_ENABLED = ${COMPILED_LITERAL};`);
    expect(text).toContain('var RTGIP2_RUNTIME_MODE = "production";');
    expect(text).toContain(`var PROJECT_REF = "${PRODUCTION_REF}";`);
    expect(text).toContain(`var GATEWAY_ORIGIN_PLACEHOLDER = "${GATEWAY_ORIGIN_PLACEHOLDER}";`);
    expect(text).toContain("var GATEWAY_ORIGINS = GATEWAY_PRODUCTION_ORIGIN === GATEWAY_ORIGIN_PLACEHOLDER ? [] : [GATEWAY_PRODUCTION_ORIGIN];");
    expect(text).toContain("runtimeMode: RTGIP2_RUNTIME_MODE,");
    expect(text).not.toContain("SUPABASE_DB_URL");
    for (const ref of [...STAGING_REFS, ...OTHER_PRODUCTION_REFS]) expect(text).not.toContain(ref);
    expect(text).not.toMatch(/lovable\.app/);
  });

  it("takes the production Gateway origin only as a bare https origin at build time", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "rtgip2-origin-"));
    const out = path.join(dir, "bundle.js");
    const build = (origin: string) =>
      execFileSync(process.execPath, [root("scripts/rtgip2/build-runtime.mjs"), "--out", out], { cwd: root("."), stdio: "pipe", env: { ...process.env, RTGIP_PRODUCTION_GATEWAY_ORIGIN: origin } });
    build("https://gateway.example.com");
    expect(readFileSync(out, "utf8")).toContain('var GATEWAY_PRODUCTION_ORIGIN = true ? "https://gateway.example.com" : GATEWAY_ORIGIN_PLACEHOLDER;');
    for (const bad of ["http://gateway.example.com", "https://gateway.example.com/", "https://u:p@gateway.example.com", "https://x.invalid", "not a url"])
      expect(() => build(bad)).toThrow();
  }, 60_000);
});

describe("the compiled constants", () => {
  it("keep the literal at its committed state, production mode, the AutoLabels production ref and no usable Gateway origin yet", () => {
    expect(RTGIP2_APP_RUNTIME_ENABLED).toBe(COMPILED_LITERAL);
    expect(RTGIP2_RUNTIME_MODE).toBe("production");
    expect(APP_BINDINGS.runtimeMode).toBe("production");
    expect(PROJECT_REF).toBe(PRODUCTION_REF);
    expect(STAGING_REFS).not.toContain(PROJECT_REF);
    expect(GATEWAY_ORIGINS).toEqual([]);
    expect(new URL(GATEWAY_ORIGIN_PLACEHOLDER).hostname.endsWith(".invalid")).toBe(true);
  });
});

describe("the function entry files", () => {
  for (const fn of ["inbound", "dispatch", "publish"] as const) {
    it(`rtgip-${fn} passes the compiled literal and nothing else`, () => {
      const text = read(`supabase/functions/rtgip-${fn}/index.ts`);
      expect(text).toBe(
        `import {\n  RTGIP2_APP_RUNTIME_ENABLED,\n  createEntryRuntime,\n} from "../_shared/rtgip2-runtime.bundle.js";\n\n` +
          `const runtime = createEntryRuntime({ compiledEnabled: RTGIP2_APP_RUNTIME_ENABLED });\n\n` +
          `Deno.serve((req: Request) => runtime.${fn}(req));\n`,
      );
      expect(text).not.toMatch(/Deno\.env|searchParams|headers|\btrue\b|\bfalse\b|process/);
    });
  }

  it("are registered in config.toml with the intended JWT policy", () => {
    const toml = read("supabase/config.toml");
    const table = (name: string) => new RegExp(`\\[functions\\.${name}\\]\\s*\\nverify_jwt = (true|false)`).exec(toml)?.[1];
    expect([table("rtgip-inbound"), table("rtgip-dispatch"), table("rtgip-publish")]).toEqual(["false", "false", "true"]);
  });

  it("the exported entry factory takes exactly one switch", () => {
    expect(createEntryRuntime.length).toBe(1);
    expect(read("src/lib/rooftopos-parked/rtgip2-autolabels/runtime-entry.ts")).toMatch(/createEntryRuntime\(opts: \{ compiledEnabled: boolean \}\)/);
  });
});

describe("the entry runtime with the real constants", () => {
  const platform = (env: Record<string, string>) => {
    (globalThis as unknown as { Deno: unknown }).Deno = { env: { get: (n: string) => env[n] } };
  };
  afterEach(() => {
    delete (globalThis as unknown as { Deno?: unknown }).Deno;
  });
  const prodEnv: Record<string, string> = {
    RTGIP2_RUNTIME_MODE: "production",
    SUPABASE_URL: `https://${PRODUCTION_REF}.supabase.co`,
    SUPABASE_SERVICE_ROLE_KEY: "k".repeat(24),
    RTGIP_EDGE_DB_URL: "postgres://rtgip_edge@127.0.0.1:1/none",
  };
  const noDb = (() => {
    throw new Error("the database must not be reached");
  }) as unknown as () => Sql;
  const runtime = (env: Record<string, string | undefined>, sql: () => Sql = noDb) =>
    createAppRuntime({ ...APP_BINDINGS, compiledEnabled: true, stagingRef: PROJECT_REF, gatewayOrigins: GATEWAY_ORIGINS, env: (n) => env[n], sql });
  const reason = async (r: Response) => [r.status, ((await r.json()) as { reason: string }).reason];
  const post = (headers: Record<string, string> = {}) => new Request("https://fn.test/", { method: "POST", headers, body: "{}" });

  it("refuses every entry point when the compiled literal is off, whatever the environment says", async () => {
    platform(prodEnv);
    const rt = createEntryRuntime({ compiledEnabled: false });
    for (const call of [rt.inbound, rt.dispatch, rt.publish])
      expect(await reason(await call(post({ authorization: `Bearer ${prodEnv.SUPABASE_SERVICE_ROLE_KEY}` })))).toEqual([503, "RTGIP2_NOT_ACTIVATED"]);
  });

  it("stays dark until RTGIP2_RUNTIME_MODE is exactly production: unset, staging or anything else is runtime_mode_off", async () => {
    for (const m of [undefined, "staging", "Production", "production ", "prod"]) {
      const rt = runtime({ ...prodEnv, RTGIP2_RUNTIME_MODE: m });
      for (const call of [rt.inbound, rt.dispatch, rt.publish]) expect(await reason(await call(post()))).toEqual([503, "runtime_mode_off"]);
    }
  });

  it("can never answer on a staging backend or another app's production backend, even in production mode", async () => {
    const connect = vi.fn(noDb);
    for (const ref of [...STAGING_REFS, ...OTHER_PRODUCTION_REFS]) {
      const rt = runtime({ ...prodEnv, SUPABASE_URL: `https://${ref}.supabase.co` }, connect);
      for (const call of [rt.inbound, rt.dispatch, rt.publish])
        expect([ref, ...(await reason(await call(post())))]).toEqual([ref, 503, "not_production_backend"]);
    }
    expect(connect).not.toHaveBeenCalled();
  });

  it("refuses dispatch to any Gateway while the compiled origin is the placeholder", async () => {
    for (const g of ["https://gateway.example.test", GATEWAY_ORIGIN_PLACEHOLDER, "https://rooftopos-gateway-staging.lovable.app"]) {
      const rt = runtime({ ...prodEnv, RTGIP2_GATEWAY_URL: g });
      expect(await reason(await rt.dispatch(post({ authorization: `Bearer ${prodEnv.SUPABASE_SERVICE_ROLE_KEY}` })))).toEqual([503, "gateway_origin_not_allowed"]);
    }
  });

  it("refuses every rtgip/2 or unlabelled delivery with 403 protocol_not_accepted before reading a key or the Vault", async () => {
    const queries: string[] = [];
    const fakeSql = (() => {
      const tx = { unsafe: async (q: string) => (queries.push(q), q.includes("delivery_config") ? [{ transport_enabled: true, local_app: "autolabels" }] : []) };
      const sql = { begin: async (fn: (t: typeof tx) => unknown) => fn(tx), unsafe: tx.unsafe, end: async () => {} };
      return sql as unknown as Sql;
    }) as () => Sql;
    for (const p of [{ "rtgip-protocol": "rtgip/2" }, {}] as Record<string, string>[]) {
      const rt = runtime(prodEnv, fakeSql);
      const r = await rt.inbound(new Request("https://fn.test/", { method: "POST", headers: { "content-type": "application/json", ...p }, body: "{}" }));
      expect([r.status, ((await r.json()) as { reason: string }).reason]).toEqual([403, "protocol_not_accepted"]);
    }
    expect(queries.join("\n")).not.toMatch(/signing_keys|vault/);
  });
});

describe("the rtgip_edge database URL", () => {
  it("is accepted only for the login rtgip_edge, directly or through the pooler as rtgip_edge.<ref>", () => {
    for (const ok of [
      "postgres://rtgip_edge@db.example.test:5432/postgres",
      `postgresql://rtgip_edge.${PRODUCTION_REF}@pooler.example.test:6543/postgres`,
    ])
      expect(edgeDbUrl(ok)).toBe(ok);
    for (const bad of [
      undefined,
      "",
      "postgres://postgres@db.example.test:5432/postgres",
      `postgres://postgres.${PRODUCTION_REF}@pooler.example.test:6543/postgres`,
      "postgres://authenticator@db.example.test/postgres",
      "postgres://rtgip_edge_admin@db.example.test/postgres",
      "postgres://rtgip_edge.short@db.example.test/postgres",
      "https://rtgip_edge@db.example.test/postgres",
      "not a url",
    ])
      expect(() => edgeDbUrl(bad)).toThrow("rtgip_edge_db_url_invalid");
  });

  it("never lets the URL turn TLS off, and the connection forces ssl require", () => {
    const base = `postgresql://rtgip_edge.${PRODUCTION_REF}@pooler.example.test:6543/postgres`;
    for (const q of ["?sslmode=require", "?sslmode=verify-full", "?ssl=require", "?sslmode=REQUIRE"]) expect(edgeDbUrl(base + q)).toBe(base + q);
    for (const q of ["?sslmode=disable", "?sslmode=allow", "?sslmode=prefer", "?ssl=false", "?ssl=disable", "?sslmode=require&sslmode=disable"])
      expect(() => edgeDbUrl(base + q)).toThrow("rtgip_edge_db_url_invalid");
    expect(EDGE_DB_OPTIONS.ssl).toBe("require");
    const bundle = readFileSync(root("supabase/functions/_shared/rtgip2-runtime.bundle.js"), "utf8");
    expect(bundle).toMatch(/ssl: "require"/);
  });

  it("names the AutoLabels production signing-key secret as the runtime derives it", () => {
    expect(keySecretName3("prd-autolabels-ed1")).toBe("RTGIP3_SIGNING_KEY_PRD_AUTOLABELS_ED1");
  });
});
