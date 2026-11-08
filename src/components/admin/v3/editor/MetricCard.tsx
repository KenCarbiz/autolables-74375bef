import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { AdminIcon, type AdminIconName } from "./AdminIcon";

/** `null` means the number could not be read. It renders as "Unknown", never as 0; a real zero stays "0". */
export const MetricCard = ({
  label,
  value,
  unit,
  scope,
  source,
  refreshedAt,
  icon,
  unavailableReason,
  className,
}: {
  label: string;
  value: number | string | null | undefined;
  unit?: string;
  scope?: ReactNode;
  source?: ReactNode;
  refreshedAt?: string | null;
  icon?: AdminIconName;
  unavailableReason?: ReactNode;
  className?: string;
}) => {
  const unknown = value === null || value === undefined;
  return (
    <div data-metric={unknown ? "unknown" : "value"} className={cn("rounded-xl bg-adm-surface border border-adm-divider p-4 sm:p-5 min-w-0", className)}>
      <div className="flex items-center gap-2 text-[14px] leading-[20px] font-medium text-adm-muted">
        {icon && <AdminIcon name={icon} size="control" />}
        <span>{label}</span>
      </div>
      <p className="mt-2 flex items-baseline gap-1.5">
        {unknown ? (
          <span className="text-[24px] leading-[32px] font-semibold text-adm-muted">Unknown</span>
        ) : (
          <>
            <span className="text-[28px] leading-[34px] font-bold text-adm-ink tabular-nums">{value}</span>
            {unit && <span className="text-[14px] text-adm-muted">{unit}</span>}
          </>
        )}
      </p>
      {unknown && unavailableReason && <p className="mt-1 text-[13px] leading-[18px] text-adm-muted">{unavailableReason}</p>}
      {(scope || source || refreshedAt !== undefined) && (
        <dl className="mt-3 pt-3 border-t border-adm-divider grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[13px] leading-[18px]">
          {scope && (<><dt className="text-adm-muted">Scope</dt><dd className="text-adm-ink min-w-0 break-words">{scope}</dd></>)}
          {source && (<><dt className="text-adm-muted">Source</dt><dd className="text-adm-ink min-w-0 break-words">{source}</dd></>)}
          {refreshedAt !== undefined && (<><dt className="text-adm-muted">Refreshed</dt><dd className="text-adm-ink">{refreshedAt ?? "Not yet refreshed"}</dd></>)}
        </dl>
      )}
    </div>
  );
};
