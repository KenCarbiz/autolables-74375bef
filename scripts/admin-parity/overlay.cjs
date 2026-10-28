#!/usr/bin/env node
"use strict";
// Reference / actual / overlay sheets at the protocol frame (v2: native 1586x992; --v1: 1600x1000), with
// nothing masked out of the pictures so every label stays readable.
//
//   node scripts/admin-parity/overlay.cjs            every screen in out/results.json
//   node scripts/admin-parity/overlay.cjs 10,11      selected screens
//
// Per screen it writes evidence/overlay/<NN>.png with four panels:
//   Reference   the original, as the protocol scores it (resampled only under --v1)
//   Actual      the capture at the same frame
//   Overlay     reference luminance in red, actual luminance in green and blue:
//               grey where they agree, cyan where only the reference has ink,
//               red where only the implementation has ink
//   Differences the actual faded, every pixel past the protocol threshold
//               (any channel more than 32/255) in magenta, the scored content
//               region outlined in blue and each permitted mask outlined in
//               orange with nothing hidden underneath

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { decodePng, encodePng, resample } = require("./png.cjs");

const HERE = __dirname;
const ROOT = path.resolve(HERE, "..", "..");
const DEST = path.join(HERE, "evidence", "overlay");
// Protocol v2 (default) compares at the native 1586x992 frame; pass --v1 for the historical resampled 1600x1000 frame.
const V1 = process.argv.includes("--v1");
const W = V1 ? 1600 : 1586;
const H = V1 ? 1000 : 992;
const THRESHOLD = 32;

const only = process.argv.find((a) => /^\d\d(,\d\d)*$/.test(a))?.split(",") ?? null;
const results = JSON.parse(fs.readFileSync(path.join(HERE, "out", "results.json"), "utf8"));
const landmarks = JSON.parse(fs.readFileSync(path.join(HERE, "landmarks.json"), "utf8"));
const lum = (d, i) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
const uri = (buf) => `data:image/png;base64,${buf.toString("base64")}`;
const pct = (n) => (typeof n === "number" ? `${n.toFixed(2)}%` : "n/a");

function panels(ref, cap, masks, region) {
  const n = W * H * 4;
  const over = new Uint8Array(n);
  const diff = new Uint8Array(n);
  for (let i = 0; i < n; i += 4) {
    const r = lum(ref.data, i);
    const a = lum(cap.data, i);
    over[i] = r; over[i + 1] = a; over[i + 2] = a; over[i + 3] = 255;
    const moved = Math.max(Math.abs(ref.data[i] - cap.data[i]), Math.abs(ref.data[i + 1] - cap.data[i + 1]), Math.abs(ref.data[i + 2] - cap.data[i + 2])) > THRESHOLD;
    if (moved) { diff[i] = 214; diff[i + 1] = 0; diff[i + 2] = 160; }
    else for (let c = 0; c < 3; c++) diff[i + c] = 255 - (255 - cap.data[i + c]) * 0.35;
    diff[i + 3] = 255;
  }
  const outline = (rect, rgb, t) => {
    const x0 = Math.max(0, Math.round(rect.x)), y0 = Math.max(0, Math.round(rect.y));
    const x1 = Math.min(W - 1, Math.round(rect.x + rect.w)), y1 = Math.min(H - 1, Math.round(rect.y + rect.h));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      if (x - x0 >= t && x1 - x >= t && y - y0 >= t && y1 - y >= t) continue;
      const o = (y * W + x) * 4; diff[o] = rgb[0]; diff[o + 1] = rgb[1]; diff[o + 2] = rgb[2];
    }
  };
  outline(region, [36, 87, 214], 2);
  for (const m of masks) outline(m, [232, 128, 0], 2);
  return { over: { width: W, height: H, data: over }, diff: { width: W, height: H, data: diff } };
}

(async () => {
  fs.mkdirSync(DEST, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1, viewport: { width: 2 * W + 72, height: 1000 } });
  for (const entry of results.screens) {
    if (only && !only.includes(entry.screen)) continue;
    const P = V1 ? entry.frames.protocol : entry.frames.reference;
    const ref = resample(decodePng(fs.readFileSync(path.join(ROOT, entry.reference))), W, H);
    const cap = decodePng(fs.readFileSync(path.join(ROOT, P.file)));
    const rail = Math.round((landmarks[entry.screen]._rail * W) / 1586);
    const maskRects = V1 ? (P.maskRects || []) : (entry.masks || []);
    const region = { x: rail + 3, y: 70, w: W - rail - 3, h: H - 70 };
    const { over, diff } = panels(ref, cap, maskRects, region);
    const cell = (title, sub, buf) => `<figure><figcaption><b>${title}</b> <span>${sub}</span></figcaption><img src="${uri(buf)}"></figure>`;
    await page.setContent(`<html><body style="margin:0;padding:24px;background:#E9EDF3;font:22px Inter,Arial,sans-serif;color:#17263C">
      <h2 style="margin:0 0 6px">${entry.screen} · ${path.basename(entry.reference)} · protocol ${V1 ? "v1 (historical)" : "v2"} · ${W}x${H}, DPR 1</h2>
      <p style="margin:0 0 18px">Protocol score (masks applied): full ${pct(P.full.parityPercent)} · content ${pct(P.content.parityPercent)} · structure (8x8 SSIM, content) ${pct(P.content.structuralPercent)} · masked ${pct(P.maskedPercent)} of the frame · target 95% ${P.content.parityPercent >= 95 ? "met" : "not met"}</p>
      <div style="display:grid;grid-template-columns:${W}px ${W}px;gap:24px">
        ${cell("Reference", V1 ? "original resampled to 1600x1000 (v1)" : "original at native size, not resized (v2)", encodePng(ref))}
        ${cell("Actual", "fixture capture, unmasked", encodePng(cap))}
        ${cell("Overlay", "grey = both · cyan = reference only · red = implementation only", encodePng(over))}
        ${cell("Differences", "magenta = pixel past 32/255 · blue = scored region · orange = permitted mask (contents still shown)", encodePng(diff))}
      </div>
      <style>figure{margin:0}figcaption{height:34px;white-space:nowrap;overflow:hidden}figcaption span{color:#596A80}img{display:block;width:${W}px;height:${H}px;border:1px solid #B8C3D2}</style></body></html>`);
    await page.screenshot({ path: path.join(DEST, `${entry.screen}.png`), fullPage: true });
    process.stdout.write(`${entry.screen}: evidence/overlay/${entry.screen}.png\n`);
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
