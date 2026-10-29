import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

// Below lg the rail is an off-canvas drawer. Open, it is a modal dialog: focus
// moves into it, Tab stays inside it, the page behind it is inert, and every
// way of closing it (Escape, the close button, the scrim, following a link)
// puts focus back on the button that opened it. From lg the same element is
// the sticky rail and none of this applies.

const DESKTOP_QUERY = "(min-width: 1024px)";

const matchesDesktop = () =>
  typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(DESKTOP_QUERY).matches;

export function useIsDesktop(): boolean {
  const [desktop, setDesktop] = useState(matchesDesktop);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mql = window.matchMedia(DESKTOP_QUERY);
    const sync = () => setDesktop(mql.matches);
    sync();
    mql.addEventListener?.("change", sync);
    return () => mql.removeEventListener?.("change", sync);
  }, []);
  return desktop;
}

export interface NavDrawer {
  open: boolean;
  /** Open below lg: the drawer is a modal dialog. */
  modal: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
  /** The menu button that opens the drawer; focus returns here. */
  triggerRef: RefObject<HTMLButtonElement>;
  /** The drawer's close button; focus lands here on open. */
  closeRef: RefObject<HTMLButtonElement>;
  /** Everything behind the drawer; made inert while it is open. */
  backgroundRef: RefObject<HTMLDivElement>;
  /** Classes for the rail element at every width. */
  railClassName: string;
}

export function useNavDrawer(routeKey: string): NavDrawer {
  const [open, setOpen] = useState(false);
  const desktop = useIsDesktop();
  const modal = open && !desktop;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const backgroundRef = useRef<HTMLDivElement>(null);
  const wasModal = useRef(false);

  const openDrawer = useCallback(() => setOpen(true), []);
  const closeDrawer = useCallback(() => setOpen(false), []);

  // A new page closes it; so does growing past lg, where the rail is a column.
  useEffect(() => { setOpen(false); }, [routeKey]);
  useEffect(() => { if (desktop) setOpen(false); }, [desktop]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // A menu or dialog layered on top handles its own Escape first.
      if (e.key === "Escape" && !e.defaultPrevented) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Declared before the focus effect so the page is interactive again by the
  // time focus is sent back to the menu button.
  useEffect(() => {
    const el = backgroundRef.current;
    if (!el) return;
    if (modal) el.setAttribute("inert", "");
    else el.removeAttribute("inert");
  }, [modal]);

  useEffect(() => {
    if (modal) closeRef.current?.focus();
    else if (wasModal.current) triggerRef.current?.focus();
    wasModal.current = modal;
  }, [modal]);

  // Opening shows the drawer at once (only the slide is animated) so focus can
  // land in it in the same frame; closing keeps it visible until the slide ends.
  // From lg the rail is a plain column with no transform and no sticky
  // positioning (main#app-scroll is the scroller), so it adds no compositing
  // layer that would re-rasterize the Admin pages beside it.
  const railClassName = `fixed lg:relative top-0 left-0 z-50 h-screen supports-[height:100dvh]:h-dvh duration-200 motion-reduce:transition-none lg:visible lg:transform-none lg:transition-none ${
    open ? "visible translate-x-0 transition-transform" : "invisible -translate-x-full transition-[transform,visibility]"
  }`;

  return { open, modal, openDrawer, closeDrawer, triggerRef, closeRef, backgroundRef, railClassName };
}
