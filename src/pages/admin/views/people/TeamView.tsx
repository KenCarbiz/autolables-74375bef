import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { MoreHorizontal, Search, UserPlus } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AdminButton, AdminCard, AdminLinkButton, AdminTable, EmptyState, ICON, InlineNote, SkeletonBlock, Td, Th } from "@/components/admin/v2/primitives";
import { ADMIN_CHILD_ROUTES, adminTabHref } from "@/lib/admin/sections";
import { applyTeamFilters, DEPARTMENTS, parseTeamFilters, teamFiltersToParams, type TeamFilters, type TeamMember } from "@/lib/admin/people";
import { cn } from "@/lib/utils";
import emptyList from "@/assets/admin-v2/artwork/empty-list.svg";
import { INPUT_CLASS, MemberAvatar, MemberRoleReviewDialog, MemberStatusText, RoleSummaryRail, SELECT_CLASS } from "./components";
import { useTeamAuthority, useTeamMembers, useTeamWriters } from "./useTeamMembers";

// Team: the membership list for this rooftop with the search, department and
// status filters held in the URL (the status filter has no toolbar control,
// as the reference toolbar draws only search, Department and Add employee),
// a role summary rail for the selected member, and the three gated actions.
// The list is read through list_tenant_members; a failed read says so and
// never shows an empty team.
//
// One card holds the toolbar and table beside the rail, as the reference
// draws it: 43px controls, a 45px header, 67px rows around 52px avatars and
// a 356px rail column.

const policyHref = (member: TeamMember, filters: TeamFilters): string => {
  const params = teamFiltersToParams({ ...filters, sel: member.id });
  params.set("from", "team");
  return `${ADMIN_CHILD_ROUTES.memberRole(member.id)}?${params.toString()}`;
};

const CONTROL = "h-[43px]";
const HEAD = "px-[17px] py-[13px] text-[14px] leading-[19px] text-adm-ink";
const CELL = "px-[17px] py-[7px]";

export default function TeamView() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => parseTeamFilters(searchParams), [searchParams]);
  const read = useTeamMembers();
  const authority = useTeamAuthority();
  const writers = useTeamWriters();
  const [dismissedFixtureSelection, setDismissedFixtureSelection] = useState(false);
  const [reviewFor, setReviewFor] = useState<TeamMember | null>(null);
  const [removeFor, setRemoveFor] = useState<TeamMember | null>(null);
  const [flash, setFlash] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  const update = (patch: Partial<TeamFilters>) => {
    setSearchParams(teamFiltersToParams({ ...filters, ...patch }, searchParams), { replace: true });
    if (patch.sel !== undefined) setDismissedFixtureSelection(true);
  };

  const members = read.members;
  const visible = useMemo(() => (members ? applyTeamFilters(members, filters) : []), [members, filters]);
  const selectedId = filters.sel || (!dismissedFixtureSelection ? read.fixture?.selectedMemberId ?? "" : "");
  const selected = members?.find((m) => m.id === selectedId) ?? null;
  const filtered = filters.q !== "" || filters.dept !== "all" || filters.status !== "all" || filters.role !== "all";

  const confirmRemove = async () => {
    if (!removeFor) return;
    const target = removeFor;
    setRemoveFor(null);
    const r = await writers.remove(target.id);
    setFlash({ tone: r.ok ? "success" : "danger", text: r.ok ? `${target.email} was removed from the team.` : r.message });
    if (r.ok && selectedId === target.id) update({ sel: "" });
  };

  const body = (() => {
    if (read.state === "loading") {
      return (
        <div className="px-[18px] pb-[18px] space-y-3" aria-busy="true" aria-label="Loading team">
          {[0, 1, 2, 3].map((i) => <SkeletonBlock key={i} className="h-11 w-full" />)}
        </div>
      );
    }
    if (read.state === "no-tenant") {
      return <InlineNote tone="info" className="mx-[18px] mb-[18px]">Select a rooftop to manage its team.</InlineNote>;
    }
    if (read.state === "failed" || !members) {
      return (
        <InlineNote tone="danger" title="The team could not be read for this rooftop." className="mx-[18px] mb-[18px]" action={<AdminButton size="sm" onClick={() => void read.refetch()}>Retry</AdminButton>}>
          {read.error ?? "No members are shown because the read failed, not because the team is empty."}
        </InlineNote>
      );
    }
    if (members.length === 0) {
      return (
        <EmptyState
          artwork={emptyList}
          title="No teammates yet"
          detail="Invite your staff and set what each person can do. Every member is scoped to this rooftop."
          action={<AdminLinkButton to={adminTabHref("invitations")} variant="primary">Add employee</AdminLinkButton>}
        />
      );
    }
    if (visible.length === 0) {
      return (
        <EmptyState
          compact
          title="No team members match these filters"
          detail={`${members.length} ${members.length === 1 ? "member is" : "members are"} on this rooftop.`}
          action={<AdminButton size="sm" onClick={() => update({ q: "", dept: "all", status: "all", role: "all" })}>Clear filters</AdminButton>}
        />
      );
    }
    // The scroll wrapper is positioned so the cells' screen-reader text stays inside it on narrow
    // screens. Fixed columns from the reference (159/146/146/150/58, Employee takes the rest) keep
    // every role and department on one line; a long address truncates with its full text on hover.
    return (
      <AdminTable caption="Team members" inset className="relative mx-[18px] mb-[18px] rounded-lg xl:min-h-[554px] xl:[&>table]:table-fixed">
        <thead>
          <tr>
            <Th className={HEAD}>Employee</Th>
            <Th className={cn(HEAD, "xl:w-[159px]")}>Role</Th>
            <Th className={cn(HEAD, "xl:w-[146px]")}>Department</Th>
            <Th className={cn(HEAD, "xl:w-[146px]")}>Access</Th>
            <Th className={cn(HEAD, "xl:w-[150px]")}>Status</Th>
            <Th className={cn(HEAD, "w-[58px]")}><span className="sr-only">Actions</span></Th>
          </tr>
        </thead>
        <tbody>
          {visible.map((m) => {
            const isSelected = m.id === selectedId;
            const protectedRow = m.role === "owner";
            return (
              <tr key={m.id} data-selected={isSelected ? "true" : undefined} className={cn(isSelected && "bg-adm-selected")}>
                <Td className={cn(CELL, "pl-[9px]")}>
                  <button type="button" onClick={() => update({ sel: m.id })} aria-pressed={isSelected} className="flex items-center gap-4 text-left rounded-md focus-visible:outline-2 focus-visible:outline-adm-primary">
                    <MemberAvatar initials={m.initials} size="md" />
                    <span className="min-w-0">
                      <span className="block font-semibold text-adm-ink truncate" data-parity="member-name" title={m.email}>{m.email}</span>
                      <span className="block text-[12px] leading-[18px] text-adm-muted">{m.status === "active" ? "Member" : "Invitation pending"}</span>
                    </span>
                  </button>
                </Td>
                <Td className={cn(CELL, "xl:whitespace-nowrap")}>{m.roleLabel}</Td>
                <Td className={cn(CELL, "xl:whitespace-nowrap")}>{m.department}</Td>
                <Td className={cn(CELL, "whitespace-nowrap")}>This rooftop</Td>
                <Td className={CELL}><MemberStatusText status={m.status} /></Td>
                <Td align="right" className={CELL}>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button type="button" aria-label={`Actions for ${m.email}`} className="w-8 h-8 inline-flex items-center justify-center rounded-md text-adm-muted hover:bg-adm-workspace">
                        <MoreHorizontal className={ICON.status} aria-hidden="true" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-[200px]">
                      <DropdownMenuItem asChild><Link to={policyHref(m, filters)}>View role policy</Link></DropdownMenuItem>
                      <DropdownMenuItem disabled={protectedRow || !authority.canWrite} onSelect={() => setReviewFor(m)}>Change role</DropdownMenuItem>
                      <DropdownMenuItem disabled={protectedRow || !authority.canWrite} onSelect={() => setRemoveFor(m)} className="text-adm-danger focus:text-adm-danger">Remove from team</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </AdminTable>
    );
  })();

  return (
    <>
      <AdminCard flush id="team-card" className="min-w-0">
        <div className="flex flex-col xl:flex-row">
          <div className="min-w-0 flex-1">
            <div className="px-[18px] pt-[25px] pb-[21px] flex flex-wrap items-center gap-x-[21px] gap-y-3">
              <label className="relative w-full sm:w-[308px]">
                <Search className={cn(ICON.status, "absolute left-4 top-1/2 -translate-y-1/2 text-adm-muted")} aria-hidden="true" />
                <span className="sr-only">Search team</span>
                <input type="search" value={filters.q} onChange={(e) => update({ q: e.target.value })} placeholder="Search team..." className={cn(INPUT_CLASS, CONTROL, "pl-[51px]")} data-landmark="team-search" />
              </label>
              <label className="inline-flex items-center gap-4 text-[14px] leading-[20px] text-adm-ink">
                Department
                <select aria-label="Department" value={filters.dept} onChange={(e) => update({ dept: e.target.value })} className={cn(SELECT_CLASS, CONTROL, "w-[176px] pl-[14px]")}>
                  <option value="all">All</option>
                  {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </label>
              <AdminLinkButton to={adminTabHref("invitations")} variant="primary" className="ml-auto min-h-[42px] sm:min-h-[42px]" data-landmark="add-employee">
                <UserPlus className={ICON.button} aria-hidden="true" />
                Add employee
              </AdminLinkButton>
            </div>
            {flash && <InlineNote tone={flash.tone} className="mx-[18px] mb-4" action={<AdminButton size="sm" variant="ghost" onClick={() => setFlash(null)}>Dismiss</AdminButton>}>{flash.text}</InlineNote>}
            {filtered && read.state === "ready" && members && (
              <p className="px-[18px] pb-3 text-[12px] leading-[18px] text-adm-muted" role="status">Showing {visible.length} of {members.length}.</p>
            )}
            {body}
          </div>

          {selected && (
            <RoleSummaryRail
              member={selected}
              policyHref={policyHref(selected, filters)}
              onClose={() => update({ sel: "" })}
              className="border-t border-adm-border xl:border-t-0 xl:border-l xl:w-[356px] xl:flex-shrink-0"
            />
          )}
        </div>
      </AdminCard>

      {reviewFor && (
        <MemberRoleReviewDialog
          open
          onOpenChange={(o) => { if (!o) setReviewFor(null); }}
          member={reviewFor}
          readOnlyReason={writers.readOnlyReason ?? authority.reason}
          writers={writers}
          onReload={() => void read.refetch()}
        />
      )}

      <AlertDialog open={!!removeFor} onOpenChange={(o) => { if (!o) setRemoveFor(null); }}>
        <AlertDialogContent className="rounded-[12px]">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removeFor?.email} from the team?</AlertDialogTitle>
            <AlertDialogDescription>
              They lose access to this rooftop as soon as the server confirms. The server refuses to remove the last owner. Removals are not written to the audit ledger today.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmRemove()}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
