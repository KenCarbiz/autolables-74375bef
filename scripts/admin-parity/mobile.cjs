#!/usr/bin/env node
"use strict";
// Actual-viewport captures for narrow screens: the first viewport, then one
// capture per further viewport height as the page scrolls, for each screen.
// Also records page overflow and every horizontally scrolling region (with
// whether it is keyboard-focusable and labelled).
//
//   node scripts/admin-parity/mobile.cjs --base-url http://127.0.0.1:5192 --out <dir> [--screens 02,11] [--sizes 390x844,320x568]

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const BASE = arg("--base-url", "http://127.0.0.1:5192");
const OUT = arg("--out", path.join(__dirname, "out", "mobile"));
const SIZES = arg("--sizes", "390x844,320x568").split(",").map((s) => s.split("x").map(Number));
const LM = JSON.parse(fs.readFileSync(path.join(__dirname, "landmarks.json"), "utf8"));
const only = arg("--screens", null);
const screens = Object.keys(LM).filter((k) => /^\d\d$/.test(k) && (!only || only.split(",").includes(k)));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const report = [];
  for (const s of screens) for (const [w, h] of SIZES) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    await page.goto(`${BASE}/admin/design-fixture/${s}`, { waitUntil: "networkidle" });
    await page.waitForSelector(`[data-admin-fixture="${s}"]`);
    await page.evaluate(() => document.fonts.ready);
    const info = await page.evaluate(() => {
      const doc = document.documentElement;
      const regions = [...document.querySelectorAll("*")].filter((el) => { const cs = getComputedStyle(el); return /(auto|scroll)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 1; })
        .map((el) => ({ label: el.getAttribute("aria-label") || el.closest("nav")?.getAttribute("aria-label") || el.tagName.toLowerCase(), focusable: el.tabIndex >= 0, hidden: el.scrollWidth - el.clientWidth }));
      return { pageOverflow: doc.scrollWidth - doc.clientWidth, height: doc.scrollHeight, regions };
    });
    const steps = Math.min(10, Math.ceil(info.height / h));
    for (let i = 0; i < steps; i++) {
      await page.evaluate((y) => window.scrollTo(0, y), i * (h - 60));
      await page.waitForTimeout(120);
      await page.screenshot({ path: path.join(OUT, `${s}-${w}x${h}-${String(i).padStart(2, "0")}.png`) });
    }
    report.push({ screen: s, viewport: `${w}x${h}`, pageOverflowPx: info.pageOverflow, pageHeight: info.height, captures: steps, scrollRegions: info.regions });
    await page.close();
  }
  fs.writeFileSync(path.join(OUT, "mobile.json"), JSON.stringify(report, null, 1));
  for (const r of report) process.stdout.write(`${r.screen} ${r.viewport}: overflow ${r.pageOverflowPx}px, ${r.captures} captures, scroll regions ${r.scrollRegions.map((x) => `${x.label}${x.focusable ? "" : " [not focusable]"} +${x.hidden}`).join("; ") || "none"}\n`);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
