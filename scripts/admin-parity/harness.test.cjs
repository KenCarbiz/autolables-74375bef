"use strict";
// Unit tests for the harness internals. Run with: node --test scripts/admin-parity/harness.test.cjs
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { decodePng, encodePng, resample } = require("./png.cjs");
const { compareFrames, checkLandmarks, buildMask, PIXEL_TOLERANCE } = require("./compare.cjs");
const { writeReport } = require("./report.cjs");

const solid = (width, height, [r, g, b]) => {
  const data = new Uint8Array(width * height * 4);
  for (let o = 0; o < data.length; o += 4) {
    data[o] = r; data[o + 1] = g; data[o + 2] = b; data[o + 3] = 255;
  }
  return { width, height, data };
};

const paint = (img, x0, y0, w, h, [r, g, b]) => {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const o = (y * img.width + x) * 4;
      img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b;
    }
  }
  return img;
};

test("png encode and decode round-trip every channel", () => {
  const img = solid(20, 12, [0, 0, 0]);
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] = i % 251; img.data[i + 1] = (i * 7) % 253; img.data[i + 2] = (i * 13) % 255;
  }
  const back = decodePng(encodePng(img));
  assert.equal(back.width, 20);
  assert.equal(back.height, 12);
  assert.deepEqual(Array.from(back.data), Array.from(img.data));
});

test("resample keeps a flat colour while changing the frame", () => {
  const small = resample(solid(40, 24, [200, 100, 50]), 20, 12);
  assert.equal(small.width, 20);
  assert.equal(small.height, 12);
  for (let o = 0; o < small.data.length; o += 4) {
    assert.deepEqual(Array.from(small.data.slice(o, o + 3)), [200, 100, 50]);
  }
});

test("identical frames score full parity and full structure", () => {
  const a = paint(solid(64, 64, [240, 240, 240]), 8, 8, 16, 16, [20, 40, 60]);
  const b = { ...a, data: new Uint8Array(a.data) };
  const r = compareFrames({ reference: a, capture: b, masks: [], contentRegion: { x: 16, y: 16, w: 48, h: 48 } });
  assert.equal(r.full.parityPercent, 100);
  assert.ok(r.full.structuralPercent > 99.99);
  assert.equal(r.full.compared, 64 * 64);
  assert.equal(r.content.compared, 48 * 48);
  assert.equal(r.content.parityPercent, 100);
});

test("a moved element lowers parity and structure; a mask over it restores parity", () => {
  const a = paint(solid(64, 64, [255, 255, 255]), 8, 8, 16, 16, [0, 0, 0]);
  const b = paint(solid(64, 64, [255, 255, 255]), 8, 24, 16, 16, [0, 0, 0]);
  const open = compareFrames({ reference: a, capture: b, masks: [] });
  assert.equal(open.full.pixelDiffPercent, 12.5);
  assert.ok(open.full.structuralPercent < 100);
  const masked = compareFrames({ reference: a, capture: b, masks: [{ x: 8, y: 8, w: 16, h: 32 }] });
  assert.equal(masked.full.parityPercent, 100);
  assert.equal(masked.maskedPixels, 16 * 32);
});

test("a shift at the channel tolerance is not a difference; one past it is", () => {
  const a = solid(16, 16, [100, 100, 100]);
  const at = solid(16, 16, [100 + PIXEL_TOLERANCE, 100, 100]);
  const past = solid(16, 16, [100 + PIXEL_TOLERANCE + 1, 100, 100]);
  assert.equal(compareFrames({ reference: a, capture: at }).full.parityPercent, 100);
  assert.equal(compareFrames({ reference: a, capture: past }).full.parityPercent, 0);
});

test("the diff image marks differing pixels red and masked pixels blue", () => {
  const a = solid(16, 16, [255, 255, 255]);
  const b = paint(solid(16, 16, [255, 255, 255]), 0, 0, 4, 4, [0, 0, 0]);
  const r = compareFrames({ reference: a, capture: b, masks: [{ x: 8, y: 8, w: 4, h: 4 }] });
  const px = (x, y) => Array.from(r.diff.data.slice((y * 16 + x) * 4, (y * 16 + x) * 4 + 3));
  assert.deepEqual(px(0, 0), [220, 38, 38]);
  const m = px(8, 8);
  assert.ok(m[2] > m[0] && m[2] > m[1]);
});

test("buildMask clips rectangles to the frame", () => {
  const m = buildMask(10, 10, [{ x: -5, y: 8, w: 8, h: 10 }]);
  let n = 0;
  for (const v of m) n += v;
  assert.equal(n, 3 * 2);
});

test("landmarks pass within tolerance and fail beyond it or when missing", () => {
  const rows = checkLandmarks(
    { a: { x: 100, y: 200, w: 50 }, b: { x: 100, y: 200 }, c: { x: 1 } },
    { a: { x: 110, y: 190, w: 66, h: 1 }, b: { x: 117, y: 200, w: 1, h: 1 } },
    16,
  );
  const byName = Object.fromEntries(rows.map((r) => [r.name, r]));
  assert.equal(byName.a.ok, true);
  assert.deepEqual(byName.a.deltas, { x: 10, y: -10, w: 16 });
  assert.equal(byName.b.ok, false);
  assert.equal(byName.b.deltas.x, 17);
  assert.equal(byName.c.ok, false);
  assert.match(byName.c.note, /not found/);
});

test("reference originals decode at the native 1586x992 frame", (t) => {
  const dir = path.join(__dirname, "reference");
  if (!fs.existsSync(dir)) return t.skip("no reference folder");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".png"));
  assert.equal(files.length, 13);
  for (const f of files) {
    const img = decodePng(fs.readFileSync(path.join(dir, f)));
    assert.equal(`${img.width}x${img.height}`, "1586x992", f);
  }
});

test("the report states the gate, each landmark and each breakpoint", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "parity-"));
  const out = path.join(dir, "report.md");
  writeReport({
    generatedAt: "2026-01-01T00:00:00.000Z",
    referenceFrame: { width: 1586, height: 992 },
    protocolFrame: { width: 1600, height: 1000 },
    registered: ["01"],
    skipped: [],
    screens: [{
      screen: "01",
      reference: "ref.png",
      fonts: { inter: true, loaded: ["Inter"] },
      masks: [{ reason: "counts" }],
      frames: {
        reference: { file: "a.png", maskedPercent: 1, full: { parityPercent: 90, structuralPercent: 70 }, content: { parityPercent: 88, structuralPercent: 60 }, diff: "d.png" },
        protocol: { file: "b.png", note: "no reference image" },
      },
      landmarks: [{ name: "title", ok: false, expected: { selector: "h1", heading: "Administration", x: 1 }, measured: { x: 30, y: 0, w: 0, h: 0 }, deltas: { x: 29 } }],
      responsive: [{ viewport: "390x844", ok: false, scrollWidth: 442, innerWidth: 390, maxRight: 1282, scrollRegions: ["nav"], file: "r.png" }],
      gate: { landmarks: false, responsive: false, contentParity: 88, pass: false },
    }],
  }, out, { acceptance: {} });
  const text = fs.readFileSync(out, "utf8");
  assert.match(text, /Gate: FAIL \(landmarks out of tolerance; page overflow at a breakpoint; protocol v2 content parity 88\.00% is below 95%\)/);
  assert.match(text, /\| title \| OUT of tolerance \| x=1 \| x=30 y=0 w=0 h=0 \| x\+29 \|/);
  assert.doesNotMatch(text, /NaN/);
  assert.match(text, /\| 390x844 \| OVERFLOW \| 442 \| 390 \| 1282 \| nav \|/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the acceptance register carries an owner acceptance only while the score and mask share still match", () => {
  const { acceptanceState } = require("./report.cjs");
  const record = { decision: "individually accepted with listed exceptions", date: "2026-10-29", score: 92.99, maskedPercent: 3.94, implementation: "abc1234", evidence: "def5678", exceptions: "10.18" };
  const screen = (score, masked) => ({ screen: "01", frames: { reference: { maskedPercent: masked, content: { parityPercent: score } } } });
  assert.equal(acceptanceState(screen(92.99, 3.94), { "01": record }).status, "accepted");
  assert.equal(acceptanceState(screen(92.98, 3.94), { "01": record }).status, "needs review");
  assert.equal(acceptanceState(screen(92.99, 4.1), { "01": record }).status, "needs review");
  assert.equal(acceptanceState(screen(92.99, 3.94), {}).status, "pending");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "parity-"));
  const out = path.join(dir, "report.md");
  writeReport({
    generatedAt: "2026-01-01T00:00:00.000Z",
    referenceFrame: { width: 1586, height: 992 },
    protocolFrame: { width: 1600, height: 1000 },
    registered: ["01"],
    skipped: [],
    screens: [{ ...screen(92.99, 3.94), reference: "r.png", fonts: { inter: true, loaded: [] }, masks: [], responsive: [], gate: { landmarks: true, responsive: true, contentParity: 92.99 } }],
  }, out, { acceptance: { "01": record } });
  const text = fs.readFileSync(out, "utf8");
  assert.match(text, /Gate: FAIL \(protocol v2 content parity 92\.99% is below 95%\)\. Individually accepted with listed exceptions by the owner on 2026-10-29 \(appearance only\) at 92\.99% with 3\.94% of the frame masked/);
  assert.match(text, /This is not a 95% or 94% pass\./);
  assert.match(text, /\| 01 \| individually accepted with listed exceptions \(2026-10-29\) \| 92\.99% \| 3\.94% \| abc1234 \| def5678 \|/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the committed register accepts exactly 01, 06, 08 and 12", () => {
  const reg = JSON.parse(fs.readFileSync(path.join(__dirname, "acceptance.json"), "utf8"));
  assert.deepEqual(Object.keys(reg).filter((k) => !k.startsWith("_")).sort(), ["01", "06", "08", "12"]);
});
