// Where the agreed number's missing points come from. For each screen, every
// pixel the protocol v2 content score counts as different (same native
// 1586x992 capture, same content region, same masks, same 32/255 threshold)
// is assigned to one cause, using the DOM boxes read from the same page:
//
//   icon         inside a rendered svg or img (asset choice or icon drawing)
//   text-raster  inside a line of text whose ink sits where the mock's ink
//                sits (left, top within 2px) at the same height (within 1px)
//                and width (within 3%): glyph rasterization only
//   text-size    same position, different ink height or width: type size,
//                weight or copy length
//   text-moved   a line of text whose ink is more than 2px from the mock's
//   text-extra   a line of text where the mock has no ink in that box
//   geometry     everything else: fills, borders, spacing, component sizes,
//                and mock text where the capture draws no text
//
// --tol widens the position tolerance (default 2px) to test how sensitive
// the split is to it.
//
// The buckets add up to 100% minus the content score, so each bucket is the
// most that cause can account for. Nothing is resampled: the v2 frame equals
// the references' native size.
//
//   node scripts/admin-parity/decompose.cjs --base-url http://127.0.0.1:5640 [--screens 02,05] [--maps <dir>]
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { chromium } = require("playwright");
const { decodePng, encodePng } = require("./png.cjs");
const { captureScreen } = require("./capture.cjs");
const { buildMask, PIXEL_TOLERANCE } = require("./compare.cjs");

const HERE = __dirname;
// Cause-map colours (--maps <dir>): glyph rasterization amber, type size or
// width orange, text position violet, text where the mock has none pink,
// icons teal, geometry red.
const CAUSE_COLOURS = { "text-raster": [245, 180, 0], "text-size": [234, 88, 12], "text-moved": [124, 58, 237], "text-extra": [219, 39, 119], icon: [13, 148, 136], geometry: [220, 38, 38] };
const FRAME = { width: 1586, height: 992 };
const DEFAULT_RAIL = 229;

function args(argv) {
  const out = { baseUrl: "http://127.0.0.1:5640", screens: null, out: path.join(HERE, "out", "decompose.json"), tol: 2 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--base-url") out.baseUrl = argv[++i];
    else if (argv[i] === "--screens") out.screens = argv[++i].split(",");
    else if (argv[i] === "--out") out.out = argv[++i];
    else if (argv[i] === "--tol") out.tol = Number(argv[++i]);
    else if (argv[i] === "--maps") out.maps = argv[++i];
  }
  return out;
}

const readBoxes = () => {
  const visible = (el) => {
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) > 0.05;
  };
  const lines = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.nodeValue && n.nodeValue.trim() && n.parentElement && visible(n.parentElement) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const range = document.createRange();
    range.selectNodeContents(n);
    const cs = getComputedStyle(n.parentElement);
    for (const r of Array.from(range.getClientRects())) {
      if (r.width < 1 || r.height < 1) continue;
      lines.push({ x: r.x, y: r.y, w: r.width, h: r.height, size: parseFloat(cs.fontSize), weight: cs.fontWeight, text: n.nodeValue.trim().slice(0, 40) });
    }
  }
  const icons = Array.from(document.querySelectorAll("svg, img"))
    .filter((el) => visible(el) && !el.closest("svg svg"))
    .map((el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })
    .filter((r) => r.w > 0 && r.h > 0);
  return { lines, icons };
};

const lum = (img, i) => 0.299 * img.data[i * 4] + 0.587 * img.data[i * 4 + 1] + 0.114 * img.data[i * 4 + 2];

// Ink box of a rectangle: pixels whose luminance is more than 60 from the
// rectangle's most common luminance (its background).
function inkBox(img, r) {
  const x0 = Math.max(0, Math.floor(r.x)), y0 = Math.max(0, Math.floor(r.y));
  const x1 = Math.min(img.width, Math.ceil(r.x + r.w)), y1 = Math.min(img.height, Math.ceil(r.y + r.h));
  const hist = new Array(52).fill(0);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) hist[Math.round(lum(img, y * img.width + x) / 5)]++;
  const bg = hist.indexOf(Math.max(...hist)) * 5;
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    if (Math.abs(lum(img, y * img.width + x) - bg) > 60) {
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
  }
  return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

function classifyLine(reference, capture, line, tol) {
  const box = { x: line.x - 2, y: line.y - 2, w: line.w + 4, h: line.h + 4 };
  const a = inkBox(capture, box);
  const r = inkBox(reference, box);
  if (!a) return "geometry";
  if (!r) return "text-extra";
  if (Math.abs(a.x - r.x) > tol || Math.abs(a.y - r.y) > tol) return "text-moved";
  if (Math.abs(a.h - r.h) <= 1 && Math.abs(a.w - r.w) <= Math.max(2, 0.03 * r.w)) return "text-raster";
  return "text-size";
}

async function main() {
  const o = args(process.argv.slice(2));
  const masksAll = JSON.parse(fs.readFileSync(path.join(HERE, "masks.json"), "utf8"));
  const landmarksAll = JSON.parse(fs.readFileSync(path.join(HERE, "landmarks.json"), "utf8"));
  const refs = fs.readdirSync(path.join(HERE, "reference")).filter((f) => /^\d\d-.*\.png$/.test(f));
  const screens = o.screens || refs.map((f) => f.slice(0, 2));
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const results = {};
  for (const screen of screens) {
    const landmarkSpec = landmarksAll[screen] || null;
    const rail = landmarkSpec && typeof landmarkSpec._rail === "number" ? landmarkSpec._rail : DEFAULT_RAIL;
    const outPng = path.join(os.tmpdir(), `decompose-${screen}.png`);
    const cap = await captureScreen(page, { baseUrl: o.baseUrl, screen, viewport: FRAME, outPng, maskSpec: masksAll[screen] || { selectors: [], rects: [] }, landmarkSpec, rail });
    const { lines, icons } = await page.evaluate(readBoxes);
    const reference = decodePng(fs.readFileSync(path.join(HERE, "reference", refs.find((f) => f.startsWith(`${screen}-`)))));
    const capture = decodePng(fs.readFileSync(outPng));
    const harness = path.join(HERE, "out", `${screen}-1586x992.png`);
    const sameAsHarness = fs.existsSync(harness) && Buffer.compare(fs.readFileSync(harness), fs.readFileSync(outPng)) === 0;
    const region = { x: rail + 3, y: 70, w: FRAME.width - rail - 3, h: FRAME.height - 70 };
    const mask = buildMask(FRAME.width, FRAME.height, cap.masks);
    const iconMask = buildMask(FRAME.width, FRAME.height, icons.map((r) => ({ x: r.x - 1, y: r.y - 1, w: r.w + 2, h: r.h + 2 })));
    const lineOf = new Int32Array(FRAME.width * FRAME.height).fill(-1);
    lines.forEach((l, k) => {
      for (let y = Math.max(0, Math.floor(l.y - 2)); y < Math.min(FRAME.height, Math.ceil(l.y + l.h + 2)); y++)
        for (let x = Math.max(0, Math.floor(l.x - 2)); x < Math.min(FRAME.width, Math.ceil(l.x + l.w + 2)); x++) lineOf[y * FRAME.width + x] = k;
    });
    const lineClass = lines.map((l) => classifyLine(reference, capture, l, o.tol));
    const buckets = { icon: 0, "text-raster": 0, "text-size": 0, "text-moved": 0, "text-extra": 0, geometry: 0 };
    // Cause map: the capture faded, each differing pixel in its cause's colour.
    const map = { width: FRAME.width, height: FRAME.height, data: new Uint8Array(capture.data.length) };
    for (let i = 0; i < FRAME.width * FRAME.height; i++) {
      const g = Math.round(lum(capture, i)); const f = 225 + Math.round((g / 255) * 30);
      map.data[i * 4] = f; map.data[i * 4 + 1] = f; map.data[i * 4 + 2] = f; map.data[i * 4 + 3] = 255;
    }
    const paint = (i, cause) => { const c = CAUSE_COLOURS[cause]; map.data[i * 4] = c[0]; map.data[i * 4 + 1] = c[1]; map.data[i * 4 + 2] = c[2]; };
    let compared = 0, different = 0;
    for (let y = region.y; y < region.y + region.h; y++) for (let x = region.x; x < region.x + region.w; x++) {
      const i = y * FRAME.width + x;
      if (mask[i]) continue;
      compared++;
      const p = i * 4;
      const d = Math.max(Math.abs(reference.data[p] - capture.data[p]), Math.abs(reference.data[p + 1] - capture.data[p + 1]), Math.abs(reference.data[p + 2] - capture.data[p + 2]));
      if (d <= PIXEL_TOLERANCE) continue;
      different++;
      const cause = iconMask[i] ? "icon" : lineOf[i] >= 0 ? lineClass[lineOf[i]] : "geometry";
      buckets[cause]++;
      paint(i, cause);
    }
    if (o.maps) { fs.mkdirSync(o.maps, { recursive: true }); fs.writeFileSync(path.join(o.maps, `${screen}.png`), encodePng(map)); }
    const pts = (n) => Math.round((n / compared) * 10000) / 100;
    const sizes = {};
    for (const l of lines) if (l.x > region.x && l.y > region.y) { const k = `${l.size}px/${l.weight}`; sizes[k] = (sizes[k] || 0) + 1; }
    results[screen] = {
      score: Math.round((100 - (different / compared) * 100) * 100) / 100,
      sameCaptureAsHarness: sameAsHarness,
      missingPoints: pts(different),
      points: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, pts(v)])),
      lines: lines.length,
      lineClasses: lineClass.reduce((m, c) => ((m[c] = (m[c] || 0) + 1), m), {}),
      textSizes: sizes,
    };
    const b = results[screen].points;
    process.stdout.write(`${screen}: score ${results[screen].score}% (capture ${sameAsHarness ? "identical to" : "DIFFERS from"} the harness capture) missing ${results[screen].missingPoints} pts = raster ${b["text-raster"]} + size ${b["text-size"]} + moved ${b["text-moved"]} + extra ${b["text-extra"]} + icon ${b.icon} + geometry ${b.geometry}\n`);
  }
  await browser.close();
  fs.writeFileSync(o.out, JSON.stringify({ generatedAt: new Date().toISOString(), frame: FRAME, resampled: false, screens: results }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
