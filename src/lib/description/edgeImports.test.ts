import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// tsconfig.app.json is `include: ["src"]`, so supabase/functions is OUTSIDE
// typecheck entirely. Every edge function in this project — where nearly all
// the description work lives — compiles only when Deno runs it in production.
//
// That blind spot has already cost two real bugs: a `LENGTH_POLICY.absoluteMax`
// reference with no import (tsc reported clean), and a guard placed above the
// `const` it read, a temporal dead zone that throws before serving a request.
//
// This is not a typechecker. It catches the one class the gap makes most
// likely: using a name a shared module exports without importing it.

const fnDir = join(__dirname, "../../../supabase/functions");
const sharedDir = join(fnDir, "_shared");

const exportsOf = (file: string): string[] => {
  const src = readFileSync(join(sharedDir, file), "utf8");
  return [...src.matchAll(/^export (?:async )?(?:function|const|class) (\w+)/gm)]
    .map((m) => m[1])
    // Single-word lowercase names collide with ordinary locals; only check
    // names distinctive enough that a match is really a reference.
    .filter((n) => /[A-Z]/.test(n) && n.length > 3);
};

const entrypoints = readdirSync(fnDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== "_shared")
  .map((d) => join(fnDir, d.name, "index.ts"));

describe("edge functions import what they use", () => {
  const sharedFiles = readdirSync(sharedDir)
    .filter((f) => f.endsWith(".ts") && !f.includes(".test."));

  it("has entrypoints to check", () => {
    expect(entrypoints.length).toBeGreaterThan(5);
    expect(sharedFiles.length).toBeGreaterThan(5);
  });

  for (const entry of entrypoints) {
    const name = entry.split("/").slice(-2)[0];
    it(`${name} imports every shared name it references`, () => {
      let src: string;
      try { src = readFileSync(entry, "utf8"); } catch { return; }
      // What this file imports, from anywhere.
      const imported = new Set(
        [...src.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}/g)]
          // Import blocks carry section comments. Without stripping them the
          // name on the following line is glued to the comment and lost, which
          // is a false "missing import" -- the failure mode that would make
          // this guard get switched off.
          .flatMap((m) => m[1].replace(/\/\/[^\n]*/g, "").split(","))
          .map((t) => t.replace(/\btype\b/, "").split(" as ")[0].trim())
          .filter(Boolean),
      );
      // Strip imports and comments so only real references remain.
      const body = src
        .replace(/import[\s\S]*?from\s*["'][^"']+["'];?/g, "")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");

      // A file that declares its own parseYmm or htmlEscape is not missing an
      // import; it has a local of the same name. Duplication, not a defect.
      const declared = new Set(
        [...body.matchAll(/(?:^|\n)\s*(?:export\s+)?(?:async\s+)?(?:function|const|let|class)\s+(\w+)/g)]
          .map((m) => m[1]),
      );

      const missing: string[] = [];
      for (const file of sharedFiles) {
        for (const ex of exportsOf(file)) {
          if (imported.has(ex) || declared.has(ex)) continue;
          // Referenced as a call or a member access.
          if (new RegExp(`(^|[^\\w.$])${ex}\\s*[({.]`).test(body)) {
            missing.push(`${ex} (from _shared/${file})`);
          }
        }
      }
      expect(missing).toEqual([]);
    });
  }
});
