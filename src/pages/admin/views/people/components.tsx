import { Fragment, useEffect, useMemo, useReducer, useState, type FormEvent, type ReactNode } from "react";
import { AlertTriangle, Ban, Building2, Car, Check, CheckCircle2, Code, Database, FileText, Link, Monitor, Share2, Tag, Users, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AdminButton, AdminLinkButton, AdminTable, ICON, ICON_BOX, InlineNote, KeyValueList, Td, Th } from "@/components/admin/v2/primitives";
import { useAudit } from "@/contexts/AuditContext";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { ENFORCEMENT_STATUS_META, AREA_LABEL, type EnforcementPoint, type EnforcementRow } from "@/lib/admin/enforcementMap";
import {
  assignableRoleValues,
  departmentForRole,
  canWriteTeamOnServer,
  invitableRoles,
  roleChangeImpact,
  roleSummary,
  ROLE_REASON_ENTITY,
  type CapabilityMatrix,
  type MemberStatus,
  type RoleChangeImpact,
  type TeamMember,
} from "@/lib/admin/people";
import { canApply, initialReviewApply, newIdempotencyKey, reviewApplyReducer, type ReviewApplyEvent, type ReviewApplyState } from "@/lib/admin/reviewApply";
import { ASSIGNABLE_ROLE_GROUPS, roleDisplayName } from "@/lib/permissions/dealerRoleCapabilities";
import { useTenantId, type TeamAuthority, type TeamWriters } from "./useTeamMembers";

export const INPUT_CLASS = "h-9 w-full rounded-md border border-adm-border bg-adm-surface px-3 text-[14px] leading-[20px] text-adm-ink placeholder:text-adm-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-adm-primary";
export const SELECT_CLASS = "h-9 rounded-md border border-adm-border bg-adm-surface px-2.5 text-[14px] leading-[20px] text-adm-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-adm-primary disabled:opacity-50";

// Reference: 52px circles with 18px initials in the team table (measured 48px of ink plus
// anti-aliasing, sized to the owner's 52), a 56px circle with 20px initials in the rail.
const AVATAR_SIZE = { sm: `${ICON_BOX.avatar} text-[14px]`, md: `${ICON_BOX.avatarLg} text-[18px]`, lg: `${ICON_BOX.circle} text-[20px]` };

export const MemberAvatar = ({ initials, size = "sm" }: { initials: string; size?: keyof typeof AVATAR_SIZE }) => (
  <span aria-hidden="true" className={cn("inline-flex items-center justify-center bg-adm-selected text-adm-primary font-semibold flex-shrink-0", AVATAR_SIZE[size])}>
    {initials}
  </span>
);

/** Card titles and descriptions drawn to the reference (20px title, 14px description) inside AdminCard's header. */
export const CardTitle = ({ children }: { children: ReactNode }) => <span className="block text-[20px] leading-[28px]">{children}</span>;
export const CardDescription = ({ children }: { children: ReactNode }) => <span className="block pt-px text-[14px] leading-[20px]">{children}</span>;

export const MemberStatusText = ({ status }: { status: MemberStatus }) => (
  <span className="inline-flex items-center gap-2 text-[14px] leading-[20px] text-adm-ink whitespace-nowrap">
    <span aria-hidden="true" className={cn("w-2.5 h-2.5 rounded-full", status === "active" ? "bg-adm-success" : "bg-adm-warning")} />
    {status === "active" ? "Active" : "Invited"}
  </span>
);

export const OutlineBadge = ({ children, title, icon: Icon }: { children: ReactNode; title?: string; icon?: typeof FileText }) => (
  <span title={title} className="inline-flex items-center gap-1.5 rounded-md border border-adm-primary/40 bg-adm-surface px-2.5 h-[35px] text-[14px] leading-[20px] font-semibold text-adm-primary whitespace-nowrap">
    {Icon && <Icon className={ICON.inline} aria-hidden="true" />}
    {children}
  </span>
);

export const RoleSelect = ({
  id,
  value,
  onChange,
  groups,
  current,
  disabled,
  ariaLabel,
  className,
}: {
  id?: string;
  value: string;
  onChange: (role: string) => void;
  groups: Array<{ group: string; roles: Array<{ value: string; label: string }> }>;
  /** A legacy role not in the groups stays selectable so the picker never lies about the current value. */
  current?: string;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
}) => {
  const listed = groups.some((g) => g.roles.some((r) => r.value === current));
  return (
    <select id={id} aria-label={ariaLabel} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className={cn(SELECT_CLASS, className)}>
      {current && !listed && <option value={current}>{roleDisplayName(current)} (current)</option>}
      {groups.map((g) => (
        <optgroup key={g.group} label={g.group}>
          {g.roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </optgroup>
      ))}
    </select>
  );
};

// Reference: a 32px tinted square holding a 13px check or cross (a 20px lucide box).
const Mark = ({ on, label }: { on: boolean; label: string }) => (
  <span className={cn("inline-flex w-8 h-8 items-center justify-center rounded-md", on ? "bg-adm-success-bg text-adm-success" : "bg-adm-danger-bg text-adm-danger")}>
    {on ? <Check className={ICON.inSquare} aria-hidden="true" /> : <X className={ICON.inSquare} aria-hidden="true" />}
    <span className="sr-only">{label}: {on ? "allowed" : "not allowed"}</span>
  </span>
);

const MATRIX_ROW_ICONS: Record<string, typeof Users> = {
  assigned_customers: Users,
  inventory: Car,
  connect_card: Share2,
  passport_share: FileText,
  price_rules: Tag,
  publishing_policy: FileText,
};

const MATRIX_HEAD = "px-[14px] py-[9px] text-[13px] leading-[18px] text-adm-ink";

// The scroll wrapper is positioned so the cells' screen-reader text stays inside it on narrow
// screens, where the table keeps a 640px width and scrolls inside its box.
export const CapabilityMatrixTable = ({ matrix }: { matrix: CapabilityMatrix }) => (
  <AdminTable caption="Role capabilities by task" inset className="relative mx-5 mb-[17px] rounded-lg [&>table]:min-w-[640px]">
    <thead>
      <tr>
        <Th className={MATRIX_HEAD}>Capability</Th>
        <Th className={cn(MATRIX_HEAD, "text-center w-[120px]")}>Read</Th>
        <Th className={cn(MATRIX_HEAD, "text-center w-[120px]")}>Create or act</Th>
        <Th className={cn(MATRIX_HEAD, "text-center w-[118px]")}>Manage</Th>
      </tr>
    </thead>
    <tbody>
      {matrix.map((g) => (
        <Fragment key={g.group}>
          <tr>
            <td colSpan={4} className="px-[14px] py-[7px] border-b border-adm-border bg-adm-workspace text-[14px] leading-[18px] font-semibold text-adm-ink">{g.group}</td>
          </tr>
          {g.rows.map((r) => {
            const Icon = MATRIX_ROW_ICONS[r.id] ?? FileText;
            return (
              <tr key={r.id}>
                <Td className="py-[9px] pl-[15px]">
                  <span className="flex items-center gap-[18px]">
                    <Icon className={cn(ICON.panel, "flex-shrink-0 text-adm-ink")} strokeWidth={1.75} aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="block text-[14px] leading-[21px] font-semibold text-adm-ink">{r.label}</span>
                      <span className="block text-[13px] leading-[18px] text-adm-muted">{r.detail}</span>
                    </span>
                  </span>
                </Td>
                <Td className="py-[9px] text-center"><Mark on={r.read} label={`${r.label} read`} /></Td>
                <Td className="py-[9px] text-center"><Mark on={r.act} label={`${r.label} create or act`} /></Td>
                <Td className="py-[9px] text-center"><Mark on={r.manage} label={`${r.label} manage`} /></Td>
              </tr>
            );
          })}
        </Fragment>
      ))}
    </tbody>
  </AdminTable>
);

const POINT_ICONS: Record<EnforcementPoint, typeof Monitor> = { interface: Monitor, direct_url: Link, api: Code, database: Database };

const ENFORCEMENT_CHIP: Record<"success" | "warning", string> = {
  success: "bg-adm-success-bg border-[#BFE3CF] text-adm-success",
  warning: "bg-adm-warning-bg border-[#F1D58A] text-adm-warning",
};

const EnforcementChip = ({ tone, children }: { tone: "success" | "warning"; children: ReactNode }) => {
  const Icon = tone === "success" ? CheckCircle2 : AlertTriangle;
  return (
    <span className={cn("ml-auto inline-flex items-center gap-[6px] rounded-lg border px-2 py-[4px] text-[13px] leading-[16px] font-semibold flex-shrink-0", ENFORCEMENT_CHIP[tone])}>
      <Icon className={cn(ICON.status, "flex-shrink-0")} aria-hidden="true" />
      <span className="max-w-[76px]">{children}</span>
    </span>
  );
};

export const EnforcementRail = ({ rows }: { rows: EnforcementRow[] }) => (
  <div>
    <ul aria-label="Enforcement points" className="rounded-lg border border-adm-border divide-y divide-adm-border">
      {rows.map((r) => {
        const meta = ENFORCEMENT_STATUS_META[r.status];
        const Icon = POINT_ICONS[r.point];
        return (
          <li key={r.point} className="flex flex-wrap items-start gap-x-[21px] gap-y-3 pl-[18px] pr-[18px] py-[22px]">
            <Icon className={cn(ICON.panel, "flex-shrink-0 text-adm-ink")} strokeWidth={1.75} aria-hidden="true" />
            <div className="min-w-[160px] flex-1 max-w-[260px]">
              <p className="text-[14px] leading-[20px] font-semibold text-adm-ink">{r.title}</p>
              <p className="text-[13px] leading-[18px] text-adm-muted">{r.description}</p>
            </div>
            <EnforcementChip tone={meta.tone}>{meta.label}</EnforcementChip>
          </li>
        );
      })}
    </ul>
    <details className="mt-3 text-[12px] leading-[18px] text-adm-muted">
      <summary className="cursor-pointer font-semibold text-adm-primary">Where each status comes from</summary>
      <ul className="mt-2 space-y-2">
        {rows.map((r) => (
          <li key={r.point}>
            <span className="font-semibold text-adm-ink">{r.title}</span>
            <ul className="mt-1 space-y-1">
              {r.evidence.map((e) => (
                <li key={`${r.point}-${e.area}`}>
                  <span className="font-semibold">{AREA_LABEL[e.area]}:</span> {e.text}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </details>
  </div>
);

const RAIL_HEADING = "text-[14px] leading-[20px] font-semibold text-adm-ink";
// 24px marks on a 30px pitch: 3px above and below the mark.
const RAIL_ITEM = "flex items-center gap-[21px] py-[3px] text-[14px] leading-[20px] text-adm-ink";

// The rail is a column of the team card, drawn to the reference rhythm: a rule between each block.
export const RoleSummaryRail = ({ member, policyHref, onClose, className }: { member: TeamMember; policyHref: string; onClose: () => void; className?: string }) => {
  const summary = roleSummary(member.role);
  return (
    <aside aria-label="Role summary" className={cn("relative min-w-0 bg-adm-surface", className)}>
      <button type="button" onClick={onClose} aria-label="Close role summary" className="absolute right-[5px] top-[7px] w-8 h-8 inline-flex items-center justify-center rounded-md text-adm-muted hover:bg-adm-workspace">
        <X className={ICON.status} aria-hidden="true" />
      </button>
      <div className="pl-[18px] pr-[14px] pt-[26px] pb-[17px]">
        <h3 className="pr-10 text-[20px] leading-[28px] font-semibold text-adm-ink">Role summary</h3>
        <div className="mt-[17px] flex items-center gap-[13px]">
          <MemberAvatar initials={member.initials} size="lg" />
          <div className="min-w-0">
            <p className="text-[18px] leading-[24px] font-semibold text-adm-ink truncate" data-parity="member-name">{member.email}</p>
            <p className="flex items-center gap-2 text-[14px] leading-[20px] text-adm-muted">
              {member.roleLabel}
              <span aria-hidden="true">·</span>
              <MemberStatusText status={member.status} />
            </p>
          </div>
        </div>
      </div>
      <div className="border-t border-adm-border pl-[18px] pr-[14px] pt-[17px] pb-5">
        <div className="flex items-start gap-5">
          <Building2 className={cn(ICON.panel, "flex-shrink-0 text-adm-ink")} strokeWidth={1.75} aria-hidden="true" />
          <dl className="text-[14px] leading-[20px] text-adm-ink">
            <dt className="font-semibold">Access scope</dt>
            <dd>This rooftop</dd>
          </dl>
        </div>
      </div>
      <div className="border-t border-adm-border pl-[18px] pr-[14px] pt-[15px] pb-[14px]">
        <p className={RAIL_HEADING}>Key permissions (example)</p>
        {summary.keyPermissions.length === 0 ? (
          <p className="mt-2 text-[13px] leading-[18px] text-adm-muted">No task permissions in this summary.</p>
        ) : (
          <ul className="mt-[9px] pl-[9px]">
            {summary.keyPermissions.map((p) => (
              <li key={p} className={RAIL_ITEM}><Check className={cn(ICON.status, "text-adm-success flex-shrink-0")} aria-hidden="true" />{p}</li>
            ))}
          </ul>
        )}
      </div>
      <div className="border-t border-adm-border pl-[18px] pr-[14px] pt-[14px] pb-[30px]">
        <p className={RAIL_HEADING}>Restricted (example)</p>
        {summary.restricted.length === 0 ? (
          <p className="mt-2 text-[13px] leading-[18px] text-adm-muted">No restrictions in this summary.</p>
        ) : (
          <ul className="mt-[9px] pl-[9px]">
            {summary.restricted.map((p) => (
              <li key={p} className={RAIL_ITEM}><Ban className={cn(ICON.status, "text-adm-danger flex-shrink-0")} aria-hidden="true" />{p}</li>
            ))}
          </ul>
        )}
        <AdminLinkButton to={policyHref} variant="outline" className="mt-[22px] w-full min-h-[44px] sm:min-h-[44px]" data-landmark="view-role-policy">View role policy</AdminLinkButton>
        <InlineNote tone="info" className="mt-4 px-[14px] py-[9px] [&>div>span]:text-[12px]">Role preview does not grant permissions.</InlineNote>
      </div>
    </aside>
  );
};

export const InviteForm = ({ authority, writers, onDone }: { authority: TeamAuthority; writers: TeamWriters; onDone?: () => void }) => {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("salesperson");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const groups = useMemo(() => invitableRoles(), []);
  const disabled = !authority.canWrite || busy;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const addr = email.trim().toLowerCase();
    if (!addr.includes("@")) { setNote({ tone: "danger", text: "Enter a valid email address." }); return; }
    setBusy(true);
    const r = await writers.invite(addr, role);
    setBusy(false);
    setNote({ tone: r.ok ? "success" : "danger", text: r.message });
    if (r.ok) { setEmail(""); onDone?.(); }
  };

  return (
    <form onSubmit={submit} className="space-y-3" aria-label="Invite a teammate">
      <div>
        <label htmlFor="invite-email" className="block text-[12px] leading-[18px] font-semibold text-adm-muted mb-1">Work email</label>
        <input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@dealership.example" className={INPUT_CLASS} disabled={!authority.canWrite} />
      </div>
      <div>
        <label htmlFor="invite-role" className="block text-[12px] leading-[18px] font-semibold text-adm-muted mb-1">Role</label>
        <RoleSelect id="invite-role" value={role} onChange={setRole} groups={groups} disabled={!authority.canWrite} className="w-full" />
        <p className="mt-1 text-[12px] leading-[18px] text-adm-muted">Department: {departmentForRole(role)}. Owners are added by the server only.</p>
      </div>
      {note && <InlineNote tone={note.tone}>{note.text}</InlineNote>}
      {!authority.canWrite && authority.reason && <InlineNote tone="warning">{authority.reason}</InlineNote>}
      <AdminButton type="submit" variant="primary" disabled={disabled}>{busy ? "Sending" : "Send invitation"}</AdminButton>
    </form>
  );
};

// ── Review & Apply over set_tenant_member_role ────────────────────────────

interface RoleDraft {
  role: string;
}

const reducer = (s: ReviewApplyState<RoleDraft>, e: ReviewApplyEvent<RoleDraft>) => reviewApplyReducer(s, e);

const impactOf = (state: ReviewApplyState<RoleDraft>): RoleChangeImpact | null => (state.impact?.samples[0] as RoleChangeImpact | undefined) ?? null;

export const MemberRoleReviewDialog = ({
  open,
  onOpenChange,
  member,
  initialRole,
  readOnlyReason,
  writers,
  onApplied,
  onReload,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  member: TeamMember;
  initialRole?: string;
  readOnlyReason: string | null;
  writers: TeamWriters;
  onApplied?: (role: string) => void;
  onReload?: () => void;
}) => {
  const [state, dispatch] = useReducer(reducer, initialReviewApply<RoleDraft>({ role: member.role }));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const { log } = useAudit();
  const { user } = useAuth();
  const tenantId = useTenantId();

  useEffect(() => {
    if (!open) return;
    dispatch({ type: "reset", original: { role: member.role } });
    if (initialRole && initialRole !== member.role) dispatch({ type: "edit", draft: { role: initialRole } });
    setReason("");
    setBusy(false);
  }, [open, member.id, member.role, initialRole]);

  const review = () => {
    const errors: string[] = [];
    if (state.draft.role === member.role) errors.push("Choose a different role.");
    if (!assignableRoleValues().includes(state.draft.role)) errors.push("Choose a role from the list.");
    dispatch({ type: "validate", errors });
    if (errors.length) return;
    const impact = roleChangeImpact(member.role, state.draft.role);
    dispatch({
      type: "review",
      impact: {
        computedAt: new Date().toISOString(),
        version: member.role,
        counts: { members: 1 },
        samples: [impact],
        warnings: impact.lost.length ? [`${impact.lost.length} capability ${impact.lost.length === 1 ? "cell" : "cells"} will be removed.`] : [],
        exclusions: [],
      },
      idempotencyKey: newIdempotencyKey(`member-role:${member.id}`),
    });
  };

  const apply = async () => {
    const gate = canApply(state, member.role);
    if (!gate.ok) { dispatch({ type: "error", message: gate.reason ?? "The change cannot be applied." }); return; }
    if (readOnlyReason) { dispatch({ type: "error", message: readOnlyReason }); return; }
    dispatch({ type: "apply" });
    setBusy(true);
    try {
      const current = await writers.currentRoleOf(member.id);
      if (current === undefined) { dispatch({ type: "error", message: "The current role could not be confirmed, so nothing was changed." }); return; }
      if (current === null) { dispatch({ type: "conflict", changedFields: ["membership"] }); return; }
      if (current !== member.role) { dispatch({ type: "conflict", changedFields: ["role"] }); return; }
      const result = await writers.setRole(member.id, state.draft.role);
      if (!result.ok) { dispatch({ type: "result", result: { status: "failed", affected: 0, message: result.message } }); return; }
      if (reason.trim()) {
        log({
          store_id: tenantId ?? "",
          user_id: user?.id ?? "",
          action: "settings_updated",
          entity_type: ROLE_REASON_ENTITY,
          entity_id: member.id,
          details: { setting: "member_role", prev_role: member.role, new_role: state.draft.role, reason: reason.trim(), idempotency_key: state.idempotencyKey, server_event: "member_role_changed" },
        });
      }
      dispatch({ type: "result", result: { status: "applied", affected: 1, message: result.message } });
      onApplied?.(state.draft.role);
    } catch (e) {
      dispatch({ type: "error", message: e instanceof Error ? e.message : "The change could not be applied." });
    } finally {
      setBusy(false);
    }
  };

  const impact = impactOf(state);
  const nextRole = state.draft.role;
  const gate = state.phase === "reviewing" ? canApply(state, member.role) : null;
  const applyBlocked = !!readOnlyReason || !gate?.ok || busy;
  const applyBlockedReason = readOnlyReason ?? (gate && !gate.ok ? gate.reason ?? null : null);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px] rounded-[12px]">
        <DialogHeader>
          <DialogTitle className="text-[18px] leading-[26px] font-semibold text-adm-ink">Review role change</DialogTitle>
          <DialogDescription className="text-[13px] text-adm-muted">
            {member.email} is a {member.roleLabel} on this rooftop. Nothing is written until you apply.
          </DialogDescription>
        </DialogHeader>

        {(state.phase === "editing" || state.phase === "validating") && (
          <div className="space-y-3">
            <div>
              <label htmlFor="review-role" className="block text-[12px] leading-[18px] font-semibold text-adm-muted mb-1">New role</label>
              <RoleSelect id="review-role" value={nextRole} onChange={(role) => dispatch({ type: "edit", draft: { role } })} groups={ASSIGNABLE_ROLE_GROUPS} current={member.role} className="w-full" />
            </div>
            {state.validation.map((v) => <InlineNote key={v} tone="danger">{v}</InlineNote>)}
          </div>
        )}

        {state.phase === "reviewing" && impact && (
          <div className="space-y-3">
            <AdminTable caption="Before and after">
              <thead>
                <tr><Th>Setting</Th><Th>Before</Th><Th>After</Th></tr>
              </thead>
              <tbody>
                <tr><Td>Role</Td><Td>{member.roleLabel}</Td><Td className="font-semibold">{roleDisplayName(nextRole)}</Td></tr>
                <tr><Td>Department</Td><Td>{member.department}</Td><Td>{departmentForRole(nextRole)}</Td></tr>
                <tr><Td>Can manage the team (server rule)</Td><Td>{canWriteTeamOnServer(member.role) ? "Yes" : "No"}</Td><Td>{canWriteTeamOnServer(nextRole) ? "Yes" : "No"}</Td></tr>
              </tbody>
            </AdminTable>
            <KeyValueList rows={[
              { label: "Scope", value: "This rooftop, 1 member" },
              { label: "Writer", value: "set_tenant_member_role (owner, admin or general manager)" },
              { label: "Audit", value: "member_role_changed is written by the server" },
            ]} />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <p className="text-[12px] font-semibold text-adm-muted">Gained ({impact.gained.length})</p>
                <ul className="mt-1 space-y-1 text-[13px] text-adm-ink">
                  {impact.gained.length === 0 ? <li className="text-adm-muted">Nothing</li> : impact.gained.map((g) => <li key={g}>{g}</li>)}
                </ul>
              </div>
              <div>
                <p className="text-[12px] font-semibold text-adm-muted">Removed ({impact.lost.length})</p>
                <ul className="mt-1 space-y-1 text-[13px] text-adm-ink">
                  {impact.lost.length === 0 ? <li className="text-adm-muted">Nothing</li> : impact.lost.map((l) => <li key={l}>{l}</li>)}
                </ul>
              </div>
            </div>
            {state.impact?.warnings.map((w) => <InlineNote key={w} tone="warning">{w}</InlineNote>)}
            <div>
              <label htmlFor="review-reason" className="block text-[12px] leading-[18px] font-semibold text-adm-muted mb-1">Reason (optional)</label>
              <textarea id="review-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className={cn(INPUT_CLASS, "h-auto py-2")} placeholder="Recorded beside the server's audit entry" />
            </div>
            {applyBlockedReason && !busy && <InlineNote tone={readOnlyReason ? "info" : "warning"}>{applyBlockedReason}</InlineNote>}
          </div>
        )}

        {state.phase === "applying" && <InlineNote tone="info">Confirming the current role and applying the change.</InlineNote>}
        {state.phase === "applied" && state.result && <InlineNote tone="success" title="Applied">{state.result.message}</InlineNote>}
        {state.phase === "failed" && <InlineNote tone="danger" title="Not applied">{state.result?.message ?? state.error}</InlineNote>}
        {state.phase === "conflict" && (
          <InlineNote tone="warning" title="Changed since you opened this review">
            {state.changedElsewhere.includes("membership") ? "This member is no longer on the team. Nothing was changed." : "This member's role changed since you opened this review. Nothing was changed."}
          </InlineNote>
        )}
        {state.error && state.phase !== "failed" && state.phase !== "reviewing" && <InlineNote tone="danger">{state.error}</InlineNote>}

        <DialogFooter className="gap-2">
          {(state.phase === "editing" || state.phase === "validating") && (
            <>
              <AdminButton onClick={() => onOpenChange(false)}>Cancel</AdminButton>
              <AdminButton variant="primary" onClick={review}>Review change</AdminButton>
            </>
          )}
          {state.phase === "reviewing" && (
            <>
              <AdminButton onClick={() => dispatch({ type: "edit", draft: state.draft })}>Back to edit</AdminButton>
              <AdminButton variant="primary" onClick={apply} disabled={applyBlocked}>Apply change</AdminButton>
            </>
          )}
          {state.phase === "conflict" && (
            <AdminButton variant="primary" onClick={() => { onReload?.(); onOpenChange(false); }}>Reload and review again</AdminButton>
          )}
          {(state.phase === "applied" || state.phase === "failed") && (
            <AdminButton variant="primary" onClick={() => onOpenChange(false)}>Done</AdminButton>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
