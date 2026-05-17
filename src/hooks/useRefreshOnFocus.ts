import { useEffect, useRef } from "react";

// ──────────────────────────────────────────────────────────────
// useRefreshOnFocus — call refresh() when the window regains
// focus or the tab becomes visible, throttled so a fast
// alt-tab burst doesn't fire a stampede.
//
// Pattern used for high-volume datasets where opening a Supabase
// Realtime channel would be wasteful — e.g. audit_log, which
// every signing / listing / recall check writes to. Focus is a
// good proxy for "user just came back to this tab and might be
// looking at stale data" without paying the broadcast cost.
// ──────────────────────────────────────────────────────────────

interface Args {
  refresh: () => void | Promise<void>;
  // Minimum gap between two refreshes, in milliseconds. Default
  // 5000ms — fast enough that a quick alt-tab gets fresh data,
  // slow enough that desktop-switch-storms don't melt the query.
  throttleMs?: number;
  enabled?: boolean;
}

export function useRefreshOnFocus({ refresh, throttleMs = 5000, enabled = true }: Args): void {
  const lastRunRef = useRef(0);
  // Keep the latest refresh in a ref so listeners don't reattach
  // when the callback identity changes between renders.
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;

    const maybeRefresh = () => {
      const now = Date.now();
      if (now - lastRunRef.current < throttleMs) return;
      lastRunRef.current = now;
      void refreshRef.current();
    };

    const onFocus = () => maybeRefresh();
    const onVisibility = () => {
      if (document.visibilityState === "visible") maybeRefresh();
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled, throttleMs]);
}
