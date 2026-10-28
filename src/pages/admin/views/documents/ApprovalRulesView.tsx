import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Eye, File, FileText, Printer, ShieldCheck } from "lucide-react";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { useAuth } from "@/contexts/AuthContext";
import { useAudit } from "@/contexts/AuditContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { hasDealerCapability } from "@/lib/permissions/dealerRoleCapabilities";
import { useViewFixture, useAdminNow } from "@/lib/admin/dataSource";
import { adminTabHref } from "@/lib/admin/sections";
import { describeAge } from "@/lib/admin/health";
import type { DocumentRules } from "@/lib/documentRules";
import {
  DOCUMENT_RULE_LABELS,
  describeRuleChanges,
  documentRuleRows,
  documentRuleWarnings,
  familyDef,
  familyPolicySentence,
  latestPolicyChange,
  roleLabelFor,
  rulesFromSettings,
  serviceGateContext,
  type DocumentFamily,
  type PolicyChangeRecord,
  type ReadinessItem,
  type ReadinessState,
  type ServiceGateContext,
} from "@/lib/admin/documentPolicy";
import { AdminButton, AdminCard, AdminLinkButton, AdminTable, KeyValueList, StatusChip, Td, Th, type Tone } from "@/components/admin/v2/primitives";
import { cn } from "@/lib/utils";
import { PendingChip, SettingsReviewDialog, useSettingsReview, type ImpactFixture } from "./SettingsReviewApply";
import { useDocumentsReadiness } from "./readiness";
import { PolicySwitch } from "./controls";

// Approval rules by document: one table over the tenant's document_rules, a
// selected-rule rail that edits a draft, and the readiness panel. The only
// writer is merge_dealer_settings through Review & Apply.

export interface ApprovalRulesFixture {
  rules: DocumentRules;
  gates: ServiceGateContext;
  selected: DocumentFamily;
  lastChange: PolicyChangeRecord | null;
  impact: ImpactFixture;
  /** A draft edit the fixture depicts as pending review. */
  pendingDraft?: Partial<DocumentRules>;
  /** Fixture viewers may edit; production reads the member's capability. */
  canEdit?: boolean;
}

const TILE_ICON: Record<ReadinessItem["key"], typeof Printer> = { calibration: Printer, templates: FileText, disclosures: ShieldCheck };
const TILE_TONE: Record<ReadinessItem["key"], Record<ReadinessState, Tone>> = {
  calibration: { ok: "success", needs: "warning", unknown: "neutral" },
  templates: { ok: "success", needs: "warning", unknown: "neutral" },
  disclosures: { ok: "success", needs: "danger", unknown: "neutral" },
};

// Measured on the reference: 15px semibold headers on a 50px row, 14px cells
// on a 60px row, the action column inset 22px, and 17px rail section labels.
const TH = "pl-4 pr-1 py-[15px] text-[15px] leading-[20px] text-adm-ink whitespace-nowrap";
const TD = "pl-4 pr-1 py-[10px]";
const SECTION_LABEL = "text-[17px] leading-[24px] font-semibold text-adm-ink";

export default function ApprovalRulesView() {
  const fixture = useViewFixture<ApprovalRulesFixture>("approval-rules");
  const now = useAdminNow();
  const { settings } = useDealerSettings();
  const { isAdmin } = useAuth();
  const { member } = useEntitlements();
  const { entries } = useAudit();
  const readiness = useDocumentsReadiness();
  const canEdit = fixture?.canEdit ?? hasDealerCapability(member?.role, "can_manage_settings", isAdmin);

  const gates = useMemo(() => fixture?.gates ?? serviceGateContext(settings), [fixture, settings]);
  const review = useSettingsReview<DocumentRules>({
    scope: "document_rules",
    read: (s) => fixture?.rules ?? rulesFromSettings(s),
    describe: (field, before, after) => ({ field, label: DOCUMENT_RULE_LABELS[field], before: before ? "On" : "Off", after: after ? "On" : "Off" }),
    warnings: documentRuleWarnings,
    // merge_dealer_settings replaces a nested object, so the payload carries the
    // current rules with only the reviewed keys changed; Publishing writes its
    // own keys of the same object the same way.
    toPayload: (draft, changed) => ({ document_rules: { ...rulesFromSettings(settings), ...Object.fromEntries(changed.map((k) => [k, draft[k]])) } }),
    canEdit,
    fixtureImpact: fixture?.impact ?? null,
    initialDraft: fixture?.pendingDraft ?? null,
  });

  const [selected, setSelected] = useState<DocumentFamily>(fixture?.selected ?? "window_sticker");
  const [editing, setEditing] = useState(false);
  const family = familyDef(selected);
  const rows = useMemo(() => documentRuleRows(review.draft, gates), [review.draft, gates]);
  const changes = useMemo(() => describeRuleChanges(review.state.original, review.draft), [review.state.original, review.draft]);
  const lastChange = fixture ? fixture.lastChange : latestPolicyChange(entries, ["document_rules"]);
  const versionChip = (readiness.versionCheck === "ok" || readiness.versionCheck === "fixture") && readiness.policyVersion !== null ? `Version ${readiness.policyVersion}` : "In effect";

  const select = (f: DocumentFamily, edit: boolean) => {
    setSelected(f);
    setEditing(edit);
  };

  return (
    <div className="pt-[37px] space-y-3">
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_494px] gap-4 xl:gap-[13px]">
        <AdminCard flush className="min-w-0">
          <div className="pl-[29px] pr-[26px] pt-[21px]">
            <h3 className="text-[20px] leading-[28px] font-bold text-adm-ink">Approval rules by document</h3>
            <p className="mt-1.5 text-[14px] leading-[20px] text-adm-muted">Define who must approve each document type and what changes require a new approval.</p>
          </div>
          <AdminTable caption="Approval rules by document" inset className="mt-[29px] ml-[22px] mr-[20px] mb-[19px] xl:[&_table]:table-fixed [&_tbody_tr:last-child>td]:border-b-0 [&_tbody_tr:last-child>td]:pb-[9px]">
            <colgroup>
              <col className="w-[135px]" />
              <col className="w-[137px]" />
              <col className="w-[168px]" />
              <col className="w-[178px]" />
              <col />
            </colgroup>
            <thead>
              <tr>
                <Th className={TH}>Document</Th>
                <Th className={TH}>Applies to</Th>
                <Th className={TH}>Approval</Th>
                <Th className={TH}>Refresh after changes</Th>
                <Th className={cn(TH, "pl-5")}>Action</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isSelected = r.family === selected;
                return (
                  <tr key={r.family} onClick={() => select(r.family, false)} aria-selected={isSelected} className={cn("cursor-pointer", isSelected ? "bg-adm-selected" : "hover:bg-adm-workspace")}>
                    <Td className={cn(TD, "pr-0", isSelected && "font-semibold")}>{r.document}</Td>
                    <Td className={TD}>{r.appliesTo}</Td>
                    <Td className={TD}>{r.approval}</Td>
                    <Td className={TD}>{r.refreshAfter}</Td>
                    <Td className={cn(TD, "pl-[22px]")}>
                      <AdminButton variant="outline" className="min-h-[37px] px-[19px] text-[15px] font-medium border-adm-primary/35" aria-label={`Edit ${r.document} rules`} onClick={(e) => { e.stopPropagation(); select(r.family, true); }}>
                        Edit
                      </AdminButton>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </AdminTable>
        </AdminCard>

        <AdminCard bodyClassName="pl-[21px] pr-[22px] pt-4 pb-[25px]">
          <p className="text-[13px] leading-[18px] text-adm-muted">Selected rule</p>
          <h3 className="mt-1 text-[22px] leading-[28px] font-bold text-adm-ink">{family.label} approval</h3>

          <div className="mt-[25px] flex items-center justify-between gap-3">
            <p className={SECTION_LABEL}>Policy in effect</p>
            <StatusChip tone="info" className="h-[26px] px-[14px] text-[13px] font-medium">{versionChip}</StatusChip>
          </div>
          <p data-parity="policy-changed" className="mt-[7px] text-[14px] leading-[20px] text-adm-muted">
            {lastChange ? `Changed ${describeAge(lastChange.at, now)}${lastChange.by ? ` by ${lastChange.by}` : ""}` : "No change recorded in the activity log"}
          </p>
          <Link to={adminTabHref("change-history")} className="mt-[9px] ml-px flex w-fit items-center gap-2.5 text-[14px] leading-[20px] text-adm-primary hover:underline">
            <File className="w-5 h-5" aria-hidden="true" />
            View change history
          </Link>

          <hr className="mt-[19px] mb-[22px] border-adm-border" />

          <div className="flex items-center gap-6">
            <p className={SECTION_LABEL}>Pending changes</p>
            <PendingChip dirty={review.dirty} className="h-[28px] px-4 text-[13px] font-medium" />
          </div>
          {review.dirty && (
            <ul className="mt-2 space-y-1 text-[14px] leading-[20px] text-adm-ink">
              {changes.map((c) => (
                <li key={c.key}>
                  {c.label}: <span className="text-adm-muted">{c.before ? "On" : "Off"}</span> to <span className="font-semibold">{c.after ? "On" : "Off"}</span>
                </li>
              ))}
            </ul>
          )}
          <p className={cn(review.dirty ? "mt-0.5" : "mt-2", "text-[14px] leading-[20px] text-adm-muted")}>
            Changes apply to documents generated after you apply them. Approved and signed documents keep their current version.
          </p>

          {editing && (
            <>
              <hr className="my-5 border-adm-border" />
              <div className="flex items-center justify-between gap-3">
                <p className="text-[14px] leading-[20px] font-semibold text-adm-ink">Rules for {family.label.toLowerCase()}</p>
                <AdminButton size="sm" variant="ghost" onClick={() => setEditing(false)}>Done</AdminButton>
              </div>
              {family.toggles.length === 0 ? (
                <div className="mt-3 space-y-3">
                  <KeyValueList
                    rows={[
                      { label: "Required", value: gates.k208Required ? "Before customer signing on used and CPO vehicles" : "Not required before signing" },
                      { label: "Signers", value: gates.k208Roles.length ? gates.k208Roles.map(roleLabelFor).join(", ") : "Any signed K-208" },
                      { label: "Certification", value: gates.licenseeCertification ? "Licensee certification required" : "Technician inspection is enough" },
                    ]}
                  />
                  <AdminLinkButton to={family.editHref ?? adminTabHref("service-policy")} size="sm">Edit in Service policy</AdminLinkButton>
                </div>
              ) : (
                <ul className="mt-1 divide-y divide-adm-border">
                  {family.toggles.map((t) => (
                    <li key={t.key} className="flex items-center justify-between gap-3 py-2.5">
                      <span className="text-[13px] leading-[18px] text-adm-ink">{t.label}</span>
                      <PolicySwitch checked={review.draft[t.key]} onChange={(v) => review.edit((d) => ({ ...d, [t.key]: v }))} label={t.label} disabled={!canEdit} />
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          <hr className="mt-5 mb-[21px] border-adm-border" />

          <p className={SECTION_LABEL}>Readiness</p>
          <div className="mt-[9px] grid grid-cols-3 xl:grid-cols-[144px_140px_minmax(0,1fr)] divide-x divide-adm-border">
            {readiness.items.map((item) => {
              const Icon = TILE_ICON[item.key];
              return (
                <div key={item.key} className="pt-[5px] pl-[13px] pr-2 first:pl-0 last:pr-0 min-w-0">
                  <div className="flex items-center gap-2.5 text-[12px] leading-[18px] font-medium text-adm-ink">
                    <Icon className="w-5 h-5 text-adm-ink flex-shrink-0" aria-hidden="true" />
                    <span className="min-w-0 break-words">{item.label}</span>
                  </div>
                  <div className="sm:pl-[30px]">
                    <StatusChip tone={TILE_TONE[item.key][item.state]} className="mt-1.5 h-[26px] sm:px-[11px] font-medium">{item.chip}</StatusChip>
                    <p className="mt-[7px] text-[12px] leading-[18px] text-adm-muted">{item.detailLabel}</p>
                    <p data-parity="readiness-detail" className="text-[13px] leading-[18px] text-adm-ink">{item.detailValue}</p>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 xl:gap-2.5 xl:-mr-[3px]">
            <AdminLinkButton to={family.previewHref} variant="outline" className="min-h-[48px] sm:min-h-[48px] text-[15px]">
              <Eye className="w-6 h-6" aria-hidden="true" />
              Preview document
            </AdminLinkButton>
            <AdminButton variant="primary" data-parity="review-policy" className="min-h-[48px] sm:min-h-[48px] text-[15px]" onClick={() => void review.openReview()} disabled={!review.dirty || !canEdit}>
              Review policy changes
            </AdminButton>
          </div>
        </AdminCard>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] leading-[18px] text-adm-muted">
        <span>{review.dirty ? `${changes.length} change${changes.length === 1 ? "" : "s"} pending review` : "No changes pending"}</span>
        <span>{familyPolicySentence(selected, review.draft, gates)}</span>
      </div>

      <SettingsReviewDialog review={review} title="Review policy changes" />
    </div>
  );
}
