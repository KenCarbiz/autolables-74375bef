import { cn } from "@/lib/utils";
import { AdminIcon, type AdminIconName } from "./AdminIcon";

export type StatusState =
  | "enabled" | "disabled" | "required" | "overridden" | "visible_with_data" | "waiting_for_data" | "setup_required"
  | "unavailable" | "manual_export" | "internal_publication" | "delivered" | "failed" | "blocked_schema" | "preview_only"
  | "unknown" | "stale";

type Tone = "success" | "neutral" | "info" | "warning" | "danger";

export const STATUS_META: Record<StatusState, { label: string; tone: Tone; icon: AdminIconName }> = {
  enabled: { label: "Enabled", tone: "success", icon: "check-circle" },
  disabled: { label: "Disabled", tone: "neutral", icon: "ban" },
  required: { label: "Required", tone: "info", icon: "lock" },
  overridden: { label: "Overridden", tone: "info", icon: "edit" },
  visible_with_data: { label: "Visible when data exists", tone: "success", icon: "eye" },
  waiting_for_data: { label: "Waiting for data", tone: "neutral", icon: "clock" },
  setup_required: { label: "Setup required", tone: "warning", icon: "wrench" },
  unavailable: { label: "Unavailable", tone: "neutral", icon: "ban" },
  manual_export: { label: "Manual export", tone: "neutral", icon: "download" },
  internal_publication: { label: "Internal publication", tone: "info", icon: "globe" },
  delivered: { label: "Delivered", tone: "success", icon: "check" },
  failed: { label: "Failed", tone: "danger", icon: "alert" },
  blocked_schema: { label: "Needs database update", tone: "warning", icon: "database" },
  preview_only: { label: "Preview only", tone: "info", icon: "eye" },
  unknown: { label: "Unknown", tone: "neutral", icon: "help" },
  stale: { label: "Stale", tone: "warning", icon: "history" },
};

const TONE_CLASS: Record<Tone, string> = {
  success: "bg-adm-success-bg text-adm-success",
  neutral: "bg-adm-workspace text-adm-muted border border-adm-divider",
  info: "bg-adm-selected text-adm-primary",
  warning: "bg-adm-warning-bg text-adm-warning",
  danger: "bg-adm-danger-bg text-adm-danger",
};

export const StatusBadge = ({ state, label, className }: { state: StatusState; label?: string; className?: string }) => {
  const meta = STATUS_META[state];
  return (
    <span data-status={state} className={cn("inline-flex items-center gap-1.5 rounded-md px-2 py-[3px] text-[13px] leading-[18px] font-semibold whitespace-nowrap", TONE_CLASS[meta.tone], className)}>
      <AdminIcon name={meta.icon} size="inline" />
      {label ?? meta.label}
    </span>
  );
};
