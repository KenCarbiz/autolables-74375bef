import { useId, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
  AdminIcon, AdminIconTile, AdvancedDisclosure, DraftActionBar, EditorLayout, useIsNarrow, LeaveGuardDialog, ReviewChangesDialog, StatusBadge,
  type AdminIconName, type DraftBarState, type ReviewChangeRow, type StatusState,
} from "@/components/admin/v3/editor";
import type { SavePhase } from "@/lib/admin/useSaveFlow";

export interface ApplyApi {
  barState: DraftBarState;
  discard: () => void;
  refresh: () => void;
  apply: () => Promise<boolean>;
  canApply: boolean;
  rows: ReviewChangeRow[];
  blockedReason: string | null;
  canEdit: boolean;
  flow: { phase: SavePhase; openReview: () => void; closeReview: () => void };
  guard: { pending: boolean; stay: () => void; leave: () => void };
}

export interface ApplyGate {
  ok: boolean;
  reason?: string | null;
}

/** The draft bar, the review dialog and the leave guard shared by the three customer-experience editors. */
export function ApplyChrome({ api, scope, timing, impact, gate, extra }: { api: ApplyApi; scope: ReactNode; timing: ReactNode; impact?: ReactNode; gate?: ApplyGate; extra?: ReactNode }) {
  const blockedByGate = !!gate && !gate.ok;
  const bar: DraftBarState = blockedByGate && api.barState.kind === "dirty" ? { kind: "invalid", reason: gate?.reason ?? "This change cannot be applied yet." } : api.barState;
  const applyOff = !api.canApply || blockedByGate;
  const error = blockedByGate ? gate?.reason : !api.canApply ? api.blockedReason : undefined;
  if (!api.canEdit) return null;
  return (
    <>
      <DraftActionBar state={bar} onDiscard={api.discard} onReview={api.flow.openReview} onRetry={() => void api.apply()} onRefresh={api.refresh} retryDisabled={applyOff} extra={extra} />
      <ReviewChangesDialog
        open={api.flow.phase === "reviewing" || api.flow.phase === "saving"}
        scope={scope}
        timing={timing}
        changes={api.rows}
        impact={impact}
        applying={api.flow.phase === "saving"}
        applyDisabled={applyOff}
        error={error}
        onCancel={api.flow.closeReview}
        onApply={() => void api.apply()}
      />
      <LeaveGuardDialog open={api.guard.pending} onStay={api.guard.stay} onLeave={api.guard.leave} />
    </>
  );
}

export const LoadingBlock = ({ label }: { label: string }) => (
  <div className="h-48 rounded-xl border border-adm-divider bg-adm-surface animate-pulse motion-reduce:animate-none" aria-busy="true" aria-label={label} />
);

/** A switch with a visible description tied to it, so the state reads without colour. */
export function ToggleRow({ label, description, checked, onChange, disabled, badge }: { label: string; description?: ReactNode; checked: boolean; onChange: (next: boolean) => void; disabled?: boolean; badge?: ReactNode }) {
  const id = useId();
  const descId = description ? `${id}-d` : undefined;
  return (
    <div className="flex items-start gap-3 min-h-[44px]">
      <label htmlFor={id} className={cn("relative inline-flex items-center flex-shrink-0 w-12 h-11 -mr-1", disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer")}>
        <input id={id} type="checkbox" role="switch" className="peer sr-only" checked={checked} disabled={disabled} aria-describedby={descId} onChange={(e) => onChange(e.target.checked)} />
        <span aria-hidden="true" className="relative inline-block w-10 h-6 rounded-full bg-adm-border transition-colors peer-checked:bg-adm-primary peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-adm-primary after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:w-5 after:h-5 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:after:translate-x-4" />
      </label>
      <div className="min-w-0 flex-1 pt-2">
        <div className="flex items-center gap-2 flex-wrap">
          <label htmlFor={id} className={cn("text-[14px] leading-[20px] font-medium text-adm-ink", !disabled && "cursor-pointer")}>{label}</label>
          {badge}
        </div>
        {description && <p id={descId} className="text-[13px] leading-[18px] text-adm-muted">{description}</p>}
      </div>
    </div>
  );
}

/** A collapsed section with an at-a-glance summary in the header. */
export function Collapsible({ id, icon, title, summary, open, onToggle, children, status }: { id: string; icon: AdminIconName; title: string; summary?: ReactNode; open: boolean; onToggle: () => void; children: ReactNode; status?: ReactNode }) {
  return (
    <section id={id} className="rounded-xl bg-adm-surface border border-adm-divider shadow-[0_1px_2px_rgba(27,43,59,0.06)]">
      <h3>
        <button type="button" aria-expanded={open} aria-controls={`${id}-body`} onClick={onToggle} className="w-full flex items-center gap-3 sm:gap-4 px-4 sm:px-5 py-3 min-h-[64px] text-left rounded-xl hover:bg-adm-workspace focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-adm-primary">
          <AdminIconTile name={icon} />
          <span className="min-w-0 flex-1">
            <span className="block text-[16px] leading-[24px] font-semibold text-adm-ink">{title}</span>
            {summary && <span className="block text-[13px] leading-[18px] text-adm-muted break-words">{summary}</span>}
          </span>
          {status}
          <AdminIcon name="chevron-down" className={cn("text-adm-muted flex-shrink-0 transition-transform", open && "rotate-180")} />
        </button>
      </h3>
      <div id={`${id}-body`} hidden={!open} className="px-4 sm:px-5 pb-5 pt-4 border-t border-adm-divider space-y-4">{children}</div>
    </section>
  );
}

/** A link to the editor that owns a setting this page only reads. */
export function OwnerLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="inline-flex items-center gap-1 font-semibold text-adm-primary underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-adm-primary rounded-sm min-h-[24px]">
      {children}
      <AdminIcon name="arrow-right" size="compact" />
    </Link>
  );
}

export const TierBadge = ({ state }: { state: "ready" | "needs_setup" | "off" | "per_lead" | "not_in_order" | "unknown" }) => {
  const map: Record<typeof state, [StatusState, string]> = {
    unknown: ["unknown", "Unknown"], ready: ["enabled", "Ready"], needs_setup: ["setup_required", "Needs setup"], off: ["disabled", "Off"], per_lead: ["waiting_for_data", "Per lead"], not_in_order: ["unavailable", "Skipped"],
  };
  return <StatusBadge state={map[state][0]} label={map[state][1]} />;
};

export function useToggleSet(initial: string[] = []) {
  const [open, setOpen] = useState<Set<string>>(new Set(initial));
  return {
    isOpen: (id: string) => open.has(id),
    toggle: (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; }),
    show: (id: string) => setOpen((s) => new Set(s).add(id)),
  };
}

/** Desktop: the preview is a sticky right rail. Mobile: a Preview disclosure at the top, as on the brand editors. */
export function PreviewLayout({ preview, previewLabel, children }: { preview: ReactNode; previewLabel: string; children: ReactNode }) {
  const narrow = useIsNarrow();
  if (narrow) {
    return (
      <div className="space-y-4">
        <AdvancedDisclosure title="Preview" className="bg-adm-surface"><div className="space-y-4 pt-3">{preview}</div></AdvancedDisclosure>
        {children}
      </div>
    );
  }
  return <EditorLayout preview={preview} previewLabel={previewLabel}>{children}</EditorLayout>;
}

export const LINK_ROW = "flex items-center justify-between gap-3 min-h-[44px] px-3 rounded-lg border border-adm-divider bg-adm-surface text-[14px] font-semibold text-adm-primary hover:bg-adm-workspace focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-adm-primary";
