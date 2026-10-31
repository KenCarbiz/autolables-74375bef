import { useId, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { MutationBlockedError, useConsoleMutation } from "@/lib/platformConsole/dataSource";
import type { ConsoleIconName, Tone } from "@/lib/platformConsole/types";
import { ConsoleIcon } from "./icons";
import { ConsoleButton, TONE_BG, TONE_TEXT, type Column } from "./ui";

// Primitives shared by the usage, access, audit and reliability screens.

/** Status pill. `plain` is the neutral-background, blue-text style used for Disabled/Trial. */
export const Pill = ({ tone, plain, children }: { tone?: Tone; plain?: boolean; children: ReactNode }) => (
  <span className={cn("inline-flex h-[26px] items-center whitespace-nowrap rounded-[4px] px-[10px] text-[12px] font-bold", plain ? "bg-[#F4F6F9] text-[#075BE8]" : cn(TONE_BG[tone ?? "neutral"], TONE_TEXT[tone ?? "neutral"]))}>
    {children}
  </span>
);

/**
 * Reference table: 43px header, rows of `rowHeight` whose content sits 29px
 * below the row top (the reference draws a taller row than its content).
 * Below md it becomes labelled cards.
 */
export function RefTable<T>({ rows, columns, rowKey, caption, rowHeight, className, emptyNote }: { rows: T[]; columns: Column<T>[]; rowKey: (r: T) => string; caption: string; rowHeight: number; className?: string; emptyNote?: string }) {
  const template = columns.map((c) => c.width).join(" ");
  return (
    <div className={cn("overflow-hidden rounded-[6px] border border-[#D7E1ED] bg-white", className)}>
      <table className="hidden w-full md:table" aria-label={caption}>
        <thead>
          <tr className="grid h-[43px] items-center bg-[#F4F6F9] px-[15px]" style={{ gridTemplateColumns: template }}>
            {columns.map((c) => <th key={c.key} scope="col" className="text-left text-[12px] font-bold text-[#52677C]">{c.header}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={rowKey(r)} className={cn("grid items-center px-[15px]", i < rows.length - 1 && "border-b border-[#D7E1ED]")} style={{ gridTemplateColumns: template, height: rowHeight, paddingBottom: Math.max(0, rowHeight - 58) }}>
              {columns.map((c) => <td key={c.key} className="pr-3 text-[13px] leading-[18px] text-[#132A42]">{c.render(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="divide-y divide-[#D7E1ED] md:hidden" aria-label={caption}>
        {rows.map((r) => (
          <li key={rowKey(r)} className="flex flex-col gap-1.5 p-4">
            {columns.map((c) => (
              <div key={c.key} className="flex flex-wrap items-baseline justify-between gap-x-3 text-[13px]">
                <span className="text-[12px] font-bold text-[#52677C]">{c.cardLabel ?? c.header}</span>
                <span className="min-w-0 break-words text-right text-[#132A42]">{c.render(r)}</span>
              </div>
            ))}
          </li>
        ))}
      </ul>
      {rows.length === 0 && emptyNote && <p className="px-[15px] py-6 text-[13px] text-[#52677C]">{emptyNote}</p>}
    </div>
  );
}

/** Full-width state banner that replaces a metric row (disconnected, not available). */
export const StateBanner = ({ tone, icon, title, children }: { tone: Tone; icon: ConsoleIconName; title: string; children: ReactNode }) => (
  <section role={tone === "warn" ? "alert" : "status"} aria-label={title} className={cn("min-h-[118px] rounded-[8px] border border-[#D7E1ED] px-5 pt-[19px] pb-4", tone === "warn" ? "bg-[#FFF5DE]" : "bg-[#EDF4FF]")}>
    <h2 className="flex items-center gap-[14px] text-[19px] font-bold leading-[30px] text-[#132A42]">
      <ConsoleIcon name={icon} size={20} className={TONE_TEXT[tone]} />
      {title}
    </h2>
    <p className="mt-[16px] text-[14px] leading-[20px] text-[#132A42]">{children}</p>
  </section>
);

export const FootNote = ({ children, className }: { children: ReactNode; className?: string }) => (
  <p className={cn("text-[13px] leading-[18px] text-[#52677C]", className)}>{children}</p>
);

/**
 * Phone-only bar fixed to the bottom of the viewport: a read-only note on the
 * left and a "View details" control that opens the screen's actions in a dialog.
 */
export function PhoneActionBar({ note, detailsTitle, detailsSummary, actionLabel = "View details", children }: { note: string; detailsTitle: string; detailsSummary: string; actionLabel?: string; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 h-20 border-t border-[#D7E1ED] bg-white md:hidden" role="region" aria-label="Screen actions">
      <p className="absolute left-4 top-[19px] text-[11px] leading-[16px] text-[#52677C]">{note}</p>
      <button type="button" onClick={() => setOpen(true)} className="absolute bottom-0 right-4 h-11 w-[174px] rounded-t-[6px] border border-b-0 border-[#D7E1ED] bg-white px-[14px] text-left text-[13px] font-bold text-[#132A42] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#075BE8]">{actionLabel}</button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="w-[calc(100vw-32px)] max-w-[520px] rounded-[8px] border-[#D7E1ED] bg-white p-6 text-[#132A42]">
          <DialogTitle className="text-[17px] font-bold leading-[22px]">{detailsTitle}</DialogTitle>
          <DialogDescription className="text-[13px] leading-[18px] text-[#52677C]">{detailsSummary}</DialogDescription>
          <div className="flex flex-col gap-3">{children}</div>
          <ConsoleButton onClick={() => setOpen(false)}>Close</ConsoleButton>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export interface ReviewActionProps {
  label: string;
  icon?: ConsoleIconName;
  variant?: "primary" | "secondary";
  className?: string;
  /** Action kind sent to the mutation adapter. */
  kind: string;
  scope: string;
  title: string;
  summary: string;
  facts?: { label: string; value: string }[];
  submitLabel?: string;
}

/**
 * A mutating control. It never acts on click: it opens a review dialog that
 * states scope and effect, requires a reason, and submits through
 * useConsoleMutation, whose refusal is shown in the dialog. Radix traps focus,
 * closes on Escape and restores focus to the trigger.
 */
export function ReviewAction({ label, icon, variant = "secondary", className, kind, scope, title, summary, facts = [], submitLabel = "Submit for review" }: ReviewActionProps) {
  const mutate = useConsoleMutation();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ tone: Tone; text: string } | null>(null);
  const op = useRef(`${kind}-${Math.random().toString(36).slice(2, 10)}`);
  const reasonId = useId();

  const submit = async () => {
    setBusy(true);
    setOutcome(null);
    try {
      const r = await mutate({ kind, operationKey: op.current, reason, scope, previewVersion: "review-1" });
      setOutcome({ tone: "good", text: r.message });
    } catch (e) {
      setOutcome({ tone: e instanceof MutationBlockedError ? "warn" : "bad", text: e instanceof Error ? e.message : "The action was refused." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <ConsoleButton variant={variant} className={className} onClick={() => { setOutcome(null); setOpen(true); }}>
        {icon && <ConsoleIcon name={icon} />}
        {label}
      </ConsoleButton>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] w-[calc(100vw-32px)] max-w-[520px] overflow-y-auto rounded-[8px] border-[#D7E1ED] bg-white p-6 text-[#132A42]">
          <DialogTitle className="text-[17px] font-bold leading-[22px]">{title}</DialogTitle>
          <DialogDescription className="text-[13px] leading-[18px] text-[#52677C]">{summary}</DialogDescription>
          {facts.length > 0 && (
            <dl className="mt-1 divide-y divide-[#D7E1ED] rounded-[6px] border border-[#D7E1ED]">
              {facts.map((f) => (
                <div key={f.label} className="flex flex-col gap-0.5 px-3 py-2 sm:flex-row sm:gap-3">
                  <dt className="w-32 shrink-0 text-[12px] font-bold text-[#52677C]">{f.label}</dt>
                  <dd className="text-[13px]">{f.value}</dd>
                </div>
              ))}
            </dl>
          )}
          <label htmlFor={reasonId} className="mt-1 text-[13px] font-bold">Reason (required, recorded in the audit trail)</label>
          <textarea id={reasonId} value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className="w-full rounded-[6px] border border-[#D7E1ED] p-3 text-[13px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#075BE8]" />
          {outcome && (
            <p role="alert" className={cn("flex items-start gap-2 rounded-[6px] px-3 py-2 text-[13px]", outcome.tone === "good" ? "bg-[#E8F5EF] text-[#11734E]" : outcome.tone === "bad" ? "bg-[#FFF0F1] text-[#B42332]" : "bg-[#FFF5DE] text-[#885608]")}>
              <ConsoleIcon name={outcome.tone === "good" ? "check" : "warning"} size={18} className="mt-[1px] shrink-0" />
              {outcome.text}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-3">
            <ConsoleButton onClick={() => setOpen(false)}>Close</ConsoleButton>
            <ConsoleButton variant="primary" disabled={busy || !reason.trim()} onClick={() => { void submit(); }}>{submitLabel}</ConsoleButton>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
