import type { ReactNode } from "react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { PassportAgent } from "@/lib/passportRouting";

export const inputCls =
  "mt-1 w-full h-9 px-3 rounded-[6px] border border-adm-border bg-adm-surface text-[14px] leading-[20px] text-adm-ink placeholder:text-adm-muted/70 outline-none focus:border-adm-primary focus-visible:ring-2 focus-visible:ring-adm-primary/25 disabled:opacity-50";
export const selectCls = inputCls;
export const SWITCH_CLS = "data-[state=checked]:bg-adm-primary data-[state=unchecked]:bg-[#C9D3E0] focus-visible:ring-adm-primary/40 focus-visible:ring-offset-0";
export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export const newAgent = (): PassportAgent => ({
  id: `agent_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
  name: "",
  title: "Vehicle Specialist",
  phone: "",
  smsNumber: "",
  email: "",
  status: "available",
  acceptsPassportLeads: true,
  workingHours: [],
});

const SWITCH_SIZE = {
  md: "",
  routing: "w-[42px] [&[data-state=checked]>span]:translate-x-[18px]",
  sm: "h-5 w-9 [&>span]:h-4 [&>span]:w-4 [&[data-state=checked]>span]:translate-x-4",
} as const;

export const ToggleRow = ({
  id,
  checked,
  onChange,
  label,
  hint,
  disabled = false,
  compact = false,
  switchSize = "md",
  switchClassName,
  hintClassName,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
  disabled?: boolean;
  compact?: boolean;
  switchSize?: keyof typeof SWITCH_SIZE;
  switchClassName?: string;
  hintClassName?: string;
}) => (
  <div className={cn("flex justify-between gap-3", compact ? "items-center" : "items-start")}>
    <label htmlFor={id} className="min-w-0 cursor-pointer">
      <span className={cn("block font-semibold text-adm-ink", compact ? "text-[13px] leading-[18px]" : "text-[14px] leading-[20px]")}>{label}</span>
      {hint && <span className={cn("block text-[12px] leading-[18px] text-adm-muted", hintClassName)}>{hint}</span>}
    </label>
    <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} className={cn(SWITCH_CLS, SWITCH_SIZE[switchSize], "flex-shrink-0", switchClassName)} />
  </div>
);

export const Field = ({ label, children, className }: { label: string; children: ReactNode; className?: string }) => (
  <label className={cn("block min-w-0", className)}>
    <span className="text-[12px] leading-[18px] font-semibold text-adm-muted">{label}</span>
    {children}
  </label>
);
