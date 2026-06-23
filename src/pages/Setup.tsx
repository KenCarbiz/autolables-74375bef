import { useNavigate } from "react-router-dom";
import { useSetupStatus } from "@/lib/setup/useSetupStatus";
import { Rocket, Check, ArrowRight, ArrowLeft, Sparkles } from "lucide-react";

// Guided go-live checklist for a dealership. Each step links to the existing
// screen that owns that configuration — no duplicate setup data.
const Setup = () => {
  const navigate = useNavigate();
  const { steps, score, ready, completed, total, loading } = useSetupStatus();

  if (loading) return <p className="p-6 text-sm text-muted-foreground">Loading setup status…</p>;

  // First incomplete step is the one we nudge the dealer toward next.
  const nextIdx = steps.findIndex((s) => !s.done);
  const r = 26;
  const circ = 2 * Math.PI * r;

  return (
    <div className="p-4 lg:p-6 max-w-[840px] mx-auto space-y-6">
      <div>
        <button onClick={() => navigate("/dashboard")} className="text-[11px] font-semibold text-muted-foreground hover:text-foreground inline-flex items-center gap-1"><ArrowLeft className="w-3 h-3" /> Dashboard</button>
        <h1 className="mt-1 text-2xl font-bold tracking-tight font-display text-foreground inline-flex items-center gap-2"><Rocket className="w-6 h-6 text-primary" /> Set up AutoLabels</h1>
        <p className="text-sm text-muted-foreground mt-1">A few steps to get your dealership ready to print compliant stickers and publish vehicle passports.</p>
      </div>

      {/* Progress hero */}
      <div className={`rounded-3xl border shadow-sm p-5 sm:p-6 ${ready ? "border-emerald-200 bg-gradient-to-br from-emerald-50 to-card" : "border-border bg-gradient-to-br from-slate-50 to-card"}`}>
        <div className="flex items-center gap-5">
          <div className="relative w-[72px] h-[72px] shrink-0">
            <svg className="w-[72px] h-[72px] -rotate-90" viewBox="0 0 64 64">
              <circle cx="32" cy="32" r={r} fill="none" stroke="currentColor" strokeWidth="6" className="text-muted" />
              <circle cx="32" cy="32" r={r} fill="none" stroke={ready ? "#10B981" : "#0F172A"} strokeWidth="6" strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={circ - (circ * score) / 100} className="transition-all duration-500" />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-lg font-black tabular-nums text-foreground">{score}%</span>
          </div>
          <div className="min-w-0 flex-1">
            <p className={`text-base font-bold ${ready ? "text-emerald-800" : "text-foreground"}`}>{ready ? "You're ready to go live" : "Setup in progress"}</p>
            <p className="text-sm text-muted-foreground">{completed} of {total} steps complete{!ready && nextIdx >= 0 ? ` · next up: ${steps[nextIdx].label}` : ""}</p>
            <div className="mt-2.5 h-2 rounded-full bg-muted overflow-hidden">
              <div className={`h-full rounded-full transition-all duration-500 ${ready ? "bg-emerald-500" : "bg-slate-900"}`} style={{ width: `${score}%` }} />
            </div>
          </div>
          {!ready && nextIdx >= 0 && (
            <button onClick={() => navigate(steps[nextIdx].to)} className="hidden sm:inline-flex shrink-0 items-center gap-2 h-10 px-4 rounded-xl bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 shadow-sm transition-colors">
              Continue <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Steps — vertical stepper with a connecting rail */}
      <div className="relative">
        <div className="absolute left-[27px] top-6 bottom-6 w-px bg-border" aria-hidden />
        <div className="space-y-2.5">
          {steps.map((s, i) => {
            const isNext = i === nextIdx;
            return (
              <button
                key={s.id}
                onClick={() => navigate(s.to)}
                className={`group relative w-full text-left flex items-center gap-4 rounded-2xl border bg-card p-4 transition-all hover:shadow-premium ${isNext ? "border-slate-300 ring-1 ring-slate-900/10 shadow-sm" : "border-border hover:border-foreground/15"}`}
              >
                <span className={`relative z-10 w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-bold ${s.done ? "bg-emerald-100 text-emerald-600" : isNext ? "bg-slate-900 text-white" : "bg-muted text-muted-foreground"}`}>
                  {s.done ? <Check className="w-4 h-4" /> : i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground inline-flex items-center gap-2 flex-wrap">
                    {s.label}
                    {s.optional && <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground bg-muted px-1.5 py-0.5 rounded">Optional</span>}
                    {isNext && <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded"><Sparkles className="w-2.5 h-2.5" /> Next</span>}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">{s.hint}</p>
                </div>
                <span className={`flex-shrink-0 text-xs font-semibold inline-flex items-center gap-1 ${s.done ? "text-muted-foreground" : "text-foreground"} group-hover:gap-1.5 transition-all`}>
                  {s.done ? "Review" : "Set up"} <ArrowRight className="w-3.5 h-3.5" />
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <p className="text-center text-[11px] text-muted-foreground">Compliance note: AutoLabels supports disclosure, manager-approval, and customer-acknowledgment workflows. It does not provide legal compliance certification.</p>
    </div>
  );
};

export default Setup;
