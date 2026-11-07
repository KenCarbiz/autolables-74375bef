import { useCallback, useEffect, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useLocation, useNavigate } from "react-router-dom";
import { AdminButton } from "@/components/admin/v2/primitives";
import { useReturnFocus } from "@/components/admin/v2/useReturnFocus";

type Pending = { kind: "href"; href: string } | { kind: "back" };

/**
 * Guards unsaved work. The app uses a classic BrowserRouter, which has no blocker API, so in-app link clicks and
 * Back are intercepted here and tab close or reload uses beforeunload. Render the returned `dialog` once.
 */
export function useLeaveGuard(dirty: boolean) {
  const navigate = useNavigate();
  const location = useLocation();
  const [pending, setPending] = useState<Pending | null>(null);
  const bypass = useRef(false);
  const ignorePop = useRef(false);
  const here = useRef(location.pathname + location.search);
  here.current = location.pathname + location.search;

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    if (!dirty) return;
    const onClick = (e: MouseEvent) => {
      if (bypass.current || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || (anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      const next = url.pathname + url.search + url.hash;
      if (url.pathname + url.search === here.current) return;
      e.preventDefault();
      e.stopPropagation();
      setPending({ kind: "href", href: next });
    };
    const onPop = () => {
      if (ignorePop.current) { ignorePop.current = false; return; }
      ignorePop.current = true;
      window.history.go(1);
      setPending({ kind: "back" });
    };
    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", onPop);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", onPop);
    };
  }, [dirty]);

  const stay = useCallback(() => setPending(null), []);
  const leave = useCallback(() => {
    const target = pending;
    setPending(null);
    if (!target) return;
    bypass.current = true;
    if (target.kind === "href") navigate(target.href);
    else { ignorePop.current = true; window.history.go(-1); }
    window.setTimeout(() => { bypass.current = false; }, 0);
  }, [pending, navigate]);

  return { pending: pending !== null, stay, leave };
}

export const LeaveGuardDialog = ({ open, onStay, onLeave }: { open: boolean; onStay: () => void; onLeave: () => void }) => {
  const returnFocus = useReturnFocus(open);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => { if (!next) onStay(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-[#0B1526]/50" />
        <DialogPrimitive.Content
          role="alertdialog"
          onCloseAutoFocus={returnFocus}
          className="fixed z-[60] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100vw-24px)] sm:w-full max-w-[440px] rounded-xl bg-adm-surface border border-adm-border shadow-xl text-adm-ink p-6 space-y-4"
        >
          <DialogPrimitive.Title className="text-[18px] leading-[26px] font-semibold">Leave without saving?</DialogPrimitive.Title>
          <DialogPrimitive.Description className="text-[14px] leading-[20px] text-adm-muted">
            You have unsaved changes on this page. If you leave now they are discarded.
          </DialogPrimitive.Description>
          <div className="flex justify-end gap-3 flex-wrap">
            <AdminButton variant="danger" onClick={onLeave}>Discard and leave</AdminButton>
            <AdminButton variant="primary" onClick={onStay}>Keep editing</AdminButton>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};
