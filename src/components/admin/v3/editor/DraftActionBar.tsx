import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { AdminButton } from "@/components/admin/v2/primitives";
import type { SavePhase } from "@/lib/admin/useSaveFlow";
import { AdminIcon, type AdminIconName } from "./AdminIcon";

export type DraftBarState =
  | { kind: "unchanged" }
  | { kind: "dirty"; count: number }
  | { kind: "invalid"; reason: string }
  | { kind: "reviewing" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "failed"; message?: string }
  | { kind: "conflict"; message?: string };

/** Derives the bar state. `saved` is only reachable when the phase came from a resolved save. */
export function deriveDraftBarState({ phase, dirty, changeCount, firstError, message }: { phase: SavePhase; dirty: boolean; changeCount: number; firstError?: string; message?: string | null }): DraftBarState {
  if (phase === "saving") return { kind: "saving" };
  if (phase === "failed") return { kind: "failed", message: message ?? undefined };
  if (phase === "conflict") return { kind: "conflict", message: message ?? undefined };
  if (phase === "reviewing") return { kind: "reviewing" };
  if (dirty && firstError) return { kind: "invalid", reason: firstError };
  if (dirty) return { kind: "dirty", count: changeCount };
  if (phase === "saved") return { kind: "saved" };
  return { kind: "unchanged" };
}

export function draftBarText(state: DraftBarState): string {
  switch (state.kind) {
    case "unchanged": return "No changes";
    case "dirty": return state.count === 1 ? "1 unsaved change" : `${state.count} unsaved changes`;
    case "invalid": return `Cannot review yet: ${state.reason}`;
    case "reviewing": return "Reviewing changes";
    case "saving": return "Saving changes";
    case "saved": return "Saved";
    case "failed": return state.message ? `Save failed: ${state.message}. Your changes are kept.` : "Save failed. Your changes are kept.";
    case "conflict": return state.message ? `Conflict: ${state.message}` : "Conflict: these settings changed elsewhere. Refresh and review before applying.";
  }
}

const META: Record<DraftBarState["kind"], { icon: AdminIconName; tone: string }> = {
  unchanged: { icon: "check-circle", tone: "text-adm-muted" },
  dirty: { icon: "edit", tone: "text-adm-ink" },
  invalid: { icon: "alert", tone: "text-adm-danger" },
  reviewing: { icon: "eye", tone: "text-adm-ink" },
  saving: { icon: "refresh", tone: "text-adm-ink" },
  saved: { icon: "check-circle", tone: "text-adm-success" },
  failed: { icon: "alert", tone: "text-adm-danger" },
  conflict: { icon: "alert", tone: "text-adm-warning" },
};

export const DraftActionBar = ({
  state,
  onDiscard,
  onReview,
  onRetry,
  onRefresh,
  retryDisabled = false,
  reviewLabel = "Review changes",
  extra,
  className,
}: {
  state: DraftBarState;
  onDiscard: () => void;
  onReview: () => void;
  onRetry?: () => void;
  /** Conflict recovery: reload the latest saved values so the user can review again. */
  onRefresh?: () => void;
  /** The draft is invalid now (for example after further edits following a failure): Retry and Review stay off. */
  retryDisabled?: boolean;
  reviewLabel?: string;
  extra?: ReactNode;
  className?: string;
}) => {
  const { kind } = state;
  const busy = kind === "saving";
  const hasChanges = kind === "dirty" || kind === "invalid" || kind === "reviewing" || kind === "saving" || kind === "failed" || kind === "conflict";
  const meta = META[kind];
  const text = draftBarText(state);
  return (
    <div data-draft-bar={kind} className={cn("sticky bottom-0 z-20 -mx-4 sm:mx-0 border-t sm:border sm:rounded-xl border-adm-border bg-adm-surface shadow-[0_-4px_16px_rgba(27,43,59,0.08)]", className)}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-4 sm:px-5 py-3">
        <p role="status" aria-live="polite" className={cn("flex items-start gap-2 min-w-0 flex-1 basis-[240px] text-[14px] leading-[20px] font-medium", meta.tone)}>
          <AdminIcon name={meta.icon} size="control" className={cn("mt-px", busy && "animate-spin motion-reduce:animate-none")} />
          <span className="min-w-0 break-words">{text}</span>
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          {extra}
          {kind === "failed" && onRetry && <AdminButton variant="primary" onClick={onRetry} disabled={retryDisabled}>Retry save</AdminButton>}
          {kind === "conflict" && onRefresh && <AdminButton variant="primary" onClick={onRefresh}>Refresh and review</AdminButton>}
          <AdminButton variant="secondary" onClick={onDiscard} disabled={!hasChanges || busy}>Discard</AdminButton>
          {kind === "failed" && <AdminButton variant="secondary" onClick={onReview} disabled={retryDisabled}>{reviewLabel}</AdminButton>}
          {kind === "reviewing" && <AdminButton variant="outline" disabled aria-label="Reviewing changes"><AdminIcon name="eye" />Reviewing</AdminButton>}
          {kind !== "failed" && kind !== "conflict" && kind !== "reviewing" && (
            <AdminButton variant="primary" onClick={onReview} disabled={kind !== "dirty"}>{reviewLabel}</AdminButton>
          )}
        </div>
      </div>
    </div>
  );
};
