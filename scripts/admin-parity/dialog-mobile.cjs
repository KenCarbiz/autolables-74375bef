#!/usr/bin/env node
"use strict";
// Fee change review dialog (screen 06) at actual narrow viewports: the dialog
// stays inside the viewport and scrolls its own content, Back / Apply / Close
// are reachable, the fee and advertised-total values are fully visible, focus
// stays in the dialog and returns to the trigger on Escape and on Close, the
// page behind does not scroll, and the edit inputs scroll into view under a
// short (on-screen keyboard) viewport.
//
//   node scripts/admin-parity/dialog-mobile.cjs --base-url http://127.0.0.1:5640 [--sizes 390x844,320x568,390x500] [--out <dir>]

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const BASE = arg("--base-url", "http://127.0.0.1:5640");
const OUT = arg("--out", null);
const SIZES = arg("--sizes", "390x844,320x568,390x500").split(",").map((s) => s.split("x").map(Number));

const DIALOG = '[role="dialog"]';

const open = async (page, screen) => {
  await page.goto(`${BASE}/admin/design-fixture/${screen}`, { waitUntil: "networkidle" });
  await page.waitForSelector(`[data-admin-fixture="${screen}"]`);
  await page.evaluate(() => document.fonts.ready);
};

// Fully visible: inside the viewport and inside every clipping ancestor, and
// the element (not something over it) is what a tap at its centre hits.
const visibleIn = (el) => {
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return { ok: false, why: "not rendered" };
  if (r.top < -0.5 || r.left < -0.5 || r.bottom > innerHeight + 0.5 || r.right > innerWidth + 0.5) return { ok: false, why: `outside viewport (${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)})` };
  for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
    const cs = getComputedStyle(a);
    if (cs.overflowX === "visible" && cs.overflowY === "visible") continue;
    const ar = a.getBoundingClientRect();
    if (r.left < ar.left - 0.5 || r.right > ar.right + 0.5 || r.top < ar.top - 0.5 || r.bottom > ar.bottom + 0.5) return { ok: false, why: `clipped by ${a.tagName.toLowerCase()}${a.getAttribute("aria-label") ? ` "${a.getAttribute("aria-label")}"` : ""}` };
  }
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  if (!hit || !(el === hit || el.contains(hit) || hit.contains(el))) return { ok: false, why: `covered by ${hit ? hit.tagName.toLowerCase() : "nothing"}` };
  return { ok: true };
};

async function reachable(page, locator) {
  if ((await locator.count()) === 0) return { ok: false, why: "missing" };
  await locator.first().scrollIntoViewIfNeeded();
  await page.waitForTimeout(80);
  return locator.first().evaluate(visibleIn);
}

async function checkViewport(browser, w, h) {
  const results = [];
  const record = (name, ok, detail = "") => results.push({ check: name, ok, detail });
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: false });
  await open(page, "06");
  await page.waitForSelector(DIALOG);

  // 1. The dialog box itself fits the viewport; its content scrolls inside it.
  const box = await page.evaluate((sel) => {
    const d = document.querySelector(sel);
    const r = d.getBoundingClientRect();
    const scrollers = [d, ...d.querySelectorAll("*")].filter((el) => /(auto|scroll)/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 1).length;
    return { top: r.top, bottom: r.bottom, h: r.height, vh: innerHeight, scrollers };
  }, DIALOG);
  record("dialog fits the viewport", box.top >= -0.5 && box.bottom <= box.vh + 0.5, `dialog ${Math.round(box.top)}-${Math.round(box.bottom)} of ${box.vh}px; internal scroll areas ${box.scrollers}`);

  // 2. The page behind does not scroll: wheel over the backdrop and over the dialog.
  const y0 = await page.evaluate(() => scrollY);
  await page.mouse.move(4, h - 4);
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(150);
  const dBox = await page.locator(DIALOG).boundingBox();
  await page.mouse.move(dBox.x + dBox.width / 2, Math.min(h - 10, dBox.y + dBox.height / 2));
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(150);
  const y1 = await page.evaluate(() => scrollY);
  const htmlOverflow = await page.evaluate(() => getComputedStyle(document.documentElement).overflowY);
  record("background page does not scroll", y1 === y0, `window scrollY ${y0} -> ${y1}; html overflow-y ${htmlOverflow}`);

  // 3. Close, Back to edit and Apply are reachable.
  for (const [name, loc] of [
    ["Close reachable", page.locator(`${DIALOG} button[aria-label="Close review"]`)],
    ["Back to edit reachable", page.locator(`${DIALOG} [data-landmark="fee-back"]`)],
    ["Apply reachable", page.locator(`${DIALOG} [data-landmark="fee-apply"]`)],
  ]) {
    const r = await reachable(page, loc);
    record(name, r.ok, r.why || "");
  }

  // 4. Every money value in the review (change summary, fee before/after and
  //    advertised total before/after) is fully visible once scrolled to.
  const money = await page.evaluate((sel) => {
    const d = document.querySelector(sel);
    const els = [...d.querySelectorAll("span, p, td, dd")].filter((el) => {
      if (!el.getClientRects().length) return false;
      const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("");
      return /\$\d/.test(own);
    });
    els.forEach((el, i) => el.setAttribute("data-money-check", String(i)));
    return els.map((el) => el.textContent.trim());
  }, DIALOG);
  const failures = [];
  // Vertical scrolling only: a value that is visible only after scrolling a
  // table sideways counts as a hidden column.
  for (let i = 0; i < money.length; i++) {
    const loc = page.locator(`[data-money-check="${i}"]`);
    await loc.scrollIntoViewIfNeeded();
    await loc.evaluate((el) => { for (let a = el.parentElement; a; a = a.parentElement) a.scrollLeft = 0; });
    await page.waitForTimeout(60);
    const r = await loc.evaluate(visibleIn);
    if (!r.ok) failures.push(`${money[i]}: ${r.why}`);
  }
  const needed = ["$895", "$925", "$19,420", "$19,450"];
  const missing = needed.filter((v) => !money.some((m) => m.includes(v)));
  record("fee and advertised-total values readable", money.length > 0 && failures.length === 0 && missing.length === 0, `${money.length} values checked${failures.length ? `; ${failures.join("; ")}` : ""}${missing.length ? `; not shown: ${missing.join(", ")}` : ""}`);

  // Captures of the review step as its own body scrolls (the page itself is held).
  if (OUT) {
    const body = page.locator("[data-fee-review-body]");
    if (await body.count()) {
      const { sh, ch } = await body.evaluate((el) => { el.scrollTop = 0; el.scrollLeft = 0; return { sh: el.scrollHeight, ch: el.clientHeight }; });
      const steps = Math.min(8, Math.max(1, Math.ceil((sh - ch) / Math.max(1, ch - 40)) + 1));
      for (let i = 0; i < steps; i++) {
        await body.evaluate((el, y) => { el.scrollTop = y; }, i * (ch - 40));
        await page.waitForTimeout(80);
        await page.screenshot({ path: path.join(OUT, `06-review-${w}x${h}-${String(i).padStart(2, "0")}.png`) });
      }
    } else {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: path.join(OUT, `06-review-${w}x${h}-00.png`) });
    }
  }

  // 5. Focus is trapped while the dialog is open.
  await page.locator(`${DIALOG} button[aria-label="Close review"]`).focus();
  let escaped = 0;
  for (const key of [...Array(30).fill("Tab"), ...Array(30).fill("Shift+Tab")]) {
    await page.keyboard.press(key);
    if (!(await page.evaluate((sel) => document.querySelector(sel).contains(document.activeElement), DIALOG))) escaped += 1;
  }
  record("focus trapped in the dialog", escaped === 0, `${escaped} of 60 Tab / Shift+Tab presses left the dialog`);

  // 6. Edit inputs scroll into view when focused (keyboard-height viewports included).
  await page.locator(`${DIALOG} [data-landmark="fee-back"]`).click();
  const inputs = page.locator(`${DIALOG} input:not([type="checkbox"]):not([disabled]), ${DIALOG} select`);
  const n = await inputs.count();
  const inputFails = [];
  for (let i = 0; i < n; i++) {
    await inputs.nth(i).focus();
    await page.waitForTimeout(120);
    const r = await inputs.nth(i).evaluate(visibleIn);
    if (!r.ok) inputFails.push(`input ${i + 1}: ${r.why}`);
  }
  record("edit inputs scroll into view on focus", n > 0 && inputFails.length === 0, `${n} inputs${inputFails.length ? `; ${inputFails.join("; ")}` : ""}`);

  if (OUT) await page.screenshot({ path: path.join(OUT, `dialog-${w}x${h}.png`) });
  await page.close();

  // 7. Focus returns to the trigger: open from Price rules, close with Escape and with Close.
  for (const how of ["Escape", "Close button"]) {
    const p = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    await open(p, "05");
    await p.getByRole("button", { name: "Edit", exact: true }).click();
    await p.locator("#fee-amount").fill("925");
    const trigger = p.locator('[data-landmark="price-review"]');
    await trigger.click();
    let detail = "";
    let ok = false;
    try {
      await p.waitForSelector(DIALOG, { timeout: 5000 });
      const inside = await p.evaluate((sel) => document.querySelector(sel).contains(document.activeElement), DIALOG);
      if (how === "Escape") await p.keyboard.press("Escape");
      else await p.locator(`${DIALOG} button[aria-label="Close review"]`).click();
      await p.waitForSelector(DIALOG, { state: "detached", timeout: 5000 });
      await p.waitForTimeout(150);
      const active = await p.evaluate(() => { const a = document.activeElement; return a ? `${a.tagName.toLowerCase()}${a.dataset.landmark ? `[${a.dataset.landmark}]` : ""} "${(a.textContent || "").trim().slice(0, 30)}"` : "none"; });
      const onTrigger = await p.evaluate(() => document.activeElement?.getAttribute("data-landmark") === "price-review");
      const enabled = await trigger.isEnabled();
      ok = inside && onTrigger;
      detail = `focus moved into dialog on open: ${inside}; after close focus on ${active}; trigger enabled: ${enabled}; url ${new URL(p.url()).pathname}`;
    } catch (e) {
      detail = `dialog did not open from the trigger (url ${new URL(p.url()).pathname}${new URL(p.url()).search})`;
    }
    record(`focus returns to the trigger (${how})`, ok, detail);
    await p.close();
  }
  return results;
}

(async () => {
  if (OUT) fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const report = [];
  let failed = 0;
  for (const [w, h] of SIZES) {
    const results = await checkViewport(browser, w, h);
    report.push({ viewport: `${w}x${h}`, results });
    process.stdout.write(`${w}x${h}\n`);
    for (const r of results) {
      if (!r.ok) failed += 1;
      process.stdout.write(`  ${r.ok ? "PASS" : "FAIL"}  ${r.check}${r.detail ? ` - ${r.detail}` : ""}\n`);
    }
  }
  if (OUT) fs.writeFileSync(path.join(OUT, "dialog-mobile.json"), JSON.stringify(report, null, 1));
  await browser.close();
  process.stdout.write(`${failed} failing checks\n`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
