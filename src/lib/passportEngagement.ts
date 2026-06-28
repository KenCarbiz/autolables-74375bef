import { useEffect, useMemo, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

// ──────────────────────────────────────────────────────────────────────
// usePassportEngagement — measures how long a shopper spends on each passport
// module (the iPacket "Shopper Focus Breakdown"). Credits one second per tick
// to whichever module is most on-screen (or to the open slide-out panel), and
// flushes accumulated per-module seconds to record_passport_engagement.
//
// Tag the on-page sections with data-module="<name>" and pass the open panel
// key. No-ops when disabled (preview/mock) or with no slug.
// ──────────────────────────────────────────────────────────────────────

function sessionId(): string {
  try {
    const k = "al_passport_sid";
    let s = sessionStorage.getItem(k);
    if (!s) { s = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`; sessionStorage.setItem(k, s); }
    return s;
  } catch { return `anon-${Math.random().toString(36).slice(2, 10)}`; }
}

export function usePassportEngagement(slug: string | undefined, activePanel: string | null, enabled = true) {
  const sid = useMemo(() => sessionId(), []);
  const acc = useRef<Record<string, number>>({});
  const panelRef = useRef<string | null>(activePanel);
  useEffect(() => { panelRef.current = activePanel; }, [activePanel]);

  useEffect(() => {
    if (!enabled || !slug || typeof window === "undefined") return;

    const ratios = new Map<Element, { module: string; ratio: number }>();
    let mostVisible: string | null = null;
    const recompute = () => {
      let best: { module: string; ratio: number } | null = null;
      ratios.forEach((v) => { if (!best || v.ratio > best.ratio) best = v; });
      mostVisible = best && best.ratio > 0.15 ? best.module : null;
    };
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        const m = (e.target as HTMLElement).dataset.module;
        if (m) ratios.set(e.target, { module: m, ratio: e.intersectionRatio });
      });
      recompute();
    }, { threshold: [0, 0.15, 0.5, 1] });
    document.querySelectorAll<HTMLElement>("[data-module]").forEach((el) => io.observe(el));

    const tick = window.setInterval(() => {
      if (document.hidden) return;
      const m = panelRef.current || mostVisible;
      if (m) acc.current[m] = (acc.current[m] || 0) + 1;
    }, 1000);

    const flush = () => {
      const payload = acc.current;
      const keys = Object.keys(payload);
      if (!keys.length) return;
      acc.current = {};
      // deno-lint-ignore no-explicit-any
      (supabase as any).rpc("record_passport_engagement", { _slug: slug, _session: sid, _modules: payload }).then(() => {}, () => {
        // restore on failure so the next flush retries
        Object.entries(payload).forEach(([k, v]) => { acc.current[k] = (acc.current[k] || 0) + (v as number); });
      });
    };
    const flushTimer = window.setInterval(flush, 15000);
    const onVis = () => { if (document.hidden) flush(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", flush);

    return () => {
      window.clearInterval(tick); window.clearInterval(flushTimer); io.disconnect();
      document.removeEventListener("visibilitychange", onVis); window.removeEventListener("pagehide", flush);
      flush();
    };
  }, [slug, sid, enabled]);
}
