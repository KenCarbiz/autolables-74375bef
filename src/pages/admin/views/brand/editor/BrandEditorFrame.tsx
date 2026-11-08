import type { ReactNode } from "react";
import { AdminIcon, AdvancedDisclosure, DraftActionBar, EditorEmpty, EditorLayout, LeaveGuardDialog, ReviewChangesDialog, ScopeLabel, StatusBadge } from "@/components/admin/v3/editor";
import { AdminButton } from "@/components/admin/v2/primitives";
import { useNarrow } from "./useNarrow";
import type { BrandEditor, BrandEditorContext } from "./useBrandEditor";

export const Notice = ({ tone = "info", title, children }: { tone?: "info" | "warning" | "danger"; title: string; children?: ReactNode }) => {
  const color = tone === "danger" ? "bg-adm-danger-bg text-adm-danger" : tone === "warning" ? "bg-adm-warning-bg text-adm-warning" : "bg-adm-selected text-adm-primary";
  return (
    <div role={tone === "danger" ? "alert" : "note"} className="rounded-lg border border-adm-divider bg-adm-surface px-4 py-3 flex items-start gap-3">
      <span aria-hidden="true" className={`inline-grid place-items-center w-10 h-10 rounded-[10px] flex-shrink-0 ${color}`}>
        <AdminIcon name={tone === "info" ? "info" : "alert"} size="card" />
      </span>
      <div className="min-w-0 pt-0.5">
        <p className="text-[14px] leading-[20px] font-semibold text-adm-ink">{title}</p>
        {children && <div className="mt-0.5 text-[14px] leading-[20px] text-adm-muted">{children}</div>}
      </div>
    </div>
  );
};

interface FrameProps<T extends Record<string, unknown>> {
  ctx: BrandEditorContext;
  editor: BrandEditor<T>;
  /** Plain words for where the review says the change lands. */
  scopeNote: ReactNode;
  impact?: ReactNode;
  preview?: ReactNode;
  previewLabel?: string;
  mobilePreview?: { top: ReactNode; after?: ReactNode };
  children: ReactNode;
}

/** Scope row, access notices, the form and preview columns, and the shared draft, review and leave-guard controls. */
export function BrandEditorFrame<T extends Record<string, unknown>>({ ctx, editor, scopeNote, impact, preview, previewLabel, mobilePreview, children }: FrameProps<T>) {
  const narrow = useNarrow();
  const { source, canEdit, blockedReason } = ctx;
  return (
    <div className="space-y-4" data-brand-editor="">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <ScopeLabel scope="all_rooftops" />
        <span className="flex items-center gap-2 flex-wrap text-[13px] leading-[18px] text-adm-muted">
          {ctx.rooftopName && <span>Viewing from {ctx.rooftopName}</span>}
          {!canEdit && <StatusBadge state="unavailable" label="View only" />}
          {ctx.fixture && <StatusBadge state="preview_only" label="Design fixture" />}
        </span>
      </div>

      {!canEdit && (
        <Notice title="You can view these settings but not change them">
          Changing brand settings needs a role that manages dealership settings, such as owner, admin, general manager, GSM or manager. Ask one of them to make the change.
        </Notice>
      )}
      {canEdit && blockedReason && (
        <Notice tone="warning" title="Saving is unavailable">
          {blockedReason}
        </Notice>
      )}

      <EditorLayout preview={narrow ? mobilePreview?.after : preview} previewLabel={previewLabel}>
        {narrow && (mobilePreview?.top ?? preview) && <AdvancedDisclosure title="Preview" className="bg-adm-surface"><div className="space-y-4">{mobilePreview ? mobilePreview.top : preview}</div></AdvancedDisclosure>}
        {children}
      </EditorLayout>

      {canEdit && (
        <DraftActionBar
          state={editor.barState}
          onDiscard={editor.discard}
          onReview={editor.flow.openReview}
          onRetry={() => void editor.apply(true)}
          onRefresh={() => window.location.reload()}
          retryDisabled={!!blockedReason || !!editor.firstError}
        />
      )}

      <ReviewChangesDialog
        open={editor.reviewOpen}
        scope={<>All rooftops. {scopeNote}</>}
        changes={editor.rows}
        impact={impact}
        applying={editor.flow.phase === "saving"}
        error={source.isFixture ? "Design fixture: nothing you apply here is saved." : undefined}
        onCancel={editor.flow.closeReview}
        onApply={() => void editor.apply()}
      />
      <LeaveGuardDialog open={editor.guard.pending} onStay={editor.guard.stay} onLeave={editor.guard.leave} />
    </div>
  );
}

export const LoadingState = () => (
  <div role="status" aria-label="Loading settings" className="space-y-4">
    {[0, 1, 2].map((i) => (
      <div key={i} className="rounded-xl border border-adm-divider bg-adm-surface p-6 space-y-3">
        <div className="h-5 w-1/3 rounded bg-adm-workspace animate-pulse" />
        <div className="h-10 rounded bg-adm-workspace animate-pulse" />
        <div className="h-10 rounded bg-adm-workspace animate-pulse" />
      </div>
    ))}
  </div>
);

export const LoadFailed = ({ onRetry }: { onRetry?: () => void }) => (
  <EditorEmpty
    tone="danger"
    title="Settings could not be loaded"
    description="Nothing is shown as saved and nothing can be changed until the server answers."
    action={onRetry ? <AdminButton variant="primary" onClick={onRetry}>Try again</AdminButton> : undefined}
  />
);
