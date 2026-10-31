import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Camera, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { EmptyState, Panel, StatusText, Td, Th, WorkTable, type Tone } from "@/components/product";
import { FINDING_RESULT_LABEL, countFindings, type Finding, type FindingResult } from "@/lib/service/inspectionFindings";

const RESULT_TONE: Record<FindingResult, Tone> = { passed: "success", failed: "danger", attention: "warning" };
type Filter = FindingResult | "all";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "passed", label: "Passed" },
  { key: "failed", label: "Failed" },
  { key: "attention", label: "Needs attention" },
];

export function FindingsTable({ findings, selectedId, onSelect }: { findings: Finding[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const [filter, setFilter] = useState<Filter>("all");
  const counts = countFindings(findings);
  const shown = findings.filter((f) => filter === "all" || f.result === filter);
  return (
    <Panel title="Multi-point inspection" flush inset="sm" titleSize="md" id="findings">
      {findings.length === 0 ? (
        <EmptyState compact title="No inspection findings recorded" detail="Findings appear here once an inspection is started and items are marked." />
      ) : (
        <>
          <div className="flex flex-wrap gap-2 px-4 pb-3" role="group" aria-label="Filter findings by result">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                aria-pressed={filter === f.key}
                onClick={() => setFilter(f.key)}
                className={cn(
                  "min-h-[32px] rounded-[6px] border px-3 text-[13px] font-medium",
                  filter === f.key ? "border-adm-primary text-adm-primary bg-adm-selected font-semibold" : "border-adm-border text-adm-ink hover:bg-adm-workspace",
                )}
              >
                {f.label} ({counts[f.key]})
              </button>
            ))}
          </div>
          <WorkTable caption="Inspection findings">
            <thead>
              <tr>
                <Th>Item</Th>
                <Th>Result</Th>
                <Th>Measurement</Th>
                <Th>Notes</Th>
                <Th className="w-10"><span className="sr-only">Open</span></Th>
              </tr>
            </thead>
            <tbody>
              {shown.map((f) => (
                <tr key={f.id} className={cn("cursor-pointer hover:bg-adm-workspace", selectedId === f.id && "bg-adm-selected")} onClick={() => onSelect(f.id)}>
                  <Td className="font-semibold max-w-[200px] truncate">{f.label}</Td>
                  <Td><StatusText tone={RESULT_TONE[f.result]}>{FINDING_RESULT_LABEL[f.result]}</StatusText></Td>
                  <Td className="max-w-[120px] truncate tabular-nums">{f.measurement || <span className="text-adm-muted">Not recorded</span>}</Td>
                  <Td className="max-w-[260px] truncate text-adm-muted">{f.notes || "No notes"}</Td>
                  <Td>
                    <button type="button" aria-label={`Show detail for ${f.label}`} onClick={() => onSelect(f.id)} className="text-adm-muted">
                      <ChevronRight className="w-5 h-5" aria-hidden="true" />
                    </button>
                  </Td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr><Td colSpan={5} className="text-center text-adm-muted">No findings match this filter.</Td></tr>
              )}
            </tbody>
          </WorkTable>
        </>
      )}
    </Panel>
  );
}

export function FindingDetail({
  finding,
  repairLabel,
  photos,
  vehicleFileHref,
  onAddPhotos,
  inspectedLabel,
  approval,
}: {
  finding: Finding | null;
  repairLabel: string | null;
  photos: string[];
  vehicleFileHref: string;
  onAddPhotos?: (files: FileList | null) => void;
  inspectedLabel?: string | null;
  approval?: ReactNode;
}) {
  if (!finding) {
    return (
      <Panel title="Finding detail" inset="sm" titleSize="md">
        <p className="text-[14px] leading-[20px] text-adm-muted">Select a finding to see its evidence and repair status.</p>
      </Panel>
    );
  }
  return (
    <Panel
      title={
        <span className="flex flex-wrap items-center gap-2">
          {finding.label}
          <StatusText tone={RESULT_TONE[finding.result]}>{FINDING_RESULT_LABEL[finding.result]}</StatusText>
        </span>
      }
      inset="sm"
      titleSize="md"
    >
      <div className="flex flex-col gap-4 text-[14px] leading-[20px]">
        {inspectedLabel && <p className="text-[13px] leading-[18px] text-adm-muted">{inspectedLabel}</p>}
        <p className="text-adm-ink">{finding.notes || "No notes were recorded for this item."}</p>
        {photos.length > 0 ? (
          <div className="grid grid-cols-3 gap-2">
            {photos.slice(0, 6).map((u) => (
              <a key={u} href={u} target="_blank" rel="noreferrer">
                <img src={u} alt="Inspection evidence" className="h-20 w-full rounded-[6px] border border-adm-border object-cover" />
              </a>
            ))}
          </div>
        ) : (
          <p className="text-adm-muted">No evidence photos on file for this item.</p>
        )}
        {onAddPhotos && (
          <div>
            <input type="file" accept="image/*" multiple className="sr-only" id={`finding-photo-${finding.id}`} onChange={(e) => { onAddPhotos(e.target.files); e.target.value = ""; }} />
            <label htmlFor={`finding-photo-${finding.id}`} className="inline-flex min-h-[36px] cursor-pointer items-center gap-2 rounded-[6px] border border-adm-border bg-adm-surface px-3 text-[14px] font-semibold text-adm-ink hover:bg-adm-workspace">
              <Camera className="w-5 h-5" aria-hidden="true" /> Add evidence photo
            </label>
          </div>
        )}
        {approval}
        <div>
          <p className="font-semibold text-adm-ink">Repair status</p>
          <p className="text-adm-muted">{repairLabel ?? "No repair recorded for this item."}</p>
          <Link to={vehicleFileHref} className="text-adm-primary font-semibold hover:underline">Open vehicle file</Link>
        </div>
        <div className="rounded-[6px] border border-adm-border bg-adm-workspace px-3 py-3">
          <p className="font-semibold text-adm-ink">Customer signature (restricted)</p>
          <p className="text-adm-muted">Signature not available for internal service work.</p>
        </div>
      </div>
    </Panel>
  );
}
