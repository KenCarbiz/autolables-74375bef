// Crop a region out of a PNG (optionally 2x nearest-neighbour) so it can be inspected at full resolution.
const path = require("path");
const fs = require("fs");
const { decodePng, encodePng } = require("../png.cjs");
const [src, out] = [process.argv[2], process.argv[3]];
const [x, y, w, h] = process.argv.slice(4, 8).map(Number);
const scale = Number(process.argv[8] || 1);
const img = decodePng(fs.readFileSync(src));
const data = Buffer.alloc(w * scale * h * scale * 4);
for (let yy = 0; yy < h * scale; yy++) for (let xx = 0; xx < w * scale; xx++) {
  const si = ((y + Math.floor(yy / scale)) * img.width + (x + Math.floor(xx / scale))) * 4;
  const di = (yy * w * scale + xx) * 4;
  data[di] = img.data[si]; data[di + 1] = img.data[si + 1]; data[di + 2] = img.data[si + 2]; data[di + 3] = 255;
}
fs.writeFileSync(out, encodePng({ width: w * scale, height: h * scale, data }));
