import { AlertTriangle, ArrowRight, CheckCircle2, Info, Lock } from "lucide-react";
import type { StickerBlocker } from "@/lib/factorySticker/blockers";
import { hasWindowStickerPermission } from "@/lib/permissions/windowStickerPermissions";

// What is stopping this sticker, and what to do about it.
//
// Each row states the affected field, the values in conflict, where they
// came from, whether a person may correct it, and the recommended
// resolution. A user without the required permission sees the diagnosis
// and is told who can act — never a control that would be refused.

interface Props {
  blockers: StickerBlocker[];
  role: string | null | undefined;
  isPlatformAdmin: boolean;
  onRegenerate?: () => void;
  onRetrieveSourceData?: () => void;
  busy?: boolean;
}

const fmtWhen = (d?: string | null) =>
  d ? new Date(d).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }) : null;

const Field = ({ label, value }: { label: string; value: string }) => (
  <div className="min-w-0">
    <dt className="text-[12px] leading-[18px] text-adm-muted">{label}</dt>
    <dd className="text-[13px] leading-[18px] text-adm-ink break-words">{value}</dd>
  </div>
);

export default function StickerBlockersPanel({
  blockers, role, isPlatformAdmin, onRegenerate, onRetrieveSourceData, busy,
}: Props) {
  if (!blockers.length) {
    return (
      <div className="rounded-[6px] border border-adm-border bg-adm-surface p-4">
        <h2 className="text-[14px] leading-[20px] font-semibold text-adm-ink mb-1.5">Blockers</h2>
        <p className="text-[12.5px] text-emerald-700 inline-flex items-center gap-1.5">
          <CheckCircle2 className="w-4 h-4" /> Nothing is blocking this document.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-[6px] border border-adm-border bg-adm-surface p-4 space-y-3">
      <h2 className="text-[14px] leading-[20px] font-semibold text-adm-ink">
        Blockers ({blockers.length})
      </h2>

      {blockers.map((b) => {
        const permitted = b.requiredPermission
          ? hasWindowStickerPermission(role, b.requiredPermission, isPlatformAdmin)
          : true;
        const blocking = b.severity === "blocking";
        const isRetrieval = b.code === "MISSING_SOURCE_DATA";

        return (
          <div
            key={`${b.code}-${b.affectedField ?? ""}`}
            className="space-y-2.5 border-t border-adm-border pt-3 first:border-t-0 first:pt-0"
          >
            <div className="flex items-start gap-2">
              {blocking
                ? <AlertTriangle className="w-5 h-5 text-adm-danger shrink-0" />
                : <Info className="w-5 h-5 text-adm-warning shrink-0" />}
              <div className="min-w-0 flex-1">
                <p className="text-[14px] leading-[20px] font-semibold text-adm-ink">{b.title}</p>
              </div>
              <span className={`text-[12px] leading-[18px] font-semibold px-2 py-[3px] rounded-[2px] whitespace-nowrap ${blocking ? "bg-adm-danger-bg text-adm-danger" : "bg-adm-warning-bg text-adm-warning"}`}>
                {blocking ? "Blocks publishing" : "Review"}
              </span>
            </div>

            <dl className="grid sm:grid-cols-2 gap-x-4 gap-y-2">
              {b.affectedField && <Field label="Affected field" value={b.affectedField} />}
              {b.currentValue && <Field label="Current value" value={b.currentValue} />}
              {b.conflictingValue && <Field label="Conflicting / missing" value={b.conflictingValue} />}
              {b.source && (
                <Field
                  label="Source"
                  value={b.source + (fmtWhen(b.retrievedAt) ? ` · retrieved ${fmtWhen(b.retrievedAt)}` : "")}
                />
              )}
            </dl>

            <div>
              <p className="text-[12px] leading-[18px] font-semibold text-adm-muted">Recommended resolution</p>
              <p className="text-[13px] leading-[18px] text-adm-ink mt-0.5">{b.recommendedResolution}</p>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {!permitted && b.requiredPermission && (
                <span className="inline-flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                  <Lock className="w-3.5 h-3.5" />
                  Needs <span className="font-mono">{b.requiredPermission}</span> — ask a manager.
                </span>
              )}
              {permitted && isRetrieval && onRetrieveSourceData && (
                <button
                  type="button"
                  onClick={onRetrieveSourceData}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 h-10 px-4 rounded-[6px] border border-adm-border bg-adm-surface text-[14px] font-semibold hover:bg-adm-workspace disabled:opacity-50"
                >
                  Retrieve vehicle data <ArrowRight className="w-5 h-5" />
                </button>
              )}
              {permitted && !isRetrieval && onRegenerate && (
                <button
                  type="button"
                  onClick={onRegenerate}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 h-10 px-4 rounded-[6px] border border-adm-border bg-adm-surface text-[14px] font-semibold hover:bg-adm-workspace disabled:opacity-50"
                >
                  Regenerate after correcting <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
              {permitted && b.correctionPermitted && (
                <span className="text-[11.5px] text-muted-foreground">
                  Correct the value on the Vehicle File, then regenerate.
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
