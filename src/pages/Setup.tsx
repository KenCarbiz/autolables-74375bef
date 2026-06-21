import { useNavigate } from "react-router-dom";
import { useSetupStatus } from "@/lib/setup/useSetupStatus";
import { Rocket, Check, Circle, ArrowRight, ArrowLeft } from "lucide-react";

// Guided go-live checklist for a dealership. Each step links to the existing
// screen that owns that configuration — no duplicate setup data.
const Setup = () => {
  const navigate = useNavigate();
  const { steps, score, ready, completed, total, loading } = useSetupStatus();

  if (loading) return <p className="p-6 text-sm text-muted-foreground">Loading setup status…</p>;

  return (
    <div className="p-4 lg:p-6 max-w-[820px] mx-auto space-y-5">
      <div>
        <button onClick={() => navigate("/dashboard")} className="text-[11px] font-semibold text-blue-600 hover:underline inline-flex items-center gap-1"><ArrowLeft className="w-3 h-3" /> Dashboard</button>
        <h1 className="text-xl font-semibold tracking-tight font-display text-foreground inline-flex items-center gap-2"><Rocket className="w-5 h-5 text-primary" /> Set up AutoLabels</h1>
        <p className="text-xs text-muted-foreground mt-1">A few steps to get your dealership ready to print compliant stickers and publish vehicle passports.</p>
      </div>

      {/* Score */}
      <div className={`rounded-2xl border p-4 ${ready ? "border-emerald-200 bg-emerald-50" : "border-border bg-card"}`}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className={`text-sm font-bold ${ready ? "text-emerald-800" : "text-foreground"}`}>{ready ? "You're ready to go live" : "Setup in progress"}</p>
            <p className="text-xs text-muted-foreground">{completed} of {total} steps complete</p>
          </div>
          <div className="text-right">
            <p className={`text-3xl font-black tabular-nums ${ready ? "text-emerald-600" : "text-foreground"}`}>{score}%</p>
          </div>
        </div>
        <div className="mt-2 h-2 rounded-full bg-muted overflow-hidden">
          <div className={`h-full rounded-full ${ready ? "bg-emerald-500" : "bg-blue-500"}`} style={{ width: `${score}%` }} />
        </div>
      </div>

      {/* Steps */}
      <div className="space-y-2">
        {steps.map((s, i) => (
          <button
            key={s.id}
            onClick={() => navigate(s.to)}
            className={`w-full text-left flex items-center gap-3 rounded-2xl border bg-card p-4 transition hover:border-primary hover:shadow-premium ${s.done ? "border-border" : "border-border"}`}
          >
            <span className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${s.done ? "bg-emerald-100 text-emerald-600" : "bg-muted text-muted-foreground"}`}>
              {s.done ? <Check className="w-4 h-4" /> : <Circle className="w-4 h-4" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">
                {i + 1}. {s.label}
                {s.optional && <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Optional</span>}
              </p>
              <p className="text-[11px] text-muted-foreground">{s.hint}</p>
            </div>
            <span className="flex-shrink-0 text-[11px] font-semibold text-blue-600 inline-flex items-center gap-1">
              {s.done ? "Review" : "Set up"} <ArrowRight className="w-3.5 h-3.5" />
            </span>
          </button>
        ))}
      </div>

      <p className="text-center text-[11px] text-muted-foreground">Compliance note: AutoLabels supports disclosure, manager-approval, and customer-acknowledgment workflows. It does not provide legal compliance certification.</p>
    </div>
  );
};

export default Setup;
