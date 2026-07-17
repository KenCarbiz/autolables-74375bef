/*!
 * AutoLabels Vehicle Passport — embeddable widget loader.
 * Dealer drops this on their VDP:
 *   <script src="https://<app-domain>/embed.js"
 *           data-autolabels-tenant="TENANT_ID"
 *           async></script>
 *
 * On load: derives the app origin from the script src, resolves the current
 * VDP's VIN, injects a floating launcher + slide-out drawer iframed at
 * <origin>/v/<VIN>?embed=1. All UI lives in a Shadow DOM so no dealer-site
 * CSS can bleed in or out.
 */
(function () {
  "use strict";
  if (window.__autolabelsEmbedLoaded) return;
  window.__autolabelsEmbedLoaded = true;

  var script = document.currentScript;
  if (!script) {
    // Fallback: find our script tag if currentScript is missing.
    var all = document.getElementsByTagName("script");
    for (var i = all.length - 1; i >= 0; i--) {
      if (all[i].src && /\/embed\.js(\?|$)/.test(all[i].src)) { script = all[i]; break; }
    }
  }
  if (!script || !script.src) return;

  var ORIGIN = (function () { try { return new URL(script.src).origin; } catch (_) { return ""; } })();
  if (!ORIGIN) return;

  var cfg = {
    tenant:   script.getAttribute("data-autolabels-tenant") || "",
    vin:      script.getAttribute("data-autolabels-vin") || "",
    selector: script.getAttribute("data-vin-selector") || "",
    label:    script.getAttribute("data-label") || "View Vehicle Passport",
    position: (script.getAttribute("data-position") || "right").toLowerCase() === "left" ? "left" : "right",
    accent:   script.getAttribute("data-accent") || "#2563EB",
  };

  var VIN_RE = /\b([A-HJ-NPR-Z0-9]{17})\b/i;

  function resolveVin() {
    // 1. Explicit
    if (cfg.vin && VIN_RE.test(cfg.vin)) return cfg.vin.toUpperCase().match(VIN_RE)[1];
    // 2. Selector — check data-vin then text
    if (cfg.selector) {
      try {
        var el = document.querySelector(cfg.selector);
        if (el) {
          var d = el.getAttribute && el.getAttribute("data-vin");
          if (d && VIN_RE.test(d)) return d.toUpperCase().match(VIN_RE)[1];
          var t = (el.textContent || "").trim();
          if (t && VIN_RE.test(t)) return t.toUpperCase().match(VIN_RE)[1];
        }
      } catch (_) { /* bad selector */ }
    }
    // 3. JSON-LD
    try {
      var scripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (var i = 0; i < scripts.length; i++) {
        var raw = scripts[i].textContent || "";
        var m = raw.match(/"vehicleIdentificationNumber"\s*:\s*"([A-HJ-NPR-Z0-9]{17})"/i);
        if (m) return m[1].toUpperCase();
      }
    } catch (_) {}
    // 4. Meta itemprop
    var meta = document.querySelector('meta[itemprop="vin"], meta[name="vin"]');
    if (meta) {
      var c = meta.getAttribute("content") || "";
      if (VIN_RE.test(c)) return c.toUpperCase().match(VIN_RE)[1];
    }
    // 5. URL
    var url = location.href;
    if (VIN_RE.test(url)) return url.toUpperCase().match(VIN_RE)[1];
    return null;
  }

  function ready(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
    } else {
      fn();
    }
  }

  ready(function () {
    var vin = resolveVin();
    if (!vin) return;

    var host = document.createElement("div");
    host.setAttribute("data-autolabels-embed", "");
    host.style.all = "initial";
    document.body.appendChild(host);

    var root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;

    var style = document.createElement("style");
    style.textContent = [
      ":host, .al-root { all: initial; }",
      ".al-btn {",
      "  position: fixed; bottom: 20px; " + cfg.position + ": 20px;",
      "  z-index: 2147483000;",
      "  font: 600 14px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;",
      "  color: #fff; background: " + cfg.accent + ";",
      "  border: 0; border-radius: 999px; padding: 12px 18px;",
      "  box-shadow: 0 10px 25px rgba(15,23,42,.25), 0 2px 6px rgba(15,23,42,.15);",
      "  cursor: pointer; display: inline-flex; align-items: center; gap: 8px;",
      "  transition: transform .12s ease, box-shadow .12s ease;",
      "}",
      ".al-btn:hover { transform: translateY(-1px); }",
      ".al-btn svg { width: 16px; height: 16px; }",
      ".al-backdrop {",
      "  position: fixed; inset: 0; z-index: 2147483001;",
      "  background: rgba(15,23,42,.55); opacity: 0; pointer-events: none;",
      "  transition: opacity .2s ease;",
      "}",
      ".al-backdrop.open { opacity: 1; pointer-events: auto; }",
      ".al-drawer {",
      "  position: fixed; top: 0; " + cfg.position + ": 0; height: 100%;",
      "  width: 100%; max-width: 460px;",
      "  background: #F6F7F9; z-index: 2147483002;",
      "  transform: translateX(" + (cfg.position === "right" ? "100%" : "-100%") + ");",
      "  transition: transform .28s cubic-bezier(.22,1,.36,1);",
      "  box-shadow: -10px 0 40px rgba(15,23,42,.25);",
      "  display: flex; flex-direction: column;",
      "}",
      ".al-drawer.open { transform: translateX(0); }",
      ".al-head {",
      "  display: flex; align-items: center; justify-content: space-between;",
      "  padding: 10px 14px; background: #0F172A; color: #fff;",
      "  font: 600 13px/1.2 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;",
      "}",
      ".al-close {",
      "  background: transparent; border: 0; color: #fff; cursor: pointer;",
      "  width: 32px; height: 32px; border-radius: 8px; font-size: 20px; line-height: 1;",
      "}",
      ".al-close:hover { background: rgba(255,255,255,.1); }",
      ".al-frame { flex: 1; width: 100%; border: 0; background: #F6F7F9; }",
      ".al-loading {",
      "  position: absolute; inset: 40px 0 0 0; display: flex; align-items: center; justify-content: center;",
      "  color: #64748B; font: 500 13px -apple-system, BlinkMacSystemFont, sans-serif;",
      "}",
      "@media (max-width: 640px) { .al-drawer { max-width: 100%; } }",
    ].join("");
    root.appendChild(style);

    var wrap = document.createElement("div");
    wrap.className = "al-root";
    root.appendChild(wrap);

    var btn = document.createElement("button");
    btn.className = "al-btn";
    btn.type = "button";
    btn.setAttribute("aria-label", cfg.label);
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
      '<path d="M9 3h6l2 4h3v13H4V7h3z"/><circle cx="12" cy="13" r="4"/></svg>' +
      '<span>' + escapeHtml(cfg.label) + '</span>';
    wrap.appendChild(btn);

    var backdrop = document.createElement("div");
    backdrop.className = "al-backdrop";
    wrap.appendChild(backdrop);

    var drawer = document.createElement("div");
    drawer.className = "al-drawer";
    drawer.setAttribute("role", "dialog");
    drawer.setAttribute("aria-label", "Vehicle Passport");
    wrap.appendChild(drawer);

    var head = document.createElement("div");
    head.className = "al-head";
    head.innerHTML = '<span>Vehicle Passport · ' + escapeHtml(vin) + '</span>';
    var closeBtn = document.createElement("button");
    closeBtn.className = "al-close";
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.innerHTML = "&times;";
    head.appendChild(closeBtn);
    drawer.appendChild(head);

    var loading = document.createElement("div");
    loading.className = "al-loading";
    loading.textContent = "Loading…";
    drawer.appendChild(loading);

    var iframe = null;
    var isOpen = false;

    function ensureIframe() {
      if (iframe) return;
      iframe = document.createElement("iframe");
      iframe.className = "al-frame";
      iframe.setAttribute("title", "Vehicle Passport");
      iframe.setAttribute("sandbox", "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-same-origin");
      iframe.setAttribute("allow", "clipboard-write");
      iframe.setAttribute("loading", "lazy");
      var src = ORIGIN + "/v/" + encodeURIComponent(vin) + "?embed=1";
      if (cfg.tenant) src += "&t=" + encodeURIComponent(cfg.tenant);
      iframe.src = src;
      iframe.addEventListener("load", function () { loading.style.display = "none"; });
      drawer.appendChild(iframe);
    }

    function open() {
      if (isOpen) return;
      isOpen = true;
      ensureIframe();
      backdrop.classList.add("open");
      drawer.classList.add("open");
      document.documentElement.style.overflow = "hidden";
    }
    function close() {
      if (!isOpen) return;
      isOpen = false;
      backdrop.classList.remove("open");
      drawer.classList.remove("open");
      document.documentElement.style.overflow = "";
    }

    btn.addEventListener("click", open);
    closeBtn.addEventListener("click", close);
    backdrop.addEventListener("click", close);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });

    window.addEventListener("message", function (e) {
      if (e.origin !== ORIGIN) return;
      var data = e.data || {};
      if (!data || typeof data !== "object") return;
      if (data.type === "autolabels:close") close();
      if (data.type === "autolabels:resize" && typeof data.height === "number") {
        // Advisory; drawer is full-height. Ignored unless we later switch to modal.
      }
    });

    // Public API for programmatic control.
    window.AutoLabelsPassport = { open: open, close: close, vin: vin };
  });

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
})();
