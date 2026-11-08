import { StatusChip, type Tone } from "@/components/admin/v2/primitives";
import { AdminIcon, type AdminIconName } from "@/components/admin/v3/editor";
import { cn } from "@/lib/utils";
import { READINESS_LABEL, type HubDocCell, type HubReadiness, type HubServiceCell } from "@/lib/admin/documentsHubModel";

export const READINESS_TONE: Record<HubReadiness, Tone> = { ready: "success", needs_attention: "danger", missing: "warning", in_progress: "info", service_incomplete: "warning" };
export const READINESS_ICON: Record<HubReadiness, AdminIconName> = { ready: "check-circle", needs_attention: "alert", missing: "file-plus", in_progress: "clock", service_incomplete: "wrench" };

export const ReadinessChip = ({ value }: { value: HubReadiness }) => (
  <StatusChip tone={READINESS_TONE[value]} className="gap-1.5 text-[13px]">
    <AdminIcon name={READINESS_ICON[value]} size="inline" />
    {READINESS_LABEL[value]}
  </StatusChip>
);

const DOC_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  pending_approval: "Awaiting approval",
  approved: "Approved",
  printed: "Printed",
  published: "Published",
  rejected: "Rejected",
  superseded: "Superseded",
  archived: "Archived",
};
export const docStatusLabel = (status: string | null | undefined): string => (status ? DOC_STATUS_LABEL[status] ?? status.replace(/_/g, " ") : "Missing");

export const docTone = (cell: HubDocCell): Tone => (!cell.doc ? "warning" : cell.doc.document_status === "rejected" ? "danger" : cell.finished ? "success" : "info");

export const DocCellChip = ({ cell, short }: { cell: HubDocCell; short?: boolean }) => (
  <span className="inline-flex items-center gap-1.5 text-[13px] leading-[18px] whitespace-nowrap">
    <span className="text-adm-muted">{short ? (cell.key === "window" ? "Sticker" : "Buyers Guide") : cell.label}</span>
    <StatusChip tone={docTone(cell)} className="text-[13px]">{docStatusLabel(cell.doc?.document_status)}</StatusChip>
  </span>
);

export const serviceTone = (s: HubServiceCell): Tone => (s.state === "signed" ? "success" : s.state === "failed" ? "danger" : s.state === "prefilled" ? "info" : "warning");

export const ServiceCellChip = ({ service }: { service: HubServiceCell | null }) =>
  service ? (
    <span className="inline-flex items-center gap-1.5 text-[13px] leading-[18px] whitespace-nowrap">
      <span className="text-adm-muted">K-208</span>
      <StatusChip tone={serviceTone(service)} className="text-[13px]">{service.label}</StatusChip>
    </span>
  ) : (
    <span className="text-[13px] leading-[18px] text-adm-muted">K-208 not applicable (New)</span>
  );

export const FieldLabel = ({ children, htmlFor, className }: { children: string; htmlFor: string; className?: string }) => (
  <label htmlFor={htmlFor} className={cn("block text-[13px] leading-[18px] font-medium text-adm-muted mb-1", className)}>{children}</label>
);
