import { useEffect, useReducer, useState } from "react";
import { AdminIcon, DetailDrawer, StatusBadge, SwitchField } from "@/components/admin/v3/editor";
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
import { AdminButton } from "@/components/admin/v2/primitives";
import { Banner } from "../brand/feeds/bits";
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

const GROUPS: Array<{ title: string; blurb: string; keys: Array<keyof PublishingDraft>; help: Partial<Record<keyof PublishingDraft, string>> }> = [
  {
    title: "Listing visibility",
    blurb: "Whether the vehicle appears to shoppers. Recall blocking still applies first.",
    keys: ["ingest_auto_publish"],
    help: { ingest_auto_publish: "On: the Passport goes live when a vehicle is ingested. Off: a person publishes each one." },
  },
  {
    title: "Document publication",
    blurb: "When stickers and addendums become public. Signed and approved documents keep the version they were signed under.",
    keys: ["requireApprovalBeforePublish", "autoPublishApprovedWindow", "autoPublishApprovedAddendum", "autoUnpublishStale", "hideSupersededPublic"],
    help: {
      requireApprovalBeforePublish: "Documents wait for a manager before they are public.",
      autoPublishApprovedWindow: "Approved window stickers publish without another step. Needs the approval step.",
      autoPublishApprovedAddendum: "Approved addendums publish without another step. Needs the approval step.",
      autoUnpublishStale: "A public document is withdrawn when a price or equipment change makes it stale.",
      hideSupersededPublic: "Older versions are hidden from the public page. They are kept in the record.",
    },
  },
];

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
  const closeable = state.phase !== "applying";

  const footer = (
    <>
      {readOnly && <span className="mr-auto text-[13px] text-adm-muted">Design fixture: apply is not available.</span>}
      {!readOnly && !mayApply && step !== "apply" && <span className="mr-auto text-[13px] text-adm-muted">You can view this policy. Applying needs the manage settings permission.</span>}
      {step === "review" && state.phase === "reviewing" && !gate.ok && <span className="mr-auto text-[13px] text-adm-muted">{gate.reason}</span>}
      {state.phase === "applied" && auditRecorded && <span className="mr-auto"><StatusBadge state="delivered" label="Change recorded in history" /></span>}
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
          <AdminButton variant="primary" onClick={apply} disabled={!gate.ok || !mayApply || state.phase !== "reviewing"}>Apply policy</AdminButton>
        </>
      )}
      {step === "apply" && <AdminButton variant="primary" onClick={onClose} disabled={!closeable}>Done</AdminButton>}
    </>
  );

  return (
    <DetailDrawer open={open} onClose={() => { if (closeable) onClose(); }} title="Publishing policy" description="Edit, preview the impact, then apply. Nothing changes until you apply." footer={footer}>
      <ol className="flex items-center gap-4 flex-wrap" aria-label="Steps">
        {STEPS.map((s, i) => {
          const done = i < stepIndex || state.phase === "applied";
          const current = s.id === step;
          return (
            <li key={s.id} className="flex items-center gap-2 text-[14px]" aria-current={current ? "step" : undefined}>
              <span className={`w-7 h-7 rounded-full flex items-center justify-center text-[13px] font-bold ${done ? "bg-adm-primary text-white" : current ? "border-2 border-adm-primary text-adm-primary" : "border border-adm-border text-adm-muted"}`} aria-hidden="true">
                {done ? <AdminIcon name="check" size="compact" /> : i + 1}
              </span>
              <span className={current ? "font-semibold text-adm-ink" : "text-adm-muted"}>{s.label}</span>
            </li>
          );
        })}
      </ol>

      {step === "edit" && (
        <>
          {GROUPS.map((g) => (
            <fieldset key={g.title} className="space-y-3 min-w-0" disabled={readOnly || !mayApply}>
              <legend className="text-[15px] leading-[22px] font-semibold text-adm-ink">{g.title}</legend>
              <p className="-mt-1 text-[13px] leading-[18px] text-adm-muted">{g.blurb}</p>
              <ul className="divide-y divide-adm-divider rounded-xl border border-adm-divider">
                {g.keys.map((k) => (
                  <li key={k} className="px-4 py-3">
                    <SwitchField label={PUBLISHING_DRAFT_LABELS[k]} checked={state.draft[k]} disabled={readOnly || !mayApply} onChange={(v) => dispatch({ type: "edit", draft: { ...state.draft, [k]: v } })} />
                    <p className="pl-[50px] text-[13px] leading-[18px] text-adm-muted">{g.help[k]}</p>
                  </li>
                ))}
              </ul>
            </fieldset>
          ))}
          {state.validation.length > 0 && <Banner tone="danger" title="Fix before review">{state.validation.join(" ")}</Banner>}
          <p className="text-[13px] leading-[18px] text-adm-muted">The used and CPO inspection gate is owned by Documents and Service, Service policy. Print and packet approvals are owned by Approval rules. Description automation is on Destinations.</p>
        </>
      )}

      {step === "review" && impact && (
        <>
          <Banner tone="info" icon="eye" title="Impact preview is read only">Nothing is written while you look at this. The policy applies only when you choose Apply policy.</Banner>
          <div className="space-y-2">
            <p className="text-[15px] leading-[22px] font-semibold text-adm-ink">Change summary</p>
            {impact.samples.length === 0 ? (
              <Banner tone="neutral" title="Nothing has changed.">The policy in force is shown as the current state.</Banner>
            ) : (
              <table className="w-full text-left text-[14px] leading-[20px]" aria-label="Before and after">
                <caption className="sr-only">Before and after</caption>
                <thead><tr className="text-[13px] text-adm-muted"><th scope="col" className="py-2 pr-2 font-medium">Rule</th><th scope="col" className="py-2 px-2 font-medium">Before</th><th scope="col" className="py-2 pl-2 font-medium">After</th></tr></thead>
                <tbody>
                  {(impact.samples as Array<{ field: keyof PublishingDraft; before: unknown; after: unknown }>).map((r) => (
                    <tr key={r.field} className="border-t border-adm-divider align-top"><td className="py-2 pr-2 text-adm-ink">{PUBLISHING_DRAFT_LABELS[r.field]}</td><td className="py-2 px-2 text-adm-muted">{onOff(r.before)}</td><td className="py-2 pl-2 font-semibold text-adm-ink">{onOff(r.after)}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="rounded-xl border border-adm-divider bg-adm-workspace p-4 space-y-1">
            <p className="text-[13px] text-adm-muted">Expected impact</p>
            <p className="text-[28px] leading-[34px] font-bold text-adm-ink tabular-nums">{activeCount}</p>
            <p className="text-[14px] text-adm-ink">active listings governed from now on</p>
            <p className="text-[13px] text-adm-muted">{publishedCount} currently published. No listing is rewritten.</p>
            <p className="text-[13px] text-adm-muted">Excluded: {impact.exclusions.join("; ")}.</p>
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-[13px] text-adm-muted">
            <dt>Policy version</dt><dd className="text-adm-ink">{impact.version ?? "Not available"}</dd>
            <dt>Impact computed</dt><dd className="text-adm-ink">{new Date(impact.computedAt).toLocaleString()}</dd>
          </dl>
          {impact.warnings.map((w) => <Banner key={w} tone="warning" title={w} />)}
        </>
      )}

      {step === "review" && !impact && state.phase !== "conflict" && <p className="text-[14px] text-adm-muted">The review could not be prepared. Go back to edit and try again.</p>}

      {step === "apply" && (
        <>
          {state.phase === "applying" && <p className="inline-flex items-center gap-2 text-[14px] text-adm-ink"><AdminIcon name="refresh" className="animate-spin motion-reduce:animate-none" />Applying…</p>}
          {state.result && (
            <Banner tone={state.result.status === "applied" ? "info" : state.result.status === "partial" ? "warning" : "danger"} icon={state.result.status === "applied" ? "check-circle" : undefined} title={state.result.status === "applied" ? "Applied" : state.result.status === "partial" ? "Saved, not recorded" : "Not applied"}>
              {state.result.message}
            </Banner>
          )}
        </>
      )}

      {state.error && step !== "apply" && <Banner tone="danger" title={state.error} />}

      {state.phase === "conflict" && (
        <Banner tone="warning" title="Changed elsewhere">The stored policy changed after this review. Nothing was applied. Close this panel, reload the page and review again.</Banner>
      )}
    </DetailDrawer>
  );
}
