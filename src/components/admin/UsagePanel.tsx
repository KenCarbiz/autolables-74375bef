import { useUsageLimits } from "@/lib/entitlements/useUsageLimits";
import { Gauge } from "lucide-react";
import type { MetricKey } from "@/lib/entitlements/usage";

const METRICS: { key: MetricKey; label: string }[] = [
  { key: "stickers_generated", label: "Stickers generated" },
  { key: "documents_published", label: "Documents published" },
  { key: "template_customizations", label: "Template customizations" },
  { key: "batch_jobs", label: "Batch jobs" },
  { key: "evidence_exports", label: "Evidence exports" },
];

const toneFor = (s: string) => s === "blocked" ? "bg-rose-500" : s === "over_soft" ? "bg-amber-500" : s === "near" ? "bg-amber-400" : "bg-blue-500";

// This-month usage with limits + progress bars. Read-only; metering is
// advisory and non-billing-authoritative.
export default function UsagePanel() {
  const { used, state, limitFor, loading } = useUsageLimits();
  if (loading) return null;

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <h3 className="text-sm font-bold text-foreground inline-flex items-center gap-1.5 mb-3"><Gauge className="w-4 h-4 text-primary" /> Usage this month</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {METRICS.map((m) => {
          const u = used(m.key);
          const lim = limitFor(m.key);
          const unlimited = !lim || lim.hard < 0;
          const pct = unlimited ? 0 : Math.min(100, (u / lim.hard) * 100);
          const s = state(m.key);
          return (
            <div key={m.key} className="rounded-xl border border-border p-3">
              <div className="flex items-baseline justify-between">
                <span className="text-[11px] font-semibold text-foreground">{m.label}</span>
                <span className="text-[11px] tabular-nums text-muted-foreground">{u.toLocaleString()}{unlimited ? "" : ` / ${lim!.hard.toLocaleString()}`}</span>
              </div>
              {!unlimited && (
                <div className="mt-1.5 h-1.5 rounded-full bg-muted overflow-hidden">
                  <div className={`h-full rounded-full ${toneFor(s)}`} style={{ width: `${pct}%` }} />
                </div>
              )}
              {unlimited && <p className="mt-1 text-[10px] text-emerald-600 font-semibold">Unlimited on your plan</p>}
              {s === "blocked" && <p className="mt-1 text-[10px] text-rose-600 font-semibold">Limit reached — contact support to upgrade</p>}
              {s === "over_soft" && <p className="mt-1 text-[10px] text-amber-600 font-semibold">Over the recommended monthly amount</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
