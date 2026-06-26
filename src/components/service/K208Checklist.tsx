import { useMemo } from "react";
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

export const k208Checklist = (marks: Record<string, K208Mark>) =>
  K208_ITEMS.map((i) => ({ id: i.id, label: i.label, category: i.category, result: marks[i.id] || "na" }));

interface Props {
  marks: Record<string, K208Mark>;
  onMark: (id: string, mark: K208Mark) => void;
  onPassAll: () => void;
  failureNotes: string;
  onFailureNotes: (v: string) => void;
  notes: string;
  onNotes: (v: string) => void;
}

export default function K208Checklist({ marks, onMark, onPassAll, failureNotes, onFailureNotes, notes, onNotes }: Props) {
  const answered = useMemo(() => k208Answered(marks), [marks]);
  const anyFail = Object.values(marks).some((m) => m === "fail");

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">{answered} of {K208_ITEMS.length} items marked</p>
        <button onClick={onPassAll} className="h-9 px-3 rounded-md bg-emerald-600 text-white text-xs font-semibold">Pass all</button>
      </div>

      {K208_INSPECTION_CATEGORIES.map((cat) => (
        <div key={cat.category} className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-2.5 bg-muted/50 text-xs font-bold uppercase tracking-wider text-foreground">{cat.category}</div>
          <div className="divide-y divide-border/60">
            {cat.items.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <span className="text-sm text-foreground flex-1">{item.label}</span>
                <div className="flex gap-1 shrink-0">
                  {(["pass", "fail", "na"] as const).map((m) => (
                    <button key={m} onClick={() => onMark(item.id, m)}
                      className={`h-8 w-12 rounded-md text-[11px] font-semibold border transition-colors ${
                        marks[item.id] === m
                          ? m === "pass" ? "bg-emerald-600 text-white border-emerald-600"
                            : m === "fail" ? "bg-red-600 text-white border-red-600"
                            : "bg-slate-500 text-white border-slate-500"
                          : "bg-background text-muted-foreground border-border hover:bg-muted"
                      }`}>
                      {m === "pass" ? "Pass" : m === "fail" ? "Fail" : "N/A"}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {anyFail && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-4 space-y-2">
          <label className="text-xs font-bold text-red-800 uppercase tracking-wider">What failed & what was done</label>
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
