"use strict";
// Platform console visual harness. Starts Vite (development build, so the
// fixture route exists), captures each requested reference at its native size
// with dpr 1, and scores it with the handoff's frozen comparator
// (tools/compare_visual.py). Fixture routes render synthetic data only and
// block every action at the mutation adapter.
//
//   node scripts/platform-console/capture.cjs [SCREEN ...] [--out DIR] [--port N] [--base URL]
//
// With --base the script uses an already-running dev server.

const { spawn, execFileSync } = require("node:child_process");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const ROOT = path.resolve(__dirname, "../..");
const HERE = __dirname;
const manifest = JSON.parse(fs.readFileSync(path.join(HERE, "design/screen-manifest.json"), "utf8"));

const args = process.argv.slice(2);
const flag = (name, dflt) => { const i = args.indexOf(name); if (i === -1) return dflt; const v = args[i + 1]; args.splice(i, 2); return v; };
const out = path.resolve(flag("--out", path.join(HERE, "evidence")));
const port = Number(flag("--port", "5391"));
const baseArg = flag("--base", null);
const wanted = args.length ? args : manifest.map((m) => m.id);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function waitFor(url, ms) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (Date.now() - t0 > ms) return reject(new Error("dev server timeout"));
      http.get(url, (res) => { res.resume(); res.statusCode < 500 ? resolve() : setTimeout(tick, 500); }).on("error", () => setTimeout(tick, 500));
    };
    tick();
  });
}

(async () => {
  let server = null;
  const base = baseArg || `http://127.0.0.1:${port}`;
  if (!baseArg) {
    server = spawn("npx", ["vite", "--port", String(port), "--strictPort", "--host", "127.0.0.1", "--clearScreen", "false"], { cwd: ROOT, stdio: "ignore", env: { ...process.env, BROWSER: "none" } });
    await waitFor(base + "/", 120000);
  }
  const browser = await chromium.launch();
  const results = [];
  try {
    for (const id of wanted) {
      const m = manifest.find((x) => x.id === id);
      if (!m) { console.error(`unknown screen ${id}`); continue; }
      const ctx = await browser.newContext({ viewport: { width: m.width, height: m.height }, deviceScaleFactor: 1, reducedMotion: "reduce", timezoneId: "America/New_York", locale: "en-US" });
      const page = await ctx.newPage();
      await page.goto(`${base}/platform-console-fixture/${id}`, { waitUntil: "networkidle", timeout: 120000 });
      await page.waitForSelector(`[data-console-fixture="${id}"] [data-platform-console] h1`, { timeout: 60000 });
      await page.evaluate(() => document.fonts.ready);
      await sleep(300);
      const dir = path.join(out, id);
      fs.mkdirSync(dir, { recursive: true });
      const shot = path.join(dir, "actual.png");
      await page.screenshot({ path: shot, clip: { x: 0, y: 0, width: m.width, height: m.height } });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      await ctx.close();
      const json = execFileSync("python3", [path.join(HERE, "tools/compare_visual.py"), "--screen", id, "--actual", shot, "--output", dir], { encoding: "utf8" });
      const r = JSON.parse(json);
      results.push({ id, content: r.content, work: r.work, primary: r.primary, pass: r.numericPass, overflow });
      console.log(`${id.padEnd(20)} content ${r.content.toFixed(2)}  work ${r.work.toFixed(2)}  primary ${r.primary.toFixed(2)} ${r.numericPass ? "PASS" : "below 92"}${overflow ? "  OVERFLOW" : ""}`);
    }
  } finally {
    await browser.close();
    if (server) server.kill("SIGTERM");
  }
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, "summary.json"), JSON.stringify(results, null, 2));
})().catch((e) => { console.error(e); process.exit(1); });
