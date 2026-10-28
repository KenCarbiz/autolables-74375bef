// Bounding box of "ink" (pixels darker than a threshold) inside a region, for both images side by side.
const path = require("path");
const fs = require("fs");
const { decodePng } = require("../png.cjs");
const imgs = [process.argv[2], process.argv[3]].map((f) => decodePng(fs.readFileSync(f)));
const regions = JSON.parse(process.argv[4]);
for (const r of regions) {
  const out = imgs.map((img) => {
    const { width, data } = img;
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, n = 0;
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) {
      const o = (y * width + x) * 4;
      const b = data[o] + data[o + 1] + data[o + 2];
      if (b < (r.t ?? 0x1b0)) { n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    return n ? `x ${x0}-${x1} (${x1 - x0 + 1}) y ${y0}-${y1} (${y1 - y0 + 1})` : "none";
  });
  console.log(`${r.name.padEnd(22)} ref: ${out[0].padEnd(34)} ours: ${out[1]}`);
}
