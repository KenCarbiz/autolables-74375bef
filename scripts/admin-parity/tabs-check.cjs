#!/usr/bin/env node
"use strict";
// Shared section and child tab rows where they scroll sideways: for each
// screen and viewport, whether the edge fade shows, whether the active tab is
// fully visible clear of the fades, and, tabbing through every tab with the
// keyboard, whether each focused tab comes fully into view (clear of the
// fades) with its focus indicator unclipped. Also checks page-level overflow
// and that touch/trackpad scrolling reaches the last tab.
//
//   node scripts/admin-parity/tabs-check.cjs --base-url http://127.0.0.1:5640 [--screens 01,08,12] [--sizes 1366x768,1024x768,390x844] [--out <dir>]

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const BASE = arg("--base-url", "http://127.0.0.1:5640");
const OUT = arg("--out", null);
const SCREENS = arg("--screens", "01,08,12").split(",");
const SIZES = arg("--sizes", "1366x768,1024x768,390x844").split(",").map((s) => s.split("x").map(Number));

// Measures one tab against its scroll region: visible inside the region and
// clear of whichever fade is showing, and its focus outline inside the
// region's clip box.
const measure = (a) => {
  const region = a.closest("[aria-label$='(scrolls sideways)'], .overflow-x-auto");
  const wrap = region?.parentElement;
  const r = a.getBoundingClientRect();
  const c = region ? region.getBoundingClientRect() : { left: 0, right: innerWidth, top: 0, bottom: innerHeight };
  const fades = wrap ? [...wrap.querySelectorAll(":scope > span[aria-hidden='true']")].map((f) => ({ r: f.getBoundingClientRect(), on: getComputedStyle(f).opacity !== "0" })) : [];
  const leftFade = fades[0]?.on ? fades[0].r.right : c.left;
  const rightFade = fades[1]?.on ? fades[1].r.left : c.right;
  const cs = getComputedStyle(a);
  const ow = parseFloat(cs.outlineWidth) || 0;
  const oo = parseFloat(cs.outlineOffset) || 0;
  const ext = cs.outlineStyle !== "none" ? ow + oo : 0;
  return {
    label: a.textContent.trim(),
    inRegion: r.left >= c.left - 0.5 && r.right <= c.right + 0.5,
    clearOfFades: r.left >= leftFade - 0.5 && r.right <= rightFade + 0.5,
    outlineClipped: ext > 0 && (r.top - ext < c.top - 0.5 || r.bottom + ext > c.bottom + 0.5 || r.left - ext < c.left - 0.5 || r.right + ext > c.right + 0.5),
    outline: `${cs.outlineStyle} ${ow}px offset ${oo}px`,
  };
};

async function run() {
  const browser = await chromium.launch();
  const results = [];
  let failures = 0;
  for (const screen of SCREENS) {
    for (const [w, h] of SIZES) {
      const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
      await page.goto(`${BASE}/admin/design-fixture/${screen}`, { waitUntil: "networkidle" });
      await page.waitForSelector(`[data-admin-fixture="${screen}"]`);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(200);
      const navs = await page.$$eval("nav[aria-label]", (ns) => ns.map((n) => n.getAttribute("aria-label")).filter((l) => /sections|views/.test(l)));
      for (const nav of navs) {
        const sel = `nav[aria-label="${nav}"]`;
        const info = await page.evaluate((s) => {
          const n = document.querySelector(s);
          const region = n.querySelector(".overflow-x-auto");
          const fades = [...region.parentElement.querySelectorAll(":scope > span[aria-hidden='true']")].map((f) => getComputedStyle(f).opacity !== "0");
          return { scrolls: region.scrollWidth > region.clientWidth + 1, overflowBy: region.scrollWidth - region.clientWidth, fadeLeft: fades[0], fadeRight: fades[1], pageOverflow: document.documentElement.scrollWidth - innerWidth };
        }, sel);
        if (!info.scrolls) { results.push({ screen, size: `${w}x${h}`, nav, scrolls: false }); continue; }
        const active = await page.$eval(`${sel} [aria-current="page"]`, measure);
        if (OUT) await page.locator(sel).screenshot({ path: path.join(OUT, `${screen}-${w}x${h}-${nav.replace(/\W+/g, "-")}-initial.png`) });
        // Keyboard: focus the first tab, then Tab through every tab.
        const count = await page.$$eval(`${sel} a`, (as) => as.length);
        const focus = [];
        let firstFocusOutline = null;
        await page.locator(`${sel} a`).first().focus();
        await page.keyboard.press("Shift+Tab");
        await page.keyboard.press("Tab");
        for (let i = 0; i < count; i++) {
          await page.waitForTimeout(220);
          const f = await page.evaluate(`(${measure.toString()})(document.activeElement)`);
          if (f.outline.startsWith("none")) f.outlineClipped = true; // a focused tab must draw an indicator
          focus.push(f);
          if (i === 0) firstFocusOutline = f.outline;
          if (OUT && (i === count - 1 || i === 0)) await page.locator(sel).screenshot({ path: path.join(OUT, `${screen}-${w}x${h}-${nav.replace(/\W+/g, "-")}-focus-${i}.png`) });
          await page.keyboard.press("Tab");
        }
        // Touch / trackpad: a horizontal wheel over the row reaches the end.
        await page.evaluate((s) => { document.querySelector(s).querySelector(".overflow-x-auto").scrollLeft = 0; }, sel);
        const box = await page.locator(sel).boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.wheel(2000, 0);
        await page.waitForTimeout(200);
        const lastReachable = await page.evaluate((s) => {
          const region = document.querySelector(s).querySelector(".overflow-x-auto");
          const last = [...region.querySelectorAll("a")].pop().getBoundingClientRect();
          return last.right <= region.getBoundingClientRect().right + 0.5;
        }, sel);
        const bad = focus.filter((f) => !f.inRegion || !f.clearOfFades || f.outlineClipped);
        const ok = active.inRegion && active.clearOfFades && bad.length === 0 && lastReachable && info.pageOverflow <= 0 && (info.fadeLeft || info.fadeRight);
        if (!ok) failures++;
        results.push({ screen, size: `${w}x${h}`, nav, scrolls: true, overflowBy: info.overflowBy, fadeShown: { left: info.fadeLeft, right: info.fadeRight }, pageOverflow: info.pageOverflow, active, focusFailures: bad, lastReachableByWheel: lastReachable, focusOutline: firstFocusOutline, ok });
      }
      await page.close();
    }
  }
  await browser.close();
  if (OUT) fs.writeFileSync(path.join(OUT, "tabs-check.json"), JSON.stringify(results, null, 2));
  for (const r of results) {
    if (!r.scrolls) { console.log(`${r.screen} ${r.size} ${r.nav}: fits, no scrolling`); continue; }
    console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.screen} ${r.size} ${r.nav}: overflow ${r.overflowBy}px; fade ${r.fadeShown.left ? "L" : "-"}${r.fadeShown.right ? "R" : "-"}; active "${r.active.label}" ${r.active.inRegion && r.active.clearOfFades ? "fully visible" : "partly hidden"}; focus failures ${r.focusFailures.length}${r.focusFailures.length ? ` (${r.focusFailures.map((f) => `${f.label}: ${!f.inRegion ? "outside" : !f.clearOfFades ? "under fade" : "outline clipped"}`).join("; ")})` : ""}; wheel reaches last ${r.lastReachableByWheel}; page overflow ${r.pageOverflow}px; focus outline ${r.focusOutline}`);
  }
  console.log(`${failures} failing`);
  process.exitCode = failures ? 1 : 0;
}

run().catch((e) => { console.error(e); process.exit(1); });
