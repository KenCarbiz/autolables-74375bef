import type { ComponentType } from "react";

// A KPI on Description Operations counts VEHICLES, so every card is forced to
// declare the population and window it counted: `scope` is required, and a
// card cannot be added without one.

export type KpiTone = "neutral" | "positive" | "attention" | "critical";

const TONE_CLASS: Record<KpiTone, string> = {
  neutral: "bg-muted text-muted-foreground",
  positive: "bg-emerald-50 text-emerald-700",
  attention: "bg-amber-50 text-amber-700",
  critical: "bg-rose-50 text-rose-700",
};

export interface OperationsKpiCardProps {
  label: string;
  value: number | string;
  /** Population and time window, e.g. "Current snapshot - distinct vehicles". */
  scope: string;
  detail?: string;
  tone?: KpiTone;
  icon?: ComponentType<{ className?: string }>;
  active?: boolean;
  onClick?: () => void;
}

export function OperationsKpiCard({
  label, value, scope, detail, tone = "neutral", icon: Icon, active = false, onClick,
}: OperationsKpiCardProps) {
  const body = (
    <>
      <span className="flex items-center gap-2">
        {Icon && (
          <span className={`grid place-items-center w-8 h-8 rounded-lg shrink-0 ${TONE_CLASS[tone]}`}>
            <Icon className="w-4 h-4" />
          </span>
        )}
        <span className="text-al-meta font-bold uppercase tracking-wide text-muted-foreground">{label}</span>
      </span>
      <span className="block text-al-page text-foreground tabular-nums mt-2">{value}</span>
      <span className="block text-al-meta text-muted-foreground mt-1">{scope}</span>
      {detail ? <span className="block text-al-meta text-muted-foreground mt-0.5">{detail}</span> : null}
    </>
  );

  const base = `block w-full text-left rounded-2xl border bg-card p-4 ${active ? "border-primary" : "border-border"}`;
  if (!onClick) return <div className={base}>{body}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`${base} transition-colors duration-hover ease-standard motion-reduce:transition-none hover:border-primary/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary`}
    >
      {body}
    </button>
  );
}

export default OperationsKpiCard;
