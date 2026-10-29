#!/usr/bin/env node
"use strict";
// Screen 06 (fee change review) interaction states at desktop size, captured
// for individual visual review: the review step as it opens (Apply enabled),
// the review scrolled at a short desktop viewport, Back to edit, an unchanged
// fee (Review changes disabled), the fee switched off (amount disabled), an
// invalid amount (validation message), and the applied step. Each capture
// records which buttons were enabled.
//
//   node scripts/admin-parity/states-06.cjs --base-url http://127.0.0.1:5640 --out <dir>

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const BASE = arg("--base-url", "http://127.0.0.1:5640");
const OUT = arg("--out", path.join(__dirname, "out", "states-06"));
const DIALOG = '[role="dialog"]';

async function open(browser, w, h) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await page.goto(`${BASE}/admin/design-fixture/06`, { waitUntil: "networkidle" });
  await page.waitForSelector('[data-admin-fixture="06"]');
  await page.waitForSelector(DIALOG);
  await page.evaluate(() => document.fonts.ready);
  return page;
}

const buttons = (page) => page.evaluate((sel) => [...document.querySelectorAll(`${sel} button`)]
  .filter((b) => b.getClientRects().length && b.textContent.trim())
  .map((b) => `${b.textContent.trim().replace(/\s+/g, " ")}: ${b.disabled ? "disabled" : "enabled"}`), DIALOG);

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const log = [];
  const shot = async (page, name, note) => {
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    const notes = await page.evaluate((sel) => [...document.querySelectorAll(`${sel} [role="alert"], ${sel} [data-tone], ${sel} .text-adm-danger`)]
      .map((n) => n.textContent.trim()).filter(Boolean).slice(0, 4), DIALOG);
    log.push({ capture: `${name}.png`, note, buttons: await buttons(page), messages: notes });
  };

  let page = await open(browser, 1586, 992);
  await shot(page, "06-desktop-01-review", "Review step as opened: draft fee $925 against $895");
  await page.locator(`${DIALOG} [data-landmark="fee-back"]`).click();
  await shot(page, "06-desktop-02-edit", "Back to edit: draft kept");
  const amount = page.locator("#review-fee-amount");
  await amount.fill("895");
  await shot(page, "06-desktop-03-unchanged", "Fee set back to the current $895: nothing to review");
  await amount.fill("-5");
  const review = page.locator(`${DIALOG} button`, { hasText: "Review changes" });
  if (await review.isEnabled()) await review.click();
  await shot(page, "06-desktop-04-validation", "Invalid amount (-5) submitted for review");
  const toggle = page.locator(`${DIALOG} [role="switch"], ${DIALOG} input[type="checkbox"]`).first();
  if (await toggle.count()) {
    await toggle.click();
    await shot(page, "06-desktop-05-fee-off", "Document fee switched off: amount field disabled");
  }
  await page.close();

  page = await open(browser, 1586, 992);
  await page.locator(`${DIALOG} [data-landmark="fee-apply"]`).click();
  await page.waitForTimeout(400);
  await shot(page, "06-desktop-06-applied", "Apply pressed on the fixture (no server; fixture result)");
  await page.close();

  page = await open(browser, 1366, 768);
  const body = page.locator("[data-fee-review-body]");
  const scroller = (await body.count()) ? body : page.locator(DIALOG);
  const { sh, ch } = await scroller.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }));
  await shot(page, "06-desktop-1366x768-scroll-top", `Short desktop viewport, top (content ${sh}px in ${ch}px)`);
  await scroller.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await shot(page, "06-desktop-1366x768-scroll-end", "Short desktop viewport, scrolled to the end");
  await page.close();

  await browser.close();
  fs.writeFileSync(path.join(OUT, "states-06.json"), JSON.stringify(log, null, 2));
  for (const l of log) console.log(`${l.capture}: ${l.note}\n  ${l.buttons.join(" | ")}${l.messages.length ? `\n  messages: ${l.messages.join(" / ")}` : ""}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
