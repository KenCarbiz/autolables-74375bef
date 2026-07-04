import { useState } from "react";
import { AlertTriangle, Check, Clock } from "lucide-react";

export interface ManagerCheck {
  label: string;
  ok: boolean;
}

interface ManagerReviewPanelProps {
  checks: ManagerCheck[];
  missing: string[];
  onRequestCorrection: (reason: string) => Promise<void>;
}

const ManagerReviewPanel = ({ checks, missing, onRequestCorrection }: ManagerReviewPanelProps) => {
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-card border border-border shadow-premium divide-y divide-border overflow-hidden">
        {checks.map((c) => (
          <div key={c.label} className="min-h-[48px] px-4 py-3 flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-foreground">{c.label}</span>
            {c.ok ? (
              <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-lg bg-emerald-50 text-emerald-700">
                <Check className="w-3.5 h-3.5" /> Complete
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-lg bg-amber-50 text-amber-700">
                <Clock className="w-3.5 h-3.5" /> Pending
              </span>
            )}
          </div>
        ))}
      </div>

      {missing.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-xs font-bold text-amber-900 mb-2 inline-flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4" /> Missing before approval
          </p>
          <ul className="space-y-1">
            {missing.map((m) => (
              <li key={m} className="text-xs text-amber-800 flex items-start gap-1.5">
                <span className="w-1 h-1 rounded-full bg-amber-500 mt-1.5 shrink-0" />
                {m}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-2xl bg-card border border-border shadow-premium p-4">
        {!correctionOpen ? (
          <button
            onClick={() => setCorrectionOpen(true)}
            className="w-full h-12 rounded-xl border-2 border-red-200 text-red-600 text-sm font-bold hover:bg-red-50 transition"
          >
            Request Correction
          </button>
        ) : (
          <div className="space-y-3">
            <p className="text-xs font-semibold text-foreground">
              Request a correction. This creates a new correction event — original signoffs are never edited.
            </p>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="What needs to be fixed or re-done?"
              className="w-full rounded-xl border border-border bg-background p-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-red-500/30"
            />
            <div className="flex gap-2">
              <button
                onClick={() => { setCorrectionOpen(false); setReason(""); }}
                className="flex-1 h-11 rounded-xl border border-border text-sm font-semibold text-foreground hover:bg-muted"
              >
                Cancel
              </button>
              <button
                disabled={!reason.trim() || submitting}
                onClick={async () => {
                  setSubmitting(true);
                  await onRequestCorrection(reason.trim());
                  setSubmitting(false);
                  setCorrectionOpen(false);
                  setReason("");
                }}
                className="flex-1 h-11 rounded-xl bg-red-600 text-white text-sm font-bold hover:bg-red-700 disabled:opacity-40"
              >
                {submitting ? "Sending…" : "Send Correction"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ManagerReviewPanel;
