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

  it("imports nothing but the core and postgres types", () => {
    const src = readFileSync(at("./runtime.ts"), "utf8");
    const specs = [...src.matchAll(/^import[^;]*?from "([^"]+)";/gms)].map((m) => m[1]);
    for (const s of specs)
      expect(s === "postgres" || /^\.\.\/rtgip2\/[a-z0-9-]+\.ts$/.test(s!), s).toBe(true);
    expect(src).not.toMatch(/^import (?!type)[^;]*from "postgres"/m);
  });
});
