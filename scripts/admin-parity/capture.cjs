"use strict";
// Browser side of the parity harness: starts the Vite dev server, discovers
// the registered design fixtures, captures each one at the reference frame
// and the protocol viewport, reads the dynamic-region masks and landmark
// boxes from the DOM, and proves the responsive breakpoints have no page-wide
// overflow. Nothing here touches production data: the fixture route renders
// synthetic data and exists only in development builds.

const { spawn } = require("node:child_process");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function waitForHttp(url, timeoutMs, failedLog) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const gone = failedLog();
      if (gone !== null) return reject(new Error(`dev server exited before it was ready:\n${gone.slice(-2000)}`));
      if (Date.now() - started > timeoutMs) return reject(new Error(`dev server did not answer within ${timeoutMs} ms`));
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) resolve();
        else setTimeout(tick, 500);
      });
      req.on("error", () => setTimeout(tick, 500));
      req.setTimeout(3000, () => { req.destroy(); });
    };
    tick();
  });
}

async function startDevServer({ cwd, port }) {
  const child = spawn("bunx", ["vite", "--port", String(port), "--strictPort", "--host", "127.0.0.1", "--clearScreen", "false"], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, BROWSER: "none" },
  });
  let log = "";
  child.stdout.on("data", (d) => { log += d.toString(); });
  child.stderr.on("data", (d) => { log += d.toString(); });
  await waitForHttp(`http://127.0.0.1:${port}/`, 120_000, () => (child.exitCode !== null ? log : null));
  return { child, log: () => log, stop: () => { if (child.exitCode === null) child.kill("SIGTERM"); } };
}

async function openFixture(page, baseUrl, screen, rail) {
  const query = rail ? `?rail=${encodeURIComponent(rail)}` : "";
  await page.goto(`${baseUrl}/admin/design-fixture/${screen}${query}`, { waitUntil: "networkidle", timeout: 120_000 });
  await page.waitForSelector(`[data-admin-fixture="${screen}"]`, { timeout: 60_000 });
  await page.waitForFunction(() => !document.body.innerText.includes("Loading fixture"), null, { timeout: 60_000 });
  await page.waitForSelector("[data-admin-v2] h1", { timeout: 60_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState("networkidle");
  await sleep(400);
}

async function listFixtures(page, baseUrl) {
  await page.goto(`${baseUrl}/admin/design-fixture/__list__`, { waitUntil: "networkidle", timeout: 120_000 });
  await page.waitForFunction(() => document.body.innerText.includes("Known screens"), null, { timeout: 60_000 });
  const text = await page.evaluate(() => document.body.innerText);
  const m = /Known screens:\s*(.*?)\./s.exec(text);
  if (!m || /none registered/.test(m[1])) return [];
  return m[1].split(",").map((s) => s.trim()).filter(Boolean);
}

// Runs inside the page. A spec names elements by selector and optional index,
// or by selector plus the text of the element's first h1-h3 (`heading`), which
// keeps a card landmark stable when another stream reorders the DOM. A mask
// spec may add `inner` to mask only matching descendants of the picked roots.
const readDom = ({ maskSpecs, landmarkSpecs }) => {
  const pick = (spec) => {
    const all = Array.from(document.querySelectorAll(spec.selector));
    if (!spec.heading) return all;
    return all.filter((el) => {
      const h = el.querySelector("h1,h2,h3");
      return !!h && h.textContent.trim() === spec.heading;
    });
  };
  const box = (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  };
  const masks = maskSpecs.flatMap((s) => {
    const roots = pick(s);
    const targets = s.inner ? roots.flatMap((r) => Array.from(r.querySelectorAll(s.inner))) : roots;
    return targets.map((el) => {
      const b = box(el);
      return { x: Math.max(0, b.x - 2), y: Math.max(0, b.y - 2), w: b.w + 4, h: b.h + 4, reason: s.reason };
    });
  });
  const landmarks = {};
  for (const [name, spec] of Object.entries(landmarkSpecs)) {
    const el = pick(spec)[spec.index ?? 0];
    if (el) landmarks[name] = box(el);
  }
  // Text boxes: every rendered line of text and the content box of every form
  // control. The structure score masks these on both images so glyph rendering
  // is measured apart from spacing, sizing, borders, fills and icons. A line of
  // text the mock draws somewhere the capture does not still counts against
  // structure, because no capture box covers it.
  const textBoxes = [];
  const visible = (el) => {
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) > 0.05;
  };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.nodeValue && n.nodeValue.trim() && n.parentElement && visible(n.parentElement) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const range = document.createRange();
    range.selectNodeContents(n);
    for (const r of Array.from(range.getClientRects())) {
      if (r.width < 1 || r.height < 1) continue;
      textBoxes.push({ x: Math.max(0, r.x - 2), y: Math.max(0, r.y - 2), w: r.width + 4, h: r.height + 4 });
    }
  }
  for (const el of Array.from(document.querySelectorAll("input:not([type=checkbox]):not([type=radio]):not([type=range]), select, textarea"))) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const px = (v) => parseFloat(v) || 0;
    const left = px(cs.borderLeftWidth) + px(cs.paddingLeft);
    const right = px(cs.borderRightWidth) + px(cs.paddingRight);
    const top = px(cs.borderTopWidth) + Math.min(px(cs.paddingTop), 6);
    const bottom = px(cs.borderBottomWidth) + Math.min(px(cs.paddingBottom), 6);
    const w = r.width - left - right;
    const h = r.height - top - bottom;
    if (w > 2 && h > 2) textBoxes.push({ x: r.x + left - 1, y: r.y + top - 1, w: w + 2, h: h + 2 });
  }
  return { masks, landmarks, textBoxes };
};

async function captureScreen(page, { baseUrl, screen, viewport, outPng, maskSpec, landmarkSpec, anchorSelector = null, rail = null }) {
  await page.setViewportSize(viewport);
  await openFixture(page, baseUrl, screen, rail);
  const fonts = await page.evaluate(() => ({
    inter: document.fonts.check("600 14px Inter"),
    loaded: Array.from(new Set(Array.from(document.fonts).filter((f) => f.status === "loaded").map((f) => f.family))),
  }));
  const landmarkSpecs = Object.fromEntries(
    Object.entries(landmarkSpec || {})
      .filter(([k]) => !k.startsWith("_"))
      .map(([k, v]) => [k, { selector: v.selector, index: v.index, heading: v.heading }]),
  );
  const dom = await page.evaluate(readDom, { maskSpecs: maskSpec.selectors || [], landmarkSpecs });
  const anchors = await page.evaluate((customSelector) => {
    const bottom = (sel) => { const el = sel ? document.querySelector(sel) : null; return el ? Math.round(el.getBoundingClientRect().bottom) : null; };
    return { sectionNavBottom: bottom('nav[aria-label="Administration sections"]'), h1Bottom: bottom("[data-admin-v2] h1"), custom: bottom(customSelector) };
  }, anchorSelector);
  await page.screenshot({ path: outPng, fullPage: false });
  return { fonts, masks: [...dom.masks, ...(maskSpec.rects || [])], landmarks: dom.landmarks, anchors, textBoxes: dom.textBoxes };
}

async function responsiveCheck(page, { baseUrl, screen, viewports, outDir, rail = null }) {
  const rows = [];
  for (const vp of viewports) {
    await page.setViewportSize(vp);
    await openFixture(page, baseUrl, screen, rail);
    const m = await page.evaluate(() => {
      const root = document.querySelector("[data-admin-v2]") || document.body;
      const scrollable = (el) => {
        for (let n = el; n && n !== document.body; n = n.parentElement) {
          const o = getComputedStyle(n).overflowX;
          if (o === "auto" || o === "scroll") return true;
        }
        return false;
      };
      let maxRight = 0;
      const regions = new Set();
      for (const el of root.querySelectorAll("*")) {
        const r = el.getBoundingClientRect();
        if (r.width === 0) continue;
        if (scrollable(el)) {
          let n = el;
          while (n && n !== document.body) {
            const o = getComputedStyle(n).overflowX;
            if ((o === "auto" || o === "scroll") && n.scrollWidth > n.clientWidth + 1) {
              regions.add(`${n.tagName.toLowerCase()}${n.getAttribute("aria-label") ? `[${n.getAttribute("aria-label")}]` : ""}`);
              break;
            }
            n = n.parentElement;
          }
          continue;
        }
        maxRight = Math.max(maxRight, r.right);
      }
      return {
        innerWidth: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
        bodyScrollWidth: document.body.scrollWidth,
        maxRight,
        scrollRegions: Array.from(regions),
        h1Count: document.querySelectorAll("h1").length,
      };
    });
    const file = path.join(outDir, `${screen}-${vp.width}x${vp.height}.png`);
    await page.screenshot({ path: file, fullPage: true });
    // Page-wide overflow is the failure. A region that scrolls on purpose
    // (a wide table or the tab row) is reported, not failed.
    rows.push({
      viewport: `${vp.width}x${vp.height}`,
      ok: m.scrollWidth <= m.innerWidth && m.bodyScrollWidth <= m.innerWidth && m.maxRight <= m.innerWidth + 1,
      ...m,
      file: path.relative(process.cwd(), file),
    });
  }
  return rows;
}

module.exports = { startDevServer, listFixtures, captureScreen, responsiveCheck };
