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

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const SOURCE_DIR = join(root, "src/lib/factorySticker");
export const TARGET_DIR = join(root, "supabase/functions/_shared/factorySticker/lib");

// The truth layer and the Vehicle File read model are siblings of the engine
// in src/ and import across to it (`../factorySticker/fingerprint.ts`,
// `../factorySticker/ymm.ts`). The mirror flattens the engine into lib/, so
// each copy lands one level down as lib/vehicleTruth/ or lib/vehicleFile/ and
// its cross-imports are rewritten to `../` — the same modules, one directory
// closer. Sibling imports between the two mirrored trees
// (`../vehicleTruth/precedence.ts`) already resolve and are left alone.
// Rewriting on copy keeps src/ readable as ordinary sibling imports instead
// of contorting it to suit the mirror's shape.
export const TRUTH_SOURCE_DIR = join(root, "src/lib/vehicleTruth");
export const TRUTH_PREFIX = "vehicleTruth/";
export const DOCUMENTS_SOURCE_DIR = join(root, "src/lib/documents");
export const DOCUMENTS_PREFIX = "documents/";
export const VEHICLE_FILE_SOURCE_DIR = join(root, "src/lib/vehicleFile");
export const VEHICLE_FILE_PREFIX = "vehicleFile/";
// The market engine is a third sibling tree. It imports the shared YMM parser
// as `../factorySticker/ymm`, which the same rewrite turns into `../ymm` —
// one directory up from lib/market/, where the flattened engine lives.
export const MARKET_SOURCE_DIR = join(root, "src/lib/market");
export const MARKET_PREFIX = "market/";
// The intelligence layer (MarketPass and the shadow scorers) imports the market
// engine, the truth layer and one warranty helper as siblings; all three land
// as siblings of lib/intelligence/ too, so its imports resolve unchanged.
export const INTELLIGENCE_SOURCE_DIR = join(root, "src/lib/intelligence");
export const INTELLIGENCE_PREFIX = "intelligence/";
export const WARRANTY_FILES = ["inServiceEvidence.ts"];
export const WARRANTY_PREFIX = "warranty/";
const rewriteEngineImports = (body) => body.replace(/from "\.\.\/factorySticker\//g, 'from "../');


// The customer Passport page view (src/lib/marketPass/pageView.ts) runs the
// same functions the locked page runs, and the edge function serves it, so the
// closure of those functions is mirrored too. Unlike the trees above these
// files import each other through `@/lib/...` and through paths into
// supabase/functions/_shared, so every specifier is resolved against src/ and
// re-pointed at where its target lands in the mirror (or in _shared, which
// already lives under supabase/functions/). Relative specifiers gain the .ts
// extension Deno requires. Each file is copied one key per file; nothing else
// in these directories ships.
export const PAGE_VIEW_FILES = [
  "src/lib/passportV2Data.ts",
  "src/lib/photos.ts",
  "src/lib/packetModules.ts",
  "src/lib/stickyButtons.ts",
  "src/lib/oemWarranty.ts",
  "src/lib/iihsAwards.ts",
  "src/lib/passportRouting.ts",
  "src/lib/priceModel.ts",
  "src/lib/passport/comparables.ts",
  "src/lib/passport/evidenceFingerprint.ts",
  "src/lib/passport/fuelEconomy.ts",
  "src/lib/passport/marketComparison.ts",
  "src/lib/passport/saleCard.ts",
  "src/lib/passport/sellingPrice.ts",
  "src/lib/passport/verificationSummary.ts",
  "src/lib/payment/estimator.ts",
];
export const PAGE_VIEW_DIR = "src/lib/marketPass";
// The page view only names this type; the real interface lives in a React hook
// file the edge runtime cannot load. The mirror carries a structural stand-in.
export const LISTING_TYPE_KEY = "vehicleListingType.ts";
const LISTING_TYPE_SOURCE = "src/hooks/useVehicleListing.ts";
const LISTING_TYPE_BODY = `// deno-lint-ignore-file no-explicit-any
export type VehicleListing = Record<string, any>;
`;

const SPECIFIER = /(\bfrom\s+|\bimport\(\s*)(["'])([^"']+)\2/g;
const EXTENSIONS = [".ts", ".tsx", "/index.ts"];
const SIBLING_TREES = ["vehicleTruth", "documents", "market", "vehicleFile", "intelligence", "warranty"];

function resolveSource(fromFile, spec) {
  const base = spec.startsWith("@/") ? join(root, "src", spec.slice(2)) : resolve(dirname(fromFile), spec);
  for (const ext of ["", ...EXTENSIONS]) {
    const candidate = base + ext;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  throw new Error(`sync-edge-sticker-lib: ${relative(root, fromFile)} imports ${spec}, which does not resolve`);
}

/** Where a source file lives once mirrored: an absolute path under the mirror, or under _shared. */
function mirrorLocation(srcAbs) {
  const rel = relative(root, srcAbs).split(sep).join("/");
  if (rel.startsWith("supabase/functions/")) return srcAbs;
  if (rel === LISTING_TYPE_SOURCE) return join(TARGET_DIR, LISTING_TYPE_KEY);
  const lib = rel.match(/^src\/lib\/(.+)$/);
  if (!lib) throw new Error(`sync-edge-sticker-lib: ${rel} has no mirror location`);
  const inner = lib[1];
  if (inner.startsWith("factorySticker/")) return join(TARGET_DIR, inner.slice("factorySticker/".length));
  return join(TARGET_DIR, inner);
}

function rewriteSpecifiers(srcAbs, body) {
  const here = dirname(mirrorLocation(srcAbs));
  return body.replace(SPECIFIER, (whole, lead, quote, spec) => {
    if (!spec.startsWith("@/") && !spec.startsWith(".")) return whole;
    const target = mirrorLocation(resolveSource(srcAbs, spec));
    let rel = relative(here, target).split(sep).join("/");
    if (!rel.startsWith(".")) rel = `./${rel}`;
    return `${lead}${quote}${rel}${quote}`;
  });
}

function collectPageView(out) {
  const files = [...PAGE_VIEW_FILES];
  for (const name of readdirSync(join(root, PAGE_VIEW_DIR))) {
    if (isCopyable(name)) files.push(`${PAGE_VIEW_DIR}/${name}`);
  }
  for (const rel of files) {
    const abs = join(root, rel);
    const key = relative(TARGET_DIR, mirrorLocation(abs)).split(sep).join("/");
    out.set(key, HEADER.replace("{src}", rel) + rewriteSpecifiers(abs, readFileSync(abs, "utf8")));
  }
  out.set(LISTING_TYPE_KEY, HEADER.replace("{src}", LISTING_TYPE_SOURCE) + LISTING_TYPE_BODY);
}

const SKIP_DIRS = new Set(["__fixtures__", "__snapshots__", "__acceptance__"]);
const isCopyable = (name) => name.endsWith(".ts") && !name.endsWith(".test.ts");

const HEADER = `// GENERATED — do not edit.
// Mirror of {src}, copied so the edge runtime can
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
    out.set(rel, withHeader ? HEADER.replace("{src}", `src/lib/factorySticker/${rel}`) + body : body);
  }
  return out;
}

/** Every file the mirror should contain: the engine, the truth layer, shared document primitives, the Vehicle File read model, the market engine, the intelligence layer, and the closure the customer Passport page view runs. */
export function collectAll() {
  const out = collect(SOURCE_DIR);
  const truth = collect(TRUTH_SOURCE_DIR, TRUTH_SOURCE_DIR, new Map(), false);
  for (const [rel, body] of truth) {
    const key = TRUTH_PREFIX + rel;
    out.set(key, HEADER.replace("{src}", `src/lib/vehicleTruth/${rel}`) + rewriteEngineImports(body));
  }
  const documents = collect(DOCUMENTS_SOURCE_DIR, DOCUMENTS_SOURCE_DIR, new Map(), false);
  for (const [rel, body] of documents) {
    const key = DOCUMENTS_PREFIX + rel;
    out.set(key, HEADER.replace("{src}", `src/lib/documents/${rel}`) + body);
  }
  const market = collect(MARKET_SOURCE_DIR, MARKET_SOURCE_DIR, new Map(), false);
  for (const [rel, body] of market) {
    out.set(MARKET_PREFIX + rel, HEADER.replace("{src}", `src/lib/market/${rel}`) + rewriteEngineImports(body));
  }
  const vehicleFile = collect(VEHICLE_FILE_SOURCE_DIR, VEHICLE_FILE_SOURCE_DIR, new Map(), false);
  for (const [rel, body] of vehicleFile) {
    const key = VEHICLE_FILE_PREFIX + rel;
    out.set(key, HEADER.replace("{src}", `src/lib/vehicleFile/${rel}`) + rewriteEngineImports(body));
  }
  const intelligence = collect(INTELLIGENCE_SOURCE_DIR, INTELLIGENCE_SOURCE_DIR, new Map(), false);
  for (const [rel, body] of intelligence) {
    out.set(INTELLIGENCE_PREFIX + rel, HEADER.replace("{src}", `src/lib/intelligence/${rel}`) + body);
  }
  for (const name of WARRANTY_FILES) {
    const body = readFileSync(join(root, "src/lib/warranty", name), "utf8");
    out.set(WARRANTY_PREFIX + name, HEADER.replace("{src}", `src/lib/warranty/${name}`) + body);
  }
  collectPageView(out);
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
