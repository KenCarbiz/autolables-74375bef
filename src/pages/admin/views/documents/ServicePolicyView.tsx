import { useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useDealerSettings, type DealerSettings } from "@/contexts/DealerSettingsContext";
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
} from "@/lib/admin/documentPolicy";
import {
  TITLE_POLICY_KEYS,
  TITLE_POLICY_LABELS,
  formatTitleValue,
  inspectionSummary,
  joinList,
  parseList,
  reconSummary,
  signerModeFor,
  signerSelectionError,
  technicianSummary,
  titlePolicyFromSettings,
  titlePolicyValidation,
  titlePolicyWarnings,
  titleSummary,
  isEmail,
  type SignerMode,
  type TitlePolicy,
} from "@/lib/admin/servicePolicyModel";
import { AdminButton, AdminCard, AdminLinkButton, InlineNote } from "@/components/admin/v2/primitives";
import { ADMIN_CHILD_ROUTES } from "@/lib/admin/sections";
import { AdminIcon, AdminIconTile, ChipInput, DetailDrawer, DraftActionBar, ScopeLabel, SectionCard, StatusBadge, SwitchField, deriveDraftBarState, type AdminIconName } from "@/components/admin/v3/editor";
import { useWaveCVariant } from "@/pages/admin/views/publishing/waveCVariant";
import { cn } from "@/lib/utils";
import { SettingsReviewDialog, useSettingsReview, type ImpactFixture } from "./SettingsReviewApply";
import { FIELD_LABEL, INPUT_CLASS, usePanelAnchor } from "./controls";
import { ReconRoutePreview, ReminderHistory, TaskPicker, TitleRequestPreview, type ProductOption, type ReminderRow } from "./ServicePolicyDrawers";
import { SignerRoleDetails } from "./ApprovalRuleParts";
import { SERVICE_GROUPS } from "./hub/HubService";

// Service policy: four focused groups (Inspection & signing, Technician
// requirements, Recon spending approvals, Title & MCO collection), each shown
// as a summary first and opened to configure. Every value is an existing
// dealer_profiles.settings key written through merge_dealer_settings by one
// Review & Apply (the server limits the K-208 keys to service-policy roles and
// audits them). The Get-Ready catalog is edited in its own child view.

type ServiceDraft = ServicePolicy & TitlePolicy;

export interface ServicePolicyFixture {
  policy: ServicePolicy;
  title?: TitlePolicy;
  impact: ImpactFixture;
  /** Fixture viewers may edit service keys; production reads the member's capability. */
  canEdit?: boolean;
  canEditOps?: boolean;
  pendingDraft?: Partial<ServiceDraft>;
  invalidDraft?: Partial<ServiceDraft>;
  products?: ProductOption[] | null;
  reminders?: ReminderRow[] | null;
  rooftopLabel?: string;
}

type GroupId = (typeof SERVICE_GROUPS)[number]["id"];
const GROUP_IDS: readonly GroupId[] = ["inspection", "technician", "recon", "title"];
const PANEL_GROUP: Record<string, GroupId> = { "signing-gates": "inspection", "prep-rules": "technician", "recon-approval": "recon", "title-clerk": "title" };
const GROUP_PANEL: Record<GroupId, string> = { inspection: "signing-gates", technician: "prep-rules", recon: "recon-approval", title: "title-clerk" };
type Drawer = null | "signers" | "tasks" | "route" | "titlePreview" | "reminders";

const emailValidate = (v: string): string | null => (isEmail(v) ? null : "Enter a valid email address.");

const STATE_BADGE = { on: "enabled", off: "disabled", attention: "setup_required" } as const;
const STATE_LABEL = { on: "In effect", off: "Not required", attention: "Setup needed" } as const;

const RadioOption = ({ name, checked, onChange, disabled, title, detail }: { name: string; checked: boolean; onChange: () => void; disabled?: boolean; title: string; detail: string }) => (
  <label className={cn("flex items-start gap-3 rounded-lg border px-3.5 py-3 min-h-[56px] cursor-pointer", checked ? "border-adm-primary bg-adm-selected" : "border-adm-border hover:bg-adm-workspace", disabled && "opacity-60 cursor-not-allowed")}>
    <input type="radio" name={name} checked={checked} onChange={onChange} disabled={disabled} className="mt-1 w-5 h-5 accent-[var(--adm-primary,#1D5FD0)]" />
    <span className="min-w-0">
      <span className="block text-[14px] leading-[20px] font-semibold text-adm-ink">{title}</span>
      <span className="block text-[13px] leading-[18px] text-adm-muted">{detail}</span>
    </span>
  </label>
);

export default function ServicePolicyView() {
  const fixture = useViewFixture<ServicePolicyFixture>("service-policy");
  const variant = useWaveCVariant(!!fixture);
  const { settings } = useDealerSettings();
  const { isAdmin } = useAuth();
  const { member } = useEntitlements();
  const [params, setParams] = useSearchParams();
  usePanelAnchor();
  const liveCanEdit = hasDealerCapability(member?.role, "can_manage_service_settings", isAdmin);
  const liveCanOps = liveCanEdit || hasDealerCapability(member?.role, "can_manage_settings", isAdmin);
  const canEdit = fixture ? (fixture.canEdit ?? true) && variant !== "readonly" && variant !== "blocked" : liveCanEdit;
  const canEditOps = fixture ? (fixture.canEditOps ?? true) && variant !== "readonly" : liveCanOps;

  const rawGroup = params.get("group");
  const panel = params.get("panel");
  const group: GroupId | null = (GROUP_IDS as readonly string[]).includes(rawGroup ?? "") ? (rawGroup as GroupId) : panel && PANEL_GROUP[panel] ? PANEL_GROUP[panel] : null;
  const chooseGroup = (g: GroupId | null) => setParams((p) => { const n = new URLSearchParams(p); if (g) n.set("group", g); else n.delete("group"); n.delete("panel"); return n; }, { replace: true });
  const [drawer, setDrawer] = useState<Drawer>(null);

  const signerRef = useRef<SignerMode>("any");
  const review = useSettingsReview<ServiceDraft>({
    scope: "service_policy",
    read: (s) => (variant === "empty" ? emptyDraft() : { ...(fixture?.policy ?? servicePolicyFromSettings(s)), ...titlePolicyFromSettings(fixture?.title ?? s) }),
    describe: (field, before, after) => {
      const isTitle = (TITLE_POLICY_KEYS as readonly string[]).includes(field);
      return isTitle
        ? { field, label: TITLE_POLICY_LABELS[field as keyof typeof TITLE_POLICY_LABELS], before: formatTitleValue(field as keyof typeof TITLE_POLICY_LABELS, before), after: formatTitleValue(field as keyof typeof TITLE_POLICY_LABELS, after) }
        : { field, label: SERVICE_POLICY_LABELS[field as keyof typeof SERVICE_POLICY_LABELS], before: formatServiceValue(field as keyof typeof SERVICE_POLICY_LABELS, before), after: formatServiceValue(field as keyof typeof SERVICE_POLICY_LABELS, after) };
    },
    validate: (d) => [...servicePolicyValidation(d), ...titlePolicyValidation(d), ...(signerSelectionError(d.require_safety_inspection, signerRef.current, d.k208_authority_roles) ? [signerSelectionError(d.require_safety_inspection, signerRef.current, d.k208_authority_roles) as string] : [])],
    warnings: (b, a) => [...servicePolicyWarnings(b, a), ...titlePolicyWarnings(b, a)],
    toPayload: (draft, changed) => Object.fromEntries(changed.map((k) => [k, draft[k]])) as Partial<DealerSettings>,
    canEdit: canEditOps,
    fixtureImpact: fixture?.impact ?? null,
    initialDraft: variant === "invalid" ? fixture?.invalidDraft ?? null : variant === "default" ? fixture?.pendingDraft ?? null : null,
  });
  const d = review.draft;
  const stored = review.state.original;
  const set = <K extends keyof ServiceDraft>(key: K, value: ServiceDraft[K]) => review.edit((x) => ({ ...x, [key]: value }));

  const [signerMode, setSignerModeState] = useState<SignerMode>(() => (variant === "invalid" && !!fixture?.invalidDraft ? "selected" : signerModeFor(d.k208_authority_roles)));
  signerRef.current = signerMode;
  const setSignerMode = (m: SignerMode) => {
    setSignerModeState(m);
    if (m === "any") set("k208_authority_roles", []);
  };
  const [everyAmount, setEveryAmount] = useState(() => !(d.recon_auto_approve_amount > 0));
  const [thresholdInput, setThresholdInput] = useState(() => (d.recon_auto_approve_amount > 0 ? String(d.recon_auto_approve_amount) : ""));
  const thresholdValue = Number.parseInt(thresholdInput, 10);
  const thresholdValid = /^\d+$/.test(thresholdInput.trim()) && thresholdValue >= 1;
  const amountError = !everyAmount && !thresholdValid ? "Enter an amount of $1 or more, or choose Require approval for every amount." : null;
  const chooseEvery = (every: boolean) => {
    setEveryAmount(every);
    if (every) {
      set("recon_auto_approve_amount", 0);
      return;
    }
    const restore = stored.recon_auto_approve_amount > 0 ? stored.recon_auto_approve_amount : thresholdValid ? thresholdValue : 0;
    if (restore > 0) {
      setThresholdInput(String(restore));
      set("recon_auto_approve_amount", restore);
    }
  };
  const changeThreshold = (v: string) => {
    setThresholdInput(v);
    const n = Number.parseInt(v, 10);
    if (/^\d+$/.test(v.trim()) && n >= 1) set("recon_auto_approve_amount", n);
  };

  const signerError = signerSelectionError(d.require_safety_inspection, signerMode, d.k208_authority_roles);
  const localErrors = [signerError, amountError, ...servicePolicyValidation(d), ...titlePolicyValidation(d)].filter((x): x is string => !!x);
  const roles = d.k208_authority_roles;
  const tasks = parseList(d.prep_service_photo_tasks);
  const recipients = parseList(d.title_clerk_email);
  const approvers = parseList(d.recon_approval_email);

  const services = settings.get_ready_services ?? [];

  const summaries = useMemo(() => ({ inspection: inspectionSummary(d), technician: technicianSummary(d), recon: reconSummary(d), title: titleSummary(d) }), [d]);
  const gatesDisabled = !canEdit;
  const opsDisabled = !canEditOps;
  const barState = deriveDraftBarState({ phase: review.open ? "reviewing" : "idle", dirty: review.dirty, changeCount: review.rows.length, firstError: localErrors[0] });
  const gatesCtx = { k208Required: d.require_safety_inspection, k208Roles: roles, licenseeCertification: d.require_k208_licensee_certification, installVerification: d.require_install_verification };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <ScopeLabel scope="all_rooftops" />
        <p className="text-[13px] leading-[18px] text-adm-muted">Saved once for the whole dealer group. Changes apply to vehicles going forward; signed inspections and disclosures are not changed.</p>
      </div>
      {!canEditOps && <InlineNote tone="warning">Your role can view this policy but not change it. The summaries below are read from the saved policy.</InlineNote>}
      {canEditOps && !canEdit && <InlineNote tone="warning">Your role can change recon and title settings but not the signing gates or technician rules. The server enforces this; the disabled fields cannot be unlocked here.</InlineNote>}

      <section aria-label="Service policy summary">
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {SERVICE_GROUPS.map((g) => {
            const s = summaries[g.id];
            const open = group === g.id;
            return (
              <li key={g.id}>
                <div className={cn("h-full rounded-xl border p-4 flex flex-col gap-3", open ? "border-adm-primary bg-adm-selected" : "border-adm-divider bg-adm-surface")}>
                  <div className="flex items-start gap-3">
                    <AdminIconTile name={g.icon as AdminIconName} tone={open ? "primary" : "neutral"} />
                    <div className="min-w-0 flex-1">
                      <h2 className="text-[16px] leading-[24px] font-semibold text-adm-ink">{g.title}</h2>
                      <StatusBadge state={STATE_BADGE[s.state]} label={STATE_LABEL[s.state]} className="mt-1" />
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] leading-[20px] font-medium text-adm-ink">{s.headline}</p>
                    <ul className="mt-1 space-y-0.5 text-[13px] leading-[18px] text-adm-muted">{s.lines.map((l) => <li key={l}>{l}</li>)}</ul>
                  </div>
                  <AdminButton variant={open ? "primary" : "outline"} size="sm" aria-pressed={open} aria-label={`${open ? "Close" : "Configure"} ${g.title}`} className="min-h-[44px] sm:min-h-[36px]" onClick={() => chooseGroup(open ? null : g.id)}>
                    {open ? "Close editor" : "Configure"}
                    <AdminIcon name={open ? "close" : "chevron-right"} />
                  </AdminButton>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {group === null && <p className="text-[14px] leading-[20px] text-adm-muted">Choose Configure on a section to edit it. Nothing is saved until you review and apply.</p>}

      {group === "inspection" && (
        <SectionCard id={GROUP_PANEL.inspection} icon="clipboard-check" title="Inspection & signing" description="What must be complete before a customer disclosure can be signed. The server limits these keys to owners, managers and service managers and records every change.">
          <div className="space-y-5">
            <div>
              <SwitchField label="Require K-208 before customer signing" checked={d.require_safety_inspection} onChange={(v) => set("require_safety_inspection", v)} disabled={gatesDisabled} />
              <p className="ml-[52px] -mt-1 text-[13px] leading-[18px] text-adm-muted">Applies to Used and CPO vehicles. New vehicles are exempt. Blocks signing until the CT K-208 safety inspection is complete.</p>
            </div>
            {d.require_safety_inspection && (
              <fieldset className="space-y-3 rounded-xl border border-adm-divider p-4">
                <legend className="px-1 text-[15px] leading-[22px] font-semibold text-adm-ink">Who may sign the K-208</legend>
                <div className="grid gap-3 md:grid-cols-2">
                  <RadioOption name="signer-mode" checked={signerMode === "any"} onChange={() => setSignerMode("any")} disabled={gatesDisabled} title="Any accepted signer" detail="A signed K-208 from anyone satisfies the gate, including an anonymous QR sign-off." />
                  <RadioOption name="signer-mode" checked={signerMode === "selected"} onChange={() => setSignerMode("selected")} disabled={gatesDisabled} title="Selected authorized roles" detail="Only a signed-in member with a checked role satisfies the gate. An anonymous QR sign-off does not count." />
                </div>
                {signerMode === "selected" && (
                  <div role="group" aria-label="Roles whose signed K-208 satisfies the gate" className="space-y-1">
                    {K208_SIGNER_ROLES.map((r) => {
                      const on = roles.includes(r.key);
                      return (
                        <label key={r.key} className={cn("flex items-center gap-3 min-h-[44px] px-1 text-[14px]", gatesDisabled ? "opacity-60" : "cursor-pointer")}>
                          <input type="checkbox" className="w-5 h-5 accent-[var(--adm-primary,#1D5FD0)]" checked={on} disabled={gatesDisabled} onChange={() => set("k208_authority_roles", on ? roles.filter((x) => x !== r.key) : [...roles, r.key])} />
                          {r.label}
                        </label>
                      );
                    })}
                    {signerError && <p role="alert" className="flex items-start gap-1.5 text-[13px] leading-[18px] font-medium text-adm-danger"><AdminIcon name="alert" size="inline" className="mt-px" />{signerError}</p>}
                  </div>
                )}
                <AdminButton size="sm" onClick={() => setDrawer("signers")}>Signer role details</AdminButton>
              </fieldset>
            )}
            {d.require_safety_inspection && (
              <SwitchField label="Also require licensee certification" checked={d.require_k208_licensee_certification} onChange={(v) => set("require_k208_licensee_certification", v)} disabled={gatesDisabled} />
            )}
            <div>
              <SwitchField label="Require install verification before customer signing" checked={d.require_install_verification} onChange={(v) => set("require_install_verification", v)} disabled={gatesDisabled} />
              <p className="ml-[52px] -mt-1 text-[13px] leading-[18px] text-adm-muted">Evidence required: a verified install with a photo and a signature for every pre-installed product. Signing is blocked until each one is verified.</p>
            </div>
            <p className="text-[13px] leading-[18px] text-adm-muted">Per-user signer grants and the overdue threshold live in <Link to="/service/settings" className="font-semibold text-adm-primary hover:underline">Service Desk settings</Link>.</p>
          </div>
        </SectionCard>
      )}

      {group === "technician" && (
        <SectionCard id={GROUP_PANEL.technician} icon="wrench" title="Technician requirements" description="Rules for the QR work-event flow on the vehicle's prep page.">
          <div className="space-y-5">
            <SwitchField label="Require RO number on Service Install sign-offs" checked={d.prep_require_ro} onChange={(v) => set("prep_require_ro", v)} disabled={gatesDisabled} />
            <SwitchField label="Require photos on Initial Inventory Detail" checked={d.prep_detail_photos_required} onChange={(v) => set("prep_detail_photos_required", v)} disabled={gatesDisabled} />
            <div className="space-y-2">
              <ChipInput label="Service tasks that require photo proof" values={tasks} onChange={(next) => set("prep_service_photo_tasks", joinList(next))} placeholder="Type a task label and press Enter" validate={(v) => (v.includes(",") ? "A task label cannot contain a comma." : null)} disabled={gatesDisabled} />
              <div className="flex items-center gap-3 flex-wrap">
                <AdminButton size="sm" onClick={() => setDrawer("tasks")}><AdminIcon name="list" />Pick from catalog</AdminButton>
                <span className="text-[13px] leading-[18px] text-adm-muted">Matching Service Install tasks block submit until a photo is attached.</span>
              </div>
              <InlineNote tone="neutral">Tasks are matched by their exact label today. Renaming a product ends the match until the label here is updated; stable task IDs are not stored by the current schema.</InlineNote>
            </div>
          </div>
        </SectionCard>
      )}

      {group === "recon" && (
        <SectionCard id={GROUP_PANEL.recon} icon="dollar" title="Recon spending approvals" description="Each recon line item is judged on its own. Lines at or under the limit clear automatically; anything higher routes to the used-car manager to approve or decline.">
          <div className="space-y-5">
            <fieldset className="space-y-3">
              <legend className="text-[15px] leading-[22px] font-semibold text-adm-ink">Per line-item approval</legend>
              <div className="grid gap-3 md:grid-cols-2">
                <RadioOption name="recon-mode" checked={!everyAmount} onChange={() => chooseEvery(false)} disabled={gatesDisabled} title="Auto-approve up to an amount" detail="A line item at or under the amount clears without a manager." />
                <RadioOption name="recon-mode" checked={everyAmount} onChange={() => chooseEvery(true)} disabled={gatesDisabled} title="Require approval for every amount" detail="Every line item routes to the manager. Saved as an auto-approve amount of 0." />
              </div>
              {!everyAmount && (
                <div className="max-w-[260px]">
                  <label htmlFor="recon-amount" className={FIELD_LABEL}>Auto-approve up to ($)</label>
                  <input id="recon-amount" type="number" inputMode="numeric" min={1} step={50} value={thresholdInput} onChange={(e) => changeThreshold(e.target.value)} disabled={gatesDisabled} aria-invalid={amountError ? true : undefined} className={cn(INPUT_CLASS, "min-h-[44px]")} />
                  {amountError && <p role="alert" className="mt-1 text-[13px] leading-[18px] font-medium text-adm-danger">{amountError}</p>}
                </div>
              )}
            </fieldset>
            <div className="rounded-xl border border-dashed border-adm-border bg-adm-workspace px-4 py-3 flex items-start gap-3">
              <AdminIcon name="ban" size="card" className="mt-0.5 text-adm-muted flex-shrink-0" />
              <div className="min-w-0">
                <p className="flex items-center gap-2 flex-wrap text-[14px] leading-[20px] font-semibold text-adm-ink">Total repair-order limit <StatusBadge state="unavailable" label="Not available" /></p>
                <p className="text-[13px] leading-[18px] text-adm-muted">The current policy has no total repair-order limit, so none is applied. A new total limit would need server enforcement and a deliberate default before it could be offered.</p>
              </div>
            </div>
            <div className="space-y-2">
              <ChipInput label="Used-car manager email(s) for approvals" values={approvers} onChange={(next) => set("recon_approval_email", joinList(next))} placeholder="Type an email and press Enter" validate={emailValidate} disabled={gatesDisabled} />
              {approvers.length === 0 ? (
                <InlineNote tone="warning" title="No approver named">The approve or decline link goes to the dealership main contact email. Add a named approver so the right person is asked.</InlineNote>
              ) : (
                <p className="text-[13px] leading-[18px] text-adm-muted">If no one responds there is no automatic escalation; the dealership main contact email is the fallback only when this list is empty.</p>
              )}
            </div>
            <div><AdminButton size="sm" onClick={() => setDrawer("route")}><AdminIcon name="route" />Approval route preview</AdminButton></div>
          </div>
        </SectionCard>
      )}

      {group === "title" && (
        <SectionCard id={GROUP_PANEL.title} icon="folder" title="Title & MCO collection" description="The office gets a per-vehicle link and QR to upload the title (used) or MCO (new) into the private vehicle file.">
          <div className="space-y-5">
            <div className="space-y-2">
              <ChipInput label="Title and MCO recipients" values={recipients} onChange={(next) => set("title_clerk_email", joinList(next))} placeholder="Type an email and press Enter" validate={emailValidate} disabled={opsDisabled} />
              {recipients.length === 0 ? <InlineNote tone="warning" title="No recipient named">Requests fall back to the dealership main contact email. Add a clerk, and a backup for when someone is out.</InlineNote> : <p className="text-[13px] leading-[18px] text-adm-muted">Add a backup so a request still goes out when someone is out of office.</p>}
            </div>
            <fieldset className="space-y-3">
              <legend className="text-[15px] leading-[22px] font-semibold text-adm-ink">Who is notified</legend>
              <div className="grid gap-3 md:grid-cols-2">
                <RadioOption name="title-routing" checked={!d.title_round_robin} onChange={() => set("title_round_robin", false)} disabled={opsDisabled} title="Notify everyone listed" detail="All recipients are emailed at once, up to the server's default of 3." />
                <RadioOption name="title-routing" checked={d.title_round_robin} onChange={() => set("title_round_robin", true)} disabled={opsDisabled} title="Rotate: one recipient at a time" detail="One clerk at a time, rotating on each request for the vehicle." />
              </div>
            </fieldset>
            <SwitchField label="Email the office automatically on intake" checked={d.title_email_on_intake} onChange={(v) => set("title_email_on_intake", v)} disabled={opsDisabled} />
            <div className="space-y-3">
              <SwitchField label="Resend reminders until received" checked={d.title_reminders_enabled} onChange={(v) => set("title_reminders_enabled", v)} disabled={opsDisabled} />
              {d.title_reminders_enabled && (
                <div className="space-y-3 rounded-xl border border-adm-divider p-4">
                  <div className="max-w-[220px]">
                    <label htmlFor="title-reminder-days" className={FIELD_LABEL}>Remind every (days)</label>
                    <input id="title-reminder-days" type="number" inputMode="numeric" min={1} step={1} value={Number.isFinite(d.title_reminder_days) ? d.title_reminder_days : ""} disabled={opsDisabled} onChange={(e) => set("title_reminder_days", Number.parseInt(e.target.value, 10) || 0)} className={cn(INPUT_CLASS, "min-h-[44px]")} />
                  </div>
                  <dl className="space-y-2 text-[14px] leading-[20px]">
                    <div><dt className="text-adm-muted">Next reminder</dt><dd>{`${d.title_reminder_days} day${d.title_reminder_days === 1 ? "" : "s"} after each vehicle's last request email. The sweep runs once a day, so a send can land up to a day later.`}</dd></div>
                    <div><dt className="text-adm-muted">Stops when</dt><dd>Both front and back images of the Title (used) or MCO (new) are on file, or the vehicle is no longer in Draft or Published status.</dd></div>
                    <div><dt className="text-adm-muted">Eligible vehicles</dt><dd>Draft and Published vehicles with no complete title or MCO. At most 60 vehicles are emailed per run.</dd></div>
                  </dl>
                </div>
              )}
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <AdminButton size="sm" onClick={() => setDrawer("titlePreview")}><AdminIcon name="mail" />Preview request</AdminButton>
              <AdminButton size="sm" onClick={() => setDrawer("reminders")}><AdminIcon name="history" />Reminder history</AdminButton>
              <span className="text-[13px] leading-[18px] text-adm-muted">Preview and history never send a message.</span>
            </div>
          </div>
        </SectionCard>
      )}

      <AdminCard
        id="getready-catalog"
        title="Get-Ready service catalog"
        description="Internal services you can add to any Get-Ready, routed to a responsible party. Never billed to the buyer."
        action={<AdminLinkButton to={ADMIN_CHILD_ROUTES.serviceCatalog} variant="outline">Open service catalog</AdminLinkButton>}
      >
        <p className="text-[13px] leading-[18px] text-adm-muted">
          {services.length === 0 ? "No services configured." : services.length === 1 ? "1 service configured." : `${services.length} services configured.`} Add, edit or remove services, and see who each is assigned to, in the catalog.
        </p>
      </AdminCard>

      <DraftActionBar
        state={barState}
        reviewLabel="Review policy changes"
        onDiscard={() => { review.discard(); setSignerModeState(signerModeFor(stored.k208_authority_roles)); setEveryAmount(!(stored.recon_auto_approve_amount > 0)); setThresholdInput(stored.recon_auto_approve_amount > 0 ? String(stored.recon_auto_approve_amount) : ""); }}
        onReview={() => void review.openReview()}
      />
      {review.dirty && !canEditOps && <InlineNote tone="warning">Your role can review this policy but not apply it.</InlineNote>}

      <ReconRoutePreview open={drawer === "route"} onClose={() => setDrawer(null)} threshold={d.recon_auto_approve_amount} approvers={approvers} />
      <TaskPicker open={drawer === "tasks"} onClose={() => setDrawer(null)} tasks={tasks} onToggle={(label) => set("prep_service_photo_tasks", joinList(tasks.some((t) => t.toLowerCase() === label.toLowerCase()) ? tasks.filter((t) => t.toLowerCase() !== label.toLowerCase()) : [...tasks, label]))} disabled={gatesDisabled} fixtureProducts={fixture?.products} fixtureActive={!!fixture} />
      <TitleRequestPreview open={drawer === "titlePreview"} onClose={() => setDrawer(null)} policy={d} />
      <ReminderHistory open={drawer === "reminders"} onClose={() => setDrawer(null)} fixtureRows={fixture?.reminders} fixtureActive={!!fixture} />
      <SignerRolesDrawer open={drawer === "signers"} onClose={() => setDrawer(null)} ctx={gatesCtx} />
      <SettingsReviewDialog review={review} title="Review service policy changes" />
    </div>
  );
}

function SignerRolesDrawer({ open, onClose, ctx }: { open: boolean; onClose: () => void; ctx: Parameters<typeof SignerRoleDetails>[0]["gates"] }) {
  return (
    <DetailDrawer open={open} onClose={onClose} title="Signer role details" description="Who satisfies the K-208 gate with the values on screen.">
      <SignerRoleDetails gates={ctx} />
    </DetailDrawer>
  );
}

function emptyDraft(): ServiceDraft {
  return { ...servicePolicyFromSettings({} as ServicePolicy), ...titlePolicyFromSettings({}) };
}
