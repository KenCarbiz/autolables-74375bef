import { StatusBadge, type StatusState } from "@/components/admin/v3/editor";
import { oemRegistryRows } from "./templateRegistry";

const STATUS: Record<string, { state: StatusState; label: string }> = {
  approved: { state: "enabled", label: "Approved" },
  reviewed: { state: "visible_with_data", label: "Reviewed" },
  draft: { state: "stale", label: "Draft" },
  fallback: { state: "unavailable", label: "Generated fallback" },
  retired: { state: "unavailable", label: "Retired" },
};

export default function OemReference() {
  const rows = oemRegistryRows();
  return (
    <ul aria-label="Reproduction templates in the registry" className="mt-3 rounded-lg border border-adm-divider divide-y divide-adm-divider">
      {rows.map((r) => {
        const s = STATUS[r.status] ?? { state: "unknown" as StatusState, label: r.status };
        return (
          <li key={r.key} className="grid grid-cols-1 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-x-4 gap-y-1 px-4 py-3 items-center text-[14px] leading-[20px]">
            <span className="min-w-0"><span className="font-semibold text-adm-ink">{r.name}</span><br /><code className="text-[13px] text-adm-muted break-all">{r.key}</code></span>
            <span>{r.version}<br /><span className="text-[13px] text-adm-muted">{r.layoutFamily}</span></span>
            <span className="text-adm-muted">{r.paper}</span>
            <span><StatusBadge state={s.state} label={s.label} /></span>
          </li>
        );
      })}
    </ul>
  );
}
