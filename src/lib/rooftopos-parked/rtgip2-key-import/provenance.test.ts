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
  files: Record<string, string>;
};

describe("rtgip2-key-import provenance", () => {
  it("every file of the shared key-import set matches PROVENANCE.json (byte-identical in the three apps)", () => {
    expect(prov.schema).toBe("rtgip2-key-import-provenance/1");
    for (const [name, want] of Object.entries(prov.files))
      expect(sha256(`./${name}`), name).toBe(want);
  });

  it("lists every file in the directory and nothing else", () => {
    const here = readdirSync(at("./"))
      .filter((f) => f !== "PROVENANCE.json")
      .sort();
    expect(Object.keys(prov.files).sort()).toEqual(here);
  });

  it("imports nothing but its own types from postgres", () => {
    const src = readFileSync(at("./key-import.ts"), "utf8");
    const specs = [...src.matchAll(/^import[^;]*?from "([^"]+)";/gms)].map((m) => m[1]);
    expect(specs).toEqual(["postgres"]);
    expect(src).not.toMatch(/^import (?!type)[^;]*from "postgres"/m);
    expect(src).not.toMatch(/console\.|Deno\.|process\.|fetch\(/);
  });
});
