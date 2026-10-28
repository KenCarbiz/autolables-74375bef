#!/usr/bin/env node
// Before | Reference | After sheets at the protocol v2 frame (native 1586x992 each),
// plus one responsive sheet per screen (1366, 1024 and 390 wide captures).
//
//   node scripts/admin-parity/beforeafter.cjs <before-out-dir> <before-label> [--screens 01,02]
//
// <before-out-dir> is the out/ directory of a harness run at the earlier
// commit; the "after" captures are this checkout's out/. Results go to
// evidence/before-after/NN.png and evidence/responsive/NN.png.

const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright");

const HERE = __dirname;
const [beforeDir, beforeLabel = "before"] = process.argv.slice(2);
const only = process.argv.includes("--screens") ? process.argv[process.argv.indexOf("--screens") + 1].split(",") : null;
const results = JSON.parse(fs.readFileSync(path.join(HERE, "out", "results.json"), "utf8"));
const before = fs.existsSync(path.join(beforeDir, "results.json")) ? JSON.parse(fs.readFileSync(path.join(beforeDir, "results.json"), "utf8")) : null;
const uri = (p) => `data:image/png;base64,${fs.readFileSync(p).toString("base64")}`;
const protocolOf = (r, s) => r?.screens.find((x) => x.screen === s)?.frames?.reference?.content?.parityPercent ?? null;
const fmt = (v) => (v == null ? "n/a" : `${v.toFixed(2)}%`);

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const entry of results.screens) {
    const s = entry.screen;
    if (only && !only.includes(s)) continue;
    const ref = path.join(path.resolve(HERE, "../.."), entry.reference);
    const after = path.join(HERE, "out", `${s}-1586x992.png`);
    const was = path.join(beforeDir, `${s}-1586x992.png`);
    if (![ref, after, was].every((p) => fs.existsSync(p))) { process.stdout.write(`${s}: missing capture, skipped\n`); continue; }
    const cell = (title, sub, src) => `<figure><figcaption><b>${title}</b> ${sub}</figcaption><img src="${uri(src)}"></figure>`;
    await page.setViewportSize({ width: 3 * 1586 + 4 * 24, height: 992 + 90 });
    await page.setContent(`<html><body style="margin:0;padding:24px;background:#E9EDF3;font:20px Inter,Arial,sans-serif;color:#17263C;display:flex;gap:24px">
      ${cell("Before", `${beforeLabel} · protocol v2 content parity ${fmt(protocolOf(before, s))}`, was)}
      ${cell("Reference", entry.reference.split("/").pop(), ref)}
      ${cell("After", `after · protocol v2 content parity ${fmt(protocolOf(results, s))} (target 95%)`, after)}
      <style>figure{margin:0}figcaption{height:34px}img{width:1586px;height:992px;display:block;border:1px solid #B8C3D2}</style></body></html>`);
    fs.mkdirSync(path.join(HERE, "evidence", "before-after"), { recursive: true });
    await page.screenshot({ path: path.join(HERE, "evidence", "before-after", `${s}.png`), fullPage: true });

    const sizes = ["1366x768", "1024x768", "390x844"].map((k) => [k, path.join(HERE, "out", `${s}-${k}.png`)]).filter(([, p]) => fs.existsSync(p));
    if (sizes.length) {
      await page.setViewportSize({ width: 1366 + 1024 + 390 + 4 * 24, height: 900 });
      await page.setContent(`<html><body style="margin:0;padding:24px;background:#E9EDF3;font:20px Inter,Arial,sans-serif;color:#17263C;display:flex;gap:24px;align-items:flex-start">
        ${sizes.map(([k, p]) => `<figure style="margin:0"><figcaption style="height:34px"><b>${k}</b></figcaption><img src="${uri(p)}" style="display:block;border:1px solid #B8C3D2;width:${k.split("x")[0]}px"></figure>`).join("")}
        </body></html>`);
      fs.mkdirSync(path.join(HERE, "evidence", "responsive"), { recursive: true });
      await page.screenshot({ path: path.join(HERE, "evidence", "responsive", `${s}.png`), fullPage: true });
    }
    process.stdout.write(`${s}: before-after and responsive sheets written\n`);
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
