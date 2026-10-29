import { useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ChevronDown, ChevronsUpDown, ChevronUp, MoreHorizontal, Search, UserPlus } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { AdminButton, AdminCard, AdminLinkButton, AdminTable, EmptyState, ICON, InlineNote, SkeletonBlock, Td, Th } from "@/components/admin/v2/primitives";
import { useReturnFocus } from "@/components/admin/v2/useReturnFocus";
import { ADMIN_CHILD_ROUTES, adminTabHref } from "@/lib/admin/sections";
import { applyTeamFilters, DEPARTMENTS, parseTeamFilters, teamFiltersToParams, type TeamFilters, type TeamMember } from "@/lib/admin/people";
import { cn } from "@/lib/utils";
import emptyList from "@/assets/admin-v2/artwork/empty-list.svg";
import { BreakableAddress, INPUT_CLASS, MemberAvatar, MemberRoleReviewDialog, MemberStatusText, RoleSummaryRail, SELECT_CLASS } from "./components";
import { useTeamAuthority, useTeamMembers, useTeamWriters } from "./useTeamMembers";

// Team: the membership list for this rooftop with the search, department and
// status filters held in the URL (the status filter has no toolbar control,
// as the reference toolbar draws only search, Department and Add employee),
// a role summary rail for the selected member, and the three gated actions.
// The list is read through list_tenant_members; a failed read says so and
// never shows an empty team.
//
// One card holds the toolbar and table beside the rail, as the reference
// draws it: 43px controls, a 44px header, 67px rows around 48px avatars and
// a 356px rail column. Every column sorts in the browser; the default is the
// order the server returns.

const policyHref = (member: TeamMember, filters: TeamFilters): string => {
  const params = teamFiltersToParams({ ...filters, sel: member.id });
  params.set("from", "team");
  return `${ADMIN_CHILD_ROUTES.memberRole(member.id)}?${params.toString()}`;
};

type SortKey = "employee" | "role" | "department" | "access" | "status";
type Sort = { key: SortKey; dir: "asc" | "desc" } | null;

const SORT_VALUE: Record<SortKey, (m: TeamMember) => string> = {
  employee: (m) => m.email,
  role: (m) => m.roleLabel,
  department: (m) => m.department,
  access: () => "This rooftop",
  status: (m) => m.status,
};

const sortMembers = (members: TeamMember[], sort: Sort): TeamMember[] => {
  if (!sort) return members;
  const value = SORT_VALUE[sort.key];
  const sign = sort.dir === "asc" ? 1 : -1;
  return [...members].sort((a, b) => sign * value(a).localeCompare(value(b)));
};

// Unsorted, ascending, descending, then back to the server's order.
const nextSort = (sort: Sort, key: SortKey): Sort => (sort?.key !== key ? { key, dir: "asc" } : sort.dir === "asc" ? { key, dir: "desc" } : null);

const CONTROL = "h-[43px]";
// The reference's 17px cell padding from 1536px; tighter below so all six columns fit beside the rail.
const HEAD = "bg-adm-workspace px-3 2xl:px-[17px] py-3 text-left text-[14px] leading-[19px] font-semibold text-adm-ink border-b border-adm-border";
const CELL = "px-3 2xl:px-[17px] py-[9px]";
// Reference sort marks: 9x6 and 7x11px of ink, an 18px lucide box 8px after the label.
const SORT_ICON = "w-[18px] h-[18px] flex-shrink-0";

const SortableTh = ({ label, sortKey, sort, onSort, className }: { label: string; sortKey: SortKey; sort: Sort; onSort: (key: SortKey) => void; className?: string }) => {
  const active = sort?.key === sortKey ? sort.dir : null;
  const Icon = active === "asc" ? ChevronUp : active === "desc" ? ChevronDown : ChevronsUpDown;
  return (
    <th scope="col" aria-sort={active === "asc" ? "ascending" : active === "desc" ? "descending" : "none"} className={cn(HEAD, className)}>
      <button type="button" onClick={() => onSort(sortKey)} className="inline-flex items-center gap-2 rounded-sm font-semibold hover:text-adm-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-adm-primary">
        {label}
        <Icon className={cn(SORT_ICON, "text-adm-ink")} aria-hidden="true" />
      </button>
    </th>
  );
};

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
  const [sort, setSort] = useState<Sort>(null);
  // The row menu trigger that opened Change role or Remove; its menu item is gone by the time the dialog closes.
  const rowTrigger = useRef<HTMLElement | null>(null);
  const onRemoveCloseAutoFocus = useReturnFocus(!!removeFor, rowTrigger);

  const update = (patch: Partial<TeamFilters>) => {
    setSearchParams(teamFiltersToParams({ ...filters, ...patch }, searchParams), { replace: true });
    if (patch.sel !== undefined) setDismissedFixtureSelection(true);
  };

  const members = read.members;
  const visible = useMemo(() => (members ? sortMembers(applyTeamFilters(members, filters), sort) : []), [members, filters, sort]);
  const onSort = (key: SortKey) => setSort((s) => nextSort(s, key));
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
    // screens. From 1536px, fixed columns from the reference (158/147/144/150/58, Employee takes the
    // rest) keep departments on one line; a role label longer than its column (Title Clerk / Office
    // Mgr) wraps instead of running into Department. Below that the columns size to their content.
    // A long address wraps rather than truncating, since it is the member's only identifier.
    return (
      <AdminTable caption="Team members" inset className="relative mx-[18px] mb-[18px] rounded-lg xl:min-h-[554px] 2xl:[&_table]:table-fixed">
        <thead>
          <tr>
            <SortableTh label="Employee" sortKey="employee" sort={sort} onSort={onSort} className="min-w-[190px] 2xl:min-w-0" />
            <SortableTh label="Role" sortKey="role" sort={sort} onSort={onSort} className="2xl:w-[158px]" />
            <SortableTh label="Department" sortKey="department" sort={sort} onSort={onSort} className="2xl:w-[147px]" />
            <SortableTh label="Access" sortKey="access" sort={sort} onSort={onSort} className="2xl:w-[144px]" />
            <SortableTh label="Status" sortKey="status" sort={sort} onSort={onSort} className="2xl:w-[150px]" />
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
                  <button type="button" onClick={() => update({ sel: m.id })} aria-pressed={isSelected} className="group flex w-full min-w-0 items-center gap-4 text-left rounded-md focus-visible:outline-2 focus-visible:outline-adm-primary">
                    <MemberAvatar initials={m.initials} department={m.department} size="md" />
                    <span className="min-w-0 flex-1 [overflow-wrap:anywhere] font-semibold text-adm-ink group-hover:text-adm-primary group-hover:underline" data-parity="member-name"><BreakableAddress value={m.email} /></span>
                  </button>
                </Td>
                <Td className={cn(CELL, "2xl:pr-3")}>{m.roleLabel}</Td>
                <Td className={cn(CELL, "2xl:whitespace-nowrap")}>{m.department}</Td>
                <Td className={cn(CELL, "whitespace-nowrap")}>This rooftop</Td>
                <Td className={CELL}><MemberStatusText status={m.status} /></Td>
                <Td align="right" className={CELL}>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button type="button" aria-label={`Actions for ${m.email}`} onPointerDown={(e) => { rowTrigger.current = e.currentTarget; }} onFocus={(e) => { rowTrigger.current = e.currentTarget; }} className="w-8 h-8 inline-flex items-center justify-center rounded-md text-adm-ink hover:bg-adm-workspace">
                        <MoreHorizontal className={ICON.statusTight} aria-hidden="true" />
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
        {/* The rail sits beside the table from 1360px; narrower, the six columns need the full card width. */}
        <div className="flex flex-col min-[1360px]:flex-row">
          <div className="min-w-0 flex-1">
            <div className="px-[18px] pt-[25px] pb-[21px] flex flex-wrap items-center gap-x-[21px] gap-y-3">
              <label className="relative w-full sm:w-[308px]">
                <Search className={cn(ICON.inline, "absolute left-[14px] top-1/2 -translate-y-1/2 text-adm-muted")} aria-hidden="true" />
                <span className="sr-only">Search team</span>
                <input type="search" value={filters.q} onChange={(e) => update({ q: e.target.value })} placeholder="Search team..." className={cn(INPUT_CLASS, CONTROL, "pl-[51px]")} data-landmark="team-search" />
              </label>
              <label className="inline-flex items-center gap-[14px] text-[14px] leading-[20px] font-semibold text-adm-ink">
                Department
                <span className="relative">
                  <select aria-label="Department" value={filters.dept} onChange={(e) => update({ dept: e.target.value })} className={cn(SELECT_CLASS, CONTROL, "w-[176px] appearance-none pl-[14px] pr-10 font-normal")}>
                    <option value="all">All</option>
                    {DEPARTMENTS.map((d) => <option key={d} value={d}>{d}</option>)}
                  </select>
                  <ChevronDown className={cn(SORT_ICON, "pointer-events-none absolute right-[13px] top-1/2 -translate-y-1/2 text-adm-ink")} aria-hidden="true" />
                </span>
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
              className="border-t border-adm-border min-[1360px]:border-t-0 min-[1360px]:border-l min-[1360px]:w-[356px] min-[1360px]:flex-shrink-0"
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
          returnFocusRef={rowTrigger}
        />
      )}

      <AlertDialog open={!!removeFor} onOpenChange={(o) => { if (!o) setRemoveFor(null); }}>
        <AlertDialogContent className="rounded-[12px]" onCloseAutoFocus={onRemoveCloseAutoFocus}>
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
