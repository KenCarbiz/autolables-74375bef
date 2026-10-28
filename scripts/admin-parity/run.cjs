"use strict";
// Administration V2 visual parity harness.
//
//   bun run admin:parity                 capture, compare and report every registered fixture
//   bun run admin:parity -- --screens 01,12
//   bun run admin:parity -- --base-url http://127.0.0.1:8080   (reuse a running dev server)
//   bun run admin:parity -- --report-only   (rewrite the report from out/results.json, no capture)
//
// Frames: the originals are 1586x992, so the primary comparison renders the
// fixture at that exact frame and compares pixel for pixel; the protocol's
// 1600x1000 viewport is captured and compared against the reference resampled
// to that frame. Scores are reported for the full frame and for the content
// region to the right of the product rail and below the product header,
// which belong to the product shell, not to this refresh.

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { decodePng, encodePng, resample } = require("./png.cjs");
const { compareFrames, compareBody, findReferenceSectionRowBottom, checkLandmarks } = require("./compare.cjs");
const { startDevServer, listFixtures, captureScreen, responsiveCheck } = require("./capture.cjs");
const { writeReport } = require("./report.cjs");

const HERE = __dirname;
const ROOT = path.resolve(HERE, "..", "..");
const OUT = path.join(HERE, "out");
const EVIDENCE = path.join(HERE, "evidence");
const REFERENCE_DIR = path.join(HERE, "reference");

const REFERENCE_FRAME = { width: 1586, height: 992 };
const PROTOCOL_FRAME = { width: 1600, height: 1000 };
const RESPONSIVE = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
  { width: 1024, height: 768 },
  { width: 390, height: 844 },
];
// The fixture page draws the product rail 224px wide and the product header
// 64px tall; the references draw them at about 229 and 68. The content region
// starts just past the larger of each so neither shell edge is scored.
const CONTENT_REGION = (w, h) => ({ x: 232, y: 70, w: w - 232, h: h - 70 });

function parseArgs(argv) {
  const out = { screens: null, baseUrl: null, port: 5181, reportOnly: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--screens") out.screens = argv[++i].split(",").map((s) => s.trim());
    else if (argv[i] === "--base-url") out.baseUrl = argv[++i];
    else if (argv[i] === "--port") out.port = Number(argv[++i]);
    else if (argv[i] === "--report-only") out.reportOnly = true;
  }
  return out;
}

function referenceFor(screen) {
  if (!fs.existsSync(REFERENCE_DIR)) return null;
  const file = fs.readdirSync(REFERENCE_DIR).find((f) => f.startsWith(`${screen}-`) && f.endsWith(".png"));
  return file ? path.join(REFERENCE_DIR, file) : null;
}

const scaleRects = (rects, sx, sy) => rects.map((r) => ({ ...r, x: r.x * sx, y: r.y * sy, w: r.w * sx, h: r.h * sy }));

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.reportOnly) {
    const previous = JSON.parse(fs.readFileSync(path.join(OUT, "results.json"), "utf8"));
    writeReport(previous, path.join(ROOT, "ADMIN_V2_PARITY_REPORT.md"));
    process.stdout.write(`report: ADMIN_V2_PARITY_REPORT.md (from out/results.json captured ${previous.generatedAt})\n`);
    return;
  }
  const masksAll = JSON.parse(fs.readFileSync(path.join(HERE, "masks.json"), "utf8"));
  const landmarksAll = JSON.parse(fs.readFileSync(path.join(HERE, "landmarks.json"), "utf8"));
  fs.mkdirSync(OUT, { recursive: true });
  fs.mkdirSync(EVIDENCE, { recursive: true });

  let server = null;
  let baseUrl = args.baseUrl;
  if (!baseUrl) {
    server = await startDevServer({ cwd: ROOT, port: args.port });
    baseUrl = `http://127.0.0.1:${args.port}`;
  }
  const browser = await chromium.launch();
  const results = { generatedAt: new Date().toISOString(), baseUrl, referenceFrame: REFERENCE_FRAME, protocolFrame: PROTOCOL_FRAME, screens: [] };
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    const registered = await listFixtures(page, baseUrl);
    const byNumber = (a, b) => Number(a) - Number(b) || a.localeCompare(b);
    const screens = (args.screens ? args.screens.filter((s) => registered.includes(s)) : registered).slice().sort(byNumber);
    const skipped = (args.screens || []).filter((s) => !registered.includes(s));
    results.registered = registered;
    results.skipped = skipped;
    for (const screen of screens) {
      const entry = { screen, reference: null, fonts: null, masks: [], frames: {}, landmarks: null, responsive: [] };
      try {
      await measureScreen(entry);
      } catch (err) {
        // One screen that fails to render must not hide the others; the report shows the failure.
        entry.error = String(err && err.message ? err.message : err).split("\n")[0];
        entry.gate = { landmarks: null, responsive: false, contentParity: null, pass: false, error: entry.error };
        results.screens.push(entry);
        process.stdout.write(`${screen}: ERROR ${entry.error}\n`);
      }
    }
    async function measureScreen(entry) {
      const { screen } = entry;
      const maskSpec = masksAll[screen] || { selectors: [], rects: [] };
      const landmarkSpec = landmarksAll[screen] || null;
      const refPath = referenceFor(screen);
      entry.reference = refPath ? path.relative(ROOT, refPath) : null;
      const reference = refPath ? decodePng(fs.readFileSync(refPath)) : null;

      for (const [label, frame] of [["reference", REFERENCE_FRAME], ["protocol", PROTOCOL_FRAME]]) {
        const outPng = path.join(OUT, `${screen}-${frame.width}x${frame.height}.png`);
        // A screen may pin its own alignment anchor in landmarks.json: `_anchor: { reference: <y of the row the body starts on>, selector: "<element whose bottom is that row in the capture>" }`.
        // Child screens use it because their mocks have no section row under the title, or carry a chip the underline detector would pick.
        const anchorSpec = landmarkSpec && landmarkSpec._anchor ? landmarkSpec._anchor : null;
        const cap = await captureScreen(page, { baseUrl, screen, viewport: frame, outPng, maskSpec, landmarkSpec, anchorSelector: anchorSpec ? anchorSpec.selector : null });
        entry.fonts = cap.fonts;
        const frameResult = { file: path.relative(ROOT, outPng), masks: cap.masks.length };
        if (label === "reference") {
          entry.masks = cap.masks;
          entry.anchors = anchorSpec
            ? { referenceTop: typeof anchorSpec.reference === "number" ? anchorSpec.reference : null, captureTop: cap.anchors ? cap.anchors.custom : null, h1Bottom: cap.anchors ? cap.anchors.h1Bottom : null, pinned: true }
            : { referenceTop: reference ? findReferenceSectionRowBottom(reference, CONTENT_REGION(frame.width, frame.height)) : null, captureTop: cap.anchors ? cap.anchors.sectionNavBottom : null, h1Bottom: cap.anchors ? cap.anchors.h1Bottom : null, pinned: false };
          entry.landmarks = landmarkSpec ? checkLandmarks(Object.fromEntries(Object.entries(landmarkSpec).filter(([k]) => !k.startsWith("_") && k !== "tolerance")), cap.landmarks, landmarksAll.tolerance ?? 16, entry.anchors) : null;
          entry.measuredLandmarks = cap.landmarks;
        }
        if (reference) {
          const ref = resample(reference, frame.width, frame.height);
          const capture = decodePng(fs.readFileSync(outPng));
          const sx = frame.width / REFERENCE_FRAME.width;
          const sy = frame.height / REFERENCE_FRAME.height;
          const rects = label === "reference" ? cap.masks : scaleRects(cap.masks, 1, 1);
          const cmp = compareFrames({ reference: ref, capture, masks: rects, contentRegion: CONTENT_REGION(frame.width, frame.height) });
          const diffPath = path.join(OUT, `${screen}-${frame.width}x${frame.height}-diff.png`);
          fs.writeFileSync(diffPath, encodePng(cmp.diff));
          frameResult.diff = path.relative(ROOT, diffPath);
          frameResult.maskedPercent = cmp.maskedPercent;
          frameResult.full = cmp.full;
          frameResult.content = cmp.content;
          frameResult.referenceResampled = sx !== 1 || sy !== 1;
          if (label === "reference") {
            frameResult.body = compareBody({ reference: ref, capture, masks: rects, contentRegion: CONTENT_REGION(frame.width, frame.height), referenceTop: entry.anchors.referenceTop, captureTop: entry.anchors.captureTop });
            fs.copyFileSync(outPng, path.join(EVIDENCE, `${screen}-${frame.width}x${frame.height}.png`));
            fs.copyFileSync(diffPath, path.join(EVIDENCE, `${screen}-${frame.width}x${frame.height}-diff.png`));
          }
        } else {
          frameResult.note = "no reference image in scripts/admin-parity/reference";
        }
        entry.frames[label] = frameResult;
      }
      entry.responsive = await responsiveCheck(page, { baseUrl, screen, viewports: RESPONSIVE, outDir: OUT });
      const r = entry.frames.reference;
      const gate = {
        landmarks: entry.landmarks ? entry.landmarks.every((l) => l.ok) : null,
        responsive: entry.responsive.every((x) => x.ok),
        contentParity: r && r.content ? r.content.parityPercent : null,
      };
      gate.bodyParity = r && r.body ? r.body.parityPercent : null;
      gate.pass = gate.landmarks !== false && gate.responsive && (gate.contentParity === null || gate.contentParity >= 97);
      // The documented title-block exception: the same gate with the body score standing in for the content score.
      gate.passWithTitleException = gate.landmarks !== false && gate.responsive && (gate.bodyParity === null ? gate.pass : gate.bodyParity >= 97);
      entry.gate = gate;
      results.screens.push(entry);
      const summary = r && r.full ? `full ${r.full.parityPercent.toFixed(2)}% · content ${r.content.parityPercent.toFixed(2)}% · structure ${r.content.structuralPercent.toFixed(2)}%${r.body ? ` · body ${r.body.parityPercent.toFixed(2)}% (offset ${r.body.offset >= 0 ? "+" : ""}${r.body.offset}px)` : ""}` : "no reference";
      process.stdout.write(`${screen}: ${summary}; landmarks ${gate.landmarks === null ? "n/a" : gate.landmarks ? "ok" : "FAIL"}; responsive ${gate.responsive ? "ok" : "OVERFLOW"}; gate ${gate.pass ? "PASS" : "FAIL"}\n`);
    }
  } finally {
    await browser.close();
    if (server) server.stop();
  }
  fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 2));
  writeReport(results, path.join(ROOT, "ADMIN_V2_PARITY_REPORT.md"));
  process.stdout.write(`report: ADMIN_V2_PARITY_REPORT.md\n`);
}

main().catch((err) => {
  process.stderr.write(`${err && err.stack ? err.stack : err}\n`);
  process.exit(1);
});
