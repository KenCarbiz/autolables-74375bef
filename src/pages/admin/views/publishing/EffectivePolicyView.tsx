import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, ChevronUp, ChevronDown, Eye, File, FileText, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  VEHICLE_CLASS_LABEL,
  deriveClassDetail,
  derivePublishingMatrix,
  describeCounts,
  publishingDraftFrom,
  publishingDraftUnchanged,
  type ClassDetailCard,
  type PolicyCell,
  type PublishingDraft,
  type VehicleClass,
} from "@/lib/admin/publishingPolicy";
import { AdminButton, AdminCard, AdminTable, ICON, ICON_BOX, InlineNote, SkeletonBlock, StatusChip, Td, Th } from "@/components/admin/v2/primitives";
import { usePublishingData } from "./usePublishingData";
import PublishingReviewDialog from "./PublishingReviewDialog";

// Publishing > Effective policy (reference screen 10). The matrix is derived
// from the enforcers that run; the detail cards explain states in words; the
// only writes happen inside the Review & Apply dialog after an explicit
// Apply.

const CARD_ICON: Record<ClassDetailCard["key"], typeof Eye> = { visibility: Eye, documents: File, readiness: Wrench };

const CARD_TONE: Record<ClassDetailCard["tone"], { icon: string; box: string }> = {
  info: { icon: "bg-adm-selected text-adm-primary", box: "bg-adm-selected text-adm-ink" },
  warning: { icon: "bg-adm-warning-bg text-adm-warning", box: "bg-adm-warning-bg text-[#5F3F00]" },
  danger: { icon: "bg-adm-danger-bg text-adm-danger", box: "bg-adm-danger-bg text-adm-danger" },
  success: { icon: "bg-adm-success-bg text-adm-success", box: "bg-adm-success-bg text-adm-success" },
};

// The reference's matrix columns: 169, 258, 301, 245 and 258px of 1231, under a
// 45px header with body rows on a 44.67px pitch (lines at 453, 498, 542, 587).
const MATRIX_COLUMNS = ["13.7%", "21%", "24.5%", "19.9%", "20.9%"];
const MATRIX_TABLE_CLS = "[&_tbody_td]:py-[11.83px] [&_th+th]:border-l [&_td+td]:border-l [&_th+th]:border-adm-border [&_td+td]:border-adm-border [&_tbody_tr:last-child>td]:border-b-0";

const Cell = ({ cell }: { cell: PolicyCell }) => (
  <span title={cell.detail} className={cn(cell.state === "unknown" && "text-adm-muted")}>
    {cell.label}
  </span>
);

export default function EffectivePolicyView() {
  const data = usePublishingData();
  const { fixture, settingsSlice, rooftopLabel, loading, loadFailed, description, counts, policyVersion, tenantId } = data;
  const [selected, setSelected] = useState<VehicleClass>(fixture?.selectedClass ?? "used");
  const [expanded, setExpanded] = useState(true);
  const [dialog, setDialog] = useState<null | "edit" | "review">(null);
  const [draft, setDraft] = useState<PublishingDraft | null>(null);

  const rows = useMemo(() => derivePublishingMatrix({ settings: settingsSlice, description: description === undefined ? null : description }), [settingsSlice, description]);
  const row = rows.find((r) => r.vehicleClass === selected) ?? rows[1];
  const detail = useMemo(() => deriveClassDetail(row, settingsSlice), [row, settingsSlice]);
  const classCounts = describeCounts(counts ?? null, selected);
  const enforced = useMemo(() => publishingDraftFrom(settingsSlice), [settingsSlice]);
  const draftPending = fixture ? fixture.draftPending : draft !== null && !publishingDraftUnchanged(draft, enforced);

  if (loading) {
    return (
      <div className="space-y-4" aria-busy="true">
        <SkeletonBlock className="h-24 w-full" />
        <SkeletonBlock className="h-48 w-full" />
        <SkeletonBlock className="h-56 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <AdminCard
        inset="sm"
        title={<span className="text-[20px] leading-[28px]">This rooftop</span>}
        description={<span className="text-[14px] leading-[20px]">Policy applies to all vehicles at <span data-parity="rooftop-name">{rooftopLabel}</span>.</span>}
        headerClassName="px-5 max-sm:flex-col max-sm:gap-3"
        bodyClassName="px-5 pt-[30px] pb-[21px]"
        action={
          draftPending ? (
            <div data-parity="draft-status" className="rounded-[8px] bg-adm-warning-bg px-4 py-[7px] flex items-start gap-3">
              <FileText className={cn(ICON.inline, "text-adm-warning flex-shrink-0 mt-px")} aria-hidden="true" />
              <span className="min-w-0">
                <span className="block text-[13px] leading-[18px] font-semibold text-adm-warning">Draft proposal</span>
                <span className="block text-[11px] leading-[16px] text-[#5F3F00]">Not yet applied</span>
              </span>
            </div>
          ) : (
            <StatusChip tone="success" icon>Enforced policy · no pending changes</StatusChip>
          )
        }
      >
        {loadFailed && (
          <InlineNote tone="warning" title="Some policy inputs could not be read" className="mb-4">
            Cells that depend on them read as unknown rather than as a default.
          </InlineNote>
        )}
        <div className="rounded-[8px] border border-adm-border overflow-hidden">
          <AdminTable caption="Effective publishing policy by vehicle type" minWidth={760} className={MATRIX_TABLE_CLS}>
            <colgroup>{MATRIX_COLUMNS.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
            <thead>
              <tr>
                <Th className="px-5 text-[14px] leading-[20px] text-adm-ink">Vehicle type</Th>
                <Th className="px-5 text-[14px] leading-[20px] text-adm-ink">Listing visibility</Th>
                <Th className="px-5 text-[14px] leading-[20px] text-adm-ink">Document publication</Th>
                <Th className="px-5 text-[14px] leading-[20px] text-adm-ink">Retail readiness</Th>
                <Th className="px-5 text-[14px] leading-[20px] text-adm-ink">Overrides</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const active = r.vehicleClass === selected;
                return (
                  <tr
                    key={r.vehicleClass}
                    aria-selected={active}
                    onClick={() => setSelected(r.vehicleClass)}
                    className={cn("cursor-pointer", active ? "bg-adm-selected" : "hover:bg-adm-workspace")}
                  >
                    <Td className={cn("px-5 font-semibold", active ? "text-adm-primary shadow-[inset_3px_0_0_#2457D6]" : "text-adm-ink")}>
                      <button type="button" className="text-left font-semibold hover:text-adm-primary focus-visible:outline-2 focus-visible:outline-adm-primary" aria-pressed={active} onClick={() => setSelected(r.vehicleClass)}>
                        {r.label}
                      </button>
                    </Td>
                    <Td className="px-5"><Cell cell={r.listingVisibility} /></Td>
                    <Td className="px-5"><Cell cell={r.documentPublication} /></Td>
                    <Td className="px-5"><Cell cell={r.retailReadiness} /></Td>
                    <Td className="px-5"><Cell cell={r.overrides} /></Td>
                  </tr>
                );
              })}
            </tbody>
          </AdminTable>
        </div>

        <section className="mt-4 rounded-[8px] border border-adm-border" aria-labelledby="publishing-class-detail">
          <header className="flex flex-col items-start gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4 px-5 pt-2 pb-[9px] border-b border-adm-border">
            <h3 id="publishing-class-detail" className="flex flex-wrap sm:flex-nowrap items-baseline gap-x-2 min-w-0 text-[18px] leading-[26px] font-semibold text-adm-primary">
              <span>{VEHICLE_CLASS_LABEL[selected]}</span>
              <span className="text-[14px] leading-[20px] font-normal text-adm-muted">Policy details and example status</span>
              <span className="basis-full sm:basis-auto sm:ml-2 text-[12px] leading-[18px] font-normal text-adm-muted whitespace-nowrap" data-parity="class-counts">Active {classCounts.active} · Published {classCounts.published}</span>
            </h3>
            <button type="button" onClick={() => setExpanded((e) => !e)} className="inline-flex items-center gap-1 text-[14px] font-semibold text-adm-primary hover:underline" aria-expanded={expanded}>
              {expanded ? "Collapse" : "Expand"} {expanded ? <ChevronUp className={ICON.status} aria-hidden="true" /> : <ChevronDown className={ICON.status} aria-hidden="true" />}
            </button>
          </header>
          {expanded && (
            <div className="pl-[19px] pr-5 pt-[15px] pb-[14px] grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-[minmax(0,279fr)_minmax(0,293fr)_minmax(0,285fr)_minmax(0,294fr)] gap-[14px] xl:gap-x-[13px]">
              {detail.cards.map((c) => {
                const Icon = CARD_ICON[c.key];
                const tone = CARD_TONE[c.tone];
                return (
                  <article key={c.key} data-landmark="class-card" className="rounded-[10px] border border-adm-border pt-[11px] px-[14px] pb-[14px] flex flex-col">
                    <div className="flex items-start gap-[14px]">
                      <span className={cn(ICON_BOX.avatarLg, "flex items-center justify-center flex-shrink-0", tone.icon)} aria-hidden="true"><Icon className={ICON.inCircle} /></span>
                      <div className="min-w-0 pt-1.5">
                        <p className="text-[14px] leading-[22px] font-semibold tracking-tight text-adm-ink">{c.title}</p>
                        <p className="mt-0.5 min-h-[40px] text-[12px] leading-[20px] text-adm-muted">{c.summary}</p>
                      </div>
                    </div>
                    <p className={cn("mt-[10px] rounded-[8px] px-4 py-[9px] text-[12px] leading-[20px]", tone.box)}>{c.explanation}</p>
                  </article>
                );
              })}
              <aside className="xl:ml-2 xl:border-l xl:border-adm-border xl:pl-[26px] pt-1 text-[13px] leading-[18px]">
                <p className="text-[14px] leading-[20px] font-semibold text-adm-ink">Effective rule for {VEHICLE_CLASS_LABEL[selected]}</p>
                <p className="mt-[7px] text-adm-ink">{detail.ruleText}</p>
                <Link to={detail.approvalRulesHref} className="mt-[11px] inline-flex items-center gap-2 text-[14px] leading-[20px] font-semibold text-adm-primary hover:underline">
                  Review approval rules <ArrowRight className={ICON.button} aria-hidden="true" />
                </Link>
              </aside>
            </div>
          )}
        </section>

        <div className="mt-3 flex flex-col lg:flex-row lg:items-center gap-5 lg:gap-[19px]">
          <div data-parity="recall-note" className="flex-1 rounded-[10px] border border-[#FDE1BB] bg-adm-warning-bg pl-[13px] pr-4 pt-[9px] pb-[10px] text-[13px] leading-[18px] font-semibold text-[#5F3F00] inline-flex items-center gap-2">
            <AlertTriangle className={cn(ICON.panel, "text-adm-warning fill-current stroke-white flex-shrink-0")} aria-hidden="true" />
            Do-not-drive recall follows a separate blocking policy.
          </div>
          <div className="flex flex-wrap items-center gap-[13px]">
            <AdminButton variant="primary" data-parity="review-changes" className="min-h-[48px] sm:min-h-[48px] min-w-[151px] max-sm:flex-1 px-4" onClick={() => setDialog("edit")}>Review changes</AdminButton>
            <AdminButton variant="outline" data-parity="preview-impact" className="min-h-[48px] sm:min-h-[48px] min-w-[146px] max-sm:flex-1 px-4" onClick={() => setDialog("review")}>Preview impact</AdminButton>
          </div>
        </div>
      </AdminCard>

      <p className="text-[12px] text-adm-muted">
        Listing visibility is enforced by the recall triggers on vehicle listings. Document and description publication follow the approval rules and review modes. Retail readiness follows the inspection and install gates owned by Documents & Service.
      </p>

      {dialog && (
        <PublishingReviewDialog
          open
          onClose={() => setDialog(null)}
          initialStep={dialog}
          initialDraft={draft}
          settingsSlice={settingsSlice}
          counts={counts}
          policyVersion={policyVersion}
          readOnly={!!fixture}
          tenantId={tenantId}
          onDraftChange={setDraft}
          onApplied={() => { setDraft(null); data.refetch(); }}
        />
      )}
    </div>
  );
}
