const path = require("path"); const fs = require("fs");
const { decodePng } = require("../png.cjs");
const img = decodePng(fs.readFileSync(process.argv[2]));
const [y0, y1] = [Number(process.argv[3]), Number(process.argv[4])];
const { width, data } = img;
const isBlue = (o) => data[o] < 0x70 && data[o + 1] >= 0x30 && data[o + 1] <= 0x90 && data[o + 2] >= 0xa0;
for (let y = y0; y < y1; y++) { let run = 0, longest = 0, start = -1, bs = -1; for (let x = 232; x < width; x++) { if (isBlue((y * width + x) * 4)) { if (run === 0) start = x; run++; if (run > longest) { longest = run; bs = start; } } else run = 0; } if (longest >= 12) console.log(`y=${y} longest=${longest} at x=${bs}`); }
