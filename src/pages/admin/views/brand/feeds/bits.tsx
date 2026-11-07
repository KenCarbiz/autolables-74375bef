import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { AdminIcon, AdminIconTile, ScopeLabel, StatusBadge, type AdminIconName, type StatusState } from "@/components/admin/v3/editor";

export const Banner = ({ tone = "info", icon, title, children, action, className }: { tone?: "info" | "warning" | "danger" | "neutral"; icon?: AdminIconName; title: string; children?: ReactNode; action?: ReactNode; className?: string }) => (
  <div role={tone === "danger" ? "alert" : "note"} className={cn(
    "rounded-xl border px-4 py-3 flex items-start gap-3",
    tone === "danger" && "bg-adm-danger-bg border-adm-danger/30",
    tone === "warning" && "bg-adm-warning-bg border-adm-warning/30",
    tone === "info" && "bg-adm-selected border-adm-primary/20",
    tone === "neutral" && "bg-adm-workspace border-adm-divider",
    className,
  )}>
    <AdminIcon name={icon ?? (tone === "danger" || tone === "warning" ? "alert" : "info")} size="card" className={cn("mt-0.5", tone === "danger" ? "text-adm-danger" : tone === "warning" ? "text-adm-warning" : tone === "info" ? "text-adm-primary" : "text-adm-muted")} />
    <div className="min-w-0 flex-1">
      <p className="text-[14px] leading-[20px] font-semibold text-adm-ink">{title}</p>
      {children && <div className="mt-0.5 text-[14px] leading-[20px] text-adm-ink/80">{children}</div>}
    </div>
    {action && <div className="flex-shrink-0">{action}</div>}
  </div>
);

export const StatTile = ({ icon, label, value, state, stateLabel, hint }: { icon: AdminIconName; label: string; value: ReactNode; state?: StatusState; stateLabel?: string; hint?: ReactNode }) => (
  <div className="rounded-xl border border-adm-divider bg-adm-surface p-4 flex items-start gap-3 min-w-0">
    <AdminIconTile name={icon} />
    <div className="min-w-0 flex-1">
      <p className="text-[13px] leading-[18px] text-adm-muted">{label}</p>
      <p className="text-[16px] leading-[24px] font-semibold text-adm-ink break-words">{value}</p>
      {state && <StatusBadge state={state} label={stateLabel} className="mt-1.5" />}
      {hint && <p className="mt-1 text-[13px] leading-[18px] text-adm-muted">{hint}</p>}
    </div>
  </div>
);

export const LinkRow = ({ to, icon, title, description, external }: { to: string; icon: AdminIconName; title: string; description: string; external?: boolean }) => (
  <Link to={to} {...(external ? { target: "_blank", rel: "noreferrer" } : {})} className="group flex items-center gap-3 rounded-lg border border-adm-divider bg-adm-surface px-3 py-3 min-h-[56px] hover:bg-adm-workspace focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-adm-primary">
    <AdminIconTile name={icon} tone="neutral" />
    <span className="min-w-0 flex-1">
      <span className="block text-[14px] leading-[20px] font-semibold text-adm-ink">{title}</span>
      <span className="block text-[13px] leading-[18px] text-adm-muted">{description}</span>
    </span>
    <AdminIcon name="chevron-right" className="text-adm-muted flex-shrink-0 group-hover:text-adm-ink" />
  </Link>
);

export const TenantScope = ({ summary }: { summary?: ReactNode }) => (
  <div className="flex items-start sm:items-center justify-between gap-x-4 gap-y-1 flex-wrap">
    <ScopeLabel scope="all_rooftops" />
    <p className="text-[13px] leading-[18px] text-adm-muted">Saved once for the whole dealer group. Switching rooftop does not change these values.{summary ? <> {summary}</> : null}</p>
  </div>
);
