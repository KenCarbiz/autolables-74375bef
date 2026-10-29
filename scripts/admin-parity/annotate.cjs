#!/usr/bin/env node
"use strict";
// Draws numbered review annotations on a capture: a box and a numbered badge
// per item, coloured by class (approved design change, rendering difference,
// implementation defect), with a caption strip naming the revision.
//
//   node scripts/admin-parity/annotate.cjs <spec.json>
//
// spec.json: { "image": "<png>", "out": "<png>", "caption": "...",
//              "items": [{ "n": 1, "kind": "approved|rendering|defect", "x": 0, "y": 0, "w": 10, "h": 10 }] }

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { decodePng } = require("./png.cjs");

const COLORS = { approved: "#16a34a", rendering: "#d97706", defect: "#dc2626" };
const LABELS = { approved: "approved design change", rendering: "rendering difference", defect: "implementation defect" };

async function main() {
  const spec = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  const png = decodePng(fs.readFileSync(spec.image));
  const { width, height } = png;
  const strip = 44;
  const b64 = fs.readFileSync(spec.image).toString("base64");
  const boxes = spec.items.map((it) => `
    <div style="position:absolute;left:${it.x}px;top:${it.y}px;width:${it.w}px;height:${it.h}px;border:3px solid ${COLORS[it.kind]};border-radius:6px;box-sizing:border-box"></div>
    <div style="position:absolute;left:${Math.max(0, it.x - 12)}px;top:${Math.max(0, it.y - 12)}px;width:26px;height:26px;border-radius:13px;background:${COLORS[it.kind]};color:#fff;font:700 15px/26px Arial,sans-serif;text-align:center;box-shadow:0 0 0 2px #fff">${it.n}</div>`).join("");
  const used = [...new Set(spec.items.map((i) => i.kind))];
  const legend = used.map((k) => `<span style="display:inline-flex;align-items:center;gap:6px;margin-right:18px"><span style="width:14px;height:14px;border-radius:7px;background:${COLORS[k]}"></span>${LABELS[k]}</span>`).join("");
  const html = `<!doctype html><html><body style="margin:0;background:#fff">
    <div style="position:relative;width:${width}px;height:${height}px;background:url(data:image/png;base64,${b64}) no-repeat">${boxes}</div>
    <div style="height:${strip}px;display:flex;align-items:center;justify-content:space-between;padding:0 12px;font:13px Arial,sans-serif;color:#111;background:#f3f4f6;border-top:1px solid #d1d5db">
      <span>${spec.caption}</span><span>${legend}</span></div></body></html>`;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width, height: height + strip }, deviceScaleFactor: 1 });
  await page.setContent(html);
  fs.mkdirSync(path.dirname(spec.out), { recursive: true });
  await page.screenshot({ path: spec.out });
  await browser.close();
  console.log(spec.out);
}

main().catch((e) => { console.error(e); process.exit(1); });
