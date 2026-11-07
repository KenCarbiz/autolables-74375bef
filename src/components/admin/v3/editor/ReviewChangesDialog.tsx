import { useRef, type ReactNode } from "react";
import { normalizeHex } from "@/lib/admin/color";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { AdminButton } from "@/components/admin/v2/primitives";
import { useReturnFocus } from "@/components/admin/v2/useReturnFocus";
import { AdminIcon, IconButton } from "./AdminIcon";

export interface ReviewChangeRow {
  id: string;
  label: string;
  before: ReactNode;
  after: ReactNode;
}

const Value = ({ value }: { value: ReactNode }) => {
  if (value === null || value === undefined || value === "") return <span className="italic text-adm-muted">Not set</span>;
  const hex = typeof value === "string" ? normalizeHex(value) : null;
  if (!hex || !/^#?[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(value as string)) return <>{value}</>;
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden="true" data-swatch="" className="w-[18px] h-[18px] rounded border border-adm-border" style={{ backgroundColor: hex }} />
      {value}
    </span>
  );
};

export const ReviewChangesDialog = ({
  open,
  title = "Review changes",
  scope,
  timing = "Takes effect as soon as you apply.",
  changes,
  impact,
  applyLabel = "Apply changes",
  applying = false,
  error,
  onCancel,
  onApply,
}: {
  open: boolean;
  title?: string;
  /** Where the change lands, for example the rooftop name and whether the value is store-specific. */
  scope: ReactNode;
  timing?: ReactNode;
  changes: ReviewChangeRow[];
  /** Optional consumer impact: documents, routing or customer pages affected. */
  impact?: ReactNode;
  applyLabel?: string;
  applying?: boolean;
  error?: ReactNode;
  onCancel: () => void;
  onApply: () => void;
}) => {
  const returnFocus = useReturnFocus(open);
  const body = useRef<HTMLDivElement>(null);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => { if (!next && !applying) onCancel(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[#0B1526]/50" />
        <DialogPrimitive.Content
          data-admin-v3=""
          onOpenAutoFocus={(e) => { e.preventDefault(); body.current?.focus(); }}
          onCloseAutoFocus={returnFocus}
          onInteractOutside={(e) => { if (applying) e.preventDefault(); }}
          className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100vw-24px)] sm:w-full max-w-[720px] max-h-[calc(100dvh-24px)] max-sm:left-0 max-sm:top-0 max-sm:translate-x-0 max-sm:translate-y-0 max-sm:w-screen max-sm:h-[100dvh] max-sm:max-h-none max-sm:rounded-none flex flex-col rounded-xl bg-adm-surface border border-adm-border shadow-xl text-adm-ink"
        >
          <header className="flex items-start justify-between gap-4 px-5 sm:px-6 pt-5 pb-4 border-b border-adm-divider">
            <div className="min-w-0">
              <DialogPrimitive.Title className="text-[20px] leading-[28px] font-bold">{title}</DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-1 text-[14px] leading-[20px] text-adm-muted">
                {changes.length === 1 ? "1 change" : `${changes.length} changes`} will be applied. Nothing is saved until you apply.
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close asChild>
              <IconButton name="close" label="Close review" disabled={applying} />
            </DialogPrimitive.Close>
          </header>
          <div ref={body} tabIndex={0} role="region" aria-label="Changes to review" className="px-5 sm:px-6 py-5 overflow-y-auto min-h-0 flex-1 space-y-5 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-adm-primary">
            <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[120px_1fr] text-[14px] leading-[20px]">
              <dt className="text-adm-muted">Scope</dt>
              <dd className="font-medium min-w-0 break-words">{scope}</dd>
              <dt className="text-adm-muted">When</dt>
              <dd className="min-w-0 break-words">{timing}</dd>
            </dl>
            {changes.length === 0 ? (
              <p className="text-[14px] text-adm-muted">There are no changes to review.</p>
            ) : (
              <ul className="divide-y divide-adm-divider border border-adm-divider rounded-lg" aria-label="Changed fields">
                {changes.map((c) => (
                  <li key={c.id} className="px-4 py-3">
                    <p className="text-[14px] leading-[20px] font-semibold">{c.label}</p>
                    <div className="mt-1.5 grid gap-1.5 sm:grid-cols-[1fr_auto_1fr] sm:items-start text-[14px] leading-[20px]">
                      <p className="min-w-0 break-words rounded-md bg-adm-workspace px-2.5 py-1.5">
                        <span className="block text-[12px] leading-[16px] text-adm-muted">Current</span>
                        <Value value={c.before} />
                      </p>
                      <AdminIcon name="arrow-right" className="hidden sm:block mt-5 text-adm-muted" />
                      <p className="min-w-0 break-words rounded-md bg-adm-selected px-2.5 py-1.5">
                        <span className="block text-[12px] leading-[16px] text-adm-muted">New</span>
                        <Value value={c.after} />
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {impact && <div data-slot="impact" className="text-[14px] leading-[20px]">{impact}</div>}
            {error && <p role="alert" className="rounded-lg bg-adm-danger-bg text-adm-danger px-3 py-2 text-[14px] font-medium">{error}</p>}
          </div>
          <footer className="px-5 sm:px-6 py-4 border-t border-adm-divider flex items-center justify-end gap-3 flex-wrap">
            <AdminButton variant="secondary" onClick={onCancel} disabled={applying}>Keep editing</AdminButton>
            <AdminButton variant="primary" onClick={onApply} disabled={applying || changes.length === 0}>{applying ? "Applying" : applyLabel}</AdminButton>
          </footer>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};
