import { useCallback, useEffect, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useLocation, useNavigate } from "react-router-dom";
import { AdminButton } from "@/components/admin/v2/primitives";
import { useReturnFocus } from "@/components/admin/v2/useReturnFocus";
import { registerLeaveGuard } from "@/lib/admin/leaveGuardRegistry";

type Pending = { kind: "href"; href: string } | { kind: "back"; replay: () => void };

/**
 * Guards unsaved work. In-app link clicks are intercepted here; Back and Forward go through the module-level
 * registry in leaveGuardRegistry.ts because the router unmounts the editor before a component listener could
 * run. Tab close and reload use beforeunload. Render LeaveGuardDialog once with the returned state.
 */
export function useLeaveGuard(dirty: boolean) {
  const navigate = useNavigate();
  const location = useLocation();
  const [pending, setPending] = useState<Pending | null>(null);
  const bypass = useRef(false);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
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

  useEffect(() => registerLeaveGuard({ isDirty: () => dirtyRef.current, onBlocked: (replay) => setPending({ kind: "back", replay }) }), []);

  useEffect(() => {
    if (!dirty) return;
    const onClick = (e: MouseEvent) => {
      if (bypass.current || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || (anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname + url.search === here.current) return;
      e.preventDefault();
      e.stopPropagation();
      setPending({ kind: "href", href: url.pathname + url.search + url.hash });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [dirty]);

  const stay = useCallback(() => setPending(null), []);
  const leave = useCallback(() => {
    const target = pending;
    setPending(null);
    if (!target) return;
    bypass.current = true;
    if (target.kind === "href") navigate(target.href);
    else target.replay();
    window.setTimeout(() => { bypass.current = false; }, 0);
  }, [pending, navigate]);

  return { pending: pending !== null, stay, leave };
}

export const LeaveGuardDialog = ({ open, onStay, onLeave }: { open: boolean; onStay: () => void; onLeave: () => void }) => {
  const returnFocus = useReturnFocus(open);
  const keep = useRef<HTMLButtonElement>(null);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => { if (!next) onStay(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-[#0B1526]/50" />
        <DialogPrimitive.Content
          role="alertdialog"
          data-admin-v3=""
          onOpenAutoFocus={(e) => { e.preventDefault(); keep.current?.focus(); }}
          onCloseAutoFocus={returnFocus}
          className="fixed z-[60] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100vw-24px)] sm:w-full max-w-[440px] rounded-xl bg-adm-surface border border-adm-border shadow-xl text-adm-ink p-6 space-y-4"
        >
          <DialogPrimitive.Title className="text-[18px] leading-[26px] font-semibold">Leave without saving?</DialogPrimitive.Title>
          <DialogPrimitive.Description className="text-[14px] leading-[20px] text-adm-muted">
            You have unsaved changes on this page. If you leave now they are discarded.
          </DialogPrimitive.Description>
          <div className="flex justify-end gap-3 flex-wrap">
            <AdminButton variant="danger" onClick={onLeave}>Discard and leave</AdminButton>
            <AdminButton ref={keep} variant="primary" onClick={onStay}>Keep editing</AdminButton>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};
