import type { ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { useReturnFocus } from "@/components/admin/v2/useReturnFocus";
import { IconButton } from "./AdminIcon";

/**
 * Side sheet on desktop, full screen on mobile. It is a modal layer over the page, so the list underneath keeps
 * its scroll position and focus returns to the row that opened it.
 */
export const DetailDrawer = ({
  open,
  onClose,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) => {
  const returnFocus = useReturnFocus(open);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[#0B1526]/40" />
        <DialogPrimitive.Content
          data-admin-v3=""
          data-detail-drawer=""
          onCloseAutoFocus={returnFocus}
          className="fixed z-50 inset-0 sm:inset-y-0 sm:left-auto sm:right-0 sm:w-[480px] sm:max-w-[calc(100vw-48px)] flex flex-col bg-adm-surface text-adm-ink border-l border-adm-border shadow-xl"
        >
          <header className="flex items-start justify-between gap-4 px-5 pt-5 pb-4 border-b border-adm-divider">
            <div className="min-w-0">
              <DialogPrimitive.Title className="text-[20px] leading-[28px] font-bold break-words">{title}</DialogPrimitive.Title>
              {description ? <DialogPrimitive.Description className="mt-1 text-[14px] leading-[20px] text-adm-muted">{description}</DialogPrimitive.Description> : <DialogPrimitive.Description className="sr-only">Details</DialogPrimitive.Description>}
            </div>
            <DialogPrimitive.Close asChild>
              <IconButton name="close" label="Close details" />
            </DialogPrimitive.Close>
          </header>
          <div tabIndex={0} role="region" aria-label="Details" className="flex-1 min-h-0 overflow-y-auto px-5 py-5 space-y-5 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-adm-primary">{children}</div>
          {footer && <footer className="px-5 py-4 border-t border-adm-divider flex items-center justify-end gap-3 flex-wrap">{footer}</footer>}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};
