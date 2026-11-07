import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { AdminButton } from "@/components/admin/v2/primitives";
import { useReturnFocus } from "@/components/admin/v2/useReturnFocus";
import { AdminIcon, AdminIconTile, AdvancedDisclosure, BlockedFeatureNotice, StatusBadge, type AdminIconName } from "@/components/admin/v3/editor";
import { cn } from "@/lib/utils";

/** Small caption saying which stored value a field reads and writes. */
export const SourceLine = ({ children, hideOnPhone }: { children: ReactNode; hideOnPhone?: boolean }) => (
  <span className={cn("flex items-start gap-1.5 text-[13px] leading-[18px] text-adm-muted", hideOnPhone && "max-sm:hidden")}>
    <AdminIcon name="database" size="inline" className="mt-px" />
    <span className="min-w-0 break-words">{children}</span>
  </span>
);

export const EditLink = ({ to, children }: { to: string; children: ReactNode }) => (
  <Link to={to} className="inline-flex items-center gap-1 min-h-[44px] sm:min-h-0 text-[14px] leading-[20px] font-semibold text-adm-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-adm-primary rounded">
    {children}
    <AdminIcon name="arrow-right" size="inline" />
  </Link>
);

/** A value owned by another editor: shown, sourced, never editable here. */
export const OwnedValue = ({ label, value, empty = "Not set", source, editTo, editLabel, compactOnPhone }: { label: string; value: string; empty?: string; source: ReactNode; editTo?: string; editLabel?: string; compactOnPhone?: boolean }) => (
  <div className="rounded-lg border border-adm-divider bg-adm-workspace px-4 py-3 min-w-0">
    <div className="flex items-start justify-between gap-3 flex-wrap">
      <div className="min-w-0">
        <p className="text-[13px] leading-[18px] font-medium text-adm-muted">{label}</p>
        <p className={cn("text-[16px] leading-[22px] font-semibold break-words", value ? "text-adm-ink" : "text-adm-muted font-normal")}>{value || empty}</p>
      </div>
      {editTo && <EditLink to={editTo}>{editLabel ?? "Edit"}</EditLink>}
    </div>
    <div className={cn("mt-1.5", compactOnPhone && "max-sm:hidden")}><SourceLine>{source}</SourceLine></div>
  </div>
);

export const IconHeading = ({ icon, title, children }: { icon: AdminIconName; title: string; children?: ReactNode }) => (
  <div className="flex items-center gap-3">
    <AdminIconTile name={icon} />
    <div className="min-w-0">
      <p className="text-[16px] leading-[22px] font-semibold text-adm-ink">{title}</p>
      {children && <p className="text-[13px] leading-[18px] text-adm-muted">{children}</p>}
    </div>
  </div>
);

export interface ReadinessItem { key: string; label: string; value: string; ready: boolean; reason?: ReactNode; editTo: string }

export const ReadinessList = ({ items, label, collapseReady }: { items: ReadinessItem[]; label: string; collapseReady?: boolean }) => {
  const ready = collapseReady ? items.filter((r) => r.ready) : [];
  const rows = collapseReady ? items.filter((r) => !r.ready) : items;
  return (
    <ul aria-label={label} className="divide-y divide-adm-divider">
      {rows.map((r) => (
        <li key={r.key} className="py-3 first:pt-0 last:pb-0 flex items-start gap-3">
          <AdminIcon name={r.ready ? "check-circle" : "alert"} size="card" className={cn("mt-0.5", r.ready ? "text-adm-success" : "text-adm-warning")} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[14px] leading-[20px] font-semibold text-adm-ink">{r.label}</p>
              <StatusBadge state={r.ready ? "enabled" : "setup_required"} label={r.ready ? "Ready" : "Incomplete"} />
            </div>
            <p className={cn("text-[14px] leading-[20px] break-words", r.ready ? "text-adm-ink" : "text-adm-muted", collapseReady && !r.ready && r.reason && "hidden")}>{r.value}</p>
            {!r.ready && r.reason && <p className="mt-0.5 text-[13px] leading-[18px] text-adm-muted">{r.reason}</p>}
            {!r.ready && <div className="mt-1"><EditLink to={r.editTo}>Fix where it is set</EditLink></div>}
          </div>
        </li>
      ))}
      {ready.length > 0 && (
        <li className="py-3 first:pt-0 last:pb-0 flex items-start gap-3">
          <AdminIcon name="check-circle" size="card" className="mt-0.5 text-adm-success" />
          <p className="min-w-0 flex-1 text-[14px] leading-[20px] text-adm-ink"><span className="font-semibold">Ready:</span> {ready.map((r) => r.label).join(", ")}</p>
        </li>
      )}
    </ul>
  );
};

export const PreviewFrame = ({ title, caption, children, draft }: { title: string; caption?: ReactNode; children: ReactNode; draft?: boolean }) => (
  <section aria-label={title} className="rounded-xl border border-adm-divider bg-adm-surface shadow-[0_1px_2px_rgba(27,43,59,0.06)]">
    <header className="flex items-center justify-between gap-3 px-4 sm:px-5 pt-4 pb-3 border-b border-adm-divider flex-wrap">
      <h2 className="text-[16px] leading-[22px] font-semibold text-adm-ink">{title}</h2>
      <StatusBadge state={draft ? "preview_only" : "enabled"} label={draft ? "Draft preview" : "Saved"} />
    </header>
    <div className="p-4 sm:p-5 space-y-3">{children}</div>
    {caption && <p className="px-4 sm:px-5 pb-4 text-[13px] leading-[18px] text-adm-muted">{caption}</p>}
  </section>
);

export const Segmented = <V extends string>({ label, value, onChange, options }: { label: string; value: V; onChange: (v: V) => void; options: Array<{ value: V; label: string }> }) => (
  <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap gap-1 rounded-lg bg-adm-workspace p-1">
    {options.map((o) => (
      <button
        key={o.value}
        type="button"
        role="radio"
        aria-checked={value === o.value}
        onClick={() => onChange(o.value)}
        className={cn(
          "min-h-[36px] max-sm:min-h-[44px] px-3 rounded-md text-[14px] leading-[20px] font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-adm-primary",
          value === o.value ? "bg-adm-surface text-adm-ink shadow-sm" : "text-adm-muted hover:text-adm-ink",
        )}
      >
        {o.label}
      </button>
    ))}
  </div>
);

export const ConfirmDialog = ({ open, title, children, confirmLabel, onConfirm, onCancel }: { open: boolean; title: string; children: ReactNode; confirmLabel: string; onConfirm: () => void; onCancel: () => void }) => {
  const returnFocus = useReturnFocus(open);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => { if (!next) onCancel(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-[#0B1526]/50" />
        <DialogPrimitive.Content
          role="alertdialog"
          data-admin-v3=""
          onCloseAutoFocus={returnFocus}
          className="fixed z-[60] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100vw-24px)] sm:w-full max-w-[460px] rounded-xl bg-adm-surface border border-adm-border shadow-xl text-adm-ink p-6 space-y-4"
        >
          <DialogPrimitive.Title className="text-[18px] leading-[26px] font-semibold">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Description asChild><div className="text-[14px] leading-[20px] text-adm-muted space-y-2">{children}</div></DialogPrimitive.Description>
          <div className="flex justify-end gap-3 flex-wrap">
            <AdminButton variant="secondary" onClick={onCancel}>Cancel</AdminButton>
            <AdminButton variant="danger" onClick={onConfirm}>{confirmLabel}</AdminButton>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};

/**
 * A setting that needs an unapplied database update: one compact card with what it will do and the migration id.
 * The optional inert preview sits in a collapsed disclosure and never carries data.
 */
export const BlockedCard = ({ icon, title, does, migrationId, preview, className }: { icon: AdminIconName; title: string; does: ReactNode; migrationId: string; preview?: ReactNode; className?: string }) => (
  <section aria-label={`${title}, needs a database update`} className={cn("rounded-xl bg-adm-surface border border-adm-divider shadow-[0_1px_2px_rgba(27,43,59,0.06)] p-4 sm:p-5 space-y-3 min-w-0", className)}>
    <div className="flex items-start gap-3">
      <AdminIconTile name={icon} tone="neutral" />
      <div className="min-w-0 flex-1">
        <h2 className="text-[16px] leading-[22px] font-semibold text-adm-ink">{title}</h2>
        <p className="text-[14px] leading-[20px] text-adm-muted">{does}</p>
      </div>
    </div>
    <BlockedFeatureNotice migrationId={migrationId} />
    {preview && (
      <AdvancedDisclosure title="Preview the editor">
        <p className="text-[13px] leading-[18px] text-adm-muted">Inert preview. Nothing here is saved or reflects your data.</p>
        <fieldset disabled className="space-y-3 opacity-70 min-w-0">{preview}</fieldset>
      </AdvancedDisclosure>
    )}
  </section>
);
