import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import App from "./App.tsx";
import "./index.css";

// Restore dark mode preference before React renders (prevents flash)
if (localStorage.getItem("dark_mode") === "true") {
  document.documentElement.classList.add("dark");
}

// After a deploy, chunk filenames change. A browser holding a stale shell
// can request an old (now-renamed) chunk, and the dynamic import fails with
// "Importing a module script failed." Reload once to fetch the fresh shell +
// matching chunks. The sessionStorage guard prevents an infinite reload loop.
window.addEventListener("vite:preloadError", () => {
  // Key the guard by BUILD, not by session. It used to be a bare flag that was
  // set and never cleared, so a tab that recovered from one deploy would hard
  // fail on the next — a broken section instead of a refresh.
  const key = `vite_preload_reloaded:${__BUILD_ID__}`;
  if (!sessionStorage.getItem(key)) {
    sessionStorage.setItem(key, "1");
    window.location.reload();
  }
});

// Readable from any phone: open the console, or run `__AUTOLABELS_BUILD__` in
// the address bar via a bookmarklet. Answers "is this the new code?" without
// needing to diff the UI.
(window as unknown as Record<string, unknown>).__AUTOLABELS_BUILD__ = {
  build: __BUILD_ID__, builtAt: __BUILD_TIME__,
};
document.documentElement.setAttribute("data-build", __BUILD_ID__);
console.info(`autolabels build ${__BUILD_ID__} · ${__BUILD_TIME__}`);

createRoot(document.getElementById("root")!).render(
  <HelmetProvider>
    <App />
  </HelmetProvider>
);
