import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Eye, FileText, History, Printer, ShieldCheck } from "lucide-react";
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
}

const TILE_ICON: Record<ReadinessItem["key"], typeof Printer> = { calibration: Printer, templates: FileText, disclosures: ShieldCheck };
const TILE_TONE: Record<ReadinessItem["key"], Record<ReadinessState, Tone>> = {
  calibration: { ok: "success", needs: "warning", unknown: "neutral" },
  templates: { ok: "success", needs: "warning", unknown: "neutral" },
  disclosures: { ok: "success", needs: "danger", unknown: "neutral" },
};

export default function ApprovalRulesView() {
  const fixture = useViewFixture<ApprovalRulesFixture>("approval-rules");
  const now = useAdminNow();
  const { settings } = useDealerSettings();
  const { isAdmin } = useAuth();
  const { member } = useEntitlements();
  const { entries } = useAudit();
  const readiness = useDocumentsReadiness();
  const canEdit = hasDealerCapability(member?.role, "can_manage_settings", isAdmin);

  const gates = useMemo(() => fixture?.gates ?? serviceGateContext(settings), [fixture, settings]);
  const review = useSettingsReview<DocumentRules>({
    scope: "document_rules",
    read: (s) => fixture?.rules ?? rulesFromSettings(s),
    describe: (field, before, after) => ({ field, label: DOCUMENT_RULE_LABELS[field], before: before ? "On" : "Off", after: after ? "On" : "Off" }),
    warnings: documentRuleWarnings,
    toPayload: (draft) => ({ document_rules: draft }),
    canEdit,
    fixtureImpact: fixture?.impact ?? null,
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
    <div className="space-y-3">
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(340px,440px)] gap-4 items-start">
        <AdminCard title="Approval rules by document" description="Define who must approve each document type and what changes require a new approval." flush>
          <AdminTable caption="Approval rules by document">
            <thead>
              <tr>
                <Th>Document</Th>
                <Th>Applies to</Th>
                <Th>Approval</Th>
                <Th>Refresh after changes</Th>
                <Th>Action</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isSelected = r.family === selected;
                return (
                  <tr key={r.family} onClick={() => select(r.family, false)} aria-selected={isSelected} className={cn("cursor-pointer", isSelected ? "bg-adm-selected" : "hover:bg-adm-workspace")}>
                    <Td className={cn(isSelected && "font-semibold")}>{r.document}</Td>
                    <Td>{r.appliesTo}</Td>
                    <Td>{r.approval}</Td>
                    <Td>{r.refreshAfter}</Td>
                    <Td>
                      <AdminButton size="sm" aria-label={`Edit ${r.document} rules`} onClick={(e) => { e.stopPropagation(); select(r.family, true); }}>
                        Edit
                      </AdminButton>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </AdminTable>
          <p className="px-6 py-4 text-[12px] leading-[18px] text-adm-muted">{family.description}</p>
        </AdminCard>

        <AdminCard className="xl:sticky xl:top-4">
          <p className="text-[12px] leading-[18px] text-adm-muted">Selected rule</p>
          <h3 className="text-[20px] leading-[28px] font-semibold text-adm-ink">{family.label} approval</h3>

          <div className="mt-5 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[14px] leading-[20px] font-semibold text-adm-ink">Policy in effect</p>
              <p className="mt-1 text-[13px] leading-[18px] text-adm-muted">
                {lastChange ? `Changed ${describeAge(lastChange.at, now)}${lastChange.by ? ` by ${lastChange.by}` : ""}` : "No change recorded in the activity log"}
              </p>
              <Link to={adminTabHref("change-history")} className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-semibold text-adm-primary hover:underline">
                <History className="w-4 h-4" aria-hidden="true" />
                View change history
              </Link>
            </div>
            <StatusChip tone="info">{versionChip}</StatusChip>
          </div>

          <hr className="my-5 border-adm-border" />

          <div className="flex items-center gap-3">
            <p className="text-[14px] leading-[20px] font-semibold text-adm-ink">Pending changes</p>
            <PendingChip dirty={review.dirty} />
          </div>
          {review.dirty && (
            <ul className="mt-2 space-y-1 text-[13px] leading-[18px] text-adm-ink">
              {changes.map((c) => (
                <li key={c.key}>
                  {c.label}: <span className="text-adm-muted">{c.before ? "On" : "Off"}</span> to <span className="font-semibold">{c.after ? "On" : "Off"}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[13px] leading-[18px] text-adm-muted">
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

          <hr className="my-5 border-adm-border" />

          <p className="text-[14px] leading-[20px] font-semibold text-adm-ink">Readiness</p>
          <div className="mt-3 grid grid-cols-3 divide-x divide-adm-border">
            {readiness.items.map((item) => {
              const Icon = TILE_ICON[item.key];
              return (
                <div key={item.key} className="px-3 first:pl-0 last:pr-0 min-w-0">
                  <div className="flex items-center gap-1.5 text-[12px] leading-[18px] font-semibold text-adm-ink">
                    <Icon className="w-4 h-4 text-adm-muted flex-shrink-0" aria-hidden="true" />
                    <span className="truncate">{item.label}</span>
                  </div>
                  <StatusChip tone={TILE_TONE[item.key][item.state]} className="mt-2">{item.chip}</StatusChip>
                  <p className="mt-2 text-[12px] leading-[16px] text-adm-muted">{item.detailLabel}</p>
                  <p className="text-[12px] leading-[16px] text-adm-ink">{item.detailValue}</p>
                </div>
              );
            })}
          </div>

          <div className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-3">
            <AdminLinkButton to={family.previewHref} variant="secondary">
              <Eye className="w-4 h-4" aria-hidden="true" />
              Preview document
            </AdminLinkButton>
            <AdminButton variant="primary" onClick={() => void review.openReview()} disabled={!review.dirty || !canEdit}>
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
