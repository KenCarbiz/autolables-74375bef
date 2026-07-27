// Mirror the pure factory-sticker engine into the edge-function tree.
//
// Supabase ships only supabase/functions/ to the edge runtime, so an edge
// module cannot import from src/. The engine has to live in both places.
// src/lib/factorySticker is the single source of truth; this script copies
// the pure modules (no fixtures, no tests) into
// supabase/functions/_shared/factorySticker/lib/, and
// edgeLibSync.test.ts fails the suite if the copy ever drifts.
//
// Run: bun run sync:edge-sticker

import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const SOURCE_DIR = join(root, "src/lib/factorySticker");
export const TARGET_DIR = join(root, "supabase/functions/_shared/factorySticker/lib");

// The truth layer is a sibling of the engine in src/ and imports across to
// it (`../factorySticker/fingerprint.ts`). The mirror flattens the engine
// into lib/, so the copy lands one level down as lib/vehicleTruth/ and its
// cross-imports are rewritten to `../` — the same modules, one directory
// closer. Rewriting on copy keeps src/ readable as ordinary sibling
// imports instead of contorting it to suit the mirror's shape.
export const TRUTH_SOURCE_DIR = join(root, "src/lib/vehicleTruth");
export const TRUTH_PREFIX = "vehicleTruth/";
const rewriteTruthImports = (body) => body.replace(/from "\.\.\/factorySticker\//g, 'from "../');

const SKIP_DIRS = new Set(["__fixtures__", "__snapshots__"]);
const isCopyable = (name) => name.endsWith(".ts") && !name.endsWith(".test.ts");

const HEADER = `// GENERATED — do not edit.
// Mirror of src/lib/factorySticker/{rel}, copied so the edge runtime can
// bundle the engine (Supabase ships only supabase/functions/). Edit the
// source file and run \`bun run sync:edge-sticker\`.
`;

// `withHeader` is on for the source tree (the header is what the mirror is
// expected to carry) and off when reading the mirror back, so comparing the
// two compares like with like.
export function collect(dir, base = dir, out = new Map(), withHeader = true) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue;
      collect(full, base, out, withHeader);
      continue;
    }
    if (!isCopyable(entry)) continue;
    const rel = relative(base, full).split("\\").join("/");
    const body = readFileSync(full, "utf8");
    out.set(rel, withHeader ? HEADER.replace("{rel}", rel) + body : body);
  }
  return out;
}

/** Every file the mirror should contain: the engine, plus the truth layer. */
export function collectAll() {
  const out = collect(SOURCE_DIR);
  const truth = collect(TRUTH_SOURCE_DIR, TRUTH_SOURCE_DIR, new Map(), false);
  for (const [rel, body] of truth) {
    const key = TRUTH_PREFIX + rel;
    out.set(key, HEADER.replace("{rel}", `../vehicleTruth/${rel}`) + rewriteTruthImports(body));
  }
  return out;
}

export function readMirror() {
  const out = new Map();
  try {
    collect(TARGET_DIR, TARGET_DIR, out, false);
  } catch {
    // A missing mirror is simply an empty one; the caller reports the diff.
  }
  return out;
}

function main() {
  const source = collectAll();
  rmSync(TARGET_DIR, { recursive: true, force: true });
  for (const [rel, body] of source) {
    const dest = join(TARGET_DIR, rel);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, body);
  }
  console.log(`synced ${source.size} files -> ${relative(root, TARGET_DIR)}`);
}

if (process.argv[1] && process.argv[1].endsWith("sync-edge-sticker-lib.mjs")) main();
