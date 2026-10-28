import { useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AdminSectionNav, ChildPageFrame } from "@/components/admin/v2/AdminShell";
import { AdminButton, AdminCard, AdminLinkButton, EmptyState, InlineNote, SkeletonBlock, StatusChip } from "@/components/admin/v2/primitives";
import { buildAdminNavSections, filterNavSections } from "@/components/layout/adminNav";
import { ADMIN_SECTIONS, adminTabHref, firstVisibleTab, visibleSections, type AdminVisibilityContext } from "@/lib/admin/sections";
import { enforcementRows, policyFullyEnforced } from "@/lib/admin/enforcementMap";
import { capabilityMatrixForRole, normalizeRole, teamReturnHref } from "@/lib/admin/people";
import { getDealerCapabilities, hasAnyDealerCapability, hasDealerCapability, roleDisplayName, type DealerRole } from "@/lib/permissions/dealerRoleCapabilities";
import { CapabilityMatrixTable, EnforcementRail, MemberRoleReviewDialog, OutlineBadge } from "@/pages/admin/views/people/components";
import { useTeamAuthority, useTeamMembers, useTeamWriters } from "@/pages/admin/views/people/useTeamMembers";

// /admin/people/:memberId. The key is a member id (from Team) or a role value
// (from Roles). Either way the page shows the role's task matrix beside where
// that policy is enforced today, a preview of what the role sees, and, for a
// member, Review & Apply over set_tenant_member_role.

const ROLE_KEY = /^[a-z][a-z_]*$/;
const ZERO_BADGES = { workQueue: 0, leads: 0, reconApprovals: 0, priceChangeReview: 0, complianceTasks: 0, returns: 0 };

const RolePreviewDialog = ({ open, onOpenChange, role }: { open: boolean; onOpenChange: (o: boolean) => void; role: DealerRole }) => {
  const label = roleDisplayName(role);
  const sections = useMemo(() => visibleSections({ role, isAdmin: false }), [role]);
  const nav = useMemo(() => filterNavSections(buildAdminNavSections({ badges: ZERO_BADGES, anyAdminTab: sections.length > 0, role }), {
    isAdmin: false,
    isManager: hasAnyDealerCapability(role, ["can_manage_team", "can_manage_settings"]),
    can: (c) => hasDealerCapability(role, c),
    hasFeature: () => true,
  }), [role, sections.length]);
  const capabilityCount = getDealerCapabilities(role).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px] rounded-[12px]">
        <DialogHeader>
          <DialogTitle className="text-[18px] leading-[26px] font-semibold text-adm-ink flex items-center gap-2">
            Preview as {label}
            <StatusChip tone="warning">Test data</StatusChip>
          </DialogTitle>
          <DialogDescription className="text-[13px] text-adm-muted">
            What a {label} would see, computed from the capability contract. Nothing is granted or changed by this preview.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <p className="text-[12px] leading-[18px] font-semibold text-adm-muted">Navigation ({nav.reduce((n, s) => n + s.items.length, 0)} rows)</p>
            <ul className="mt-2 space-y-2">
              {nav.map((s) => (
                <li key={s.key}>
                  {s.title && <p className="text-[11px] leading-[16px] font-semibold text-adm-muted tracking-wide">{s.title}</p>}
                  <ul className="text-[13px] text-adm-ink">
                    {s.items.map((i) => <li key={i.path}>{i.label}</li>)}
                  </ul>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-[12px] leading-[18px] font-semibold text-adm-muted">Administration sections ({sections.length})</p>
            {sections.length === 0 ? (
              <p className="mt-2 text-[13px] text-adm-muted">Administration is not shown to this role.</p>
            ) : (
              <ul className="mt-2 text-[13px] text-adm-ink space-y-1">
                {sections.map((s) => <li key={s.id}>{s.label}</li>)}
              </ul>
            )}
            <p className="mt-3 text-[12px] leading-[18px] text-adm-muted">{capabilityCount} capabilities in the contract. Validate with a restricted account before release.</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default function MemberRolePage() {
  const params = useParams<{ memberId?: string }>();
  const [searchParams] = useSearchParams();
  const read = useTeamMembers();
  const authority = useTeamAuthority();
  const writers = useTeamWriters();
  const [reviewOpen, setReviewOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [applied, setApplied] = useState<string | null>(null);

  const key = params.memberId ?? read.fixture?.selectedMemberId ?? "";
  const member = read.members?.find((m) => m.id === key) ?? null;
  const roleKey = !member && ROLE_KEY.test(normalizeRole(key)) ? normalizeRole(key) : null;
  const role: string | null = member?.role ?? roleKey;

  const ctx = useMemo<AdminVisibilityContext>(() => ({ role: authority.role, isAdmin: authority.isAdmin }), [authority.role, authority.isAdmin]);
  const rows = useMemo(() => enforcementRows(), []);
  const matrix = useMemo(() => (role ? capabilityMatrixForRole(role) : null), [role]);

  const fromTeam = searchParams.get("from") === "team" || searchParams.has("sel");
  const backHref = fromTeam ? teamReturnHref(searchParams) : adminTabHref("roles");
  const backLabel = fromTeam ? "Back to Team" : "Back to Roles";
  const label = role ? roleDisplayName(role) : "Role";

  const crumbs = [
    { label: "Administration", href: "/admin" },
    { label: "People & Access", href: adminTabHref("team") },
    { label: "Roles", href: adminTabHref("roles") },
    { label },
  ];
  const sectionNav = <AdminSectionNav sections={visibleSections(ctx).length ? visibleSections(ctx) : [...ADMIN_SECTIONS]} activeId="people" tabFor={(s) => firstVisibleTab(s, ctx) ?? s.tabs[0]} />;

  if (read.state === "loading") {
    return (
      <ChildPageFrame crumbs={crumbs} title={<SkeletonBlock className="h-9 w-64" />} subtitle="Define the work this employee can perform." backHref={backHref} backLabel={backLabel} sectionNav={sectionNav}>
        <div className="space-y-3" aria-busy="true" aria-label="Loading role policy">
          <SkeletonBlock className="h-64 w-full" />
        </div>
      </ChildPageFrame>
    );
  }

  if (read.state === "failed" || (read.state !== "no-tenant" && !role)) {
    return (
      <ChildPageFrame crumbs={crumbs} title={read.state === "failed" ? "Role policy" : "Member not found"} backHref={backHref} backLabel={backLabel} sectionNav={sectionNav}>
        <AdminCard>
          {read.state === "failed" ? (
            <InlineNote tone="danger" title="The team could not be read for this rooftop." action={<AdminButton size="sm" onClick={() => void read.refetch()}>Retry</AdminButton>}>{read.error}</InlineNote>
          ) : (
            <EmptyState compact title="This member is not on the team" detail="They may have been removed, or the link is stale." action={<AdminLinkButton to={adminTabHref("team")}>Open Team</AdminLinkButton>} />
          )}
        </AdminCard>
      </ChildPageFrame>
    );
  }

  if (!role || !matrix) {
    return (
      <ChildPageFrame crumbs={crumbs} title="Role policy" backHref={backHref} backLabel={backLabel} sectionNav={sectionNav}>
        <AdminCard><InlineNote tone="info">Select a rooftop to view its role policies.</InlineNote></AdminCard>
      </ChildPageFrame>
    );
  }

  const badge = applied
    ? <OutlineBadge title="Applied in this session; the list refreshes from the server.">Applied</OutlineBadge>
    : !policyFullyEnforced(rows)
      ? <OutlineBadge title="The interface and the team procedures follow this policy; dealer settings and listing tables still allow any accepted member.">Policy draft</OutlineBadge>
      : null;
  const canReview = !!member && authority.canWrite && member.role !== "owner";
  const reviewBlockedReason = !member
    ? "Open this policy from a team member to change their role."
    : member.role === "owner"
      ? "The owner role is changed by the server only."
      : authority.reason;

  return (
    <ChildPageFrame
      crumbs={crumbs}
      title={`${label} role`}
      badge={badge}
      subtitle="Define the work this employee can perform."
      backHref={backHref}
      backLabel={backLabel}
      sectionNav={sectionNav}
    >
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-4 items-start">
        <AdminCard title="Role capabilities" description={member ? `Applied to ${member.email}. Access scope: this rooftop.` : "Capability contract for this role. Access scope: this rooftop."} flush>
          <CapabilityMatrixTable matrix={matrix} />
        </AdminCard>
        <AdminCard title="Required enforcement" description="Where this policy is enforced today.">
          <EnforcementRail rows={rows} />
        </AdminCard>
      </div>
      <div className="mt-4 space-y-2">
        <InlineNote
          tone="info"
          title="Preview as role uses test data."
          action={
            <div className="flex items-center gap-2">
              <AdminButton onClick={() => setPreviewOpen(true)}>Test role access</AdminButton>
              <AdminButton variant="primary" disabled={!canReview} onClick={() => setReviewOpen(true)}>Review policy changes</AdminButton>
            </div>
          }
        >
          Validate with a restricted account before release.
        </InlineNote>
        {!canReview && reviewBlockedReason && <p className="text-[12px] leading-[18px] text-adm-muted" role="status">{reviewBlockedReason}</p>}
      </div>

      <RolePreviewDialog open={previewOpen} onOpenChange={setPreviewOpen} role={role} />
      {member && (
        <MemberRoleReviewDialog
          open={reviewOpen}
          onOpenChange={setReviewOpen}
          member={member}
          readOnlyReason={writers.readOnlyReason ?? authority.reason}
          writers={writers}
          onApplied={(r) => setApplied(r)}
          onReload={() => void read.refetch()}
        />
      )}
    </ChildPageFrame>
  );
}
