#!/usr/bin/env node
"use strict";
// Interaction states for the focused review of 03 (Team), 04 (Member role)
// and 07 (Product applicability), captured at the actual viewport: menus,
// dialogs, the review step, validation and empty states, at desktop and
// phone sizes. Each capture records the buttons in view with their enabled
// state, whether an open dialog fits inside the viewport, and page overflow.
// Where a dialog closes, it records whether focus returned to the trigger.
// Nothing is applied: the design fixtures write nothing.
//
//   node scripts/admin-parity/states-030407.cjs --base-url http://127.0.0.1:5640 --out <dir>

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const BASE = arg("--base-url", "http://127.0.0.1:5640");
const OUT = arg("--out", path.join(__dirname, "out", "states-030407"));
const RAIL = { "03": 238, "04": 239, "07": 242 };

const records = [];

async function open(browser, screen, w, h) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await page.goto(`${BASE}/admin/design-fixture/${screen}?rail=${RAIL[screen]}`, { waitUntil: "networkidle" });
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
    return { dialog: dialog ? (dialog.querySelector("h2, [id$='-title']")?.textContent || "").trim() : null, dialogFitsViewport: fits, dialogScrollsInside: scrolls, pageOverflow: document.documentElement.scrollWidth - innerWidth, buttons };
  });
  records.push({ screen, viewport: `${vp.width}x${vp.height}`, state: name, file, note, ...info });
}

// Waits out the 200ms close animation before reading the focused element.
const focusReturned = async (page, selector) => { await page.waitForTimeout(400); return page.evaluate((s) => document.activeElement === document.querySelector(s), selector); };

async function screen03(browser) {
  for (const [w, h] of [[1586, 992], [390, 844]]) {
    const page = await open(browser, "03", w, h);
    const trigger = 'button[aria-label="Actions for example.salesperson@example.test"]';
    await page.locator(trigger).scrollIntoViewIfNeeded();
    await page.click(trigger);
    await page.waitForSelector('[role="menu"]');
    await shot(page, "03", "row-actions-menu", "Row actions: View role policy, Change role, Remove from team");
    await page.getByRole("menuitem", { name: "Change role" }).click();
    await page.waitForSelector('[role="dialog"]');
    await shot(page, "03", "change-role-dialog", "Review role change, editing step");
    const select = page.locator("#review-role");
    const values = await select.locator("option").evaluateAll((os) => os.map((o) => o.value).filter(Boolean));
    const current = await select.inputValue();
    await select.selectOption(values.find((v) => v !== current));
    await page.locator('[role="dialog"] button', { hasText: /^Review/ }).first().click();
    await shot(page, "03", "change-role-review", "Review step after choosing a different role; Apply is blocked by the design fixture's read-only reason");
    if (w < 1000) {
      await page.locator('[role="dialog"]').evaluate((d) => { d.scrollTop = d.scrollHeight; });
      await shot(page, "03", "change-role-review-scrolled", "Phone: the review step scrolls inside the dialog to Cancel and Apply change");
    }
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
    records.push({ screen: "03", viewport: `${w}x${h}`, state: "change-role-dialog-escape", focusReturnedToTrigger: await focusReturned(page, trigger) });
    await page.click(trigger);
    await page.getByRole("menuitem", { name: "Remove from team" }).click();
    await page.waitForSelector('[role="alertdialog"]');
    await shot(page, "03", "remove-dialog", "Remove confirmation");
    await page.getByRole("button", { name: "Cancel" }).click();
    await page.waitForTimeout(250);
    records.push({ screen: "03", viewport: `${w}x${h}`, state: "remove-dialog-cancel", focusReturnedToTrigger: await focusReturned(page, trigger) });
    if (w > 1000) {
      await page.getByRole("button", { name: /close/i }).first().click();
      await page.evaluate(() => scrollTo(0, 0));
      await shot(page, "03", "rail-closed", "No member selected: the rail closes and the table takes the card width");
    } else {
      const rail = page.getByRole("heading", { name: "Role summary" });
      await rail.scrollIntoViewIfNeeded();
      await page.evaluate(() => scrollBy(0, -80));
      await shot(page, "03", "rail-below-table", "Phone: the role summary rail sits below the table");
    }
    await page.evaluate(() => scrollTo(0, 0));
    await page.fill('input[type="search"]', "nobody-matches");
    await shot(page, "03", "no-match", "Search with no match: count line and Clear filters");
    await page.close();
  }
}

async function screen04(browser) {
  for (const [w, h] of [[1586, 992], [1366, 768], [390, 844]]) {
    const page = await open(browser, "04", w, h);
    if (w === 1366) {
      const table = page.locator("table").first();
      await table.scrollIntoViewIfNeeded();
      await shot(page, "04", "matrix-full-width", "Below 1536px the cards stack, so the matrix shows Read, Create or act and Manage without sideways scrolling");
      await page.close();
      continue;
    }
    const test = page.locator('[data-landmark="test-role-access"]');
    await test.scrollIntoViewIfNeeded();
    await test.click();
    await page.waitForSelector('[role="dialog"]');
    await shot(page, "04", "test-role-access-dialog", "Test role access preview (test data)");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
    records.push({ screen: "04", viewport: `${w}x${h}`, state: "test-role-access-escape", focusReturnedToTrigger: await focusReturned(page, '[data-landmark="test-role-access"]') });
    const review = page.locator('[data-landmark="review-policy"]');
    await review.click();
    await page.waitForSelector('[role="dialog"]');
    await shot(page, "04", "review-policy-dialog", "Review policy changes opens the role change review");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
    if (w > 1000) {
      await page.locator("summary", { hasText: "Where each status comes from" }).click();
      await page.locator("summary", { hasText: "Where each status comes from" }).scrollIntoViewIfNeeded();
      await shot(page, "04", "status-sources-open", "Required enforcement: where each status comes from, expanded");
    }
    await page.close();
  }
}

async function screen07(browser) {
  for (const [w, h] of [[1586, 992], [1366, 768], [390, 844]]) {
    const page = await open(browser, "07", w, h);
    if (w === 1366) {
      const table = page.locator('[data-landmark="sample-results"]');
      await table.scrollIntoViewIfNeeded();
      await shot(page, "07", "sample-results-full-width", "Below 1536px the panels stack, so every Sample vehicle results column is visible");
    }
    const actions = page.locator('[data-landmark="applicability-review"]');
    await actions.scrollIntoViewIfNeeded();
    await shot(page, "07", "unchanged-review-disabled", "No change yet: Review changes is disabled");
    await page.getByLabel("No limit").check();
    await actions.scrollIntoViewIfNeeded();
    await shot(page, "07", "edited-review-enabled", "Mileage set to No limit: Review changes is enabled");
    await actions.click();
    await page.getByRole("heading", { name: "Review changes" }).scrollIntoViewIfNeeded();
    await page.evaluate(() => scrollBy(0, 120));
    await shot(page, "07", "reviewing", "Review step: before and after table, Back to edit and Apply changes");
    if (w === 1586) {
      await page.getByRole("button", { name: "Back to edit" }).click();
      await page.selectOption("#year-min", { index: 1 });
      const maxOptions = await page.locator("#year-max option").count();
      await page.selectOption("#year-max", { index: maxOptions - 1 });
      await page.locator("#year-max").scrollIntoViewIfNeeded();
      await page.evaluate(() => scrollBy(0, 160));
      await shot(page, "07", "year-range-invalid", "Model year from later than to: validation message, Review changes disabled");
    }
    await page.close();
  }
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  await screen03(browser);
  await screen04(browser);
  await screen07(browser);
  await browser.close();
  fs.writeFileSync(path.join(OUT, "states.json"), JSON.stringify(records, null, 2));
  for (const r of records) {
    if (!r.file) { console.log(`${r.screen} ${r.viewport} ${r.state}: focus returned ${r.focusReturnedToTrigger}`); continue; }
    const disabled = r.buttons.filter((b) => b.disabled).map((b) => b.label);
    console.log(`${r.screen} ${r.viewport} ${r.state}: ${r.dialog ? `dialog "${r.dialog}" fits ${r.dialogFitsViewport}, scrolls inside ${r.dialogScrollsInside}; ` : ""}overflow ${r.pageOverflow}px; disabled [${disabled.join(", ")}]`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
