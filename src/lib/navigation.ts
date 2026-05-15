import { useCallback } from "react";
import { useNavigate, type NavigateOptions } from "react-router-dom";

// ──────────────────────────────────────────────────────────────
// useViewTransitionNavigate — was a View Transitions wrapper that
// cross-faded the whole page on every navigate. The cross-fade
// made the sidebar, topbar, and breadcrumb appear to "update"
// alongside the body, which conflicted with the Autocurb-style
// SPA feel where ONLY the body swaps and the chrome sits still.
//
// It is now a thin pass-through over react-router's useNavigate
// so call sites don't have to change. No transitions, no
// snapshotting — React Router re-renders the body, the chrome
// re-renders only the parts whose props actually changed (active
// sidebar item, breadcrumb label) with no animation.
// ──────────────────────────────────────────────────────────────

export const useViewTransitionNavigate = () => {
  const navigate = useNavigate();
  return useCallback(
    (to: string | number, options?: NavigateOptions) => {
      if (typeof to === "number") navigate(to);
      else navigate(to, options);
    },
    [navigate]
  );
};
