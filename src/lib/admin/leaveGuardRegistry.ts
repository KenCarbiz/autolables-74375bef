// react-router's BrowserRouter listens for popstate and unmounts the old route before any component-level
// listener could run, so a guard inside the editor never sees Back or Forward. This module installs one
// window listener at import time (src/main.tsx imports it before React renders), which therefore runs ahead of
// the router's. While an editor is dirty it cancels the pop by walking history back by the same delta and hands
// the editor a replay function that re-applies the original navigation.

export interface LeaveGuardEntry {
  isDirty: () => boolean;
  onBlocked: (replay: () => void) => void;
}

const entries = new Set<LeaveGuardEntry>();
let installed = false;
let lastIdx: number | null = null;
let lastPath = "";
let pending: { originIdx: number | null; timer: ReturnType<typeof setTimeout> } | null = null;
let bypass = false;
let uninstall: (() => void) | null = null;

const idxOf = (): number | null => {
  const idx = (window.history.state as { idx?: unknown } | null)?.idx;
  return typeof idx === "number" ? idx : null;
};
const pathOf = () => window.location.pathname + window.location.search;

export function syncLeaveGuardLocation() {
  const idx = idxOf();
  if (idx !== null) lastIdx = idx;
  lastPath = pathOf();
}

// One install per window: a re-evaluated module (HMR, duplicate import) must not stack a second set of
// history wrappers and popstate listeners.
const GLOBAL_KEY = "__autolabelsLeaveGuard";
type Slot = { uninstall: () => void };
const slot = () => (window as unknown as Record<string, Slot | undefined>)[GLOBAL_KEY];

const clearPending = () => {
  if (pending) clearTimeout(pending.timer);
  pending = null;
};

export function installLeaveGuardListener(): () => void {
  if (installed && uninstall) return uninstall;
  slot()?.uninstall();
  installed = true;
  syncLeaveGuardLocation();

  const push = window.history.pushState;
  const replace = window.history.replaceState;
  window.history.pushState = function (...args: Parameters<History["pushState"]>) {
    push.apply(this, args);
    syncLeaveGuardLocation();
  };
  window.history.replaceState = function (...args: Parameters<History["replaceState"]>) {
    replace.apply(this, args);
    syncLeaveGuardLocation();
  };

  const onPop = (event: PopStateEvent) => {
    if (pending) {
      event.stopImmediatePropagation();
      const current = idxOf();
      if (pending.originIdx === null || current === pending.originIdx) {
        clearPending();
        syncLeaveGuardLocation();
      } else if (current !== null) {
        window.history.go(pending.originIdx - current);
      }
      return;
    }
    if (bypass) {
      bypass = false;
      syncLeaveGuardLocation();
      return;
    }
    const dirty = Array.from(entries).find((e) => e.isDirty());
    const nextIdx = idxOf();
    const sameDocument = pathOf() === lastPath;
    if (!dirty || sameDocument) {
      syncLeaveGuardLocation();
      return;
    }
    event.stopImmediatePropagation();
    const delta = nextIdx !== null && lastIdx !== null && nextIdx !== lastIdx ? nextIdx - lastIdx : -1;
    pending = {
      originIdx: lastIdx,
      timer: setTimeout(() => { pending = null; syncLeaveGuardLocation(); }, 500),
    };
    window.history.go(-delta);
    dirty.onBlocked(() => {
      bypass = true;
      window.history.go(delta);
    });
  };
  window.addEventListener("popstate", onPop, true);

  uninstall = () => {
    window.removeEventListener("popstate", onPop, true);
    window.history.pushState = push;
    window.history.replaceState = replace;
    installed = false;
    uninstall = null;
    clearPending();
    bypass = false;
    entries.clear();
    if (slot()?.uninstall === self) delete (window as unknown as Record<string, Slot | undefined>)[GLOBAL_KEY];
  };
  const self = uninstall as () => void;
  (window as unknown as Record<string, Slot | undefined>)[GLOBAL_KEY] = { uninstall: self };
  return uninstall;
}

export function registerLeaveGuard(entry: LeaveGuardEntry): () => void {
  installLeaveGuardListener();

import.meta.hot?.dispose(() => uninstall?.());
  syncLeaveGuardLocation();
  entries.add(entry);
  return () => { entries.delete(entry); };
}

export const leaveGuardEntryCount = () => entries.size;

installLeaveGuardListener();

import.meta.hot?.dispose(() => uninstall?.());
