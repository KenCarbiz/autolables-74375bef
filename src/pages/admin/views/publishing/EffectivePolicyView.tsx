import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, ChevronUp, ChevronDown, Eye, FileText, Wrench } from "lucide-react";
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
import { AdminButton, AdminCard, AdminTable, InlineNote, SkeletonBlock, StatusChip, Td, Th } from "@/components/admin/v2/primitives";
import { usePublishingData } from "./usePublishingData";
import PublishingReviewDialog from "./PublishingReviewDialog";

// Publishing > Effective policy (reference screen 10). The matrix is derived
// from the enforcers that run; the detail cards explain states in words; the
// only writes happen inside the Review & Apply dialog after an explicit
// Apply.

const CARD_ICON: Record<ClassDetailCard["key"], typeof Eye> = { visibility: Eye, documents: FileText, readiness: Wrench };

const CARD_TONE: Record<ClassDetailCard["tone"], { icon: string; box: string }> = {
  info: { icon: "bg-adm-selected text-adm-primary", box: "bg-adm-selected text-adm-ink" },
  warning: { icon: "bg-adm-warning-bg text-adm-warning", box: "bg-adm-warning-bg text-[#5F3F00]" },
  danger: { icon: "bg-adm-danger-bg text-adm-danger", box: "bg-adm-danger-bg text-adm-danger" },
  success: { icon: "bg-adm-success-bg text-adm-success", box: "bg-adm-success-bg text-adm-success" },
};

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
        title="This rooftop"
        description={`Policy applies to all vehicles at ${rooftopLabel}.`}
        action={
          draftPending ? (
            <div className="rounded-[10px] bg-adm-warning-bg px-3 py-2 text-right">
              <p className="text-[13px] font-semibold text-adm-warning inline-flex items-center gap-1.5"><FileText className="w-4 h-4" aria-hidden="true" /> Draft pending</p>
              <p className="text-[11px] text-[#5F3F00]">Not yet applied</p>
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
        <div className="rounded-[10px] border border-adm-border overflow-hidden">
          <AdminTable caption="Effective publishing policy by vehicle type">
            <thead>
              <tr>
                <Th>Vehicle type</Th>
                <Th>Listing visibility</Th>
                <Th>Document publication</Th>
                <Th>Retail readiness</Th>
                <Th>Overrides</Th>
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
                    <Td className={cn("font-semibold", active ? "text-adm-primary border-l-[3px] border-l-adm-primary" : "text-adm-ink")}>
                      <button type="button" className="text-left font-semibold focus-visible:outline-2 focus-visible:outline-adm-primary" aria-pressed={active} onClick={() => setSelected(r.vehicleClass)}>
                        {r.label}
                      </button>
                    </Td>
                    <Td><Cell cell={r.listingVisibility} /></Td>
                    <Td><Cell cell={r.documentPublication} /></Td>
                    <Td><Cell cell={r.retailReadiness} /></Td>
                    <Td><Cell cell={r.overrides} /></Td>
                  </tr>
                );
              })}
            </tbody>
          </AdminTable>
        </div>

        <section className="mt-4 rounded-[10px] border border-adm-border" aria-labelledby="publishing-class-detail">
          <header className="flex items-center justify-between gap-4 px-5 py-3 border-b border-adm-border">
            <h3 id="publishing-class-detail" className="text-[18px] leading-[26px] font-semibold text-adm-primary">
              {VEHICLE_CLASS_LABEL[selected]} <span className="ml-2 text-[14px] font-normal text-adm-muted">Policy details and example status</span>
            </h3>
            <button type="button" onClick={() => setExpanded((e) => !e)} className="inline-flex items-center gap-1 text-[13px] font-semibold text-adm-primary hover:underline" aria-expanded={expanded}>
              {expanded ? "Collapse" : "Expand"} {expanded ? <ChevronUp className="w-4 h-4" aria-hidden="true" /> : <ChevronDown className="w-4 h-4" aria-hidden="true" />}
            </button>
          </header>
          {expanded && (
            <div className="p-5 grid grid-cols-1 lg:grid-cols-[repeat(3,minmax(0,1fr))_minmax(240px,1fr)] gap-4">
              {detail.cards.map((c) => {
                const Icon = CARD_ICON[c.key];
                const tone = CARD_TONE[c.tone];
                return (
                  <article key={c.key} className="rounded-[10px] border border-adm-border p-4 flex flex-col gap-3">
                    <div className="flex items-start gap-3">
                      <span className={cn("w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0", tone.icon)} aria-hidden="true"><Icon className="w-5 h-5" /></span>
                      <div className="min-w-0">
                        <p className="text-[14px] font-semibold text-adm-ink">{c.title}</p>
                        <p className="text-[12px] leading-[18px] text-adm-muted">{c.summary}</p>
                      </div>
                    </div>
                    <p className={cn("rounded-md px-3 py-2.5 text-[12px] leading-[18px]", tone.box)}>{c.explanation}</p>
                  </article>
                );
              })}
              <aside className="text-[13px] leading-[19px]">
                <p className="font-semibold text-adm-ink">Effective rule for {VEHICLE_CLASS_LABEL[selected]}</p>
                <p className="mt-1 text-adm-ink">{detail.ruleText}</p>
                <p className="mt-2 text-[12px] text-adm-muted">
                  Active {classCounts.active} · Published {classCounts.published}
                </p>
                <Link to={detail.approvalRulesHref} className="mt-3 inline-flex items-center gap-1 font-semibold text-adm-primary hover:underline">
                  Review approval rules <ArrowRight className="w-4 h-4" aria-hidden="true" />
                </Link>
              </aside>
            </div>
          )}
        </section>

        <div className="mt-4 flex flex-col lg:flex-row lg:items-center gap-3">
          <div className="flex-1 rounded-[10px] border border-[#F1D58A] bg-adm-warning-bg px-4 py-3 text-[13px] font-semibold text-[#5F3F00] inline-flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-adm-warning" aria-hidden="true" />
            Do-not-drive recall follows a separate blocking policy.
          </div>
          <div className="flex items-center gap-2">
            <AdminButton variant="primary" onClick={() => setDialog("edit")}>Review changes</AdminButton>
            <AdminButton variant="secondary" onClick={() => setDialog("review")}>Preview impact</AdminButton>
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
