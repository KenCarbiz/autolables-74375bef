import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { AdminButton } from "@/components/admin/v2/primitives";
import { diffFields } from "@/lib/admin/reviewApply";
import { describeValue, fieldLabel, type SettingsKey } from "./brandModel";
import type { BrandForm } from "./useBrandForm";

// The footer every brand view ends with: the draft's state in words, then
// Review changes. Review lists every field that would change, before and
// after, and only Apply on that list writes. The button is disabled whenever
// writing would be unsafe or pointless, and the reason is written next to it.

export function BrandSaveBar<K extends SettingsKey>({ form }: { form: BrandForm<K> }) {
  const { dirty, errors, status, error, blockedReason, canSave, changed, draft, original } = form;
  const [reviewing, setReviewing] = useState(false);
  useEffect(() => {
    if (!dirty || status === "saved") setReviewing(false);
  }, [dirty, status]);
  const rows = useMemo(
    () => (reviewing ? diffFields(original as Record<string, unknown>, draft as Record<string, unknown>) : []),
    [reviewing, original, draft],
  );

  const view = (() => {
    if (status === "saving") return { tone: "neutral" as const, title: "Applying...", detail: "Writing your changes to the server." };
    if (status === "error") return { tone: "danger" as const, title: "Couldn't save", detail: error ?? "The server did not accept the change." };
    if (blockedReason && !form.source.isFixture) return { tone: "warning" as const, title: "Settings unavailable", detail: blockedReason };
    if (errors.length) return { tone: "danger" as const, title: errors.length === 1 ? "1 issue to fix" : `${errors.length} issues to fix`, detail: errors[0] };
    if (dirty) return { tone: "warning" as const, title: "Unsaved changes", detail: `${changed.length} ${changed.length === 1 ? "field" : "fields"} changed. Review to apply them.` };
    if (status === "saved") return { tone: "success" as const, title: "Saved", detail: "Your settings are up to date." };
    return { tone: "success" as const, title: "No changes pending", detail: "Your settings are up to date." };
  })();
  const Icon = view.tone === "success" ? CheckCircle2 : status === "saving" ? Loader2 : AlertTriangle;
  const iconClass = view.tone === "success" ? "text-adm-success" : view.tone === "danger" ? "text-adm-danger" : view.tone === "warning" ? "text-adm-warning" : "text-adm-muted";

  return (
    <div className="sticky bottom-0 z-10 mt-2 rounded-t-[10px] border border-b-0 border-adm-border bg-adm-surface">
      {reviewing && rows.length > 0 && (
        <div className="border-b border-adm-border px-4 sm:px-6 py-4" aria-label="Changes to apply">
          <p className="text-[14px] leading-[20px] font-semibold text-adm-ink">Review changes</p>
          <p className="text-[12px] leading-[18px] text-adm-muted">Nothing is written until you apply. Fields not listed here are left as they are.</p>
          <dl className="mt-3 grid grid-cols-1 md:grid-cols-[minmax(0,180px)_minmax(0,1fr)_minmax(0,1fr)] gap-x-6 gap-y-2 text-[13px] leading-[18px]">
            <dt className="hidden md:block text-[12px] font-semibold text-adm-muted">Field</dt>
            <dt className="hidden md:block text-[12px] font-semibold text-adm-muted">Before</dt>
            <dt className="hidden md:block text-[12px] font-semibold text-adm-muted">After</dt>
            {rows.map((r) => (
              <div key={r.field} className="contents">
                <dt className="font-semibold text-adm-ink">{fieldLabel(r.field)}</dt>
                <dd className="text-adm-muted break-words">{describeValue(r.before)}</dd>
                <dd className="text-adm-ink break-words">{describeValue(r.after)}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      <div role="status" aria-live="polite" className="flex items-center justify-between gap-4 px-4 sm:px-6 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <Icon className={`w-6 h-6 flex-shrink-0 ${iconClass} ${status === "saving" ? "animate-spin" : ""}`} aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-[14px] leading-[20px] font-semibold text-adm-ink">{view.title}</p>
            <p className="text-[12px] leading-[18px] text-adm-muted truncate">{view.detail}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {dirty && status !== "saving" && (
            <AdminButton variant="secondary" onClick={() => { setReviewing(false); form.discard(); }}>Discard</AdminButton>
          )}
          {reviewing ? (
            <>
              <AdminButton variant="secondary" onClick={() => setReviewing(false)} disabled={status === "saving"}>Keep editing</AdminButton>
              <AdminButton variant="primary" onClick={() => void form.save()} disabled={!canSave} aria-disabled={!canSave}>Apply changes</AdminButton>
            </>
          ) : (
            <AdminButton variant="primary" onClick={() => setReviewing(true)} disabled={!canSave} aria-disabled={!canSave}>Review changes</AdminButton>
          )}
        </div>
      </div>
    </div>
  );
}
