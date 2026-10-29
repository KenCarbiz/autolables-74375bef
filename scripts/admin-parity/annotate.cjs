#!/usr/bin/env node
"use strict";
// Draws numbered review annotations on a capture: a box and a numbered badge
// per item, coloured by class, with a caption strip naming the revision and a
// legend of the classes used. "approved" is only for differences with a cited
// owner decision; other design choices are proposed exceptions.
//
//   node scripts/admin-parity/annotate.cjs <spec.json>
//
// spec.json: { "image": "<png>", "out": "<png>", "caption": "...",
//              "items": [{ "n": 1, "kind": "<a key of LABELS>", "x": 0, "y": 0, "w": 10, "h": 10 }] }

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { decodePng } = require("./png.cjs");

const COLORS = {
  approved: "#16a34a",
  geometry: "#7c3aed",
  behaviour: "#2563eb",
  asset: "#0d9488",
  rendering: "#d97706",
  masked: "#6b7280",
  fixture: "#a16207",
  mockonly: "#334155",
  responsive: "#db2777",
  defect: "#dc2626",
  corrected: "#0891b2",
};
const LABELS = {
  approved: "approved (cited owner decision)",
  geometry: "proposed exception: geometry / design choice",
  behaviour: "proposed exception: behaviour / truthful content",
  asset: "asset substitution (standard icon set)",
  rendering: "rendering difference",
  masked: "fixture data, masked under v2",
  fixture: "fixture data, not masked (scored)",
  mockonly: "mock-only annotation",
  responsive: "phone layout, no reference (not scored)",
  defect: "implementation defect",
  corrected: "defect corrected",
};

async function main() {
  const spec = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  const png = decodePng(fs.readFileSync(spec.image));
  const { width, height } = png;
  const b64 = fs.readFileSync(spec.image).toString("base64");
  const boxes = spec.items.map((it) => `
    <div style="position:absolute;left:${it.x}px;top:${it.y}px;width:${it.w}px;height:${it.h}px;border:3px solid ${COLORS[it.kind]};border-radius:6px;box-sizing:border-box"></div>
    <div style="position:absolute;left:${Math.max(0, it.x - 12)}px;top:${Math.max(0, it.y - 12)}px;width:26px;height:26px;border-radius:13px;background:${COLORS[it.kind]};color:#fff;font:700 15px/26px Arial,sans-serif;text-align:center;box-shadow:0 0 0 2px #fff">${it.n}</div>`).join("");
  const used = [...new Set(spec.items.map((i) => i.kind))];
  const unknown = used.filter((k) => !COLORS[k]);
  if (unknown.length) throw new Error(`unknown kind: ${unknown.join(", ")}`);
  const legend = used.map((k) => `<span style="display:inline-flex;align-items:center;gap:6px;margin:3px 18px 3px 0"><span style="width:14px;height:14px;border-radius:7px;background:${COLORS[k]}"></span>${LABELS[k]}</span>`).join("");
  const html = `<!doctype html><html><body style="margin:0;background:#fff">
    <div style="position:relative;width:${width}px;height:${height}px;background:url(data:image/png;base64,${b64}) no-repeat">${boxes}</div>
    <div style="width:${width}px;box-sizing:border-box;padding:8px 12px;font:13px/18px Arial,sans-serif;color:#111;background:#f3f4f6;border-top:1px solid #d1d5db">
      <div style="font-weight:700">${spec.caption}</div><div style="display:flex;flex-wrap:wrap;margin-top:4px">${legend}</div></div></body></html>`;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.setContent(html);
  fs.mkdirSync(path.dirname(spec.out), { recursive: true });
  await page.screenshot({ path: spec.out, fullPage: true });
  await browser.close();
  console.log(spec.out);
}

main().catch((e) => { console.error(e); process.exit(1); });
