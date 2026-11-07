import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { AdminIcon } from "./AdminIcon";
import { StatusBadge } from "./StatusBadge";

/**
 * For controls whose backing column or table is not deployed. The caller renders its controls disabled
 * inside `children`; this notice names the missing migration and there is deliberately no Save action.
 */
export const BlockedFeatureNotice = ({ migrationId, feature, children, className }: { migrationId: string; feature?: ReactNode; children?: ReactNode; className?: string }) => (
  <div role="note" data-blocked-feature="" className={cn("rounded-lg border border-dashed border-adm-border bg-adm-workspace px-4 py-3", className)}>
    <div className="flex items-start gap-3">
      <AdminIcon name="database" size="card" className="mt-0.5 text-adm-warning" />
      <div className="min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <StatusBadge state="blocked_schema" />
          {feature && <span className="text-[14px] font-semibold text-adm-ink">{feature}</span>}
        </div>
        <p className="text-[14px] leading-[20px] text-adm-ink">
          Not saved yet: needs database update <code className="rounded bg-adm-surface border border-adm-divider px-1.5 py-0.5 text-[13px] break-all">{migrationId}</code>
        </p>
        <p className="text-[13px] leading-[18px] text-adm-muted">The controls below are read-only until that update is applied. Nothing you see here is stored.</p>
        {children}
      </div>
    </div>
  </div>
);

export const PreviewOnlyNotice = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <div role="note" data-preview-only="" className={cn("rounded-lg border border-adm-divider bg-adm-selected px-4 py-3 flex items-start gap-3", className)}>
    <AdminIcon name="eye" size="card" className="mt-0.5 text-adm-primary" />
    <div className="min-w-0 space-y-1">
      <StatusBadge state="preview_only" />
      <p className="text-[14px] leading-[20px] text-adm-ink">{children ?? "This is a preview of draft values. It does not change what customers or documents show, and it sends nothing."}</p>
    </div>
  </div>
);
