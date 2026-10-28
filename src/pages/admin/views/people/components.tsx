import { Fragment, useEffect, useMemo, useReducer, useState, type FormEvent, type ReactNode } from "react";
import { Check, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AdminButton, AdminLinkButton, AdminTable, InlineNote, KeyValueList, StatusChip, Td, Th } from "@/components/admin/v2/primitives";
import { useAudit } from "@/contexts/AuditContext";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";
import { ENFORCEMENT_STATUS_META, AREA_LABEL, type EnforcementRow } from "@/lib/admin/enforcementMap";
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

export const MemberAvatar = ({ initials, size = "sm" }: { initials: string; size?: "sm" | "md" }) => (
  <span aria-hidden="true" className={cn("inline-flex items-center justify-center rounded-full bg-adm-selected text-adm-primary font-semibold flex-shrink-0", size === "sm" ? "w-8 h-8 text-[12px]" : "w-11 h-11 text-[14px]")}>
    {initials}
  </span>
);

export const MemberStatusText = ({ status }: { status: MemberStatus }) => (
  <span className="inline-flex items-center gap-2 text-[14px] leading-[20px] text-adm-ink whitespace-nowrap">
    <span aria-hidden="true" className={cn("w-2 h-2 rounded-full", status === "active" ? "bg-adm-success" : "bg-adm-warning")} />
    {status === "active" ? "Active" : "Invited"}
  </span>
);

export const OutlineBadge = ({ children, title }: { children: ReactNode; title?: string }) => (
  <span title={title} className="inline-flex items-center rounded-md border border-adm-border px-2 py-[3px] text-[12px] leading-[18px] font-semibold text-adm-muted whitespace-nowrap">
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

const Mark = ({ on, label }: { on: boolean; label: string }) => (
  <span className="inline-flex items-center justify-center">
    {on ? <Check className="w-4 h-4 text-adm-success" aria-hidden="true" /> : <X className="w-4 h-4 text-adm-muted" aria-hidden="true" />}
    <span className="sr-only">{label}: {on ? "allowed" : "not allowed"}</span>
  </span>
);

export const CapabilityMatrixTable = ({ matrix }: { matrix: CapabilityMatrix }) => (
  <AdminTable caption="Role capabilities by task">
    <thead>
      <tr>
        <Th>Capability</Th>
        <Th className="text-center w-[100px]">Read</Th>
        <Th className="text-center w-[120px]">Create or act</Th>
        <Th className="text-center w-[100px]">Manage</Th>
      </tr>
    </thead>
    <tbody>
      {matrix.map((g) => (
        <Fragment key={g.group}>
          <tr>
            <td colSpan={4} className="px-3 py-2 border-b border-adm-border bg-adm-workspace/60 text-[12px] leading-[18px] font-semibold text-adm-muted">{g.group}</td>
          </tr>
          {g.rows.map((r) => (
            <tr key={r.id}>
              <Td>
                <span className="block font-semibold text-adm-ink">{r.label}</span>
                <span className="block text-[12px] leading-[18px] text-adm-muted">{r.detail}</span>
              </Td>
              <Td className="text-center"><Mark on={r.read} label={`${r.label} read`} /></Td>
              <Td className="text-center"><Mark on={r.act} label={`${r.label} create or act`} /></Td>
              <Td className="text-center"><Mark on={r.manage} label={`${r.label} manage`} /></Td>
            </tr>
          ))}
        </Fragment>
      ))}
    </tbody>
  </AdminTable>
);

export const EnforcementRail = ({ rows }: { rows: EnforcementRow[] }) => (
  <div>
    <ul className="divide-y divide-adm-border -mt-2">
      {rows.map((r) => {
        const meta = ENFORCEMENT_STATUS_META[r.status];
        return (
          <li key={r.point} className="py-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[14px] leading-[20px] font-semibold text-adm-ink">{r.title}</p>
              <p className="text-[12px] leading-[18px] text-adm-muted">{r.description}</p>
            </div>
            <StatusChip tone={meta.tone} icon>{meta.label}</StatusChip>
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

export const RoleSummaryRail = ({ member, policyHref, onClose }: { member: TeamMember; policyHref: string; onClose: () => void }) => {
  const summary = roleSummary(member.role);
  return (
    <aside aria-label="Role summary" className="rounded-[10px] border border-adm-border bg-adm-surface">
      <header className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-adm-border">
        <h3 className="text-[16px] leading-[22px] font-semibold text-adm-ink">Role summary</h3>
        <button type="button" onClick={onClose} aria-label="Close role summary" className="w-8 h-8 inline-flex items-center justify-center rounded-md text-adm-muted hover:bg-adm-workspace">
          <X className="w-4 h-4" aria-hidden="true" />
        </button>
      </header>
      <div className="px-5 py-4 space-y-4">
        <div className="flex items-center gap-3">
          <MemberAvatar initials={member.initials} size="md" />
          <div className="min-w-0">
            <p className="text-[14px] font-semibold text-adm-ink truncate">{member.email}</p>
            <p className="text-[12px] leading-[18px] text-adm-muted">{member.roleLabel}</p>
          </div>
        </div>
        <KeyValueList rows={[{ label: "Access scope", value: "This rooftop" }, { label: "Status", value: <MemberStatusText status={member.status} /> }]} />
        <div>
          <p className="text-[12px] leading-[18px] font-semibold text-adm-muted">Key permissions (example)</p>
          {summary.keyPermissions.length === 0 ? (
            <p className="mt-1 text-[13px] text-adm-muted">No task permissions in this summary.</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {summary.keyPermissions.map((p) => (
                <li key={p} className="flex items-center gap-2 text-[14px] leading-[20px] text-adm-ink"><Check className="w-4 h-4 text-adm-success flex-shrink-0" aria-hidden="true" />{p}</li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className="text-[12px] leading-[18px] font-semibold text-adm-muted">Restricted (example)</p>
          {summary.restricted.length === 0 ? (
            <p className="mt-1 text-[13px] text-adm-muted">No restrictions in this summary.</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {summary.restricted.map((p) => (
                <li key={p} className="flex items-center gap-2 text-[14px] leading-[20px] text-adm-ink"><X className="w-4 h-4 text-adm-muted flex-shrink-0" aria-hidden="true" />{p}</li>
              ))}
            </ul>
          )}
        </div>
        <AdminLinkButton to={policyHref} variant="secondary" className="w-full">View role policy</AdminLinkButton>
        <InlineNote tone="info">Role preview does not grant permissions.</InlineNote>
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
