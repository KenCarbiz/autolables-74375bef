import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";

// Radix dialogs return focus only to a DialogTrigger. Administration dialogs
// open from plain buttons and menu items, so on close focus fell to the page
// body. This remembers the element focused when the dialog opened (or an
// explicit element, such as the row menu trigger behind a menu item) and
// returns focus there from onCloseAutoFocus.
export const useReturnFocus = (open: boolean, explicit?: RefObject<HTMLElement | null>) => {
  const opener = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (open) opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }, [open]);
  return useCallback((event: Event) => {
    const target = explicit?.current?.isConnected ? explicit.current : opener.current?.isConnected ? opener.current : null;
    if (!target) return;
    event.preventDefault();
    target.focus();
  }, [explicit]);
};
