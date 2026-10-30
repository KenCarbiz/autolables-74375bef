import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { useNavigate } from "react-router-dom";

// Shared chrome for the five Vehicle File tabs. Every panel opens with a
// TabHeader and stacks Cards, so the tabs read as one surface.

export const fmtWhen = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const sameDay = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return sameDay
    ? `Today, ${time}`
    : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

export const fmtDate = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString();
};

// Whole hours/days since a timestamp, phrased the way a desk says it.
export const sinceLabel = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const mins = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (mins < 60) return `${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} hr`;
  return `${Math.round(hours / 24)} days`;
};

export const TabHeader = ({ title, description, action }: {
  title: string;
  description: ReactNode;
  action?: ReactNode;
}) => (
  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
    <div className="min-w-0">
      <h2 className="text-[17px] leading-[24px] font-semibold text-adm-ink">{title}</h2>
      <p className="text-[14px] leading-[20px] text-adm-muted mt-0.5 max-w-2xl">{description}</p>
    </div>
    {action && <div className="shrink-0">{action}</div>}
  </div>
);

export const Card = ({ title, children, action, className = "" }: {
  title?: string;
  children: ReactNode;
  action?: ReactNode;
  className?: string;
}) => (
  <section className={`rounded-[6px] border border-adm-border bg-adm-surface p-4 lg:p-5 space-y-4 ${className}`}>
    {(title || action) && (
      <div className="flex items-center justify-between gap-3">
        {title ? <h3 className="text-[15px] leading-[22px] font-semibold text-adm-ink">{title}</h3> : <span />}
        {action}
      </div>
    )}
    {children}
  </section>
);

export const Section = ({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) => (
  <div className="space-y-2">
    <div className="flex items-center justify-between gap-3">
      <p className="text-[14px] leading-[20px] font-semibold text-adm-ink">{title}</p>
      {action}
    </div>
    <div className="space-y-2">{children}</div>
  </div>
);

export const StatRow = ({ label, value, tone }: {
  label: string;
  value: ReactNode;
  tone?: "emerald" | "amber" | "muted";
}) => (
  <div className="flex items-center justify-between gap-3 text-al-body">
    <span className="text-muted-foreground">{label}</span>
    <span className={`font-semibold text-right tabular-nums ${
      tone === "emerald" ? "text-emerald-600"
        : tone === "amber" ? "text-amber-600"
        : tone === "muted" ? "text-muted-foreground"
        : "text-foreground"
    }`}>{value}</span>
  </div>
);

export const Pair = ({ label, value }: { label: string; value: ReactNode }) => (
  <div className="min-w-0">
    <p className="text-[12px] leading-[18px] text-adm-muted">{label}</p>
    <div className="text-[14px] leading-[20px] font-semibold text-adm-ink mt-0.5 truncate">{value}</div>
  </div>
);

// A source that does not exist yet says so in words, and says what would make
// it appear. It never renders a placeholder row or an invented number.
export const EmptyNote = ({ title, detail, action }: { title: string; detail: string; action?: ReactNode }) => (
  <div className="rounded-[6px] border border-dashed border-adm-border bg-adm-workspace px-5 py-6 text-center space-y-2">
    <p className="text-al-card text-foreground">{title}</p>
    <p className="text-al-body text-muted-foreground max-w-md mx-auto">{detail}</p>
    {action}
  </div>
);

export const btn = "min-h-[36px] max-sm:min-h-[44px] px-3.5 rounded-md border border-adm-border bg-adm-surface hover:bg-adm-workspace text-adm-ink text-[13px] font-semibold inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50";
export const btnPrimary = "min-h-[36px] max-sm:min-h-[44px] px-3.5 rounded-md bg-adm-primary hover:bg-adm-primary-hover text-white text-[13px] font-semibold inline-flex items-center justify-center gap-1.5 transition-opacity disabled:opacity-50";
export const btnLarge = "min-h-[36px] max-sm:min-h-[44px] px-4 rounded-md bg-adm-primary hover:bg-adm-primary-hover text-white text-[14px] font-semibold inline-flex items-center justify-center gap-2 transition-opacity disabled:opacity-50";

// A tab hands work off to the screen that owns it rather than re-implementing
// that screen's workflow here.
export const DeepLink = ({ to, label, detail }: { to: string; label: string; detail: string }) => {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => navigate(to)}
      className="w-full text-left min-h-[48px] rounded-[4px] border border-adm-border bg-adm-surface hover:bg-adm-workspace transition-colors px-4 py-2.5 flex items-center gap-3"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-al-body font-semibold text-foreground truncate">{label}</span>
        <span className="block text-al-meta text-muted-foreground truncate">{detail}</span>
      </span>
      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
    </button>
  );
};
