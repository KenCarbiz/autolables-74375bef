import { useEffect, useReducer, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { hasDealerCapability } from "@/lib/permissions/dealerRoleCapabilities";
import { canApply, initialReviewApply, newIdempotencyKey, reviewApplyReducer, type ApplyResult, type ReviewApplyState } from "@/lib/admin/reviewApply";
import { countDisplay, knownCount } from "@/lib/admin/health";
import {
  PUBLISHING_AUDIT_ACTION,
  PUBLISHING_DRAFT_KEYS,
  PUBLISHING_DRAFT_LABELS,
  describePublishingImpact,
  publishingAuditDetails,
  publishingDraftFrom,
  publishingDraftUnchanged,
  publishingPatchFromDraft,
  validatePublishingDraft,
  type ListingCounts,
  type PublishingDraft,
  type PublishingSettingsSlice,
} from "@/lib/admin/publishingPolicy";
import { AdminButton, AdminTable, InlineNote, StatusChip, Td, Th } from "@/components/admin/v2/primitives";
import { readStoredPublishingPolicy } from "./usePublishingData";

// Review & Apply for the publishing keys. Opening the dialog writes nothing.
// Edit builds a draft; Review freezes an impact snapshot against the policy
// fingerprint; Apply re-reads the stored policy, refuses if it moved, then
// writes through merge_dealer_settings (the settings context) and records an
// audit row. A write that did not happen is reported as not applied.

export type ReviewStep = "edit" | "review" | "apply";

export interface PublishingReviewDialogProps {
  open: boolean;
  onClose: () => void;
  initialStep: ReviewStep;
  /** A draft kept by the page between openings, or null to start from the enforced policy. */
  initialDraft: PublishingDraft | null;
  settingsSlice: PublishingSettingsSlice;
  counts: ListingCounts | null | undefined;
  policyVersion: string | number | null;
  /** Fixture renders never apply. */
  readOnly?: boolean;
  tenantId: string | null;
  onDraftChange?: (draft: PublishingDraft | null) => void;
  onApplied?: () => void;
}

const STEPS: Array<{ id: ReviewStep; label: string }> = [
  { id: "edit", label: "Edit" },
  { id: "review", label: "Review" },
  { id: "apply", label: "Apply" },
];

const onOff = (v: unknown) => (v === true ? "On" : v === false ? "Off" : String(v));

export default function PublishingReviewDialog(props: PublishingReviewDialogProps) {
  const { open, onClose, initialStep, initialDraft, settingsSlice, counts, policyVersion, readOnly = false, tenantId, onDraftChange, onApplied } = props;
  const { updateSettings } = useDealerSettings();
  const { user, isAdmin } = useAuth();
  const { member } = useEntitlements();

  const review = (s: ReviewApplyState<PublishingDraft>): ReviewApplyState<PublishingDraft> => {
    const errors = validatePublishingDraft(s.draft);
    const validated = reviewApplyReducer(s, { type: "validate", errors });
    if (errors.length) return validated;
    return reviewApplyReducer(validated, {
      type: "review",
      impact: describePublishingImpact(s.draft, s.original, counts ?? null, policyVersion, new Date().toISOString()),
      idempotencyKey: newIdempotencyKey("publishing"),
    });
  };

  const [state, dispatch] = useReducer(reviewApplyReducer<PublishingDraft>, null, () => {
    const original = publishingDraftFrom(settingsSlice);
    let s = initialReviewApply(original);
    if (initialDraft && !publishingDraftUnchanged(initialDraft, original)) s = reviewApplyReducer(s, { type: "edit", draft: initialDraft });
    return initialStep === "review" ? review(s) : s;
  });
  const [step, setStep] = useState<ReviewStep>(() => (state.phase === "reviewing" ? "review" : "edit"));
  const [auditRecorded, setAuditRecorded] = useState(false);

  useEffect(() => {
    if (state.phase !== "editing" && state.phase !== "reviewing") return;
    onDraftChange?.(publishingDraftUnchanged(state.draft, state.original) ? null : state.draft);
  }, [state.phase, state.draft, state.original, onDraftChange]);

  const mayApply = !readOnly && hasDealerCapability(member?.role, "can_manage_settings", isAdmin);
  const gate = canApply(state, policyVersion ?? undefined);

  const toReview = () => {
    const next = review(state);
    dispatch({ type: "validate", errors: next.validation });
    if (next.validation.length) return;
    if (next.impact && next.idempotencyKey) dispatch({ type: "review", impact: next.impact, idempotencyKey: next.idempotencyKey });
    setStep("review");
  };

  const apply = async () => {
    if (!mayApply || !tenantId) return;
    const stored = await readStoredPublishingPolicy(tenantId);
    if (!stored) {
      dispatch({ type: "error", message: "The stored policy could not be re-read, so nothing was applied. Try again." });
      return;
    }
    const freshGate = canApply(state, stored.version);
    if (!freshGate.ok) {
      if (state.impact && stored.version !== state.impact.version) dispatch({ type: "conflict", changedFields: [] });
      else dispatch({ type: "error", message: freshGate.reason ?? "The change cannot be applied." });
      return;
    }
    dispatch({ type: "apply" });
    setStep("apply");
    // A writer that throws is a refused save too; the dialog must leave "applying".
    let ok = false;
    try {
      ok = await updateSettings(publishingPatchFromDraft(state.draft, stored.settings));
    } catch {
      ok = false;
    }
    let audited = false;
    if (ok && state.idempotencyKey) {
      try {
        const { error } = await (supabase as unknown as { from: (t: string) => any })
          .from("audit_log")
          .insert({
            action: PUBLISHING_AUDIT_ACTION,
            entity_type: "tenant",
            entity_id: tenantId,
            store_id: tenantId,
            user_id: user?.id ?? null,
            user_email: user?.email ?? null,
            details: publishingAuditDetails(state.original, state.draft, state.idempotencyKey, stored.version),
          });
        audited = !error;
      } catch {
        audited = false;
      }
    }
    setAuditRecorded(audited);
    const changed = state.impact?.counts.changed_rules ?? null;
    const result: ApplyResult = !ok
      ? { status: "failed", affected: 0, message: "The policy was not saved. Your draft is kept; check your access to this dealership's settings and try again." }
      : audited
        ? { status: "applied", affected: changed, message: "Publishing policy saved. It governs publication decisions from now on; existing listings were not rewritten." }
        : { status: "partial", affected: changed, message: "The policy was saved, but the change could not be recorded in the change history." };
    dispatch({ type: "result", result });
    if (ok) onApplied?.();
  };

  const impact = state.impact;
  const activeCount = impact && impact.counts.active_listings !== null ? countDisplay(knownCount(impact.counts.active_listings)) : "Unavailable";
  const publishedCount = impact && impact.counts.published_listings !== null ? countDisplay(knownCount(impact.counts.published_listings)) : "Unavailable";
  const stepIndex = STEPS.findIndex((s) => s.id === step);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-[900px] max-h-[calc(100dvh-48px)] overflow-y-auto rounded-[12px] p-0" data-admin-v2="">
        <div className="px-6 pt-6">
          <DialogHeader>
            <DialogTitle className="text-[22px] leading-[28px] font-bold text-adm-ink">Review publishing policy change</DialogTitle>
            <DialogDescription className="text-[13px] text-adm-muted">No update is applied until you confirm in the Apply step.</DialogDescription>
          </DialogHeader>
          <ol className="mt-4 flex items-center gap-6" aria-label="Steps">
            {STEPS.map((s, i) => {
              const done = i < stepIndex || state.phase === "applied";
              const current = s.id === step;
              return (
                <li key={s.id} className="flex items-center gap-2 text-[13px]" aria-current={current ? "step" : undefined}>
                  <span className={`w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-bold ${done ? "bg-adm-primary text-white" : current ? "border-2 border-adm-primary text-adm-primary" : "border border-adm-border text-adm-muted"}`} aria-hidden="true">
                    {done ? <Check className="w-4 h-4" /> : i + 1}
                  </span>
                  <span className={current ? "font-semibold text-adm-ink" : "text-adm-muted"}>{s.label}</span>
                </li>
              );
            })}
          </ol>
        </div>

        <div className="px-6 py-5 space-y-4">
          {step === "edit" && (
            <>
              <ul className="divide-y divide-adm-border rounded-[10px] border border-adm-border">
                {PUBLISHING_DRAFT_KEYS.map((k) => (
                  <li key={k} className="flex items-center justify-between gap-4 px-4 py-3">
                    <label htmlFor={`pub-${k}`} className="text-[14px] text-adm-ink">{PUBLISHING_DRAFT_LABELS[k]}</label>
                    <Switch id={`pub-${k}`} checked={state.draft[k]} onCheckedChange={(v) => dispatch({ type: "edit", draft: { ...state.draft, [k]: v } })} disabled={readOnly} />
                  </li>
                ))}
              </ul>
              {state.validation.length > 0 && <InlineNote tone="danger" title="Fix before review">{state.validation.join(" ")}</InlineNote>}
              <p className="text-[12px] text-adm-muted">The used and CPO inspection gate is owned by Documents & Service, Service policy. Print and packet approvals are owned by Documents & Service, Approval rules.</p>
            </>
          )}

          {step === "review" && impact && (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,3fr)_minmax(240px,2fr)] gap-4">
                <div>
                  <p className="text-[14px] font-semibold text-adm-ink mb-2">Change summary</p>
                  {impact.samples.length === 0 ? (
                    <InlineNote tone="info">Nothing has changed. The policy in force is shown as the current state.</InlineNote>
                  ) : (
                    <AdminTable caption="Before and after">
                      <thead><tr><Th>Rule</Th><Th>Before</Th><Th>After</Th></tr></thead>
                      <tbody>
                        {(impact.samples as Array<{ field: keyof PublishingDraft; before: unknown; after: unknown }>).map((s) => (
                          <tr key={s.field}><Td>{PUBLISHING_DRAFT_LABELS[s.field]}</Td><Td>{onOff(s.before)}</Td><Td className="font-semibold">{onOff(s.after)}</Td></tr>
                        ))}
                      </tbody>
                    </AdminTable>
                  )}
                  <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-[12px] text-adm-muted">
                    <dt>Policy version</dt><dd className="text-adm-ink">{impact.version ?? "Not available"}</dd>
                    <dt>Impact computed</dt><dd className="text-adm-ink">{new Date(impact.computedAt).toLocaleString()}</dd>
                  </dl>
                </div>
                <div className="space-y-3">
                  <p className="text-[14px] font-semibold text-adm-ink">Expected impact</p>
                  <div className="rounded-[10px] border border-adm-border bg-adm-workspace px-4 py-3">
                    <p className="text-[28px] leading-[34px] font-bold text-adm-ink tabular-nums">{activeCount}</p>
                    <p className="text-[13px] text-adm-ink">active listings governed from now on</p>
                    <p className="text-[12px] text-adm-muted">{publishedCount} currently published. No listing is rewritten.</p>
                  </div>
                  <div className="rounded-[10px] border border-adm-border bg-adm-workspace px-4 py-3 text-[12px] text-adm-muted">
                    Excluded: {impact.exclusions.join("; ")}.
                  </div>
                </div>
              </div>
              {impact.warnings.map((w) => <InlineNote key={w} tone="warning">{w}</InlineNote>)}
            </>
          )}

          {step === "review" && !impact && state.phase !== "conflict" && <p className="text-[13px] text-adm-muted">The review could not be prepared. Go back to edit and try again.</p>}

          {step === "apply" && (
            <>
              {state.phase === "applying" && <p className="inline-flex items-center gap-2 text-[14px] text-adm-ink"><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> Applying…</p>}
              {state.result && (
                <InlineNote tone={state.result.status === "applied" ? "success" : state.result.status === "partial" ? "warning" : "danger"} title={state.result.status === "applied" ? "Applied" : state.result.status === "partial" ? "Saved, not recorded" : "Not applied"}>
                  {state.result.message}
                </InlineNote>
              )}
            </>
          )}

          {state.error && step !== "apply" && <InlineNote tone="danger">{state.error}</InlineNote>}

          {state.phase === "conflict" && (
            <InlineNote tone="warning" title="Changed elsewhere">
              The stored policy changed after this review. Nothing was applied. Close this dialog, reload the page and review again.
            </InlineNote>
          )}
        </div>

        <DialogFooter className="px-6 py-4 border-t border-adm-border flex-row items-center justify-between gap-3 sm:justify-between">
          <div className="text-[12px] text-adm-muted">
            {step === "review" && state.phase === "reviewing" && !gate.ok && <span>{gate.reason}</span>}
            {step === "review" && !mayApply && !readOnly && <span>Applying requires settings-management permission.</span>}
            {readOnly && <span>Fixture preview: apply is not available.</span>}
            {state.phase === "applied" && auditRecorded && <StatusChip tone="success" icon>Change recorded in history</StatusChip>}
          </div>
          <div className="flex items-center gap-2">
            {step === "edit" && (
              <>
                {!readOnly && !publishingDraftUnchanged(state.draft, state.original) && (
                  <AdminButton variant="secondary" onClick={() => { dispatch({ type: "reset" }); onDraftChange?.(null); onClose(); }}>Discard draft</AdminButton>
                )}
                <AdminButton variant="secondary" onClick={onClose}>Cancel</AdminButton>
                <AdminButton variant="primary" onClick={toReview}>Continue to review</AdminButton>
              </>
            )}
            {step === "review" && (
              <>
                <AdminButton variant="secondary" onClick={() => { dispatch({ type: "edit", draft: state.draft }); setStep("edit"); }}>Back to edit</AdminButton>
                <AdminButton variant="primary" onClick={apply} disabled={!gate.ok || !mayApply || state.phase !== "reviewing"}>
                  Apply policy
                </AdminButton>
              </>
            )}
            {step === "apply" && (
              <AdminButton variant="primary" onClick={onClose} disabled={state.phase === "applying"}>Done</AdminButton>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
