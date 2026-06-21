import { useNavigate } from "react-router-dom";
import { useSetupStatus } from "@/lib/setup/useSetupStatus";
import { Rocket, ArrowRight } from "lucide-react";

// Compact setup-progress nudge on the dashboard. Hides once the dealership is
// go-live ready so it never nags a fully configured store.
export default function SetupChecklistWidget() {
  const navigate = useNavigate();
  const { score, ready, completed, total, steps, loading } = useSetupStatus();
  if (loading || ready) return null;

  const next = steps.find((s) => !s.done && !s.optional) || steps.find((s) => !s.done);

  return (
    <button
      onClick={() => navigate("/setup")}
      className="w-full text-left rounded-2xl border border-blue-200 bg-blue-50/60 p-4 mt-6 hover:shadow-premium transition flex items-center gap-4"
    >
      <span className="w-10 h-10 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center flex-shrink-0"><Rocket className="w-5 h-5" /></span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-foreground">Finish setting up AutoLabels</p>
        <p className="text-[11px] text-muted-foreground">{completed} of {total} steps done{next ? ` · next: ${next.label}` : ""}</p>
        <div className="mt-1.5 h-1.5 rounded-full bg-blue-100 overflow-hidden max-w-xs">
          <div className="h-full rounded-full bg-blue-500" style={{ width: `${score}%` }} />
        </div>
      </div>
      <span className="flex-shrink-0 text-xs font-semibold text-blue-600 inline-flex items-center gap-1">Continue <ArrowRight className="w-4 h-4" /></span>
    </button>
  );
}
