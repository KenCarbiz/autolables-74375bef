#!/usr/bin/env node
"use strict";
// Composes review sheets from captures: before/after pairs and labelled
// contact sheets of interaction states. Each panel can be cropped and scaled;
// a title strip names the revisions. Pixels are copied, never redrawn.
//
//   node scripts/admin-parity/compose.cjs <spec.json>
//
// spec.json: { "out": "<png>", "title": "...", "columns": 2, "panelWidth": 760,
//              "panels": [{ "image": "<png>", "label": "...", "tone": "before|after|state",
//                           "crop": { "x": 0, "y": 0, "w": 100, "h": 100 } }] }

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { decodePng } = require("./png.cjs");

const TONE = { before: "#dc2626", after: "#0891b2", state: "#334155" };

async function main() {
  const spec = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  const columns = spec.columns || 2;
  const panelWidth = spec.panelWidth || 760;
  const panels = spec.panels.map((p) => {
    const png = decodePng(fs.readFileSync(p.image));
    const crop = p.crop || { x: 0, y: 0, w: png.width, h: png.height };
    const scale = Math.min(1, panelWidth / crop.w);
    const w = Math.round(crop.w * scale);
    const h = Math.round(crop.h * scale);
    const b64 = fs.readFileSync(p.image).toString("base64");
    return `<figure style="margin:0;width:${panelWidth}px">
      <figcaption style="font:600 13px/18px Arial,sans-serif;color:#fff;background:${TONE[p.tone || "state"]};padding:5px 8px;border-radius:6px 6px 0 0">${p.label}</figcaption>
      <div style="width:${w}px;height:${h}px;border:1px solid #d1d5db;background:url(data:image/png;base64,${b64}) no-repeat;background-size:${Math.round(png.width * scale)}px ${Math.round(png.height * scale)}px;background-position:${-Math.round(crop.x * scale)}px ${-Math.round(crop.y * scale)}px"></div>
    </figure>`;
  }).join("");
  const width = columns * panelWidth + (columns - 1) * 16 + 32;
  const html = `<!doctype html><html><body style="margin:0;background:#fff">
    <div style="padding:16px;width:${width - 32}px">
      <div style="font:700 15px/20px Arial,sans-serif;color:#111;margin-bottom:12px">${spec.title}</div>
      <div style="display:grid;grid-template-columns:repeat(${columns},${panelWidth}px);gap:16px;align-items:start">${panels}</div>
    </div></body></html>`;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width, height: 400 }, deviceScaleFactor: 1 });
  await page.setContent(html);
  fs.mkdirSync(path.dirname(spec.out), { recursive: true });
  await page.screenshot({ path: spec.out, fullPage: true });
  await browser.close();
  console.log(spec.out);
}

main().catch((e) => { console.error(e); process.exit(1); });
