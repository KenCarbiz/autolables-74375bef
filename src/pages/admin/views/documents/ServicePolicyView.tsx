import { Link } from "react-router-dom";
import { Plus, X } from "lucide-react";
import { useDealerSettings, type DealerSettings, type GetReadyService } from "@/contexts/DealerSettingsContext";
import { useAuth } from "@/contexts/AuthContext";
import { useEntitlements } from "@/hooks/useEntitlements";
import { hasDealerCapability } from "@/lib/permissions/dealerRoleCapabilities";
import { useViewFixture } from "@/lib/admin/dataSource";
import {
  K208_SIGNER_ROLES,
  SERVICE_POLICY_LABELS,
  formatServiceValue,
  servicePolicyFromSettings,
  servicePolicyValidation,
  servicePolicyWarnings,
  type ServicePolicy,
  type ServicePolicyKey,
} from "@/lib/admin/documentPolicy";
import { AdminButton, AdminCard, InlineNote } from "@/components/admin/v2/primitives";
import { cn } from "@/lib/utils";
import { PendingChip, SettingsReviewDialog, useSettingsReview, type ImpactFixture } from "./SettingsReviewApply";
import { FIELD_LABEL, INPUT_CLASS, SaveStatus, TEXTAREA_CLASS, ToggleRow, useInstantSettings, usePanelAnchor } from "./controls";

// Service policy: the customer-signing gates, technician sign-off rules and
// recon approval go through one Review & Apply over merge_dealer_settings
// (the server protects the K-208 keys by role and audits them). The service
// catalog and title/MCO routing are operational copy and save instantly with
// a visible status.

export interface ServicePolicyFixture {
  policy: ServicePolicy;
  impact: ImpactFixture;
}

const emptyService = (): GetReadyService => ({ name: "", responsible_name: "", responsible_email: "", cost: "" });

export default function ServicePolicyView() {
  const fixture = useViewFixture<ServicePolicyFixture>("service-policy");
  const { settings } = useDealerSettings();
  const { isAdmin } = useAuth();
  const { member } = useEntitlements();
  usePanelAnchor();
  const canEdit = hasDealerCapability(member?.role, "can_manage_service_settings", isAdmin);
  const canEditOps = canEdit || hasDealerCapability(member?.role, "can_manage_settings", isAdmin);

  const review = useSettingsReview<ServicePolicy>({
    scope: "service_policy",
    read: (s) => fixture?.policy ?? servicePolicyFromSettings(s),
    describe: (field, before, after) => ({ field, label: SERVICE_POLICY_LABELS[field], before: formatServiceValue(field, before), after: formatServiceValue(field, after) }),
    validate: servicePolicyValidation,
    warnings: servicePolicyWarnings,
    toPayload: (draft, changed) => Object.fromEntries(changed.map((k) => [k, draft[k]])) as Partial<DealerSettings>,
    canEdit,
    fixtureImpact: fixture?.impact ?? null,
  });
  const d = review.draft;
  const set = <K extends ServicePolicyKey>(key: K, value: ServicePolicy[K]) => review.edit((x) => ({ ...x, [key]: value }));

  const catalog = useInstantSettings((s) => ({ get_ready_services: (s.get_ready_services ?? []).map((x) => ({ ...x })) }), { toastId: "getready-services" });
  const services = catalog.draft.get_ready_services ?? [];
  const setServices = (next: GetReadyService[]) => catalog.patch({ get_ready_services: next });

  const title = useInstantSettings(
    (s) => ({
      title_clerk_email: s.title_clerk_email ?? "",
      title_email_on_intake: s.title_email_on_intake === true,
      title_round_robin: s.title_round_robin === true,
      title_reminders_enabled: s.title_reminders_enabled === true,
      title_reminder_days: Number.isFinite(s.title_reminder_days) ? s.title_reminder_days : 3,
    }),
    { toastId: "title-clerk" },
  );
  const t = title.draft;
  const gatesDisabled = !canEdit;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(320px,400px)] gap-4 items-start">
        <div className="space-y-4">
          <AdminCard
            id="signing-gates"
            title="Customer signing gates"
            description="What must be complete before a customer disclosure can be signed. These keys are limited by the server to owners, managers and service managers, and every change is recorded."
          >
            <div className="divide-y divide-adm-border -mt-3">
              <ToggleRow
                label="Require K-208 before customer signing"
                detail="Used and CPO only; new vehicles are exempt. Blocks signing until the CT K-208 safety inspection is complete."
                checked={d.require_safety_inspection}
                onChange={(v) => set("require_safety_inspection", v)}
                disabled={gatesDisabled}
              >
                {d.require_safety_inspection && (
                  <div className="mt-3 ml-1 pl-4 border-l-2 border-adm-border space-y-4">
                    <div>
                      <p className="text-[13px] leading-[18px] font-semibold text-adm-ink">Who may sign the K-208</p>
                      <p className="text-[12px] leading-[18px] text-adm-muted">Leave all off to accept any signed K-208. Selected roles must be logged-in members; an anonymous QR sign-off will not count.</p>
                      <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Roles whose signed K-208 satisfies the gate">
                        {K208_SIGNER_ROLES.map((r) => {
                          const on = d.k208_authority_roles.includes(r.key);
                          return (
                            <button
                              key={r.key}
                              type="button"
                              aria-pressed={on}
                              disabled={gatesDisabled}
                              onClick={() => set("k208_authority_roles", on ? d.k208_authority_roles.filter((x) => x !== r.key) : [...d.k208_authority_roles, r.key])}
                              className={cn("min-h-[32px] px-3 rounded-full text-[12px] font-semibold border disabled:opacity-50", on ? "border-adm-primary bg-adm-selected text-adm-primary" : "border-adm-border text-adm-ink hover:bg-adm-workspace")}
                            >
                              {r.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <ToggleRow
                      label="Also require licensee certification"
                      detail="A manager (licensee) certifies the A/B/C result and signs, not just the technician."
                      checked={d.require_k208_licensee_certification}
                      onChange={(v) => set("require_k208_licensee_certification", v)}
                      disabled={gatesDisabled}
                    />
                  </div>
                )}
              </ToggleRow>
              <ToggleRow
                label="Require install verification before customer signing"
                detail="Every pre-installed product needs a verified install (photo and signature) first."
                checked={d.require_install_verification}
                onChange={(v) => set("require_install_verification", v)}
                disabled={gatesDisabled}
              />
            </div>
            <p className="mt-3 text-[12px] leading-[18px] text-adm-muted">
              Per-user signer grants, the overdue threshold and inspection rules live in <Link to="/service/settings" className="font-semibold text-adm-primary hover:underline">Service Desk settings</Link>.
            </p>
          </AdminCard>

          <AdminCard id="prep-rules" title="Technician sign-off rules" description="Rules for the QR work-event flow on the vehicle's prep page.">
            <div className="divide-y divide-adm-border -mt-3">
              <ToggleRow label="Require RO number on Service Install sign-offs" checked={d.prep_require_ro} onChange={(v) => set("prep_require_ro", v)} disabled={gatesDisabled} />
              <ToggleRow label="Require photos on Initial Inventory Detail" checked={d.prep_detail_photos_required} onChange={(v) => set("prep_detail_photos_required", v)} disabled={gatesDisabled} />
            </div>
            <div className="mt-3">
              <label htmlFor="prep-photo-tasks" className={FIELD_LABEL}>Service tasks that require photo proof</label>
              <input
                id="prep-photo-tasks"
                value={d.prep_service_photo_tasks}
                onChange={(e) => set("prep_service_photo_tasks", e.target.value)}
                disabled={gatesDisabled}
                placeholder="Mud flaps installed, Running boards installed"
                className={INPUT_CLASS}
              />
              <p className="mt-1 text-[12px] leading-[18px] text-adm-muted">Comma-separated task labels. Matching Service Install tasks block submit until a photo is attached.</p>
            </div>
          </AdminCard>

          <AdminCard id="recon-approval" title="Recon approval" description="Line items at or under the amount clear automatically; anything higher routes to the used-car manager to approve or decline.">
            <div className="grid grid-cols-1 sm:grid-cols-[200px_1fr] gap-4">
              <div>
                <label htmlFor="recon-amount" className={FIELD_LABEL}>Auto-approve up to ($)</label>
                <input
                  id="recon-amount"
                  type="number"
                  min={0}
                  step={50}
                  value={d.recon_auto_approve_amount}
                  onChange={(e) => set("recon_auto_approve_amount", Math.max(0, parseInt(e.target.value, 10) || 0))}
                  disabled={gatesDisabled}
                  className={INPUT_CLASS}
                />
                <p className="mt-1 text-[12px] leading-[18px] text-adm-muted">0 routes every estimate to the manager.</p>
              </div>
              <div>
                <label htmlFor="recon-emails" className={FIELD_LABEL}>Used-car manager email(s) for approvals</label>
                <textarea
                  id="recon-emails"
                  rows={2}
                  value={d.recon_approval_email}
                  onChange={(e) => set("recon_approval_email", e.target.value)}
                  disabled={gatesDisabled}
                  placeholder="ucm@dealership.example, gm@dealership.example"
                  className={TEXTAREA_CLASS}
                />
                <p className="mt-1 text-[12px] leading-[18px] text-adm-muted">Blank sends the approve/decline link to the dealership's main contact email.</p>
              </div>
            </div>
          </AdminCard>

          <AdminCard
            id="getready-catalog"
            title="Get-Ready service catalog"
            description="Internal services you can add to any Get-Ready, routed to a responsible party. Never billed to the buyer."
            action={<SaveStatus status={catalog.status} />}
          >
            {services.length === 0 ? (
              <p className="text-[13px] leading-[18px] text-adm-muted">No services configured. Add reconditioning, emissions, key cut and similar work.</p>
            ) : (
              <div className="space-y-2">
                {services.map((s, i) => (
                  <div key={i} className="grid grid-cols-1 md:grid-cols-[1.4fr_1fr_1.4fr_0.7fr_auto] gap-2">
                    <input aria-label={`Service ${i + 1} name`} value={s.name} disabled={!canEditOps} onChange={(e) => setServices(services.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="Service (e.g. Reconditioning)" className={INPUT_CLASS} />
                    <input aria-label={`Service ${i + 1} responsible`} value={s.responsible_name} disabled={!canEditOps} onChange={(e) => setServices(services.map((x, j) => (j === i ? { ...x, responsible_name: e.target.value } : x)))} placeholder="Responsible (Service Dept.)" className={INPUT_CLASS} />
                    <input aria-label={`Service ${i + 1} email`} type="email" value={s.responsible_email} disabled={!canEditOps} onChange={(e) => setServices(services.map((x, j) => (j === i ? { ...x, responsible_email: e.target.value } : x)))} placeholder="responsible@dealership.example" className={INPUT_CLASS} />
                    <input aria-label={`Service ${i + 1} cost`} value={s.cost} disabled={!canEditOps} onChange={(e) => setServices(services.map((x, j) => (j === i ? { ...x, cost: e.target.value } : x)))} placeholder="$ cost" className={INPUT_CLASS} />
                    <AdminButton size="sm" aria-label={`Remove service ${i + 1}`} disabled={!canEditOps} onClick={() => setServices(services.filter((_, j) => j !== i))}>
                      <X className="w-4 h-4" aria-hidden="true" />
                    </AdminButton>
                  </div>
                ))}
              </div>
            )}
            <AdminButton size="sm" className="mt-3" disabled={!canEditOps} onClick={() => setServices([...services, emptyService()])}>
              <Plus className="w-4 h-4" aria-hidden="true" />
              Add service
            </AdminButton>
          </AdminCard>
        </div>

        <div className="space-y-4">
          <AdminCard id="pending-changes" className="xl:sticky xl:top-4">
            <div className="flex items-center gap-3">
              <p className="text-[16px] leading-[22px] font-semibold text-adm-ink">Pending policy changes</p>
              <PendingChip dirty={review.dirty} />
            </div>
            {review.dirty ? (
              <ul className="mt-3 space-y-2 text-[13px] leading-[18px] text-adm-ink">
                {review.rows.map((r) => (
                  <li key={r.field}>
                    <span className="font-semibold">{r.label}</span>
                    <span className="block text-adm-muted">{r.before} to {r.after}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-[13px] leading-[18px] text-adm-muted">Edit a gate, rule or approval amount, then review the change before it applies.</p>
            )}
            <p className="mt-3 text-[12px] leading-[18px] text-adm-muted">Changes apply to vehicles going forward. Signed inspections and disclosures are not changed.</p>
            {!canEdit && <InlineNote tone="warning" className="mt-3">Your role can view this policy but not change it.</InlineNote>}
            <div className="mt-4 flex flex-col gap-2">
              <AdminButton variant="primary" onClick={() => void review.openReview()} disabled={!review.dirty || !canEdit}>Review policy changes</AdminButton>
              <AdminButton variant="ghost" onClick={review.discard} disabled={!review.dirty}>Discard changes</AdminButton>
            </div>
          </AdminCard>

          <AdminCard id="title-clerk" title="Title / MCO upload" description="The office gets a per-vehicle link and QR to upload the title (used) or MCO (new) into the private vehicle file." action={<SaveStatus status={title.status} />}>
            <div className="space-y-4">
              <div>
                <label htmlFor="title-clerk-email" className={FIELD_LABEL}>Office clerk email(s)</label>
                <textarea
                  id="title-clerk-email"
                  rows={2}
                  value={t.title_clerk_email}
                  disabled={!canEditOps}
                  onChange={(e) => title.patch({ title_clerk_email: e.target.value })}
                  placeholder="titles@dealership.example, backup-clerk@dealership.example"
                  className={TEXTAREA_CLASS}
                />
                <p className="mt-1 text-[12px] leading-[18px] text-adm-muted">Separate addresses with commas. Add a backup so it still goes out when someone is out of office.</p>
              </div>
              <div className="divide-y divide-adm-border">
                <ToggleRow label="Email the office automatically on intake" checked={t.title_email_on_intake} onChange={(v) => title.patch({ title_email_on_intake: v })} disabled={!canEditOps} />
                <ToggleRow label="Round-robin the request" detail="One clerk at a time, rotating on each reminder." checked={t.title_round_robin} onChange={(v) => title.patch({ title_round_robin: v })} disabled={!canEditOps} />
                <ToggleRow label="Resend reminders until received" checked={t.title_reminders_enabled} onChange={(v) => title.patch({ title_reminders_enabled: v })} disabled={!canEditOps} />
              </div>
              {t.title_reminders_enabled && (
                <div>
                  <label htmlFor="title-reminder-days" className={FIELD_LABEL}>Remind every (days)</label>
                  <input
                    id="title-reminder-days"
                    type="number"
                    min={1}
                    step={1}
                    value={t.title_reminder_days}
                    disabled={!canEditOps}
                    onChange={(e) => title.patch({ title_reminder_days: Math.max(1, parseInt(e.target.value, 10) || 3) })}
                    className={INPUT_CLASS}
                  />
                  <p className="mt-1 text-[12px] leading-[18px] text-adm-muted">Re-emails the office while no title or MCO is on file for an in-stock vehicle.</p>
                </div>
              )}
            </div>
          </AdminCard>
        </div>
      </div>

      <SettingsReviewDialog review={review} title="Review service policy changes" />
    </div>
  );
}
