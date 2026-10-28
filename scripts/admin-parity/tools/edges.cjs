// Print vertical colour edges along a column of a PNG so card/row rhythm can be read in pixels.
const path = require("path");
const fs = require("fs");
const { decodePng } = require("../png.cjs");
const file = process.argv[2];
const cols = process.argv.slice(3).map(Number);
const img = decodePng(fs.readFileSync(file));
const { width, height, data } = img;
const px = (x, y) => { const i = (y * width + x) * 4; return [data[i], data[i + 1], data[i + 2]]; };
for (const x of cols) {
  const out = [];
  let prev = px(x, 0);
  for (let y = 1; y < height; y++) {
    const c = px(x, y);
    const d = Math.abs(c[0] - prev[0]) + Math.abs(c[1] - prev[1]) + Math.abs(c[2] - prev[2]);
    if (d > 40) out.push(`${y}:${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`);
    prev = c;
  }
  console.log(`x=${x} (${width}x${height}): ${out.join(" ")}`);
}
