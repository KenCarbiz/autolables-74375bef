import { useCallback } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { useTenant } from "@/contexts/TenantContext";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { hasAnyDealerCapability } from "@/lib/permissions/dealerRoleCapabilities";
import { formatDateTime, type DateTimeOptions } from "@/lib/admin/integrations/format";
import { cn } from "@/lib/utils";

export interface Viewer {
  tenantId: string | null;
  storeId: string | null;
  storeName: string | null;
  isAdmin: boolean;
  role: string | null;
  canManageSettings: boolean;
  /** Owner, admin or platform admin: the only roles that may clear a source pin. */
  canClearScope: boolean;
  timeZone: string | null;
  blackbook: boolean;
}

export function useViewer(): Viewer {
  const { tenant, currentStore } = useTenant();
  const { isAdmin } = useAuth();
  const { member } = useEntitlements();
  const { settings } = useDealerSettings();
  const role = member?.role ?? null;
  const tenantId = tenant?.id && tenant.id !== "house" ? tenant.id : null;
  return {
    tenantId,
    storeId: currentStore?.id ?? tenantId,
    storeName: currentStore?.name ?? null,
    isAdmin,
    role,
    canManageSettings: hasAnyDealerCapability(role ?? "readonly", ["can_manage_settings"], isAdmin),
    canClearScope: isAdmin || role === "owner" || role === "admin",
    timeZone: settings.dealer_timezone || null,
    blackbook: !!settings.feature_blackbook,
  };
}

export function useFormatAt(timeZone: string | null) {
  return useCallback((iso: string | null | undefined, opts: Omit<DateTimeOptions, "timeZone"> = {}) => formatDateTime(iso, { ...opts, timeZone }), [timeZone]);
}

export const PAGE_SIZES = [25, 50] as const;

export const Pager = ({
  page,
  pages,
  from,
  to,
  total,
  noun,
  size,
  onPage,
  onSize,
  loaded,
}: {
  page: number;
  pages: number;
  from: number;
  to: number;
  total: number | null;
  noun: string;
  size: number;
  onPage: (p: number) => void;
  onSize: (s: number) => void;
  /** Rows on the current page, for the count line when the total is not known. */
  loaded: number;
}) => {
  const summary = total === null ? `Showing ${loaded} ${noun}` : from <= 1 ? `Showing ${to} of ${total} ${noun}` : `Showing ${from}–${to} of ${total} ${noun}`;
  return (
    <div className="flex items-center justify-between gap-3 px-6 py-3 border-t border-adm-border text-[12px] leading-[18px] text-adm-muted flex-wrap">
      <span>{summary}</span>
      <div className="flex items-center gap-4">
        <label className="inline-flex items-center gap-2">
          Rows per page
          <select value={size} onChange={(e) => onSize(Number(e.target.value))} className="h-7 rounded-md border border-adm-border bg-adm-surface px-2 text-[12px] text-adm-ink">
            {PAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <nav aria-label="Pagination" className="inline-flex items-center gap-1">
          <button type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => onPage(page - 1)} className="w-7 h-7 inline-flex items-center justify-center rounded-md border border-adm-border bg-adm-surface disabled:opacity-40">
            <ChevronLeft className="w-4 h-4" aria-hidden="true" />
          </button>
          <span className="min-w-[28px] text-center text-adm-ink font-semibold" aria-current="page">{page}</span>
          <button type="button" aria-label="Next page" disabled={page >= pages} onClick={() => onPage(page + 1)} className="w-7 h-7 inline-flex items-center justify-center rounded-md border border-adm-border bg-adm-surface disabled:opacity-40">
            <ChevronRight className="w-4 h-4" aria-hidden="true" />
          </button>
        </nav>
      </div>
    </div>
  );
};

/** A text value in a stat tile: smaller than a count and allowed to wrap, so a date or a state name is never cut off. */
export const TextValue = ({ children }: { children: string }) => <span className="block text-[20px] leading-[26px] whitespace-normal">{children}</span>;

export const BigNumber = ({ label, value, hint, className }: { label: string; value: string; hint?: string; className?: string }) => (
  <div className={cn("min-w-0", className)}>
    <p className="text-[12px] leading-[18px] text-adm-muted">{label}</p>
    <p className="text-[28px] leading-[34px] font-bold text-adm-ink tabular-nums">{value}</p>
    {hint && <p className="text-[12px] leading-[18px] text-adm-muted">{hint}</p>}
  </div>
);

export const ReadNote = ({ failed, children }: { failed: boolean; children?: string }) =>
  failed ? <p role="status" className="text-[13px] leading-[18px] text-adm-muted">{children ?? "Some of this page could not be read. Those parts show as Unknown or Unavailable rather than as zero or healthy."}</p> : null;
