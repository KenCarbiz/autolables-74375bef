import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const at = (rel: string) => path.resolve(path.dirname(fileURLToPath(import.meta.url)), rel);
const sha256 = (rel: string) =>
  createHash("sha256")
    .update(readFileSync(at(rel)))
    .digest("hex");
const prov = JSON.parse(readFileSync(at("./PROVENANCE.json"), "utf8")) as {
  schema: string;
  runtime: Record<string, string>;
  core: Record<string, string>;
  rtgip3: Record<string, string>;
  bundle: { builder: string; esbuild: Record<string, string> };
};

describe("rtgip2-runtime provenance", () => {
  it("every file of the shared runtime set matches PROVENANCE.json (byte-identical in the three apps)", () => {
    expect(prov.schema).toBe("rtgip2-runtime-provenance/1");
    for (const [name, want] of Object.entries(prov.runtime))
      expect(sha256(`./${name}`), name).toBe(want);
  });

  it("lists every source file in the directory and nothing else", () => {
    const here = readdirSync(at("./"))
      .filter((f) => f.endsWith(".ts"))
      .sort();
    expect(Object.keys(prov.runtime).sort()).toEqual(here);
  });

  it("the frozen rtgip2 core it imports is untouched", () => {
    expect(Object.keys(prov.core).sort()).toEqual([
      "admission.ts",
      "delivery.ts",
      "produce.ts",
      "protocol.ts",
      "receipt-query.ts",
      "receipt-v2.ts",
    ]);
    for (const [name, want] of Object.entries(prov.core))
      expect(sha256(`../rtgip2/${name}`), name).toBe(want);
  });

  it("the rtgip/3 modules it imports are the Gateway mirrors, bound to the app core by rtgip2/core.ts", () => {
    expect(Object.keys(prov.rtgip3).sort()).toEqual([
      "rtgip2/core.ts",
      "rtgip3/core3.ts",
      "rtgip3/keys3.ts",
      "rtgip3/receipt-query3.ts",
      "rtgip3/receipt3.ts",
      "rtgip3/sig.ts",
    ]);
    for (const [name, want] of Object.entries(prov.rtgip3)) expect(sha256(`../${name}`), name).toBe(want);
    expect(readFileSync(at("../rtgip2/core.ts"), "utf8")).toBe('export * from "./protocol.ts";\n');
  });

  it("records the exact esbuild each app's bundle is built with (each app's runtime-bundle test checks its own)", () => {
    expect(prov.bundle.builder).toBe("scripts/rtgip2/build-runtime.mjs");
    expect(Object.keys(prov.bundle.esbuild).sort()).toEqual(["autocurb", "autoframe", "autolabels"]);
    for (const v of Object.values(prov.bundle.esbuild)) expect(v).toMatch(/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/);
  });

  it("imports nothing but the core, the rtgip/3 mirrors, the shared chain rule and postgres types", () => {
    const src = readFileSync(at("./runtime.ts"), "utf8");
    const specs = [...src.matchAll(/^import[^;]*?from "([^"]+)";/gms)].map((m) => m[1]);
    for (const s of specs)
      expect(
        s === "postgres" || s === "./source-chain.ts" || /^\.\.\/rtgip[23]\/[a-z0-9-]+\.ts$/.test(s!),
        s,
      ).toBe(true);
    expect(src).not.toMatch(/^import (?!type)[^;]*from "postgres"/m);
  });
});
