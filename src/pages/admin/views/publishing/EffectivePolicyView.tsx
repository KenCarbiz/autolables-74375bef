import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { AdminButton } from "@/components/admin/v2/primitives";
import { AdminIcon, AdminIconTile, ScopeLabel, SectionCard, StatusBadge } from "@/components/admin/v3/editor";
import { useAuth } from "@/contexts/AuthContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { hasDealerCapability } from "@/lib/permissions/dealerRoleCapabilities";
import { adminTabHref } from "@/lib/admin/sections";
import { modeLabel } from "@/lib/admin/descriptionSettingsModel";
import { resolveReviewMode } from "../../../../../supabase/functions/_shared/description-review-mode";
import {
  VEHICLE_CLASS_LABEL,
  deriveClassDetail,
  derivePublishingMatrix,
  describeCounts,
  publishingDraftFrom,
  publishingDraftUnchanged,
  type PublishingDraft,
  type VehicleClass,
} from "@/lib/admin/publishingPolicy";
import { Banner, LinkRow } from "../brand/feeds/bits";
import { usePublishingData } from "./usePublishingData";
import PublishingReviewDialog from "./PublishingReviewDialog";
import { CONCEPT, ConceptCard, HistoryDrawer, PolicyMatrix, RecallDrawer, RuleDetailsDrawer } from "./PolicyParts";

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

export default function EffectivePolicyView() {
  const data = usePublishingData();
  const { fixture, variant, settingsSlice, rooftopLabel, groupLabel, loading, loadFailed, description, counts, policyVersion, tenantId, history } = data;
  const { isAdmin } = useAuth();
  const { member } = useEntitlements();
  const [selected, setSelected] = useState<VehicleClass>(fixture?.selectedClass ?? "used");
  const [dialog, setDialog] = useState<null | "edit" | "review">(null);
  const [draft, setDraft] = useState<PublishingDraft | null>(null);
  const [details, setDetails] = useState<"visibility" | "documents" | "readiness" | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showRecall, setShowRecall] = useState(false);

  const rows = useMemo(() => derivePublishingMatrix({ settings: settingsSlice, description: description === undefined ? null : description }), [settingsSlice, description]);
  const row = rows.find((r) => r.vehicleClass === selected) ?? rows[1];
  const detail = useMemo(() => deriveClassDetail(row, settingsSlice), [row, settingsSlice]);
  const classCounts = describeCounts(counts ?? null, selected);
  const enforced = useMemo(() => publishingDraftFrom(settingsSlice), [settingsSlice]);
  const draftPending = fixture ? fixture.draftPending : draft !== null && !publishingDraftUnchanged(draft, enforced);
  const canManage = fixture ? variant !== "readonly" : hasDealerCapability(member?.role, "can_manage_settings", isAdmin);
  const mode = description ? resolveReviewMode({ review_mode: description.reviewMode, review_mode_by_class: description.reviewModeByClass }, selected) : null;
  const modeLine = mode ? `Descriptions: ${modeLabel(mode.mode)}. ${mode.source === "class" ? `A custom rule for ${VEHICLE_CLASS_LABEL[selected]} vehicles.` : mode.source === "default" ? "Inherited from the default automation mode." : "No mode is stored, so the built-in default applies."}` : "Descriptions: automation mode could not be read.";
  const last = history.entries[0];
  const inv = `/inventory?condition=${selected}`;

  if (loading) {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading effective policy">
        <div className="h-24 rounded-xl border border-adm-divider bg-adm-surface animate-pulse" />
        <div className="h-56 rounded-xl border border-adm-divider bg-adm-surface animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <section aria-label="Policy scope and status" className="rounded-xl border border-adm-divider bg-adm-surface p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center gap-4 lg:justify-between">
        <div className="min-w-0 space-y-1.5">
          <ScopeLabel scope="all_rooftops" />
          <p className="text-[14px] leading-[20px] text-adm-ink">Stored once for {groupLabel ?? "the dealer group"}. <span data-parity="rooftop-name">{rooftopLabel}</span> follows it, and there is no rooftop-specific override.</p>
          <p className="text-[13px] leading-[18px] text-adm-muted" data-last-change>
            {history.state === "loading" ? "Checking the last change" : history.state === "unavailable" ? "Last change unavailable: the history could not be read." : last ? `Policy version ${String(policyVersion ?? "unknown")}. Last changed ${when(last.at)} by ${last.actor ?? "an actor that was not recorded"}.` : `Policy version ${String(policyVersion ?? "unknown")}. No change has been recorded.`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {draftPending ? <StatusBadge state="stale" label="Draft proposal, not applied" /> : <StatusBadge state="enabled" label="Enforced policy, no pending changes" />}
          <AdminButton variant="secondary" className="min-h-[44px]" onClick={() => setShowHistory(true)}><AdminIcon name="history" />History</AdminButton>
          {draftPending && <AdminButton variant="secondary" className="min-h-[44px]" onClick={() => setDialog("review")}>Review draft</AdminButton>}
          <AdminButton variant="primary" className="min-h-[44px]" onClick={() => setDialog("edit")}><AdminIcon name="edit" />{canManage ? "Edit policy" : "View policy"}</AdminButton>
        </div>
      </section>

      {!canManage && <Banner tone="neutral" icon="lock" title="You can view this policy but not change it">Applying a policy change needs the manage settings permission. The rules below are what is enforced today.</Banner>}
      {loadFailed && <Banner tone="warning" title="Some policy inputs could not be read">Cells that depend on them read as unknown rather than as a default, and counts show as unavailable. A change cannot be applied until counts load.</Banner>}

      <SectionCard id="comparison" icon="grid" title="Policy by vehicle type" description="Listing visibility, document publication and retail readiness are three separate rules. Select a type for the plain-language rule.">
        <PolicyMatrix rows={rows} selected={selected} onSelect={setSelected} />
      </SectionCard>

      <SectionCard id="selected-rule" icon="shield-check" title={`${VEHICLE_CLASS_LABEL[selected]} vehicles`} description="The effective rule, read from the same settings the server enforces."
        actions={<span className="text-[13px] leading-[18px] text-adm-muted" data-parity="class-counts">Active listings <Link className="font-semibold text-adm-primary hover:underline" to={inv}>{classCounts.active}</Link> · Published <Link className="font-semibold text-adm-primary hover:underline" to={inv}>{classCounts.published}</Link></span>}>
        <div className="rounded-xl bg-adm-workspace border border-adm-divider p-4 flex items-start gap-3">
          <AdminIconTile name="info" tone="neutral" />
          <div className="min-w-0">
            <h3 className="text-[15px] leading-[22px] font-semibold text-adm-ink">Effective rule for {VEHICLE_CLASS_LABEL[selected]}</h3>
            <p className="text-[14px] leading-[20px] text-adm-ink mt-1">{detail.ruleText}</p>
            <p className="text-[14px] leading-[20px] text-adm-muted mt-1">{modeLine}</p>
          </div>
        </div>
        <ul className="grid grid-cols-1 lg:grid-cols-3 gap-4" aria-label="Rules for the selected type">
          {detail.cards.map((c) => (
            <ConceptCard key={c.key} card={c} cell={row[CONCEPT[c.key].col]} extra={c.key === "documents" ? modeLine : null} onDetails={() => setDetails(c.key)} />
          ))}
        </ul>
        <p className="text-[13px] leading-[18px] text-adm-muted">Counts are listings in the database right now, not policy outcomes. The rules above describe what is allowed; they do not say how many vehicles have reached each state.</p>
      </SectionCard>

      <div data-parity="recall-note" className="rounded-xl border border-adm-warning/30 bg-adm-warning-bg p-4 flex flex-col sm:flex-row sm:items-center gap-3">
        <AdminIcon name="alert" size="card" className="text-adm-warning flex-shrink-0" />
        <p className="flex-1 text-[14px] leading-[20px] font-semibold text-adm-ink">Do-not-drive recalls follow a separate blocking policy.<span className="block font-normal text-adm-ink/80">A flagged vehicle cannot be published and a live listing goes back to draft, whatever the rules above say.</span></p>
        <AdminButton variant="secondary" className="min-h-[44px]" onClick={() => setShowRecall(true)}>Recall blocking policy<AdminIcon name="chevron-right" /></AdminButton>
      </div>

      <div>
        <h2 className="text-[16px] leading-[24px] font-semibold text-adm-ink mb-2">Where related rules are edited</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <LinkRow to={adminTabHref("approval-rules")} icon="clipboard-check" title="Approval rules" description="Who approves documents and when" />
          <LinkRow to={adminTabHref("service-policy")} icon="wrench" title="Service policy" description="Inspection, install and title gates" />
          <LinkRow to={adminTabHref("destinations")} icon="plug" title="Destinations and automation" description="Description automation and delivery" />
        </div>
      </div>

      {dialog && (
        <PublishingReviewDialog
          open
          onClose={() => setDialog(null)}
          initialStep={dialog}
          initialDraft={draft}
          settingsSlice={settingsSlice}
          counts={counts}
          policyVersion={policyVersion}
          readOnly={!!fixture || !canManage}
          tenantId={tenantId}
          onDraftChange={setDraft}
          onApplied={() => { setDraft(null); data.refetch(); }}
        />
      )}
      <RuleDetailsDrawer concept={details} cls={selected} cell={details ? row[CONCEPT[details].col] : null} card={details ? detail.cards.find((c) => c.key === details) ?? null : null} onClose={() => setDetails(null)} onEdit={() => setDialog("edit")} canEdit={canManage} />
      <HistoryDrawer open={showHistory} onClose={() => setShowHistory(false)} state={history.state} entries={history.entries} />
      <RecallDrawer open={showRecall} onClose={() => setShowRecall(false)} />
    </div>
  );
}
