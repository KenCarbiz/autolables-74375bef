import { useMemo, useState } from "react";
import { CheckCircle2, Search } from "lucide-react";
import TitleMcoPanel from "@/components/vehicle/TitleMcoPanel";
import { Link } from "react-router-dom";
import { Panel, StatusText, Td, Th, WorkTable } from "@/components/product";
import { adminTabHref } from "@/lib/admin/sections";
import { EmptyState, formatDate } from "./primitives";
import { TITLE_STATE_LABEL, type TitleRow } from "./complianceData";

export const TitlesSection = ({
  rows,
  loading,
  tenantId,
}: {
  rows: TitleRow[];
  loading: boolean;
  tenantId: string | null;
}) => {
  const [q, setQ] = useState("");
  const [showComplete, setShowComplete] = useState(false);
  const [openVin, setOpenVin] = useState<string | null>(null);

  const outstanding = useMemo(() => rows.filter((r) => r.state !== "on_file"), [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (showComplete ? rows : outstanding)
      .filter((r) => !needle || [r.title, r.vin, r.stockNumber].filter(Boolean).join(" ").toLowerCase().includes(needle))
      .sort((a, b) => (b.ageDays ?? 0) - (a.ageDays ?? 0));
  }, [rows, outstanding, showComplete, q]);

  const selected = rows.find((r) => r.vin === openVin) ?? null;

  const tabCls = (on: boolean) =>
    `-mb-px inline-flex min-h-[40px] items-center gap-1.5 border-b-2 px-0.5 text-[14px] leading-[20px] whitespace-nowrap ${on ? "border-adm-primary font-semibold text-adm-primary" : "border-transparent font-medium text-adm-muted hover:text-adm-ink"}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-adm-border">
        <div role="tablist" aria-label="Title documents" className="flex items-stretch gap-6">
          <button type="button" role="tab" aria-selected={!showComplete} onClick={() => setShowComplete(false)} className={tabCls(!showComplete)}>
            Open documents <span className="tabular-nums">({outstanding.length})</span>
          </button>
          <button type="button" role="tab" aria-selected={showComplete} onClick={() => setShowComplete(true)} className={tabCls(showComplete)}>
            Completed <span className="tabular-nums">({rows.length - outstanding.length})</span>
          </button>
        </div>
        <div className="flex items-center gap-4 pb-1">
          <label className="relative block w-56">
            <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-adm-muted" aria-hidden="true" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search vehicle, stock, VIN"
              aria-label="Search title documents"
              className="h-9 w-full rounded-md border border-adm-border bg-adm-surface pl-10 pr-3 text-[14px] leading-[20px] text-adm-ink outline-none focus:ring-2 focus:ring-adm-primary"
            />
          </label>
          <Link to={adminTabHref("store-settings")} className="text-[14px] font-semibold text-adm-primary hover:underline">Configure clerk</Link>
        </div>
      </div>

      <Panel flush>
        {loading ? (
          <p className="px-4 py-10 text-center text-[14px] leading-[20px] text-adm-muted">Loading vehicles...</p>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            tone={q ? "neutral" : "clear"}
            headline={q ? "No vehicles match that search." : showComplete ? "No completed title documents yet." : "Every in-stock vehicle has required title/MCO documentation."}
            body={q ? "Try a different stock number, VIN, or vehicle name." : "Nothing is outstanding."}
          />
        ) : (
          <WorkTable caption="Titles and MCO" minWidth={980}>
            <thead>
              <tr>
                <Th>Vehicle</Th>
                <Th>VIN</Th>
                <Th>Document</Th>
                <Th>Required sides</Th>
                <Th>Received</Th>
                <Th className="whitespace-nowrap">Age (days)</Th>
                <Th>Clerk</Th>
                <Th>Status</Th>
                <Th align="right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.vehicleId} className="[&>td]:!py-2.5">
                  <Td className="whitespace-nowrap font-semibold" title={r.title}>{r.title.split(" ").slice(0, 3).join(" ")}</Td>
                  <Td className="font-mono text-[12px] text-adm-muted whitespace-nowrap">{r.vin}</Td>
                  <Td className="whitespace-nowrap">{r.requirement.kind === "mco" ? "MCO" : "Title"}</Td>
                  <Td className="whitespace-nowrap text-adm-muted">{r.requirement.back ? "Front and back" : "Front only"}</Td>
                  <Td className="whitespace-nowrap text-adm-muted">{r.receivedAt ? formatDate(r.receivedAt) : "Unknown"}</Td>
                  <Td className="tabular-nums">{r.ageDays == null ? "Unknown" : r.ageDays}</Td>
                  <Td className="max-w-[160px] truncate text-adm-muted">{r.owner || "Unassigned"}</Td>
                  <Td className="whitespace-nowrap">
                    <StatusText tone={r.state === "on_file" ? "success" : r.state === "not_received" ? "danger" : "neutral"}>{TITLE_STATE_LABEL[r.state]}</StatusText>
                  </Td>
                  <Td align="right" className="whitespace-nowrap">
                    <button type="button" onClick={() => setOpenVin(r.vin === openVin ? null : r.vin)} className="text-[14px] font-semibold text-adm-primary hover:underline">
                      {r.vin === openVin ? "Close" : "Open"}
                    </button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </WorkTable>
        )}
      </Panel>
      <p className="text-[13px] leading-[18px] text-adm-muted">Showing {filtered.length.toLocaleString()} of {(showComplete ? rows.length : outstanding.length).toLocaleString()}</p>

      {selected && <TitleMcoPanel vin={selected.vin} tenantId={tenantId} condition={selected.condition} />}
    </div>
  );
};

export default TitlesSection;
