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

const DEST = "public/admin-assets";
const MAP  = "src/lib/design/adminAssets.ts";

// manifest prefix -> [archive directory, filename suffix in the archive]
const SOURCES = {
  "01_BRAND":          ["01_BRAND/SVG", null],
  "02_ICONS_BARE":     ["02_MASTER_SVG/D_CURRENTCOLOR_IMPLEMENTATION", "currentColor"],
  "03_ICONS_SOFT":     ["02_MASTER_SVG/B_SOFT_BACKGROUND", "soft"],
  "04_ICONS_REVERSE":  ["02_MASTER_SVG/C_REVERSE_WHITE", "reverse"],
  "05_EMPTY_STATES":   ["06_EMPTY_STATES/SVG", null],
};

const OUT_DIR = { "01_BRAND": "brand", "02_ICONS_BARE": "icons", "03_ICONS_SOFT": "tiles",
                  "04_ICONS_REVERSE": "reverse", "05_EMPTY_STATES": "empty-states" };

function parseCsv(text) {
  const [head, ...rows] = text.trim().split("\n");
  const cols = head.split(",");
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

const rows = parseCsv(readFileSync(
  join(pack, "08_MANIFESTS/000_MASTER_ASSET_INDEX_V2.csv"), "utf8"));

if (existsSync(DEST)) rmSync(DEST, { recursive: true });
const entries = [];
const missing = [];

for (const row of rows) {
  const prefix = row.filename.split("/")[0];
  const src = SOURCES[prefix];
  if (!src) { missing.push(`${row.id}: unknown prefix ${prefix}`); continue; }
  const dir = join(pack, src[0]);
  if (!existsSync(dir)) { missing.push(`${row.id}: ${src[0]} not in archive`); continue; }
  const file = findFile(dir, row.id, src[1]);
  if (!file) { missing.push(`${row.id}: no file for ${row.filename}`); continue; }

  const outDir = join(DEST, OUT_DIR[prefix]);
  mkdirSync(outDir, { recursive: true });
  const outName = basename(row.filename);

  // 31 files in the currentColor set still carry a hardcoded semantic stroke
  // (#16A34A for verified, #D97706 for attention, and so on). A colour baked
  // into the file cannot be dimmed when disabled, inverted on the navy rail,
  // or driven by the state the component actually knows about — and a green
  // icon that is always green is decoration rather than state, which the
  // pack's own rules forbid. The stroke becomes currentColor and the intended
  // semantic is recorded on the map so a component can opt into it in CSS.
  let semanticHint = null;
  if (prefix === "02_ICONS_BARE") {
    const svg = readFileSync(join(dir, file), "utf8");
    const hex = svg.match(/stroke="(#[0-9A-Fa-f]{6})"/);
    if (hex) {
      semanticHint = hex[1].toUpperCase();
      writeFileSync(join(outDir, outName), svg.replace(hex[0], 'stroke="currentColor"'));
    } else {
      copyFileSync(join(dir, file), join(outDir, outName));
    }
  } else {
    copyFileSync(join(dir, file), join(outDir, outName));
  }

  entries.push({
    semanticHint,
    id: row.id,
    name: row.name,
    category: row.category,
    variant: row.variant,
    surfaces: row.surfaces,
    notes: row.notes,
    path: `/admin-assets/${OUT_DIR[prefix]}/${outName}`,
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

const byCat = {};
for (const e of entries) byCat[e.category] = (byCat[e.category] || 0) + 1;
console.log(`installed ${entries.length} assets`);
for (const [c, n] of Object.entries(byCat).sort()) console.log(`  ${String(n).padStart(4)}  ${c}`);
