// @vitest-environment node
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  RTGIP2_KEY_IMPORT_ENABLED,
  STAGING_PROJECT_REF,
  createEntryKeyImport,
} from "./key-import-entry.ts";

const root = (rel: string) =>
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..", rel);
const read = (rel: string) => readFileSync(root(rel), "utf8");
const BUNDLE = "supabase/functions/_shared/rtgip2-key-import.bundle.js";
const BUILD = ["scripts/rtgip2/build-runtime.mjs", "--key-import"];

describe("the key-import bundle", () => {
  it("rebuilds byte-identically from source and is not stale", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "rtgip2-ki-bundle-"));
    const builds = [0, 1].map((i) => {
      const out = path.join(dir, `bundle-${i}.js`);
      execFileSync(process.execPath, [root(BUILD[0]!), BUILD[1]!, "--out", out], {
        cwd: root("."),
        stdio: "pipe",
      });
      return readFileSync(out, "utf8");
    });
    expect(builds[1]).toBe(builds[0]);
    expect(read(BUNDLE)).toBe(builds[0]);
    execFileSync(process.execPath, [root(BUILD[0]!), BUILD[1]!, "--check"], {
      cwd: root("."),
      stdio: "pipe",
    });
  }, 60_000);

  it("imports only npm:postgres@3.4.5, never logs, and reads only SUPABASE_URL, SUPABASE_DB_URL and the derived key names", () => {
    const text = read(BUNDLE);
    expect([...text.matchAll(/^import .*? from "([^"]+)";/gm)].map((m) => m[1])).toEqual([
      "npm:postgres@3.4.5",
    ]);
    expect(text).not.toMatch(/console\.|process\.env|require\(|import\.meta|fetch\(/);
    expect(
      [
        ...new Set(
          [...text.matchAll(/\b(?:env|cfg\.env)\(\s*"([A-Z0-9_]+)"\s*\)/g)].map((m) => m[1]),
        ),
      ].sort(),
    ).toEqual(["SUPABASE_DB_URL", "SUPABASE_URL"]);
    expect(text.match(/cfg\.env\(/g)).toHaveLength(2);
    expect(text).toContain("cfg.env(keySecretName(claimed.key_id))");
    expect(text.match(/Deno\.env\.get\(/g)).toHaveLength(1);
    expect(text).toContain("var RTGIP2_KEY_IMPORT_ENABLED = false;");
    expect(text).toContain(`var STAGING_PROJECT_REF = "${STAGING_PROJECT_REF}";`);
  });

  it("leaves the runtime bundle and the three runtime functions as they were", () => {
    execFileSync(process.execPath, [root("scripts/rtgip2/build-runtime.mjs"), "--check"], {
      cwd: root("."),
      stdio: "pipe",
    });
    expect(read("supabase/functions/_shared/rtgip2-runtime.bundle.js")).not.toContain("key_import");
  });
});

describe("the rtgip-key-import function", () => {
  it("passes the compiled literal and nothing else", () => {
    expect(read("supabase/functions/rtgip-key-import/index.ts")).toBe(
      `import {\n  RTGIP2_KEY_IMPORT_ENABLED,\n  createEntryKeyImport,\n} from "../_shared/rtgip2-key-import.bundle.js";\n\n` +
        `const keyImport = createEntryKeyImport({ compiledEnabled: RTGIP2_KEY_IMPORT_ENABLED });\n\n` +
        `Deno.serve((req: Request) => keyImport.handle(req));\n`,
    );
  });

  it("is registered without the Supabase JWT gate", () => {
    expect(
      /\[functions\.rtgip-key-import\]\s*\nverify_jwt = (true|false)/.exec(
        read("supabase/config.toml"),
      )?.[1],
    ).toBe("false");
  });

  it("keeps the committed literal off and refuses with it, whatever the environment holds", async () => {
    expect(RTGIP2_KEY_IMPORT_ENABLED).toBe(false);
    expect(createEntryKeyImport.length).toBe(1);
    (globalThis as unknown as { Deno: unknown }).Deno = {
      env: {
        get: (n: string) =>
          n === "SUPABASE_URL" ? `https://${STAGING_PROJECT_REF}.supabase.co` : "5e".repeat(32),
      },
    };
    try {
      const r = await createEntryKeyImport({ compiledEnabled: RTGIP2_KEY_IMPORT_ENABLED }).handle(
        new Request("https://fn.test/", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            ticket_id: "0b7a2f4e-8c1d-4e5f-9a6b-1c2d3e4f5a6b",
            token: "a1".repeat(32),
          }),
        }),
      );
      expect([r.status, await r.text()]).toEqual([
        503,
        JSON.stringify({ reason: "RTGIP2_KEY_IMPORT_NOT_ACTIVATED" }),
      ]);
    } finally {
      delete (globalThis as unknown as { Deno?: unknown }).Deno;
    }
  });
});
