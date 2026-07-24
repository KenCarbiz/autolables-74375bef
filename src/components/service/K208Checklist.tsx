import { useMemo } from "react";
import { Check, X, CheckCheck } from "lucide-react";
import { K208_INSPECTION_CATEGORIES } from "@/data/ctK208Form";

// Shared CT K-208 inspection checklist UI + helpers, used by both the no-login
// QR sign-off (/inspect/:token) and the logged-in desktop service page.

export type K208Mark = "pass" | "fail" | "na" | "";

export const K208_ITEMS = K208_INSPECTION_CATEGORIES.flatMap((c) =>
  c.items.map((i) => ({ ...i, category: c.category }))
);

export const k208Answered = (marks: Record<string, K208Mark>) =>
  K208_ITEMS.filter((i) => marks[i.id] && marks[i.id] !== "").length;

export const k208Result = (marks: Record<string, K208Mark>): "pass" | "fail" =>
  Object.values(marks).some((m) => m === "fail") ? "fail" : "pass";

export const k208Checklist = (marks: Record<string, K208Mark>, itemNotes: Record<string, string> = {}) =>
  K208_ITEMS.map((i) => ({ id: i.id, label: i.label, category: i.category, result: marks[i.id] || "na", explanation: (itemNotes[i.id] || "").trim() }));

interface Props {
  marks: Record<string, K208Mark>;
  onMark: (id: string, mark: K208Mark) => void;
  onPassAll: () => void;
  // Optional one-tap undo for "Mark all passed" / clearing a mismark run.
  onClearAll?: () => void;
  failureNotes: string;
  onFailureNotes: (v: string) => void;
  notes: string;
  onNotes: (v: string) => void;
  // Per-item "Explanation of Defects or Repairs Needed" (the official K-208
  // column). When provided, a fail reveals an inline explanation field per item.
  itemNotes?: Record<string, string>;
  onItemNote?: (id: string, v: string) => void;
}

export default function K208Checklist({ marks, onMark, onPassAll, onClearAll, failureNotes, onFailureNotes, notes, onNotes, itemNotes = {}, onItemNote }: Props) {
  const answered = useMemo(() => k208Answered(marks), [marks]);
  const passCount = useMemo(() => K208_ITEMS.filter((i) => marks[i.id] === "pass").length, [marks]);
  const failCount = useMemo(() => K208_ITEMS.filter((i) => marks[i.id] === "fail").length, [marks]);
  const anyFail = failCount > 0;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">{answered}</span> of {K208_ITEMS.length} marked
          {answered > 0 && <> · {passCount} pass · {failCount} fail</>}
        </p>
        <div className="flex items-center gap-2">
          {answered > 0 && onClearAll && (
            <button onClick={onClearAll} className="h-9 px-3 rounded-md border border-border text-xs font-semibold text-muted-foreground hover:bg-muted">Clear all</button>
          )}
          {/* One tap passes every line (the "Clear all" beside it is the undo). */}
          <button onClick={onPassAll} className="h-9 px-3 rounded-md bg-emerald-600 text-white text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-emerald-700">
            <CheckCheck className="w-3.5 h-3.5" /> Mark all passed
          </button>
        </div>
      </div>

      {K208_INSPECTION_CATEGORIES.map((cat) => (
        <div key={cat.category} className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-2.5 bg-muted/50 text-xs font-bold uppercase tracking-wider text-foreground">{cat.category}</div>
          <div className="divide-y divide-border/60">
            {cat.items.map((item) => {
              const failed = marks[item.id] === "fail";
              return (
                <div key={item.id} className={`px-4 py-2.5 ${failed ? "bg-red-50/60" : ""}`}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-foreground flex-1">{item.label}</span>
                    {/* Pass / Fail are one exclusive choice per line — selecting one
                        clears the other, and re-tapping the active one clears it so
                        a mismark is easy to correct. A line can never be both. */}
                    <div className="flex gap-1.5 shrink-0" role="group" aria-label={`${item.label} result`}>
                      {(["pass", "fail"] as const).map((m) => {
                        const active = marks[item.id] === m;
                        const Icon = m === "pass" ? Check : X;
                        const on = m === "pass"
                          ? "bg-emerald-600 text-white border-emerald-600"
                          : "bg-red-600 text-white border-red-600";
                        const off = m === "pass"
                          ? "bg-background text-emerald-700 border-emerald-300 hover:bg-emerald-50"
                          : "bg-background text-red-700 border-red-300 hover:bg-red-50";
                        return (
                          <button
                            key={m}
                            type="button"
                            aria-pressed={active}
                            onClick={() => onMark(item.id, active ? "" : m)}
                            className={`h-11 w-[76px] rounded-md text-[12px] font-bold border inline-flex items-center justify-center gap-1 transition-colors ${active ? on : off}`}
                          >
                            <Icon className="w-3.5 h-3.5" strokeWidth={3} /> {m === "pass" ? "Pass" : "Fail"}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  {failed && onItemNote && (
                    <input autoFocus value={itemNotes[item.id] || ""} onChange={(e) => onItemNote(item.id, e.target.value)}
                      placeholder="Explanation of defects or repairs needed (required)"
                      className="mt-2 w-full rounded-lg border border-red-300 bg-red-50/40 px-3 h-10 text-sm" />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {anyFail && !onItemNote && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 space-y-2">
          <label className="text-xs font-bold text-red-800 uppercase tracking-wider">Explanation of defects or repairs needed</label>
          <textarea value={failureNotes} onChange={(e) => onFailureNotes(e.target.value)} rows={3}
            className="w-full rounded-lg border border-red-200 bg-white p-3 text-sm" placeholder="Describe failures and corrective action taken before sale…" />
        </div>
      )}

      <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
        <label className="text-xs font-bold text-foreground uppercase tracking-wider">Notes (optional)</label>
        <textarea value={notes} onChange={(e) => onNotes(e.target.value)} rows={2} className="w-full rounded-lg border border-border bg-background p-3 text-sm" placeholder="Anything else to record…" />
      </div>
    </div>
  );
}
