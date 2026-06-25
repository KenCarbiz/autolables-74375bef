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
  if (!sessionStorage.getItem("vite_preload_reloaded")) {
    sessionStorage.setItem("vite_preload_reloaded", "1");
    window.location.reload();
  }
});

createRoot(document.getElementById("root")!).render(
  <HelmetProvider>
    <App />
  </HelmetProvider>
);
