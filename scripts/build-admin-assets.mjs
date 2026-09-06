// Install the AutoLabels admin asset pack and generate its typed map.
//
//   node scripts/build-admin-assets.mjs <path-to-unzipped-pack>
//
// Three decisions this script encodes, each of which the pack's own docs get
// slightly wrong or leave unsaid:
//
// 1. The manifest addresses icons as 02_ICONS_BARE/... but the archive ships
//    them under 02_MASTER_SVG/A_BARE_NO_BACKGROUND/. Following the manifest
//    literally produces 264 broken paths, so the mapping is resolved here.
//
// 2. The primary icon source is D_CURRENTCOLOR_IMPLEMENTATION, which the docs
//    never mention. Those files are identical to the bare set except the
//    stroke is currentColor rather than a hardcoded #2563EB, so hover, active,
//    disabled, semantic state and the dark navy rail all become CSS instead of
//    separate files. It also makes 14 of the reverse-white assets redundant.
//
// 3. Only vectors are installed. The 12MB of PNG rasters and contact sheets in
//    the archive are documentation for humans, not application assets.

import { readFileSync, writeFileSync, mkdirSync, copyFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { join, basename } from "node:path";

const DEST  = "public/admin-assets";
const MAP   = "src/lib/design/adminAssets.ts";
const PATHS = "src/lib/design/adminIconPaths.ts";

// V3 fixed the manifest, so a path in it resolves directly against the pack
// root. V2 addressed icons at directories that did not exist and needed a
// translation table; keeping that table would now be a lie about the archive.
//
// The currentColor set remains the icon source: those files inherit colour, so
// hover, disabled, the navy rail and semantic state are CSS rather than
// separate files. V3 also dropped the reverse family entirely, which is only
// coherent BECAUSE the icons inherit.
const ICON_DIR    = "02_MASTER_SVG/C_CURRENTCOLOR_IMPLEMENTATION";
const BARE_DIR    = "02_MASTER_SVG/A_BARE_NO_BACKGROUND";
const OUT_DIR_FOR = (path) =>
  path.startsWith("01_BRAND") ? "brand"
  : path.startsWith("05_EMPTY_STATES") ? "empty-states"
  : path.includes("B_SOFT_BACKGROUND") ? "tiles"
  : "icons";

function parseCsv(text) {
  // The V3 manifest uses CRLF, which leaves a stray carriage return on the
  // final column of every line. The header then reads "notes\r", so row.notes
  // is undefined on all 290 assets — a silent data loss that typechecks only
  // because the field is optional somewhere upstream.
  const [head, ...rows] = text.replace(/\r\n?/g, "\n").trim().split("\n");
  const cols = head.split(",").map((c) => c.trim());
  return rows.map((line) => {
    // Fields may contain quoted commas; a minimal split is enough for this file.
    const out = []; let cur = ""; let quoted = false;
    for (const ch of line) {
      if (ch === '"') { quoted = !quoted; continue; }
      if (ch === "," && !quoted) { out.push(cur); cur = ""; continue; }
      cur += ch;
    }
    out.push(cur);
    return Object.fromEntries(cols.map((c, i) => [c, out[i] ?? ""]));
  });
}

/** The archive doubles the id in currentColor filenames (010A_010A_...). */
function findFile(dir, id, suffix) {
  const files = readdirSync(dir);
  const exact = files.find((f) => f === `${id}_${suffix}.svg`);
  if (exact) return exact;
  const byId = files.filter((f) => f.startsWith(`${id}_`) && f.endsWith(".svg"));
  if (byId.length === 1) return byId[0];
  const bySuffix = byId.find((f) => !suffix || f.includes(suffix));
  return bySuffix || byId[0];
}

const pack = process.argv[2];
if (!pack) { console.error("usage: build-admin-assets.mjs <pack dir>"); process.exit(1); }

// The manifest filename carries the pack version, so it is discovered rather
// than hardcoded: a version bump should not silently read a stale index.
const manifestDir = ["07_MANIFESTS", "08_MANIFESTS"].find((d) => existsSync(join(pack, d)));
if (!manifestDir) { console.error("no manifest directory in pack"); process.exit(1); }
const manifestFile = readdirSync(join(pack, manifestDir))
  .find((f) => /MASTER_ASSET_INDEX/i.test(f) && f.endsWith(".csv"));
if (!manifestFile) { console.error("no master asset index in pack"); process.exit(1); }
const rows = parseCsv(readFileSync(join(pack, manifestDir, manifestFile), "utf8"));

if (existsSync(DEST)) rmSync(DEST, { recursive: true });
const entries = [];
const inline = [];
const missing = [];

for (const row of rows) {
  // Soft tiles and bare icons share an id with the currentColor file; only one
  // copy of each concept belongs in the app, and it is the styleable one.
  const isBare = row.filename.includes(BARE_DIR);
  if (isBare) continue;

  const source = row.filename.includes("C_CURRENTCOLOR_IMPLEMENTATION")
    ? row.filename : row.filename;
  const abs = join(pack, source);
  if (!existsSync(abs)) { missing.push(`${row.id}: ${source}`); continue; }

  const bucket = OUT_DIR_FOR(row.filename);
  const outDir = join(DEST, bucket);
  mkdirSync(outDir, { recursive: true });
  const outName = basename(row.filename);
  const svg = readFileSync(abs, "utf8");

  // V3 reports zero hard-coded colours in the currentColor set. Verify rather
  // than trust: a single fixed hex is invisible until an icon refuses to dim.
  let semanticHint = null;
  if (bucket === "icons") {
    const hex = svg.match(/stroke="(#[0-9A-Fa-f]{6})"/);
    if (hex) {
      // V3 reports none of these; the check stays because a single fixed hex
      // is invisible until an icon refuses to dim on a disabled control.
      semanticHint = hex[1].toUpperCase();
      writeFileSync(join(outDir, outName), svg.replace(hex[0], 'stroke="currentColor"'));
    } else {
      copyFileSync(abs, join(outDir, outName));
    }

    // The bare twin keeps the colour the concept was DRAWN in — green for
    // verified, red for fail. Shipping the currentColor geometry without
    // recording that intent would throw the designer's semantics away and
    // leave a failed inspection the same colour as a nav item. Recorded as
    // data so a component can honour it for a real state and ignore it for a
    // label, which is also what keeps colour from being the only signal.
    if (!semanticHint) {
      const twin = join(pack, BARE_DIR, outName.replace(/_currentColor\.svg$/, "_bare.svg"));
      if (existsSync(twin)) {
        const bareHex = readFileSync(twin, "utf8").match(/stroke="(#[0-9A-Fa-f]{6})"/);
        if (bareHex && bareHex[1].toUpperCase() !== "#2563EB") {
          semanticHint = bareHex[1].toUpperCase();
        }
      }
    }
    const clean = readFileSync(join(outDir, outName), "utf8");
    const viewBox = clean.match(/viewBox="([^"]+)"/)?.[1] || "0 0 24 24";
    const body = clean.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "").trim();
    inline.push({ id: row.id, viewBox, body });
  } else {
    copyFileSync(abs, join(outDir, outName));
  }

  entries.push({
    semanticHint,
    id: row.id,
    name: row.name,
    category: row.category,
    variant: row.variant,
    surfaces: row.surfaces,
    notes: row.notes,
    path: `/admin-assets/${bucket}/${outName}`,
  });
}

if (missing.length) {
  console.error(`${missing.length} asset(s) could not be resolved:`);
  for (const m of missing.slice(0, 10)) console.error(`  ${m}`);
  process.exit(1);
}

const body = entries.map((e) =>
  `  ${JSON.stringify(e.id)}: { id: ${JSON.stringify(e.id)}, name: ${JSON.stringify(e.name)}, ` +
  `category: ${JSON.stringify(e.category)}, variant: ${JSON.stringify(e.variant)}, ` +
  `surfaces: ${JSON.stringify(e.surfaces)}, notes: ${JSON.stringify(e.notes)}, ` +
  `semanticHint: ${JSON.stringify(e.semanticHint)}, ` +
  `path: ${JSON.stringify(e.path)} },`).join("\n");

mkdirSync("src/lib/design", { recursive: true });
writeFileSync(MAP, `// GENERATED by scripts/build-admin-assets.mjs. Do not edit by hand.
//
// The admin operating-system asset pack, keyed by the ids in the pack's own
// manifest. Icons are the currentColor variant, so colour is a CSS concern:
// style them with text colour rather than reaching for a differently-coloured
// file. Soft tiles carry their own background and are for the small number of
// high-value entry points only.
//
// These are ADMIN assets. The customer Passport is owner-approved and locked;
// do not introduce them there to make the system look uniform.

export interface AdminAsset {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly variant: string;
  readonly surfaces: string;
  readonly notes: string;
  /** The semantic colour the pack drew this icon in, where it had one. The
   *  file itself is currentColor; this records the intent so a component can
   *  choose to honour it rather than having it forced. */
  readonly semanticHint: string | null;
  readonly path: string;
}

export const ADMIN_ASSETS: Readonly<Record<string, AdminAsset>> = Object.freeze({
${body}
});

export const adminAsset = (id: string): AdminAsset | undefined => ADMIN_ASSETS[id];

export const adminAssetsByCategory = (category: string): AdminAsset[] =>
  Object.values(ADMIN_ASSETS).filter((a) => a.category === category);
`);

writeFileSync(PATHS, `// GENERATED by scripts/build-admin-assets.mjs. Do not edit by hand.
//
// Icon geometry for inline rendering. currentColor only inherits when the SVG
// is part of the document, so referencing these files through <img src> would
// defeat the reason the currentColor variant was chosen at all.

export interface AdminIconPath {
  readonly viewBox: string;
  readonly body: string;
}

export const ADMIN_ICON_PATHS: Readonly<Record<string, AdminIconPath>> = Object.freeze({
${inline.map((i) => `  ${JSON.stringify(i.id)}: { viewBox: ${JSON.stringify(i.viewBox)}, body: ${JSON.stringify(i.body)} },`).join("\n")}
});
`);

const byCat = {};
for (const e of entries) byCat[e.category] = (byCat[e.category] || 0) + 1;
console.log(`installed ${entries.length} assets`);
for (const [c, n] of Object.entries(byCat).sort()) console.log(`  ${String(n).padStart(4)}  ${c}`);
