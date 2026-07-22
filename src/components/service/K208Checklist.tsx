import { useMemo, useState } from "react";
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
  failureNotes: string;
  onFailureNotes: (v: string) => void;
  notes: string;
  onNotes: (v: string) => void;
  // Per-item "Explanation of Defects or Repairs Needed" (the official K-208
  // column). When provided, a fail reveals an inline explanation field per item.
  itemNotes?: Record<string, string>;
  onItemNote?: (id: string, v: string) => void;
}

export default function K208Checklist({ marks, onMark, onPassAll, failureNotes, onFailureNotes, notes, onNotes, itemNotes = {}, onItemNote }: Props) {
  const answered = useMemo(() => k208Answered(marks), [marks]);
  const anyFail = Object.values(marks).some((m) => m === "fail");
  // "Mark all passed" is a safety-inspection-wide action — a single accidental
  // tap must never pass the whole K-208. Require an explicit second confirmation
  // (CT DMV K-208, Section 4 Method A).
  const [confirmingPassAll, setConfirmingPassAll] = useState(false);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{answered} of {K208_ITEMS.length} items marked</p>
        <button onClick={() => setConfirmingPassAll(true)} className="h-9 px-3 rounded-md bg-emerald-600 text-white text-xs font-semibold">Mark all passed</button>
      </div>

      {confirmingPassAll && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 space-y-3">
          <p className="text-sm font-bold text-amber-900">Confirm full-pass inspection</p>
          <p className="text-[13px] text-amber-800">
            You are confirming that all {K208_ITEMS.length} K-208 inspection items were physically inspected and passed.
            This does not certify the form until an authorized licensee reviews and signs it.
          </p>
          <div className="flex gap-2">
            <button onClick={() => setConfirmingPassAll(false)} className="h-11 px-4 rounded-md border border-border bg-background text-sm font-semibold text-foreground">Cancel</button>
            <button onClick={() => { setConfirmingPassAll(false); onPassAll(); }} className="h-11 px-4 rounded-md bg-emerald-600 text-white text-sm font-semibold">Yes — all {K208_ITEMS.length} inspected &amp; passed</button>
          </div>
        </div>
      )}

      {K208_INSPECTION_CATEGORIES.map((cat) => (
        <div key={cat.category} className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-2.5 bg-muted/50 text-xs font-bold uppercase tracking-wider text-foreground">{cat.category}</div>
          <div className="divide-y divide-border/60">
            {cat.items.map((item) => {
              const failed = marks[item.id] === "fail";
              return (
                <div key={item.id} className="px-4 py-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-foreground flex-1">{item.label}</span>
                    <div className="flex gap-1.5 shrink-0">
                      {(["pass", "fail"] as const).map((m) => (
                        <button key={m} onClick={() => onMark(item.id, m)}
                          className={`h-11 w-16 rounded-md text-[12px] font-semibold border transition-colors ${
                            marks[item.id] === m
                              ? m === "pass" ? "bg-emerald-600 text-white border-emerald-600"
                                : "bg-red-600 text-white border-red-600"
                              : "bg-background text-muted-foreground border-border hover:bg-muted"
                          }`}>
                          {m === "pass" ? "Pass" : "Fail"}
                        </button>
                      ))}
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
