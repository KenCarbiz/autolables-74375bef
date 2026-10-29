// Reads a cause map from decompose.cjs (--maps) and an annotation spec, and
// reports for each annotated box how many differing pixels each cause
// contributes, so a label such as "rendering difference" is checked against
// what was measured inside the box rather than assumed.
//
//   node scripts/admin-parity/itemcheck.cjs <cause-map.png> <spec.json>
const fs = require("node:fs");
const { decodePng } = require("./png.cjs");

const CAUSES = {
  "text-raster": [245, 180, 0], "text-size": [234, 88, 12], "text-moved": [124, 58, 237],
  "text-extra": [219, 39, 119], icon: [13, 148, 136], geometry: [220, 38, 38],
};

function main() {
  const [mapPath, specPath] = process.argv.slice(2);
  const map = decodePng(fs.readFileSync(mapPath));
  const spec = JSON.parse(fs.readFileSync(specPath, "utf8"));
  const out = [];
  for (const it of spec.items) {
    const counts = Object.fromEntries(Object.keys(CAUSES).map((k) => [k, 0]));
    for (let y = Math.max(0, it.y); y < Math.min(map.height, it.y + it.h); y++) {
      for (let x = Math.max(0, it.x); x < Math.min(map.width, it.x + it.w); x++) {
        const o = (y * map.width + x) * 4;
        for (const [k, c] of Object.entries(CAUSES)) {
          if (map.data[o] === c[0] && map.data[o + 1] === c[1] && map.data[o + 2] === c[2]) { counts[k]++; break; }
        }
      }
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const font = counts["text-raster"] + counts["text-size"];
    out.push({ n: it.n, kind: it.kind, differing: total, fontShare: total ? Math.round((font / total) * 100) : 0, ...counts });
  }
  for (const r of out) console.log(`#${r.n} ${r.kind}: ${r.differing} differing px; glyph raster ${r["text-raster"]}, type size ${r["text-size"]}, text moved ${r["text-moved"]}, text extra ${r["text-extra"]}, icon ${r.icon}, geometry ${r.geometry} (font ${r.fontShare}%)`);
}

main();
