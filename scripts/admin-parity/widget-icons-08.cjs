const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch();
  for (const [w, h] of [[1586, 992], [390, 844]]) {
    const p = await b.newPage({ viewport: { width: w, height: h } });
    await p.goto("http://127.0.0.1:5640/admin/design-fixture/08", { waitUntil: "networkidle" });
    await p.waitForSelector('[data-admin-fixture="08"]');
    await p.evaluate(() => document.fonts.ready);
    const out = await p.evaluate(() => {
      const lum = (c) => { const m = c.match(/[\d.]+/g).map(Number); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
      const items = [...document.querySelectorAll("span")].filter((s) => /^(Call|Contact)/.test(s.textContent.trim()) && s.querySelector("svg") && s.className.includes("rounded-lg"));
      return items.map((s) => {
        const r = s.getBoundingClientRect(); const svg = s.querySelector("svg"); const ir = svg.getBoundingClientRect();
        const text = [...s.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim();
        const range = document.createRange(); const tn = [...s.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim()); range.selectNodeContents(tn); const tr = range.getBoundingClientRect();
        const cs = getComputedStyle(s);
        // Background: the widget card's blue under a 15% white wash.
        let bgEl = s.parentElement; let bg = "rgb(37, 99, 235)";
        for (let e = s.parentElement; e; e = e.parentElement) { const g = getComputedStyle(e).backgroundImage; const c = getComputedStyle(e).backgroundColor; if (g && g !== "none") { const m = g.match(/rgb\([^)]+\)/g); if (m) { bg = m[m.length - 1]; break; } } if (c && !c.includes("0)") && c !== "rgba(0, 0, 0, 0)") { bg = c; break; } }
        const base = bg.match(/[\d.]+/g).map(Number); const wash = base.map((v) => v + (255 - v) * 0.15);
        const fg = cs.color; const L1 = lum(fg); const L2 = lum(`rgb(${wash.join(",")})`); const L0 = lum(bg);
        return {
          label: text, tag: s.tagName.toLowerCase(), role: s.getAttribute("role"), tabindex: s.getAttribute("tabindex"), interactive: !!s.closest("a,button,[role=button],[tabindex]"),
          box: `${Math.round(r.width)}x${Math.round(r.height)}`, icon: `${Math.round(ir.width)}x${Math.round(ir.height)}`, iconAriaHidden: svg.getAttribute("aria-hidden"),
          fontSize: cs.fontSize, fontWeight: cs.fontWeight,
          iconCentreVsTextCentre: +((ir.top + ir.height / 2) - (tr.top + tr.height / 2)).toFixed(2),
          contrastOnWash: +((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)).toFixed(2),
          contrastOnBase: +((Math.max(L1, L0) + 0.05) / (Math.min(L1, L0) + 0.05)).toFixed(2), bg,
        };
      });
    });
    console.log(`${w}x${h}`, JSON.stringify(out, null, 1));
    await p.close();
  }
  await b.close();
})();
