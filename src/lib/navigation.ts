import { useCallback } from "react";
import { useNavigate, type NavigateOptions } from "react-router-dom";

// ──────────────────────────────────────────────────────────────
// useViewTransitionNavigate — drop-in replacement for useNavigate
// that wraps the React state update in document.startViewTransition
// where the browser supports it. Routes fade/slide into each other
// like a native app on iOS Safari 18+, Chrome 111+, Edge 111+.
// Older browsers fall back to instant navigation.
//
// Usage:
//   const navigate = useViewTransitionNavigate();
//   navigate("/admin?tab=tenants");
// ──────────────────────────────────────────────────────────────

type StartViewTransition = (callback: () => void) => {
  finished: Promise<void>;
  ready: Promise<void>;
  updateCallbackDone: Promise<void>;
  skipTransition: () => void;
};

const hasViewTransitions = (): boolean =>
  typeof document !== "undefined" &&
  typeof (document as unknown as { startViewTransition?: StartViewTransition })
    .startViewTransition === "function" &&
  !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export const useViewTransitionNavigate = () => {
  const navigate = useNavigate();
  return useCallback(
    (to: string | number, options?: NavigateOptions) => {
      const doNavigate = () => {
        if (typeof to === "number") navigate(to);
        else navigate(to, options);
      };
      if (!hasViewTransitions()) {
        doNavigate();
        return;
      }
      // startViewTransition must be called as a method on `document` —
      // a detached reference throws "Illegal invocation" because the
      // browser checks `this` binds to a Document. Wrap in try/catch
      // so an in-flight transition or a future spec quirk can never
      // strand the user on a dead click.
      try {
        (document as unknown as {
          startViewTransition: StartViewTransition;
        }).startViewTransition(doNavigate);
      } catch {
        doNavigate();
      }
    },
    [navigate]
  );
};
