import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AdminButton, AdminLinkButton, InlineNote, StatusChip, type Tone } from "@/components/admin/v2/primitives";
import { AdminIcon, AdminIconTile, DetailDrawer, ScopeLabel, StatusBadge, useIsNarrow } from "@/components/admin/v3/editor";
import { useDealerSettings } from "@/contexts/DealerSettingsContext";
import { useAuth } from "@/contexts/AuthContext";
import { useAudit } from "@/contexts/AuditContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { hasDealerCapability } from "@/lib/permissions/dealerRoleCapabilities";
import { useViewFixture, useAdminNow } from "@/lib/admin/dataSource";
import { adminTabHref } from "@/lib/admin/sections";
import { describeAge } from "@/lib/admin/health";
import { DEFAULT_DOCUMENT_RULES, type DocumentRules } from "@/lib/documentRules";
import {
  DOCUMENT_FAMILIES,
  DOCUMENT_RULE_LABELS,
  describeRuleChanges,
  documentRuleRows,
  documentRuleWarnings,
  familyDef,
  latestPolicyChange,
  rulesFromSettings,
  serviceGateContext,
  type DocumentFamily,
  type PolicyChangeRecord,
  type ReadinessItem,
  type ReadinessState,
  type ServiceGateContext,
} from "@/lib/admin/documentPolicy";
import { PREVIEW_TARGET, RULE_FAMILY_ICON, familySentence, policyChangeLines, ruleComboWarnings, ruleEffect, whoApprovesWhen } from "@/lib/admin/approvalRulesModel";
import { useWaveCVariant } from "@/pages/admin/views/publishing/waveCVariant";
import { cn } from "@/lib/utils";
import { useFixtureDirty } from "./fixtureDirty";
import { PendingChip, SettingsReviewDialog, readStoredSettings, useSettingsReview, type ImpactFixture } from "./SettingsReviewApply";
import { useDocumentsReadiness } from "./readiness";
import { AppliesTo, ApprovalToggles, ConsequenceList, EditorSection, InspectionRuleSummary, SignedVersionsNotice, SignerRoleDetails } from "./ApprovalRuleParts";

// Approval rules by document: a compact four-row table over the tenant's
// document_rules, a selected-rule panel whose editor is split into Applies to,
// Approval, When something changes and Review impact, and the setup rows.
// This is the canonical writer of document_rules (merge_dealer_settings
// through Review & Apply). Publishing > Effective policy writes five of the
// same keys through its own review and is linked, not duplicated.

export interface ApprovalRulesFixture {
  rules: DocumentRules;
  gates: ServiceGateContext;
  selected: DocumentFamily;
  lastChange: PolicyChangeRecord | null;
  impact: ImpactFixture;
  /** A draft edit the fixture depicts as pending review. */
  pendingDraft?: Partial<DocumentRules>;
  dirtyDraft?: Partial<DocumentRules>;
  /** A draft the ?state=invalid variant depicts. */
  invalidDraft?: Partial<DocumentRules>;
  /** Fixture viewers may edit; production reads the member's capability. */
  canEdit?: boolean;
  /** Fixture audit rows for the change history drawer; production reads the activity log. */
  history?: Array<{ id: string; at: string; by: string | null; keys: string[] }>;
  rooftopLabel?: string;
}

const TILE_ICON: Record<ReadinessItem["key"], "printer" | "file" | "shield-check"> = { calibration: "printer", templates: "file", disclosures: "shield-check" };
const TILE_TONE: Record<ReadinessItem["key"], Record<ReadinessState, Tone>> = {
  calibration: { ok: "success", needs: "warning", unknown: "neutral" },
  templates: { ok: "success", needs: "warning", unknown: "neutral" },
  disclosures: { ok: "success", needs: "danger", unknown: "neutral" },
};
const TILE_LINK: Record<ReadinessItem["key"], string> = { calibration: adminTabHref("print-calibration"), templates: "/admin?tab=templates&view=library", disclosures: adminTabHref("products") };
const TILE_IMPACT: Record<ReadinessItem["key"], string> = { calibration: "Printing impact only. Digital approval and publishing are not blocked.", templates: "Unset label slots use the platform default template.", disclosures: "A product without disclosure text cannot show it on documents." };

type Drawer = null | "impact" | "history" | "signers";

const dateLabel = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export default function ApprovalRulesView() {
  const fixture = useViewFixture<ApprovalRulesFixture>("approval-rules");
  const variant = useWaveCVariant(!!fixture);
  const seedDirty = useFixtureDirty(!!fixture);
  const now = useAdminNow();
  const { settings } = useDealerSettings();
  const { isAdmin } = useAuth();
  const { member } = useEntitlements();
  const { entries } = useAudit();
  const readiness = useDocumentsReadiness();
  const [params, setParams] = useSearchParams();
  const canEdit = fixture ? (fixture.canEdit ?? true) && variant !== "readonly" : hasDealerCapability(member?.role, "can_manage_settings", isAdmin);

  const gates = useMemo(() => fixture?.gates ?? serviceGateContext(settings), [fixture, settings]);
  const review = useSettingsReview<DocumentRules>({
    scope: "document_rules",
    read: (s) => (variant === "empty" ? DEFAULT_DOCUMENT_RULES : fixture?.rules ?? rulesFromSettings(s)),
    describe: (field, before, after) => ({ field, label: DOCUMENT_RULE_LABELS[field], before: before ? "On" : "Off", after: after ? "On" : "Off" }),
    warnings: (b, a) => [...documentRuleWarnings(b, a), ...ruleComboWarnings(a)],
    // merge_dealer_settings replaces a nested object, so the payload carries the
    // rules re-read from the server just before the write with only the reviewed
    // keys changed. Publishing writes its own keys of the same object, so a stale
    // copy would silently revert them.
    toPayload: (draft, changed, fresh) => ({ document_rules: { ...rulesFromSettings(fresh ?? settings), ...Object.fromEntries(changed.map((k) => [k, draft[k]])) } }),
    readFresh: readStoredSettings,
    canEdit,
    fixtureImpact: fixture?.impact ?? null,
    initialDraft: variant === "invalid" ? fixture?.invalidDraft ?? null : variant === "default" ? fixture?.pendingDraft ?? (seedDirty ? fixture?.dirtyDraft ?? null : null) : null,
  });

  const rawRule = params.get("rule");
  const selected: DocumentFamily = (DOCUMENT_FAMILIES.some((f) => f.id === rawRule) ? rawRule : fixture?.selected ?? "window_sticker") as DocumentFamily;
  const editing = params.get("edit") === "1";
  const [drawer, setDrawer] = useState<Drawer>(null);
  const narrow = useIsNarrow();
  const select = (f: DocumentFamily, edit: boolean) => setParams((p) => { const n = new URLSearchParams(p); n.set("rule", f); if (edit) n.set("edit", "1"); else n.delete("edit"); return n; }, { replace: true });

  const family = familyDef(selected);
  const rows = useMemo(() => documentRuleRows(review.draft, gates), [review.draft, gates]);
  const changes = useMemo(() => describeRuleChanges(review.state.original, review.draft), [review.state.original, review.draft]);
  const warnings = useMemo(() => [...documentRuleWarnings(review.state.original, review.draft), ...ruleComboWarnings(review.draft)], [review.state.original, review.draft]);
  const lastChange = fixture ? fixture.lastChange : latestPolicyChange(entries, ["document_rules"]);
  const versionCheck = variant === "blocked" ? "pending_migration" : readiness.versionCheck;
  const versionKnown = (versionCheck === "ok" || versionCheck === "fixture") && readiness.policyVersion !== null;
  const versionChip = versionKnown ? `Version ${readiness.policyVersion}` : "In effect";
  const ruleKeys = useMemo(() => Object.keys(DOCUMENT_RULE_LABELS), []);
  const historyLines = useMemo(() => (fixture ? fixture.history ?? [] : policyChangeLines(entries, ruleKeys)), [fixture, entries, ruleKeys]);
  const keys = family.toggles.map((t) => t.key);
  const rule = rows.find((r) => r.family === selected);
  const who = whoApprovesWhen(selected, review.draft, gates);
  const toggle = (key: keyof DocumentRules, next: boolean) => review.edit((d) => ({ ...d, [key]: next }));
  const readFailed = variant === "error";

  const panelBody = (

          <div className={narrow ? "space-y-5" : "px-4 sm:px-6 py-5 space-y-5"}>
            {narrow && <div><StatusChip tone="info" className="h-[26px] text-[13px]">{versionChip}</StatusChip></div>}
            <div>
              <p data-parity="policy-changed" className="text-[14px] leading-[20px] text-adm-muted">
                {lastChange ? `Changed ${describeAge(lastChange.at, now)}${lastChange.by ? ` by ${lastChange.by}` : ""}` : "No change recorded in the activity log"}
              </p>
              <button type="button" onClick={() => setDrawer("history")} className="mt-1.5 inline-flex items-center gap-2 min-h-[44px] sm:min-h-0 text-[14px] font-semibold text-adm-primary hover:underline">
                <AdminIcon name="history" /> Version history
              </button>
            </div>

            {!editing && rule && (
              <div className="space-y-3">
                <dl className="divide-y divide-adm-divider rounded-lg border border-adm-divider px-3.5">
                  <div className="py-2.5"><dt className="text-[13px] leading-[18px] text-adm-muted">Applies to</dt><dd className="text-[14px] leading-[20px] font-medium">{rule.appliesTo}</dd></div>
                  <div className="py-2.5"><dt className="text-[13px] leading-[18px] text-adm-muted">Who approves &amp; when</dt><dd className="text-[14px] leading-[20px] font-medium">{who.who}</dd><dd className="text-[13px] leading-[18px] text-adm-muted">{who.when}</dd></div>
                  <div className="py-2.5"><dt className="text-[13px] leading-[18px] text-adm-muted">Refreshed after</dt><dd className="text-[14px] leading-[20px] font-medium">{rule.refreshAfter}</dd></div>
                </dl>
                <p className="text-[13px] leading-[18px] text-adm-muted">{familySentence(selected, review.draft, gates)}</p>
                <SignedVersionsNotice />
              </div>
            )}

            {editing && (
              <div className="space-y-6">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[15px] leading-[22px] font-semibold text-adm-ink">Rules for {family.label.toLowerCase()}</p>
                  <AdminButton size="sm" variant="ghost" className="min-h-[44px] sm:min-h-[32px]" onClick={() => select(selected, false)}>Done</AdminButton>
                </div>

                <EditorSection n={1} title="Applies to" id="rule-applies">
                  <AppliesTo family={selected} gates={gates} />
                </EditorSection>

                <EditorSection n={2} title="Approval" id="rule-approval">
                  {family.toggles.length === 0 ? (
                    <div className="space-y-3">
                      <InspectionRuleSummary gates={gates} canEdit={canEdit} />
                      <AdminButton size="sm" onClick={() => setDrawer("signers")}>Signer role details</AdminButton>
                    </div>
                  ) : (
                    <ApprovalToggles keys={keys} rules={review.draft} onToggle={toggle} disabled={!canEdit} sections={["approval", "packet"]} />
                  )}
                </EditorSection>

                <EditorSection n={3} title="When something changes" id="rule-changes">
                  {family.toggles.length === 0 ? (
                    <p className="text-[14px] leading-[20px] text-adm-muted">An inspection record changes only with its outcome. A new inspection is a new signed record; earlier signed records are never rewritten.</p>
                  ) : (
                    <>
                      <ConsequenceList rules={review.draft} keys={keys} />
                      <ApprovalToggles keys={keys} rules={review.draft} onToggle={toggle} disabled={!canEdit} sections={["reapproval", "withdraw"]} />
                    </>
                  )}
                  <SignedVersionsNotice />
                </EditorSection>

                <EditorSection n={4} title="Review impact" id="rule-impact">
                  {family.toggles.length === 0 ? (
                    <p className="text-[14px] leading-[20px] text-adm-muted">Nothing is edited here, so there is no impact to review.</p>
                  ) : changes.length === 0 ? (
                    <p className="text-[14px] leading-[20px] text-adm-muted">No changes yet. When you change a rule, its effect is listed here before anything is applied.</p>
                  ) : (
                    <ul className="space-y-2">
                      {changes.map((c) => (
                        <li key={c.key} className="rounded-lg border border-adm-divider px-3.5 py-2.5 text-[14px] leading-[20px]">
                          <p className="font-semibold">{c.label}: <span className="text-adm-muted font-normal">{c.before ? "On" : "Off"}</span> to {c.after ? "On" : "Off"}</p>
                          <p className="text-[13px] leading-[18px] text-adm-muted">{ruleEffect(c.key, c.after)}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                  {warnings.map((w) => <InlineNote key={w} tone="warning">{w}</InlineNote>)}
                  <p className="text-[13px] leading-[18px] text-adm-muted">The number of active vehicles that follow the rule is counted when you open the review. Changes apply to documents generated after you apply them.</p>
                </EditorSection>
              </div>
            )}

            <div className="flex items-center gap-4 flex-wrap">
              <p className="text-[16px] leading-[24px] font-semibold text-adm-ink">Pending changes</p>
              <PendingChip dirty={review.dirty} className="h-[28px] px-4 text-[13px] font-medium" />
              {review.dirty && <button type="button" onClick={() => setDrawer("impact")} className="text-[14px] font-semibold text-adm-primary hover:underline min-h-[44px] sm:min-h-0">See impact</button>}
            </div>
            {review.dirty && (
              <ul className="space-y-1 text-[14px] leading-[20px] text-adm-ink">
                {changes.map((c) => (
                  <li key={c.key}>{c.label}: <span className="text-adm-muted">{c.before ? "On" : "Off"}</span> to <span className="font-semibold">{c.after ? "On" : "Off"}</span></li>
                ))}
              </ul>
            )}
            {!editing && <p className="text-[13px] leading-[18px] text-adm-muted">Changes apply to documents generated after you apply them. Approved and signed documents keep their current version.</p>}

            <section aria-labelledby="related-setup-h">
              <h4 id="related-setup-h" className="text-[16px] leading-[24px] font-semibold text-adm-ink">Related setup</h4>
              <ul className="mt-2 divide-y divide-adm-divider rounded-lg border border-adm-divider">
                {readiness.items.map((item) => (
                  <li key={item.key}>
                    <Link to={TILE_LINK[item.key]} className="flex items-center gap-3 px-3.5 py-3 min-h-[64px] hover:bg-adm-workspace focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-adm-primary">
                      <AdminIconTile name={TILE_ICON[item.key]} tone="neutral" />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 flex-wrap text-[14px] leading-[20px] font-semibold">{item.label}<StatusChip tone={TILE_TONE[item.key][readFailed ? "unknown" : item.state]} className="text-[13px]">{readFailed ? "Unknown" : item.chip}</StatusChip></span>
                        <span data-parity="readiness-detail" className="block text-[13px] leading-[18px] text-adm-muted">{readFailed ? "Could not be read" : item.detailValue}. {TILE_IMPACT[item.key]}</span>
                      </span>
                      <AdminIcon name="chevron-right" className="text-adm-muted flex-shrink-0" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {fixture ? (
                <AdminButton variant="outline" disabled aria-describedby="preview-target" className="min-h-[48px] text-[15px]">
                  <AdminIcon name="eye" size="card" />
                  Preview document
                </AdminButton>
              ) : (
                <AdminLinkButton to={PREVIEW_TARGET[selected].to} variant="outline" aria-describedby="preview-target" className="min-h-[48px] text-[15px]">
                  <AdminIcon name="eye" size="card" />
                  Preview document
                </AdminLinkButton>
              )}
              <AdminButton variant="primary" data-parity="review-policy" className="min-h-[48px] text-[15px]" onClick={() => void review.openReview()} disabled={!review.dirty || !canEdit}>
                Review policy changes
              </AdminButton>
            </div>
            <p id="preview-target" className="text-[13px] leading-[18px] text-adm-muted">{PREVIEW_TARGET[selected].opens}{fixture ? ". Not available in the design fixture." : "."}</p>
            {review.dirty && <div><AdminButton size="sm" variant="ghost" className="min-h-[44px] sm:min-h-[32px]" onClick={review.discard}>Discard changes</AdminButton></div>}
          </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <ScopeLabel scope="all_rooftops" />
        <p className="text-[13px] leading-[18px] text-adm-muted">Saved once for the whole dealer group.{canEdit ? "" : " Your role can view these rules but not change them."}</p>
      </div>
      {readFailed && <InlineNote tone="danger" title="Setup checks could not be read">Printing, templates and disclosures show Unknown, not Ready. The rules themselves are unaffected.</InlineNote>}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.25fr)_minmax(400px,460px)] gap-4 items-start">
        <section aria-labelledby="rules-table-h" className="rounded-xl bg-adm-surface border border-adm-divider min-w-0">
          <header className="px-4 sm:px-6 pt-5 pb-4 border-b border-adm-divider">
            <h2 id="rules-table-h" className="text-[18px] leading-[26px] font-semibold text-adm-ink">Approval rules by document</h2>
            <p className="mt-0.5 text-[14px] leading-[20px] text-adm-muted">Who must approve each document type, and when. Pick a row to read its rule or press Edit.</p>
          </header>
          {narrow ? (
            <ul aria-label="Approval rules by document" className="divide-y divide-adm-divider">
              {rows.map((r) => {
                const isSelected = r.family === selected;
                const ww = whoApprovesWhen(r.family, review.draft, gates);
                return (
                  <li key={r.family} aria-current={isSelected ? "true" : undefined} className={cn("px-4 py-3.5 space-y-2", isSelected && "bg-adm-selected")}>
                    <button type="button" onClick={() => select(r.family, false)} className="flex w-full items-center gap-3 text-left min-h-[48px] rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-adm-primary">
                      <AdminIconTile name={RULE_FAMILY_ICON[r.family]} tone={isSelected ? "primary" : "neutral"} />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[15px] leading-[22px] font-semibold">{r.document}</span>
                        <span className="block text-[13px] leading-[18px] text-adm-muted">{r.appliesTo}</span>
                      </span>
                    </button>
                    <p className="text-[14px] leading-[20px] font-medium">{ww.who}</p>
                    <p className="text-[13px] leading-[18px] text-adm-muted">{ww.when}</p>
                    <AdminButton variant="outline" size="sm" className="min-h-[44px]" onClick={() => select(r.family, true)}><AdminIcon name="edit" /><span className="whitespace-nowrap">Edit rule</span><span className="sr-only">, {r.document}</span></AdminButton>
                  </li>
                );
              })}
            </ul>
          ) : (
            <table className="w-full border-collapse text-left text-[14px] leading-[20px] text-adm-ink">
              <caption className="sr-only">Approval rules by document</caption>
              <thead>
                <tr>
                  <th scope="col" className="bg-adm-workspace px-4 pl-6 py-2.5 w-[26%] text-[13px] font-semibold text-adm-muted border-b border-adm-divider">Document</th>
                  <th scope="col" className="bg-adm-workspace px-4 py-2.5 w-[14%] text-[13px] font-semibold text-adm-muted border-b border-adm-divider">Applies to</th>
                  <th scope="col" className="bg-adm-workspace px-4 py-2.5 text-[13px] font-semibold text-adm-muted border-b border-adm-divider">Who approves &amp; when</th>
                  <th scope="col" className="bg-adm-workspace px-4 pr-6 py-2.5 w-[148px] text-[13px] font-semibold text-adm-muted border-b border-adm-divider"><span className="sr-only">Action</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const isSelected = r.family === selected;
                  const ww = whoApprovesWhen(r.family, review.draft, gates);
                  return (
                    <tr key={r.family} aria-selected={isSelected} onClick={(e) => { if (!(e.target as Element).closest("button")) select(r.family, false); }} className={cn("border-b border-adm-divider last:border-b-0 cursor-pointer", isSelected ? "bg-adm-selected" : "hover:bg-adm-workspace")}>
                      <td className="pl-6 pr-4 py-3.5 align-middle">
                        <button type="button" onClick={() => select(r.family, false)} className="flex items-center gap-3 text-left rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-adm-primary">
                          <AdminIconTile name={RULE_FAMILY_ICON[r.family]} tone={isSelected ? "primary" : "neutral"} />
                          <span className={cn("text-[15px] leading-[22px] whitespace-nowrap", isSelected ? "font-bold" : "font-semibold")}>{r.document}</span>
                        </button>
                      </td>
                      <td className="px-4 py-3.5 align-middle text-adm-muted">{r.appliesTo}</td>
                      <td className="px-4 py-3.5 align-middle"><span className="block font-medium">{ww.who}</span><span className="block text-[13px] leading-[18px] text-adm-muted">{ww.when}</span></td>
                      <td className="px-4 pr-6 py-3.5 align-middle">
                        <AdminButton variant="outline" size="sm" className="min-h-[40px] min-w-[116px] whitespace-nowrap" onClick={() => select(r.family, true)}><AdminIcon name="edit" /><span className="whitespace-nowrap">Edit rule</span><span className="sr-only">, {r.document}</span></AdminButton>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <div className="px-4 sm:px-6 py-3 border-t border-adm-divider text-[13px] leading-[18px] text-adm-muted">
            Publication keys are also shown, read only, on Publishing approvals; edit them here.
            <Link className="flex items-center min-h-[44px] font-semibold text-adm-primary hover:underline" to={adminTabHref("approvals")}>Open Publishing approvals</Link>
          </div>
        </section>

        {!narrow && (
          <aside aria-label="Selected rule" className="rounded-xl bg-adm-surface border border-adm-divider min-w-0 xl:sticky xl:top-4">
          <header className="px-4 sm:px-6 pt-5 pb-4 border-b border-adm-divider flex items-start gap-3">
            <AdminIconTile name={RULE_FAMILY_ICON[selected]} />
            <div className="min-w-0 flex-1">
              <p className="text-[13px] leading-[18px] text-adm-muted">Selected rule</p>
              <h3 className="text-[20px] leading-[28px] font-bold text-adm-ink">{family.label} approval</h3>
            </div>
            <StatusChip tone="info" className="h-[26px] text-[13px]">{versionChip}</StatusChip>
          </header>
            {panelBody}
          </aside>
        )}
      </div>

      {!narrow && <div className="flex flex-wrap items-center justify-between gap-2 text-[13px] leading-[18px] text-adm-muted">
        <span>{review.dirty ? `${changes.length} change${changes.length === 1 ? "" : "s"} pending review` : "No changes pending"}</span>
      </div>}

      {narrow && (
        <DetailDrawer open={!!rawRule} onClose={() => setParams((p) => { const n = new URLSearchParams(p); n.delete("rule"); n.delete("edit"); return n; }, { replace: true })} title={`${family.label} approval`} description="Selected rule">
          {panelBody}
        </DetailDrawer>
      )}

      <DetailDrawer open={drawer === "impact"} onClose={() => setDrawer(null)} title="Impact of pending changes" description="Before and after, and what each change does. Nothing is saved from here.">
        <ul className="space-y-3">
          {changes.map((c) => (
            <li key={c.key} className="rounded-lg border border-adm-divider px-3.5 py-3">
              <p className="text-[14px] leading-[20px] font-semibold">{c.label}</p>
              <p className="mt-1 text-[14px] leading-[20px]"><span className="text-adm-muted">{c.before ? "On" : "Off"}</span> to <span className="font-semibold">{c.after ? "On" : "Off"}</span></p>
              <p className="mt-1 text-[13px] leading-[18px] text-adm-muted">{ruleEffect(c.key, c.after)}</p>
            </li>
          ))}
        </ul>
        {warnings.map((w) => <InlineNote key={w} tone="warning">{w}</InlineNote>)}
        <SignedVersionsNotice />
      </DetailDrawer>

      <DetailDrawer open={drawer === "history"} onClose={() => setDrawer(null)} title="Version history" description="Read from the policy version and the activity log. No event is created or estimated.">
        <dl className="rounded-lg border border-adm-divider px-3.5 divide-y divide-adm-divider">
          <div className="py-2.5 flex justify-between gap-3 text-[14px]"><dt className="text-adm-muted">Policy version</dt><dd className="font-medium">{versionKnown ? `Version ${readiness.policyVersion}` : versionCheck === "pending_migration" ? "Not tracked yet" : "Unavailable"}</dd></div>
        </dl>
        {!versionKnown && (
          <InlineNote tone="neutral">{versionCheck === "pending_migration" ? "Versioning starts when the authority migration that adds admin_policy_version is applied. Until then only the activity log below is available." : "The policy version could not be read."}</InlineNote>
        )}
        {historyLines.length === 0 ? (
          <p className="text-[14px] leading-[20px] text-adm-muted">The activity log holds no change to these rules.</p>
        ) : (
          <ol className="divide-y divide-adm-divider rounded-lg border border-adm-divider">
            {historyLines.map((h) => (
              <li key={h.id} className="px-3.5 py-2.5 text-[14px] leading-[20px]">
                <p className="font-semibold">{dateLabel(h.at)}{h.by ? ` by ${h.by}` : ""}</p>
                {h.keys.length > 0 && <p className="text-[13px] leading-[18px] text-adm-muted">{h.keys.map((k) => DOCUMENT_RULE_LABELS[k as keyof DocumentRules] ?? k).join("; ")}</p>}
              </li>
            ))}
          </ol>
        )}
        <Link to={adminTabHref("change-history")} className="inline-flex items-center gap-2 min-h-[44px] text-[14px] font-semibold text-adm-primary hover:underline"><AdminIcon name="history" />Open change history</Link>
      </DetailDrawer>

      <DetailDrawer open={drawer === "signers"} onClose={() => setDrawer(null)} title="Signer role details" description="Who can satisfy the K-208 gate today.">
        <SignerRoleDetails gates={gates} />
        <StatusBadge state="required" label="Edited in Service policy" />
      </DetailDrawer>

      <SettingsReviewDialog review={review} title="Review policy changes" />
    </div>
  );
}
