// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  APP_BINDINGS,
  RTGIP2_APP_RUNTIME_ENABLED,
  STAGING_GATEWAY_ORIGINS,
  STAGING_PROJECT_REF,
  createAppRuntime,
  createEntryRuntime,
} from "./runtime-entry.ts";
import type { Sql } from "../rtgip2-runtime/runtime.ts";

const root = (rel: string) => path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..", rel);
const read = (rel: string) => readFileSync(root(rel), "utf8");
const BUNDLE = "supabase/functions/_shared/rtgip2-runtime.bundle.js";
const PRODUCTION_REFS = ["onnbmmdbrsgytfozfozn", "ptiwdwfdckfqivoocyvp", "eabnaohpjuewhwrfhkun"];
const STAGING_REFS = ["uakiwvigsmrlyfpsalai", "zzwuxpbxkfxgtrnfxgia", "mubzldoczujeoatzdwko"];
const COMPILED_LITERAL = true;
const ENV_NAMES = ["RTGIP2_GATEWAY_URL", "RTGIP2_RUNTIME_MODE", "SUPABASE_ANON_KEY", "SUPABASE_DB_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_URL"];

describe("the generated bundle", () => {
  it("rebuilds byte-identically from source, so the deployed artifact has one reproducible sha256", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "rtgip2-bundle-"));
    const builds = [0, 1].map((i) => {
      const out = path.join(dir, `bundle-${i}.js`);
      execFileSync(process.execPath, [root("scripts/rtgip2/build-runtime.mjs"), "--out", out], { cwd: root("."), stdio: "pipe" });
      return readFileSync(out, "utf8");
    });
    expect(builds[1]).toBe(builds[0]);
    expect(read(BUNDLE)).toBe(builds[0]);
    expect(createHash("sha256").update(read(BUNDLE)).digest("hex")).toMatch(/^[0-9a-f]{64}$/);
    execFileSync(process.execPath, [root("scripts/rtgip2/build-runtime.mjs"), "--check"], { cwd: root("."), stdio: "pipe" });
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

  it("carries the compiled switches as plain constants", () => {
    const text = read(BUNDLE);
    expect(text).toContain(`var RTGIP2_APP_RUNTIME_ENABLED = ${COMPILED_LITERAL};`);
    expect(text).toContain(`var STAGING_PROJECT_REF = "${STAGING_PROJECT_REF}";`);
    expect(text).toMatch(/var PENDING_GATEWAY_STAGING_ORIGIN = \[[^\]]*\];/);
  });
});

describe("the compiled constants", () => {
  it("keep the literal at its committed state, the staging ref off every production ref, and no usable Gateway origin", () => {
    expect(RTGIP2_APP_RUNTIME_ENABLED).toBe(COMPILED_LITERAL);
    expect(STAGING_PROJECT_REF).toBe("uakiwvigsmrlyfpsalai");
    expect(STAGING_REFS).toContain(STAGING_PROJECT_REF);
    expect(PRODUCTION_REFS).not.toContain(STAGING_PROJECT_REF);
    expect(STAGING_GATEWAY_ORIGINS.every((o) => /^https:\/\/[a-z0-9.-]+$/.test(o))).toBe(true);
    expect(STAGING_GATEWAY_ORIGINS).toEqual([]);
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
  const stagingEnv = { RTGIP2_RUNTIME_MODE: "staging", SUPABASE_URL: `https://${STAGING_PROJECT_REF}.supabase.co`, SUPABASE_SERVICE_ROLE_KEY: "k".repeat(24), SUPABASE_DB_URL: "postgres://nobody@127.0.0.1:1/none" };

  it("refuses every entry point when the compiled literal is off, whatever the environment says", async () => {
    platform(stagingEnv);
    const rt = createEntryRuntime({ compiledEnabled: false });
    for (const call of [rt.inbound, rt.dispatch, rt.publish]) {
      const r = await call(new Request("https://fn.test/", { method: "POST", headers: { authorization: `Bearer ${stagingEnv.SUPABASE_SERVICE_ROLE_KEY}` }, body: "{}" }));
      expect([r.status, ((await r.json()) as { reason: string }).reason]).toEqual([503, "RTGIP2_NOT_ACTIVATED"]);
    }
  });

  it("with the literal injected on, still refuses each production backend and any unlisted Gateway", async () => {
    const connect = vi.fn(() => {
      throw new Error("the database must not be reached");
    });
    const rt = createAppRuntime({
      ...APP_BINDINGS,
      compiledEnabled: true,
      stagingRef: STAGING_PROJECT_REF,
      gatewayOrigins: STAGING_GATEWAY_ORIGINS,
      env: (n) => ({ ...stagingEnv, SUPABASE_URL: "", RTGIP2_GATEWAY_URL: "https://gateway.example.test" })[n as keyof typeof stagingEnv],
      sql: connect as unknown as () => Sql,
    });
    for (const ref of [...PRODUCTION_REFS, ...STAGING_REFS.filter((r) => r !== STAGING_PROJECT_REF)]) {
      const probe = createAppRuntime({
        ...APP_BINDINGS,
        compiledEnabled: true,
        stagingRef: STAGING_PROJECT_REF,
        gatewayOrigins: STAGING_GATEWAY_ORIGINS,
        env: (n) => ({ ...stagingEnv, SUPABASE_URL: `https://${ref}.supabase.co` })[n as keyof typeof stagingEnv],
        sql: connect as unknown as () => Sql,
      });
      for (const call of [probe.inbound, probe.dispatch, probe.publish]) {
        const r = await call(new Request("https://fn.test/", { method: "POST", body: "{}" }));
        expect([ref, r.status, ((await r.json()) as { reason: string }).reason]).toEqual([ref, 503, "not_staging_backend"]);
      }
    }
    expect((await rt.dispatch(new Request("https://fn.test/", { method: "POST" }))).status).toBe(503);
    expect(connect).not.toHaveBeenCalled();
  });

  it("answers gateway_origin_not_allowed for dispatch while the compiled origin list is empty", async () => {
    const rt = createAppRuntime({
      ...APP_BINDINGS,
      compiledEnabled: true,
      stagingRef: STAGING_PROJECT_REF,
      gatewayOrigins: STAGING_GATEWAY_ORIGINS,
      env: (n) => ({ ...stagingEnv, RTGIP2_GATEWAY_URL: "https://gateway.example.test" })[n as keyof typeof stagingEnv] ?? (n === "RTGIP2_GATEWAY_URL" ? "https://gateway.example.test" : undefined),
      sql: (() => {
        throw new Error("the database must not be reached");
      }) as unknown as () => Sql,
    });
    const r = await rt.dispatch(new Request("https://fn.test/", { method: "POST", headers: { authorization: `Bearer ${stagingEnv.SUPABASE_SERVICE_ROLE_KEY}` } }));
    expect([r.status, ((await r.json()) as { reason: string }).reason]).toEqual([503, "gateway_origin_not_allowed"]);
  });
});
