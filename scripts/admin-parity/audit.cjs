#!/usr/bin/env node
// Administration V2 screen audit: the checks a screenshot score cannot make.
// Runs every registered design fixture at desktop, tablet and phone sizes and
// records, per screen and viewport: page overflow, clipped or truncated text,
// overlapping controls, heading structure, controls without an accessible
// name, small touch targets, keyboard focus without a visible change, text
// contrast (light, and again with the app's dark class), every icon's rendered
// size, centring and background, hover feedback, and disabled and selected
// semantics. Output: scripts/admin-parity/out/audit.json and a summary on
// stdout. Fixtures are the deterministic, dev-only design fixtures; nothing
// here touches live data.
//
//   node scripts/admin-parity/audit.cjs [--base-url http://127.0.0.1:5190] [--screens 01,05]

const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright");
const { startDevServer } = require("./capture.cjs");

const ROOT = path.resolve(__dirname, "../..");
const LANDMARKS = JSON.parse(fs.readFileSync(path.join(__dirname, "landmarks.json"), "utf8"));
const VIEWPORTS = [
  { name: "desktop", width: 1586, height: 992 },
  { name: "laptop", width: 1366, height: 768 },
  { name: "tablet-landscape", width: 1024, height: 768 },
  { name: "tablet-portrait", width: 768, height: 1024 },
  { name: "phone", width: 390, height: 844 },
];

function parseArgs(argv) {
  const out = { baseUrl: null, port: 5191, screens: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--base-url") out.baseUrl = argv[++i];
    else if (argv[i] === "--port") out.port = Number(argv[++i]);
    else if (argv[i] === "--screens") out.screens = argv[++i].split(",");
  }
  return out;
}

// Runs in the page. Everything is measured from the rendered DOM.
function inspect() {
  // A review dialog renders in a portal; when one is open it is the screen.
  const root = document.querySelector('[role="dialog"]') || document.querySelector("[data-admin-v2]") || document.body;
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05;
  };
  const describe = (el) => {
    const t = (el.getAttribute("aria-label") || el.textContent || el.getAttribute("title") || "").replace(/\s+/g, " ").trim().slice(0, 60);
    return `${el.tagName.toLowerCase()}${el.getAttribute("role") ? `[role=${el.getAttribute("role")}]` : ""} "${t}"`;
  };
  const rgb = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const bgOf = (el) => {
    let layers = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.backgroundImage && s.backgroundImage !== "none") return null;
      const c = rgb(s.backgroundColor);
      if (c && c.a > 0) { layers.push(c); if (c.a >= 0.99) break; }
    }
    let out = { r: 255, g: 255, b: 255 };
    for (const c of layers.reverse()) out = { r: c.r * c.a + out.r * (1 - c.a), g: c.g * c.a + out.g * (1 - c.a), b: c.b * c.a + out.b * (1 - c.a) };
    return out;
  };

  const res = { overflowX: document.documentElement.scrollWidth - window.innerWidth, clipped: [], overlaps: [], headings: [], unnamed: [], smallTargets: [], contrast: [], icons: [], images: [], disabledNoSemantics: [], selected: [] };

  // Clipped or truncated text.
  const srOnly = (el) => { const r = el.getBoundingClientRect(); return r.width <= 1 || r.height <= 1; };
  for (const el of root.querySelectorAll("*")) {
    if (!visible(el) || !el.childNodes.length || srOnly(el)) continue;
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!hasText) continue;
    const s = getComputedStyle(el);
    const clipsX = (s.overflowX === "hidden" || s.overflow === "hidden" || s.textOverflow === "ellipsis") && el.scrollWidth > el.clientWidth + 1;
    const clipsY = (s.overflowY === "hidden" || s.overflow === "hidden" || Number(s.webkitLineClamp) > 0) && el.scrollHeight > el.clientHeight + 2;
    if (clipsX || clipsY) res.clipped.push({ el: describe(el), full: el.textContent.replace(/\s+/g, " ").trim().slice(0, 90), axis: clipsX ? "x" : "y", title: el.getAttribute("title") || el.closest("[title]")?.getAttribute("title") || null });
  }

  // Interactive elements: names, sizes, overlaps.
  const interactive = [...root.querySelectorAll('a[href], button, input, select, textarea, [role="switch"], [role="tab"], [role="button"], [role="checkbox"], [role="radio"], summary')].filter(visible);
  const nameOf = (el) => {
    const label = el.getAttribute("aria-label");
    if (label && label.trim()) return label.trim();
    const by = el.getAttribute("aria-labelledby");
    if (by) { const t = by.split(/\s+/).map((id) => document.getElementById(id)?.textContent || "").join(" ").trim(); if (t) return t; }
    if (el.labels && el.labels.length) { const t = [...el.labels].map((l) => l.textContent).join(" ").trim(); if (t) return t; }
    if (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return (el.getAttribute("title") || el.getAttribute("placeholder") ? `(placeholder/title only) ${el.getAttribute("title") || el.getAttribute("placeholder")}` : "");
    const t = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (t) return t;
    const img = el.querySelector("img[alt]");
    if (img && img.alt.trim()) return img.alt.trim();
    return el.getAttribute("title") || "";
  };
  // A label that activates its control is part of the control's target (WCAG 2.5.8).
  const targetRect = (el) => {
    const rects = [el.getBoundingClientRect()];
    if (el.labels) for (const l of el.labels) if (visible(l)) rects.push(l.getBoundingClientRect());
    const wrap = el.closest("label");
    if (wrap && visible(wrap)) rects.push(wrap.getBoundingClientRect());
    return rects.reduce((u, r) => ({ left: Math.min(u.left, r.left), top: Math.min(u.top, r.top), right: Math.max(u.right, r.right), bottom: Math.max(u.bottom, r.bottom) }), { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
  };
  const targets = interactive.filter((el) => !srOnly(el) || (el.labels && el.labels.length)).map((el) => ({ el, r: targetRect(el) }));
  const distToRect = (cx, cy, r) => Math.hypot(Math.max(r.left - cx, 0, cx - r.right), Math.max(r.top - cy, 0, cy - r.bottom));
  for (const el of interactive) {
    const n = nameOf(el);
    if (!n || n.startsWith("(placeholder/title only)")) res.unnamed.push({ el: describe(el), html: el.outerHTML.slice(0, 140), note: n || "no name" });
    if (el.disabled === false && el.getAttribute("aria-disabled") !== "true" && /pointer-events: none/.test(el.getAttribute("style") || "")) res.disabledNoSemantics.push(describe(el));
    if (el.getAttribute("aria-current") || el.getAttribute("aria-selected") === "true" || el.getAttribute("aria-pressed") === "true") res.selected.push(describe(el));
  }
  for (const t of targets) {
    const { r } = t;
    const w = r.right - r.left, h = r.bottom - r.top;
    if (w >= 24 && h >= 24) continue;
    const inSentence = t.el.tagName === "A" && getComputedStyle(t.el).display === "inline" && t.el.parentElement && (t.el.parentElement.textContent || "").trim().length > (t.el.textContent || "").trim().length + 20;
    if (inSentence) continue;
    // Spacing exception: a 24px circle on the target's centre touches no other target.
    const cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
    const crowded = targets.some((o) => o !== t && !o.el.contains(t.el) && !t.el.contains(o.el) && distToRect(cx, cy, o.r) < 12);
    const entry = { el: describe(t.el), w: Math.round(w), h: Math.round(h), spacingException: !crowded };
    if (crowded) res.smallTargets.push(entry); else (res.smallButSpaced = res.smallButSpaced || []).push(entry);
  }
  // Phone: targets under 44px (platform guidance, advisory; WCAG AA is the 24px rule above).
  if (window.innerWidth < 600) res.under44 = targets.filter(({ r }) => (r.right - r.left) < 44 || (r.bottom - r.top) < 44).map(({ el, r }) => `${describe(el)} ${Math.round(r.right - r.left)}x${Math.round(r.bottom - r.top)}`);
  for (let i = 0; i < interactive.length; i++) {
    for (let j = i + 1; j < interactive.length; j++) {
      const a = interactive[i], b = interactive[j];
      if (a.contains(b) || b.contains(a)) continue;
      if (a.labels && [...a.labels].some((l) => l.contains(b) || b.contains(l))) continue;
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      const w = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left), h = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (w > 2 && h > 2) res.overlaps.push({ a: describe(a), b: describe(b), w: Math.round(w), h: Math.round(h) });
    }
  }

  // Headings.
  for (const h of document.querySelectorAll("h1, h2, h3, h4")) if (visible(h)) res.headings.push(`${h.tagName}: ${h.textContent.replace(/\s+/g, " ").trim().slice(0, 70)}`);

  // Text contrast.
  for (const el of root.querySelectorAll("*")) {
    if (!visible(el)) continue;
    const own = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim()).map((n) => n.textContent.trim()).join(" ");
    if (!own) continue;
    if (el.closest("[disabled], [aria-disabled='true']")) continue;
    const s = getComputedStyle(el);
    const fg = rgb(s.color), bg = bgOf(el);
    if (!fg || !bg) continue;
    const effFg = { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a) };
    const size = parseFloat(s.fontSize), bold = Number(s.fontWeight) >= 700;
    const need = size >= 24 || (bold && size >= 18.66) ? 3 : 4.5;
    const cr = ratio(effFg, bg);
    if (cr < need) res.contrast.push({ text: own.slice(0, 50), ratio: Math.round(cr * 100) / 100, need, size, color: s.color });
  }

  // Icons and images.
  for (const svg of root.querySelectorAll("svg")) {
    if (!visible(svg)) continue;
    const r = svg.getBoundingClientRect();
    const box = svg.parentElement;
    const br = box.getBoundingClientRect();
    const bs = getComputedStyle(box);
    const boxed = bs.backgroundColor !== "rgba(0, 0, 0, 0)" && bs.backgroundColor !== "transparent" && br.width <= 64 && br.height <= 64;
    const cls = svg.getAttribute("class") || "";
    const name = (cls.match(/lucide-([a-z0-9-]+)/) || [])[1] || (svg.getAttribute("data-icon") || "svg");
    res.icons.push({
      name,
      w: Math.round(r.width * 10) / 10,
      h: Math.round(r.height * 10) / 10,
      boxed,
      box: boxed ? `${Math.round(br.width)}x${Math.round(br.height)}` : null,
      offCentre: boxed ? Math.round(Math.max(Math.abs((r.left + r.width / 2) - (br.left + br.width / 2)), Math.abs((r.top + r.height / 2) - (br.top + br.height / 2))) * 10) / 10 : null,
      decorative: svg.getAttribute("aria-hidden") === "true",
    });
  }
  for (const img of root.querySelectorAll("img")) {
    if (!visible(img)) continue;
    const s = getComputedStyle(img), ps = getComputedStyle(img.parentElement);
    res.images.push({ src: (img.getAttribute("src") || "").slice(0, 80), alt: img.getAttribute("alt"), imgBackground: s.backgroundColor, imgPadding: s.padding, parentBackground: ps.backgroundColor, parentPadding: ps.padding, w: Math.round(img.getBoundingClientRect().width), h: Math.round(img.getBoundingClientRect().height) });
  }
  return res;
}

async function focusPass(page) {
  // Tab through the page and record controls whose focus changes nothing visible.
  const misses = [];
  const seen = new Set();
  await page.evaluate(() => { document.activeElement && document.activeElement.blur(); window.scrollTo(0, 0); });
  for (let i = 0; i < 120; i++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      if (!el.closest('[data-admin-v2], [role="dialog"]')) return { outside: true };
      const s = getComputedStyle(el);
      const key = `${el.tagName}|${el.id}|${el.textContent?.slice(0, 30)}|${Math.round(el.getBoundingClientRect().top)}`;
      const focused = { outline: `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor}`, shadow: s.boxShadow, bg: s.backgroundColor, border: s.borderColor, deco: s.textDecorationLine };
      el.blur();
      const u = getComputedStyle(el);
      const unfocused = { outline: `${u.outlineStyle} ${u.outlineWidth} ${u.outlineColor}`, shadow: u.boxShadow, bg: u.backgroundColor, border: u.borderColor, deco: u.textDecorationLine };
      el.focus();
      const changed = Object.keys(focused).some((k) => focused[k] !== unfocused[k]);
      const t = (el.getAttribute("aria-label") || el.textContent || el.getAttribute("placeholder") || "").replace(/\s+/g, " ").trim().slice(0, 50);
      return { key, changed, el: `${el.tagName.toLowerCase()} "${t}"` };
    });
    if (!info) break;
    if (info.outside) continue;
    if (seen.has(info.key)) break;
    seen.add(info.key);
    if (!info.changed) misses.push(info.el);
  }
  return { tabStops: seen.size, noVisibleFocus: misses };
}

async function hoverPass(page) {
  const scope = (await page.$('[role="dialog"]')) ? '[role="dialog"]' : "[data-admin-v2]";
  const handles = await page.$$(`${scope} button:not([disabled]), ${scope} a[href]`);
  const flat = [];
  for (const h of handles.slice(0, 40)) {
    await h.scrollIntoViewIfNeeded().catch(() => {});
    const box = await h.boundingBox();
    if (!box || box.width < 4) continue;
    const before = await h.evaluate((el) => { const s = getComputedStyle(el); return [s.backgroundColor, s.color, s.borderColor, s.textDecorationLine, s.boxShadow].join("|"); });
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.waitForTimeout(160);
    const after = await h.evaluate((el) => { const s = getComputedStyle(el); return [s.backgroundColor, s.color, s.borderColor, s.textDecorationLine, s.boxShadow].join("|"); });
    if (before === after) flat.push(await h.evaluate((el) => `${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40)}"`));
  }
  await page.mouse.move(1, 1);
  return flat;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let server = null;
  let baseUrl = args.baseUrl;
  if (!baseUrl) { server = await startDevServer({ cwd: ROOT, port: args.port }); baseUrl = `http://127.0.0.1:${args.port}`; }
  const browser = await chromium.launch();
  const out = { generatedAt: new Date().toISOString(), baseUrl, screens: {} };
  try {
    const screens = args.screens || Object.keys(LANDMARKS).filter((k) => /^\d\d$/.test(k)).sort();
    for (const screen of screens) {
      out.screens[screen] = {};
      const rail = LANDMARKS[screen]?._rail || 229;
      for (const vp of VIEWPORTS) {
        const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1 });
        const page = await ctx.newPage();
        const errors = [];
        page.on("pageerror", (e) => errors.push(String(e.message || e)));
        page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 160)); });
        await page.goto(`${baseUrl}/admin/design-fixture/${screen}?rail=${rail}`, { waitUntil: "networkidle" });
        await page.waitForSelector("[data-admin-v2]", { timeout: 15000 });
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(250);
        const r = await page.evaluate(inspect);
        r.errors = errors;
        if (vp.name === "desktop" || vp.name === "phone") r.focus = await focusPass(page);
        if (vp.name === "desktop") {
          r.hoverWithoutFeedback = await hoverPass(page);
          await page.evaluate(() => document.documentElement.classList.add("dark"));
          await page.waitForTimeout(150);
          r.darkContrast = (await page.evaluate(inspect)).contrast;
        }
        out.screens[screen][vp.name] = r;
        await ctx.close();
      }
      const d = out.screens[screen].desktop, p = out.screens[screen].phone;
      process.stdout.write(`${screen}: overflow ${VIEWPORTS.map((v) => out.screens[screen][v.name].overflowX).join("/")} · clipped ${d.clipped.length}/${p.clipped.length} · overlaps ${d.overlaps.length}/${p.overlaps.length} · h1 ${d.headings.filter((h) => h.startsWith("H1")).length} · unnamed ${d.unnamed.length} · small targets ${d.smallTargets.length}/${p.smallTargets.length} · no-focus ${d.focus.noVisibleFocus.length}/${d.focus.tabStops} · contrast ${d.contrast.length} (dark ${d.darkContrast.length}) · icons ${d.icons.length} (<16px ${d.icons.filter((i) => Math.max(i.w, i.h) < 16).length}, off-centre ${d.icons.filter((i) => i.offCentre > 1).length}) · errors ${d.errors.length}\n`);
    }
  } finally {
    await browser.close();
    if (server) server.stop();
  }
  fs.mkdirSync(path.join(__dirname, "out"), { recursive: true });
  fs.writeFileSync(path.join(__dirname, "out", "audit.json"), JSON.stringify(out, null, 2));
  process.stdout.write("audit: scripts/admin-parity/out/audit.json\n");
}

main().catch((e) => { console.error(e); process.exit(1); });
