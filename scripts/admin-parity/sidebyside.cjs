"use strict";
// Side-by-side sheets for review: reference | implementation on top, the
// layout-only diff (text boxes masked) and the full diff below, with the
// screen's scores in the caption. Reads scripts/admin-parity/out/results.json
// from the last harness run and writes
// scripts/admin-parity/evidence/side-by-side/<screen>.png.
//
//   node scripts/admin-parity/sidebyside.cjs            every measured screen
//   node scripts/admin-parity/sidebyside.cjs 01,05      selected screens

const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const HERE = __dirname;
const ROOT = path.resolve(HERE, "..", "..");
const OUT = path.join(HERE, "out");
const DEST = path.join(HERE, "evidence", "side-by-side");

const pct = (n) => (typeof n === "number" ? `${n.toFixed(1)}%` : "n/a");
const dataUrl = (file) => `data:image/png;base64,${fs.readFileSync(file).toString("base64")}`;
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

function sheet(entry) {
  const ref = entry.frames.reference;
  const body = ref.body || {};
  const refPng = path.join(ROOT, entry.reference);
  const capPng = path.join(ROOT, ref.file);
  const fullDiff = path.join(ROOT, ref.diff);
  const structure = body.structureDiffFile ? path.join(ROOT, body.structureDiffFile) : null;
  const landmarks = entry.landmarks ? `${entry.landmarks.filter((l) => l.ok).length} of ${entry.landmarks.length} landmarks within 16px` : "no landmarks declared";
  const overflow = entry.responsive.filter((r) => !r.ok).map((r) => r.viewport);
  const panel = (title, file, note) => `
    <figure>
      <figcaption><b>${esc(title)}</b>${note ? ` <span>${esc(note)}</span>` : ""}</figcaption>
      ${file && fs.existsSync(file) ? `<img src="${dataUrl(file)}">` : `<div class="missing">not available</div>`}
    </figure>`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body { margin: 0; padding: 20px 24px 24px; background: #fff; font: 14px/20px Inter, system-ui, sans-serif; color: #17263C; width: 1680px; }
    h1 { font-size: 20px; line-height: 28px; margin: 0 0 4px; }
    p.meta { margin: 0 0 14px; color: #596A80; }
    p.meta b { color: #17263C; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    figure { margin: 0; border: 1px solid #D6DFEA; border-radius: 8px; overflow: hidden; }
    figcaption { padding: 6px 10px; background: #F4F7FB; border-bottom: 1px solid #D6DFEA; font-size: 13px; }
    figcaption span { color: #596A80; }
    img { display: block; width: 100%; height: auto; }
    .missing { padding: 40px; color: #596A80; }
    .legend { margin-top: 10px; color: #596A80; font-size: 12px; }
    .sw { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin: 0 4px -1px 12px; }
  </style></head><body>
    <h1>Screen ${esc(entry.screen)}: ${esc(path.basename(entry.reference, ".png").slice(3).replace(/-/g, " "))}</h1>
    <p class="meta">Reference frame 1586x992. Body parity <b>${pct(body.parityPercent)}</b> (aligned at the section row, offset ${body.offset >= 0 ? "+" : ""}${body.offset ?? 0}px)
      · layout parity, text masked <b>${pct(body.nonText && body.nonText.parityPercent)}</b>
      · text-box parity <b>${pct(body.text && body.text.parityPercent)}</b>
      · content parity ${pct(ref.content.parityPercent)} · ${esc(landmarks)} · overflow ${overflow.length ? esc(overflow.join(", ")) : "none at 1920, 1366, 1024, 390"}</p>
    <div class="grid">
      ${panel("Reference", refPng, "handoff mock")}
      ${panel("Implementation", capPng, "fixture render, Chromium")}
      ${panel("Layout differences", structure, "text boxes masked; red differs, amber text glyphs, blue dynamic masks")}
      ${panel("All differences", fullDiff, "red differs, blue masked")}
    </div>
    <div class="legend">Pixels differ when any channel moves by more than 32 of 255. Layout differences are fills, borders, spacing, component sizes and icons; amber marks pixels inside the implementation's text boxes, where glyph rendering accounts for the difference when the box sits where the mock's text sits.</div>
  </body></html>`;
}

async function main() {
  const only = process.argv[2] ? process.argv[2].split(",").map((s) => s.trim()) : null;
  const results = JSON.parse(fs.readFileSync(path.join(OUT, "results.json"), "utf8"));
  fs.mkdirSync(DEST, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1728, height: 1200 }, deviceScaleFactor: 1 });
  const written = [];
  for (const entry of results.screens) {
    if (only && !only.includes(entry.screen)) continue;
    if (!entry.frames || !entry.frames.reference || !entry.frames.reference.full) continue;
    await page.setContent(sheet(entry), { waitUntil: "load" });
    const file = path.join(DEST, `${entry.screen}.png`);
    await page.screenshot({ path: file, fullPage: true });
    written.push(path.relative(ROOT, file));
  }
  await browser.close();
  process.stdout.write(`${written.length} sheets: ${written.join(", ")}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
