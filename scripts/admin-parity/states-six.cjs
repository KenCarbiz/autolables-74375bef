#!/usr/bin/env node
"use strict";
// Interaction states for the review packages of 02 (Identity), 05 (Price
// rules), 09 (Escalation rules), 10 (Effective policy), 11 (Approval rules)
// and 13 (Sync run detail), captured at the actual viewport, desktop and
// phone: edited and unchanged draft bars, review dialogs, validation, menus
// and the child views each screen opens. Each capture records the buttons in
// view with their enabled state, whether an open dialog fits the viewport and
// page overflow; where a dialog closes, whether focus returned to its trigger.
// A step that cannot run is recorded with its error instead of stopping the
// run. Nothing is applied: the design fixtures write nothing.
//
//   node scripts/admin-parity/states-six.cjs --base-url http://127.0.0.1:5640 --out <dir> [--screens 02,05]

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const LANDMARKS = require("./landmarks.json");

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const BASE = arg("--base-url", "http://127.0.0.1:5640");
const OUT = arg("--out", path.join(__dirname, "out", "states-six"));
const ONLY = arg("--screens", null);
const SIZES = [[1586, 992], [390, 844]];

const records = [];

async function open(browser, screen, w, h) {
  const rail = LANDMARKS[screen] && typeof LANDMARKS[screen]._rail === "number" ? LANDMARKS[screen]._rail : 229;
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await page.goto(`${BASE}/admin/design-fixture/${screen}?rail=${rail}`, { waitUntil: "networkidle" });
  await page.waitForSelector(`[data-admin-fixture="${screen}"]`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(150);
  return page;
}

async function shot(page, screen, name, note) {
  await page.waitForTimeout(250);
  const vp = page.viewportSize();
  const file = `${screen}-${vp.width}x${vp.height}-${name}.png`;
  await page.screenshot({ path: path.join(OUT, file) });
  const info = await page.evaluate(() => {
    const inView = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth; };
    const dialog = document.querySelector('[role="dialog"], [role="alertdialog"]');
    const scope = dialog ?? document;
    const buttons = [...scope.querySelectorAll("button, a[href]")].filter(inView).map((b) => ({ label: (b.getAttribute("aria-label") || b.textContent || "").trim().replace(/\s+/g, " ").slice(0, 48), disabled: b.disabled === true || b.getAttribute("aria-disabled") === "true" })).filter((b) => b.label);
    let fits = null;
    let scrolls = null;
    if (dialog) {
      const r = dialog.getBoundingClientRect();
      fits = r.top >= -0.5 && r.left >= -0.5 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5;
      scrolls = dialog.scrollHeight > dialog.clientHeight + 1 && getComputedStyle(dialog).overflowY !== "visible";
    }
    const alerts = [...document.querySelectorAll('[role="alert"], [aria-invalid="true"]')].map((e) => (e.textContent || e.getAttribute("aria-label") || e.id || "").trim().slice(0, 80));
    return { dialog: dialog ? (dialog.querySelector("h2, [id$='-title']")?.textContent || "").trim() : null, dialogFitsViewport: fits, dialogScrollsInside: scrolls, pageOverflow: document.documentElement.scrollWidth - innerWidth, alerts, buttons };
  });
  records.push({ screen, viewport: `${vp.width}x${vp.height}`, state: name, file, note, ...info });
}

const focusReturned = async (page, locator) => { await page.waitForTimeout(400); return locator.evaluate((el) => document.activeElement === el).catch(() => null); };

async function step(screen, page, name, fn) {
  try { await fn(); } catch (e) {
    const vp = page.viewportSize();
    records.push({ screen, viewport: `${vp.width}x${vp.height}`, state: name, error: String(e.message || e).split("\n")[0].slice(0, 200) });
  }
}

const draftBar = (page) => page.getByRole("button", { name: /^Review (changes|policy changes)$/ }).first();

async function reviewCycle(screen, page, prefix, w) {
  const trigger = draftBar(page);
  await trigger.scrollIntoViewIfNeeded();
  await shot(page, screen, `${prefix}-edited`, "After an edit: the draft bar counts the change and Review is enabled");
  await trigger.click();
  await page.waitForSelector('[role="dialog"], [role="alertdialog"]', { timeout: 4000 });
  await shot(page, screen, `${prefix}-review-dialog`, "Review step: before and after; Apply is disabled in the design fixture");
  if (w < 1000) {
    await page.locator('[role="dialog"], [role="alertdialog"]').first().evaluate((d) => { d.scrollTop = d.scrollHeight; });
    await shot(page, screen, `${prefix}-review-dialog-scrolled`, "Phone: the review step scrolled to its actions");
  }
  await page.keyboard.press("Escape");
  const vp = page.viewportSize();
  records.push({ screen, viewport: `${vp.width}x${vp.height}`, state: `${prefix}-review-escape`, focusReturnedToTrigger: await focusReturned(page, trigger) });
}

const SCREENS = {
  async "02"(page, w) {
    await step("02", page, "unchanged", async () => shot(page, "02", "unchanged", "No change: Review changes disabled"));
    await step("02", page, "name-edit", async () => {
      await page.getByLabel("Dealership name").fill("Example INFINITI of Hartford");
      const trigger = draftBar(page);
      await trigger.scrollIntoViewIfNeeded();
      await shot(page, "02", "name-edited", "After an edit: the draft bar counts the change and Review changes is enabled");
      await trigger.click();
      await page.getByLabel("Changes to apply").scrollIntoViewIfNeeded();
      await shot(page, "02", "name-review-panel", "Review: the before and after list opens above the bar; Apply changes is disabled in the design fixture, which says why");
      await page.getByRole("button", { name: "Keep editing" }).click();
    });
    await step("02", page, "name-empty", async () => {
      await page.getByLabel("Dealership name").fill("");
      await page.getByLabel("Dealership name").blur();
      await page.getByLabel("Dealership name").scrollIntoViewIfNeeded();
      await shot(page, "02", "name-empty-validation", "Dealership name cleared: validation and Review state");
    });
  },
  async "05"(page, w) {
    await step("05", page, "unchanged", async () => shot(page, "05", "unchanged", "No change: Review changes disabled"));
    await step("05", page, "edit", async () => {
      await page.getByRole("button", { name: "Edit", exact: true }).first().click();
      await shot(page, "05", "edit-open", "Edit opened on the rule");
      await page.keyboard.press("Escape");
    });
    await step("05", page, "scope", async () => {
      const sel = page.getByLabel("Change scope");
      const opts = await sel.locator("option").evaluateAll((os) => os.map((o) => o.value).filter(Boolean));
      const cur = await sel.inputValue();
      await sel.selectOption(opts.find((v) => v !== cur));
      await sel.scrollIntoViewIfNeeded();
      await shot(page, "05", "scope-changed", "Change scope set to another value");
    });
    await step("05", page, "branded-switch", async () => {
      const sw = page.getByRole("switch").first();
      await sw.scrollIntoViewIfNeeded();
      await sw.click();
      await shot(page, "05", "switch-toggled", "Branded-title switch toggled");
      await reviewCycle("05", page, "switch", w);
    });
  },
  async "09"(page, w) {
    await step("09", page, "unchanged", async () => shot(page, "09", "unchanged", "No change: Review changes disabled"));
    await step("09", page, "add-email", async () => {
      await page.getByRole("button", { name: "Add BDC email" }).click();
      await shot(page, "09", "add-email", "Add BDC email opened");
    });
    await step("09", page, "target-change", async () => {
      const sel = page.getByLabel("First response target");
      const opts = await sel.locator("option").evaluateAll((os) => os.map((o) => o.value).filter(Boolean));
      const cur = await sel.inputValue();
      await sel.selectOption(opts.find((v) => v !== cur));
      await draftBar(page).scrollIntoViewIfNeeded();
      await shot(page, "09", "target-edited-blocked", "An edit while destinations are missing: Review changes stays disabled and the bar says to complete the required fields");
      await page.getByLabel("BDC email").fill("bdc@example.test");
      await page.getByRole("button", { name: "Add Sales manager email" }).click();
      await page.getByLabel(/manager email/i).fill("manager@example.test");
      await reviewCycle("09", page, "target", w);
    });
    await step("09", page, "switch", async () => {
      const sw = page.getByRole("switch").first();
      await sw.scrollIntoViewIfNeeded();
      await shot(page, "09", "rules-switch", `Rules switch: ${await sw.getAttribute("aria-label") || await sw.getAttribute("aria-labelledby") || "no label attribute"}`);
    });
  },
  async "10"(page, w) {
    await step("10", page, "unchanged", async () => shot(page, "10", "unchanged", "Effective policy, New selected"));
    await step("10", page, "used", async () => { await page.getByRole("button", { name: "Used", exact: true }).click(); await shot(page, "10", "used-selected", "Used selected"); });
    await step("10", page, "cpo", async () => { await page.getByRole("button", { name: "CPO", exact: true }).click(); await shot(page, "10", "cpo-selected", "CPO selected"); });
    await step("10", page, "collapse", async () => { await page.getByRole("button", { name: "Collapse" }).click(); await shot(page, "10", "collapsed", "Policy detail collapsed"); });
    await step("10", page, "preview-impact", async () => {
      const t = page.getByRole("button", { name: "Preview impact" });
      await t.scrollIntoViewIfNeeded(); await t.click();
      await page.waitForSelector('[role="dialog"], [role="alertdialog"]', { timeout: 4000 });
      await shot(page, "10", "preview-impact-dialog", "Preview impact");
      await page.keyboard.press("Escape");
      const vp = page.viewportSize();
      records.push({ screen: "10", viewport: `${vp.width}x${vp.height}`, state: "preview-impact-escape", focusReturnedToTrigger: await focusReturned(page, t) });
    });
    await step("10", page, "review", async () => reviewCycle("10", page, "policy", w));
  },
  async "11"(page, w) {
    await step("11", page, "unchanged", async () => shot(page, "11", "unchanged", "Approval rules"));
    await step("11", page, "edit-rules", async () => {
      const t = page.getByRole("button", { name: "Edit Window sticker rules" });
      await t.scrollIntoViewIfNeeded(); await t.click();
      await shot(page, "11", "edit-window-sticker", "Edit Window sticker rules");
      await page.keyboard.press("Escape");
      const vp = page.viewportSize();
      records.push({ screen: "11", viewport: `${vp.width}x${vp.height}`, state: "edit-window-sticker-escape", focusReturnedToTrigger: await focusReturned(page, t) });
    });
    await step("11", page, "review", async () => reviewCycle("11", page, "policy", w));
  },
  async "13"(page, w) {
    await step("13", page, "unchanged", async () => shot(page, "13", "unchanged", "Sync run detail"));
    await step("13", page, "retry-options", async () => {
      const t = page.getByRole("button", { name: "Review retry options" });
      await t.scrollIntoViewIfNeeded(); await t.click();
      await shot(page, "13", "retry-options-open", "Review retry options opened");
      await page.keyboard.press("Escape");
      const vp = page.viewportSize();
      records.push({ screen: "13", viewport: `${vp.width}x${vp.height}`, state: "retry-options-escape", focusReturnedToTrigger: await focusReturned(page, t) });
    });
    await step("13", page, "copy-evidence", async () => {
      const t = page.getByRole("button", { name: "Copy technical evidence" });
      await t.scrollIntoViewIfNeeded(); await t.click();
      await shot(page, "13", "copy-evidence", "Copy technical evidence pressed");
    });
  },
};

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const screens = ONLY ? ONLY.split(",") : Object.keys(SCREENS);
  for (const s of screens) {
    for (const [w, h] of SIZES) {
      const page = await open(browser, s, w, h);
      await SCREENS[s](page, w);
      await page.close();
    }
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, "states.json"), JSON.stringify(records, null, 2));
  for (const r of records) {
    if (r.error) { console.log(`${r.screen} ${r.viewport} ${r.state}: ERROR ${r.error}`); continue; }
    if (!r.file) { console.log(`${r.screen} ${r.viewport} ${r.state}: focus returned ${r.focusReturnedToTrigger}`); continue; }
    const disabled = r.buttons.filter((b) => b.disabled).map((b) => b.label);
    console.log(`${r.screen} ${r.viewport} ${r.state}: ${r.dialog !== null ? `dialog "${r.dialog}" fits ${r.dialogFitsViewport}, scrolls inside ${r.dialogScrollsInside}; ` : ""}overflow ${r.pageOverflow}px; alerts [${r.alerts.join(" | ")}]; disabled [${disabled.join(", ")}]`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
