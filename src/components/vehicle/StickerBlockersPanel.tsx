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
    <dt className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
    <dd className="text-[12px] text-foreground break-words">{value}</dd>
  </div>
);

export default function StickerBlockersPanel({
  blockers, role, isPlatformAdmin, onRegenerate, onRetrieveSourceData, busy,
}: Props) {
  if (!blockers.length) {
    return (
      <div className="rounded-2xl border border-border bg-card p-4">
        <h2 className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground mb-1.5">Blockers</h2>
        <p className="text-[12.5px] text-emerald-700 inline-flex items-center gap-1.5">
          <CheckCircle2 className="w-4 h-4" /> Nothing is blocking this document.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
      <h2 className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
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
            className={`rounded-xl border p-3.5 space-y-2.5 ${blocking ? "border-rose-200 bg-rose-50/40" : "border-amber-200 bg-amber-50/40"}`}
          >
            <div className="flex items-start gap-2">
              {blocking
                ? <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                : <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />}
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-bold text-foreground">{b.title}</p>
                <p className="text-[10px] font-mono text-muted-foreground mt-0.5">{b.code}</p>
              </div>
              <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded whitespace-nowrap ${blocking ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"}`}>
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

            <div className="rounded-lg bg-background/70 border border-border/60 p-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Recommended resolution</p>
              <p className="text-[12px] text-foreground mt-0.5">{b.recommendedResolution}</p>
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
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-[12.5px] font-semibold disabled:opacity-50"
                >
                  Retrieve vehicle data <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
              {permitted && !isRetrieval && onRegenerate && (
                <button
                  type="button"
                  onClick={onRegenerate}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border bg-background text-[12.5px] font-semibold hover:bg-muted/40 disabled:opacity-50"
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
