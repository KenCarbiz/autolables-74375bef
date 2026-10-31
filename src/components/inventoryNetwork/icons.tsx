import type { ButtonHTMLAttributes } from "react";
import {
  Activity, ArrowRightLeft, BadgeCheck, Building2, Cable, CalendarClock, CircleDollarSign, ClipboardCheck, Database, FileSpreadsheet, Gauge, History, Network,
  PauseCircle, PlugZap, RefreshCw, ScanSearch, Share2, ShieldAlert, ShieldCheck, Sparkles, Star, TriangleAlert,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ICON } from "@/components/admin/v2/primitives";
import { cn } from "@/lib/utils";

export const NET_ICON = {
  connection: Cable,
  connectionLive: PlugZap,
  feedFile: FileSpreadsheet,
  group: Network,
  store: Building2,
  mapping: ArrowRightLeft,
  identityReview: ScanSearch,
  verified: BadgeCheck,
  dryRun: ClipboardCheck,
  import: Database,
  schedule: CalendarClock,
  health: Activity,
  marketcheck: Sparkles,
  budget: Gauge,
  spend: CircleDollarSign,
  sharing: Share2,
  homeStore: Star,
  approval: ShieldCheck,
  conflict: ShieldAlert,
  warning: TriangleAlert,
  audit: History,
  refresh: RefreshCw,
  paused: PauseCircle,
} as const;

export type NetIconName = keyof typeof NET_ICON;

export function NetIcon({ name, className, label }: { name: NetIconName; className?: string; label?: string }) {
  const Icon = NET_ICON[name];
  return label ? <Icon className={cn(ICON.inline, "shrink-0", className)} role="img" aria-label={label} /> : <Icon className={cn(ICON.inline, "shrink-0", className)} aria-hidden="true" />;
}

export function IconButton({ name, label, spinning = false, className, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { name: NetIconName; label: string; spinning?: boolean }) {
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={label}
            className={cn("inline-flex h-10 w-10 items-center justify-center rounded-md border border-adm-border bg-adm-surface text-adm-ink hover:bg-adm-workspace disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-adm-primary", className)}
            {...rest}
          >
            <NetIcon name={name} className={cn(ICON.inSquare, spinning && "animate-spin")} />
          </button>
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
