import { useId } from "react";
import { Building2, Check, ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { AccessState } from "@/hooks/useGroupInventory";
import { DISPLAY_STATUS_LABEL, type DisplayStatus, type GroupStore } from "@/lib/inventoryScope/groupInventory";

const STATUS_CLASS: Record<DisplayStatus, string> = {
  published: "bg-emerald-100 text-emerald-800",
  draft: "bg-amber-100 text-amber-800",
  archived: "bg-slate-100 text-slate-700",
  feed_only: "bg-sky-100 text-sky-800",
  missing_from_feed: "bg-orange-100 text-orange-800",
  review: "bg-red-100 text-red-800",
};

export const DealershipStatusBadge = ({ status, className = "" }: { status: DisplayStatus; className?: string }) => (
  <span data-testid="dealership-status" data-status={status} className={`inline-flex h-6 items-center whitespace-nowrap rounded-full px-2.5 text-[12px] font-semibold ${STATUS_CLASS[status]} ${className}`}>
    {DISPLAY_STATUS_LABEL[status]}
  </span>
);

export const DealershipChip = ({ name, className = "" }: { name: string; className?: string }) => (
  <span className={`inline-flex min-w-0 items-center gap-1.5 text-[13px] leading-[18px] text-adm-muted ${className}`}>
    <Building2 className="h-5 w-5 shrink-0" aria-hidden="true" />
    <span className="truncate">{name}</span>
  </span>
);

/** The small note shown instead of the selector when the group view cannot be used. */
export function groupAccessNote(access: AccessState, storeCount: number): string | null {
  if (access.status === "unavailable") return "Viewing several dealerships together is not available yet. Showing the primary dealership.";
  if (access.status === "denied") return "Your account can view the primary dealership only.";
  if (access.status === "error") return "Dealership selection could not be verified. Showing the primary dealership.";
  if (access.status === "allowed" && storeCount < 2) return null;
  return null;
}

export function selectionSummary(stores: readonly GroupStore[], selectedIds: readonly string[]): string {
  const picked = stores.filter((s) => selectedIds.includes(s.storeId));
  if (picked.length === stores.length && stores.length > 1) return `All ${stores.length} dealerships`;
  if (picked.length === 1) return picked[0].name;
  return `${picked.length} of ${stores.length} dealerships`;
}

interface Props {
  access: AccessState;
  stores: readonly GroupStore[];
  selectedIds: readonly string[];
  primaryOnly: boolean;
  /** Vehicles currently loaded per store; falls back to the server's feed count. */
  liveCounts?: ReadonlyMap<string, number>;
  onSelect: (ids: string[] | null) => void;
  onSelectAll: () => void;
  onPrimaryOnly: () => void;
  variant?: "admin" | "plain";
  loading?: boolean;
}

export function DealershipSelector({ access, stores, selectedIds, primaryOnly, liveCounts, onSelect, onSelectAll, onPrimaryOnly, variant = "admin", loading }: Props) {
  const listId = useId();
  if (access.status !== "allowed" || stores.length < 2) return null;
  const primaryId = stores.find((s) => s.primary)?.storeId ?? null;
  const allSelected = selectedIds.length === stores.length;

  const toggle = (id: string, on: boolean) => {
    const next = on ? [...selectedIds, id] : selectedIds.filter((x) => x !== id);
    if (next.length === 0) return;
    const ordered = stores.map((s) => s.storeId).filter((x) => next.includes(x));
    onSelect(ordered.length === 1 && ordered[0] === primaryId ? null : ordered);
  };

  const trigger = variant === "admin"
    ? "inline-flex h-10 max-w-full items-center gap-2 rounded-[6px] border border-adm-border bg-adm-surface px-3 text-[14px] font-semibold text-adm-ink hover:bg-adm-workspace focus-visible:outline focus-visible:outline-2 focus-visible:outline-adm-primary"
    : "inline-flex h-10 max-w-full items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm font-semibold hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary";
  const linkBtn = "h-9 rounded-md px-2 text-[13px] font-semibold text-adm-primary hover:underline disabled:cursor-not-allowed disabled:opacity-40 disabled:no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-adm-primary";

  return (
    <Popover>
      <PopoverTrigger className={trigger} aria-label={`Dealerships: ${selectionSummary(stores, selectedIds)}`} data-testid="dealership-trigger">
        <Building2 className="h-5 w-5 shrink-0 text-adm-muted" aria-hidden="true" />
        <span className="hidden text-adm-muted sm:inline">Dealerships</span>
        <span className="min-w-0 truncate" data-testid="dealership-summary">{selectionSummary(stores, selectedIds)}</span>
        <ChevronDown className="h-5 w-5 shrink-0 text-adm-muted" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[360px] max-w-[calc(100vw-32px)] border-adm-border p-0" aria-label="Choose dealerships">
        <div className="flex flex-wrap items-center justify-between gap-1 border-b border-adm-border px-3 py-2">
          <button type="button" className={linkBtn} onClick={onSelectAll} disabled={allSelected}>Select all dealerships</button>
          <button type="button" className={linkBtn} onClick={onPrimaryOnly} disabled={primaryOnly}>Primary dealership only</button>
        </div>
        <ul id={listId} role="group" aria-label="Dealerships" className="max-h-[min(60vh,420px)] overflow-y-auto py-1">
          {stores.map((s) => {
            const checked = selectedIds.includes(s.storeId);
            const only = checked && selectedIds.length === 1;
            const count = liveCounts?.get(s.storeId) ?? (s.primary ? Math.max(s.listingsTotal, s.feedPresent) : s.feedPresent);
            return (
              <li key={s.storeId}>
                <label className={`flex min-h-[52px] cursor-pointer items-center gap-3 px-3 py-2 hover:bg-adm-workspace ${only ? "cursor-not-allowed" : ""}`} title={only ? "Keep at least one dealership selected" : undefined}>
                  <input
                    type="checkbox" checked={checked} disabled={only} onChange={(e) => toggle(s.storeId, e.target.checked)}
                    className="h-5 w-5 shrink-0 accent-[#2457D6]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[14px] font-semibold text-adm-ink">{s.name}</span>
                      {s.primary && <span className="shrink-0 rounded bg-adm-selected px-1.5 text-[11px] font-semibold uppercase tracking-wide text-adm-primary">Primary</span>}
                    </span>
                    <span className="block text-[12px] leading-[18px] text-adm-muted">
                      {s.new} new, {s.used} used{s.cpo ? `, ${s.cpo} CPO` : ""}{s.absent ? `, ${s.absent} absent from feed` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-[14px] font-semibold tabular-nums text-adm-ink" aria-label={`${count} vehicles`}>{count.toLocaleString()}</span>
                  {checked && <Check className="h-5 w-5 shrink-0 text-adm-primary" aria-hidden="true" />}
                </label>
              </li>
            );
          })}
        </ul>
        <p className="border-t border-adm-border px-3 py-2 text-[12px] leading-[18px] text-adm-muted" role="status">
          {loading ? "Loading selected dealerships" : "Read-only view. Selecting a dealership never moves, publishes or changes its vehicles."}
        </p>
      </PopoverContent>
    </Popover>
  );
}

export function DealershipSummaryLine({ stores, selectedIds, total, className = "" }: { stores: readonly GroupStore[]; selectedIds: readonly string[]; total: number; className?: string }) {
  const names = stores.filter((s) => selectedIds.includes(s.storeId)).map((s) => s.name);
  return (
    <p className={`text-[13px] leading-[18px] text-adm-muted ${className}`} data-testid="dealership-summary-line">
      Showing {total.toLocaleString()} {total === 1 ? "vehicle" : "vehicles"} from {names.length} of {stores.length} dealerships: {names.join(", ")}. Each dealership&apos;s vehicles stay separate; vehicles that exist only in a dealership feed are read-only.
    </p>
  );
}
